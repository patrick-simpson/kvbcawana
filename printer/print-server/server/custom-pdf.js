'use strict';
// Free-text label and arbitrary PDF printing.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const express = require('express');
const security = require('../security');
const fs    = require('fs');
const $config = lazy('./config');
const $clubbers = lazy('./clubbers');
const $images = lazy('./images');
const $labelType = lazy('./label-type');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $http = lazy('./http');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  isSafePrinterName: { enumerable: true, get: () => isSafePrinterName },
  normalizeCustomText: { enumerable: true, get: () => normalizeCustomText },
});

// ── Free-text label (POST /print-custom) ─────────────────────────────────────
// "VOLUNTEER", "KITCHEN", "Room 4 Helper" — one line of whatever the operator
// types, on an otherwise blank 4x2 label. It reuses the leader tag's plumbing
// end to end (generateLabel, the duplicate window, printImage, the effective
// printer) because that path is already the one that prints something which is
// NOT a check-in.
//
// It goes further than a leader tag, though: a leader tag is still a print with
// a person's name on it, so it files a flagged history row. A custom label
// names nobody and records NOTHING —
//   * no addHistoryEntry, so it never reaches history, the reprint list, the
//     TwoTimTwo write-back CSV or tonight's stats;
//   * no recordAttendance, so no ledger row, streak or milestone;
//   * no events.publish / publishTally, so nothing at all goes on the wire.
// The console line below is the entire record it leaves, deliberately.
//
// Loopback only like every other route (the global gate), and on the settings
// page's table: nobody on the church WiFi can make the door printer spit labels.
const CUSTOM_PRINT_TEXT_MAX = $labelType.CUSTOM_TEXT_MAX_CHARS;

// Pure, and exported, so the input rules are unit-tested without a printer.
// Control characters are stripped (they would print as tofu or nothing at all),
// internal whitespace is collapsed (a pasted string with a newline in it is
// one line on a label, not a ragged gap), and what is left has to be non-empty
// and short enough to stay legible.
function normalizeCustomText(raw) {
  const text = security.sanitizeStoredText(raw == null ? '' : raw, 200).replace(/\s+/g, ' ').trim();
  if (!text) return { ok: false, error: 'text is required' };
  if (text.length > CUSTOM_PRINT_TEXT_MAX) {
    return { ok: false, error: `text must be ${CUSTOM_PRINT_TEXT_MAX} characters or fewer` };
  }
  return { ok: true, text };
}

app.post('/print-custom', async (req, res) => {
  const b = req.body || {};
  const norm = normalizeCustomText(b.text);
  if (!norm.ok) return res.status(400).json({ success: false, error: norm.error });
  if (!isSafePrinterName(b.printerName)) {
    return res.status(400).json({ success: false, error: 'invalid printer name' });
  }
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || $config.PRINTER_NAME;

  // Namespaced so it can never collide with a child's check-in key or a
  // leader's in the same recentPrints map. Keyed on the TEXT, which is all a
  // custom label is, so a double-tap on the phone absorbs into one label.
  const dupKey = `custom:${norm.text.toLowerCase()}`;
  if ($clubbers.isDuplicatePrint(dupKey)) {
    console.log(`[print-custom] '${norm.text}' already printed within ${$clubbers.DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }
  $clubbers.claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await $labelRender.generateLabel({ customText: norm.text });
    pngPath = result.pngPath;
    await $tunes.playTuneIfEnabled(effectivePrinter);
    await $printing.printLabel(pngPath, effectivePrinter);
    $clubbers.recordPrint(dupKey);
    console.log(`[print-custom] ${norm.text}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[print-custom] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message, ...$printing.outcomeUnknownBody(err) });
  } finally {
    $clubbers.releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
});

// ── Print an arbitrary PDF (leader worksheets) ────────────────────────────────
// Leader handbook-agenda / undistributed-award worksheets come out of
// TwoTimTwo as PDFs (docs/TWOTIMTWO.md §5 — /meeting/handbook,
// /meeting/Awards_undistributed), letter-size rather than 4×2, so they need
// their own print path and (usually) their own printer.
const PDF_MAX_BYTES = 12 * 1024 * 1024; // ~12MB cap on the DECODED payload
const PDF_MAGIC = '%PDF-';

// Prints a PDF on Windows via the shell's registered PDF handler (Start-Process
// -Verb Print), the same temp-file + PowerShell + finally-unlink shape as
// printImage(). If a specific printer was requested, best-effort switch the
// Windows default printer to it first (Start-Process -Verb Print has no
// direct "-Printer" argument) — failure to do that is non-fatal, the job
// still goes to whatever the current default is. The default is PUT BACK
// afterwards, from this side, whatever happened to the print (a reader that
// stays open past the 30 s and gets the script killed included): until
// 7.11.1 it stayed switched, so on an install whose label printer is "the
// system default" every label after a mid-club worksheet went to the letter
// printer.
// A printer name is operator data that reaches a shell. Windows printer names
// are plain labels ("Brother QL-820NWB", "HP LaserJet (Office)"), so anything
// carrying quotes, shell metacharacters, or control characters is not a printer
// name — it is an injection attempt or corrupt config. Refuse it outright
// rather than try to escape it.
const PRINTER_NAME_MAX = 120;
function isSafePrinterName(name) {
  const s = String(name == null ? '' : name);
  if (!s) return true;                       // empty = "use the default"
  if (s.length > PRINTER_NAME_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  // Parentheses are allowed: Windows names printers "Star TSP100 Cutter
  // (TSP143)", "... (Copy 1)", "... (redirected 2)", and every place a name
  // reaches PowerShell it is inside a single-quoted string or an environment
  // variable, where they are plain characters. A subexpression still needs
  // the "$" refused here.
  return !/["'`$;|&<>{}\[\]\\\r\n%]/.test(s);
}

// Prints a PDF on Windows.
//
// SECURITY: neither the file path nor the printer name is interpolated into the
// PowerShell source. Both are handed to the child process as environment
// variables and read back with $env:, so no value can terminate a string
// literal and start a new statement. An earlier version escaped only single
// quotes and then embedded the printer name inside a DOUBLE-quoted filter
// string, which let a name containing a double quote run arbitrary commands —
// and because this server deliberately accepts requests from any local page,
// that was reachable from any website the volunteer had open.
function printPdf(pdfPath, printerName) {
  if (!isSafePrinterName(printerName)) {
    return Promise.reject(new Error('Refusing to print: printer name contains unsupported characters'));
  }
  return $printing.withPrinter(() => printPdfNow(pdfPath, printerName));
}

// The name of the current Windows default printer, or '' when unknown.
async function currentDefaultPrinter() {
  try {
    const raw = await $printing.runPowerShell(['-Command', 'Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name'], { timeout: 8000 });
    const name = String(raw || '').trim();
    return isSafePrinterName(name) ? name : '';
  } catch {
    return '';
  }
}

// Make the named printer the Windows default again (the name rides in the
// environment, never in the script).
async function restoreDefaultPrinter(name) {
  if (!name || !isSafePrinterName(name)) return;
  try {
    await $printing.runPowerShell(['-Command', '$p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $env:AWANA_PRINTER }; if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null }'], {
      timeout: 8000, env: Object.assign({}, process.env, { AWANA_PRINTER: name }),
    });
  } catch (e) {
    console.warn(`[print-pdf] Could not put the default printer back to "${name}":`, e.message.split('\n')[0]);
  }
}

async function printPdfNow(pdfPath, printerName) {
  const previous = printerName && process.platform === 'win32' ? await currentDefaultPrinter() : '';
  try {
    await runPdfPrintScript(pdfPath, printerName);
  } finally {
    if (previous && previous !== printerName) await restoreDefaultPrinter(previous);
  }
}

async function runPdfPrintScript(pdfPath, printerName) {
  const ps = `
$ErrorActionPreference = 'Stop'
$target = $env:AWANA_PDF_PATH
$printer = $env:AWANA_PRINTER
if ($printer) {
  try {
    $p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $printer }
    if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null }
  } catch { }
}
Start-Process -FilePath $target -Verb Print -WindowStyle Hidden -Wait
`.trim();

  const psPath = $images.tmpFilePath('awana-print-pdf', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    const result = await $printing.runPowerShell(['-File', psPath], {
      timeout: 30000,
      env: Object.assign({}, process.env, {
        AWANA_PDF_PATH: pdfPath,
        AWANA_PRINTER: printerName || '',
      }),
    });
    if (result && result.trim()) console.log('[print-pdf] PowerShell:', result.trim());
  } finally {
    fs.unlink(psPath, () => {});
  }
}

// The ONLY route allowed a large body — the global parser skips this path (see
// PDF_UPLOAD_PATH above) so this 18mb parser is the one that runs here.
app.post($http.PDF_UPLOAD_PATH, express.json({ limit: '18mb' }), async (req, res) => {
  // Validate the printer name FIRST, before the platform short-circuit below:
  // a malformed request is malformed on every OS, and rejecting it here means
  // the refusal is observable in tests that run on Linux rather than being
  // masked by the 501.
  if (!isSafePrinterName((req.body || {}).printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }

  // The headless render-smoke test runs on Linux — printing must fail loudly
  // and cheaply there, never attempt a PowerShell shell-out.
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'PDF printing requires Windows — not available on this platform' });
  }

  const { pdfBase64, printerName = '', label = '' } = req.body || {};
  if (!pdfBase64 || typeof pdfBase64 !== 'string') {
    return res.status(400).json({ error: 'pdfBase64 (string) is required' });
  }
  // Cheap length pre-check before the (comparatively expensive) base64 decode
  // — base64 inflates size by ~4/3, so this rejects wildly oversized payloads
  // without ever allocating the decoded buffer.
  if (pdfBase64.length > PDF_MAX_BYTES * 1.4) {
    return res.status(413).json({ error: 'PDF payload too large (12MB max)' });
  }

  let buffer;
  try {
    buffer = Buffer.from(pdfBase64, 'base64');
  } catch (e) {
    return res.status(400).json({ error: 'pdfBase64 is not valid base64' });
  }
  if (!buffer.length || buffer.length > PDF_MAX_BYTES) {
    return res.status(413).json({ error: 'PDF payload too large (12MB max)' });
  }
  // The magic bytes can be a handful of bytes into some generators' output
  // (stray leading whitespace/BOM), so scan a small header window rather
  // than requiring byte 0 exactly.
  if (!buffer.subarray(0, 1024).toString('latin1').includes(PDF_MAGIC)) {
    return res.status(400).json({ error: 'Decoded content is not a PDF (missing %PDF- header)' });
  }

  if (!isSafePrinterName(printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  const effectivePrinter = (printerName && String(printerName).trim())
    || $config.config.worksheetPrinter
    || $config.PRINTER_NAME;

  const pdfPath = $images.tmpFilePath('awana-doc', 'pdf');
  try {
    fs.writeFileSync(pdfPath, buffer);
    await printPdf(pdfPath, effectivePrinter);
    console.log(`[print-pdf] Printed ${label ? `'${String(label).slice(0, 60)}' ` : ''}(${buffer.length} bytes) to ${effectivePrinter || 'default'}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[print-pdf] Error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(pdfPath, () => {});
  }
});
