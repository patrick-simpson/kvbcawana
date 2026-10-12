// The print station's face in the tray (ROADMAP.md#online-check-in, P2): what
// the app says about cloud printing, and which actions it offers. Pure and
// Electron-free (test/station.test.cjs); main.js owns the keys, the
// registration and the clicks. The state names are main.js's:
//
//   station: 'off' (not started) | 'refused' (safeStorage cannot keep the key:
//            the station role is refused, fail closed) | 'signed-out' |
//            'waiting' (registration did not go through; retried) | 'ready'
//   history: 'ready' (the history key is open) | 'locked' (never opened on
//            this computer: signing in again from setup opens it) | 'none'
//            (the church has no history key yet)
//   check:   job ids the print server spooled whose outcome is unknown
'use strict';

/** One line for the tooltip / menu header. */
function stationSummary({ station, history, check }) {
  if (station === 'refused') return 'Cloud printing: refused (no safe place for the key)';
  if (station === 'signed-out') return 'Cloud printing: signed out';
  if (station === 'waiting') return 'Cloud printing: waiting to register';
  if (station !== 'ready') return '';
  if (check > 0) return 'Cloud printing: CHECK THE PRINTER';
  if (history === 'locked') return 'Cloud printing: on (history locked)';
  return 'Cloud printing: on';
}

/**
 * Menu items for the print role. `action` names what main.js does on a click.
 * @returns {Array<{ label: string, enabled?: boolean, action?: string }>}
 */
function stationMenuItems({ station, history, check, error }) {
  const items = [];
  if (station === 'refused') {
    items.push({ label: '⚠ This computer cannot be a print station', enabled: false });
    items.push({ label: error ? String(error).slice(0, 110) : 'Windows data protection is not available to this user.', enabled: false });
    return items;
  }
  if (station === 'signed-out') {
    items.push({ label: '⚠ Cloud printing: sign in again...', action: 'wizard' });
    return items;
  }
  if (station === 'waiting') {
    items.push({ label: 'Cloud printing: waiting to register this computer', enabled: false });
    return items;
  }
  if (station !== 'ready') return items;
  items.push({ label: 'Cloud printing: this computer prints the church\'s labels', enabled: false });
  if (check > 0) {
    items.push({
      label: `⚠ Check the printer: ${check === 1 ? 'a label' : `${check} labels`} may not have come out (click when checked)`,
      action: 'clear-check',
    });
  }
  if (history === 'locked') {
    items.push({ label: 'History locked: sign in again from "Set up this computer..."', action: 'wizard' });
  } else if (history === 'none') {
    items.push({ label: 'The church has no history key yet', enabled: false });
  }
  items.push({ label: 'Import laptop history...', enabled: history === 'ready', action: 'import-history' });
  return items;
}

/** The words after an "Import laptop history" run. */
function importResultText(r) {
  if (r && r.ok) {
    if (!r.rows) return 'There was nothing on this laptop to import.';
    return `Imported ${r.rows} record${r.rows === 1 ? '' : 's'} (${r.stored || 0} new, ${r.duplicates || 0} already there). They are sealed: only the church's passphrase opens them.`;
  }
  if (r && r.missing) return 'The sync service cannot take the import yet. Nothing was lost: try again after the next update of the service.';
  return (r && r.error) || 'The import did not work.';
}

module.exports = { stationSummary, stationMenuItems, importResultText };
