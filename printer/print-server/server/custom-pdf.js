'use strict';
// Free-text label, and the printer-name rule every shell-out shares.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
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
//   * no addHistoryEntry, so it never reaches history, the reprint list or
//     tonight's stats;
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

// ── The printer-name rule ─────────────────────────────────────────────────────
// ONE rule, in security.js (isSafePrinterName): an allowlist every entry and every
// shell-out shares. Re-exported here because the other modules have always asked
// this one.
const isSafePrinterName = security.isSafePrinterName;
