// What this computer is (KVBC Awana v9, UNIFIED-APP.md): a print server, a
// display, or both, its name, and whether the first-run wizard is done.
// Electron-free, like config-store.js, so it is tested without booting
// Electron (test/roles.test.cjs).
//
// roles.json in userData: { print, display, name, setupDone, deviceId? }.
// `deviceId` is this computer's id in the sync Worker's screen registry
// (device-sync.js, kind 'computer'): made once, the first time it registers,
// and kept here so a reinstall over the same userData stays the same row on
// /settings.
//
// WHERE A COMPUTER'S ROLES COME FROM, the first time v9 starts on it:
//   1. a roles.json already there: that, whatever else is on disk;
//   2. the sound room app's hand-off (handoff.js): a display, setup done;
//   3. printer data already in userData (an upgrade of the check-in laptop
//      from Club Label Printer 8.x, which kept its userData because the
//      appId and "name" never changed): a print server, display OFF, setup
//      done. Owner, 2026-10-11: the check-in laptop never shows the wizard or
//      the display;
//   4. nothing: a new install. No role yet, and the wizard opens.
// The decision is written at once, so the next start reads rule 1 and never
// guesses again (the print server's own files appear later on a new install
// and must not turn it into a print server behind the wizard's back).
//
// THE HOOK FOR /settings (UNIFIED-APP.md: "each computer registers as a
// device, kind `computer`"): this file is the one record of a computer's
// roles and name. main.js applies a change live through applyRoles(): the
// wizard, IPC 'roles:set' and the /settings registration (device-sync.js) all
// take that one path. Nothing here talks to the network.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROLES_FILE = 'roles.json';
const NAME_MAX = 60;
// The Worker's screen id (lobby/src/lib/syncSpecs.js isScreenId).
const DEVICE_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const isDeviceId = (v) => typeof v === 'string' && DEVICE_ID_RE.test(v);

// Files only the print server (or the printer app's own extension sync)
// writes into userData. Chromium's own folders (Local State, Partitions,
// Cache, ...) appear on ANY Electron start, so they say nothing.
const PRINTER_DATA = [
  'config.json',
  'config.json.bak',
  'clubbers.csv',
  'print-history.json',
  'attendance.json',
  'events-buffer.json',
  'chrome-extension',
  '.migrated-from-script-install',
];

/** One line, trimmed, at most NAME_MAX characters, no control characters. */
function cleanName(value) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

/** A roles object from anything; never throws. `deviceId` only when there is a good one. */
function normalizeRoles(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {
    print: r.print === true,
    display: r.display === true,
    name: cleanName(r.name),
    setupDone: r.setupDone === true,
  };
  if (isDeviceId(r.deviceId)) out.deviceId = r.deviceId;
  return out;
}

/** 16 random bytes, url-safe (22 characters): the lobby's newScreenId(). */
function newDeviceId() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * The roles with a deviceId, made and written once when there is none.
 * @returns {ReturnType<typeof normalizeRoles>}
 */
function ensureDeviceId(dir, roles) {
  const r = normalizeRoles(roles);
  if (r.deviceId) return r;
  return writeRoles(dir, { ...r, deviceId: newDeviceId() });
}

const rolesPath = (dir) => path.join(dir, ROLES_FILE);

function readRolesFile(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return normalizeRoles(parsed);
  } catch {
    return null;
  }
}

/**
 * The saved roles, or null when there are none. A damaged file is read from
 * its backup (every write keeps the one it replaces as roles.json.bak): a
 * display-only computer also has a config.json (Start with Windows lives
 * there), so a lost roles.json must not read as "printer data, a print server".
 */
function readRoles(dir) {
  return readRolesFile(rolesPath(dir)) || readRolesFile(`${rolesPath(dir)}.bak`);
}

/** tmp + fsync + rename, so a power cut never leaves half a file. */
function writeRoles(dir, roles) {
  const clean = normalizeRoles(roles);
  fs.mkdirSync(dir, { recursive: true });
  const file = rolesPath(dir);
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(clean, null, 2), null, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try { if (readRolesFile(file)) fs.copyFileSync(file, `${file}.bak`); } catch { /* best effort */ }
  fs.renameSync(tmp, file);
  return clean;
}

/** Whether a Club Label Printer install has already lived in this folder. */
function hasPrinterData(dir) {
  return PRINTER_DATA.some((name) => {
    try { return fs.existsSync(path.join(dir, name)); } catch { return false; }
  });
}

/**
 * The roles to start with, and where they came from (see the top of the file).
 * `handoff` is a parsed hand-off (handoff.js) or null.
 * @returns {{ roles: ReturnType<typeof normalizeRoles>, source: 'file' | 'handoff' | 'printer-upgrade' | 'new', write: boolean }}
 */
function decideStartRoles({ saved, handoff, printerData }) {
  if (saved && handoff) {
    // KVBC Awana was already here (a test install, or a second run of the
    // hand-off): the display is turned on, everything else kept.
    if (saved.display) return { roles: saved, source: 'file', write: false };
    return { roles: normalizeRoles({ ...saved, display: true, setupDone: true, name: saved.name || handoff.name }), source: 'handoff', write: true };
  }
  if (saved) return { roles: saved, source: 'file', write: false };
  if (handoff) {
    return { roles: normalizeRoles({ print: false, display: true, name: handoff.name, setupDone: true }), source: 'handoff', write: true };
  }
  if (printerData) {
    return { roles: normalizeRoles({ print: true, display: false, name: '', setupDone: true }), source: 'printer-upgrade', write: true };
  }
  return { roles: normalizeRoles({ print: false, display: false, name: '', setupDone: false }), source: 'new', write: true };
}

/**
 * A change asked for (the wizard, later /settings), checked. At least one role
 * once setup is done; turning print off is refused while the print server is
 * printing (UNIFIED-APP.md: "turning off a print server is refused while it
 * is printing").
 * @returns {{ ok: true, roles: object } | { ok: false, error: string }}
 */
function checkRolesChange(current, patch, { printing = false } = {}) {
  const p = patch && typeof patch === 'object' ? patch : {};
  const next = normalizeRoles({
    print: typeof p.print === 'boolean' ? p.print : current.print,
    display: typeof p.display === 'boolean' ? p.display : current.display,
    name: typeof p.name === 'string' ? p.name : current.name,
    setupDone: typeof p.setupDone === 'boolean' ? p.setupDone : current.setupDone,
    // Never changed by a patch: the computer's row on /settings.
    deviceId: current.deviceId,
  });
  if (next.setupDone && !next.print && !next.display) {
    return { ok: false, error: 'Choose at least one: print server or display.' };
  }
  if (current.print && !next.print && printing) {
    return { ok: false, error: 'This computer is printing right now. Try again when it is done.' };
  }
  return { ok: true, roles: next };
}

module.exports = {
  ROLES_FILE,
  NAME_MAX,
  PRINTER_DATA,
  isDeviceId,
  newDeviceId,
  ensureDeviceId,
  cleanName,
  normalizeRoles,
  readRoles,
  writeRoles,
  hasPrinterData,
  decideStartRoles,
  checkRolesChange,
};
