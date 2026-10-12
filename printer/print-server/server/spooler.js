'use strict';
// Printer check timer and Windows spooler backlog.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const fs    = require('fs');
const $config = lazy('./config');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $printing = lazy('./printing');
const $customPdf = lazy('./custom-pdf');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  cachedPrinterCheck: { enumerable: true, get: () => cachedPrinterCheck },
  checkPrinterWarnings: { enumerable: true, get: () => checkPrinterWarnings },
  clearPrintQueue: { enumerable: true, get: () => clearPrintQueue },
  parseClearQueueResult: { enumerable: true, get: () => parseClearQueueResult },
  PRINTER_STATUS_PROBLEMS: { enumerable: true, get: () => PRINTER_STATUS_PROBLEMS },
  printerSetupWarnings: { enumerable: true, get: () => printerSetupWarnings },
  SPOOLER_BACKLOG_JOBS: { enumerable: true, get: () => SPOOLER_BACKLOG_JOBS },
  SPOOLER_STUCK_MS: { enumerable: true, get: () => SPOOLER_STUCK_MS },
  SPOOLER_UNKNOWN: { enumerable: true, get: () => SPOOLER_UNKNOWN },
  spoolerBacklogMessage: { enumerable: true, get: () => spoolerBacklogMessage },
  startPrinterCheckTimer: { enumerable: true, get: () => startPrinterCheckTimer },
  summarizeSpoolerJobs: { enumerable: true, get: () => summarizeSpoolerJobs },
});

// ── Enhanced health check ────────────────────────────────────────────────────
let cachedPrinterCheck = { warnings: [], checkedAt: 0, spooler: null };
const PRINTER_CHECK_INTERVAL = 60000; // 60 seconds
// The probe in flight, if any: /health never waits on one that another
// caller (or the timer) already started, and never starts a second.
let printerCheckInFlight = null;

// Keep the probes warm from a timer, so a /health request is answered from
// the cache and only ever triggers a refresh in the background. Until 7.11.1
// the dashboard's own 15 s poll paid for the printer and spooler probes (a
// few seconds, in series) once a minute, on the request.
function startPrinterCheckTimer() {
  const t = setInterval(() => { checkPrinterWarnings().catch(() => {}); }, PRINTER_CHECK_INTERVAL);
  if (t.unref) t.unref();
}

// ── Windows spooler backlog (#256) ───────────────────────────────────────────
// checkPrinterWarnings only ever asked Get-Printer whether the configured name
// still EXISTS, so a paper-out or a jam looked perfectly healthy from the
// dashboard while jobs piled up behind it and everyone believed the labels had
// printed. These thresholds and the probe below close that gap.
//
// Deliberately module constants, not config.json keys: nothing about a jam is
// operator-tunable, and staying out of config keeps this away from
// SECRET_CONFIG_KEYS, applySavedConfig and the /config export entirely.
const SPOOLER_BACKLOG_JOBS = 3;             // three or more jobs waiting
const SPOOLER_STUCK_MS = 90000;             // or one job older than 90s
// Half the Get-Printer probe's 8000ms on purpose. checkPrinterWarnings is
// awaited by GET /health on a single-threaded server where printImage's
// a print can already take ~31s, so /health's worst case must not double.
const SPOOLER_PROBE_TIMEOUT_MS = 4000;
const SPOOLER_CLEAR_TIMEOUT_MS = 15000;
// JobStatus is a comma-separated flags string. A paper-out can sit on a SINGLE
// job for well under 90 seconds, which is exactly the "looks healthy" case
// this item exists for, so an error status is a third stuck trigger.
const SPOOLER_ERROR_TOKENS = ['error', 'offline', 'paperout', 'paused', 'blocked', 'userintervention'];

// Reads the queue. Its own script, its own temp file, its own PowerShell — the
// raw queue commands never touch printImage/sendRawToPrinter or POST /print.
//
// SECURITY: the printer name is validated by isSafePrinterName AND handed to
// the child as an environment variable read back with $env:, exactly as
// printPdf does. Nothing is interpolated into the script text or the command
// line — validation alone is the weaker half of the 5.2.0 fix.
const PS_READ_QUEUE = `
$ErrorActionPreference = 'Stop'
$p = $env:AWANA_QUEUE_PRINTER
$jobs = @()
foreach ($j in @(Get-PrintJob -PrinterName $p)) {
  $sub = ''
  if ($j.SubmittedTime) { $sub = $j.SubmittedTime.ToUniversalTime().ToString('o') }
  $jobs += @{ id = [string]$j.Id; status = [string]$j.JobStatus; submitted = $sub }
}
ConvertTo-Json -Compress -Depth 4 -InputObject @{ ok = $true; jobs = $jobs }
`.trim();

// Same discipline, the write half. Remove-PrintJob has NO whole-printer or
// wildcard form — -ID is mandatory in the printerName parameter set — so the
// queue is enumerated and each job removed through -InputObject. The per-job
// try/catch is deliberate: it turns the common race (a job finishing between
// enumerate and remove) and the rare foreign-user job that needs "Manage
// Documents" into an honest `failed` count instead of an exception.
const PS_CLEAR_QUEUE = `
$ErrorActionPreference = 'Stop'
$p = $env:AWANA_QUEUE_PRINTER
$removed = 0
$failed = 0
foreach ($j in @(Get-PrintJob -PrinterName $p)) {
  try { Remove-PrintJob -InputObject $j -ErrorAction Stop; $removed++ } catch { $failed++ }
}
ConvertTo-Json -Compress -InputObject @{ ok = $true; removed = $removed; failed = $failed }
`.trim();

// Returns an array of { id, status, submitted } jobs, or null meaning UNKNOWN.
// NEVER [] on failure: an empty queue and an unreadable queue are opposite
// facts, and collapsing "I could not read it" into a zero is the whole bug.
async function readSpoolerQueue(printerName) {
  if (process.platform !== 'win32') return null;
  // isSafePrinterName returns true for '' ("use the default"), so the
  // truthiness check comes first — -PrinterName is mandatory and cannot take ''.
  if (!printerName || !$customPdf.isSafePrinterName(printerName)) return null;
  // 'awana-print' keeps the file inside sweepOrphanedTempFiles' regex, so a
  // crash mid-probe leaves nothing behind.
  const psPath = $images.tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, PS_READ_QUEUE, 'utf8');
    const raw = await $printing.runPowerShell(['-File', psPath], {
      timeout: SPOOLER_PROBE_TIMEOUT_MS,
      env: Object.assign({}, process.env, { AWANA_QUEUE_PRINTER: printerName }),
    });
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed || parsed.ok !== true || !Array.isArray(parsed.jobs)) return null;
    return parsed.jobs;
  } catch {
    return null;
  } finally {
    fs.unlink(psPath, () => {});
  }
}

// Pure verdict, so the one piece of judgement here is exhaustively testable on
// a machine with no spooler at all — which is every CI runner this repo has.
function summarizeSpoolerJobs(jobs, now = Date.now()) {
  if (!Array.isArray(jobs)) {
    return { unknown: true, count: null, oldestAgeMs: null, stuck: false, errorStatuses: [] };
  }
  let oldestAgeMs = null;
  const errorStatuses = [];
  for (const j of jobs) {
    const t = (j && j.submitted) ? Date.parse(j.submitted) : NaN;
    if (Number.isFinite(t)) {
      // Clamped: clock skew or a future-dated job must never fake a stuck
      // queue or report a negative age.
      const age = Math.max(0, now - t);
      if (oldestAgeMs === null || age > oldestAgeMs) oldestAgeMs = age;
    }
    for (const part of String((j && j.status) || '').split(',')) {
      const spelling = part.trim();
      if (!spelling) continue;
      const norm = spelling.toLowerCase().replace(/[\s_]/g, '');
      if (SPOOLER_ERROR_TOKENS.includes(norm) && !errorStatuses.includes(spelling)) {
        errorStatuses.push(spelling);
      }
    }
  }
  const count = jobs.length;
  const stuck = count >= SPOOLER_BACKLOG_JOBS
    || (oldestAgeMs !== null && oldestAgeMs >= SPOOLER_STUCK_MS)
    || errorStatuses.length > 0;
  return { unknown: false, count, oldestAgeMs, stuck, errorStatuses };
}

// One sentence built from the real numbers. Deliberately NOT registered in the
// dashboard's WARNING_DESCRIPTIONS table — that table is static literals, and
// a static literal would swallow the count, the age and the status.
function spoolerBacklogMessage(printerName, s) {
  const n = s.count;
  const parts = [`${n} print job${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} waiting on "${printerName}"`];
  const detail = [];
  if (s.oldestAgeMs !== null) {
    const secs = Math.round(s.oldestAgeMs / 1000);
    detail.push(`oldest ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}`);
  }
  if (s.errorStatuses.length) detail.push(`status: ${s.errorStatuses.join(', ')}`);
  if (detail.length) parts.push(` (${detail.join(', ')})`);
  return parts.join('')
    + '. Labels are NOT coming out — check paper and power, then clear the queue on the Diagnostics tab.';
}

// Parses PS_CLEAR_QUEUE's output. null unless both counters came back as real
// non-negative integers — a garbled result must not be reported as "removed 0".
function parseClearQueueResult(raw) {
  try {
    const text = String(raw == null ? '' : raw).trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed || parsed.ok !== true) return null;
    const removed = parsed.removed, failed = parsed.failed;
    if (!Number.isInteger(removed) || removed < 0) return null;
    if (!Number.isInteger(failed) || failed < 0) return null;
    return { removed, failed };
  } catch {
    return null;
  }
}

// Manual only: never called by anything automatic, so nothing ever clears the
// queue on its own. Returns { removed, failed } or null.
async function clearPrintQueue(printerName) {
  if (process.platform !== 'win32') return null;
  if (!printerName || !$customPdf.isSafePrinterName(printerName)) return null;
  const psPath = $images.tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, PS_CLEAR_QUEUE, 'utf8');
    const raw = await $printing.runPowerShell(['-File', psPath], {
      timeout: SPOOLER_CLEAR_TIMEOUT_MS,
      env: Object.assign({}, process.env, { AWANA_QUEUE_PRINTER: printerName }),
    });
    return parseClearQueueResult(raw);
  } catch {
    return null;
  } finally {
    fs.unlink(psPath, () => {});
  }
}

const SPOOLER_UNKNOWN = Object.freeze(
  { unknown: true, count: null, oldestAgeMs: null, stuck: false, errorStatuses: [] });

// The name tag printer's setup, judged from Get-Printer's Name + PrinterStatus
// rows (null when the query failed). Pure, so every case is tested off
// Windows. A missing printer and an offline one both mean labels are not
// coming out; no printer chosen means they go to whatever Windows' default
// printer is (a PDF writer, or whatever else is installed).
const PRINTER_STATUS_PROBLEMS = {
  1: 'paused', 2: 'in an error state', 4: 'reporting a paper jam', 5: 'out of labels',
  7: 'reporting a paper problem', 8: 'offline (check its USB cable and power)',
};
function printerSetupWarnings(name, printers) {
  const chosen = String(name || '').trim();
  if (!chosen) {
    return [{ type: 'printerUnset', message: 'No name tag printer is chosen, so labels go to Windows\' default printer. Pick the label printer (the D450) in Settings \u2192 Printer.' }];
  }
  const out = [];
  if (printers === null) {
    out.push({ type: 'printerCheckFailed', message: 'Could not query printers' });
    return out;
  }
  const row = (printers || []).find((p) => p && p.Name === chosen);
  if (!row) {
    out.push({ type: 'printerNotFound', message: `Printer "${chosen}" not found` });
    return out;
  }
  const problem = PRINTER_STATUS_PROBLEMS[Number(row.PrinterStatus)];
  if (problem) {
    out.push({ type: 'printerOffline', message: `Windows says the name tag printer "${chosen}" is ${problem}. Labels will wait in the queue until it is fixed.` });
  }
  return out;
}

async function checkPrinterWarnings() {
  const now = Date.now();
  if (now - cachedPrinterCheck.checkedAt < PRINTER_CHECK_INTERVAL) {
    return cachedPrinterCheck.warnings;
  }
  // Stale: start one refresh and hand back what is known meanwhile. Only a
  // server that has never probed (its first /health) waits for the answer.
  if (!printerCheckInFlight) {
    printerCheckInFlight = probePrinterWarnings(now).finally(() => { printerCheckInFlight = null; });
  }
  if (cachedPrinterCheck.checkedAt === 0) return printerCheckInFlight;
  return cachedPrinterCheck.warnings;
}

async function probePrinterWarnings(now) {
  const warnings = [];
  const csvPath = $config.CSV_FILE;

  // Check CSV
  try {
    if (!fs.existsSync(csvPath)) {
      warnings.push({ type: 'csvMissing', message: 'clubbers.csv not found' });
    } else {
      const stat = fs.statSync(csvPath);
      const rows = $clubbers.parseCSV(fs.readFileSync(csvPath, 'utf8'));
      if (rows.length === 0) {
        warnings.push({ type: 'csvEmpty', message: 'clubbers.csv has no data rows' });
      }
      const ageHours = (now - stat.mtimeMs) / 3600000;
      if (ageHours > 24) {
        warnings.push({ type: 'csvStale', message: `clubbers.csv is ${Math.round(ageHours)}h old` });
      }
      // A roster whose consent columns nobody can read is a silent consent
      // failure (every child prints photographable). Say so, with the values.
      const consentMsg = $eligibility.consentWarningFor($eligibility.rosterConsentSummary(rows));
      if (consentMsg) warnings.push({ type: 'photoRelease', message: consentMsg });
    }
  } catch (e) { /* ignore */ }

  // Check printer (Windows, and CUPS on the Linux print station; the spooler
  // backlog probe is Windows-only)
  let spooler = SPOOLER_UNKNOWN;
  if ($config.CUPS_BACKEND) {
    warnings.push(...printerSetupWarnings($config.PRINTER_NAME, $config.PRINTER_NAME ? await $printing.cupsPrinterRows() : []));
  } else if (process.platform === 'win32') {
    let printers = null;
    if ($config.PRINTER_NAME) {
      try {
        const raw = (await $printing.runPowerShell(['-Command', 'Get-Printer | Select-Object Name,PrinterStatus | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
        const parsed = JSON.parse(raw);
        printers = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) { printers = null; }
    }
    const setup = printerSetupWarnings($config.PRINTER_NAME, printers);
    warnings.push(...setup);
    const printerFound = !!$config.PRINTER_NAME && !setup.some((w) => w.type === 'printerNotFound' || w.type === 'printerCheckFailed');

    // The spooler probe (#256) sits OUTSIDE that try/catch so a queue failure
    // can never be mislabelled printerCheckFailed, and is skipped entirely
    // when the printer itself is missing — the operator wants one clear
    // warning, not two confusing ones, and /health's worst-case synchronous
    // block must not double.
    if (printerFound) {
      spooler = summarizeSpoolerJobs(await readSpoolerQueue($config.PRINTER_NAME), now);
      if (spooler.unknown) {
        warnings.push({
          type: 'spoolerCheckFailed',
          message: `Could not read the print queue for "${$config.PRINTER_NAME}" — the backlog is unknown, not zero.`,
        });
      } else if (spooler.stuck) {
        warnings.push({ type: 'spoolerBacklog', message: spoolerBacklogMessage($config.PRINTER_NAME, spooler) });
      }
    }
  }

  cachedPrinterCheck = { warnings, checkedAt: now, spooler };
  return warnings;
}
