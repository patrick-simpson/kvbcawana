'use strict';
// Data directory, config.json, church config.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const events  = require('../events');
const fs    = require('fs');
const path  = require('path');
const SERVER_DIR = path.join(__dirname, '..'); // print-server/, where server.js lives

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  cachedStore: { enumerable: true, get: () => cachedStore },
  cacheStore: { enumerable: true, get: () => cacheStore },
  churchConfig: { enumerable: true, get: () => churchConfig },
  cloudStation: { enumerable: true, get: () => cloudStation, set: (v) => { cloudStation = v; } },
  config: { enumerable: true, get: () => config },
  CONFIG_FILE: { enumerable: true, get: () => CONFIG_FILE },
  configFileDamaged: { enumerable: true, get: () => configFileDamaged },
  CSV_FILE: { enumerable: true, get: () => CSV_FILE },
  CUPS_BACKEND: { enumerable: true, get: () => CUPS_BACKEND },
  DATA_DIR: { enumerable: true, get: () => DATA_DIR },
  dataSaveWarning: { enumerable: true, get: () => dataSaveWarning },
  EVENT_CHANNEL: { enumerable: true, get: () => EVENT_CHANNEL },
  fileStamp: { enumerable: true, get: () => fileStamp },
  loadConfigFile: { enumerable: true, get: () => loadConfigFile },
  PORT: { enumerable: true, get: () => PORT },
  PRINTER_NAME: { enumerable: true, get: () => PRINTER_NAME },
  saveFileAtomic: { enumerable: true, get: () => saveFileAtomic },
  SERVER_VERSION: { enumerable: true, get: () => SERVER_VERSION },
  setPrinterName: { enumerable: true, get: () => setPrinterName },
  writeConfigFile: { enumerable: true, get: () => writeConfigFile },
});

// The Raspberry Pi print station (ROADMAP.md#cloud-check-in) prints through CUPS. It is
// an explicit opt-in its service sets, never inferred from the OS: the test
// suites run on Linux with a stand-in `powershell`, and the Windows app is
// untouched either way.
const CUPS_BACKEND = process.env.AWANA_PRINT_BACKEND === 'cups';

// 3456 is the port the extension and the app all
// hardcode, so it stays the default. AWANA_PORT exists only so the test suite
// can bind somewhere else without colliding with a real install on the machine.
const PORT         = Number(process.env.AWANA_PORT) || 3456;
// `let`, not `const`: the Electron shell requires this module once and the
// require cache keeps it alive across settings changes, so an env-var-only
// printer name would be frozen at whatever it was on FIRST load — which is
// empty when the server now starts before first-time setup. setPrinterName()
// lets the shell push the newly saved printer into the live module.
let PRINTER_NAME = process.env.PRINTER_NAME || '';
function setPrinterName(name) {
  PRINTER_NAME = (name == null ? '' : String(name)).trim();
}
const SERVER_VERSION = require('../package.json').version;

// ── Writable data directory ───────────────────────────────────────────────────
// All files the server WRITES (config, clubbers.csv, history, attendance,
// event buffer) live here. Defaults to the script directory for legacy script
// installs; the Electron shell sets AWANA_DATA_DIR to its userData folder
// because a packaged app must never write inside resources/.
const DATA_DIR = process.env.AWANA_DATA_DIR || SERVER_DIR;
const CSV_FILE = path.join(DATA_DIR, 'clubbers.csv');

// ── Load configuration ────────────────────────────────────────────────────────
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const CONFIG_BAK = CONFIG_FILE + '.bak';
// Why config.json could not be read, for /health; null while it is fine.
let configFileDamaged = null;

// config.json holds the PIN, the display key, the sync sign-in and the
// schedule, and has several writers (this server and the Electron app). Until
// 7.11.1 this server wrote it in place, so a crash or a power cut mid-write
// left a truncated file that read as "no config"; the Electron wizard then
// merged its three keys over {} and every secret was gone, and every settings
// save here threw until someone fixed the file by hand. Now: every write is
// tmp + fsync + rename and keeps the previous good file as config.json.bak;
// a read that fails restores that backup; a file that cannot be read and has
// no usable backup is moved aside, never written over, so what it held can
// still be copied back.
function isConfigShape(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function loadConfigFile() {
  let raw = null;
  try { raw = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : null; } catch (e) { raw = ''; }
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (isConfigShape(parsed)) return parsed;
  } catch (e) { /* damaged: recover below */ }
  try {
    const bak = JSON.parse(fs.readFileSync(CONFIG_BAK, 'utf8'));
    if (isConfigShape(bak)) {
      fs.copyFileSync(CONFIG_BAK, CONFIG_FILE);
      configFileDamaged = 'config.json could not be read and was restored from config.json.bak (the settings as of the save before last). Check Settings.';
      console.warn('[config] ' + configFileDamaged);
      return bak;
    }
  } catch (e) { /* no usable backup */ }
  const aside = `${CONFIG_FILE}.damaged-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  try { fs.renameSync(CONFIG_FILE, aside); } catch (e) { /* leave it; the next write replaces it */ }
  configFileDamaged = `config.json could not be read and no backup was usable; it was moved to ${path.basename(aside)}. The PIN, display key and sync sign-in must be set again, or copied back from that file.`;
  console.error('[config] ' + configFileDamaged);
  return {};
}

// Windows: Defender or the indexer can hold the target for a moment.
function renameWithRetrySync(from, to) {
  for (let attempt = 1; ; attempt++) {
    try { fs.renameSync(from, to); return; } catch (e) {
      if (attempt >= 6 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
    }
  }
}

// Every data file (the history, the attendance ledger, the leaders, the
// event buffer, the deck, the shared settings, the roster) is written the
// same way: tmp, fsync, rename with retries. A save that still fails is
// remembered by file name and shown on the dashboard through /health until
// the next save of that file succeeds; before this a full disk, a locked
// folder or a permissions change was one console line nobody saw while the
// history, and with it tonight's count and the reprint list, silently went
// nowhere. Returns true when the file is on disk.
const dataSaveFailures = new Map();
function saveFileAtomic(file, text, label = path.basename(file)) {
  const tmp = file + '.tmp';
  try {
    const fd = fs.openSync(tmp, 'w');
    try { fs.writeSync(fd, text, null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    renameWithRetrySync(tmp, file);
    dataSaveFailures.delete(label);
    return true;
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* nothing to remove */ }
    dataSaveFailures.set(label, { message: e.message, at: Date.now() });
    console.warn(`[data] Could not save ${label}: ${e.message}`);
    return false;
  }
}
// The stores stay in memory. print-history.json and attendance.json were read
// from disk and parsed on nearly every request (the print path several times,
// the dashboard every 15 s, every phone every 12 s). A store is re-read only
// when the file on disk is not the one last read or written here (its size or
// modification time moved: a hand edit, another process), which costs one
// stat() instead of a read and a parse.
const storeCache = new Map();   // file → { stamp, value }
function fileStamp(file) {
  try { const st = fs.statSync(file); return `${st.mtimeMs}:${st.size}`; } catch (e) { return 'missing'; }
}
function cachedStore(file, read) {
  const stamp = fileStamp(file);
  const hit = storeCache.get(file);
  if (hit && hit.stamp === stamp) return hit.value;
  const value = read();
  storeCache.set(file, { stamp, value });
  return value;
}
// A save through saveFileAtomic is what the cache holds next, so the write is
// never followed by a read of what was just written.
function cacheStore(file, value) {
  storeCache.set(file, { stamp: fileStamp(file), value });
}

function dataSaveWarning() {
  if (!dataSaveFailures.size) return null;
  const names = [...dataSaveFailures.keys()].sort();
  const first = dataSaveFailures.get(names[0]);
  return {
    type: 'dataSave',
    message: `${names.join(', ')} could not be saved (${first.message}). Labels still print, but what ${names.length === 1 ? 'it records' : 'they record'} is being lost: check the data folder's disk space and permissions.`,
  };
}

function writeConfigFile(next) {
  const tmp = CONFIG_FILE + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(next, null, 2), null, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  // The file being replaced is the last good one: it becomes the backup.
  try { if (fs.existsSync(CONFIG_FILE)) fs.copyFileSync(CONFIG_FILE, CONFIG_BAK); } catch (e) { /* best effort */ }
  renameWithRetrySync(tmp, CONFIG_FILE);
}

let config = loadConfigFile();
// Online check-in, P2 (see configureCloud() below): set once the app has made
// this computer a registered print station. null = the old paths only.
let cloudStation = null;

// Install the display key into the publisher. The three name-bearing events
// (checkin, recap, birthdays) are sealed with it so the live channel
// carries ciphertext instead of children's first names — see the sealed-envelope
// block in events.js. With no key set the publisher stays plaintext, which is
// what makes the rollout safe in either order; /health says which mode we are in
// so "am I actually encrypted?" is answerable rather than assumed.
if (events.setDisplayKey(config.displayKey)) {
  console.log(`[realtime] Display key loaded (kid ${events.getDisplayKeyState().kid}) — names are encrypted on the channel`);
} else if (config.displayKey) {
  console.warn('[realtime] config.displayKey is INVALID — names will be published in the clear until it is fixed');
} else {
  console.warn('[realtime] No display key set — children\'s first names are published UNENCRYPTED on the live channel. Sign this computer in to the sync service (awana.kvbchurch.org/settings → Printing → At the laptop → This laptop’s sign-in).');
}


// ── Church configuration ──────────────────────────────────────────────────────
// Per-church knobs (check-in URL, club-night windows, event-bus channel) live
// in church-config.json next to this script. Baked KVBC defaults keep the
// server fully functional when the file is missing or malformed, and let a
// fork swap churches by editing one JSON file instead of source.
// Prefer a church-config.json in the data dir (survives app updates); fall
// back to the copy shipped next to this script.
const CHURCH_CONFIG_FILE = fs.existsSync(path.join(DATA_DIR, 'church-config.json'))
  ? path.join(DATA_DIR, 'church-config.json')
  : path.join(SERVER_DIR, 'church-config.json');
const CHURCH_DEFAULTS = {
  churchName: 'KVBC Church',
  subdomain: 'kvbchurch',
  checkinUrl: 'https://kvbchurch.twotimtwo.com/clubber/checkin',
  pusherChannel: 'awana-channel',
  sharesClubIds: [2, 3, 4, 5, 6],
  clubNights: [{ dow: 3, start: '17:30', end: '20:00' }],
  canaryLeadMinutes: 20,
  // Origins allowed to POST /api/lobby-slides (with the publish token) — the
  // deployed display app, so its slide editor's "Publish to all displays"
  // button can reach this server from the check-in machine's own browser.
  // Exact origins only; a fork edits this like every other church knob. Both
  // homes of the display are listed until switch day (ROADMAP.md#switch-day-cleanup): the old
  // github.io site and awana.kvbchurch.org, so a screen on either can publish.
  displayOrigins: ['https://patrick-simpson.github.io', 'https://awana.kvbchurch.org'],
};
let churchConfig = { ...CHURCH_DEFAULTS };
try {
  if (fs.existsSync(CHURCH_CONFIG_FILE)) {
    Object.assign(churchConfig, JSON.parse(fs.readFileSync(CHURCH_CONFIG_FILE, 'utf8')));
    console.log(`[church] Loaded church-config.json (${churchConfig.churchName})`);
  }
} catch (e) {
  console.warn('[church] Failed to load church-config.json — using baked defaults:', e.message);
}
// (The key keeps its old name: church-config.json files in the field carry it.)
const EVENT_CHANNEL = churchConfig.pusherChannel || 'awana-channel';
