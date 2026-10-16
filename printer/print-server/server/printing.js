'use strict';
// Printing a PNG, the label printer and its backup.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const { execFile } = require('child_process');
const cups = require('../cups');
const { createPrintHelper } = require('../print-helper');
const { createPrintTurns } = require('../print-turn');
const fs    = require('fs');
const $config = lazy('./config');
const $images = lazy('./images');
const $customPdf = lazy('./custom-pdf');
const $spooler = lazy('./spooler');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  backupPrinter: { enumerable: true, get: () => backupPrinter },
  cupsPrinterRows: { enumerable: true, get: () => cupsPrinterRows },
  printerFallbackWarnings: { enumerable: true, get: () => printerFallbackWarnings },
  printerJobs: { enumerable: true, get: () => printerJobs },
  printImage: { enumerable: true, get: () => printImage },
  printImages: { enumerable: true, get: () => printImages },
  printHelper: { enumerable: true, get: () => printHelper },
  printTurns: { enumerable: true, get: () => printTurns },
  outcomeUnknownBody: { enumerable: true, get: () => outcomeUnknownBody },
  printingTarget: { enumerable: true, get: () => printingTarget },
  printLabel: { enumerable: true, get: () => printLabel },
  runPowerShell: { enumerable: true, get: () => runPowerShell },
  sleep: { enumerable: true, get: () => sleep },
  withPrinter: { enumerable: true, get: () => withPrinter },
});

// ── Print a PNG image silently via PowerShell System.Drawing ─────────────────
// The script is written to a temp .ps1 file and run with -File (not -Command)
// to avoid multiline quoting issues.  The image path is stored on the
// PrintDocument object itself so the PrintPage handler can load it fresh —
// this sidesteps the .NET event handler scope issue where outer-scope
// variables are not reliably accessible inside add_PrintPage scriptblocks.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every PowerShell this server runs goes through here, OFF the event loop.
// Until 7.11.1 each was execSync, with Atomics.wait between retries: while a
// label printed (up to about a minute with a hung driver and a backup
// printer), nothing else was served (no other /print, no phone request, no
// /health), the extension's long poll stalled, and inside Electron the tray
// and Settings froze. The arguments go straight to the process (no shell), so
// nothing in a printer name or a path is ever interpreted.
// @returns {Promise<string>} stdout; rejects with the error carrying .stdout
function runPowerShell(args, { timeout = 15000, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args], {
      timeout, windowsHide: true, encoding: 'utf8', env, maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve(stdout == null ? '' : String(stdout));
    });
  });
}

// The printer is one device: its jobs (labels, tags, the tune, a worksheet)
// run one at a time, in the order they were asked for, while everything else
// the server does carries on around them. A failed job never blocks the next.
let printerChain = Promise.resolve();
// The print turn (print-turn.js): the station's job puller draws the next job's label
// while this one prints, and each job prints only when the jobs leased before it are
// done, so the labels still come out in lease order (job-puller.js, performCheckinPrint).
const printTurns = createPrintTurns();
let printerJobs = 0;   // jobs on the chain: printing, or waiting their turn (isBusy)
function withPrinter(fn) {
  printerJobs += 1;
  const run = printerChain.then(fn, fn);
  printerChain = run.catch(() => {});
  const done = () => { printerJobs -= 1; };
  run.then(done, done);
  return run;
}

function printImage(imagePath, printerName) {
  return withPrinter(() => printImageNow(imagePath, printerName));
}

// The Raspberry Pi print station (CUPS_BACKEND): the same label through CUPS, with the same one retry. config.cupsMedia names the label roll.
async function printImageCups(imagePath, printerName) {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const id = await cups.cupsPrint(imagePath, printerName || '', { media: $config.config.cupsMedia });
      console.log('[print] CUPS job', id);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        console.warn(`[print] Attempt ${attempt} failed (${String(e.message).split('\n')[0]}) — retrying in 750ms`);
        await sleep(750);
      }
    }
  }
  throw lastErr;
}

// What CUPS knows, in the shape the Windows checks read from Get-Printer.
async function cupsPrinterRows() {
  const got = await cups.cupsPrinters();
  return got ? got.printers.map((p) => ({ Name: p.name, PrinterStatus: p.status, Default: p.isDefault })) : null;
}

// The warm print helper (print-helper.js): ONE PowerShell kept running that prints
// label after label, instead of a new PowerShell (start-up + Add-Type) for each one.
// Windows only by default (it IS the Windows print path); AWANA_PRINT_HELPER=1 turns
// it on anywhere (the suites' stand-in powershell), =0 turns it off. Anything wrong
// with it prints the label the old way below; see print-helper.js for why an answer
// that never came is never printed again.
const printHelper = createPrintHelper({
  enabled: () => {
    if ($config.CUPS_BACKEND) return false;
    const env = process.env.AWANA_PRINT_HELPER;
    if (env === '0') return false;
    return env === '1' || process.platform === 'win32';
  },
  log: (m) => console.log(m),
});

// The body a print route adds to its error answer when a label MAY have printed (the
// helper took the request and then gave no answer): job-puller.js then treats the job
// like a print with no answer (already-spooled, CHECK THE PRINTER), never as a refusal
// that may run again.
function outcomeUnknownBody(e) {
  return e && e.printOutcomeUnknown === true ? { outcomeUnknown: true } : {};
}

// One label the old way: its own PowerShell, the script written to a temp .ps1.
async function printImageScript(psPath, imagePath, printerName) {
  // Escape single quotes in paths/names for PowerShell single-quoted strings
  const safePath    = imagePath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$pd = New-Object System.Drawing.Printing.PrintDocument
${safePrinter ? `$pd.PrinterSettings.PrinterName = '${safePrinter}'` : ''}
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label", 400, 200)
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$pd | Add-Member -NotePropertyName LabelImagePath -NotePropertyValue '${safePath}'
$pd.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($sender.LabelImagePath)
  try { $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height) }
  finally { $img.Dispose() }
})
$pd.Print()
$pd.Dispose()
`.trim();

  fs.writeFileSync(psPath, ps, 'utf8');
  const result = await runPowerShell(['-File', psPath], { timeout: 15000 });
  if (result && result.trim()) console.log('[print] PowerShell:', result.trim());
}

async function printImageNow(imagePath, printerName) {
  if ($config.CUPS_BACKEND) return printImageCups(imagePath, printerName);
  let psPath = null;
  try {
    // One retry on failure: transient spooler errors (printer waking from
    // sleep, USB renegotiation) routinely succeed on a second attempt. The
    // child must not be sent away label-less over a hiccup. Each attempt goes
    // to the warm helper first; 'unavailable' (nothing was sent) means the old
    // way. A label whose outcome is unknown (the helper took it and never
    // answered) is NOT retried: it may be on the paper already.
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (await printHelper.print(imagePath, printerName) === 'printed') return;
        if (!psPath) psPath = $images.tmpFilePath('awana-print', 'ps1');
        await printImageScript(psPath, imagePath, printerName);
        return;
      } catch (e) {
        if (e && e.printOutcomeUnknown) throw e;
        lastErr = e;
        if (attempt < 2) {
          console.warn(`[print] Attempt ${attempt} failed (${e.message.split('\n')[0]}) — retrying in 750ms`);
          await sleep(750);
        }
      }
    }
    throw lastErr;
  } finally {
    if (psPath) fs.unlink(psPath, () => {});
  }
}

// Several labels as ONE print job (8.2.0, the BARF Bag labels: the owner asked
// for one job). Windows: one PrintDocument, a page per label, in order. CUPS:
// one lp with every file. No retry: half a batch printed twice is worse than
// a clear failure the operator can press again.
async function printImagesNow(paths, printerName) {
  if ($config.CUPS_BACKEND) {
    const id = await cups.cupsPrint(paths, printerName || '', { media: $config.config.cupsMedia });
    console.log('[print] CUPS job', id, `(${paths.length} labels)`);
    return;
  }
  const list = paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',');
  const safePrinter = (printerName || '').replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$pd = New-Object System.Drawing.Printing.PrintDocument
${safePrinter ? `$pd.PrinterSettings.PrinterName = '${safePrinter}'` : ''}
$pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Label", 400, 200)
$pd.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0,0,0,0)
$pd | Add-Member -NotePropertyName LabelImagePaths -NotePropertyValue @(${list})
$pd | Add-Member -NotePropertyName LabelIndex -NotePropertyValue 0
$pd.add_PrintPage({
  param($sender, $e)
  $img = [System.Drawing.Image]::FromFile($sender.LabelImagePaths[$sender.LabelIndex])
  try { $e.Graphics.DrawImage($img, 0, 0, $e.PageBounds.Width, $e.PageBounds.Height) }
  finally { $img.Dispose() }
  $sender.LabelIndex = $sender.LabelIndex + 1
  $e.HasMorePages = $sender.LabelIndex -lt $sender.LabelImagePaths.Count
})
$pd.Print()
$pd.Dispose()
`.trim();
  const psPath = $images.tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    const result = await runPowerShell(['-File', psPath], { timeout: 15000 + 2000 * paths.length });
    if (result && result.trim()) console.log('[print] PowerShell:', result.trim());
  } finally {
    fs.unlink(psPath, () => {});
  }
}

function printImages(paths, printerName) {
  return withPrinter(() => printImagesNow(paths, printerName));
}

// ── Where a label goes: the 4×2 label printer (and its backup) ────────────────
// Every label print in this file goes through printLabel(). It is printImage()
// on the name tag printer; if that fails and a backup printer is set (and
// Windows says it is there), the same label prints on the backup, so no child
// misses a tag. Only when both fail does the caller see an error, and it
// records the failure as it always has (the dashboard's failures list and its
// Reprint button). The receipt-printer trial (Star / Rongta, 6.22-7.16) is
// gone (owner, 2026-10-08); any of its keys still in an old config.json are
// never read.

// Is the named printer installed and not offline? On Windows a job sent to a
// disconnected USB printer just waits in the queue, which would look like
// success while the child walks away with nothing. Off Windows (tests) or if
// the query itself fails, assume yes and let printImage() be the judge.
async function fallbackPrinterReady(name) {
  if ($config.CUPS_BACKEND) {
    const rows = await cupsPrinterRows();
    if (!rows) return true;
    const row = rows.find((p) => p.Name === name);
    return !!row && !$spooler.PRINTER_STATUS_PROBLEMS[row.PrinterStatus];
  }
  if (process.platform !== 'win32') return true;
  try {
    const safe = name.replace(/'/g, "''");
    const raw = (await runPowerShell(
      ['-Command', `Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq '${safe}' } | Select-Object WorkOffline,PrinterStatus | ConvertTo-Json -Compress`],
      { timeout: 8000 },
    )).trim();
    if (!raw) return false;
    const p = JSON.parse(raw);
    return !(p.WorkOffline === true || p.PrinterStatus === 7);
  } catch {
    return true;
  }
}

// The backup printer ("If it fails, print on", 6.26.0): set on the dashboard
// beside the name tag printer, '' for none.
function backupPrinter() {
  return String($config.config.backupPrinterName || '').trim();
}

// Where labels print, in words, for the settings page (GET /printers).
function printingTarget() {
  return { kind: 'label', name: $config.PRINTER_NAME || null, backup: backupPrinter() || null };
}

let lastLabelBackup = null;   // { at, error, to } when a print fell back; cleared by the next good print

async function printLabel(pngPath, printerName) {
  try {
    await printImage(pngPath, printerName);
    lastLabelBackup = null;
    return { via: 'label' };
  } catch (e) {
    // It may have printed on the name tag printer: a second copy on the backup is
    // exactly what at most once forbids.
    if (e && e.printOutcomeUnknown) throw e;
    const backup = backupPrinter();
    const main = String(printerName || $config.PRINTER_NAME || '').trim();
    if (!backup || backup.toLowerCase() === main.toLowerCase()
      || !$customPdf.isSafePrinterName(backup) || !(await fallbackPrinterReady(backup))) throw e;
    await printImage(pngPath, backup);
    lastLabelBackup = { at: new Date().toISOString(), error: String(e.message || e).split('\n')[0].slice(0, 160), to: backup };
    console.warn(`[print] "${main}" failed; printed on the backup "${backup}" instead`);
    return { via: 'fallback', printer: backup };
  }
}

// The /health half: one {type, message} warning while the last label went to
// the backup printer. Clears on the next good print.
function printerFallbackWarnings() {
  if (!lastLabelBackup) return [];
  const at = new Date(lastLabelBackup.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return [{ type: 'printerFallback', message: `The name tag printer failed at ${at} (${lastLabelBackup.error}), so labels went to the backup "${lastLabelBackup.to}". Check it, then print a test label.` }];
}
