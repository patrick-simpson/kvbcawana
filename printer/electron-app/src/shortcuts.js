// Old-name shortcut cleanup for the app renames.
//
// The installer renames the shortcuts it made itself, but not copies a person
// made by hand; main.js offers once to remove those.

'use strict';

const fs = require('fs');
const path = require('path');

// v5.9.0 renamed the product from "Awana Label Printer" to "Club Label
// Printer" (trademark compliance — see changes.md). NSIS names the desktop
// and Start Menu shortcuts after `productName`, and electron-builder doesn't
// remove the old-named ones when a rebrand ships — an upgrading operator
// would otherwise end up with both "Awana Label Printer.lnk" and
// "Club Label Printer.lnk" pointing at the same app. This only looks for the
// OLD name; the new shortcuts are created fresh by the installer as normal.
// v9.0.0 renamed it again, to "KVBC Awana" (one app for the print server and
// the display, UNIFIED-APP.md). The installer renames the shortcuts it made
// (electron-builder reads the old ShortcutName from its install key), so this
// only finds a copy someone made by hand.
const OLD_BRAND_SHORTCUT_NAMES = ['Awana Label Printer.lnk', 'Club Label Printer.lnk'];

function findOldBrandShortcuts() {
  const found = [];
  const home = process.env.USERPROFILE || '';
  const appData = process.env.APPDATA || '';
  const candidates = [];
  if (home) candidates.push(path.join(home, 'Desktop'));
  if (appData) candidates.push(path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  for (const dir of candidates) {
    for (const name of OLD_BRAND_SHORTCUT_NAMES) {
      const p = path.join(dir, name);
      try { if (fs.existsSync(p)) found.push(p); } catch { /* ignore */ }
    }
  }
  return found;
}

function removeShortcuts(paths) {
  const removed = [];
  for (const p of paths) {
    try { fs.unlinkSync(p); removed.push(p); } catch (e) { console.warn('[shortcuts] Could not remove', p, e.message); }
  }
  return removed;
}

module.exports = { removeShortcuts, findOldBrandShortcuts };
