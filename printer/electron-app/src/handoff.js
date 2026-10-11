// The sound room app's hand-off (KVBC Awana v9, UNIFIED-APP.md: "its last
// update installs KVBC Awana as a display with its screen, monitor, hours and
// shutdown carried over, then removes Awana Lobby Display").
//
// THE FILE. Awana Lobby Display 2.1.0 (lobby/desktop/main.js, the bridge
// release) writes it just before it runs the KVBC Awana installer silently
// and quits:
//
//   %APPDATA%\awana-label-printer\handoff.json
//
// which is KVBC Awana's own userData folder (electron-builder and Electron
// take that folder from package.json's "name", awana-label-printer, kept
// since the printer's first release so the check-in laptop upgrades in place;
// printer/CLAUDE.md). So the file is where KVBC Awana looks first, on a PC
// that has never run it. Both apps name the folder and the file in a
// constant (HANDOFF_DIR / HANDOFF_FILE); change them together.
//
//   {
//     "kind": "kvbc-awana-handoff", "version": 1, "at": "<ISO time>",
//     "from": { "appId": "org.kvbc.awana-lobby-display", "version": "2.1.0",
//               "userData": "<its userData folder>", "exe": "<its .exe>" },
//     "roles": { "print": false, "display": true },
//     "name": "Sound room",
//     "display": { "settings": { screen, shutdown: { enabled, at } },
//                  "monitor": { id, label, bounds } | null },
//     "startWithWindows": true
//   }
//
// KVBC Awana reads it before anything else (main.js), applies it with
// applyHandoff() below, and renames it handoff.done.json (kept: it is what
// old-app.js reads to remove the old app, and a record of what was carried
// over). Everything in it is checked here: it is a file on disk, not trusted.
'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeSettings } = require('./display/settings');

const HANDOFF_DIR = 'awana-label-printer';
const HANDOFF_FILE = 'handoff.json';
const HANDOFF_DONE_FILE = 'handoff.done.json';
const HANDOFF_KIND = 'kvbc-awana-handoff';
const OLD_APP_ID = 'org.kvbc.awana-lobby-display';
// The display's own files live in this folder of userData (display.js).
const DISPLAY_DIR = 'display';

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

/** A remembered monitor, as displays.js saves one, or null. */
function cleanMonitor(raw) {
  if (!isObj(raw) || !isInt(raw.id) || !isObj(raw.bounds)) return null;
  const b = raw.bounds;
  if (![b.x, b.y, b.width, b.height].every(isInt) || b.width <= 0 || b.height <= 0) return null;
  return {
    id: raw.id,
    label: typeof raw.label === 'string' ? raw.label.slice(0, 200) : '',
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

/** An absolute Windows or POSIX path, or null. */
function cleanPath(v) {
  if (typeof v !== 'string' || !v || v.length > 1024 || /[\u0000-\u001f]/.test(v)) return null;
  return path.win32.isAbsolute(v) || path.posix.isAbsolute(v) ? v : null;
}

/**
 * A checked hand-off, or null when the object is not one.
 * @returns {null | { name: string, settings: object, monitor: object | null, startWithWindows: boolean, from: { version: string, userData: string | null, exe: string | null } }}
 */
function parseHandoff(raw) {
  if (!isObj(raw) || raw.kind !== HANDOFF_KIND || raw.version !== 1) return null;
  if (!isObj(raw.roles) || raw.roles.display !== true) return null;
  const from = isObj(raw.from) ? raw.from : {};
  if (from.appId !== undefined && from.appId !== OLD_APP_ID) return null;
  const display = isObj(raw.display) ? raw.display : {};
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    settings: normalizeSettings(display.settings),
    monitor: cleanMonitor(display.monitor),
    startWithWindows: raw.startWithWindows !== false,
    from: {
      version: typeof from.version === 'string' ? from.version.slice(0, 32) : '',
      userData: cleanPath(from.userData),
      exe: cleanPath(from.exe),
    },
  };
}

const handoffPath = (userData) => path.join(userData, HANDOFF_FILE);
const handoffDonePath = (userData) => path.join(userData, HANDOFF_DONE_FILE);

/** The pending hand-off in this userData folder, parsed, or null. */
function readHandoff(userData) {
  try {
    return parseHandoff(JSON.parse(fs.readFileSync(handoffPath(userData), 'utf8')));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Applies a parsed hand-off to the files (the display's state.json, the old
 * app's browser profile) and marks it done. The caller sets the roles and
 * Start with Windows (roles.js / config-store.js own those files).
 *
 * - state.json: the screen, hours, shutdown and monitor, with quietRelaunch
 *   set, because the installer's relaunch has no --auto-start and would
 *   otherwise read as a person opening the app (a three-hour Show).
 * - The old app's `persist:lobby` profile (Partitions/lobby: the screens'
 *   sign-in, their own settings and offline copies) is copied over, unless
 *   this app already has one: the screen comes up signed in, as it was.
 *
 * Never throws; returns what it did.
 */
function applyHandoff(userData, handoff, { cpSync = fs.cpSync } = {}) {
  const done = { applied: false, state: false, profile: 'skipped', error: null };
  try {
    const displayDir = path.join(userData, DISPLAY_DIR);
    const statePath = path.join(displayDir, 'state.json');
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(statePath, 'utf8')) || {}; } catch { /* none yet */ }
    writeJsonAtomic(statePath, {
      ...existing,
      display: handoff.monitor || existing.display || null,
      overrides: { hiddenForWindow: null, manualUntil: 0 },
      settings: handoff.settings,
      quietRelaunch: true,
    });
    done.state = true;

    const from = handoff.from.userData ? path.join(handoff.from.userData, 'Partitions', 'lobby') : null;
    const to = path.join(userData, 'Partitions', 'lobby');
    if (from && fs.existsSync(from) && !fs.existsSync(to)) {
      try {
        cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
        done.profile = 'copied';
      } catch (e) {
        done.profile = `failed: ${e && e.message ? e.message : e}`;
      }
    } else if (fs.existsSync(to)) {
      done.profile = 'kept this app\'s own';
    }

    let raw = {};
    try { raw = JSON.parse(fs.readFileSync(handoffPath(userData), 'utf8')) || {}; } catch { /* gone meanwhile */ }
    writeJsonAtomic(handoffDonePath(userData), {
      ...raw,
      appliedAt: new Date().toISOString(),
      profile: done.profile,
      oldAppRemoved: false,
    });
    try { fs.unlinkSync(handoffPath(userData)); } catch { /* already gone */ }
    done.applied = true;
  } catch (e) {
    done.error = e && e.message ? e.message : String(e);
  }
  return done;
}

/** The applied hand-off record (handoff.done.json), or null. */
function readHandoffDone(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(handoffDonePath(userData), 'utf8'));
    return isObj(raw) ? raw : null;
  } catch {
    return null;
  }
}

function markOldAppRemoved(userData, result) {
  const raw = readHandoffDone(userData);
  if (!raw) return;
  try {
    writeJsonAtomic(handoffDonePath(userData), { ...raw, oldAppRemoved: result.removed === true, oldAppRemoval: { ...result, at: new Date().toISOString() } });
  } catch { /* the next start tries again */ }
}

module.exports = {
  HANDOFF_DIR,
  HANDOFF_FILE,
  HANDOFF_DONE_FILE,
  HANDOFF_KIND,
  OLD_APP_ID,
  DISPLAY_DIR,
  parseHandoff,
  readHandoff,
  applyHandoff,
  readHandoffDone,
  markOldAppRemoved,
  handoffPath,
};
