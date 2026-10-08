// Club Label Print Server
// Started by install-and-run.ps1 — listens on http://localhost:3456
// Accepts POST /print and silently prints a 4×2 in label as PNG via canvas.

'use strict';

// ── Process-level safety net ──────────────────────────────────────────────────
// Last line of defence: if something unexpected bubbles all the way up, log it
// but NEVER crash the process — a live event cannot afford a dead print server.
process.on('uncaughtException',  err => console.error('[fatal] Uncaught exception (server kept alive):', err));
process.on('unhandledRejection', err => console.error('[fatal] Unhandled rejection (server kept alive):', err));

const express = require('express');
const Pusher  = require('pusher');
const events  = require('./events');
const feeds   = require('./feeds');
// The whole trust model (loopback vs LAN vs the open web, PIN handling, origin
// allowlist, bind host) lives in one pure module so it can be unit-tested.
const security = require('./security');
// @napi-rs/canvas ships prebuilt N-API binaries, so the same node_modules
// works under plain Node AND inside a packaged Electron app — the old `canvas`
// package needed an ABI-matched native build and silently broke when embedded.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
// The catalog brand kit (fonts + official one-colour club marks) the label is
// set in. Loaded on require; every piece of it fails open — see brand.js.
const brand = require('./brand');
const syncClient = require('./sync-client');
const phoneRelay = require('./phone-relay');
const pickup = require('./pickup');
const { execFile } = require('child_process');
const http  = require('http');
const https = require('https');
const crypto = require('crypto');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

// 3456 is the port the extension, the bookmarklet and the installer all
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
const SERVER_VERSION = require('./package.json').version;

// ── Writable data directory ───────────────────────────────────────────────────
// All files the server WRITES (config, clubbers.csv, history, attendance,
// event buffer) live here. Defaults to the script directory for legacy script
// installs; the Electron shell sets AWANA_DATA_DIR to its userData folder
// because a packaged app must never write inside resources/.
const DATA_DIR = process.env.AWANA_DATA_DIR || __dirname;
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

// Install the display key into the publisher. The three name-bearing events
// (checkin, recap, birthdays) are sealed with it so the PUBLIC Pusher channel
// carries ciphertext instead of children's first names — see the sealed-envelope
// block in events.js. With no key set the publisher stays plaintext, which is
// what makes the rollout safe in either order; /health says which mode we are in
// so "am I actually encrypted?" is answerable rather than assumed.
if (events.setDisplayKey(config.displayKey)) {
  console.log(`[realtime] Display key loaded (kid ${events.getDisplayKeyState().kid}) — names are encrypted on the channel`);
} else if (config.displayKey) {
  console.warn('[realtime] config.displayKey is INVALID — names will be published in the clear until it is fixed');
} else {
  console.warn('[realtime] No display key set — children\'s first names are published UNENCRYPTED on a public channel. Generate one in the dashboard (Realtime).');
}

// Display login: one church passphrase provisions every screen with the key
// above (and the slides publish token) over a Pusher cache channel — see the
// display-login block in events.js and publishProvision() below.
if (events.setDisplayLogin(config.displayLoginPassphrase, config.displayLoginSalt)) {
  console.log(`[login] Display login configured (kid ${events.getDisplayLoginState().kid}) — screens can log in with the passphrase`);
} else if (config.displayLoginPassphrase) {
  console.warn('[login] config.displayLoginPassphrase is INVALID (12–128 characters, with its salt) — screens cannot log in until it is fixed');
}

// Brute-force protection for the phone PIN. Lives at module scope so the
// failure counts survive across requests but not across restarts — a restart
// mid-event must never leave a volunteer locked out.
const pinLimiter = security.createPinLimiter();

// ── Church configuration ──────────────────────────────────────────────────────
// Per-church knobs (check-in URL, club-night windows, event-bus channel) live
// in church-config.json next to this script. Baked KVBC defaults keep the
// server fully functional when the file is missing or malformed, and let a
// fork swap churches by editing one JSON file instead of source.
// Prefer a church-config.json in the data dir (survives app updates); fall
// back to the copy shipped next to this script.
const CHURCH_CONFIG_FILE = fs.existsSync(path.join(DATA_DIR, 'church-config.json'))
  ? path.join(DATA_DIR, 'church-config.json')
  : path.join(__dirname, 'church-config.json');
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
  // homes of the display are listed until switch day (SWITCH.md): the old
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
const EVENT_CHANNEL = churchConfig.pusherChannel || 'awana-channel';
// Device provisioning rides a separate CACHE channel so a screen that has just
// been switched on receives the last frame at once (see publishProvision()).
const PROVISION_CHANNEL = events.provisionChannelFor(EVENT_CHANNEL);

const PUSHER_TIMEOUT_MS = 10000;
const pusher = (config.pusherAppId && config.pusherKey && config.pusherSecret)
  ? new Pusher({
      appId:   config.pusherAppId,
      key:     config.pusherKey,
      secret:  config.pusherSecret,
      cluster: config.pusherCluster || 'us2',
      // The REST publish has no timeout of its own: with the internet down
      // but DNS up, each trigger() hung for the socket's two minutes and the
      // publisher's await chain hung with it. Ten seconds is generous for one
      // small frame; a frame that misses it is lost the way a dropped one is
      // (the recap carries the check-in two minutes later).
      timeout: PUSHER_TIMEOUT_MS,
    })
  : null;

// Tell the event module the truth at STARTUP rather than letting it infer
// "configured" from the first publish. /health's privacy banner keys off this,
// and a church with a screen but no display key has to be warned before the
// first child checks in — not after their name has already gone out plaintext.
events.setPublisherConfigured(Boolean(pusher));

if (pusher) {
  console.log(`[pusher] Initialized with App ID: ${config.pusherAppId}`);
} else {
  console.log('[pusher] Not configured (Joyful Welcome Screen disabled)');
}

// ── Tonight's event buffer ────────────────────────────────────────────────────
// The last ~50 checkin events, persisted so a mid-event server restart doesn't
// lose the recap replay window. Only today's events survive a reload.
// "Today" for a club night is the OPERATOR'S LOCAL calendar day. The UTC day
// flips at 7pm EST / 6pm CST — the middle of a winter club night — so any
// "today" derived from toISOString() splits one physical night in two:
// attendance streaks break, tonight's stats drop the early arrivals at the
// boundary, and opening-night connect-card gating misfires. Every today/
// tonight comparison below goes through these two helpers (the same local-day
// discipline the extension's todayIsoDate() has always used).
function localDayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Whole calendar days from one local day (YYYY-MM-DD) to another, zone-free:
// the two days' civil dates, never two Dates subtracted, because across
// spring-forward fourteen calendar days are 13.96 twenty-four-hour spans.
function calendarDaysBetween(fromDay, toDay) {
  const parse = (d) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d || ''));
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
  };
  return Math.round((parse(toDay) - parse(fromDay)) / 86400000);
}
function isOnLocalDay(isoTimestamp, localDay) {
  if (typeof isoTimestamp !== 'string') return false;
  const t = new Date(isoTimestamp);
  return !Number.isNaN(t.getTime()) && localDayISO(t) === localDay;
}

const EVENT_BUFFER_FILE = path.join(DATA_DIR, 'events-buffer.json');
const EVENT_BUFFER_MAX = 50;
let eventBuffer = [];
try {
  if (fs.existsSync(EVENT_BUFFER_FILE)) {
    const raw = JSON.parse(fs.readFileSync(EVENT_BUFFER_FILE, 'utf8'));
    const today = localDayISO();
    if (Array.isArray(raw)) {
      eventBuffer = raw.filter(e => e && typeof e.at === 'string' && isOnLocalDay(e.at, today));
      if (eventBuffer.length) console.log(`[events] Restored ${eventBuffer.length} checkin event(s) from tonight's buffer`);
    }
  }
} catch (e) { /* corrupt buffer — start fresh */ }

// The recap is TONIGHT's check-ins. The buffer was filtered to today only
// when it was restored at startup, so in a process that ran from one club
// night into the next (the laptop is rarely restarted) last week's children
// were replayed onto the screens all through the following evening until
// the 50-entry cap pushed them out. Pure, so a test can hand it yesterday.
function recapEntriesForTonight(buffer, today = localDayISO()) {
  return (Array.isArray(buffer) ? buffer : []).filter((e) => e && typeof e.at === 'string' && isOnLocalDay(e.at, today));
}
function pruneEventBuffer() {
  const kept = recapEntriesForTonight(eventBuffer);
  if (kept.length !== eventBuffer.length) eventBuffer = kept;
}

function pushEventToBuffer(checkinEvent) {
  pruneEventBuffer();
  eventBuffer.push(checkinEvent);
  if (eventBuffer.length > EVENT_BUFFER_MAX) eventBuffer.splice(0, eventBuffer.length - EVENT_BUFFER_MAX);
  saveFileAtomic(EVENT_BUFFER_FILE, JSON.stringify(eventBuffer));
}

// ── Print-failure tracking ────────────────────────────────────────────────────
// The server used to record only successes; a jammed printer was invisible
// beyond the extension's toast. Failures now land in history (ok:false), in
// this in-memory list for the dashboard, and on the event bus as an `ops`
// event (type/club/at only — never a name on Pusher).
const printFailures = [];  // { name, club, at, error } — name stays LOCAL only
const PRINT_FAILURES_MAX = 20;

function recordPrintFailure(name, club, error) {
  printFailures.unshift({ name, club: club || '', at: new Date().toISOString(), error: String(error || '').slice(0, 200) });
  if (printFailures.length > PRINT_FAILURES_MAX) printFailures.length = PRINT_FAILURES_MAX;
  events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('print-failure', club));
}

// ── Selector self-test + canary state ────────────────────────────────────────
let lastSelfTest = null;   // { ok, results, extensionVersion, at } — posted by the extension
let lastContractCanary = null; // { ok, results, extensionVersion, manual, at } — full daily sweep (#3)
// Version skew (#7): the RUNNING extension version, as the extension itself
// last reported it (every /selftest and /contract-canary post carries one).
// The app knows what it SYNCED to disk (extensionInfo.version); Chrome keeps
// running the old code until it restarts, and only the extension's own posts
// reveal which version is actually live in the browser.
let lastExtensionReport = null; // { version, at (ms) }
function recordExtensionReport(version) {
  const v = String(version || '').trim();
  if (/^\d+\.\d+\.\d+$/.test(v)) lastExtensionReport = { version: v, at: Date.now() };
}
// The Electron shell registers a handler here to surface operator alerts as
// tray/system notifications (contract drift, and anything else that must not
// wait for someone to open the dashboard). No-op when running headless.
let opsAlertHandler = null;
function setOpsAlertHandler(fn) { opsAlertHandler = typeof fn === 'function' ? fn : null; }
function fireOpsAlert(title, body) {
  try { if (opsAlertHandler) opsAlertHandler({ title, body }); } catch (e) { /* alerts never break serving */ }
}
let lastCanary   = null;   // { at, stages } — result of the last POST /canary

// ── Label geometry (1 pt = 1/72 inch) ────────────────────────────────────────
const PAGE_W  = 4 * 72;  // 288 pt
const PAGE_H  = 2 * 72;  // 144 pt
const INSET   = 6;        // badge margin from page edge
const BX = INSET, BY = INSET;
const BW = PAGE_W - INSET * 2;   // badge width  (276 pt)
const BH = PAGE_H - INSET * 2;   // badge height (132 pt)
const CORNER = 12;

// Columns (when icon is present)
const ICON_COL_W  = 84;                // left icon zone width
const DIVIDER_X   = BX + ICON_COL_W;
const TEXT_X      = DIVIDER_X + 8;    // right text zone start
const TEXT_W      = BX + BW - TEXT_X; // right text zone width

// No-photo edge bar (owner, 2026-10-02): a child who may not be photographed
// gets a solid bar down the label's right edge as well as the crossed-out
// camera, so a photographer spots it at a glance, from across a room or in a
// viewfinder, without reading the icon row. 1/8 inch, top to bottom, flush
// with the paper's edge, in the label's ink (black, or white on an inverted
// label, where black would vanish). Everything else on the label keeps
// NO_PHOTO_BAR_GAP clear of it: the badge's content edge moves in by
// NO_PHOTO_CUT.
const NO_PHOTO_BAR_W   = 9;   // 1/8 inch
const NO_PHOTO_BAR_GAP = 4;
const NO_PHOTO_CUT     = (BX + BW) - (PAGE_W - NO_PHOTO_BAR_W - NO_PHOTO_BAR_GAP);  // 7 pt

// The first name in the kit's shout face (Paytone One), as multiples of its
// size. Where the ink lands is measured off the canvas at a 'top' baseline (the
// line's origin is the top of the em box the canvas picks for it):
//   Paytone One   ascenders 0.20, capitals 0.26, baseline 0.96, g j p q y to 1.16
//   Galindo       ascenders 0.09, capitals 0.11, baseline 0.84,           to 1.15
//   the old faces the whole line inside the box (1.0)
// So Paytone's ink sits about 0.15 lower in its box than Galindo's did, and
// its descenders are shallower. The name is drawn NAME_LIFT_BRAND above the
// box's top, which puts the capitals back where Galindo's were (0.11), and the
// line box then runs to just past the deepest ordinary descender
// (1.16 - 0.15 = 1.01) with a little air, so the last name below it keeps the
// same gap it always had. The old Windows faces keep neither number: they
// draw where they always did.
const NAME_LINE_H_BRAND = 1.06;
const NAME_LIFT_BRAND = 0.15;
// How close to the paper's top edge the first name's ink may rise, in pt. A
// mark that stands above the capitals (É, Ấ) needs room above the name; the
// block only pays for the part of that room the paper above it cannot give
// (see the name block in generateLabel). 4 pt is as close as 6.17.0 ever
// printed a name (Galindo's É), so it is a margin already proven on the paper.
const NAME_INK_TOP = 4;
// The most, in pt, a name gives up BELOW its 18 pt floor so that the room a mark
// above it or a comma below it asks for does not add to the crowding at the
// bottom of the label (see the height-fit in generateLabel).
const NAME_ROOM_SHRINK_MAX = 4;

// The icon column's right edge: the catalog's wave instead of a ruled line. A
// slow, slightly irregular S sampled from the approved mockup — [fraction of
// the badge height, offset in pt from DIVIDER_X] — drawn as one smooth curve
// through the points (Catmull-Rom as cubic Béziers). The mockup's swing is
// about ±1.3 pt; it is drawn half as deep again so it still reads as a wave on
// a 300 dpi thermal print, and it never comes within 6 pt of the text column.
const ICON_WAVE = Object.freeze([
  [0, -1.5], [0.13, 0.3], [0.30, -1.35], [0.48, 1.65], [0.70, -0.3], [0.86, 1.95], [1, -0.9],
]);
const ICON_WAVE_MAX_DX = Math.max(...ICON_WAVE.map(([, dx]) => Math.abs(dx)));
// Adds the edge from the top of the badge to the bottom to the current path;
// `start` begins a new subpath there, otherwise the edge continues the path.
function traceIconWave(ctx, top, height, start) {
  const pts = ICON_WAVE.map(([t, dx]) => [DIVIDER_X + dx, top + t * height]);
  if (start) ctx.moveTo(pts[0][0], pts[0][1]);
  else ctx.lineTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
      p2[0], p2[1]);
  }
}

// ── In-memory CSV snapshot ────────────────────────────────────────────────────
// Populated at startup and refreshed on every POST /print so changes to
// clubbers.csv (e.g. added mid-event) are picked up automatically.
let clubbers = [];

// ── CSV parser ────────────────────────────────────────────────────────────────
// Parses a raw CSV string into an array of plain objects keyed by canonical
// field names.  Handles both the TwoTimTwo export (quoted fields, spaces in
// headers like "First Name") and the manual clubbers-template.csv format
// ("FirstName").  Returns [] on empty input or any parse error — never throws.

// Map every known header variation to a canonical key.
// Add new mappings here if TwoTimTwo ever renames a column.
const HEADER_MAP = {
  // canonical ← variations (all compared lowercase, spaces/underscores stripped)
  'firstname':      'FirstName',
  'first name':     'FirstName',
  'first_name':     'FirstName',
  'lastname':       'LastName',
  'last name':      'LastName',
  'last_name':      'LastName',
  'birthdate':      'Birthdate',
  'birth date':     'Birthdate',
  'birthday':       'Birthdate',
  'date of birth':  'Birthdate',
  'dob':            'Birthdate',
  'allergies':      'Allergies',
  'allergy':        'Allergies',
  'notes':          'Notes',
  'handbookgroup':  'HandbookGroup',
  'handbook group': 'HandbookGroup',
  'handbook_group': 'HandbookGroup',
  'handbook':       'HandbookGroup',
  'handbook time':  'HandbookGroup',
  'med release':      'MedRelease',
  'medrelease':       'MedRelease',
  'med_release':      'MedRelease',
  'medical release':  'MedRelease',
  // TwoTimTwo exports BOTH "Med Release?" and "Photo Release?", but which
  // one a church actually fills in varies — KVB records the MEDIA release
  // under "Med Release?" and never touches "Photo Release?". Both map to
  // their own key and noPhotoFor() flags on an explicit "no" in either.
  'media release':    'PhotoRelease',
  'mediarelease':     'PhotoRelease',
  'photo release':    'PhotoRelease',
  'photo permission': 'PhotoRelease',
  'club':           'Club',
  'group':          'Group',
  'color':          'Color',
  'grade':          'Grade',
  'gender':         'Gender',
  'clubber id':     'ClubberID',
  'clubberid':      'ClubberID',
  'inactive':       'Inactive',
  'book':           'Book',
  'share balance':   'ShareBalance',
  'sharebalance':    'ShareBalance',
  'leader notes':    'LeaderNotes',
};


function normalizeHeader(raw) {
  // Trailing punctuation must be stripped: the real export names several
  // columns with a question mark ("Med Release?", "Photo Release?") which
  // otherwise never match the map.
  const key = raw.toLowerCase().replace(/[_\s]+/g, ' ').replace(/[?!.:]+$/, '').trim();
  if (HEADER_MAP[key]) return HEADER_MAP[key];
  // The two consent columns get a shape match as well as the exact one. A
  // renamed export ("Photo/Video Release?", "Photo Release (Y/N)", "Medical
  // Release Signed?") used to fall straight through as an unknown header, and
  // an unknown header means noPhotoFor() never sees the column: every child
  // prints as photographable and nothing says why. Consent is the one field
  // where silently losing the column is worse than an imperfect match.
  if (/release|consent|permission|waiver/.test(key)) {
    if (/photo|picture|pictures|image|video|media/.test(key)) return 'PhotoRelease';
    if (/\bmed\b|medical/.test(key)) return 'MedRelease';
  }
  return raw;  // keep original if no mapping found
}

function parseCSV(raw) {
  if (!raw || !raw.trim()) return [];
  try {
    // Strip a leading UTF-8 BOM. TwoTimTwo's export carries one, and because
    // its fields are quoted the BOM lands *before* the first opening quote —
    // nextField() then takes the unquoted branch and returns `"First Name"`
    // with the quotes still attached. HEADER_MAP misses, every row loses
    // FirstName, and findClubber() matches nobody: the entire roster silently
    // degrades to basic labels (no allergies, group, birthday, or no-photo).
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    // The TwoTimTwo CSV has quoted fields that can contain newlines (e.g. Notes,
    // Emergency Contact).  We need a proper stateful parser, not a simple
    // line-by-line split.
    const rows = [];
    let headers = [];
    let headerParsed = false;
    let pos = 0;
    const len = raw.length;

    // Parse one field starting at `pos`. Returns the field value and advances
    // `pos` past the delimiter (comma or end-of-record).
    function nextField() {
      // Skip leading whitespace (but not newlines — those are record separators)
      while (pos < len && raw[pos] === ' ') pos++;

      if (pos >= len) return '';

      if (raw[pos] === '"') {
        // Quoted field — collect until closing quote
        pos++;  // skip opening quote
        let val = '';
        while (pos < len) {
          if (raw[pos] === '"') {
            if (pos + 1 < len && raw[pos + 1] === '"') {
              // Escaped quote
              val += '"';
              pos += 2;
            } else {
              // Closing quote
              pos++;  // skip closing quote
              break;
            }
          } else {
            val += raw[pos];
            pos++;
          }
        }
        // Skip any whitespace between closing quote and delimiter
        while (pos < len && raw[pos] === ' ') pos++;
        return val.trim();
      } else {
        // Unquoted field — collect until comma or newline
        let val = '';
        while (pos < len && raw[pos] !== ',' && raw[pos] !== '\n' && raw[pos] !== '\r') {
          val += raw[pos];
          pos++;
        }
        return val.trim();
      }
    }

    function parseRecord() {
      const fields = [];
      while (pos < len) {
        fields.push(nextField());
        if (pos < len && raw[pos] === ',') {
          pos++;  // skip comma, continue to next field
        } else {
          // End of record (newline or EOF)
          break;
        }
      }
      // Skip trailing newlines between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n')) pos++;
      return fields;
    }

    while (pos < len) {
      // Skip blank lines / whitespace between records
      while (pos < len && (raw[pos] === '\r' || raw[pos] === '\n' || raw[pos] === ' ')) pos++;
      if (pos >= len) break;

      // Stop at TwoTimTwo footer lines like "Clubber Count=116" or "FILTER,VALUE"
      const restOfLine = raw.slice(pos, raw.indexOf('\n', pos) === -1 ? len : raw.indexOf('\n', pos));
      if (/^Clubber Count=/i.test(restOfLine) || /^FILTER,/i.test(restOfLine)) break;

      const fields = parseRecord();
      if (fields.length === 0 || (fields.length === 1 && !fields[0])) continue;

      if (!headerParsed) {
        headers = fields.map(normalizeHeader);
        headerParsed = true;
        continue;
      }

      const obj = {};
      headers.forEach((h, i) => { obj[h] = fields[i] !== undefined ? fields[i] : ''; });
      rows.push(obj);
    }

    return rows;
  } catch (e) {
    console.warn('[csv] Unexpected parse error:', e.message);
    return [];
  }
}

// ── Load clubbers from CSV ────────────────────────────────────────────────────
// Reads clubbers.csv from the same directory as this script.
// Gracefully handles every failure mode so the server always keeps running:
//   ENOENT  — file doesn't exist yet (first run, or file was deleted)
//   EBUSY   — PowerShell is currently overwriting the file mid-event
//   other   — malformed data, permissions, etc.
// The roster is re-read before every label so a mid-event addition is picked
// up, but it was also re-PARSED and its sample names logged every time, on a
// file that changes a few times a night. One stat() now answers "same file as
// last time?" and the parsed rows are reused; a changed file is parsed and
// logged as before.
let clubbersStamp = null;
function loadClubbers() {
  const csvPath = CSV_FILE;
  const stamp = fileStamp(csvPath);
  if (stamp !== 'missing' && stamp === clubbersStamp && clubbers.length > 0) return clubbers;
  try {
    const raw = fs.readFileSync(csvPath, 'utf8');
    const rows = parseCSV(raw);
    clubbersStamp = stamp;
    if (rows.length > 0) {
      // Log every parsed column (not just the known ones) so a renamed
      // TwoTimTwo header that misses HEADER_MAP is visible in the console
      // instead of silently dropping enrichment (group, allergies, ...).
      const keys = Object.keys(rows[0]);
      console.log(`[csv] Loaded ${rows.length} clubber(s) from clubbers.csv (columns: ${keys.join(', ')})`);
      // Log a few sample names to verify parsing
      const samples = rows.slice(0, 3).map(r => `${r.FirstName} ${r.LastName}`).join(', ');
      console.log(`[csv] Sample names: ${samples}`);
      // And what the consent columns hold, as value counts. This is the line
      // to read when "no camera icons are printing": it shows the literal
      // spellings TwoTimTwo exported and how many rows they flagged.
      const consent = rosterConsentSummary(rows);
      console.log(`[csv] Photo consent: ${consent.flagged} of ${consent.total} flagged no-photo | Med Release? ${consent.hasMedColumn ? describeConsentColumns(consent.medValues) : '(column missing)'} | Photo Release? ${consent.hasPhotoColumn ? describeConsentColumns(consent.photoValues) : '(column missing)'}`);
      const consentMsg = consentWarningFor(consent);
      if (consentMsg) console.warn(`[csv] WARNING: ${consentMsg}`);
    } else {
      console.log('[csv] clubbers.csv is empty or has no data rows');
    }
    return rows;
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.warn('[csv] clubbers.csv not found — running without enrichment data');
    } else if (e.code === 'EBUSY') {
      // EBUSY: PowerShell may be writing this file mid-event.
      // Skip this reload; the next request will try again automatically.
      console.warn('[csv] clubbers.csv is busy (being written) — skipping reload');
    } else {
      console.warn('[csv] Failed to read/parse clubbers.csv:', e.message);
    }
    // Last-known-good fallback: a transient read failure mid-event must not
    // wipe the in-memory roster — that would silently downgrade every label
    // to "basic" (no allergies, no groups) until the file becomes readable.
    if (clubbers.length > 0) {
      console.warn(`[csv] Keeping last good roster in memory (${clubbers.length} clubber(s))`);
    }
    return clubbers;
  }
}

// ── Duplicate-print suppression ───────────────────────────────────────────────
// A cold printer plus PowerShell startup can push a print past the client's
// request timeout; the client then aborts and retries even though the first
// request is still printing (or just printed). Printing is per-child-per-
// check-in, so any /print for a name that already printed successfully within
// this window is a duplicate — acknowledge it as success without printing.
// Deliberate reprints go through POST /reprint, which is not gated.
//
// 45s, NOT 25s: the extension aborts a print at PRINT_TIMEOUT_MS (35s, see
// content.js) and then retries, so a window shorter than that client timeout
// let the retry through as a fresh print and a slow printer produced two
// labels and two history rows for one child. The window has to outlast the
// longest wait any client will do before it gives up, plus a little.
const DUPLICATE_WINDOW_MS = 45000;
const recentPrints = new Map();  // nameKey → timestamp of last successful print
// Prints under way, claimed at the duplicate check and released when the print
// settles. recordPrint() runs only after the label is out, so until 7.11.1 two
// requests that overlapped (the extension's retry at 38 s behind a slow
// driver, two detection paths, a double tap) both passed the window test
// before either had recorded, and both printed. A claim is never older than
// IN_FLIGHT_MAX_MS: a throw that skipped a release cannot block a child's next
// label for the rest of the night.
const printsInFlight = new Map();  // nameKey → claimed at
const IN_FLIGHT_MAX_MS = 2 * 60 * 1000;

function isDuplicatePrint(nameKey) {
  const claimed = printsInFlight.get(nameKey);
  if (claimed !== undefined && Date.now() - claimed < IN_FLIGHT_MAX_MS) return true;
  const last = recentPrints.get(nameKey);
  return last !== undefined && Date.now() - last < DUPLICATE_WINDOW_MS;
}

function claimPrint(nameKey) { printsInFlight.set(nameKey, Date.now()); }
function releasePrint(nameKey) { printsInFlight.delete(nameKey); }

function recordPrint(nameKey) {
  const now = Date.now();
  recentPrints.set(nameKey, now);
  // Prune expired entries so the map stays small over a whole event night
  for (const [k, t] of recentPrints) {
    if (now - t >= DUPLICATE_WINDOW_MS) recentPrints.delete(k);
  }
}

// ── Find a child in the CSV ───────────────────────────────────────────────────
// An explicit clubberId (the extension reads it off the check-in page's
// .clubber[recid] attribute) matches exactly against the export's
// "Clubber ID" column — immune to middle names, suffixes, and duplicate
// names. Name matching stays as the fallback: case-insensitive and
// whitespace-trimmed on both sides so "alice " matches "Alice".
function findClubberIn(rows, firstName, lastName, clubberId) {
  const id = String(clubberId == null ? '' : clubberId).trim();
  if (id) {
    const byId = rows.find(r => String(r.ClubberID || '').trim() === id);
    if (byId) return byId;
  }
  const fn = (firstName || '').toLowerCase().trim();
  const ln = (lastName  || '').toLowerCase().trim();
  if (!fn && !ln) return null;
  return rows.find(r =>
    (r.FirstName || '').toLowerCase().trim() === fn &&
    (r.LastName  || '').toLowerCase().trim() === ln
  ) || null;
}

function findClubber(firstName, lastName, clubberId) {
  return findClubberIn(clubbers, firstName, lastName, clubberId);
}

// ── Step Up Night eligibility ─────────────────────────────────────────────────
// Step Up Night is the one Wednesday a year when kids whose age/grade puts
// them in a different club next year are recognised on their label. The
// label is inverted (black bg / white text) and the handbook-group line is
// replaced with "Stepping up to <Next Club>".

const STEP_UP_GRADUATING_GRADE = {
  spark:   2,  // last grade in Sparks
  't&t':   5,  // last grade in T&T
  trek:    8,  // last grade in Trek
  journey: 12  // last grade in Journey
};

const STEP_UP_NEXT_CLUB = {
  puggle:  'Cubbies',
  cubbie:  'Sparks',
  spark:   'T&T',
  't&t':   'Trek',
  trek:    'Journey',
  journey: 'Graduates'
};

function clubKey(clubName) {
  const n = String(clubName || '').trim().toLowerCase();
  if (!n) return null;
  if (n.includes('puggle'))  return 'puggle';
  if (n.includes('cubbie'))  return 'cubbie';
  if (n.includes('spark'))   return 'spark';
  if (n.includes('trek'))    return 'trek';
  if (n.includes('journey')) return 'journey';
  if (n.includes('t&t') || n.includes('t & t') || n === 'tnt' || n === 't t') return 't&t';
  return null;
}

function nextClubFor(clubName) {
  const k = clubKey(clubName);
  return k ? (STEP_UP_NEXT_CLUB[k] || null) : null;
}

// The handbook-group line exists to route a child to the right table during
// handbook time. Three kinds of value carry no routing information and only
// clutter the label, so they render as NO line at all:
//
//   * "all"            — TwoTimTwo's placeholder for "not in a specific group".
//                        (This rule predates this helper; it used to be pasted
//                        at four call sites.)
//   * any Puggles group — Puggles is the toddler program: no handbooks, no
//                        handbook time, nothing to route to. TwoTimTwo still
//                        assigns them a pseudo-group (literally "Puggles
//                        group"), which printed as a redundant italic line on
//                        every Puggles label.
//   * "<club> group"   — a group named after the club itself ("Sparks group",
//                        "Cubbies class") says only what the icon and club
//                        line already say. "Sparks A" or "Flight 3:16" still
//                        print — the comparison is against the WHOLE string,
//                        so anything with an extra token survives.
function effectiveHandbookGroup(rawGroup, clubName) {
  const g = String(rawGroup == null ? '' : rawGroup).trim();
  if (!g) return '';
  // Collapse to bare alphanumerics for the comparison: clubKey in this same
  // file already treats "T&T", "T & T" and "tnt" as one club, so the
  // self-named-group rule must not be defeated by ampersand spacing.
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const gN = norm(g);
  if (gN === 'all') return '';
  if (clubKey(clubName) === 'puggle') return '';
  const cN = norm(clubName);
  if (cN && (gN === cN || gN === `${cN}group` || gN === `${cN}class` || gN === `${cN}room`)) return '';
  return g;
}

// (parseBirthdate lives with the birthday-week helpers further down — this
// spot briefly held a duplicate declaration that the later one shadowed.)

function parseGrade(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().toLowerCase();
  if (!t) return null;
  if (t === 'k' || t.startsWith('kinder')) return 0;
  if (t.startsWith('pre')) return null;        // Pre-K isn't a school grade
  const m = t.match(/(\d{1,2})/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (isNaN(n) || n < 0 || n > 12) return null;
  return n;
}

// Cubbies cutoff: kid steps up only if their 5th birthday is on or before
// October 15 of the next Awana year start. Awana year begins in September,
// so before July we use this calendar year's cutoff; July onward we roll to
// next year so the eligibility is correct for kids checking in over summer.
function isSteppingUp(record, clubName) {
  const k = clubKey(clubName);
  if (!k) return false;
  if (k === 'puggle') return true;
  if (k === 'cubbie') {
    const bd = parseBirthdate(record && record.Birthdate);
    if (!bd) return false;
    const today = new Date();
    const cutoffYear = today.getMonth() < 6 ? today.getFullYear() : today.getFullYear() + 1;
    const cutoff = new Date(cutoffYear, 9, 15); // Oct 15
    const fifthBirthday = new Date(bd.getFullYear() + 5, bd.getMonth(), bd.getDate());
    return fifthBirthday <= cutoff;
  }
  const grade = parseGrade(record && record.Grade);
  if (grade === null) return false;
  return grade === STEP_UP_GRADUATING_GRADE[k];
}

// ── Screen season (#16/#18) ───────────────────────────────────────────────────
// Eight seasons, resolved automatically from the calendar with a dashboard
// override (config.seasonTheme: 'auto' | 'off' | a season key). Labels used to
// wear it as a small top-centre line-art motif; that art is gone (2026-27
// rebrand: the label is the catalog's type and the official club mark, nothing
// seasonal). What stays is the broadcast: every `tally` carries the season so
// the lobby screens know which skin to wear, and the dashboard calls the
// setting "Screen season". The config key and the payload are unchanged — the
// signage app (skinForPrinterSeason) reads both.
const SEASON_KEYS = [
  'back-to-school', 'fall', 'thanksgiving', 'christmas',
  'winter', 'spring', 'easter', 'vbs-summer',
];

// Easter moves (anonymous Gregorian computus). Pinned by test: 2026-04-05.
function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// The calendar's season for a date. Easter (two weeks before Easter Sunday
// through the week after) outranks the underlying spring window; the fixed
// windows tile the rest of the year with no gaps.
function seasonForDate(now = new Date()) {
  const easter = easterSunday(now.getFullYear());
  const eStart = new Date(easter); eStart.setDate(eStart.getDate() - 14);
  const eEnd = new Date(easter); eEnd.setDate(eEnd.getDate() + 7);
  if (now >= eStart && now < eEnd) return 'easter';
  const md = String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
  if (md >= '08-15' && md <= '09-30') return 'back-to-school';
  if (md >= '10-01' && md <= '11-14') return 'fall';
  if (md >= '11-15' && md <= '11-30') return 'thanksgiving';
  if (md >= '12-01') return 'christmas';
  if (md <= '02-29') return 'winter';
  if (md <= '05-31') return 'spring';
  return 'vbs-summer';   // 06-01 .. 08-14
}

// What the screens should wear tonight: '' when the operator turned it off
// (the tally then carries no season and each screen follows its own skin
// setting), the operator's pinned season, or the calendar's.
function currentScreenSeason(now = new Date()) {
  const cfg = String(config.seasonTheme || 'auto');
  if (cfg === 'off') return '';
  if (SEASON_KEYS.includes(cfg)) return cfg;
  return seasonForDate(now);
}

// (The collectible icon of the week, #20, came off the label with the
// seasonal motif in the same rebrand. A config.json saved by an older version
// may still carry `collectibleIcons`; nothing reads it any more.)

// ── Twin-safe labels (#13) ────────────────────────────────────────────────────
// When two ACTIVE roster kids share a normalized first+last name, their labels
// need something a volunteer can tell apart at arm's length. Preference order:
//   1. a middle initial, if the roster ever carries one — TwoTimTwo's real
//      /clubber/csv export (verbatim 66-column header pinned in
//      test-server-helpers.cjs and docs/TWOTIMTWO.md) has NO middle-name
//      column today, so this is opportunistic future-proofing, checked
//      against the unmapped raw columns parseCSV preserves;
//   2. the birth month ("b. Mar") — always present in practice, meaningless
//      to strangers, stable across years (unlike a grade hint).
// Returns {middleInitial, nameHint} — both '' when the name is unique, so
// the common case renders byte-identically to today.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function twinDisambiguation(record, rows) {
  const out = { middleInitial: '', nameHint: '' };
  if (!record || !Array.isArray(rows)) return out;
  const norm = (r) => (String(r.FirstName || '').trim() + ' ' + String(r.LastName || '').trim())
    .toLowerCase().replace(/\s+/g, ' ');
  const me = norm(record);
  if (me === ' ' || me === '') return out;
  const twins = rows.filter(r => r && !String(r.Inactive || '').trim() && norm(r) === me);
  if (twins.length < 2) return out;

  const middle = String(record['Middle Name'] || record.Middle || record.MiddleName || '').trim();
  if (middle) {
    out.middleInitial = middle[0].toUpperCase();
    return out;
  }
  const bd = parseBirthdate(record.Birthdate);
  if (bd) out.nameHint = 'b. ' + MONTH_ABBR[bd.getMonth()];
  return out;
}

// ── Birthday-week check ───────────────────────────────────────────────────────
// Returns true if the child's next birthday falls within the next 7 days
// (inclusive of today). Handles year-wrapping correctly: if today is Dec 30
// and the birthday is Jan 2, this returns true.
// Returns false — without throwing — for blank, null, "N/A", or any
// unparseable date string.

// Parse a roster birthdate into a Date, or null for blank/"N/A"/unparseable.
// Normalises MM/DD/YYYY → YYYY-MM-DD so Date() parses it correctly on all
// platforms (the ISO form is the only reliably portable format in Node).
function parseBirthdate(birthdateStr) {
  if (!birthdateStr || String(birthdateStr).trim() === '' || birthdateStr === 'N/A') {
    return null;
  }
  const t = String(birthdateStr).trim();
  // Build a LOCAL date from the components. The old path normalised to
  // 'YYYY-MM-DD' and string-parsed it — which JS treats as UTC MIDNIGHT, so
  // in any US timezone getMonth()/getDate() read back the PREVIOUS day: a
  // Mar 1 twin printed "b. Feb", and 1st-of-month birthdays fell on the
  // wrong side of the June–August half-birthday gate.
  let year = null, month = null, day = null;
  const slash = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // M/D/YYYY (the export's format)
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (slash) {
    month = parseInt(slash[1], 10); day = parseInt(slash[2], 10); year = parseInt(slash[3], 10);
  } else if (iso) {
    year = parseInt(iso[1], 10); month = parseInt(iso[2], 10); day = parseInt(iso[3], 10);
  }
  if (year !== null) {
    const bday = new Date(year, month - 1, day);
    // Reject rollovers (2/30 → Mar 2) instead of silently shifting the date.
    return (bday.getFullYear() === year && bday.getMonth() === month - 1 && bday.getDate() === day) ? bday : null;
  }
  const bday = new Date(t);
  return isNaN(bday.getTime()) ? null : bday;
}

// Which calendar year's occurrence of the given month/day (0-indexed month)
// falls in the same ISO week as today — or null when neither does. Tested in
// both this calendar year and the next: the old code rolled an already-passed
// birthday forward a year before comparing, so the cake vanished the day
// after the birthday even though the documented behavior is "the whole
// calendar week containing it". Checking next year as well keeps the Dec→Jan
// ISO-week wrap working (e.g. today Dec 29 in ISO week 1, target Jan 2).
//
// Returning the MATCHED YEAR rather than a bare boolean is what lets the
// birthday-age line (#291) compute the age from exactly the occurrence the
// cake icon keys on — the two can never disagree across the year wrap.
function birthdayWeekYear(month, day) {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const getWeekNumber = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return { year: d.getFullYear(), week: weekNum };
    };

    const todayWeek = getWeekNumber(today);
    for (const yr of [today.getFullYear(), today.getFullYear() + 1]) {
      // Clamp the day into the target month (Aug 31's half-birthday must be
      // the end of February, not roll into March).
      const lastDay = new Date(yr, month + 1, 0).getDate();
      const candidate = new Date(yr, month, Math.min(day, lastDay));
      const w = getWeekNumber(candidate);
      if (w.year === todayWeek.year && w.week === todayWeek.week) return yr;
    }
    return null;
  } catch {
    // Any unexpected error (timezone edge case, etc.) — safe fallback
    return null;
  }
}

// True when the given month/day falls in the same ISO week as today.
function isWeekOfMonthDay(month, day) {
  return birthdayWeekYear(month, day) !== null;
}

function isBirthdayWeek(birthdateStr) {
  const bday = parseBirthdate(birthdateStr);
  if (!bday) return false;
  return isWeekOfMonthDay(bday.getMonth(), bday.getDate());
}

// Half-birthday cake (#8): the Awana year runs roughly late August to May, so
// a June–August birthday NEVER lands on a club night — those kids watch every
// other kid get a cake and never get one. Their half-birthday, six months on,
// falls squarely inside the season and gets the same 🍰. Everyone else keeps
// exactly one cake week a year.
//
// LABEL ONLY, deliberately: the display's checkin banner and the weekly
// birthday list stay REAL birthdays (isBirthdayWeek), so nobody on stage
// wishes a January "happy birthday" to an August kid.
function isHalfBirthdayWeek(birthdateStr) {
  const bday = parseBirthdate(birthdateStr);
  if (!bday) return false;
  const m = bday.getMonth();
  if (m < 5 || m > 7) return false;   // June (5) – August (7) birthdays only
  return isWeekOfMonthDay((m + 6) % 12, bday.getDate());
}

// What the LABEL's cake icon keys on: the real birthday week, or a summer
// kid's half-birthday week.
function isCakeWeek(birthdateStr) {
  return isBirthdayWeek(birthdateStr) || isHalfBirthdayWeek(birthdateStr);
}

// The age a child turns this birthday week (#291), printed as words beside the
// cake so a leader can greet the exact age instead of just noticing an icon.
//
// REAL birthday weeks only, deliberately: a summer kid's half-birthday cake
// gets no age line, because "turning 7 in six months" is not a fact anyone
// wants on a badge. The two windows are mutually exclusive, so no tie-break is
// needed — a half-birthday week simply returns null here.
//
// Uses the SAME matched year the cake keys on (birthdayWeekYear), so the icon
// and the words can never disagree at the Dec→Jan wrap.
//
// Returns null for anything unparseable, not-this-week, or implausible for a
// club (outside 1–21), so a caller can pass the result straight through to
// generateLabel and a malformed birth year degrades to today's plain cake.
// The birth YEAR itself never leaves this function: only the derived age does.
function birthdayAgeThisWeek(birthdateStr) {
  const bday = parseBirthdate(birthdateStr);
  if (!bday) return null;
  const yr = birthdayWeekYear(bday.getMonth(), bday.getDate());
  if (yr === null) return null;
  const age = yr - bday.getFullYear();
  return (Number.isInteger(age) && age >= 1 && age <= 21) ? age : null;
}

// ── Allergy parser ────────────────────────────────────────────────────────────
// Converts the free-text Notes/Allergies field into a compact array of short
// tokens printed on the label. Returns [] for null/blank.
//
// The real TwoTimTwo export has NO dedicated allergy column (docs/TWOTIMTWO.md
// §3.1) — Notes is regex-matched free text, which used to produce false
// positives like "loves coloring" printing a DYE icon. This parser is
// negation-aware to cut that noise, but it is DELIBERATELY BIASED TOWARD A
// FALSE POSITIVE OVER A FALSE NEGATIVE: an extra icon on a label is a minor
// annoyance, a missed real allergy is a safety incident. So a clause is only
// ever suppressed when it opens with an explicit negation cue (no / none /
// not / without / denies / n/a) — anything merely hedged, uncertain, or
// ambiguous ("possible peanut allergy") still flags.
function parseAllergies(allergiesStr) {
  if (!allergiesStr || !String(allergiesStr).trim()) return [];
  const s = String(allergiesStr);

  // Sentence/clause boundaries: newlines (Notes can be multi-line — see the
  // CSV quoting rules in docs/TWOTIMTWO.md §3.2), periods, commas, semicolons.
  const clauses = s.split(/[\n.,;]+/);

  // Only a NEGATION AT THE CLAUSE'S OWN START suppresses that clause — e.g.
  // "no known allergies" or the second half of "allergic to milk, not eggs".
  // A negation buried mid-clause ("give a snack, not candy though") must not
  // blank out an earlier real allergy mention in the same clause.
  const NEGATION_LEAD_RE = /^(no|none|not|without|denies|n[\/\-. ]?a)\b/i;

  // ...but a negation is frequently followed by the REAL allergy as an
  // exception: "no known allergies except peanuts", "none other than dairy",
  // "not allergic to nuts but is allergic to eggs". Splitting each clause on
  // these contrast markers and only ever negating the part BEFORE the marker
  // keeps those allergies. Everything after the marker is always scanned.
  // This can over-flag ("no nuts but dairy is fine" -> DAIRY), which is the
  // correct direction to err: an extra icon is harmless, a missed allergy is not.
  const EXCEPTION_SPLIT_RE = /\b(?:except(?:\s+for)?|but|however|besides|aside\s+from|other\s+than|apart\s+from)\b/i;

  const NUT_RE    = /\bpeanuts?\b|\btree.?nuts?\b|\bnuts?\b/i;
  const DAIRY_RE  = /\bdairy\b|\bmilk\b|\blactose\b/i;
  const GLUTEN_RE = /\bgluten\b|\bwheat\b/i;
  const EGG_RE    = /\beggs?\b/i;  // \b avoids matching "eggnog" as EGG
  // Tightened to a food-dye SENSE, not a bare "color/colour" (which false-
  // positived on things like "loves coloring").
  const DYE_RE    = /\bdyes?\b|\bfood\s*colou?ring\b|\bred\s*40\b|\bartificial\s+colou?r(?:ing)?\b/i;

  const found = new Set();
  for (const rawClause of clauses) {
    const clause = rawClause.trim();
    if (!clause) continue;

    // Split off any "except/but/other than ..." remainder. Segment 0 is the
    // only one a leading negation can suppress; every later segment names an
    // exception to that negation and is always scanned.
    const segments = clause.split(EXCEPTION_SPLIT_RE);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i].trim();
      if (!segment) continue;
      if (i === 0 && NEGATION_LEAD_RE.test(segment)) continue;

      if (NUT_RE.test(segment))    found.add('NUTS');
      if (DAIRY_RE.test(segment))  found.add('DAIRY');
      if (GLUTEN_RE.test(segment)) found.add('GLUTEN');
      if (EGG_RE.test(segment))    found.add('EGG');
      if (DYE_RE.test(segment))    found.add('DYE');
    }
  }

  // Stable, deterministic order regardless of clause order in the source text.
  const ORDER = ['NUTS', 'DAIRY', 'GLUTEN', 'EGG', 'DYE'];
  return ORDER.filter(t => found.has(t));
}

// Allergen icons for the bottom-right row — icons only, no words on the label.
const ALLERGY_EMOJI = {
  'NUTS':   '\uD83E\uDD5C',  // 🥜
  'DAIRY':  '\uD83E\uDD5B',  // 🥛
  'GLUTEN': '\uD83C\uDF3E',  // 🌾
  'EGG':    '\uD83E\uDD5A',  // 🥚
  'DYE':    '\uD83D\uDCA7',  // 💧 food dye / artificial coloring sensitivity
};

// ── Med Release parser ────────────────────────────────────────────────────────
// The roster's release columns are nominally y/n. Only an explicit "no" flags
// the label with a crossed-out camera (do-not-photograph) icon — blank,
// missing, "?" and unrecognized values print nothing, so rosters without the
// column are unaffected.
//
// "Explicit no" is read generously on purpose. A consent flag must fail toward
// protection, and TwoTimTwo's export has already changed the spelling once
// without notice: besides the bare y/n the column can carry a word ("No",
// "Declined", "Not signed", "Opt out"), a word with a note after it ("No -
// see mom", "N (2026-09-01)"), or a "no photos" phrase typed by a volunteer.
// All of those mean the family said no and all of them flag. What never flags:
// blank, "?", "unknown", "pending", "N/A" and friends, because "we do not know"
// is not "they said no" and a camera on every unanswered child would train
// leaders to ignore the icon.
const NO_PHOTO_UNKNOWN = /^(\?|n\/?a|na|none given|not asked|not answered|unknown|unk|pending|tbd|not sure|maybe)$/i;
const NO_PHOTO_NEGATIVE = new RegExp([
  // a bare negative word, alone or followed by punctuation / a note
  '^(n|no|nope|none|false|0|f|nein|non|declined?|denied|deny|refused?|withheld|withhold)(?![a-z])',
  // negative phrases anywhere in the value
  '\\b(not?[ -]?(signed|granted|permitted|allowed|approved|returned|received|on file|consented)|unsigned|opt(ed)?[ -]?out|do(es)? ?not|don\'t|no ?photo\\w*|no ?pic\\w*|no ?media|no ?video|no ?release|no ?consent|no ?permission)',
].join('|'), 'i');
function parseNoPhoto(value) {
  const v = String(value == null ? '' : value).trim();
  if (!v || NO_PHOTO_UNKNOWN.test(v)) return false;
  return NO_PHOTO_NEGATIVE.test(v);
}

// The mirror image, for diagnostics only: does a release value read as a
// clear "yes"? Anything that is neither a yes nor a no is "unrecognized", and
// a roster whose consent columns hold ONLY unrecognized values is exactly the
// silent failure this file has had twice - the dashboard and /health now say
// so, with the literal values, instead of printing every child as
// photographable and leaving the operator to notice at the door.
const YES_RELEASE = /^(y|yes|yep|true|1|t|ok|okay|signed|granted|approved|on file|received|consented?|allowed|permitted)(?![a-z])/i;
function parseYesRelease(value) {
  const v = String(value == null ? '' : value).trim();
  return !!v && YES_RELEASE.test(v) && !parseNoPhoto(v);
}

// What the roster's consent columns actually contain, as counts of distinct
// values (never names). `flagged` is how many rows noPhotoFor() marks;
// `unrecognized` lists non-blank values that read as neither yes nor no.
// Values are truncated so a stray free-text column cannot flood a log line.
function rosterConsentSummary(rows) {
  const summary = {
    total: Array.isArray(rows) ? rows.length : 0,
    hasMedColumn: false,
    hasPhotoColumn: false,
    medValues: {},
    photoValues: {},
    flagged: 0,
    unrecognized: [],
    // Non-blank cells across both columns, and how many of them read as
    // neither yes nor no. The warning below is scaled by these, so one stray
    // "see notes" on a healthy roster does not shout every night.
    nonBlank: 0,
    unrecognizedCount: 0,
  };
  if (!summary.total) return summary;
  const seenUnrecognized = new Set();
  const tally = (bucket, value) => {
    const v = String(value == null ? '' : value).trim().slice(0, 40);
    bucket[v] = (bucket[v] || 0) + 1;
    if (!v) return;
    summary.nonBlank++;
    if (!parseNoPhoto(v) && !parseYesRelease(v) && !NO_PHOTO_UNKNOWN.test(v)) {
      seenUnrecognized.add(v);
      summary.unrecognizedCount++;
    }
  };
  rows.forEach(r => {
    if (!r || typeof r !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(r, 'MedRelease')) { summary.hasMedColumn = true; tally(summary.medValues, r.MedRelease); }
    if (Object.prototype.hasOwnProperty.call(r, 'PhotoRelease')) { summary.hasPhotoColumn = true; tally(summary.photoValues, r.PhotoRelease); }
    if (noPhotoFor(r)) summary.flagged++;
  });
  summary.unrecognized = Array.from(seenUnrecognized).sort().slice(0, 12);
  return summary;
}

// One line for the console and one sentence for /health. `null` when the
// roster gives no cause for concern (some child is flagged, or every value
// present is a recognized yes/no), so the warning list stays quiet on a
// healthy night.
function describeConsentColumns(bucket) {
  return Object.keys(bucket).sort((a, b) => bucket[b] - bucket[a])
    .map(v => `${JSON.stringify(v)} x${bucket[v]}`).join(', ') || '(none)';
}
function consentWarningFor(summary) {
  if (!summary || !summary.total) return null;
  if (!summary.hasMedColumn && !summary.hasPhotoColumn) {
    return 'The roster has no "Med Release?" or "Photo Release?" column, so no label can carry the no-photo camera. Check which columns TwoTimTwo is exporting.';
  }
  if (!summary.unrecognizedCount) return null;
  const listed = summary.unrecognized.map(v => JSON.stringify(v)).join(', ');
  const detail = `Photo Release? values: ${describeConsentColumns(summary.photoValues)}. Med Release? values: ${describeConsentColumns(summary.medValues)}. If one of those means "no photos", report it so the label can flag it.`;
  if (summary.flagged === 0) {
    return `No child is flagged no-photo, and the release columns hold values this app does not recognize as yes or no: ${listed}. ${detail}`;
  }
  // Some children flag, but a real share of the cells still cannot be read:
  // three or more of them AND at least a quarter of everything filled in.
  if (summary.unrecognizedCount >= 3 && summary.unrecognizedCount * 4 >= summary.nonBlank) {
    return `${summary.unrecognizedCount} release value(s) are not recognized as yes or no: ${listed}. Children with those values print WITHOUT the no-photo camera. ${detail}`;
  }
  return null;
}

// The do-not-photograph flag for a roster row: an explicit "no" in EITHER
// release column flags the label. This is deliberately an OR, not a
// precedence chain. The previous rule ("PhotoRelease when the column exists,
// MedRelease only as a fallback") assumed the photo column is where photo
// consent lives — but field data proved otherwise: KVB's TwoTimTwo instance
// records the MEDIA release under "Med Release?" and leaves "Photo Release?"
// unused, and since the unused column still exists in every export, the
// precedence rule read the blank column and silently dropped the flag for
// every no-photo child. A consent flag must fail toward protection: the
// worst outcome of OR is a spurious camera icon; the worst outcome of
// precedence was photographing a child whose family said no.
// Every label/preview/reprint/dashboard path MUST derive the flag through here
// so the printed label, its reprint, and the director's no-photo list can never
// disagree for a child whose two consent answers differ.
function noPhotoFor(record) {
  if (!record) return false;
  return parseNoPhoto(record.PhotoRelease) || parseNoPhoto(record.MedRelease);
}

// ── Unique temp file path ─────────────────────────────────────────────────────
// Date.now() alone can collide when two prints land in the same millisecond
// (double-tap on the check-in screen) — one request would then delete the
// other's file mid-print. A random suffix makes names collision-proof.
function tmpFilePath(prefix, ext) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`);
}

// ── Orphaned temp file sweep ──────────────────────────────────────────────────
// If a previous run crashed between writing a temp PNG/PS1 and unlinking it,
// the file stays behind forever. Sweep anything matching our prefixes that is
// older than an hour (never touches files a live request might still need).
// Runs once at startup; never throws.
function sweepOrphanedTempFiles() {
  try {
    const dir = os.tmpdir();
    const cutoff = Date.now() - 3600000;
    let removed = 0;
    for (const f of fs.readdirSync(dir)) {
      if (!/^awana-(print-)?\d+.*\.(png|ps1)$/.test(f)) continue;
      const full = path.join(dir, f);
      try {
        if (fs.statSync(full).mtimeMs < cutoff) { fs.unlinkSync(full); removed++; }
      } catch { /* vanished or locked — skip */ }
    }
    if (removed) console.log(`[cleanup] Removed ${removed} orphaned temp file(s) from previous runs`);
  } catch { /* tmpdir unreadable — non-critical */ }
}

// ── Download a remote image into a Buffer ─────────────────────────────────────
// A club logo is a small PNG. Anything else the URL answers with is refused
// before it is buffered: the icon is decoration, and a label must never wait
// on, or hold in memory, whatever a misconfigured or hostile URL sends.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 4000 }, (res) => {
      if (res.statusCode !== 200) {
        // Close the socket: a stalled upstream must not be held open until
        // the agent gives up on it.
        req.destroy();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const type = String(res.headers['content-type'] || '').toLowerCase();
      if (type && !type.startsWith('image/')) {
        req.destroy();
        reject(new Error(`not an image (${type.split(';')[0]})`));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
        req.destroy();
        reject(new Error(`too large (${declared} bytes)`));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > IMAGE_MAX_BYTES) { req.destroy(new Error(`too large (over ${IMAGE_MAX_BYTES} bytes)`)); return; }
        chunks.push(c);
      });
      res.on('error', reject);
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

// ── Club icon cache ───────────────────────────────────────────────────────────
// Remote club logos are downloaded once per URL and kept in memory, so every
// print doesn't re-fetch the same PNG and a mid-event network blip doesn't
// cost the label its icon. Bounded so a misbehaving client can't grow it.
const iconCache = new Map();  // url → Buffer
const ICON_CACHE_MAX = 20;

// ── Resolve clubImageData → Buffer (or null) ──────────────────────────────────
async function resolveImageBuffer(clubImageData) {
  if (!clubImageData) return null;
  try {
    if (clubImageData.startsWith('data:')) {
      // base64 data URL
      const b64 = clubImageData.replace(/^data:[^;]+;base64,/, '');
      return Buffer.from(b64, 'base64');
    }
    if (/^https?:\/\//.test(clubImageData)) {
      if (iconCache.has(clubImageData)) return iconCache.get(clubImageData);
      // One retry — venue Wi-Fi hiccups are routine, a second attempt 400ms
      // later usually succeeds and the result is cached for the whole event.
      let buf;
      try {
        buf = await downloadImage(clubImageData);
      } catch (firstErr) {
        await new Promise(r => setTimeout(r, 400));
        buf = await downloadImage(clubImageData);
      }
      if (iconCache.size >= ICON_CACHE_MAX) {
        iconCache.delete(iconCache.keys().next().value);  // evict oldest entry
      }
      iconCache.set(clubImageData, buf);
      return buf;
    }
  } catch (e) {
    console.log(`[icon] Could not load club image: ${e.message}`);
  }
  return null;
}

// Monogram, the icon panel's LAST resort: when the client doesn't supply a
// club logo (page layout changed, image failed to scrape) the panel shows the
// official club mark from the brand kit, and only when that is missing too
// does the label fall back to a solid badge with the club's monogram. TR (not
// T) for Trek so it can't be confused with T&T.
const CLUB_MONOGRAM = {
  puggle:  'P',
  cubbie:  'C',
  spark:   'S',
  't&t':   'T&T',
  trek:    'TR',
  journey: 'J',
};

// ── The one club list every dropdown reads ────────────────────────────────────
// Display names for the clubs above, in club order, served by GET /clubs and
// consumed by the extension panel, the dashboard and the phone page.
//
// There used to be five hardcoded copies of this list across those three
// surfaces, and they drifted: the extension's walk-in guest dropdown was the
// one that never got Journey, so a Journey walk-in could only be printed with
// the wrong club or none. Keys are clubKey() values, so anything the label
// renderer can style (monogram + font) is offerable and nothing else is —
// test-server-helpers.cjs asserts these two tables stay in step.
const CLUB_DISPLAY_NAMES = {
  puggle:  'Puggles',
  cubbie:  'Cubbies',
  spark:   'Sparks',
  't&t':   'T&T',
  trek:    'Trek',
  journey: 'Journey',
};
const CLUB_LIST = Object.keys(CLUB_MONOGRAM).map((k) => CLUB_DISPLAY_NAMES[k]);

// ── The fonts labels printed in before the brand kit ─────────────────────────
// Each club used to get its own Windows system font. They are no longer what a
// label is set in (the kit's fonts are, below), but they are what it FALLS
// BACK to, text by text, whenever a kit font did not load or cannot draw the
// characters in front of it, so a broken install prints exactly the label it
// printed before the kit existed. Keep them as they were.
function getClubFontFamily(clubName) {
  const n = (clubName || '').toLowerCase();
  if (n.includes('puggle'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('cubbie'))                          return "'Comic Sans MS', cursive, sans-serif";
  if (n.includes('spark'))                           return "'Trebuchet MS', Arial, sans-serif";
  if (n.includes('t&t') || n.includes('t & t') || n.includes('truth and training'))
                                                     return "'Arial Black', 'Arial Bold', Arial, sans-serif";
  if (n.includes('trek'))                            return "Georgia, 'Times New Roman', serif";
  if (n.includes('journey'))                         return "'Palatino Linotype', Palatino, Georgia, serif";
  return "Helvetica, Arial, sans-serif";
}

// ── Label type: the kit's three voices, with the old fonts behind them ───────
// Every piece of text on a label is set in one voice. Paytone One shouts (the
// first name, the monogram, a custom label), Londrina Solid labels (the club line,
// the VISITOR/LEADER pill, the trophy chip, the step-up callout, the TEST band)
// and Figtree is read (the last name and every small line). The same files are
// on every PC because they ship in the installer, so a label looks the same at
// every church; they used to be whichever Windows font each club happened to
// map to.
//
// `legacy` is the exact CSS font style the pre-kit code asked for, in the old
// family (getClubFontFamily, or `legacyFamily`). It is what prints when the kit
// font did not load (brand.fontReady) and, text by text, for characters the kit
// font does not have: the canvas does not borrow missing glyphs from the system
// fonts the way a browser does, it leaves a hole.
//
// `whole: true` voices never mix faces inside one string: a name the brand font
// cannot fully draw ("Дима" in Paytone One, which has no Cyrillic) prints
// entirely in the old font, as it did before, instead of as a name with one
// letter in another typeface. (Paytone One does draw Ș Ț and every Vietnamese
// letter, which its predecessor Galindo did not, so those names now print in
// the kit; Figtree still lacks the precomposed Vietnamese letters, so a last
// name like "Nguyễn" still falls back on its own.) A
// custom label is the same big line, and as often as not a person's or a
// room's name in the congregation's own language, so it is whole too. A custom
// label that wraps is still ONE piece of text, so its face is decided once from
// all of it (labelType's `pinned`), never per wrapped line: a missing letter
// in one half must not print the other half in a different typeface. Other
// voices split into runs at WORD boundaries (brand.splitRuns), so
// "⭐ 10th club night tonight!" keeps Figtree for the words and the star comes
// from the old stack, as it always did, and a word the kit font lacks a letter
// of prints whole in the old stack rather than changing face mid-word.
//
// `wght` is Figtree's weight axis. Figtree ships as one variable font and the
// canvas ignores a CSS weight for it (it draws the default Light instance and
// fakes anything heavier), so the weight goes through fontVariationSettings.
const LEGACY_SANS = 'Helvetica, Arial, sans-serif';
const LABEL_VOICES = Object.freeze({
  name:      { family: 'Paytone One',          legacy: 'bold', whole: true },
  monogram:  { family: 'Paytone One',          legacy: 'bold', whole: true },
  custom:    { family: 'Paytone One',          legacy: 'bold', legacyFamily: LEGACY_SANS, whole: true },
  last:      { family: 'Figtree', wght: 500,   legacy: '',     whole: true },
  hint:      { family: 'Figtree', wght: 500,   legacy: 'italic' },
  group:     { family: 'Figtree', wght: 600,   legacy: 'italic' },
  goTo:      { family: 'Figtree', wght: 700,   legacy: 'bold' },
  milestone: { family: 'Figtree', wght: 500,   legacy: '' },
  footer:    { family: 'Figtree', wght: 400,   legacy: 'italic' },
  age:       { family: 'Figtree', wght: 600,   legacy: '' },
  club:      { family: 'Londrina Solid',       legacy: 'italic bold' },
  stepUp:    { family: 'Londrina Solid Black', legacy: 'bold' },
  pill:      { family: 'Londrina Solid Black', legacy: 'bold' },
  band:      { family: 'Londrina Solid Black', legacy: 'bold' },
  test:      { family: 'Londrina Solid Black', legacy: 'bold', legacyFamily: LEGACY_SANS },
});

// The type helpers for one label, bound to its club's old family. Every helper
// takes (ctx, role, size, text): measure, fill (honouring ctx.textAlign and
// ctx.textBaseline like fillText), truncate (with an ellipsis) and fit (the
// largest even size from max down to min that fits, else min — the same ladder
// the pre-kit fitFontSize used).
//
// `pinned` is { role: wholeText } for text that reaches the canvas in PIECES
// but is one thing to read (a custom label wrapped onto two lines). For a
// pinned role the face is decided once, here, from the whole text (the kit face
// only if it loaded and draws every character of all of it), and every measure,
// fit, truncate and fill of that role then uses that one face whatever piece it
// is handed. Deciding per piece is how one half of a wrapped label came out in
// the kit's face and the other in Helvetica.
function labelType(clubName, pinned = {}) {
  const clubFamily = getClubFontFamily(clubName);
  const voice = (role) => LABEL_VOICES[role] || LABEL_VOICES.last;
  const pinnedFace = new Map();
  for (const [role, whole] of Object.entries(pinned || {})) {
    const v = voice(role);
    pinnedFace.set(role, brand.fontReady(v.family) && brand.fontCovers(v.family, whole));
  }
  const runsOf = (role, text) => {
    const v = voice(role);
    const s = String(text == null ? '' : text);
    if (pinnedFace.has(role)) return [{ text: s, brand: pinnedFace.get(role) }];
    if (!brand.fontReady(v.family)) return [{ text: s, brand: false }];
    if (v.whole) return [{ text: s, brand: brand.fontCovers(v.family, s) }];
    return brand.splitRuns(v.family, s);
  };
  const use = (ctx, role, size, inBrand) => {
    const v = voice(role);
    const fallback = v.legacyFamily || clubFamily;
    ctx.font = inBrand
      ? `${size}px "${v.family}", ${fallback}`
      : `${v.legacy ? v.legacy + ' ' : ''}${size}px ${fallback}`;
    // Always set, so no weight leaks from one run into the next face.
    ctx.fontVariationSettings = inBrand && v.wght ? `"wght" ${v.wght}` : 'normal';
  };
  const measure = (ctx, role, size, text) => {
    let w = 0;
    for (const r of runsOf(role, text)) { use(ctx, role, size, r.brand); w += ctx.measureText(r.text).width; }
    return w;
  };
  const fill = (ctx, role, size, text, x, y) => {
    const runs = runsOf(role, text);
    if (runs.length === 1) {
      use(ctx, role, size, runs[0].brand);
      ctx.fillText(runs[0].text, x, y);
      return;
    }
    // Mixed faces: lay the runs out left to right on ONE alphabetic baseline,
    // the one the brand face would sit on at (x, y) — each face's own 'top' or
    // 'middle' sits at a different height, so anchoring runs separately would
    // step the line.
    const align = ctx.textAlign;
    const baseline = ctx.textBaseline;
    const widths = runs.map((r) => { use(ctx, role, size, r.brand); return ctx.measureText(r.text).width; });
    const total = widths.reduce((a, b) => a + b, 0);
    let left = align === 'center' ? x - total / 2
      : (align === 'right' || align === 'end') ? x - total : x;
    const lead = runs.find((r) => r.brand) || runs[0];
    use(ctx, role, size, lead.brand);
    let yAlpha = y;
    if (baseline !== 'alphabetic') {
      const below = ctx.measureText(lead.text).actualBoundingBoxDescent;
      ctx.textBaseline = 'alphabetic';
      yAlpha = y + (below - ctx.measureText(lead.text).actualBoundingBoxDescent);
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    runs.forEach((r, i) => {
      use(ctx, role, size, r.brand);
      ctx.fillText(r.text, left, yAlpha);
      left += widths[i];
    });
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
  };
  const truncate = (ctx, role, size, text, maxWidth) => {
    const s = String(text == null ? '' : text);
    if (measure(ctx, role, size, s) <= maxWidth) return s;
    // By code point, so an emoji in a name is dropped whole, never halved.
    const chars = Array.from(s);
    while (chars.length > 0 && measure(ctx, role, size, chars.join('') + '…') > maxWidth) chars.pop();
    return chars.join('') + '…';
  };
  const fit = (ctx, role, text, maxWidth, maxSize, minSize) => {
    for (let size = maxSize; size >= minSize; size -= 2) {
      if (measure(ctx, role, size, text) <= maxWidth) return size;
    }
    return minSize;
  };
  // True when this text would print in the kit face (for layout decisions
  // that depend on the face's shape, like the name's descender room).
  const inBrand = (role, text) => runsOf(role, text).some((r) => r.brand);
  // How far the ink of `text` reaches above and below the origin of a line
  // drawn with a 'top' baseline (or the given one; 'alphabetic' is the line's
  // baseline itself), as a multiple of the size ({ above, below }, `above`
  // positive UP, so an accented capital that rises past the top of the em box
  // is positive and an ordinary word is negative). null unless the whole text
  // prints in the kit face: the old Windows faces keep their ink inside the box
  // and were laid out without this. Measured off the canvas at 100 px and
  // scaled (outlines scale exactly), so it is the shipped font's own answer,
  // glyph by glyph: a plain name reaches 0.20 down from the origin, "Émile" is
  // 0.09 above it, "Ștefan" hangs 1.31 below it.
  const inkReach = (ctx, role, text, at = 'top') => {
    const runs = runsOf(role, text);
    if (runs.length !== 1 || !runs[0].brand || !runs[0].text) return null;
    const baseline = ctx.textBaseline;
    ctx.textBaseline = at;
    use(ctx, role, 100, true);
    const m = ctx.measureText(runs[0].text);
    ctx.textBaseline = baseline;
    const above = m.actualBoundingBoxAscent / 100;
    const below = m.actualBoundingBoxDescent / 100;
    return Number.isFinite(above) && Number.isFinite(below) ? { above, below } : null;
  };
  // How far to move a line drawn with a 'middle' baseline so that the CAPITAL
  // block sits on the line's centre, as a multiple of the size; 0 unless the
  // text prints in the kit face. The canvas puts 'middle' at the centre of the
  // em box, and a face's capitals are not centred in that: Galindo's stood
  // 0.09 above it, Paytone One's 0.06 below. Capitals, not the string's own
  // ink, so two lines of one label keep one baseline whatever they contain.
  const capCentre = (ctx, role, text) => {
    const runs = runsOf(role, text);
    if (!runs.some((r) => r.brand)) return 0;
    const baseline = ctx.textBaseline;
    ctx.textBaseline = 'middle';
    use(ctx, role, 100, true);
    const m = ctx.measureText('H');
    ctx.textBaseline = baseline;
    const shift = (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 200;
    return Number.isFinite(shift) ? shift : 0;
  };
  return { measure, fill, truncate, fit, inBrand, inkReach, capCentre };
}

// ── Free-text label sizing (POST /print-custom) ──────────────────────────────
// A custom label is ONE line of operator text on an otherwise empty 4x2 label.
// It has no roster row behind it and no fixed vocabulary, so it cannot use the
// name block's ceilings: "VOLUNTEER" wants to be huge and "Wednesday Kitchen
// Team, Room 4" wants to be small, and both have to look deliberate. It is set
// in the name's voice (Paytone One, falling back to bold Helvetica/Arial).
const CUSTOM_TEXT_MAX_CHARS = 60;
const CUSTOM_TEXT_MAX_PT    = 56;
const CUSTOM_TEXT_MIN_PT    = 14;
const CUSTOM_TEXT_LINE_H    = 1.15;
// Clear paper kept between one line's lowest ink and the next line's highest,
// as a multiple of the size, when the kit face's own marks set the line pitch.
const CUSTOM_TEXT_INK_GAP   = 0.06;
const CUSTOM_TEXT_MARGIN_X  = 18;   // comfortable, not flush to the die-cut edge
const CUSTOM_TEXT_MARGIN_Y  = 16;

// Two lines out of one, broken at the space nearest the middle so the halves
// are balanced. A single unbroken token (a long room code) splits by
// character rather than overflowing the label.
function splitCustomTextInTwo(text) {
  const mid = Math.floor(text.length / 2);
  let at = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    if (at < 0 || Math.abs(i - mid) < Math.abs(at - mid)) at = i;
  }
  if (at < 0) return [text.slice(0, mid), text.slice(mid)];
  return [text.slice(0, at), text.slice(at + 1)];
}

// The distance between the baselines of a custom label's lines, as a multiple
// of the size. CUSTOM_TEXT_LINE_H is what the old bold sans needs. The kit's
// face draws marks far outside its line: a stacked Vietnamese capital (Ấ, Ế,
// Ắ) rises 1.19-1.22 em above its baseline, more than that pitch, and a dot
// below a vowel (ạ) or the tail of a g or y hangs 0.20-0.27 em under the line
// above it. So when the whole label prints in the kit face the pitch is also
// what the two lines' own ink needs, lowest ink of the line above plus highest
// of the line below plus CUSTOM_TEXT_INK_GAP, never less than the stock pitch.
// Measured off the canvas (inkReach), for the lines as they are set. A label
// in the old faces keeps CUSTOM_TEXT_LINE_H exactly.
function customLineH(ctx, type, lines) {
  let h = CUSTOM_TEXT_LINE_H;
  for (let i = 1; i < lines.length; i++) {
    const upper = type.inkReach(ctx, 'custom', lines[i - 1], 'alphabetic');
    const lower = type.inkReach(ctx, 'custom', lines[i], 'alphabetic');
    if (upper && lower) h = Math.max(h, upper.below + lower.above + CUSTOM_TEXT_INK_GAP);
  }
  return h;
}

// Start large and shrink. Only once the floor is reached does it wrap to two
// lines, because one big line reads across a room and two small ones do not.
// Returns { lines, size, lineH } in points, lineH being the baseline pitch as a
// multiple of the size (see customLineH); the height test uses it, so a pitch
// the marks widen makes the text smaller instead of running lines together.
//
// `type` must have the label's text pinned (labelType('', { custom: text })),
// so both lines, the fit and the clip measure in the one face the whole text
// gets; the default does exactly that.
function fitCustomLabelText(ctx, text, type = labelType('', { custom: text })) {
  const maxW = PAGE_W - CUSTOM_TEXT_MARGIN_X * 2;
  const maxH = PAGE_H - CUSTOM_TEXT_MARGIN_Y * 2;
  const fits = (lines, size, lineH) => {
    if (lines.length * size * lineH > maxH) return false;
    return lines.every((l) => type.measure(ctx, 'custom', size, l) <= maxW);
  };
  for (let size = CUSTOM_TEXT_MAX_PT; size >= CUSTOM_TEXT_MIN_PT; size--) {
    if (fits([text], size, CUSTOM_TEXT_LINE_H)) return { lines: [text], size, lineH: CUSTOM_TEXT_LINE_H };
  }
  const two = splitCustomTextInTwo(text);
  const twoH = customLineH(ctx, type, two);
  for (let size = CUSTOM_TEXT_MAX_PT; size >= CUSTOM_TEXT_MIN_PT; size--) {
    if (fits(two, size, twoH)) return { lines: two, size, lineH: twoH };
  }
  // Pathological input (60 characters with no space in them). Clip rather than
  // bleed off the die-cut edge: a label that runs off the paper is unreadable,
  // an ellipsis is merely shortened.
  const clipped = two.map((l) => type.truncate(ctx, 'custom', CUSTOM_TEXT_MIN_PT, l, maxW));
  return { lines: clipped, size: CUSTOM_TEXT_MIN_PT, lineH: customLineH(ctx, type, clipped) };
}

// ── Draw a rounded rectangle on canvas ───────────────────────────────────────
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ── Generate the label as a PNG ──────────────────────────────────────────────
// Returns the path to a temporary PNG file (caller must delete it).
const DPI = 300;
const PX_W = Math.round(4 * DPI);  // 1200 px
const PX_H = Math.round(2 * DPI);  // 600 px
const SCALE = DPI / 72;            // convert pt → px

// ── Prepare a club logo for 1-bit thermal output ──────────────────────────────
// A thermal printer has exactly two tones, so the driver dithers everything
// else — and dithering destroys light colors. The real failure that motivated
// this: one church's Puggles club image on TwoTimTwo is a custom upload, a
// light-cyan wordmark. Drawn as-is, the cyan dithered to (almost) nothing and
// the printed label showed only the duckling's dark eyes and beak — a tiny
// unreadable speck floating in the icon zone.
//
// So logos are converted to what the printer can actually say:
//
//   * INK   = a pixel that is opaque enough AND far enough from white. The
//     distance test is per-channel (Chebyshev), so light-but-saturated colors
//     — cyan, yellow, pink — count as ink even though their gray luminance is
//     high. That is the whole point: luminance is exactly the measure the
//     dither uses to erase them. The threshold sits at 64 so a pale wash
//     (#d0d0d0 card backgrounds and lighter) reads as PAPER, not ink — at 40
//     a pale-gray card came back as a featureless black slab that swallowed
//     the artwork inside it.
//   * Ink renders as ONE solid color. Where the source's antialiasing lives in
//     the ALPHA channel (transparent-background PNG, the extension's capture
//     format) the edge alpha is preserved and edges stay smooth like text;
//     where the source is opaque (JPEG, PNG flattened on white) the edge is
//     hard-thresholded, which is what the 1-bit printer would do to it anyway.
//     The color follows the label's palette: black on a normal label, WHITE on
//     an inverted one — the inverted icon panel is near-black, and near-black
//     prints as black, so black ink there is an invisible logo. (Both review
//     lenses caught exactly that on the first-timer label.)
//   * The result is CROPPED to the ink's bounding box, so an asset with big
//     transparent or white margins scales by its artwork, not its canvas.
//
// White-on-dark logos survive: the dark field is ink, the white lettering
// stays white. A logo with NO ink at all (all-white, all-transparent, or
// undecodable) returns null and the caller falls back to the club mark (and
// past that the monogram badge) — the icon zone never silently disappears.
// The kit's official club marks go through this same converter.
//
// POST /label (the extension's Print Dialog mode) is the surface that shows
// this output before paper. GET /preview takes no image parameter, so the
// dashboard preview always renders the club mark.
const LOGO_INK_ALPHA = 64;        // out of 255 — below this a pixel is "air"
const LOGO_INK_WHITE_DIST = 64;   // max(255-r,255-g,255-b) at or above this is ink
const LOGO_MAX_DECODE_SIDE = 2048; // bound on the scan canvas (see sniff below for decode)

// PNG dimensions live in the IHDR chunk at a fixed offset, readable without
// decoding a single pixel. loadImage() decodes at natural size, and PNG
// compresses flat color at extreme ratios — a small buffer can decode to a
// bitmap large enough to hurt, and this runs on the check-in path. Non-PNG
// formats skip the sniff (JPEG can't reach PNG's compression ratios and the
// buffer itself is already size-capped upstream); the scan canvas below is
// bounded regardless.
function pngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;   // not PNG magic
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const LOGO_MAX_SOURCE_SIDE = 8192;  // refuse to DECODE anything bigger

// Prepared once per logo and ink. A club's logo is the same bytes on every
// label of the night (and the kit's marks never change), yet each print
// decoded it, scanned it and cropped it again. Keyed by the bytes' hash, not
// the buffer, because every request arrives with its own Buffer; the result
// is only ever read (drawImage), so one shared canvas is safe.
const LOGO_PREP_MAX = 24;
const logoPrepCache = new Map();   // sha256(bytes) + ink → prepared logo (or null)
async function prepareLogoForThermal(clubImageBuffer, { ink = [0, 0, 0] } = {}) {
  if (!clubImageBuffer) return null;
  const key = `${crypto.createHash('sha256').update(clubImageBuffer).digest('hex')}:${ink.join(',')}`;
  if (logoPrepCache.has(key)) return logoPrepCache.get(key);
  const prepared = await prepareLogoForThermalNow(clubImageBuffer, { ink });
  if (logoPrepCache.size >= LOGO_PREP_MAX) logoPrepCache.delete(logoPrepCache.keys().next().value);
  logoPrepCache.set(key, prepared);
  return prepared;
}
async function prepareLogoForThermalNow(clubImageBuffer, { ink = [0, 0, 0] } = {}) {
  if (!clubImageBuffer) return null;
  const sniffed = Buffer.isBuffer(clubImageBuffer) ? pngDimensions(clubImageBuffer) : null;
  if (sniffed && Math.max(sniffed.width, sniffed.height) > LOGO_MAX_SOURCE_SIDE) {
    console.log(`[icon] Club image claims ${sniffed.width}x${sniffed.height}px — refusing to decode it`);
    return null;
  }
  let img;
  try {
    img = await loadImage(clubImageBuffer);
  } catch {
    return null;                   // undecodable — caller falls back to monogram
  }
  if (!img.width || !img.height) return null;

  // Scan at a bounded size regardless of what decoded. Downscaling before the
  // scan costs nothing visually — the icon zone is ~317 device px.
  const scanScale = Math.min(1, LOGO_MAX_DECODE_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scanScale));
  const h = Math.max(1, Math.round(img.height * scanScale));
  const scan = createCanvas(w, h);
  const sctx = scan.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(img, 0, 0, w, h);

  const data = sctx.getImageData(0, 0, w, h);
  const px = data.data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let yPix = 0; yPix < h; yPix++) {
    for (let xPix = 0; xPix < w; xPix++) {
      const i = (yPix * w + xPix) * 4;
      const a = px[i + 3];
      const whiteDist = Math.max(255 - px[i], 255 - px[i + 1], 255 - px[i + 2]);
      if (a >= LOGO_INK_ALPHA && whiteDist >= LOGO_INK_WHITE_DIST) {
        // Ink: one solid color, original alpha (keeps antialiased edges smooth).
        px[i] = ink[0]; px[i + 1] = ink[1]; px[i + 2] = ink[2];
        if (xPix < minX) minX = xPix;
        if (xPix > maxX) maxX = xPix;
        if (yPix < minY) minY = yPix;
        if (yPix > maxY) maxY = yPix;
      } else {
        px[i + 3] = 0;             // air: fully transparent
      }
    }
  }
  if (maxX < 0) return null;       // no ink anywhere — monogram is the better label

  sctx.putImageData(data, 0, 0);

  // Crop to the ink plus a 1px breath so an antialiased edge is never shaved.
  const cx = Math.max(0, minX - 1);
  const cy = Math.max(0, minY - 1);
  const cw = Math.min(w, maxX + 2) - cx;
  const ch = Math.min(h, maxY + 2) - cy;
  const out = createCanvas(cw, ch);
  out.getContext('2d').drawImage(scan, cx, cy, cw, ch, 0, 0, cw, ch);
  // width/height are scan-space (what the canvas holds); sourceWidth/Height
  // undo the scan downscale so the caller's too-small gate measures the
  // artwork's TRUE resolution — otherwise identical artwork passed or failed
  // depending on how much empty canvas happened to surround it.
  return {
    canvas: out, width: cw, height: ch,
    sourceWidth: Math.round(cw / scanScale), sourceHeight: Math.round(ch / scanScale),
  };
}

// The official club mark, rasterised and put through the thermal converter
// once per club and ink colour, then reused: the result is deterministic, and
// decoding the SVG and scanning it costs ~30 ms a label on a fast PC. Dropped
// whenever the brand kit reloads. null when the club has no mark or it would
// not draw (reported to the kit, so /health says so) — the caller then falls
// back to the monogram.
const thermalMarkCache = new Map();   // `${key}|${white}` -> prepared raster
let thermalMarkCacheGen = -1;
async function thermalClubMark(key, inkWhite) {
  if (thermalMarkCacheGen !== brand.kitGeneration()) {
    thermalMarkCache.clear();
    thermalMarkCacheGen = brand.kitGeneration();
  }
  const cacheKey = `${key}|${inkWhite ? 'white' : 'black'}`;
  if (thermalMarkCache.has(cacheKey)) return thermalMarkCache.get(cacheKey);
  const svg = brand.clubMarkSvg(key);
  if (!svg) return null;
  const gen = brand.kitGeneration();
  const mark = await prepareLogoForThermal(svg, { ink: inkWhite ? [255, 255, 255] : [0, 0, 0] });
  if (!mark) {
    brand.markFailed(key, 'decoded to no printable ink');
    return null;
  }
  // Only cache what was made from the kit that is still loaded.
  if (gen === brand.kitGeneration()) thermalMarkCache.set(cacheKey, mark);
  return mark;
}

// Render one 4x2in label to a PNG.
//
// ONE OPTIONS OBJECT, not fourteen positional parameters. The old signature was
// `generateLabel(firstName, lastName, clubName, clubImageBuffer, allergyTokens,
// handbookGroup, isBirthday, isVisitor, stepUp, stepUpNextClub, awanaShares,
// noPhoto, testBanner, extras)`, and reading a call site meant counting commas
// to find out whether the seventh `false` was isBirthday or stepUp. Two of the
// callers had already drifted: /reprint silently passed nothing for visitor,
// stepUp, awanaShares, goToLine and milestoneLine because history never stored
// them, and the connect card used to smuggle its greeting through
// `handbookGroup`, silently inheriting that field's 30-character truncation —
// fixed since by the first-class `greeting` field below.
//
// The conversion is byte-identical by construction — every default below
// matches the old parameter default — and the 18 golden-image baselines are the
// proof. They compare pixels, so a mis-mapped argument would show up as a diff
// rather than as a plausible-looking label.
//
// @param {object} input
async function generateLabel(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    // Loud rather than mysterious: a leftover positional caller would otherwise
    // render a label with a first name and nothing else, which prints and looks
    // almost right — the worst possible failure for a safety artifact.
    throw new TypeError('generateLabel() takes a single options object');
  }
  let {
    firstName, lastName, clubName, clubImageBuffer,
    allergyTokens = [], handbookGroup = '', isBirthday = false, birthdayAge = null,
    isVisitor = false,
    stepUp = false, stepUpNextClub = '', awanaShares = null, noPhoto = false,
    testBanner = false, footerText = '', greeting = '', template = null,
    streakCount = null, isNewKid = false, middleInitial = '', nameHint = '',
    extras = {}, isLeader = false,
    customText = '',
  } = input;
  // (`season` and `collectibleIndex` were inputs until the 2026-27 rebrand took
  // the seasonal motif and the collectible icon off the label. A stale caller
  // that still passes them is simply not read.)
  // Coerce the text inputs before anything calls .trim() on them. A client
  // that posts `clubName: null` (explicit null defeats the default parameter)
  // would otherwise throw deep inside layout and turn a printable label into
  // a 500 + recorded print failure.
  firstName     = String(firstName == null ? '' : firstName);
  lastName      = String(lastName  == null ? '' : lastName);
  clubName      = String(clubName  == null ? '' : clubName);
  allergyTokens = Array.isArray(allergyTokens) ? allergyTokens : [];
  handbookGroup = (handbookGroup || '').trim();
  footerText    = String(footerText == null ? '' : footerText).trim();
  // First-class greeting slot (connect cards). It renders on the same line the
  // handbook group uses, but is NOT subject to that field's 30-character cap —
  // the cap exists because a group name past 30 chars is roster noise, whereas
  // a greeting is deliberate operator copy that just needs to fit the width.
  greeting      = String(greeting == null ? '' : greeting).trim();
  // Free-text label: coerced here like every other text input, so an explicit
  // null or a number can never reach the layout maths below.
  customText    = String(customText == null ? '' : customText).trim();
  // Per-club template (#1): a constrained set of layout switches, resolved by
  // the CALLER (labelTemplateFor) and passed in — the renderer never reads
  // config. Every switch defaults to "on" and the name ceiling to 48, so a
  // missing, partial, or malformed template renders byte-identically to no
  // template at all: a broken saved template degrades to the stock label,
  // it never blocks a child's print.
  const tpl = (template && typeof template === 'object' && !Array.isArray(template)) ? template : {};
  const tplOn = (key) => tpl[key] !== false;
  const tplNameMax = (() => {
    const n = Math.round(Number(tpl.nameMaxPt));
    return (Number.isFinite(n) && n >= 18 && n <= 48) ? n : 48;
  })();
  isBirthday    = !!isBirthday;
  stepUp        = !!stepUp;
  noPhoto       = !!noPhoto;
  isLeader      = !!isLeader;
  // null / undefined / non-finite → no badge. Negative numbers are coerced
  // to nothing as well so a malformed payload doesn't print "🪙 -3".
  if (awanaShares !== null && awanaShares !== undefined) {
    const n = Number(awanaShares);
    awanaShares = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  // Birthday age (#291): the age a kid turns this week, printed beside the
  // cake. Same coercion discipline as awanaShares — a malformed birth year
  // must never print "Turning NaN". 1–21 is the plausible club range; anything
  // else (0, negative, 22+, a string, Infinity, an object) degrades to no line
  // at all, i.e. to exactly today's plain cake.
  if (birthdayAge !== null && birthdayAge !== undefined) {
    const n = Number(birthdayAge);
    birthdayAge = (Number.isFinite(n) && n >= 1 && n <= 21) ? Math.floor(n) : null;
  }
  // Streak flame (#14): same coercion discipline as awanaShares — a malformed
  // value must never print "🔥 NaN".
  if (streakCount !== null && streakCount !== undefined) {
    const n = Number(streakCount);
    streakCount = (Number.isFinite(n) && n >= 0) ? Math.floor(n) : null;
  }
  isNewKid = !!isNewKid;
  // Twin-safe fields (#13): a single initial and one short hint line, bounded
  // here so a malformed caller can't reshape the name block.
  middleInitial = String(middleInitial == null ? '' : middleInitial).trim().slice(0, 1).toUpperCase();
  nameHint      = String(nameHint == null ? '' : nameHint).trim().slice(0, 16);

  // Step-up labels are inverted (black bg, light text) and replace the
  // handbook-group line with "Stepping up to <next club>" so volunteers
  // and parents can spot graduating kids at a glance. First-timer labels
  // can borrow the same inverted palette (extras.inverted) so a visitor
  // pops out of a stack of white labels — palette only, the icon panel
  // and text lines keep their normal behavior.
  // Both palettes are thermal-first: a 1-bit printer collapses everything to
  // black or white, so every tone here is either near-black or near-white —
  // no mid-grays that would dither into speckle.
  const COLOR = (stepUp || (extras && extras.inverted)) ? {
    bg: '#000000',
    name: '#ffffff',
    last: '#e5e7eb',
    club: '#cbd5e1',
    group: '#fbbf24',                // amber draws the eye on black
    sep: '#e5e7eb',
    iconBg: '#1f2937',
    iconDivider: '#3f3f46',
    iconPlaceholder: '#d4d4d8',
    visitorBg: '#ffffff',
    visitorText: '#000000'
  } : {
    bg: '#ffffff',
    name: '#000000',
    last: '#111111',
    club: '#000000',
    group: '#333333',
    sep: '#333333',
    iconBg: '#f4f4f4',
    iconDivider: '#bbbbbb',
    iconPlaceholder: '#888888',
    visitorBg: '#000000',
    visitorText: '#ffffff'
  };

  const pngPath = tmpFilePath('awana', 'png');

  // ── Free-text label (POST /print-custom) ──────────────────────────────────
  // One auto-sized line of operator text, centered, black on white, and
  // NOTHING else: no badge outline, no icon panel, no club line, no greeting,
  // no footer, no safety icons, no wordmark. A custom label has no child
  // behind it, so anything that looks like a check-in label would be a lie on
  // a safety artifact.
  //
  // It returns BEFORE all the layout below rather than switching a dozen
  // elements off one at a time, so an element added to the stock label later
  // is absent here automatically, with nothing to remember.
  //
  // No TEST band either, even in rehearsal: the band means "this is not a real
  // check-in", and a custom label never was one in any mode.
  if (customText) {
    const cvs = createCanvas(PX_W, PX_H);
    const cctx = cvs.getContext('2d');
    cctx.scale(SCALE, SCALE);
    cctx.fillStyle = '#ffffff';
    cctx.fillRect(0, 0, PAGE_W, PAGE_H);
    // Pinned to the WHOLE text: one face for every line, decided before the
    // text is wrapped (see labelType).
    const customType = labelType('', { custom: customText });
    const layout = fitCustomLabelText(cctx, customText, customType);
    cctx.fillStyle = '#000000';
    cctx.textAlign = 'center';
    cctx.textBaseline = 'middle';
    const lineH = layout.size * layout.lineH;
    // 'middle' is the centre of the em box, not of the capitals; the kit face
    // is moved so the capitals sit on the label's centre (see capCentre).
    const capShift = customType.capCentre(cctx, 'custom', customText) * layout.size;
    const firstY = PAGE_H / 2 - ((layout.lines.length - 1) * lineH) / 2 + capShift;
    layout.lines.forEach((line, i) =>
      customType.fill(cctx, 'custom', layout.size, line, PAGE_W / 2, firstY + i * lineH));
    const customBuffer = cvs.toBuffer('image/png');
    fs.writeFileSync(pngPath, customBuffer);
    return { pngPath, buffer: customBuffer };
  }

  const canvas = createCanvas(PX_W, PX_H);
  const ctx = canvas.getContext('2d');
  // The kit's voices for this label, each with the club's old font behind it.
  const type = labelType(clubName);

  // Scale all drawing from points to pixels
  ctx.scale(SCALE, SCALE);

  // Background
  ctx.fillStyle = COLOR.bg;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  // On step-up labels, drop the club icon entirely — the kid is leaving
  // that club, and the wider text area makes the message more obvious.
  // Otherwise the icon panel exists for any recognized club: it shows the
  // real TwoTimTwo club logo when the client supplied one, the official
  // one-colour club mark from the brand kit when it did not (or the logo was
  // unusable), and the letter monogram as the last resort, so the icon zone
  // never silently disappears.
  const hasLogo     = !stepUp && !!clubImageBuffer && tplOn('showIconPanel');
  const hasEmblem   = !stepUp && !hasLogo && !!CLUB_MONOGRAM[clubKey(clubName)] && tplOn('showIconPanel');
  const hasIcon     = hasLogo || hasEmblem;
  // A no-photo label's content stops short of its edge bar: `bw` is the
  // badge's width for everything drawn on it (the outline and the icon
  // panel's clip keep the full BW; the bar covers that end of them).
  const barCut  = noPhoto ? NO_PHOTO_CUT : 0;
  const bw      = BW - barCut;
  const textX   = hasIcon ? TEXT_X : BX + 10;
  const textW   = hasIcon ? TEXT_W - barCut : bw - 20;

  // ── Badge border (no outline) ─────────────────────────────────────────────
  roundedRect(ctx, BX, BY, BW, BH, CORNER);

  // ── Left icon panel ───────────────────────────────────────────────────────
  // Tracked OUTSIDE the panel block: the text area below prints the club name
  // only when neither a real logo nor the official mark made it onto the
  // label, and a supplied-but-rejected logo (too small, undecodable) must count
  // as "no logo" there too.
  let logoDrawn = false;
  let markDrawn = false;
  if (hasIcon) {
    // The column's right edge is the catalog's wave, not a ruled line: filled
    // in the panel tone, and traced once more in the old divider's hairline so
    // the edge still exists on paper (the pale fill all but vanishes on a
    // thermal head).
    ctx.save();
    roundedRect(ctx, BX, BY, BW, BH, CORNER);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(BX, BY);
    traceIconWave(ctx, BY, BH, false);
    ctx.lineTo(BX, BY + BH);
    ctx.closePath();
    ctx.fillStyle = COLOR.iconBg;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(BX, BY + 12, ICON_COL_W + ICON_WAVE_MAX_DX + 2, BH - 24);
    ctx.clip();
    ctx.beginPath();
    traceIconWave(ctx, BY, BH, true);
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = COLOR.iconDivider;
    ctx.stroke();
    ctx.restore();

    // Club icon image (76×76 pt max, centred in the icon zone)
    const iconSize = 76;
    const iconX = BX + (ICON_COL_W - iconSize) / 2;
    const iconY = BY + (BH - iconSize) / 2;
    // Ink follows the palette: on an inverted label the icon panel prints
    // black, so the art must be white there or it vanishes into its own
    // background.
    const inkWhite = Boolean(extras && extras.inverted);
    const ink = inkWhite ? [255, 255, 255] : [0, 0, 0];
    // Preserve aspect ratio within the 76pt square. Post-crop this is the
    // aspect of the ARTWORK — a wordmark on a padded square canvas used to fit
    // by its padding and shrink the art; now it fits by the art itself.
    const drawArt = (art) => {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const aspect = art.width / art.height;
      let drawW = iconSize, drawH = iconSize;
      if (aspect > 1) { drawH = iconSize / aspect; }
      else { drawW = iconSize * aspect; }
      const dx = iconX + (iconSize - drawW) / 2;
      const dy = iconY + (iconSize - drawH) / 2;
      ctx.drawImage(art.canvas, dx, dy, drawW, drawH);
    };
    if (hasLogo) {
      // Crop to the artwork and binarize for thermal — see
      // prepareLogoForThermal. A null result (undecodable, or no ink at all)
      // falls through to the official mark below.
      const logo = await prepareLogoForThermal(clubImageBuffer, { ink });
      if (logo) {
        // The icon zone is 76pt ≈ 317 device px at 300 DPI. A logo whose
        // ARTWORK (post-crop — a small graphic on a big padded canvas no
        // longer gets credit for the padding) is much smaller than that
        // (the pre-5.5 extension captured club images at 64×64) would be
        // upscaled 4–5×, and the thermal printer then dithers the blurry
        // antialiased edges into speckle — the printed result is
        // recognisably worse than no logo at all. Below half the target
        // resolution, the vector mark (or the solid-ink monogram) is the
        // better label: skip the image and fall through to it.
        const targetPx = iconSize * SCALE;
        if (Math.max(logo.sourceWidth, logo.sourceHeight) >= targetPx / 2) {
          drawArt(logo);
          logoDrawn = true;
        } else {
          console.log(`[icon] Club artwork is ${logo.sourceWidth}x${logo.sourceHeight}px after cropping — too small for a ${Math.round(targetPx)}px icon zone, using the club mark instead`);
        }
      }
    }
    if (!logoDrawn) {
      // The official one-colour club mark (brand kit, logos/*-black.svg):
      // vector, so it rasterises crisply at icon size, and put through the
      // SAME thermal converter as a downloaded logo (cropped to its ink, one
      // solid ink colour, re-inked white on an inverted label). Fails open: a
      // missing or undecodable mark falls through to the monogram.
      const key = clubKey(clubName);
      const mark = await thermalClubMark(key, inkWhite);
      if (mark) {
        drawArt(mark);
        markDrawn = true;
      }
    }
    if (!logoDrawn && !markDrawn) {
      // Monogram badge, the last resort: solid disc + club initials in the
      // shout voice. Solid ink stays crisp on thermal output where a
      // grayscale logo placeholder would just dither away.
      const monogram = CLUB_MONOGRAM[clubKey(clubName)] || '?';
      const cx = BX + ICON_COL_W / 2;
      const cy = BY + BH / 2;
      const radius = 28;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.name;
      ctx.fill();
      const mSize = type.fit(ctx, 'monogram', monogram, radius * 1.5, 30, 12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = COLOR.bg;
      // The kit face is centred on its capitals; the old face keeps the
      // 1 pt nudge it always had.
      const mCentre = type.inBrand('monogram', monogram)
        ? cy + type.capCentre(ctx, 'monogram', monogram) * mSize
        : cy + 1;
      type.fill(ctx, 'monogram', mSize, monogram, cx, mCentre);
      ctx.textBaseline = 'top';  // restore default used by the text area
    }
  }

  // ── Text area ─────────────────────────────────────────────────────────────
  // On step-up labels, the handbook group line is replaced with the
  // "Stepping up to <next club>" callout — always show that line.
  const stepUpGroupText = stepUp ? ('Stepping up to ' + (stepUpNextClub || 'next club')) : '';
  const hasLast  = lastName.trim().length > 0 && tplOn('showLastName');
  // A real logo or the official mark self-identifies the club, so the text
  // line is redundant; a monogram badge is only initials, so keep the club
  // name printed too. logoDrawn/markDrawn, not hasLogo: a supplied logo that
  // was rejected (too small to print cleanly, failed to decode) fell back to
  // the mark, or to the monogram, and the label must then carry the club name
  // in text like any other monogram label.
  const hasClub  = clubName.trim().length > 0 && !logoDrawn && !markDrawn && tplOn('showClubLine');
  // The step-up callout and a connect-card greeting always show — a template
  // only suppresses the roster-derived handbook-group line.
  const hasGroup = stepUp ? !!stepUpGroupText
    : (greeting.length > 0 || (handbookGroup.length > 0 && tplOn('showGroupLine')));
  const hasAllergy = allergyTokens.length > 0;
  // The trophy band (#293) takes the footer's slot rather than adding a fourth
  // bottom-left line: the stack tops out at three before it crowds the name
  // block, and the operator footer is branding while the band is the news.
  const hasFooter = footerText.length > 0 && tplOn('showFooter') && !(extras && extras.trophyBand);

  // Reserve room for the bottom band: right side is the coin/cake/allergy icon
  // row, left side is the goTo/milestone/footer stack. 20pt covers the icon row
  // or one text line; each additional bottom-left line stacks 13pt higher. The
  // goTo/milestone lines used to skip this reservation as "rare and short", but
  // the moment two bottom lines coexist (a connect card's schedule line over a
  // footer) the centered block sat right on top of them.
  const hasIconRowGlyphs = hasAllergy || isBirthday || awanaShares != null || noPhoto || streakCount != null || isNewKid;
  const bottomLineCount = ((extras && extras.trophyBand) ? 1 : 0)
    + ((extras && extras.goToLine) ? 1 : 0)
    + ((extras && extras.milestoneLine) ? 1 : 0)
    + (hasFooter ? 1 : 0);
  const ALLERGY_STRIP_H = Math.max(
    hasIconRowGlyphs ? 20 : 0,
    bottomLineCount > 0 ? 7 + bottomLineCount * 13 : 0
  );

  // Birthday age line (#291): a few words beside the cake, so the icon becomes
  // a conversation instead of a silent glyph. Gated on isBirthday a SECOND time
  // here — the age is an annotation ON the cake, never a standalone line, so a
  // caller passing birthdayAge with isBirthday:false renders byte-identically
  // to no age at all.
  const AGE_TEXT_SIZE = 10;
  const ageFull  = (isBirthday && birthdayAge != null) ? `Turning ${birthdayAge} this week!` : '';
  const ageShort = ageFull ? `Turning ${birthdayAge}!` : '';
  // How much of the bottom band the right-anchored icon row may occupy before
  // it would run into the icon panel (or the badge's left padding when there
  // is none). 178pt with a panel present.
  const ICON_ROW_MAX_W = (BX + bw - 6) - (hasIcon ? TEXT_X : BX + 8);

  // Twin-safe (#13): the middle initial rides the first-name line so the
  // width fit below accounts for it; the birth-month hint is its own small
  // line under the last name.
  const displayFirst = middleInitial ? `${firstName} ${middleInitial}.` : firstName;
  const hasHint = nameHint.length > 0;

  // Font sizes (in pt)
  const NAME_FLOOR_PT = 18;
  let fs1 = type.fit(ctx, 'name', displayFirst, textW, tplNameMax, NAME_FLOOR_PT);
  const fs2 = 20;
  const fs3 = 12;
  const fs4 = 10;
  const fs5 = 9;
  const GAP = 4;
  const SEP = 9;
  // The first name's box, as multiples of its size. The old Windows faces keep
  // their descenders inside the em box, so the box was the size itself (1.0)
  // and the line was drawn at its top. The kit's face is drawn NAME_LIFT_BRAND
  // above the top of its box (see the constants) and has a box of its own.
  // Beyond that, the name's own ink is measured, so a glyph that reaches past
  // the box makes room instead of being clipped by the paper's edge above or
  // printed over the last name below: an accented capital (É, Ấ) rises past
  // the top, and the comma of Ș and Ț, or a cedilla or ogonek, hangs past the
  // bottom. An ordinary name reaches neither, so those two are 0 and the
  // layout is the same for every plain name.
  const nameBrand = type.inBrand('name', displayFirst);
  const nameLineH = nameBrand ? NAME_LINE_H_BRAND : 1;
  const nameLift = nameBrand ? NAME_LIFT_BRAND : 0;
  const reach = nameBrand ? type.inkReach(ctx, 'name', displayFirst) : null;
  const nameRoomAbove = reach ? Math.max(0, nameLift + reach.above) : 0;
  const nameRoomBelow = reach ? Math.max(0, reach.below - nameLift - nameLineH) : 0;
  // The box the block is built from is the line and the room below it. The room
  // ABOVE is not part of it: the paper above the block gives some of it for
  // free, and only what it cannot give is charged to the block (accentCharge).
  const nameBoxH = nameLineH + nameRoomBelow;
  // Block tops never go above BY + 2, and the ink may rise to NAME_INK_TOP, so
  // that much of a rising mark's room is already there.
  const ACCENT_FREE = BY + 2 - NAME_INK_TOP;
  const accentCharge = (size) => Math.max(0, nameRoomAbove * size - ACCENT_FREE);

  let blockH = fs1 * nameBoxH;
  if (hasLast)     blockH += GAP + fs2;
  if (hasHint)     blockH += 2 + fs5;
  if (hasClub)     blockH += SEP + fs3;
  if (hasGroup)    blockH += GAP + fs4;
  // Birthday no longer consumes vertical space in the centered text block —
  // it renders as a 🍰 emoji in the bottom-right corner alongside allergies.

  const usableH = BH - ALLERGY_STRIP_H;
  // Height-fit: a crowded label (name + last + club + group over a stacked
  // bottom band) shrinks the FIRST NAME rather than descending into the band —
  // blockH is linear in fs1 (slope nameBoxH), so the overflow maps straight
  // onto the size reduction. Floor of 18 matches the width fit's floor; past
  // that, the clamp on y below keeps the block on the badge and any residual
  // crowding lands at the bottom, where it degrades legibility instead of
  // clipping the name.
  //
  // A rising mark's room is charged to the block only beyond what the paper
  // above gives free (accentCharge), so the block is piecewise linear in fs1:
  // the room costs nameRoomAbove per pt of size while it is charged and
  // nothing once it fits in the free margin. An ordinary name has no room
  // above, no charge, and the fit is exactly the one it always was.
  // How much smaller the name must be for the block, and the charge, to fit in
  // `room`.
  const reduceFor = (room) => {
    const over = blockH + accentCharge(fs1) - room;
    if (!(over > 0)) return 0;
    const charged = nameRoomAbove * fs1 > ACCENT_FREE;
    const reduce = over / (nameBoxH + (charged ? nameRoomAbove : 0));
    // Shrinking far enough to bring the mark inside the free margin drops the
    // charge before the overflow is gone: from there on the slope is the box's
    // alone, so it is worked out without the charge.
    return charged && nameRoomAbove * (fs1 - reduce) < ACCENT_FREE
      ? (blockH - room) / nameBoxH
      : reduce;
  };
  {
    const reduce = Math.min(reduceFor(usableH), fs1 - NAME_FLOOR_PT);
    if (reduce > 0) { fs1 -= reduce; blockH -= reduce * nameBoxH; }
  }
  // ...and past the floor, room the name asks for must not make the crowding
  // at the bottom worse than an ordinary name's already is. An ordinary name
  // sits on the floor and leaves what it leaves; a name with a mark above or a
  // comma below asks for more, and the extra used to land on the bottom band
  // (a step-up callout printed over the trophy chip). So it gives that much
  // back in size instead, a few pt under the floor at most.
  if (nameRoomAbove > 0 || nameRoomBelow > 0) {
    const rest = blockH - fs1 * nameBoxH;
    const ordinaryLeftover = Math.max(0, NAME_FLOOR_PT * nameLineH + rest - usableH);
    const more = Math.min(reduceFor(usableH + ordinaryLeftover), NAME_ROOM_SHRINK_MAX);
    if (more > 0) { fs1 -= more; blockH -= more * nameBoxH; }
  }

  const centerY = BY + usableH / 2;
  // The top of the first name's line box. The block is centred as if its whole
  // room above were part of it (so a label with space to spare is laid out as
  // it always was) but never higher than the charge allows: the ink of a rising
  // mark stays NAME_INK_TOP or more from the paper's top edge.
  const roomAbovePt = nameRoomAbove * fs1;
  let y = Math.max(BY + 2 + accentCharge(fs1), centerY - blockH / 2 + roomAbovePt / 2);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const textCenterX = textX + textW / 2;

  // ── First name ────────────────────────────────────────────────────────────
  const safeFirst = type.truncate(ctx, 'name', fs1, displayFirst, textW);
  ctx.fillStyle = COLOR.name;
  type.fill(ctx, 'name', fs1, safeFirst, textCenterX, y - nameLift * fs1);
  y += fs1 * nameBoxH;

  // ── Last name ─────────────────────────────────────────────────────────────
  if (hasLast) {
    y += GAP;
    const safeLast = type.truncate(ctx, 'last', fs2, lastName, textW);
    ctx.fillStyle = COLOR.last;
    type.fill(ctx, 'last', fs2, safeLast, textCenterX, y);
    y += fs2;
  }

  // ── Twin hint (#13) ───────────────────────────────────────────────────────
  // A whisper under the name — "b. Mar" — only present when two active roster
  // kids share this exact name and no middle initial could split them.
  if (hasHint) {
    y += 2;
    ctx.fillStyle = COLOR.club;
    type.fill(ctx, 'hint', fs5, type.truncate(ctx, 'hint', fs5, nameHint, textW), textCenterX, y);
    y += fs5;
  }

  // ── Club name with separator ──────────────────────────────────────────────
  if (hasClub) {
    y += 4;
    // Solid 1pt rule — gradients dither to noise on thermal output
    const sepMargin = textW * 0.1;
    ctx.beginPath();
    ctx.moveTo(textX + sepMargin, y + 0.5);
    ctx.lineTo(textX + textW - sepMargin, y + 0.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLOR.sep;
    ctx.stroke();
    y += 5;
    const safeClub = type.truncate(ctx, 'club', fs3, clubName, textW);
    ctx.fillStyle = COLOR.club;
    type.fill(ctx, 'club', fs3, safeClub, textCenterX, y);
    y += fs3;
  }

  // ── Handbook group / step-up callout ──────────────────────────────────────
  if (hasGroup) {
    y += GAP;
    let groupStr = stepUp
      ? stepUpGroupText
      : greeting
        ? greeting   // width-fitted by type.truncate below, no 30-char cap
        : (handbookGroup.length > 30 ? handbookGroup.slice(0, 29) + '…' : handbookGroup);
    const groupRole = stepUp ? 'stepUp' : 'group';
    // The bottom-right icon row is right-anchored on the same band this line
    // occupies, so a centered group ran straight under the icons — the handbook
    // group is what sends a child to the right table, so it must stay readable.
    // Reserve the icon row's width on the right and centre what's left.
    const iconCount = allergyTokens.length + (isBirthday ? 1 : 0) +
      (noPhoto ? 1 : 0) + (awanaShares != null ? 1 : 0) + (streakCount != null ? 1 : 0) +
      (isNewKid ? 1 : 0);
    // The age words (#291) sit in that same right-anchored row and are much
    // wider than an icon slot (~89pt, roughly 3.5 slots), so they have to be
    // measured rather than estimated — otherwise the handbook group runs
    // straight under them, the exact collision this reservation exists for.
    const iconReserve = iconCount > 0 ? iconCount * 25 + 10 : 0;
    let ageReserve = 0;
    if (ageFull) {
      // Bounded by what is actually LEFT of the band: when the icons alone
      // already fill it, the ladder below will drop the words, and reserving
      // for text that never gets drawn would truncate this line for nothing.
      ageReserve = Math.max(0, Math.min(
        type.measure(ctx, 'age', AGE_TEXT_SIZE, ageFull) + 3, ICON_ROW_MAX_W - iconReserve));
    }
    const reservedRight = iconReserve + ageReserve;
    const groupMaxW = Math.max(40, textW - reservedRight);
    const groupCenterX = textCenterX - reservedRight / 2;
    groupStr = type.truncate(ctx, groupRole, fs4, groupStr, groupMaxW);
    ctx.fillStyle = COLOR.group;
    type.fill(ctx, groupRole, fs4, groupStr, groupCenterX, y);
    y += fs4;
  }

  // ── Visitor / leader badge ────────────────────────────────────────────────
  // Same top-right pill, one string swap. The LEADER pill is the identity of a
  // leader name tag, not a decoration, so it is not subject to the per-club
  // template's showVisitorPill switch.
  const pillText = isLeader ? 'LEADER' : ((isVisitor && tplOn('showVisitorPill')) ? 'VISITOR' : '');
  if (pillText) {
    const vText = pillText;
    const vWidth = type.measure(ctx, 'pill', fs5, vText);
    const vPad = 4;
    const vX = BX + bw - vPad - vWidth - 8;
    const vY = BY + vPad;
    // Rounded pill background — invert on step-up so it stays readable
    ctx.fillStyle = COLOR.visitorBg;
    roundedRect(ctx, vX - vPad, vY - 1, vWidth + vPad * 2, fs5 + 4, 4);
    ctx.fill();
    ctx.fillStyle = COLOR.visitorText;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    type.fill(ctx, 'pill', fs5, vText, vX, vY + 1);
    // Reset alignment
    ctx.textAlign = 'center';
  }

  // ── Bottom-right row: coin shares · cake birthday · allergy icons ─────────
  // Icons only along the bottom edge — no words. Allergens render as emoji
  // glyphs, sized up so they stay recognizable on 1-bit thermal output.
  // Where the icon row begins (its leftmost pixel) — the bottom-left text lines
  // below truncate against THIS, not a guessed fraction of the badge, so a wide
  // allergy row and a footer can share the band without colliding. Defaults to
  // the badge's right padding edge when there is no icon row at all.
  let iconRowLeftX = BX + bw - 8;
  if (hasIconRowGlyphs) {
    const EMOJI_SIZE         = 16;
    const ALLERGY_EMOJI_SIZE = 22;
    const BDAY_EMOJI_SIZE    = 26;
    const EMOJI_FONT_STACK = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    const PAD     = 6;
    const SPACING = 3;
    // The icons are emoji in the system's emoji font, exactly as before the
    // kit; no kit font weight may leak into them.
    const useEmoji = (size) => {
      ctx.font = `${size}px ${EMOJI_FONT_STACK}`;
      ctx.fontVariationSettings = 'normal';
    };

    // Build ordered glyph list, leftmost first:
    //   coin-emoji + N (shares)  ->  cake (birthday)  ->  allergy icons
    const glyphs = [];
    if (awanaShares != null) {
      // Coin emoji (U+1FA99) + space + ASCII digits. The font stack
      // falls back to sans-serif for the digits, no extra font wiring.
      glyphs.push({ ch: '🪙 ' + awanaShares, size: EMOJI_SIZE });
    }
    if (streakCount != null) {
      // Flame + attendance streak (#14) - same coin-badge pattern.
      glyphs.push({ ch: '🔥 ' + streakCount, size: EMOJI_SIZE });
    }
    if (isNewKid) {
      // Sparkle (#15): the kid's first two club weeks, so leaders learn the
      // new names fast. Subtle by design - no text, small glyph.
      glyphs.push({ ch: '✨', size: EMOJI_SIZE });
    }
    let ageGlyph = null;
    if (isBirthday) {
      glyphs.push({ ch: '🍰', size: BDAY_EMOJI_SIZE });
      if (ageFull) {
        // Right of the cake (#291), so the allergy/no-photo safety icons keep
        // their familiar right-edge positions and the row reads "🍰 Turning 7
        // this week!". Set in the label's read voice, not the emoji stack —
        // that would rasterise the words with whatever fallback it reaches.
        ageGlyph = { ch: ageFull, size: AGE_TEXT_SIZE, words: true };
        glyphs.push(ageGlyph);
      }
    }
    allergyTokens.forEach(function(t) {
      glyphs.push({ ch: ALLERGY_EMOJI[t] || '⚠', size: ALLERGY_EMOJI_SIZE });
    });
    if (noPhoto) {
      // Camera emoji with a slash drawn over it — "do not photograph".
      glyphs.push({ ch: '📷', size: ALLERGY_EMOJI_SIZE, slash: true });
    }

    // Measure each glyph under its own font so we can right-anchor the row.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let totalW = 0;
    glyphs.forEach(function(g, i) {
      if (g.words) {
        g.w = type.measure(ctx, 'age', g.size, g.ch);
      } else {
        useEmoji(g.size);
        g.w = ctx.measureText(g.ch).width;
      }
      totalW += g.w;
      if (i < glyphs.length - 1) totalW += SPACING;
    });

    // Width ladder for the age words (#291): full string, then a short form,
    // then nothing. The CAKE never goes, and neither does any allergy or
    // no-photo glyph — those are safety content. Only the words yield, so a
    // crowded label degrades to exactly today's icon row.
    if (ageGlyph && totalW > ICON_ROW_MAX_W) {
      const shortW = type.measure(ctx, 'age', ageGlyph.size, ageShort);
      if (totalW - ageGlyph.w + shortW <= ICON_ROW_MAX_W) {
        totalW += shortW - ageGlyph.w;
        ageGlyph.ch = ageShort;
        ageGlyph.w = shortW;
      } else {
        // The age is never the only glyph — the cake is always beside it — so
        // dropping it always removes exactly one SPACING as well.
        totalW -= ageGlyph.w + SPACING;
        glyphs.splice(glyphs.indexOf(ageGlyph), 1);
        ageGlyph = null;
      }
    }

    let ex = BX + bw - PAD - totalW;
    iconRowLeftX = ex;
    const ey = BY + BH - PAD;  // shared baseline along the bottom padding line
    glyphs.forEach(function(g) {
      ctx.fillStyle = COLOR.name;  // share digits must stay light on step-up
      if (g.words) {
        type.fill(ctx, 'age', g.size, g.ch, ex, ey);
      } else {
        useEmoji(g.size);
        ctx.fillText(g.ch, ex, ey);
      }
      if (g.slash) {
        // Diagonal bar corner-to-corner across the glyph box
        ctx.save();
        ctx.strokeStyle = COLOR.name;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex + 1, ey + 1);
        ctx.lineTo(ex + g.w - 1, ey - g.size + 3);
        ctx.stroke();
        ctx.restore();
      }
      ex += g.w + SPACING;
    });

    // Reset text state for any subsequent drawing
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
  }

  // ── Routing / milestone lines (bottom-left, above the icon row) ──────────
  // goToLine: late check-in routing from the group schedule ("Go to: Music,
  // Room 4"). milestoneLine: attendance milestones ("10th club night!").
  // Anchored bottom-left so they never collide with the bottom-right icons.
  const extraLines = [];
  // trophyBand (#293): "Finished Sparks Wingrunner", drawn as an inverse chip
  // so the room notices it from across the lobby. Pushed FIRST so the reversed
  // draw below puts it highest in the stack, closest to the name.
  if (extras && extras.trophyBand) extraLines.push({ text: String(extras.trophyBand).slice(0, 48), role: 'band', band: true });
  if (extras && extras.goToLine) extraLines.push({ text: String(extras.goToLine).slice(0, 48), role: 'goTo' });
  if (extras && extras.milestoneLine) extraLines.push({ text: String(extras.milestoneLine).slice(0, 48), role: 'milestone' });
  // Operator-configured footer (#8: church name, a verse, service times) —
  // pushed last so the reversed draw below puts it at the very bottom, under
  // any routing/milestone lines. Its own lighter weight so it reads as
  // branding, not routing (it was italic in the old fonts).
  if (hasFooter) extraLines.push({ text: footerText.slice(0, 48), role: 'footer' });
  if (extraLines.length) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lineX = hasIcon ? DIVIDER_X + 8 : BX + 8;
    // Truncate against where the bottom-right icon row actually begins (or the
    // badge edge when there is none) rather than a guessed fraction of the
    // badge — the old flat 55% cap both wasted half the band on icon-less
    // labels and still collided under a five-allergy icon row. The 40pt floor
    // keeps at least a word visible against a pathologically wide row.
    const maxW = Math.max(40, iconRowLeftX - lineX - 4);
    let ly = BY + BH - 6;
    for (const line of extraLines.reverse()) {
      // The band reuses the visitor pill's inverse pair, so it stays readable
      // on an inverted (first-timer / award) label as well as a white one.
      const drawn = type.truncate(ctx, line.role, 10, line.text, line.band ? maxW - 8 : maxW);
      if (line.band) {
        const bandW = type.measure(ctx, line.role, 10, drawn);
        ctx.fillStyle = COLOR.visitorBg;
        roundedRect(ctx, lineX - 3, ly - 9, bandW + 6, 12, 3);
        ctx.fill();
        ctx.fillStyle = COLOR.visitorText;
      } else {
        ctx.fillStyle = COLOR.group;
      }
      type.fill(ctx, line.role, 10, drawn, lineX, ly);
      ly -= 13;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
  }

  // ── No-photo edge bar ─────────────────────────────────────────────────────
  // Drawn after the content (nothing reaches it; this is belt and braces) and
  // before the TEST band, which must stay readable across the whole label.
  if (noPhoto) {
    ctx.fillStyle = COLOR.name;
    ctx.fillRect(PAGE_W - NO_PHOTO_BAR_W, 0, NO_PHOTO_BAR_W, PAGE_H);
  }

  // ── TEST overlay (canary labels) ──────────────────────────────────────────
  // A bold diagonal band so a canary print can never be mistaken for a real
  // check-in label. Solid black band + white text stays crisp on 1-bit
  // thermal output.
  if (testBanner) {
    ctx.save();
    ctx.translate(PAGE_W / 2, PAGE_H / 2);
    ctx.rotate(-0.18);
    const bandW = PAGE_W * 1.2;
    const bandH = 30;
    ctx.fillStyle = COLOR.name;
    ctx.fillRect(-bandW / 2, -bandH / 2, bandW, bandH);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.bg;
    type.fill(ctx, 'test', 20, 'TEST — NOT A CHECK-IN', 0, 1);
    ctx.restore();
    ctx.textBaseline = 'top';
  }

  // Write PNG
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

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
function withPrinter(fn) {
  const run = printerChain.then(fn, fn);
  printerChain = run.catch(() => {});
  return run;
}

function printImage(imagePath, printerName) {
  return withPrinter(() => printImageNow(imagePath, printerName));
}

async function printImageNow(imagePath, printerName) {
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

  const psPath = tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    // One retry on failure: transient spooler errors (printer waking from
    // sleep, USB renegotiation) routinely succeed on a second attempt. The
    // child must not be sent away label-less over a hiccup.
    let lastErr = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await runPowerShell(['-File', psPath], { timeout: 15000 });
        if (result && result.trim()) console.log('[print] PowerShell:', result.trim());
        return;
      } catch (e) {
        lastErr = e;
        if (attempt < 2) {
          console.warn(`[print] Attempt ${attempt} failed (${e.message.split('\n')[0]}) — retrying in 750ms`);
          await sleep(750);
        }
      }
    }
    throw lastErr;
  } finally {
    fs.unlink(psPath, () => {});
  }
}

// ── Where a label goes: the 4×2 label printer (and its backup) ────────────────
// Every label print in this file goes through printLabel(). It is printImage()
// on the name tag printer; if that fails and a backup printer is set (and
// Windows says it is there), the same label prints on the backup, so no child
// misses a tag. Only when both fail does the caller see an error, and it
// records the failure as it always has (the dashboard's failures list and its
// Reprint button). The receipt-printer trial (Star / Rongta, 6.22-7.16) is
// gone (owner, 2026-10-08): its config keys are ignored and dropped on the
// next save (RETIRED_PRINTER_KEYS).

// Is the named printer installed and not offline? On Windows a job sent to a
// disconnected USB printer just waits in the queue, which would look like
// success while the child walks away with nothing. Off Windows (tests) or if
// the query itself fails, assume yes and let printImage() be the judge.
async function fallbackPrinterReady(name) {
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

// Settings the receipt trial wrote. Nothing reads them; POST /config drops
// them, so the next save leaves a clean file.
const RETIRED_PRINTER_KEYS = ['printerType', 'receiptHost', 'receiptPort', 'receiptDots', 'receiptCut', 'receiptPrinterName'];

// The backup printer ("If it fails, print on", 6.26.0): set on the dashboard
// beside the name tag printer, '' for none. Never the retired receipt printer
// (a receipt-mode config could name the Star as its own backup).
function backupPrinter() {
  const backup = String(config.backupPrinterName || '').trim();
  const retired = String(config.receiptPrinterName || '').trim();
  if (backup && retired && backup.toLowerCase() === retired.toLowerCase()) return '';
  return backup;
}

// Where labels print, in words, for the extension's panel and the dashboard.
function printingTarget() {
  return { kind: 'label', name: PRINTER_NAME || null, backup: backupPrinter() || null };
}

let lastLabelBackup = null;   // { at, error, to } when a print fell back; cleared by the next good print

async function printLabel(pngPath, printerName) {
  try {
    await printImage(pngPath, printerName);
    lastLabelBackup = null;
    return { via: 'label' };
  } catch (e) {
    const backup = backupPrinter();
    const main = String(printerName || PRINTER_NAME || '').trim();
    if (!backup || backup.toLowerCase() === main.toLowerCase()
      || !isSafePrinterName(backup) || !(await fallbackPrinterReady(backup))) throw e;
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

// ── Musical printer (#11/#12) ─────────────────────────────────────────────────
// A thermal label printer is a stepper motor with a paper supply, and stepper
// pitch tracks step rate: vary the feed SPEED and the motor sings. TSPL-family
// printers (the club's Phomemo/Omezizy D450-class speaks it over USB) accept
// per-command SPEED changes, so a "tune" is a sequence of SPEED+FEED pairs sent
// as RAW bytes past the Windows driver, ending in one fast BACKFEED that
// returns the media to (near) its start — a final swoop note that also keeps
// stock use at zero-ish.
//
// Hard rules: the raw path NEVER touches normal label printing (its own temp
// file, its own PowerShell script, failures logged and swallowed), and the
// whole feature sits behind config.musicalPrinter — off by default, because
// raw bytes at an unknown printer model are a party trick, not a guarantee.
const TUNES = {
  // [speed ips, seconds] per note. Pitch tracks speed; duration is
  // feed-length/speed. Speeds stay in the D450-class's 1–6 range.
  arpeggio:    [[2, 0.18], [3, 0.18], [4, 0.18], [6, 0.28]],
  charge:      [[3, 0.14], [4, 0.14], [5, 0.14], [6, 0.22], [5, 0.14], [6, 0.30]],
  westminster: [[5, 0.22], [3, 0.22], [4, 0.22], [2, 0.34], [2, 0.22], [4, 0.22], [5, 0.22], [3, 0.34]],
  // "Hap-py birth-day to you" — G G A G C B mapped onto the motor's low
  // speeds (1 1 2 1 3 2) so the whole phrase fits the feed cap: low speed =
  // fewer dots per second of sound, which is what buys six notes.
  birthday:    [[1, 0.15], [1, 0.15], [2, 0.22], [1, 0.22], [3, 0.17], [2, 0.22]],
};
const TUNE_NAMES = Object.keys(TUNES);
// The per-label rotation deliberately excludes 'birthday' — that one is
// reserved for a birthday kid's label, so hearing it MEANS something.
const TUNE_ROTATION = ['arpeggio', 'charge', 'westminster'];
const TSPL_DPI = 203;                 // D450-class print head
const TUNE_MAX_FEED_DOTS = 400;       // hard cap ≈ 2in of forward feed

// Cycle tunes per LABEL (operator request — was per day): every print gets
// the next tune in rotation, so a batch of siblings plays a little medley.
let tuneCursor = 0;
function nextTuneName() {
  const name = TUNE_ROTATION[tuneCursor % TUNE_ROTATION.length];
  tuneCursor++;
  return name;
}

// Compile a tune to a TSPL program. Pure and exported: the byte stream is the
// unit-testable artifact, since nobody wants CI to need a singing printer.
function buildTuneTspl(tuneName) {
  const notes = TUNES[tuneName] || TUNES.arpeggio;
  const lines = [];
  let totalDots = 0;
  for (const [speed, seconds] of notes) {
    let dots = Math.max(8, Math.round(speed * TSPL_DPI * seconds));
    if (totalDots + dots > TUNE_MAX_FEED_DOTS) dots = TUNE_MAX_FEED_DOTS - totalDots;
    if (dots <= 0) break;
    lines.push(`SPEED ${speed}`);
    lines.push(`FEED ${dots}`);
    totalDots += dots;
  }
  // The return swoop: fast backfeed of everything we fed, so the label stock
  // ends (near) where it started. Printers that refuse long backfeeds just
  // creep forward a little — the operator's cue to turn the toggle off.
  lines.push('SPEED 6');
  lines.push(`BACKFEED ${totalDots}`);
  return lines.join('\r\n') + '\r\n';
}

// Send raw bytes to a named printer via winspool's RAW datatype — the escape
// hatch past the GDI driver. Same PowerShell/temp-file discipline as
// printImage(); the printer name is validated (isSafePrinterName) at the
// endpoint, single quotes escaped here.
function sendRawToPrinter(bytes, printerName) {
  return withPrinter(() => sendRawToPrinterNow(bytes, printerName));
}

async function sendRawToPrinterNow(bytes, printerName) {
  const binPath = tmpFilePath('awana-tune', 'bin');
  fs.writeFileSync(binPath, bytes);
  const safeBin = binPath.replace(/'/g, "''");
  const safePrinter = (printerName || '').replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RawPrint {
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string printer, out IntPtr h, IntPtr pd);
  [DllImport("winspool.Drv")] public static extern bool ClosePrinter(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct DOCINFOA {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFOA di);
  [DllImport("winspool.Drv")] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.Drv")] public static extern bool WritePrinter(IntPtr h, byte[] bytes, int count, out int written);
}
"@
$bytes = [System.IO.File]::ReadAllBytes('${safeBin}')
$h = [IntPtr]::Zero
if (-not [RawPrint]::OpenPrinter('${safePrinter}', [ref]$h, [IntPtr]::Zero)) { throw ('OpenPrinter failed for ''${safePrinter}'', Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
try {
  $di = New-Object RawPrint+DOCINFOA
  $di.pDocName = 'Club Label Printer tune'
  $di.pDataType = 'RAW'
  if (-not [RawPrint]::StartDocPrinter($h, 1, [ref]$di)) { throw ('StartDocPrinter (RAW) failed, Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  [RawPrint]::StartPagePrinter($h) | Out-Null
  $written = 0
  if (-not [RawPrint]::WritePrinter($h, $bytes, $bytes.Length, [ref]$written)) { throw ('WritePrinter failed, Win32 error ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }
  if ($written -ne $bytes.Length) { throw ('WritePrinter wrote ' + $written + ' of ' + $bytes.Length + ' bytes') }
  [RawPrint]::EndPagePrinter($h) | Out-Null
  [RawPrint]::EndDocPrinter($h) | Out-Null
} finally { [RawPrint]::ClosePrinter($h) | Out-Null }
`.trim();
  const psPath = tmpFilePath('awana-tune', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    await runPowerShell(['-File', psPath], { timeout: 15000 });
  } finally {
    fs.unlink(psPath, () => {});
    fs.unlink(binPath, () => {});
  }
}

// Play a tune if (and only if) the toggle is on. Never throws: the chirp is
// garnish, and garnish must never delay or fail a label. One quick retry
// (spooler hiccups are transient), and the outcome — success or the exact
// Win32 error — is kept for /health so "it just prints normal" is
// diagnosable from the dashboard instead of invisible.
let lastTune = null; // { ok, tune, printer, error?, at }
async function playTuneIfEnabled(printerName, tuneName) {
  if (config.musicalPrinter !== true) return false;
  const name = TUNE_NAMES.includes(tuneName) ? tuneName : nextTuneName();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await sendRawToPrinter(Buffer.from(buildTuneTspl(name), 'ascii'), printerName);
      lastTune = { ok: true, tune: name, printer: String(printerName || ''), at: new Date().toISOString() };
      console.log(`[tune] Played '${name}' on ${printerName || 'default printer'}`);
      return true;
    } catch (e) {
      if (attempt === 1) {
        await sleep(400);   // a breather before the one retry
        continue;
      }
      lastTune = {
        ok: false, tune: name, printer: String(printerName || ''),
        error: String(e.message || e).slice(0, 200), at: new Date().toISOString(),
      };
      console.warn('[tune] Tune failed after retry (non-critical):', e.message);
      return false;
    }
  }
  return false;
}

// ── Attendance ledger (#30) ───────────────────────────────────────────────────
// Print history keeps only MAX_HISTORY old rows and ages out, so milestones
// need their own compact ledger: one dates[] per kid, one entry per day,
// season-scoped (Awana years start Aug 1). Written atomically like history.
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const MILESTONES = [5, 10, 25, 50];

function seasonStartISO(now = new Date()) {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

function loadAttendance() {
  return cachedStore(ATTENDANCE_FILE, () => {
    try {
      if (fs.existsSync(ATTENDANCE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (e) { console.warn('[attendance] Failed to load ledger:', e.message); }
    return {};
  });
}

function saveAttendance(ledger) {
  if (saveFileAtomic(ATTENDANCE_FILE, JSON.stringify(ledger))) cacheStore(ATTENDANCE_FILE, ledger);
}

// Upsert tonight for this kid. Returns:
//   seasonCount      — their night count within the current season (milestones)
//   firstEver        — tonight is the first date this ledger has EVER seen them
//                      (dates[] is never pruned, so this spans seasons)
//   priorNightExists — some kid, any kid, attended on an earlier date, i.e.
//                      the club has met before tonight on this machine
// The last two exist for the auto connect card (#10): "new face at a club
// that has met before" is what distinguishes a genuine first-timer from
// opening night / a fresh install, where EVERY kid's count is 1 and firing a
// welcome card per child would bury the printer.
//
// Keyed id-first with a one-time migration from the legacy name key, mirroring
// historyIdentityKey: two same-named kids stop merging the moment a caller
// knows who they are, and a kid's existing streak moves with them. A kid whose
// entry migrated to the id key and who later prints WITHOUT an id starts a
// fresh name entry — the failure modes there are a wrong milestone line and a
// spurious welcome card, both benign, both no worse than the name-collision
// behaviour this replaces.
function recordAttendance(firstName, lastName, clubberId = null) {
  const nameKey = `${firstName} ${lastName}`.toLowerCase().trim();
  const idRaw = clubberId == null ? '' : String(clubberId).trim();
  const idKey = idRaw ? `id:${idRaw.toLowerCase()}` : '';
  if (!nameKey && !idKey) return { seasonCount: 0, firstEver: false, priorNightExists: false };
  const today = localDayISO();
  const ledger = loadAttendance();

  let priorNightExists = false;
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    if (ds.some(d => d < today)) { priorNightExists = true; break; }
  }

  if (idKey && nameKey && ledger[nameKey]) {
    // Migrate (or merge, if tonight already saw both shapes) the legacy
    // name-keyed entry into the id key, then retire the name key.
    const legacy = ledger[nameKey];
    if (!ledger[idKey] || !Array.isArray(ledger[idKey].dates)) {
      ledger[idKey] = legacy;
    } else if (Array.isArray(legacy.dates)) {
      for (const d of legacy.dates) {
        if (!ledger[idKey].dates.includes(d)) ledger[idKey].dates.push(d);
      }
    }
    delete ledger[nameKey];
  }

  const key = idKey || nameKey;
  const entry = ledger[key] && Array.isArray(ledger[key].dates)
    ? ledger[key]
    : { name: `${firstName} ${lastName}`.trim(), dates: [] };
  if (!entry.dates.includes(today)) entry.dates.push(today);
  ledger[key] = entry;
  saveAttendance(ledger);

  // Streak (#14): consecutive CLUB NIGHTS attended, tonight included. A club
  // night is any date some kid attended — walking that union (not calendar
  // weeks) means Christmas break and cancelled weeks never break a streak;
  // only a night the club met and this kid stayed home does.
  const clubNights = new Set();
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    for (const d of ds) if (typeof d === 'string' && d <= today) clubNights.add(d);
  }
  const mine = new Set(entry.dates);
  let streak = 0;
  for (const night of [...clubNights].sort().reverse()) {
    if (mine.has(night)) streak++;
    else break;
  }

  // New-kid window (#15): tonight is within 14 days of the kid's first-ever
  // night on this ledger — their first two typical club weeks. Day-based, not
  // night-based, so a make-up event in the same fortnight doesn't extend it.
  // Calendar days: the old 24-hour arithmetic came up short across
  // spring-forward and kept the sparkle a night too long.
  let isNewKid = false;
  const firstNight = entry.dates.reduce((a, b) => (a && a < b ? a : b), null);
  if (firstNight) {
    isNewKid = calendarDaysBetween(firstNight, today) < 14;
  }

  const start = seasonStartISO();
  return {
    seasonCount: entry.dates.filter(d => d >= start).length,
    firstEver: entry.dates.length === 1,
    priorNightExists,
    streak,
    isNewKid,
  };
}

function milestoneLineFor(count) {
  return MILESTONES.includes(count) ? `⭐ ${count}th club night tonight!` : '';
}

// #293: the trophy band's text. Pure and exported so the clip is pinned by a
// unit test — the renderer's own 48-character cap is inside generateLabel and
// returns nothing testable. A book title arrives from a scraped CSV, so it is
// stripped of control characters and bounded before it ever reaches a label.
const TROPHY_BAND_MAX = 48;
function trophyBandFor(book) {
  // A book title comes off a scraped CSV column, so it is always a string when
  // it is real. Anything else is garbage from a drifted parser and prints
  // nothing at all — "Finished 42" or "Finished [object Object]" on a child's
  // label is worse than no band.
  if (typeof book !== 'string') return '';
  const clean = security.sanitizeStoredText(book, 60);
  if (!clean) return '';
  return `Finished ${clean}`.slice(0, TROPHY_BAND_MAX);
}

// ── Group schedule (#28) ──────────────────────────────────────────────────────
// Where each club is, and from when — drives the "Go to:" routing line on
// late check-ins. Rows live in config.json: { club, startTime "HH:MM",
// location, room }, any number per club: each is one slot of the night, and a
// late child is sent to the club's slot that started last before they arrived
// ("Go to: Games, Fellowship Hall" at 7:10). `location` is the activity and
// `room` the place, so the line reads like the printed schedule. No line until
// the club's FIRST slot plus the grace (10 minutes by default) has passed.
//
// DEFAULT_SCHEDULE is KVBC's printed 2026-27 club schedule (owner,
// 2026-10-03), used whenever this computer has no rows of its own: an empty
// table on the dashboard means "the club schedule", so clearing it brings
// these back. Trek and Journey share a column on the poster and part only at
// 7:00, so each has its own rows.
const DEFAULT_SCHEDULE = Object.freeze([
  ['Puggles', '17:45', 'Free Time', 'Toddler Nursery'],
  ['Puggles', '18:00', 'Opening', 'Fellowship Hall'],
  ['Puggles', '18:05', 'Group Time', 'Toddler Nursery'],
  ['Puggles', '19:00', 'Games', 'Fellowship Hall'],
  ['Cubbies', '17:45', 'Free Time', 'Fellowship Hall'],
  ['Cubbies', '18:00', 'Opening', 'Fellowship Hall'],
  ['Cubbies', '18:05', 'Small Group', 'Large Classroom'],
  ['Cubbies', '18:30', 'Large Group', 'Large Classroom'],
  ['Cubbies', '19:00', 'Games', 'Fellowship Hall'],
  ['Sparks', '17:45', 'Small Group', 'Child Discipleship Wing'],
  ['Sparks', '18:30', 'Games', 'Fellowship Hall'],
  ['Sparks', '19:00', 'Large Group', 'Large Classroom'],
  ['T&T', '17:45', 'Handbook Time', 'Fellowship Hall'],
  ['T&T', '18:00', 'Opening', 'Fellowship Hall'],
  ['T&T', '18:05', 'Games', 'Fellowship Hall'],
  ['T&T', '18:30', 'Large Group', 'Child Discipleship Wing'],
  ['T&T', '19:00', 'Small Group', 'Child Discipleship Wing'],
  ['Trek', '17:45', 'Handbook Time', 'Youth Building'],
  ['Trek', '18:05', 'Games', 'Youth Building'],
  ['Trek', '18:30', 'Large Group', 'Youth Building'],
  ['Trek', '19:00', 'Small Group', 'Child Discipleship Wing'],
  ['Journey', '17:45', 'Handbook Time', 'Youth Building'],
  ['Journey', '18:05', 'Games', 'Youth Building'],
  ['Journey', '18:30', 'Large Group', 'Youth Building'],
  ['Journey', '19:00', 'Small Group', 'Youth Building'],
].map(([club, startTime, location, room]) => Object.freeze({ club, startTime, location, room })));
const SCHEDULE_MAX_ROWS = 60;

function scheduleRows() {
  return Array.isArray(config.schedule) && config.schedule.length ? config.schedule : DEFAULT_SCHEDULE;
}

// A club's slots that have a readable start, earliest first.
function clubSlots(clubName) {
  const key = clubKey(clubName);
  if (!key) return [];
  return scheduleRows()
    .filter(r => r && clubKey(r.club) === key)
    .map(r => ({ row: r, start: r.startTime ? events.parseHM(r.startTime) : null }))
    .filter(s => s.start !== null)
    .sort((a, b) => a.start - b.start);
}

// The club's slot under way at `now` (the last to have started), or its
// first slot before the night begins. Null for a club with no rows.
function scheduleRowFor(clubName, now = new Date()) {
  const slots = clubSlots(clubName);
  if (!slots.length) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  let current = slots[0];
  for (const s of slots) if (s.start <= mins) current = s;
  return current.row;
}

function lateGoToLine(clubName, now = new Date()) {
  const slots = clubSlots(clubName);
  if (!slots.length) return '';
  const graceMin = Number.isFinite(Number(config.lateGraceMin)) ? Number(config.lateGraceMin) : 10;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins <= slots[0].start + graceMin) return '';
  const row = scheduleRowFor(clubName, now);
  const where = [row.location, row.room].filter(Boolean).join(', ');
  return where ? `Go to: ${where}` : '';
}

// ── The drop-off tag (7.7.0; on the label printer since 7.17.0) ──────────────
// A child who arrives late gets a plain name tag and the family gets ONE
// extra label: "Drop-off locations at 6:42 PM", then a line
// per child of the household (TwoTimTwo's, from the check-in laptop's
// /touch/context; a child it doesn't place is a household of one), each with
// where their club is right now. Owner's choices: the whole household, printed
// with the first late child, once per family per night.
const dropOffPrinted = new Map();   // household key -> local day it printed
function dropOffName(s) { return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function titleCaseName(s) {
  return String(s || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}
function dropOffTagFor(firstName, lastName, clubName, now = new Date(), opts = {}) {
  const self = dropOffName(`${firstName} ${lastName}`);
  if (!self) return null;
  const ctx = loadTouchContext();
  const house = (ctx.households || []).find(h => h.includes(self)) || [self];
  const key = house.slice().sort().join('|');
  const today = localDayISO(now);
  if (!opts.demo && dropOffPrinted.get(key) === today) return null;
  const roster = loadClubbers();
  const byName = new Map(roster.map(r => [dropOffName(`${r.FirstName || ''} ${r.LastName || ''}`), r]));
  const lines = [];
  for (const member of house) {
    const r = byName.get(member);
    if (member !== self && (!r || String(r.Inactive || '').trim())) continue;
    const club = member === self ? (clubName || (r && r.Club) || '') : String((r && r.Club) || '').trim();
    const row = scheduleRowFor(club, now);
    if (!row) continue;
    const first = member === self ? String(firstName).trim() : String((r && r.FirstName) || member.split(' ')[0]).trim();
    lines.push({ first: first || titleCaseName(member.split(' ')[0]), club, activity: row.location || '', place: row.room || '' });
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a.first.localeCompare(b.first));
  if (!opts.demo) dropOffPrinted.set(key, today);
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return { title: `Drop-off locations at ${time}`, family: titleCaseName(String(lastName || '').trim()) || 'this', lines };
}
// The drop-off label (redesigned 7.18.0). Read at arm's length by a parent in
// a hurry, so the hierarchy is: who, then WHERE, then what is happening there.
//   - A black band: LATE DROP-OFF on the left, the time on the right.
//   - One child: the club mark large on the left, the name in the shout, then
//     GO TO and the room large, the activity under it.
//   - Siblings: one row each, the club mark, the name, a dotted leader and the
//     room set flush right (the activity under it while the rows are tall
//     enough, beside it after a dot when they are not). One name size and one
//     room size for every row, so the card reads as a list.
// Monochrome and nothing thinner than 0.8 pt: it prints on the D450's 203 dpi
// head. Every size steps down until the widest row fits; a mark that will not
// draw falls back to the club's monogram.
const DROP_M = 10;          // side margin
const DROP_BAND = 24;       // header band height
async function dropOffMark(club) {
  try { return await thermalClubMark(clubKey(club), false); } catch (e) { return null; }
}
async function generateDropOffTag(tag) {
  const cvs = createCanvas(PX_W, PX_H);
  const ctx = cvs.getContext('2d');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  const type = labelType('');
  const ink = '#000000';
  const M = DROP_M;

  // The band.
  const timeText = String(tag.title || '').replace(/^.*\bat\s+/i, '').trim();
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, PAGE_W, DROP_BAND);
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  type.fill(ctx, 'band', 15, 'LATE DROP-OFF', M, DROP_BAND / 2 + 0.5);
  if (timeText) {
    ctx.textAlign = 'right';
    const ts = 15;
    type.fill(ctx, 'name', ts, timeText, PAGE_W - M, DROP_BAND / 2 + type.capCentre(ctx, 'name', timeText) * ts);
  }

  const marks = await Promise.all(tag.lines.map((l) => dropOffMark(l.club)));
  // A mark fills a box `bw` wide and `bh` tall, centred: the wordmarks
  // (Sparks, Cubbies, Trek) are wide and the badges (T&T) square, so a square
  // box printed the wordmarks tiny.
  const drawMark = (i, x, y, bw, bh) => {
    const art = marks[i];
    if (art) {
      const scale = Math.min(bw / art.width, bh / art.height);
      const w = art.width * scale;
      const h = art.height * scale;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(art.canvas, x + (bw - w) / 2, y + (bh - h) / 2, w, h);
      return;
    }
    const mono = CLUB_MONOGRAM[clubKey(tag.lines[i].club)] || '?';
    const r = Math.min(bw, bh) * 0.46;
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(x + bw / 2, y + bh / 2, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const ms = type.fit(ctx, 'monogram', mono, r * 1.5, r, 6);
    type.fill(ctx, 'monogram', ms, mono, x + bw / 2, y + bh / 2 + type.capCentre(ctx, 'monogram', mono) * ms);
  };
  // Cap height of the shout at a size, so a read line can share its baseline.
  const capH = (size) => {
    const r = type.inkReach(ctx, 'name', 'H', 'alphabetic');
    return (r ? r.above : 0.7) * size;
  };
  const shout = (text, size, x, y, align = 'left') => {
    ctx.fillStyle = ink; ctx.textAlign = align; ctx.textBaseline = 'middle';
    type.fill(ctx, 'name', size, text, x, y + type.capCentre(ctx, 'name', text) * size);
  };
  const read = (role, text, size, x, y, align = 'left') => {
    ctx.fillStyle = ink; ctx.textAlign = align; ctx.textBaseline = 'middle';
    type.fill(ctx, role, size, text, x, y);
  };

  const top = DROP_BAND;
  const bottom = PAGE_H - 6;
  const n = tag.lines.length;

  if (n === 1) {
    // One child: the hero layout.
    const l = tag.lines[0];
    const bw = 92, bh = 72;
    const markX = M;
    const midY = top + (bottom - top) / 2;
    drawMark(0, markX, midY - bh / 2, bw, bh);
    const x = markX + bw + 14;
    const w = PAGE_W - M - x;
    const nameSize = type.fit(ctx, 'name', l.first, w, 30, 12);
    const roomText = l.place || l.activity || '';
    const actText = l.place && l.activity ? l.activity : '';
    const roomSize = type.fit(ctx, 'goTo', roomText, w, 19, 9);
    const actSize = Math.min(12, roomSize * 0.7);
    const kick = 8.5;
    const gap = 6;
    const blockH = nameSize * 0.8 + gap + kick + 3 + roomSize + (actText ? 2 + actSize : 0);
    let y = midY - blockH / 2;
    shout(l.first, nameSize, x, y + nameSize * 0.4);
    y += nameSize * 0.8 + gap;
    read('band', 'GO TO', kick, x, y + kick / 2);
    y += kick + 3;
    read('goTo', roomText, roomSize, x, y + roomSize / 2);
    y += roomSize + 2;
    if (actText) read('milestone', actText, actSize, x, y + actSize / 2);
  } else {
    // Siblings: an even list.
    const rowH = (bottom - top - 4) / n;
    const bh = Math.min(rowH * 0.74, 30);
    const bw = Math.min(bh * 1.75, 46);
    const twoLine = rowH >= 30;
    const rows = tag.lines.map((l) => ({
      name: l.first,
      room: l.place || l.activity || '',
      act: l.place && l.activity ? l.activity : '',
    }));
    const left = M + bw + 8;
    const right = PAGE_W - M;
    const LEADER_MIN = 26;
    let nameSize = Math.min(22, rowH * 0.56);
    let roomSize = Math.min(14, rowH * (twoLine ? 0.36 : 0.44));
    const actSizeOf = (rs) => rs * 0.74;
    const rightW = (r) => twoLine
      ? Math.max(type.measure(ctx, 'goTo', roomSize, r.room), r.act ? type.measure(ctx, 'milestone', actSizeOf(roomSize), r.act) : 0)
      : type.measure(ctx, 'goTo', roomSize, r.room) + (r.act ? type.measure(ctx, 'milestone', actSizeOf(roomSize), ` \u00b7 ${r.act}`) : 0);
    const fits = () => rows.every((r) => type.measure(ctx, 'name', nameSize, r.name) + LEADER_MIN + rightW(r) <= right - left);
    while (!fits() && (nameSize > 8 || roomSize > 6)) {
      nameSize = Math.max(8, nameSize - 0.5);
      roomSize = Math.max(6, roomSize - 0.4);
    }
    rows.forEach((r, i) => {
      const y0 = top + 2 + rowH * i;
      const cy = y0 + rowH / 2;
      drawMark(i, M, cy - bh / 2, bw, bh);
      shout(r.name, nameSize, left, cy);
      const nameEnd = left + type.measure(ctx, 'name', nameSize, r.name);
      let roomStart;
      const as = actSizeOf(roomSize);
      if (twoLine && r.act) {
        const lineGap = 1.5;
        const blockH = roomSize + lineGap + as;
        const yRoom = cy - blockH / 2 + roomSize / 2;
        read('goTo', r.room, roomSize, right, yRoom, 'right');
        read('milestone', r.act, as, right, yRoom + roomSize / 2 + lineGap + as / 2, 'right');
        roomStart = right - Math.max(type.measure(ctx, 'goTo', roomSize, r.room), type.measure(ctx, 'milestone', as, r.act));
      } else {
        // One line: the room and the activity on the NAME's baseline.
        const base = cy + capH(nameSize) / 2;
        const tail = r.act ? ` \u00b7 ${r.act}` : '';
        const tailW = tail ? type.measure(ctx, 'milestone', as, tail) : 0;
        ctx.fillStyle = ink; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
        if (tail) type.fill(ctx, 'milestone', as, tail, right, base);
        type.fill(ctx, 'goTo', roomSize, r.room, right - tailW, base);
        roomStart = right - tailW - type.measure(ctx, 'goTo', roomSize, r.room);
      }
      // The dotted leader, from the name to the room, just above the name's
      // baseline, the way a printed menu runs its dots.
      const from = nameEnd + 5;
      const to = roomStart - 5;
      const dotY = cy + capH(nameSize) / 2 - 1.2;
      ctx.fillStyle = ink;
      for (let x = from; x <= to; x += 3.2) {
        ctx.beginPath(); ctx.arc(x, dotY, 0.8, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  const pngPath = tmpFilePath('awana-dropoff', 'png');
  const buffer = cvs.toBuffer('image/png');
  fs.writeFileSync(pngPath, buffer);
  return { pngPath, buffer };
}

// Operator-configured footer (#8) — one short line (church name, a verse,
// service times) along the bottom of every label. Read from config here, at
// the call sites, and passed INTO generateLabel as input.footerText: the
// renderer stays a pure function of its argument, which is what keeps the
// golden-image suite meaningful.
function labelFooterText() {
  return String(config.labelFooter || '').trim();
}

// Connect-card greeting (#10) — operator-configurable, with the long-standing
// default. Read from config at the call site (never inside the renderer) for
// the same purity reason as labelFooterText above.
const DEFAULT_CONNECT_GREETING = "We're so glad you're here!";
function connectCardGreeting() {
  return String(config.connectCardGreeting || '').trim() || DEFAULT_CONNECT_GREETING;
}

// ── Per-club label templates (#1) ─────────────────────────────────────────────
// config.labelTemplates is a map of clubKey (or 'default') → a small object of
// layout OVERRIDES. Only deviations from the stock label are stored — a switch
// that's on and a name ceiling of 48 are the defaults, not data — which keeps
// config.json tiny and lets the default layout evolve without stale copies of
// it frozen in every install's config.
const LABEL_TEMPLATE_BOOLEANS = [
  'showIconPanel', 'showLastName', 'showClubLine',
  'showGroupLine', 'showVisitorPill', 'showFooter',
];
const LABEL_TEMPLATE_MAX_CLUBS = 12;

// One template: returns the overrides-only form, or null for a non-object.
function sanitizeLabelTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = { version: 1 };
  for (const k of LABEL_TEMPLATE_BOOLEANS) {
    if (raw[k] === false) out[k] = false;
  }
  if (raw.nameMaxPt !== undefined) {
    const n = Math.round(Number(raw.nameMaxPt));
    if (Number.isFinite(n) && n >= 18 && n < 48) out.nameMaxPt = n;
  }
  return out;
}

// The whole map. Club keys are normalized through clubKey() so 'T&T', 't & t'
// and 'tnt' can't become three diverging templates. clubKey() returns null for
// a club it doesn't recognize, so an unrecognized key is dropped here — a
// custom-named club is served by the 'default' entry instead, which is also
// how labelTemplateFor resolves it at print time.
// Returns {ok, value} or {ok:false, error}.
function sanitizeLabelTemplates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'templates must be an object keyed by club name (or "default")' };
  }
  const out = {};
  for (const rawKey of Object.keys(raw).slice(0, LABEL_TEMPLATE_MAX_CLUBS)) {
    const key = rawKey === 'default' ? 'default' : clubKey(rawKey);
    if (!key) continue;
    const t = sanitizeLabelTemplate(raw[rawKey]);
    if (!t || Object.keys(t).length <= 1) continue;   // no overrides → nothing to store
    out[key] = t;
  }
  return { ok: true, value: out };
}

// Resolve the template for one club: exact club entry, else 'default', else
// null (stock label). Type-guarded at every step — this reads persisted
// config, and a hand-edited config.json must degrade, not throw, mid-event.
function labelTemplateFor(clubName) {
  const all = config.labelTemplates;
  if (!all || typeof all !== 'object' || Array.isArray(all)) return null;
  const key = clubKey(clubName);
  const chosen = (key && all[key]) || all.default || null;
  return (chosen && typeof chosen === 'object' && !Array.isArray(chosen)) ? chosen : null;
}

// ── Phone check-in queue (#17b) ───────────────────────────────────────────────
// A phone on the LAN posts a check-in request; the extension (which has the
// authenticated TwoTimTwo session) long-polls for pending actions and drives
// the real check-in in the browser. The label then flows through the normal
// detection path — for a ROSTER kid the phone page never prints directly, so
// the existing dedup guarantees a single label. The two exceptions are
// deliberate and cannot double-print: a visitor label (POST /phone/visitor)
// is for a child with no TwoTimTwo row, whom roster-diff, reconcile and the
// last-check-in observer can therefore never see; a leader tag (POST
// /print-leader) is not a check-in at all. PIN-over-HTTP is LAN-trust only.
let pendingActions = [];      // { id, type, name, at, status, detail } (type 'checkin' | 'undo')
let pendingWaiters = [];      // long-poll responders
const PENDING_MAX = 100;
const PENDING_WAITERS_MAX = 4;
const PENDING_TTL_MS = 10 * 60 * 1000;

// A claim is a lease. The extension claims an action before driving it, so a
// second tab (or the same tab's next poll) never drives the same child twice,
// and a claimed action is not handed out again; one that is never answered
// within PENDING_CLAIM_MS goes back to pending for the next poll to take.
const PENDING_CLAIM_MS = 90 * 1000;

// An undo (7.14.0) is never left waiting and never driven twice. One nobody
// picks up within UNDO_PICKUP_MS fails with the reason, so a phone that gave up
// is never contradicted by a laptop that undoes the child ten minutes later;
// a claimed one whose lease runs out fails too, because the post may already
// have reached TwoTimTwo and a second one would only read as a refusal.
const UNDO_PICKUP_MS = 60 * 1000;
const UNDO_NOT_PICKED_UP = 'The check-in laptop did not pick it up: no TwoTimTwo tab open there, or its extension is older than 7.14. Nothing was changed.';
const UNDO_NO_ANSWER = 'The check-in laptop started the undo but never reported back. Check TwoTimTwo\'s report before trying again.';
// A phone "Check out" (7.16.0) is driven exactly like an undo: one shot, never
// left waiting, never driven twice, and only a 7.16 extension takes one.
const CHECKOUT_NOT_PICKED_UP = 'The check-in laptop did not pick it up: no TwoTimTwo tab open there, or its extension is older than 7.16. Nothing was changed.';
const CHECKOUT_NO_ANSWER = 'The check-in laptop started the check-out but never reported back. Check TwoTimTwo before trying again.';
const actionType = (a) => (a && (a.type === 'undo' || a.type === 'checkout') ? a.type : 'checkin');
const isOneShot = (a) => actionType(a) !== 'checkin';

function prunePendingActions() {
  const now = Date.now();
  const cutoff = now - PENDING_TTL_MS;
  pendingActions = pendingActions.filter(a => new Date(a.at).getTime() >= cutoff).slice(-PENDING_MAX);
  for (const a of pendingActions) {
    if (isOneShot(a)) {
      const co = actionType(a) === 'checkout';
      if (a.status === 'pending' && now - new Date(a.at).getTime() > UNDO_PICKUP_MS) {
        a.status = 'failed';
        a.detail = co ? CHECKOUT_NOT_PICKED_UP : UNDO_NOT_PICKED_UP;
        console.warn(`[phone] ${co ? 'Check-out' : 'Undo'} for ${a.name}: nobody picked it up`);
      } else if (a.status === 'claimed' && now - a.claimedAt > PENDING_CLAIM_MS) {
        a.status = 'failed';
        a.detail = co ? CHECKOUT_NO_ANSWER : UNDO_NO_ANSWER;
        console.warn(`[phone] ${co ? 'Check-out' : 'Undo'} for ${a.name}: claimed, never answered`);
      }
      continue;
    }
    if (a.status === 'claimed' && now - a.claimedAt > PENDING_CLAIM_MS) {
      a.status = 'pending';
      delete a.claimedAt;
      console.warn(`[phone] ${a.name}: claim expired without a result, offered again`);
    }
  }
}

// What one poller is handed. An undo goes only to an extension that says it
// can do one (`?accept=undo`, 7.14.0): an older one would take it for a
// check-in, find no row for a child already in, and answer "Already checked
// in at this station" with ok:true, which here would read as a done undo.
// A check-out likewise only with `checkout` in the list (7.16.0).
function pendingFor(accept) {
  const kinds = new Set(String(accept || '').split(',').map(s => s.trim()));
  return pendingActions.filter(a => a.status === 'pending' && (actionType(a) === 'checkin' || kinds.has(actionType(a))));
}

function wakePendingWaiters() {
  const waiters = pendingWaiters.splice(0);
  waiters.forEach(w => {
    clearTimeout(w.timer);
    try { w.res.json({ actions: pendingFor(w.accept) }); } catch { /* client gone */ }
  });
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();

// Express 4 does not catch a rejected async handler: the request hung until
// the client's own timeout, and the client's retry hit the same throw. Every
// async route registered on `app` is wrapped here, once, so a rejection reaches
// the JSON error handler at the bottom of this file and the client hears
// "500" at once instead of nothing.
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const register = app[method].bind(app);
  app[method] = (route, ...handlers) => register(route, ...handlers.map((h) => (
    typeof h === 'function' && h.constructor && h.constructor.name === 'AsyncFunction'
      ? (req, res, next) => h(req, res, next).catch(next)
      : h
  )));
}

// ── CORS: an allowlist, not `*` ───────────────────────────────────────────────
// This used to be `app.use(cors())`, i.e. `Access-Control-Allow-Origin: *` on
// every response. Because the browser lets a page READ a response bearing that
// header, any website open in the volunteer's browser could fetch
// /stats/tonight and walk away with tonight's children plus their allergy
// tokens. The allowlist (security.isAllowedOrigin) admits only the extension,
// *.twotimtwo.com, this server's own pages, and any operator-configured extra.
//
// Two rules, both necessary:
//   • Reads  — no ACAO header for a stranger, so the browser blocks the read.
//   • Writes — a mutating request carrying a non-allowlisted Origin is refused
//     outright (403). A form POST with text/plain is never preflighted, so
//     without this a hostile tab could still WRITE (that is how a crafted name
//     reached print-history.json and then the dashboard's innerHTML).
// The two paths the deployed display app may POST to (with the publish token).
const DISPLAY_PUBLISH_PATHS = new Set(['/api/lobby-slides', '/api/display-settings']);

function corsPolicy(req, res, next) {
  const origin = req.headers.origin;
  // The lobby-slides publish endpoint admits ONE extra caller: the deployed
  // display app's exact origin (churchConfig.displayOrigins), scoped to this
  // single path so the display site never gains cross-origin access to the
  // roster or any other endpoint. The bearer publish token — checked in the
  // route — is the actual credential; the origin gate is browser hygiene.
  // Contract v6 adds the shared display settings, published the same way from
  // the same app with the same token.
  const isSlidesPath = DISPLAY_PUBLISH_PATHS.has(req.path);
  const slidesOrigin = isSlidesPath && security.isExactAllowedOrigin(
    origin, security.sanitizeAllowedOrigins(churchConfig.displayOrigins));
  const allowed = slidesOrigin || security.isAllowedOrigin(origin, {
    port: PORT,
    extraOrigins: security.sanitizeAllowedOrigins(config.allowedOrigins),
  });

  // Vary so a proxy or the browser cache never reuses one origin's answer for
  // another origin's request.
  res.setHeader('Vary', 'Origin');

  if (origin && allowed) {
    // Echo the exact origin — never '*'. No Allow-Credentials: these endpoints
    // are authenticated by PIN (or by being loopback), never by cookie.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    // Authorization is only ever needed (or granted) on the slides path — it
    // carries the publish token from the display app's slide editor.
    res.setHeader('Access-Control-Allow-Headers',
      isSlidesPath ? 'Content-Type,Authorization' : 'Content-Type,X-Awana-Pin');
    res.setHeader('Access-Control-Max-Age', '600');
    // Chrome's Private Network Access: a public https page fetching a local
    // server preflights with this request header, and the fetch is blocked
    // unless we opt in. Scoped to the slides path — nothing else on this
    // server is meant to be reachable from a public origin.
    if (isSlidesPath && req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    // Answer the preflight before the auth gate: a rejected preflight must look
    // like a CORS failure, not a PIN failure.
    return res.sendStatus(origin && allowed ? 204 : 403);
  }

  if (origin && !allowed && security.isMutatingMethod(req.method)) {
    console.warn(`[security] Refused ${req.method} ${req.path} from disallowed origin ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  return next();
}
app.use(corsPolicy);

// Keep the GLOBAL body limit small so a hostile or buggy tab can't push
// megabytes of JSON through a laptop that is mid-event. Exactly one route
// legitimately carries a base64 PDF (/print-pdf, where base64 inflates a 12MB
// worksheet by ~4/3), so the global parser steps aside for that single path and
// the route mounts its own larger parser. The global parser must skip it rather
// than the route "overriding" it — app-level middleware runs first, so a big
// body would otherwise be rejected here before the route is ever reached.
const PDF_UPLOAD_PATH = '/print-pdf';
const globalJson = express.json({ limit: '2mb' });
app.use((req, res, next) => {
  if (req.path === PDF_UPLOAD_PATH) return next();
  return globalJson(req, res, next);
});

// ── The auth gate ─────────────────────────────────────────────────────────────
// Mounted BEFORE express.static and before every route, so nothing — not the
// dashboard, not the roster, not /config — is reachable from the LAN without
// the PIN. Loopback callers (the extension via localhost, the dashboard, the
// Electron shell) pass through untouched, which is why this adds no friction to
// the normal single-laptop setup.
//
// LAN_PUBLIC_PATHS is the one exception: the phone page itself is the PIN entry
// form, so it must load before a PIN exists to send. It contains no roster
// data — every byte of that arrives via POST /phone/roster, which is gated.
const LAN_PUBLIC_PATHS = new Set(['/phone', '/phone/ym']);

// The brand kit (public/brand/, the byte-identical mirror of the signage repo's
// shared/brand/) is public too, for the same reason: the phone page's fonts,
// tokens, corner-tab shapes and the Awana Clubs mark must load on the PIN
// screen, before any PIN exists, and a stylesheet's url() could never send one.
// The kit ships in the public repo and the installer and carries no roster
// data. Served from its own root, so no path can climb out of it (serve-static
// refuses `..`), and only stylesheets, fonts and SVGs whose path is plain
// letters, digits, dashes and slashes; anything else, and any miss, falls
// through to the gate below exactly as before.
const BRAND_PUBLIC_PATH = /^\/[A-Za-z0-9_\-/]+\.(css|woff2|ttf|svg)$/;
const brandStatic = express.static(path.join(__dirname, 'public', 'brand'), {
  index: false, redirect: false, dotfiles: 'ignore', fallthrough: true,
});
app.use('/brand', (req, res, next) => {
  if (!BRAND_PUBLIC_PATH.test(req.path)) return next();
  return brandStatic(req, res, next);
});

app.use((req, res, next) => {
  if (security.isLoopbackRequest(req)) return next();
  if (LAN_PUBLIC_PATHS.has(req.path)) return next();

  const addr = (req.socket && req.socket.remoteAddress) || 'unknown';
  const pin = String(config.phonePin || '');

  // Fail CLOSED. The old phonePinOk() returned true when no PIN was set, so a
  // default install handed the whole roster to anyone on the venue network.
  if (!pin) {
    console.warn(`[security] Refused ${req.method} ${req.path} from ${addr} — no PIN is configured`);
    return res.status(403).json({ error: 'This server is not accepting network requests. Set a PIN in Settings to enable phone check-in.' });
  }

  const now = Date.now();
  const waitMs = pinLimiter.retryAfterMs(addr, now);
  if (waitMs > 0) {
    res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
    return res.status(429).json({ error: `Too many wrong PINs — try again in ${Math.ceil(waitMs / 1000)}s` });
  }

  const supplied = String(
    (req.body && req.body.pin) || req.headers['x-awana-pin'] || req.query.pin || ''
  );
  if (!supplied || !security.timingSafeStringEqual(supplied, pin)) {
    // Pass the attempted PIN through so identical repeated wrong guesses
    // (a phone retrying a stale saved PIN, Enter-mashing) count once instead
    // of accumulating toward the lockout — see createPinLimiter's dedupe.
    const rec = pinLimiter.recordFailure(addr, now, supplied);
    console.warn(`[security] Wrong/missing PIN for ${req.method} ${req.path} from ${addr} (failure ${rec.failures})`);
    return res.status(403).json({ error: 'Wrong PIN' });
  }

  pinLimiter.recordSuccess(addr);
  return next();
});

app.use(express.static(path.join(__dirname, 'public')));  // serve static files (bookmarklet.html, etc)

// Health endpoint defined below with enhanced warnings

app.get('/roster-status', (req, res) => {
  // `consent` is counts of distinct release values and how many rows flag
  // no-photo: never a name, so it is as safe to read as the count itself.
  res.json({ count: clubbers.length, consent: rosterConsentSummary(clubbers) });
});

app.get('/printers', async (req, res) => {
  try {
    const raw = (await runPowerShell(['-Command', 'Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) parsed = [parsed];  // PowerShell returns bare object for single printer
    const printers = parsed.map(p => ({ name: p.Name, isWindowsDefault: !!p.Default }));
    const autoDetected = printers.length === 1 ? printers[0].name : null;
    res.json({ printers, serverDefault: PRINTER_NAME || null, autoDetected, inUse: printingTarget() });
  } catch (err) {
    console.error('[printers] Failed to list printers:', err.message);
    res.status(500).json({ error: 'Failed to list printers', printers: [], inUse: printingTarget() });
  }
});

// Explicit route for bookmarklet page
app.get('/bookmarklet.html', (req, res) => {
  const bookmarkletPath = path.join(__dirname, 'public', 'bookmarklet.html');
  res.sendFile(bookmarkletPath);
});

// Serve bookmarklet JS files from project root (one level up from print-server/)
app.get('/bookmarklet.min.js', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'bookmarklet.min.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.min.js not found');
});
app.get('/bookmarklet.js', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'bookmarklet.js');
  if (fs.existsSync(filePath)) return res.type('js').sendFile(filePath);
  res.status(404).send('bookmarklet.js not found');
});

// ── Receive CSV from the bookmarklet (authenticated browser session) ─────────
// The bookmarklet fetches /clubber/csv from the same origin (which has the
// user's session cookies) and POSTs the raw CSV text here so the server can
// write it to clubbers.csv for enriched label data.
app.post('/update-csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required (string)' });
  }
  const csvPath = CSV_FILE;

  // Parse BEFORE writing. A sync that yields zero rows (login redirect, an
  // export format change, a truncated download) must not overwrite a roster
  // we know is good — that would blank enrichment for the rest of the night
  // and persist the damage to disk.
  const rows = parseCSV(csv);
  if (rows.length === 0 && clubbers.length > 0) {
    console.warn(`[csv] Rejected roster sync: posted CSV parsed to 0 rows — keeping the ${clubbers.length} clubber(s) already loaded`);
    return res.status(422).json({ error: 'CSV parsed to 0 rows — roster not replaced', count: clubbers.length });
  }

  // Atomic write: write to a temp file then rename over the target, so a
  // crash or concurrent reader mid-write can never observe a truncated CSV.
  if (!saveFileAtomic(csvPath, csv)) {
    return res.status(500).json({ error: 'Failed to write CSV' });
  }
  clubbers = rows;
  console.log(`[csv] Updated clubbers.csv from browser (${rows.length} clubber(s))`);
  res.json({ ok: true, count: rows.length });
});

// ── Label generation (returns PNG, no printing) ──────────────────────────────
// Same enrichment pipeline as /print but streams the PNG back to the caller.
// Used by the "Print Dialog" mode so both paths render the same label.
app.post('/label', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    clubImageData = null,
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName, clubberId);

  let allergyTokens, handbookGroup, birthday, birthdayAge, noPhoto;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    birthdayAge = birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto = noPhotoFor(record);
    // Same roster fill (and same ordering) as /print: the group is judged
    // against the club that actually prints, so a club-less request for a
    // Puggles kid still drops the "Puggles group" pseudo-group. Review caught
    // this path diverging from /print.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  } else {
    allergyTokens = [];
    handbookGroup = '';
    birthday = false;
    birthdayAge = null;
    noPhoto = false;
  }

  // Step Up Night eligibility — only kicks in when the client says it's
  // step-up night AND the kid is in a graduating cohort.
  const stepUp = !!stepUpNight && isSteppingUp(record, effectiveClubName);
  const stepUpNextClub = stepUp ? (nextClubFor(effectiveClubName) || '') : '';

  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    // Same extras /print builds, so the label a volunteer sees in Print Dialog
    // mode (and any preview) matches what auto-print produces. Without this a
    // first-timer's label silently lost its inverted palette on this path.
    // milestoneLine is deliberately NOT computed here: it comes from recording
    // attendance, and a preview/dialog render must not record a check-in.
    const labelExtras = {};
    const labelGoTo = lateGoToLine(effectiveClubName);
    if (labelGoTo) labelExtras.goToLine = labelGoTo;
    if (visitor && config.firstTimerInverted !== false) labelExtras.inverted = true;

    const twin = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      footerText: labelFooterText(),
      template: labelTemplateFor(effectiveClubName),
      extras: labelExtras,
    });
    fs.unlink(result.pngPath, () => {});
    res.set('Content-Type', 'image/png');
    res.send(result.buffer);
  } catch (err) {
    console.error('[label] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Splits a free-typed "First Last" into its parts; everything after the first
// token is the last name (middle names, suffixes and hyphenated pairs stay put).
function splitFullName(name) {
  const parts = String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') || '' };
}

// The check-in print, factored out of POST /print so POST /phone/visitor can
// run the exact same pipeline — dedup window, roster enrichment, season
// ledger, checkin event, history row, tally — without looping an HTTP request
// back into this process. Returns { status, body } for the caller to send.
// Never throws: a jammed printer or a corrupt PNG is a 500 body, not a crash.
async function performCheckinPrint(input) {
  const {
    firstName,
    lastName,
    clubName      = '',
    clubImageData = null,
    printerName   = '',
    visitor       = false,
    stepUpNight   = false,
    awanaShares   = null,
    clubberId     = null,
    suppressConnectCard = false,
    demo          = false
  } = input || {};

  // ── Demo / training mode ────────────────────────────────────────────────────
  // A demo check-in prints a REAL label (so a volunteer sees the actual output)
  // carrying the same diagonal TEST band /canary uses, and touches nothing else.
  // Every persistent side effect below is skipped, because each one causes real
  // damage during training:
  //   • addHistoryEntry   → print-history.json feeds /checkin-csv-export, which
  //                         is imported BACK INTO TwoTimTwo. Fake kids would be
  //                         recorded as having attended.
  //   • recordAttendance  → the season ledger is permanent; a padded count makes
  //                         real milestone lines ("10th club night!") wrong for
  //                         the rest of the year.
  //   • publish + buffer  → fake children celebrated by name on the lobby TV.
  //   • publishTally      → inflates tonight's counts on every screen.
  // This is the same set /canary already skips; demo mode generalises it to an
  // arbitrary name and club.
  const isDemo = demo === true || demo === 'true' || isRehearsalActive();

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : PRINTER_NAME;

  // Duplicate check-in retry (client timeout/retry, double-tap, overlapping
  // detection paths) — the label already printed, so just acknowledge it.
  // Keyed on the clubber id when the client knows it: a name-only key means two
  // children who share a name and check in within the window collide, and the
  // second is silently reported as a duplicate and never printed. Falls back to
  // the name for walk-ins and older extensions that send no id.
  const dupKey = (clubberId ? `id:${String(clubberId).trim()}` : `${firstName} ${lastName}`)
    .toLowerCase().trim();
  // Demo mode skips the duplicate window: a trainer demonstrating the same
  // child twice in a row is the normal case, not a double-tap to suppress.
  if (!isDemo && isDuplicatePrint(dupKey)) {
    console.log(`[print] '${firstName} ${lastName}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return { status: 200, body: { success: true, duplicate: true } };
  }
  if (!isDemo) claimPrint(dupKey);

  // Reload CSV on every request so mid-event additions are always picked up.
  // If the file is locked or missing, loadClubbers() returns [] and logs a
  // warning — this request continues with a basic label.
  clubbers = loadClubbers();

  // Attempt to enrich the label with data from the CSV. Enrichment fails
  // OPEN: a roster row this code did not expect (a date in a new format, a
  // notes field that is not text) used to throw here, before the try below,
  // and the child at the door got no label and the extension no answer. Now
  // the basic label prints and the console says what was skipped.
  let record = null;
  let allergyTokens = [], handbookGroup = '', birthday = false, cakeWeek = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  try {
  record = findClubber(firstName, lastName, clubberId);
  if (record) {
    // TwoTimTwo CSV has "Notes" instead of a dedicated "Allergies" column.
    // Check Allergies first (manual CSV), fall back to Notes (TwoTimTwo).
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday      = isBirthdayWeek(record.Birthdate);   // real — feeds the display event
    cakeWeek      = isCakeWeek(record.Birthdate);       // label icon: real or half-birthday
    birthdayAge   = birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto       = noPhotoFor(record);
    // Detection paths that never saw the kid's page row (checkin-report
    // polling on a freshly loaded station) send no club — fill it from the
    // roster so the label isn't club-less. Icon falls back to the club mark.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    // After the roster fill, so the group is judged against the club that
    // actually prints — a club-less POST for a Puggles kid must still drop
    // the "Puggles group" pseudo-group.
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
    console.log(`[csv] Enriched: ${firstName} ${lastName} | group: ${handbookGroup || '(none)'} | allergies: ${allergyTokens.join(', ') || '(none)'} | birthday: ${birthday}${noPhoto ? ' | NO PHOTO' : ''}`);
  } else {
    // Child not in CSV (new visitor, typo, or CSV unavailable) — print a basic
    // label using only the data from the POST request. No crash, no skip.
    allergyTokens = [];
    handbookGroup = '';
    birthday      = false;
    cakeWeek      = false;
    birthdayAge   = null;
    noPhoto       = false;
    if (firstName || lastName) {
      console.log(`[csv] '${firstName} ${lastName}' not found in CSV — printing basic label`);
    }
  }
  } catch (e) {
    console.warn(`[csv] Enrichment failed for '${firstName} ${lastName}' (${e && e.message}) — printing basic label`);
    allergyTokens = []; handbookGroup = ''; birthday = false; cakeWeek = false; birthdayAge = null; noPhoto = false;
    effectiveClubName = clubName;
  }

  // Step Up Night: only honour the client's flag if the kid is actually in
  // a graduating cohort (puggle = always, cubbie = 5 by Oct 15, others =
  // graduating grade). All other kids print a normal label tonight.
  let stepUp = false, stepUpNextClub = '';
  try {
    stepUp = !!stepUpNight && isSteppingUp(record, effectiveClubName);
    stepUpNextClub = stepUp ? (nextClubFor(effectiveClubName) || '') : '';
  } catch (e) {
    console.warn(`[print] Step-up check failed for '${firstName} ${lastName}' (${e && e.message}) — printing a normal label`);
    stepUp = false; stepUpNextClub = '';
  }
  if (stepUp) {
    console.log(`[print] ${firstName} ${lastName} stepping up: ${effectiveClubName} → ${stepUpNextClub}`);
  }
  if (awanaShares != null) {
    console.log(`[print] ${firstName} ${lastName} shares badge: ${awanaShares}`);
  }
  console.log(`[print] ${firstName} ${lastName} | ${handbookGroup || effectiveClubName || '—'} | printer: ${effectivePrinter || 'default'}`);

  // Wave 2 extras: late-arrival routing from the group schedule (#28),
  // attendance milestones (#30), and the inverted first-timer palette (#27).
  const extras = {};
  let goTo = null;
  try { goTo = lateGoToLine(effectiveClubName); } catch (e) { console.warn(`[print] Late routing failed (${e && e.message}) — no "Go to" line`); }
  // A late child's name tag carries no "Go to:" line: the family gets one
  // drop-off label instead, after the name tag (owner, 2026-10-08: the card
  // the receipt printer had, on the label printer).
  const dropOffInstead = !!goTo;
  if (visitor && config.firstTimerInverted !== false) extras.inverted = true;

  let pngPath = null;
  let connectPngPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);

    // Attendance is recorded before rendering so the milestone prints on
    // the very night it's earned. Never blocks the label on a ledger error.
    // Skipped for demo prints — the ledger is permanent, and padding it would
    // corrupt real milestone lines for the rest of the season.
    let milestoneLine = '';
    let autoFirstTimer = false;
    let streakCount = null;
    let newKid = false;
    let welcomeBack = false;
    let milestoneCount = null;
    if (!isDemo) {
      try {
        const att = recordAttendance(firstName, lastName, clubberId);
        milestoneLine = milestoneLineFor(att.seasonCount);
        // Streak flame (#14): earns its ink at six consecutive club nights.
        if (att.streak >= 6) streakCount = att.streak;
        // New-kid sparkle (#15): the first two club weeks.
        if (att.isNewKid) newKid = true;
        // Auto connect card (#10): a new face at a club that has met before.
        // Both halves matter — firstEver alone fires for EVERY kid on opening
        // night (and on a fresh install), because everyone's ledger starts at
        // one. This is deliberately "first time on this machine's ledger", not
        // "first time ever at church" — the ledger is the only memory we have.
        autoFirstTimer = !!config.connectCardAutoFirstTimer && att.firstEver && att.priorNightExists;
        // Welcome back (#9): a RETURNING kid's first night of the season -
        // firstEver kids get the first-timer treatment instead, never both.
        welcomeBack = !att.firstEver && att.seasonCount === 1;
        // Milestone wall (#10): the display celebrates the same nights the
        // label's milestone line marks (5/10/25/50).
        if (milestoneLine) milestoneCount = att.seasonCount;
      } catch { /* ledger trouble must not stop the print */ }
    }
    if (milestoneLine) extras.milestoneLine = milestoneLine;
    // Trophy band (#293): pure decoration off a cached LOCAL feed, in its own
    // try/catch. A missing, stale or malformed feed prints the stock label and
    // never delays it — printing is never gated on the pipe. Demo prints are
    // excluded on purpose: they skip history, so a demo band could not be
    // deduped (same reason a demo skips the ledger-derived milestone).
    let trophyBook = '';
    if (!isDemo && config.trophyBand !== false) {
      try {
        const hit = feeds.getCompletedBook(`${firstName} ${lastName}`);
        if (hit && hit.book) {
          // Once per child per club night, the same way the auto connect card
          // dedupes: a lost label or a second station must not band twice.
          const todayIso = localDayISO();
          const alreadyBanded = loadHistory().some(e => e && e.trophyBook && e.success !== false
            && isOnLocalDay(e.timestamp, todayIso)
            && historyRowMatches(e, firstName, lastName, clubberId));
          if (!alreadyBanded) {
            const band = trophyBandFor(hit.book);
            if (band) { extras.trophyBand = band; trophyBook = hit.book; }
          }
        }
      } catch { /* a decoration must never stop a label */ }
    }
    // The operator's explicit visitor flag and the ledger heuristic converge
    // here for the connect card and the display's welcome treatment. The
    // label's inverted palette deliberately stays on the EXPLICIT flag only:
    // a heuristic misfire that prints one extra welcome card is shrugged off,
    // one that turns a regular kid's label black tells every volunteer to
    // welcome the wrong child.
    const isFirstTimerTonight = !!visitor || autoFirstTimer;

    const twin = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup, isBirthday: cakeWeek, birthdayAge, isVisitor: !!visitor,
      stepUp, stepUpNextClub, awanaShares, noPhoto, streakCount, isNewKid: newKid,
      middleInitial: twin.middleInitial, nameHint: twin.nameHint,
      testBanner: isDemo,   // a demo label is visibly marked
      footerText: labelFooterText(),
      template: labelTemplateFor(effectiveClubName),
      extras,
    });
    pngPath = result.pngPath;

    // Musical printer: EVERY label announces itself (operator request — was
    // test prints only, which is why real check-ins printed silently). Tunes
    // cycle per label; a birthday kid's label plays Happy Birthday. Played
    // BEFORE the label so the backfeed returns the media to its start.
    await playTuneIfEnabled(effectivePrinter, cakeWeek ? 'birthday' : undefined);
    await printLabel(pngPath, effectivePrinter);
    if (!isDemo) recordPrint(dupKey);

    // Connect card (#27/#10): first-time families optionally get a second
    // label pointing them to the club's time and place — triggered by the
    // operator's explicit visitor flag, or (when enabled) by the attendance
    // ledger spotting a first-ever check-in. Failure here never fails the
    // check-in — the main label already printed. Must stay a SAME-REQUEST
    // second printImage: a separate POST would die in the duplicate window.
    // The explicit visitor flag always fires (an operator re-flagging after a
    // lost card is deliberate); the AUTO path fires once per kid per night —
    // a re-print past the duplicate window (lost label, roster fix, a second
    // station) must not hand the family a second welcome card, and firstEver
    // alone can't see that because tonight is still the kid's only ledger date.
    // A visiting FAMILY (#323) is several independent prints — one per child —
    // that share one household, so every child after the first asks for its
    // card to be suppressed and the family gets ONE welcome card, not four.
    // Absent or garbage means "print the card": that is today's behaviour, and
    // POST /phone/visitor (which never sends the field) and the extension's
    // offline queue both depend on it.
    const suppressCard = suppressConnectCard === true || suppressConnectCard === 'true';
    let shouldConnectCard = false;
    if (config.connectCard && !suppressCard) {
      if (visitor) {
        shouldConnectCard = true;
      } else if (autoFirstTimer) {
        const todayIso = localDayISO();
        shouldConnectCard = !loadHistory().some(e => e && e.isConnectCard && e.success !== false
          && isOnLocalDay(e.timestamp, todayIso)
          && historyRowMatches(e, firstName, lastName, clubberId));
      }
    }
    if (shouldConnectCard) {
      try {
        const row = scheduleRowFor(effectiveClubName);
        const where = row ? [row.startTime, row.location, row.room].filter(Boolean).join(' · ') : '';
        const card = await generateLabel({
          firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
          greeting: connectCardGreeting(),
          isVisitor: true,
          testBanner: isDemo,   // a demo card must be as visibly fake as its label
          footerText: labelFooterText(),
          extras: where ? { goToLine: where } : {},
        });
        connectPngPath = card.pngPath;
        await printLabel(connectPngPath, effectivePrinter);
        console.log(`[print] Connect card printed for ${firstName} ${lastName}${autoFirstTimer && !visitor ? ' (auto: first-ever check-in)' : ''}`);
        // Recorded like an award slip: visible in the dashboard's history,
        // excluded from everything that counts check-ins.
        if (!isDemo) {
          addHistoryEntry({
            firstName, lastName, clubName: effectiveClubName, clubImageData,
            printer: effectivePrinter, success: true, isConnectCard: true, clubberId,
          });
        }
      } catch (e) {
        console.warn('[print] Connect card failed (non-critical):', e.message);
      }
    }

    // The drop-off tag: a late child, and the
    // first of their household tonight. Never fails the check-in.
    if (dropOffInstead) {
      let dropPath = null;
      try {
        const tag = dropOffTagFor(firstName, lastName, effectiveClubName, new Date(), { demo: isDemo });
        if (tag) {
          const out = await generateDropOffTag(tag);
          dropPath = out.pngPath;
          await printLabel(dropPath, effectivePrinter);
          console.log(`[print] Drop-off tag for the ${tag.family} family: ${tag.lines.map(l => l.first).join(', ')}`);
        }
      } catch (e) {
        console.warn('[print] Drop-off tag failed (non-critical):', e.message);
      } finally {
        if (dropPath) fs.unlink(dropPath, () => {});
      }
    }

    if (isDemo) {
      // The label printed and nothing else happened: no broadcast, no history,
      // no tally, no ledger. Deliberately logged so a demo run is obvious when
      // reading the console after a training session.
      console.log(`[demo] Printed a TEST label for '${firstName} ${lastName}' (${effectiveClubName || 'no club'}) — nothing recorded or broadcast`);
      return { status: 200, body: { success: true, demo: true } };
    } else {
      // Event bus: checkin (v2 — id + at for replay dedup), buffered for recap,
      // plus a fresh tally so displays update within seconds of the check-in.
      const checkinEvent = events.buildCheckin({
        firstName, club: effectiveClubName, isBirthday: !!birthday, isFirstTimer: isFirstTimerTonight,
        welcomeBack, milestone: milestoneCount,
      });
      events.publish(pusher, EVENT_CHANNEL, 'checkin', checkinEvent);
      pushEventToBuffer(checkinEvent);

      // Log to print history. trophyBook is the once-per-night marker for
      // #293's band — written on SUCCESS only, so a jammed label (which nobody
      // ever saw) still gets its band on the reprint.
      addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: true, visitor: !!visitor, clubberId,
        trophyBook,
      });

      publishTally();

      return { status: 200, body: { success: true } };
    }
  } catch (err) {
    // Log the error but keep the server alive — the next check-in must still work.
    // A jammed printer or corrupted PDF is not a reason to bring down the server.
    console.error('[print] Error:', err.message);
    // A failed DEMO print is a training problem, not an operational one: it must
    // not appear in the history the dashboard shows, and must not raise an `ops`
    // print-failure event that makes the church think a real label was lost.
    if (!isDemo) {
      addHistoryEntry({
        firstName, lastName, clubName: effectiveClubName, clubImageData,
        printer: effectivePrinter, success: false, visitor: !!visitor, clubberId
      });
      recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    }
    return { status: 500, body: { error: err.message, ...(isDemo ? { demo: true } : {}) } };
  } finally {
    if (!isDemo) releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
    if (connectPngPath) fs.unlink(connectPngPath, () => {});
  }
}

app.post('/print', async (req, res) => {
  const body = req.body || {};
  let firstName, lastName;
  if (body.firstName !== undefined) {
    firstName = String(body.firstName || '').trim();
    lastName  = String(body.lastName  || '').trim();
  } else if (body.name) {
    ({ firstName, lastName } = splitFullName(body.name));
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }
  const out = await performCheckinPrint({
    firstName, lastName,
    clubName: body.clubName, clubImageData: body.clubImageData, printerName: body.printerName,
    visitor: body.visitor, stepUpNight: body.stepUpNight, awanaShares: body.awanaShares,
    clubberId: body.clubberId, suppressConnectCard: body.suppressConnectCard, demo: body.demo,
  });
  res.status(out.status).json(out.body);
});

// ── Print history ────────────────────────────────────────────────────────────
const HISTORY_FILE = path.join(DATA_DIR, 'print-history.json');

// ── Club icons, once each ─────────────────────────────────────────────────────
// Every history row used to carry its club's logo as a base64 PNG (10-30 KB),
// so a 200-row file was a few megabytes, re-read and re-parsed on nearly every
// request and rewritten on every check-in. The logo is one of a handful of
// images a night: it is kept ONCE here, by content hash, and a row carries the
// hash (`clubIcon`). Rows written before this still carry `clubImageData` and
// are read either way (historyClubImage); the dashboard never used the blob,
// so /history and /history/today no longer send it.
const ICONS_FILE = path.join(DATA_DIR, 'club-icons.json');
const ICONS_MAX = 60;
let clubIcons = null;   // hash → data URL, loaded on first use
function loadClubIcons() {
  if (clubIcons) return clubIcons;
  clubIcons = new Map();
  try {
    if (fs.existsSync(ICONS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(ICONS_FILE, 'utf8'));
      if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') clubIcons.set(k, v);
    }
  } catch (e) { console.warn('[icons] Could not load club-icons.json:', e.message); }
  return clubIcons;
}
function iconHash(dataUrl) { return crypto.createHash('sha256').update(dataUrl).digest('hex').slice(0, 20); }
// Store a data: URL once; returns its hash. Anything else (a URL, nothing) is
// not stored and returns null.
function rememberClubIcon(image) {
  if (typeof image !== 'string' || !image.startsWith('data:') || image.length > 512 * 1024) return null;
  const icons = loadClubIcons();
  const hash = iconHash(image);
  if (!icons.has(hash)) {
    icons.set(hash, image);
    while (icons.size > ICONS_MAX) icons.delete(icons.keys().next().value);
    saveFileAtomic(ICONS_FILE, JSON.stringify(Object.fromEntries(icons)));
  }
  return hash;
}
// The image a history row printed with: its own blob (older rows, URLs) or the
// stored icon its hash names.
function historyClubImage(row) {
  if (!row) return null;
  if (row.clubImageData) return row.clubImageData;
  if (row.clubIcon) return loadClubIcons().get(row.clubIcon) || null;
  return null;
}
// What /history and /history/today send: everything but the blob.
function historyRowForDashboard(row) {
  if (!row || typeof row !== 'object' || !('clubImageData' in row)) return row;
  const { clubImageData, ...rest } = row;
  return rest;
}
// The cap on OLD rows. Today's rows are never evicted (see addHistoryEntry):
// the duplicate guard, "already printed tonight", the trophy marker and the
// tally fallback all read today's rows, and a 200-child night used to push its
// first arrivals out before the evening ended, so a reprint printed a second
// trophy band and the fallback count came up short. HISTORY_HARD_MAX is the
// one bound that still holds on a day gone wrong (a loop of prints).
const MAX_HISTORY = 200;
const HISTORY_HARD_MAX = 5000;

function loadHistory() {
  const rows = cachedStore(HISTORY_FILE, () => {
    try {
      if (fs.existsSync(HISTORY_FILE)) {
        const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        return Array.isArray(raw) ? raw : [];
      }
    } catch (e) {
      console.warn('[history] Failed to load print history:', e.message);
    }
    return [];
  });
  // MAX_HISTORY caps the row COUNT; this caps the AGE. Without it a church
  // that prints a handful of labels a week accumulated children's names and
  // check-in times indefinitely. Applied on read as well as write so an
  // existing over-long file shrinks on the next run. A fresh array each call,
  // so a caller that unshifts into its copy never edits the cache behind the
  // next caller's back.
  return security.pruneHistoryByAge(rows, config.historyRetentionDays, Date.now());
}

function saveHistory(entries) {
  // Atomic write: a crash mid-save must not corrupt the history JSON, which
  // would break /history and reprints until manually deleted.
  if (saveFileAtomic(HISTORY_FILE, JSON.stringify(entries, null, 2))) cacheStore(HISTORY_FILE, entries);
}

// Does a history row refer to this child?
//
// Identity is id-first with a name fallback, because rows written before the
// clubberId field existed have none — and a mid-season upgrade must not make
// every earlier check-in unrecognisable. The rules, in order:
//   1. Both sides know an id → the ids decide, and a mismatch is a DIFFERENT
//      child even when the names are identical. This is the whole point.
//   2. Either side lacks an id → fall back to the lowercased full name, which
//      is exactly the old behaviour.
// Mirrors the extension's identityKey()/migrateLegacyKey() pair, which solved
// this on its side (roadmap R-4) while the server never followed.
function historyRowMatches(row, firstName, lastName, clubberId) {
  if (!row) return false;
  const rowId = row.clubberId != null ? String(row.clubberId).trim() : '';
  const wantId = clubberId != null ? String(clubberId).trim() : '';
  if (rowId && wantId) return rowId === wantId;
  const rowName = `${row.firstName || ''} ${row.lastName || ''}`.toLowerCase().trim();
  const wantName = `${firstName || ''} ${lastName || ''}`.toLowerCase().trim();
  return !!rowName && rowName === wantName;
}

// The dedup key for "one row per child" aggregations. Prefers the id so two
// same-named children stay two children; falls back to the name for older rows.
function historyIdentityKey(row) {
  const id = row && row.clubberId != null ? String(row.clubberId).trim() : '';
  if (id) return `id:${id}`;
  return `name:${`${(row && row.firstName) || ''} ${(row && row.lastName) || ''}`.toLowerCase().trim()}`;
}

// Same identity key, computed from a checkin_report entry ({ clubberId, name,
// club } — content.js's fetchCheckinReport() shape) instead of a history row,
// so the two can be compared directly. Whitespace is collapsed (not just
// trimmed): the report's name sits between two links in TwoTimTwo's own
// markup and can come back with padding or a line break inside it, and a
// history row never does, so leaving it uncollapsed would make an
// already-checked-in child look "missing" from the report on a whitespace
// technicality — exactly the false-undo this feature must not cause.
function reportEntryIdentityKey(entry) {
  const id = entry && entry.clubberId != null ? String(entry.clubberId).trim() : '';
  if (id) return `id:${id}`;
  const name = String((entry && entry.name) || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return `name:${name}`;
}

// R-1's /clubber/checkin_report is already the authoritative "who's checked in
// tonight" list (content.js has polled it every ~60s since v5.2 to catch
// missed check-ins). This is the other direction it never covered: an UNDO on
// TwoTimTwo — a child removed from the roster after having been checked in —
// is invisible to both the roster-diff detector and to print-history, which
// has no way to learn a print it already recorded got undone. Reusing the same
// report for this means no second scrape, no new event type, no parallel
// pipeline — only a diff against history the server already owns.
//
// Pure by design (mirrors the display repo's decideBoard() philosophy per
// CLAUDE.md): takes and returns a history array, so it is exhaustively
// testable without touching disk. The caller (POST /feed/checkin-report)
// owns load/save and the follow-up publishTally().
//
// History is never deleted — it doubles as the print log — so an undone
// check-in is marked `undone: true` / `undoneAt: <ISO>` in place rather than
// removed.
//
// Identity resolution: for each identity, only the NEWEST qualifying row
// tonight (history is newest-first) is eligible to be marked/cleared. That is
// the same row computeTonightStats() treats as "currently checked in" for
// that identity, and it is what makes the outcome deterministic when both an
// undone row and a newer successful re-check-in exist for the same child: the
// newer row always wins, never an older duplicate (a same-night reprint, or a
// stale prior undo) reviving or re-hiding a status that has since moved on.
//
// Safety guards baked in (a bad/partial scrape must never mass-undo a night):
//   - Only entries actually present in the (already-validated) report count as
//     "still checked in" — this function trusts its caller to have confirmed
//     the report parsed successfully; see feeds.validateCheckinReportBody()'s
//     `ok: true` requirement.
//   - Visitors are exempt from being marked undone: it is unknown whether
//     /clubber/checkin_report lists first-timers at all (TWOTIMTWO.md is
//     silent on it), so treating their absence as "undone" could be nothing
//     more than the report not tracking them. Reappearance still clears an
//     existing `undone` flag for a visitor — that direction can only correct a
//     false undo, never wrongly cause one.
//   - If applying the report would mark more than half of tonight's currently
//     checked-in kids as undone in one pass, the WHOLE pass is skipped (history
//     comes back unchanged) rather than trusted partially — that ratio is far
//     more consistent with a broken/partial scrape (wrong table, filtered
//     view, login bounce mid-parse) than with a real mass walkout.
//   - A row a PERSON undid (`undoneBy`, set by the phone page's Remove) is never
//     cleared by a reappearance. Remove is local-only by design — the child is
//     expected to still be on TwoTimTwo's report — so without this the very
//     next pass would re-count them within a minute of the volunteer's tap.
//     Rows this function itself marks never carry `undoneBy`.
function reconcileHistoryWithReport(history, reportEntries, now = Date.now()) {
  const today = localDayISO(new Date(now));
  // Every key each report entry could be filed under (id AND name): a row
  // printed without an id (a walk-in, a print before the roster cache knew the
  // child) is still that child, and comparing it to the entry's id alone
  // marked a child TwoTimTwo lists as undone, all night (2026-10-08).
  const reportKeys = new Set();
  (Array.isArray(reportEntries) ? reportEntries : []).forEach((entry) => {
    identityKeysOfReportEntry(entry).forEach((k) => reportKeys.add(k));
  });
  // A row with an id is matched on its id only, so a namesake on the report
  // never keeps a different child's undone row alive.
  const onReport = (row) => {
    const keys = identityKeysOfRow(row);
    const id = keys.find((k) => k.startsWith('id:'));
    return id ? reportKeys.has(id) : keys.some((k) => reportKeys.has(k));
  };

  // The newest (index-first, since history is unshift()ed newest-first) row
  // per identity — the one row this pass is allowed to touch.
  const activeIdx = new Map(); // identityKey -> index into history[]
  history.forEach((row, i) => {
    if (!row || row.success === false || isNonCheckinRow(row)) return;
    if (!isOnLocalDay(row.timestamp, today)) return;
    const key = historyIdentityKey(row);
    if (!activeIdx.has(key)) activeIdx.set(key, i);
  });

  const toUndo = [];
  const toClear = [];
  let checkedInBefore = 0;
  activeIdx.forEach((i) => {
    const row = history[i];
    if (!row.undone) checkedInBefore++;
    const inReport = onReport(row);
    if (!inReport && !row.undone && !row.visitor) toUndo.push(i);
    else if (inReport && row.undone && !row.undoneBy) toClear.push(i);
  });

  if (checkedInBefore > 0 && toUndo.length > checkedInBefore / 2) {
    return {
      history,
      changed: 0,
      skipped: true,
      reason: `refusing to mark ${toUndo.length}/${checkedInBefore} checked-in kid(s) undone in one pass ` +
        '(more than half — treating as a suspect/partial scrape rather than a real mass walkout)',
    };
  }

  if (!toUndo.length && !toClear.length) {
    return { history, changed: 0, skipped: false, reason: null };
  }

  // Copy-on-write: only the rows that actually change become new objects.
  const next = history.slice();
  const nowIso = new Date(now).toISOString();
  toUndo.forEach((i) => { next[i] = { ...next[i], undone: true, undoneAt: nowIso }; });
  toClear.forEach((i) => {
    const { undone, undoneAt, ...rest } = next[i];
    next[i] = rest;
  });

  return { history: next, changed: toUndo.length + toClear.length, skipped: false, reason: null };
}

// Manual undo from the phone page's Tonight tab. Marks EVERY active row for
// this identity tonight — not just the newest — so an older same-night reprint
// can never be read as "still here" once the volunteer has said otherwise.
// Rows carry `undoneBy` so reconcileHistoryWithReport() never clears them:
// Remove is local by design, the child is very likely still listed on
// TwoTimTwo's report, and without the marker the next pass would re-count them
// within 60 s. Pure and copy-on-write, like reconcile; the caller owns
// load/save, the ledger strip and publishTally().
function markManualUndo(history, ident, now = Date.now(), by = 'phone') {
  const today = localDayISO(new Date(now));
  const nowIso = new Date(now).toISOString();
  const { firstName, lastName, clubberId } = ident || {};
  let changed = 0;
  const next = history.map((row) => {
    if (!row || row.success === false || isNonCheckinRow(row) || row.undone) return row;
    if (!isOnLocalDay(row.timestamp, today)) return row;
    if (!historyRowMatches(row, firstName, lastName, clubberId)) return row;
    changed++;
    return { ...row, undone: true, undoneAt: nowIso, undoneBy: by };
  });
  return { history: changed ? next : history, changed };
}

// The reverse, restricted to rows THIS surface undid (`undoneBy === by`): a
// reconcile-detected undo is TwoTimTwo's truth, and a phone must not be able to
// override it — that path is "check the kid in again", not "un-undo".
function clearManualUndo(history, ident, by = 'phone') {
  const { firstName, lastName, clubberId } = ident || {};
  let changed = 0;
  const next = history.map((row) => {
    if (!row || !row.undone || row.undoneBy !== by) return row;
    if (!historyRowMatches(row, firstName, lastName, clubberId)) return row;
    changed++;
    const { undone, undoneAt, undoneBy, ...rest } = row;
    return rest;
  });
  return { history: changed ? next : history, changed };
}

// The season-ledger keys a child may be filed under — see recordAttendance():
// id-first with the legacy lowercased-name key kept for rows that predate ids.
function ledgerKeysFor(firstName, lastName, clubberId) {
  const keys = [];
  const idRaw = clubberId == null ? '' : String(clubberId).trim();
  if (idRaw) keys.push(`id:${idRaw.toLowerCase()}`);
  const nameKey = `${firstName || ''} ${lastName || ''}`.toLowerCase().trim();
  if (nameKey) keys.push(nameKey);
  return keys;
}

// Takes one day out of one child's ledger so a removed check-in does not keep a
// streak or milestone night. Same per-entry shape /reset-tonight applies to
// every key at once. Returns whether anything changed.
function stripDayFromLedger(keys, day) {
  const ledger = loadAttendance();
  let touched = false;
  for (const key of keys) {
    const dates = ledger[key] && Array.isArray(ledger[key].dates) ? ledger[key].dates : null;
    if (dates && dates.includes(day)) {
      ledger[key].dates = dates.filter((d) => d !== day);
      touched = true;
    }
  }
  if (touched) saveAttendance(ledger);
  return touched;
}

// A history row that is a PRINT but not a CHECK-IN: award slips, connect cards
// and leader name tags. One predicate, used by every consumer that counts
// check-ins (tonight's stats and the tally, the CSV write-back into TwoTimTwo,
// undo reconciliation, the checkout board's printed count, name-based reprint
// lookup, the phone roster) — a missed exclusion at any of those sites means a
// recognition print counts as a child, so they must all share this test.
function isNonCheckinRow(e) {
  return !!(e && (e.isAward || e.isConnectCard || e.isLeader || e.oneOff));
}

// ── Reprint a whole stretch of tonight (#257) ────────────────────────────────
// A jam or a torn roll eats eight labels in a rush, and the operator had to
// reprint one Print History row at a time while a line formed at the door.
//
// Cap of 20, not 40: printImage runs PowerShell with a 15s timeout plus one retry
// preceded by a SYNCHRONOUS 750ms wait, i.e. up to ~31s of blocked event loop
// per label. Forty labels could stall POST /print for a child at the door for
// minutes. The inter-label gap below is an awaited setTimeout for the same
// reason — never Atomics.wait, which would defeat the point entirely.
const REPRINT_RANGE_MAX = 20;
const REPRINT_RANGE_GAP_MS = 400;

// Pure: takes a history array and a window, returns the rows to reprint. No
// fs, no config, no clock beyond what the caller passes, so every exclusion
// rule below is exhaustively testable.
//
// Awards, connect cards and leader tags are excluded UNCONDITIONALLY — there
// is no includeAwards flag, deliberately. POST /reprint branches only on
// isLeader; an isAward row would fall into the kid path and record a history
// row WITHOUT its isAward flag, so isNonCheckinRow() would stop excluding it
// and tonight's tally would count an award slip as a child on every screen.
function selectReprintRange(opts) {
  const {
    history = [], today = localDayISO(), fromISO, toISO,
    club = '', max = REPRINT_RANGE_MAX,
  } = opts || {};

  const from = new Date(fromISO);
  const to = new Date(toISO);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    return { error: 'bad-range' };
  }

  let want = '';
  if (String(club || '').trim()) {
    want = clubKey(club);
    // An unrecognised club string must NOT silently match everything — that
    // would print the whole night when the operator meant one club.
    if (!want) return { error: 'bad-club' };
  }

  const skipped = { nonCheckin: 0, failed: 0, undone: 0, otherClub: 0, duplicate: 0 };
  const seen = new Set();
  const rows = [];
  for (const r of history) {
    if (!r || !isOnLocalDay(r.timestamp, today)) continue;
    const t = new Date(r.timestamp);
    if (t < from || t > to) continue;                 // inclusive at both ends
    if (r.success === false) { skipped.failed++; continue; }
    if (isNonCheckinRow(r)) { skipped.nonCheckin++; continue; }
    // Reconciled away by the checkin report or a volunteer's Remove on the
    // phone: that child is not here, so a fresh label must not come out.
    if (r.undone) { skipped.undone++; continue; }
    if (want && clubKey(r.clubName) !== want) { skipped.otherClub++; continue; }
    if (!`${r.firstName || ''} ${r.lastName || ''}`.trim()) continue;
    // History is newest-first, so the FIRST row seen per identity is the
    // newest. Without this a stretch spanning an earlier reprint would print
    // the same child twice.
    const key = historyIdentityKey(r);
    if (seen.has(key)) { skipped.duplicate++; continue; }
    seen.add(key);
    rows.push(r);
  }

  const capped = rows.length > max;
  return { rows: rows.slice(0, max), count: Math.min(rows.length, max), capped, skipped };
}

function addHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift({
    // Bounded and control-character-stripped on the way in: these strings come
    // straight off a request body and are persisted, then rendered by the
    // dashboard. The dashboard escapes on output (that is the real fix for the
    // stored-XSS path); this keeps an unbounded or escape-laden value from
    // bloating the history file or mangling the console log.
    firstName: security.sanitizeStoredText(entry.firstName),
    lastName: security.sanitizeStoredText(entry.lastName),
    clubName: security.sanitizeStoredText(entry.clubName || ''),
    // A data: URL is kept once in club-icons.json and named here by hash; a
    // URL (small) rides along as it always did.
    clubIcon: rememberClubIcon(entry.clubImageData),
    clubImageData: typeof entry.clubImageData === 'string' && !entry.clubImageData.startsWith('data:') ? entry.clubImageData : null,
    printer: security.sanitizeStoredText(entry.printer || ''),
    success: entry.success,
    visitor: !!entry.visitor,
    // Award slips (POST /print-award) are flagged so they never masquerade
    // as a check-in: they're excluded from name-based /reprint lookups and
    // from tonight's check-in stats, but still show up in /history for the
    // dashboard's own record-keeping.
    isAward: !!entry.isAward,
    award: security.sanitizeStoredText(entry.award || ''),
    // #293: which handbook this label's trophy band celebrated. A marker, not
    // display data — it is what stops a second band for the same child tonight.
    // (Today's rows are never evicted, so it holds all evening; a reprint
    // weeks later may band once more, which is acceptable for a decoration.)
    trophyBook: security.sanitizeStoredText(entry.trophyBook || '', 60),
    // Connect cards (#10) are flagged for the same reason award slips are:
    // they show in /history so the operator can see the card went out, but
    // isNonCheckinRow() keeps them out of every place that counts check-ins.
    isConnectCard: !!entry.isConnectCard,
    // Leader name tags (POST /print-leader): an adult volunteer's tag, never a
    // child's check-in. Same exclusion everywhere via isNonCheckinRow().
    isLeader: !!entry.isLeader,
    // A one-off name tag (7.18.0): printed and logged, never a check-in.
    ...(entry.oneOff ? { oneOff: true } : {}),
    // TwoTimTwo's own clubber id, when the caller knew it. Everything here was
    // keyed on a lowercased "first last" string, so two children who share a
    // name merged into one row — the same defect the extension already fixed on
    // its side with identityKey(), which the server never followed. Stored as a
    // bounded string (ids are numeric today, but that is TwoTimTwo's business
    // to change). Absent on rows written before this, so every consumer must
    // fall back to the name — see historyRowMatches().
    clubberId: entry.clubberId != null && String(entry.clubberId).trim()
      ? security.sanitizeStoredText(String(entry.clubberId), 40)
      : null,
    timestamp: new Date().toISOString()
  });
  saveHistory(trimHistory(history));
}

// Newest first: the first MAX_HISTORY rows stay, and so does every row from
// today beyond them, up to HISTORY_HARD_MAX in all.
function trimHistory(history) {
  if (history.length <= MAX_HISTORY) return history;
  const today = localDayISO();
  const kept = [];
  for (const row of history) {
    if (kept.length >= HISTORY_HARD_MAX) break;
    if (kept.length < MAX_HISTORY || isOnLocalDay(row && row.timestamp, today)) kept.push(row);
  }
  return kept;
}

app.get('/history', (req, res) => {
  res.json(loadHistory().map(historyRowForDashboard));
});

app.get('/history/today', (req, res) => {
  const history = loadHistory();
  const today = localDayISO();
  const todayEntries = history.filter(e => isOnLocalDay(e.timestamp, today));
  res.json(todayEntries.map(historyRowForDashboard));
});

// ── Who is checked in tonight ─────────────────────────────────────────────────
// THE single definition. computeTonightStats() (→ the `tally` on every lobby
// screen and the dashboard's Tonight card), POST /phone/tonight and POST
// /phone/roster all read this, so the phone's list can never disagree with
// the number on the wall. Returns:
//   entries — every successful check-in print today, newest-first (the raw
//             "labels printed" population; reprints included)
//   active  — one row per child identity, newest row wins, undone rows dropped
// Failed prints, award slips, connect cards and leader tags never count a kid
// in (isNonCheckinRow), so they are out of both lists.
function tonightCheckins(history = loadHistory(), today = localDayISO()) {
  const entries = history.filter(e => e && isOnLocalDay(e.timestamp, today) && e.success !== false && !isNonCheckinRow(e));
  const seen = new Set();
  const active = [];
  for (const e of entries) {
    if (!`${e.firstName || ''} ${e.lastName || ''}`.trim()) continue;
    // Keyed on the clubber id when the row has one, so two children who share a
    // name count as two. Older rows without an id keep the name key.
    const key = historyIdentityKey(e);
    // The FIRST row seen per identity is the newest (history is newest-first) —
    // the same row R-1 reconciliation and the phone's Remove are allowed to
    // mark `undone`. Marking `seen` here, BEFORE the undone check, is what stops
    // an older duplicate row (a same-night reprint, or a stale pre-undo print)
    // from being read next and reviving a status the newest row has already
    // settled — "latest record wins", deterministically.
    if (seen.has(key)) continue;
    seen.add(key);
    // `undone` is set by R-1 reconciliation (TwoTimTwo's own report no longer
    // lists the child) or by a volunteer's Remove on the phone page. Either way
    // the next `tally` decrements instead of keeping the stale number all night.
    if (e.undone) continue;
    active.push(e);
  }
  // ── Two keys, one child ───────────────────────────────────────────────────
  // The same kid can leave BOTH an `id:` row and a `name:` row on one night:
  // a walk-in printed at the door before the roster knew them (no clubberId),
  // then a driven check-in from the extension minutes later (clubberId), or
  // the reverse. historyIdentityKey() cannot see that those are one person, so
  // the night counted them twice and the lobby screen read one child high.
  //
  // Collapse them here, preferring the `id:` row: the id is TwoTimTwo's own
  // identity for that child, and it is what /phone/undo, reconcile and the
  // reprint lookup all key on. The name row is dropped, not merged, so
  // nothing about the surviving row changes.
  const fullNameOf = (e) => `${e.firstName || ''} ${e.lastName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();
  const namesWithAnId = new Set();
  for (const e of active) {
    if (historyIdentityKey(e).startsWith('id:')) namesWithAnId.add(fullNameOf(e));
  }
  const deduped = namesWithAnId.size
    ? active.filter((e) => historyIdentityKey(e).startsWith('id:') || !namesWithAnId.has(fullNameOf(e)))
    : active;
  return { date: today, entries, active: deduped };
}

// ── Tonight's count: one definition, one source of truth ─────────────────────
// The printer counts LABELS IT PRINTED. That is not the same thing as "how
// many children are here", and the gap is not theoretical: a child checked in
// on TwoTimTwo while this laptop was asleep never got a label, a walk-in
// printed twice under two identities counted twice, and a night the extension
// was not running counted whatever history happened to hold.
//
// TwoTimTwo's own /clubber/checkin_report is the real answer, and the extension
// already fetches it. So: when a report has landed recently, THE REPORT IS THE
// COUNT, and the printer's own history only adds the children who checked in
// SINCE that report was taken (the optimistic tick-up, so the lobby screen
// still moves the moment a label prints instead of sitting still for five
// minutes). When no report has landed recently - no extension running, Chrome
// closed, the site down - it falls back to exactly the behaviour that shipped
// before, and /health says so out loud rather than quietly serving a worse
// number that looks identical.
//
// Rules worth not relearning:
//   * ONLY a report the reconcile pass actually APPLIED is kept. A report the
//     mass-undo guard refused (a partial scrape, a login bounce, the wrong
//     table) is exactly the kind of report that would zero the night here, and
//     the guard is the one place that judges a report's plausibility.
//   * A person's removal WINS over the report. A row marked `undoneBy` (the
//     phone's Remove, or /reset-tonight) suppresses that child even though
//     TwoTimTwo still lists them - which it will, because Remove is local by
//     design. Without this, Remove and Reset would both stop working the
//     moment a report went fresh. The phone's Undo check-in (7.14.0,
//     'twotimtwo') rides the same rule until the next report drops the child.
//   * UNREGISTERED VISITORS DO NOT COUNT while a report is fresh (owner's
//     decision, 2026-09-16). They are not in the report and they never will
//     be, so the tick-up skips them too; a visitor who IS on the report (they
//     were registered) counts like anyone else. They still appear on the phone
//     page's Tonight list and in `visitors`, which stay history-derived.
//   * Two keys, one child: a report entry carries TwoTimTwo's clubber id and a
//     history row may carry only a name, so identities are matched on BOTH and
//     collapsed. Counting the same child under `id:` and `name:` is the exact
//     over-count this is meant to remove, not one to reintroduce.
let lastCheckinReport = null;   // { at, entries } — the last report we trusted
let lastPartialReport = null;   // { at, parsed, declared } — the last one we refused as partial
// Who has been checked OUT tonight, by TwoTimTwo clubber id (7.15.0, owner
// 2026-10-07: "the number should go down when kids check out", on every
// surface). The extension's youth check-out (Trek and Journey from 7:15) posts
// its whole list for the meeting date after every pass, so a restart of this
// server catches up within one 30 s pass. Since 7.16.0 the phone's Check out
// adds to it too (and, with check-out tracking turned on, a child seen leaving
// TwoTimTwo's Checkout page); at KVBC that page lists nobody, tracking off.
// `names` (7.16.0): children with no clubber id here, checked out on the
// phone by name only (normalizedName keys); never sent to TwoTimTwo.
let checkedOutTonight = { date: null, ids: new Set(), names: new Set() };

// One child per clubber id, plus one per id-less name.
function distinctReportChildren(entries) {
  const keys = new Set();
  (Array.isArray(entries) ? entries : []).forEach((e) => {
    const id = e && e.clubberId != null ? String(e.clubberId).trim() : '';
    const name = normalizedName(e && e.name);
    if (id) keys.add(`id:${id}`); else if (name) keys.add(`name:${name}`);
  });
  return keys.size;
}

/** A report whose own footers list more children than the parse found. */
function reportIsPartial(payload) {
  return Boolean(payload) && Number.isInteger(payload.declared)
    && distinctReportChildren(payload.entries) < payload.declared;
}

// Two 5-minute extension polls plus slack. Longer than one missed poll (so a
// single hiccup does not flip the whole count back to history mode), shorter
// than a club night (so a report from the start of the evening cannot still be
// speaking for it at the end).
const REPORT_FRESH_MS = 12 * 60 * 1000;

const normalizedName = (name) => String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();

// EVERY key one identity could be filed under, id first. historyIdentityKey()
// answers with the single canonical key; this answers with all of them, which
// is what lets a report entry (always id-bearing) find a walk-in's name row.
function identityKeysOfRow(row) {
  const keys = [];
  const id = row && row.clubberId != null ? String(row.clubberId).trim() : '';
  if (id) keys.push(`id:${id}`);
  const name = normalizedName(`${(row && row.firstName) || ''} ${(row && row.lastName) || ''}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}

function identityKeysOfReportEntry(entry) {
  const keys = [];
  const id = entry && entry.clubberId != null ? String(entry.clubberId).trim() : '';
  if (id) keys.push(`id:${id}`);
  const name = normalizedName(entry && entry.name);
  if (name) keys.push(`name:${name}`);
  return keys;
}

// The club name as it should be displayed, from whichever side supplied it.
// `&amp;` is decoded because the report's club comes out of a crest's alt
// attribute and a raw entity would make T&T a club of its own.
const displayClub = (raw) => String(raw == null ? '' : raw).replace(/&amp;/gi, '&').trim();

/**
 * WHO is here now tonight: one entry per child, by the rules of the count
 * (below). authoritativeTonight() counts these; the lobby's still-here list
 * (7.16.0, publishStillHere) names them. Pure but for its reads of
 * lastCheckinReport and checkedOutTonight.
 *
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            children:Array<{keys:string[], club:string, firstName:string}>,
 *            checkedOut:number}}
 */
function tonightHereNow(tonight = tonightCheckins(), now = Date.now()) {
  // Checked out tonight: off every count, report or history (7.15.0). By
  // clubber id; a child with no id here can be marked by name (7.16.0, the
  // phone's local "Mark checked out").
  const sameNight = checkedOutTonight.date === tonight.date;
  const outIds = sameNight ? checkedOutTonight.ids : new Set();
  const outNames = sameNight && checkedOutTonight.names ? checkedOutTonight.names : new Set();
  const isOut = (keys) => keys.some((k) => (k.startsWith('id:') && outIds.has(k.slice(3)))
    || (k.startsWith('name:') && outNames.has(k.slice(5))));
  const fromHistory = () => {
    const children = [];
    let out = 0;
    tonight.active.forEach((e) => {
      const keys = identityKeysOfRow(e);
      if (isOut(keys)) { out += 1; return; }
      children.push({ keys, club: displayClub(e.clubName), firstName: String(e.firstName || '').trim() });
    });
    return { source: 'history', at: null, ageMs: null, children, checkedOut: out };
  };

  const rep = lastCheckinReport;
  if (!rep) return fromHistory();
  const ageMs = now - rep.at;
  // A report from the future (a clock jump) is not fresh, it is broken.
  if (ageMs < 0 || ageMs > REPORT_FRESH_MS) return fromHistory();
  if (localDayISO(new Date(rep.at)) !== tonight.date) return fromHistory();

  // Identities a PERSON took off tonight, and the club (and first name) each
  // identity's rows were printed under. Both read the newest row per
  // identity, the same row every other consumer treats as current.
  const suppressed = new Set();
  const clubByKey = new Map();
  const firstByKey = new Map();
  const seen = new Set();
  for (const e of tonight.entries) {
    if (!`${e.firstName || ''} ${e.lastName || ''}`.trim()) continue;
    const canonical = historyIdentityKey(e);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const keys = identityKeysOfRow(e);
    const club = displayClub(e.clubName);
    const first = String(e.firstName || '').trim();
    keys.forEach((k) => {
      if (club && !clubByKey.has(k)) clubByKey.set(k, club);
      if (first && !firstByKey.has(k)) firstByKey.set(k, first);
      if (e.undone && e.undoneBy) suppressed.add(k);
    });
  }

  const byKey = new Map();
  const slots = [];
  const left = new Set();
  const add = (keys, club, firstName) => {
    if (!keys.length) return;
    if (keys.some((k) => suppressed.has(k))) return;
    if (isOut(keys)) { left.add(keys.find((k) => k.startsWith('id:')) || keys[0]); return; }
    // Two different TwoTimTwo ids are two different children, whatever their
    // names say: a name match only joins an entry to a slot that has no id, or
    // the same one. (A shared bogus "name" merged every child with the same
    // report summary into one: 11 checked in read as 2, 2026-10-07.)
    const id = keys.find((k) => k.startsWith('id:'));
    let slot = null;
    for (const k of keys) {
      const hit = byKey.get(k);
      if (!hit) continue;
      const hitId = [...hit.keys].find((x) => x.startsWith('id:'));
      if (id && hitId && hitId !== id) continue;
      slot = hit;
      break;
    }
    if (!slot) { slot = { keys: new Set(), club: '', firstName: '' }; slots.push(slot); }
    if (!slot.club && club) slot.club = club;
    if (!slot.firstName && firstName) slot.firstName = firstName;
    keys.forEach((k) => { slot.keys.add(k); byKey.set(k, slot); });
  };

  // The report is the floor.
  (Array.isArray(rep.entries) ? rep.entries : []).forEach((entry) => {
    add(identityKeysOfReportEntry(entry), displayClub(entry && entry.club), splitFullName(entry && entry.name).firstName);
  });
  // Plus everyone who checked in since it was taken. Visitors excluded: they
  // have no TwoTimTwo record, so the next report would silently drop them and
  // the count would go backwards on screen.
  tonight.active.forEach((row) => {
    if (row.visitor) return;
    const at = Date.parse(row.timestamp);
    if (!Number.isFinite(at) || at <= rep.at) return;
    add(identityKeysOfRow(row), displayClub(row.clubName), String(row.firstName || '').trim());
  });

  const children = slots.map((slot) => {
    let club = slot.club;
    let firstName = '';
    for (const k of slot.keys) {
      if (!club && clubByKey.has(k)) club = clubByKey.get(k);
      // The name this printer printed beats the report's first word ("Mary
      // Kate" prints as Mary Kate; the report's split would say Mary).
      if (!firstName && firstByKey.has(k)) firstName = firstByKey.get(k);
    }
    return { keys: [...slot.keys], club: club || '', firstName: firstName || slot.firstName };
  });

  return { source: 'report', at: rep.at, ageMs, children, checkedOut: left.size };
}

/**
 * THE one function every surface asks "how many children are here tonight".
 * Pure but for its read of lastCheckinReport, so both modes are unit-tested
 * without a socket, a scrape or a clock.
 *
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            checkedIn:number, byClub:Object}}
 */
function authoritativeTonight(tonight = tonightCheckins(), now = Date.now()) {
  const here = tonightHereNow(tonight, now);
  const byClub = {};
  here.children.forEach((c) => {
    const name = c.club || 'No club';
    byClub[name] = (byClub[name] || 0) + 1;
  });
  return { source: here.source, at: here.at, ageMs: here.ageMs, checkedIn: here.children.length, checkedOut: here.checkedOut, byClub };
}

// ── Tonight at a glance ───────────────────────────────────────────────────────
// Aggregates tonight's active check-ins + the roster into the numbers a
// director needs during the event: kids checked in per club, visitors, and the
// safety flags for everyone currently in the building (allergies, birthdays,
// no-photo kids). Each child counts once no matter how many reprints.
//
// `checkedIn` and `byClub` come from authoritativeTonight() - the report when
// one is fresh, this printer's own history otherwise - and `countSource` says
// which, so no surface has to guess. Everything else here stays history-derived
// on purpose: the safety flags need a roster row, which the report has no idea
// about, and `visitors` is a fact about what this printer printed.
function computeTonightStats(tonight = tonightCheckins(), now = Date.now()) {
  let visitors = 0;
  const allergyKids = [];
  const birthdayKids = [];
  const noPhotoKids = [];

  tonight.active.forEach(e => {
    const name = `${e.firstName || ''} ${e.lastName || ''}`.trim();
    if (e.visitor) visitors++;

    const record = findClubber(e.firstName, e.lastName);
    if (!record) return;
    const tokens = parseAllergies(record.Allergies || record.Notes || '');
    if (tokens.length) allergyKids.push({ name, allergies: tokens });
    if (isBirthdayWeek(record.Birthdate)) birthdayKids.push(name);
    if (noPhotoFor(record)) noPhotoKids.push(name);
  });

  const auth = authoritativeTonight(tonight, now);

  return {
    date: tonight.date,
    prints: tonight.entries.length,
    checkedIn: auth.checkedIn,
    // Checked out tonight, already taken off `checkedIn` (7.15.0).
    checkedOut: auth.checkedOut || 0,
    visitors,
    byClub: auth.byClub,
    // Which measurement the two numbers above came from, and how old it is.
    // Additive: every existing field keeps its meaning.
    countSource: auth.source,
    reportAt: auth.at ? new Date(auth.at).toISOString() : null,
    reportAgeMs: auth.ageMs,
    allergyKids,
    birthdayKids,
    noPhotoKids
  };
}

app.get('/stats/tonight', (req, res) => {
  res.json(computeTonightStats());
});

// ── Is our count right? ───────────────────────────────────────────────────────
// The print server counts labels it printed. TwoTimTwo counts children its
// own check-in screen recorded. Those are two independent measurements of
// the same night, and until now nothing compared them — so a child checked
// in without a label, or a label printed for a child TwoTimTwo never saw,
// was invisible to everyone until somebody read a report days later.
//
// The extension already fetches TwoTimTwo's /clubber/checkin_report every
// ~60s for undo detection; it now posts that report's per-club counts here
// too. Kept deliberately LOCAL: this never becomes a Pusher event, so the
// display contract (and its mirrored vectors) is untouched, and the lobby TV
// never carries a disagreement between two staff tools.
//
// In memory only, on purpose. It is a live second opinion about TONIGHT that
// refreshes every minute; persisting it would mainly create the opportunity
// to show a stale one after a restart.
let sourceCount = null; // { date, checkedIn, byClub, at }

const SOURCE_COUNT_STALE_MS = 5 * 60 * 1000; // ~5 polls; the extension posts every ~60s

// Club names arrive from two different places — TwoTimTwo's crest alt text
// ("T&T", "Cubbies ") and whatever the label was printed with — so they are
// folded through the SAME clubKey() the label renderer uses, rather than a
// second private normaliser (v6.3.0's one-club-list rule). Anything it does
// not recognise ("No club") still compares, by its own trimmed name, so an
// unknown club can never silently merge into a known one.

// Pure, so every branch below is testable without a socket, a printer or a
// clock (same discipline as reconcileHistoryWithReport and the display
// repo's decideBoard). Takes the two counts; returns the verdict.
//
// Direction matters, because the two directions mean opposite things:
//   ours < theirs  — a child TwoTimTwo checked in never got a label here.
//                    The one a volunteer must act on: that child is in the
//                    building wearing nothing.
//   ours > theirs  — we printed for someone TwoTimTwo has no record of.
//                    Usually benign and fully explained by walk-in guests
//                    printed without "Also register in TwoTimTwo", which is
//                    a supported way to work — so those are counted and
//                    subtracted before calling anything wrong.
function compareCounts(stats, source, now = Date.now()) {
  if (!source || source.date !== stats.date) {
    return { known: false, reason: 'no-source', ours: stats.checkedIn };
  }
  const ageMs = now - source.at;
  if (ageMs > SOURCE_COUNT_STALE_MS) {
    return { known: false, reason: 'stale', ours: stats.checkedIn, ageMs, theirs: source.checkedIn };
  }

  const ours = stats.checkedIn;
  const theirs = source.checkedIn;
  const diff = ours - theirs;

  // Children this server printed for that TwoTimTwo cannot know about: a
  // walk-in guest posts no clubberId. Counted per club so a club-level gap
  // can be explained by the same rule as the total.
  const unregistered = stats.unregistered || 0;
  const unregisteredByClub = stats.unregisteredByClub || {};

  // `&amp;` is decoded before folding: the club name normally arrives already
  // decoded from the crest's alt attribute, but a raw entity slipping through
  // must not turn T&T into a club of its own that agrees with nothing.
  const fold = (name) => {
    const decoded = String(name || '').replace(/&amp;/gi, '&');
    return clubKey(decoded) || decoded.trim().toLowerCase() || 'no club';
  };
  const tally = (src) => {
    const out = {};
    for (const [c, n] of Object.entries(src || {})) {
      if (!Number.isFinite(n)) continue;
      const k = fold(c);
      out[k] = (out[k] || 0) + n;
    }
    return out;
  };
  const ourByKey = tally(stats.byClub);
  const theirByKey = tally(source.byClub);
  const unregByKey = tally(unregisteredByClub);
  const clubs = new Set([...Object.keys(ourByKey), ...Object.keys(theirByKey)]);

  const byClub = [...clubs].map((key) => {
    const o = ourByKey[key] || 0;
    const t = theirByKey[key] || 0;
    const u = unregByKey[key] || 0;
    return {
      club: CLUB_DISPLAY_NAMES[key] || key,
      ours: o,
      theirs: t,
      diff: o - t,
      // What is left once walk-ins we never registered are accounted for.
      unexplained: (o - t) - (o > t ? Math.min(u, o - t) : 0),
    };
  }).sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained) || a.club.localeCompare(b.club));

  // Only an excess can be explained away by unregistered walk-ins; a shortfall
  // never can, so it is never softened.
  const explained = diff > 0 ? Math.min(unregistered, diff) : 0;
  const unexplained = diff - explained;

  return {
    known: true,
    ours,
    theirs,
    diff,
    unregistered,
    explained,
    unexplained,
    matches: unexplained === 0,
    // Which way it is off, in the words the surfaces use.
    direction: unexplained === 0 ? 'match' : (unexplained < 0 ? 'missing-labels' : 'extra-labels'),
    byClub: byClub.filter(c => c.ours || c.theirs),
    ageMs,
    at: source.at,
  };
}

// Our side of the comparison, per club, plus the walk-ins TwoTimTwo cannot
// be expected to know about (no clubberId — see the walk-in POST in
// content.js, which sends a name and a club and nothing else).
function countsForCompare(tonight = tonightCheckins()) {
  const byClub = {};
  const unregisteredByClub = {};
  let checkedIn = 0;
  let unregistered = 0;
  tonight.active.forEach((e) => {
    const club = (e.clubName || '').trim() || 'No club';
    checkedIn++;
    byClub[club] = (byClub[club] || 0) + 1;
    if (e.clubberId == null || String(e.clubberId).trim() === '') {
      unregistered++;
      unregisteredByClub[club] = (unregisteredByClub[club] || 0) + 1;
    }
  });
  return { date: tonight.date, checkedIn, byClub, unregistered, unregisteredByClub };
}

// The extension posts TwoTimTwo's own count here. Rejects anything it cannot
// read rather than storing a zero: "I could not read the report" and "nobody
// is checked in" must never collapse into the same number (the same rule the
// parser upstream now follows).
app.post('/feed/source-count', (req, res) => {
  const b = req.body || {};
  const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  if (!date) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
  if (!Number.isInteger(b.checkedIn) || b.checkedIn < 0) {
    return res.status(400).json({ ok: false, error: 'checkedIn must be a non-negative integer' });
  }
  const byClub = {};
  if (b.byClub && typeof b.byClub === 'object' && !Array.isArray(b.byClub)) {
    for (const [club, n] of Object.entries(b.byClub)) {
      if (Number.isInteger(n) && n >= 0 && String(club).trim()) byClub[String(club).trim()] = n;
    }
  }
  sourceCount = { date, checkedIn: b.checkedIn, byClub, at: Date.now() };
  res.json({ ok: true });
});

// What every surface reads. GET for the dashboard and the check-in widget,
// POST so the phone page's POST-only helper (and its PIN) can reach it too.
function reconcileHandler(req, res) {
  res.json(compareCounts(countsForCompare(), sourceCount));
}
app.get('/reconcile', reconcileHandler);
app.post('/reconcile', reconcileHandler);

// ── Attendance audit (#311) ──────────────────────────────────────────────────
// attendance.json drives milestones, the streak flame, the new-kid sparkle and
// the auto connect card, and nothing has ever checked it against the source of
// truth. A night the printer was down leaves a permanent hole that quietly
// prints wrong milestones for the rest of the season.
//
// So: the extension scrapes TwoTimTwo's own /report/attendance_grid (one column
// per meeting date) and posts it here; this diffs it against the ledger. Two
// disciplines run through all of it:
//
//   1. UNKNOWN IS NOT ZERO. A failed or absent grid reports "not checked",
//      never "you attended nothing" and never "agrees".
//   2. APPLY IS ADDITIVE ONLY. The ledger legitimately holds walk-in guests
//      TwoTimTwo never saw, so a date the grid lacks is not an error to delete;
//      it is information the site does not have.
//
// In memory only, like sourceCount above: it is a periodic second opinion, and
// persisting it would mainly create the chance to show a stale one. The rows
// carry children's FULL names, so this route is standalone and never published
// — see the comment on the POST below.
let attendanceGrid = null; // { season, meetingDates, clubsRead, clubsFailed, rows, at }

const ATTENDANCE_GRID_STALE_MS = 8 * 24 * 60 * 60 * 1000; // a week plus slack

const ATTENDANCE_GRID_MAX_ROWS = 600;
const ATTENDANCE_GRID_MAX_DATES = 60;

// Validated INLINE like /feed/source-count, and deliberately NOT registered in
// FEED_NAMES / routed through makeFeedRoute(): that helper publishes every
// registered feed to the PUBLIC Pusher channel, and these rows carry full
// names. Same never-published class as /feed/checkin-report,
// /feed/unverified-checkins and /feed/completed-books.
app.post('/feed/attendance-grid', (req, res) => {
  const b = req.body || {};
  const bad = (msg) => res.status(400).json({ ok: false, error: msg });
  if (!b || typeof b !== 'object' || Array.isArray(b)) return bad('body must be an object');
  if (!Array.isArray(b.meetingDates) || !b.meetingDates.length
      || b.meetingDates.length > ATTENDANCE_GRID_MAX_DATES
      || !b.meetingDates.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    // A missing/garbled date list is NOT an empty grid: without it every ledger
    // date would read as "the site does not have this", which is a fabricated
    // discrepancy report.
    return bad('meetingDates must be a non-empty array of YYYY-MM-DD strings');
  }
  const clubsRead = Array.isArray(b.clubsRead)
    ? b.clubsRead.map(c => security.sanitizeStoredText(c, 60)).filter(Boolean).slice(0, 12) : [];
  if (!clubsRead.length) return bad('clubsRead must name at least one club that was actually read');
  const clubsFailed = Array.isArray(b.clubsFailed)
    ? b.clubsFailed.map(c => security.sanitizeStoredText(c, 60)).filter(Boolean).slice(0, 12) : [];
  if (!Array.isArray(b.rows) || b.rows.length > ATTENDANCE_GRID_MAX_ROWS) {
    return bad(`rows must be an array of at most ${ATTENDANCE_GRID_MAX_ROWS} entries`);
  }
  const dateSet = new Set(b.meetingDates);
  const rows = [];
  for (const raw of b.rows) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('every row must be an object');
    const name = security.sanitizeStoredText(raw.name || '', 80);
    if (!name) return bad('every row needs a name');
    if (!Array.isArray(raw.dates) || raw.dates.length > ATTENDANCE_GRID_MAX_DATES) {
      return bad('every row needs a dates array');
    }
    for (const d of raw.dates) {
      // A date outside the grid's own meeting list means the parser and the
      // header disagree — refuse the whole post rather than audit against it.
      if (typeof d !== 'string' || !dateSet.has(d)) return bad('every row date must be one of meetingDates');
    }
    rows.push({ name, club: security.sanitizeStoredText(raw.club || '', 60), dates: raw.dates.slice() });
  }
  attendanceGrid = {
    season: security.sanitizeStoredText(b.season || '', 20),
    meetingDates: b.meetingDates.slice(),
    clubsRead, clubsFailed, rows, at: Date.now(),
  };
  res.json({ ok: true, rows: rows.length, clubs: clubsRead.length });
});

// Pure, so unknown-vs-zero and additive-only are unit-tested without a browser
// (same discipline as compareCounts and reconcileHistoryWithReport).
function auditAttendance(ledger, grid, now = Date.now(), today = localDayISO()) {
  if (!grid) return { known: false, reason: 'no-grid' };
  const ageMs = now - grid.at;
  if (ageMs > ATTENDANCE_GRID_STALE_MS) {
    return { known: false, reason: 'stale', ageMs, at: grid.at };
  }
  // Only PAST meetings the grid itself lists are in scope. Everything else —
  // prior seasons the ledger never prunes, a future meeting, a date only one
  // side has ever heard of — is out of scope, not a discrepancy.
  const scope = new Set((grid.meetingDates || []).filter(d => d <= today));
  if (!scope.size) return { known: false, reason: 'no-meetings', ageMs, at: grid.at };

  const clubOf = (c) => clubKey(c) || String(c || '').trim().toLowerCase();
  const readClubs = new Set((grid.clubsRead || []).map(clubOf));

  // The grid's Clubber column ordering was never observed, so "Last, First"
  // has to key the same child as "First Last".
  const normName = (raw) => {
    let s = String(raw == null ? '' : raw).replace(/&amp;/gi, '&').trim();
    const comma = s.indexOf(',');
    if (comma !== -1) s = `${s.slice(comma + 1).trim()} ${s.slice(0, comma).trim()}`;
    return s.toLowerCase().replace(/\s+/g, ' ').trim();
  };

  const gridByName = new Map();
  for (const r of (grid.rows || [])) {
    const k = normName(r.name);
    if (!k) continue;
    if (!gridByName.has(k)) gridByName.set(k, []);
    gridByName.get(k).push(r);
  }
  const ledgerByName = new Map();
  for (const [key, entry] of Object.entries(ledger || {})) {
    if (!entry || !Array.isArray(entry.dates)) continue;
    const k = normName(entry.name);
    if (!k) continue;
    if (!ledgerByName.has(k)) ledgerByName.set(k, []);
    ledgerByName.get(k).push({ key, entry });
  }

  const rows = [];
  const ambiguous = [];
  const notOnRoster = [];
  const neverPrinted = [];

  for (const [k, hits] of ledgerByName) {
    const gridHits = gridByName.get(k) || [];
    if (hits.length > 1 || gridHits.length > 1) {
      // Two children sharing a name: matching either one would be a guess, and
      // a guess here writes into the season ledger. Named, never applied.
      ambiguous.push(hits[0].entry.name);
      continue;
    }
    if (!gridHits.length) {
      // A walk-in guest TwoTimTwo never saw, or a child in an unread club.
      notOnRoster.push(hits[0].entry.name);
      continue;
    }
    const g = gridHits[0];
    if (readClubs.size && !readClubs.has(clubOf(g.club))) continue; // club not read: out of scope
    const { key, entry } = hits[0];
    const theirs = new Set((g.dates || []).filter(d => scope.has(d)));
    const mine = new Set((entry.dates || []).filter(d => scope.has(d)));
    const missingHere = [...theirs].filter(d => !mine.has(d)).sort();
    const ledgerOnly = [...mine].filter(d => !theirs.has(d)).sort();
    // A ledger date the grid has no meeting for at all is recorded separately:
    // it is not the site disagreeing, it is a night the site never held.
    const noMeeting = (entry.dates || []).filter(d => typeof d === 'string' && d <= today && !scope.has(d)).sort();
    if (missingHere.length || ledgerOnly.length) {
      rows.push({ name: entry.name, club: g.club || '', key, missingHere, ledgerOnly, noMeeting });
    }
  }
  for (const [k, gridHits] of gridByName) {
    if (ledgerByName.has(k)) continue;
    if (readClubs.size && !readClubs.has(clubOf(gridHits[0].club))) continue;
    // On TwoTimTwo but never printed here (likely another station). Reported,
    // never added: this machine has no ledger entry to add dates to, and
    // inventing one would fabricate a child's attendance history.
    neverPrinted.push(gridHits[0].name);
  }

  const missing = rows.reduce((n, r) => n + r.missingHere.length, 0);
  const only = rows.reduce((n, r) => n + r.ledgerOnly.length, 0);
  return {
    known: true, at: grid.at, ageMs, season: grid.season || '',
    scopeDates: scope.size,
    clubsRead: (grid.clubsRead || []).slice(),
    clubsUnread: (grid.clubsFailed || []).slice(),
    rows,
    totals: { missing, ledgerOnly: only },
    matches: rows.length === 0,
    ambiguous, notOnRoster, neverPrinted,
  };
}

app.get('/attendance-audit', (req, res) => {
  res.json(auditAttendance(loadAttendance(), attendanceGrid));
});

// ── Who came lately (7.3.0, the touch check-in's bottom row) ─────────────────
// The last two club nights before today, and every child who was at either:
// the touch check-in moves a family whose children were at neither down to
// a row of smaller buttons. A club night is any date some child attended (the
// streak's rule), so a cancelled week never counts against anyone. Fewer than
// two club nights so far means nothing is split (ready: false).
function recentAttendance(ledger, today = localDayISO()) {
  const nights = new Set();
  for (const k of Object.keys(ledger || {})) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    for (const d of ds) if (typeof d === 'string' && d < today) nights.add(d);
  }
  const lastTwo = [...nights].sort().slice(-2);
  if (lastTwo.length < 2) return { ready: false, nights: lastTwo, ids: [], names: [] };
  const ids = [], names = [];
  for (const k of Object.keys(ledger)) {
    const e = ledger[k];
    const ds = e && Array.isArray(e.dates) ? e.dates : [];
    if (!ds.some(d => lastTwo.includes(d))) continue;
    if (k.startsWith('id:')) ids.push(k.slice(3));
    if (e.name) names.push(String(e.name).toLowerCase().trim());
  }
  return { ready: true, nights: lastTwo, ids, names };
}

app.get('/touch/recent', (req, res) => {
  res.json(recentAttendance(loadAttendance()));
});

// What the phone page needs to look like the touch check-in (7.7.0), sent by
// the check-in laptop's extension, which can read TwoTimTwo: the household
// groupings (children's names only, lowercased, two or more to a household)
// and which clubs' check-in has Bible / Brought a friend (club names). Nothing
// else is accepted. Loopback only (the extension), kept on disk so phones keep
// their families across a restart.
const TOUCH_CONTEXT_FILE = path.join(DATA_DIR, 'touch-context.json');
function sanitizeTouchContext(body) {
  const b = body || {};
  const name = (x) => security.sanitizeStoredText(String(x || ''), 120).toLowerCase().replace(/\s+/g, ' ').trim();
  const households = (Array.isArray(b.households) ? b.households : []).slice(0, 2000)
    .map(h => (Array.isArray(h) ? h : []).slice(0, 20).map(name).filter(Boolean))
    .filter(h => h.length >= 2);
  const clubs = (x) => (Array.isArray(x) ? x : []).slice(0, 20)
    .map(c => security.sanitizeStoredText(String(c || ''), 40).trim()).filter(Boolean);
  const items = { bible: clubs(b.items && b.items.bible), friend: clubs(b.items && b.items.friend) };
  return { households, items, at: new Date().toISOString() };
}
let touchContext = null;
function loadTouchContext() {
  if (touchContext) return touchContext;
  try {
    if (fs.existsSync(TOUCH_CONTEXT_FILE)) touchContext = sanitizeTouchContext(JSON.parse(fs.readFileSync(TOUCH_CONTEXT_FILE, 'utf8')));
  } catch (e) { console.warn('[touch] Could not read the saved families:', e.message); }
  return touchContext || { households: [], items: { bible: [], friend: [] }, at: null };
}
app.post('/touch/context', (req, res) => {
  if (!security.isLoopbackRequest(req)) return res.status(403).json({ error: 'The check-in laptop only' });
  touchContext = sanitizeTouchContext(req.body);
  try { fs.writeFileSync(TOUCH_CONTEXT_FILE, JSON.stringify(touchContext)); } catch (e) { console.warn('[touch] Could not save the families:', e.message); }
  res.json({ ok: true, households: touchContext.households.length });
});

// ADDITIVE ONLY, and confirm-gated like /reset-tonight. It recomputes the audit
// server-side rather than trusting a client-supplied date list, adds only dates
// for children who already have a ledger entry and matched exactly one grid
// row, and never deletes anything — the ledger's extra dates are walk-in
// guests, not errors.
app.post('/attendance-audit/apply', (req, res) => {
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'confirm: true required — this writes dates into the season ledger' });
  }
  const ledger = loadAttendance();
  const today = localDayISO();
  const audit = auditAttendance(ledger, attendanceGrid, Date.now(), today);
  if (!audit.known) {
    return res.status(409).json({ error: 'No readable attendance grid — nothing to apply', reason: audit.reason });
  }
  const scope = new Set(attendanceGrid.meetingDates.filter(d => d <= today));
  let added = 0;
  const touched = [];
  for (const row of audit.rows) {
    const entry = ledger[row.key];
    if (!entry || !Array.isArray(entry.dates)) continue;
    let mine = 0;
    for (const d of row.missingHere) {
      if (!scope.has(d) || d > today) continue;
      if (entry.dates.includes(d)) continue;
      entry.dates.push(d);
      added++; mine++;
    }
    if (mine) {
      // Sorted so the min-date and club-night walks in recordAttendance stay
      // predictable.
      entry.dates.sort();
      touched.push(row.name);
    }
  }
  if (added) saveAttendance(ledger);
  console.log(`[audit] Applied ${added} missing attendance date(s) across ${touched.length} child(ren); 0 deleted`);
  res.json({ ok: true, added, children: touched, deleted: 0 });
});

// ── Label preview ────────────────────────────────────────────────────────────
app.get('/preview', async (req, res) => {
  const { name, firstName: qFirst, lastName: qLast } = req.query;
  // Express hands back an array for a repeated query param (?clubName=a&clubName=b);
  // String() keeps the label renderer off a non-string.
  const clubName = String(req.query.clubName == null ? '' : req.query.clubName);
  let firstName, lastName;
  if (qFirst) {
    firstName = String(qFirst).trim();
    lastName = String(qLast || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || 'Preview';
    lastName = parts.slice(1).join(' ') || '';
  } else {
    firstName = 'Preview';
    lastName = 'Label';
  }

  // Enrich from CSV if available
  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName);
  let allergyTokens = [], handbookGroup = '', birthday = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    birthdayAge = birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto = noPhotoFor(record);
    // Same roster fill (and same ordering) as /print — a preview must show the
    // label the same request would PRINT, pseudo-group suppression included.
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
    handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, effectiveClubName);
  }

  // Editor live preview: an unsaved template rides in ?template=<json>. It is
  // sanitized exactly like a saved one and is never persisted; a parse failure
  // falls back to the saved template, so a typo can't 500 the preview. The
  // ?visitor=1 flag exists so the editor can see the VISITOR pill toggle.
  let template = labelTemplateFor(effectiveClubName);
  if (typeof req.query.template === 'string' && req.query.template) {
    try {
      const t = sanitizeLabelTemplate(JSON.parse(req.query.template));
      if (t) template = t;
    } catch { /* keep the saved template */ }
  }
  const previewVisitor = req.query.visitor === '1';

  try {
    const twinP = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName,
      allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, noPhoto,
      isVisitor: previewVisitor,
      middleInitial: twinP.middleInitial, nameHint: twinP.nameHint,
      footerText: labelFooterText(),
      template,
    });
    // X-Tag-Size (inches, "w x h") lets the dashboard draw it at true size.
    res.set('Content-Type', 'image/png');
    res.set('X-Tag-Size', '4.00x2.00');
    res.set('X-Tag-Printer', 'label');
    res.send(result.buffer);
    // Clean up temp file
    fs.unlink(result.pngPath, () => {});
  } catch (err) {
    console.error('[preview] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Reprint ──────────────────────────────────────────────────────────────────
// One history row, reprinted. Factored out of POST /reprint unchanged so the
// range reprint (#257) reuses the SAME path rather than growing a second one —
// which is what keeps the ledger, the tally and the sealed checkin event out
// of it: a reprint is never a check-in, and this function calls neither
// recordAttendance nor events.publish nor publishTally.
//
// Returns { ok: true, name, leader? } or { ok: false, name, error }. It never
// throws and never touches `res`.
//
// opts.silent skips the musical-printer tune (range mode only): at
// config.musicalPrinter === true a burst of 20 would play 20 tunes, and each
// failure costs a synchronous 400ms wait inside playTuneIfEnabled.
async function reprintRow(entry, printerName, opts = {}) {
  const fullName = `${entry.firstName} ${entry.lastName}`;
  // Belt and braces with the route's own guard above: this function is also
  // reached from /reprint-range, and a recognition print that came back out of
  // here as a plain check-in label would be counted as a child. Refuse rather
  // than silently render the wrong artifact.
  if (entry.isAward || entry.isConnectCard) {
    return { ok: false, name: fullName, error: 'not a check-in label' };
  }
  const effectivePrinter = (printerName && printerName.trim()) || entry.printer || PRINTER_NAME;
  const silent = opts.silent === true;

  // A one-off name tag reprinted from the print log stays a one-off: the
  // same plain tag again, a row that is still `oneOff` (never a check-in),
  // and no welcome on the screens (a reprint never greets anyone).
  if (entry.oneOff) {
    let png = null;
    try {
      const result = await renderOneOffLabel(entry.firstName, entry.clubName);
      png = result.pngPath;
      await printLabel(png, effectivePrinter);
      addHistoryEntry({ firstName: entry.firstName, lastName: '', clubName: entry.clubName, printer: effectivePrinter, success: true, oneOff: true });
      console.log(`[reprint] one-off tag ${entry.firstName}`);
      return { ok: true, name: entry.firstName, oneOff: true };
    } catch (err) {
      console.error('[reprint] Error:', err.message);
      addHistoryEntry({ firstName: entry.firstName, lastName: '', clubName: entry.clubName, printer: effectivePrinter, success: false, oneOff: true });
      recordPrintFailure(entry.firstName, entry.clubName, err.message);
      return { ok: false, name: entry.firstName, error: err.message };
    } finally {
      if (png) fs.unlink(png, () => {});
    }
  }

  // A leader tag reprinted by index must come back out as a leader tag: the
  // kid path below would render allergy/birthday enrichment for a same-named
  // child and record an UNFLAGGED row — turning an adult's name tag into a
  // counted check-in, the exact thing isLeader exists to prevent.
  if (entry.isLeader) {
    let leaderPng = null;
    try {
      const result = await renderLeaderLabel({ firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName });
      leaderPng = result.pngPath;
      if (!silent) await playTuneIfEnabled(effectivePrinter);
      await printLabel(leaderPng, effectivePrinter);
      addHistoryEntry({
        firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
        printer: effectivePrinter, success: true, isLeader: true,
      });
      console.log(`[reprint] leader tag ${fullName}`);
      return { ok: true, name: fullName, leader: true };
    } catch (err) {
      console.error('[reprint] Error:', err.message);
      addHistoryEntry({
        firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
        printer: effectivePrinter, success: false, isLeader: true,
      });
      recordPrintFailure(fullName.trim(), entry.clubName, err.message);
      return { ok: false, name: fullName, error: err.message };
    } finally {
      if (leaderPng) fs.unlink(leaderPng, () => {});
    }
  }

  let pngPath = null;
  try {
    clubbers = loadClubbers();
    const record = findClubber(entry.firstName, entry.lastName);
    let allergyTokens = [], handbookGroup = '', birthday = false, birthdayAge = null, noPhoto = false;
    if (record) {
      const allergySource = record.Allergies || record.Notes || '';
      allergyTokens = parseAllergies(allergySource);
      handbookGroup = effectiveHandbookGroup(record.HandbookGroup || record.Group, entry.clubName);
      birthday = isCakeWeek(record.Birthdate);
      // Re-derived from the roster, not restored from the history row (which
      // stores no birthdate), so a reprint matches the label that first
      // printed instead of silently dropping its age line.
      birthdayAge = birthdayAgeThisWeek(record.Birthdate);
      noPhoto = noPhotoFor(record);
    }

    const clubImageBuffer = await resolveImageBuffer(historyClubImage(entry));
    // NOTE: visitor, stepUp, awanaShares, goToLine and milestoneLine are all
    // absent here because print history never stored them, so a reprint has
    // quietly differed from the original label. Naming the fields makes that
    // omission visible rather than hidden in a run of positional `false`s.
    const twinR = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName: entry.firstName, lastName: entry.lastName, clubName: entry.clubName,
      clubImageBuffer, allergyTokens, handbookGroup, isBirthday: birthday, birthdayAge, noPhoto,
      middleInitial: twinR.middleInitial, nameHint: twinR.nameHint,
      footerText: labelFooterText(),
      template: labelTemplateFor(entry.clubName),
    });
    pngPath = result.pngPath;

    if (!silent) await playTuneIfEnabled(effectivePrinter, birthday ? 'birthday' : undefined);
    await printLabel(pngPath, effectivePrinter);

    addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: historyClubImage(entry),
      printer: effectivePrinter, success: true, clubberId: entry.clubberId
    });

    console.log(`[reprint] ${fullName}`);
    return { ok: true, name: fullName };
  } catch (err) {
    console.error('[reprint] Error:', err.message);
    addHistoryEntry({
      firstName: entry.firstName, lastName: entry.lastName,
      clubName: entry.clubName, clubImageData: historyClubImage(entry),
      printer: effectivePrinter, success: false, clubberId: entry.clubberId
    });
    recordPrintFailure(fullName.trim(), entry.clubName, err.message);
    return { ok: false, name: fullName, error: err.message };
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}

app.post('/reprint', async (req, res) => {
  const { name, index, clubberId = null } = req.body || {};
  const history = loadHistory();

  let entry;
  if (typeof index === 'number' && index >= 0 && index < history.length) {
    entry = history[index];
  } else if (name || clubberId) {
    // Award slips (isAward) are excluded from lookup so reprinting "by name"
    // always targets the check-in label, never an award slip that happens to
    // share the same child's name.
    //
    // historyRowMatches is id-first: when the caller knows the clubber id AND
    // the stored row has one, a name collision can no longer reprint the wrong
    // child's label. Rows predating the id fall back to name matching, so this
    // is a strict improvement rather than a behaviour change.
    const parts = String(name || '').trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ');
    entry = history.find(e => !isNonCheckinRow(e) && historyRowMatches(e, first, last, clubberId));
  }

  if (!entry) {
    return res.status(404).json({ error: 'No matching print history entry found' });
  }
  // The name/clubberId lookup above already excludes non-check-in rows, but the
  // INDEX path takes whatever row the client pointed at. An award slip or a
  // connect card sent down the kid path below would render as a check-in label
  // AND record a history row WITHOUT its isAward/isConnectCard flag - so
  // isNonCheckinRow() would stop excluding it and an award slip would count as
  // a child on every screen for the rest of the night. (Leader rows are fine:
  // reprintRow has its own leader branch that keeps the flag.)
  if (entry.isAward || entry.isConnectCard) {
    return res.status(400).json({
      error: entry.isAward
        ? 'That row is an award slip, not a check-in label - reprint it from the award card.'
        : 'That row is a connect card, not a check-in label.',
    });
  }

  const r = await reprintRow(entry, req.body.printerName);
  if (!r.ok) return res.status(500).json({ error: r.error });
  return res.json(Object.assign({ success: true, name: r.name }, r.leader ? { leader: true } : {}));
});

// Reprint a whole stretch of tonight (#257). A jam or a torn roll eats eight
// labels in a rush; this reprints the run at once instead of one row at a time
// while a line forms at the door.
//
// Two-step by design: without confirm:true it is a DRY RUN that names the
// count and prints nothing — the count comes from the server, not the client.
app.post('/reprint-range', async (req, res) => {
  const { fromTs, toTs, club = '', confirm = false, printerName = '' } = req.body || {};

  // /reprint predates rehearsal mode and is not rehearsal-aware, but a range
  // reprint is inherently a real-night action — refuse rather than spray 20
  // TEST labels at a jammed printer.
  if (isRehearsalActive()) {
    return res.status(409).json({ error: 'Rehearsal mode is armed — disarm it before reprinting a stretch.' });
  }
  if (printerName && !isSafePrinterName(printerName)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }

  const sel = selectReprintRange({ history: loadHistory(), fromISO: fromTs, toISO: toTs, club });
  if (sel.error) {
    return res.status(400).json({
      error: sel.error === 'bad-club'
        ? 'Unknown club'
        : 'Give a start time before an end time (both on today).',
    });
  }
  if (!sel.count) {
    return res.json({ confirmed: false, count: 0, rows: [], skipped: sel.skipped });
  }
  if (confirm !== true) {
    return res.json({
      confirmed: false,
      count: sel.count,
      capped: sel.capped,
      skipped: sel.skipped,
      rows: sel.rows.map(r => ({
        name: `${r.firstName} ${r.lastName}`.trim(),
        clubName: r.clubName || '',
        at: r.timestamp,
      })),
    });
  }

  if (reprintRun) return res.status(409).json({ error: reprintBusyMessage(), busy: reprintRun });
  reprintRun = { kind: 'range', count: sel.rows.length, printed: 0, startedAt: Date.now() };
  const printed = [];
  let stopped = null;
  try {
  for (let i = 0; i < sel.rows.length; i++) {
    const r = await reprintRow(sel.rows[i], printerName, { silent: true });
    // Stop on the FIRST failure: a jam would otherwise fire 19 more ops
    // print-failure events and write 19 more failed history rows.
    if (!r.ok) { stopped = { name: r.name, error: r.error }; break; }
    printed.push(r.name);
    reprintRun.printed = printed.length;
    // Awaited, never Atomics.wait — the point is that a queued POST /print for
    // a child at the door gets served between reprints.
    if (i < sel.rows.length - 1) await new Promise(done => setTimeout(done, REPRINT_RANGE_GAP_MS));
  }
  } finally { reprintRun = null; }

  console.log(`[reprint-range] ${printed.length}/${sel.rows.length} label(s)${stopped ? ` — stopped at ${stopped.name}` : ''}`);
  // Always 200 so the client can render a partial run rather than a bare
  // "failed" after most of the stretch actually came out.
  return res.json({
    success: !stopped, printed, count: sel.rows.length, capped: sel.capped, stoppedAt: stopped,
  });
});

// One reprint run at a time. A second range reprint while one runs used to
// start a second loop interleaved with the first: every label twice, the gap
// between them gone. Now it is refused with 409 and told how far the first run
// has got; the page retries when it is done.
let reprintRun = null;
function reprintBusyMessage() {
  const r = reprintRun;
  return `A reprint is already running (${r.printed} of ${r.count} printed). Wait for it to finish.`;
}

// ── Award slip labels ─────────────────────────────────────────────────────────
// A small recognition slip ("🏅 Awarded: <award>") for a completed book or
// earned award, printed through the SAME generateLabel/printImage pipeline
// as a normal check-in label — no new rendering path, so it can't regress
// one. The award text rides in the existing handbook-group text slot (with
// a medal prefix so it reads unambiguously as an award, not a group name),
// and the inverted (black-background) palette — already used for step-up
// and first-timer labels — makes an award slip visually distinct from a
// normal white check-in label at a glance.
app.post('/print-award', async (req, res) => {
  const {
    name,
    firstName: reqFirst,
    lastName:  reqLast,
    clubName      = '',
    award,
    clubImageData = null,
    printerName   = '',
    clubberId     = null,
  } = req.body || {};

  let firstName, lastName;
  if (reqFirst !== undefined) {
    firstName = String(reqFirst || '').trim();
    lastName  = String(reqLast  || '').trim();
  } else if (name) {
    const parts = String(name).trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName  = parts.slice(1).join(' ') || '';
  } else {
    return res.status(400).json({ error: 'name or firstName is required' });
  }

  const awardText = String(award == null ? '' : award).trim();
  if (!awardText) return res.status(400).json({ error: 'award is required' });

  const effectivePrinter = (printerName && printerName.trim()) ? printerName.trim() : PRINTER_NAME;

  // Duplicate suppression keyed on name+award (NOT name alone) — a child can
  // legitimately earn two different awards in one evening, and each should
  // print. Namespaced ("award:...") so it can never collide with a normal
  // check-in's dedup key in the same recentPrints map.
  const dupKey = `award:${clubberId ? 'id' + clubberId : firstName + ' ' + lastName}:${awardText}`
    .toLowerCase().trim();
  if (isDuplicatePrint(dupKey)) {
    console.log(`[print-award] '${firstName} ${lastName}' — '${awardText}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }
  claimPrint(dupKey);

  // Enrich from the roster the same way /print does, including clubberId
  // awareness — an award slip must show the same allergy/no-photo safety
  // icons a check-in label would.
  clubbers = loadClubbers();
  const record = findClubber(firstName, lastName, clubberId);

  let allergyTokens = [], birthday = false, birthdayAge = null, noPhoto = false;
  let effectiveClubName = clubName;
  if (record) {
    const allergySource = record.Allergies || record.Notes || '';
    allergyTokens = parseAllergies(allergySource);
    birthday = isCakeWeek(record.Birthdate);
    birthdayAge = birthdayAgeThisWeek(record.Birthdate);   // words beside the cake (#291)
    noPhoto  = noPhotoFor(record);
    if (!effectiveClubName && record.Club) effectiveClubName = String(record.Club).trim();
  }

  const medalLine = `🏅 Awarded: ${awardText}`.slice(0, 60);

  let pngPath = null;
  try {
    const clubImageBuffer = await resolveImageBuffer(clubImageData);
    const twinA = record ? twinDisambiguation(record, clubbers) : { middleInitial: '', nameHint: '' };
    const result = await generateLabel({
      firstName, lastName, clubName: effectiveClubName, clubImageBuffer,
      allergyTokens, handbookGroup: medalLine, isBirthday: birthday, birthdayAge, noPhoto,
      middleInitial: twinA.middleInitial, nameHint: twinA.nameHint,
      footerText: labelFooterText(),
      extras: { inverted: true },
    });
    pngPath = result.pngPath;

    await playTuneIfEnabled(effectivePrinter, birthday ? 'birthday' : undefined);
    await printLabel(pngPath, effectivePrinter);
    recordPrint(dupKey);

    addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: true, isAward: true, award: awardText,
      clubberId,
    });

    console.log(`[print-award] ${firstName} ${lastName} — ${awardText}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[print-award] Error:', err.message);
    addHistoryEntry({
      firstName, lastName, clubName: effectiveClubName, clubImageData,
      printer: effectivePrinter, success: false, isAward: true, award: awardText,
      clubberId,
    });
    recordPrintFailure(`${firstName} ${lastName}`.trim(), effectiveClubName, err.message);
    res.status(500).json({ error: err.message });
  } finally {
    releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
});

// ── Leader name tags ──────────────────────────────────────────────────────────
// A name tag for an adult volunteer: name, a LEADER pill in the visitor-pill
// slot, "<Club> Leader" on the greeting line, the official club mark in the
// icon panel. Same renderer and printer as every other label. Deliberately
// plain: no allergy/birthday/streak icons (those are a child's), no inverted
// palette (black already means step-up, first-timer or award).
//
// A leader tag is a PRINT, never a CHECK-IN. It carries `isLeader` on its
// history row, which isNonCheckinRow() excludes from tonight's stats and the
// lobby tally, the checkin event and recap buffer, the season ledger, the
// checkout board's printed count, the TwoTimTwo write-back CSV, R-1 undo
// reconciliation (and its mass-undo denominator), /reset-tonight and the phone
// roster. This route never calls recordAttendance, events.publish,
// pushEventToBuffer or publishTally.
//
// Reachable from the phone page (PIN-gated on the LAN like every other route).
// The phone-never-prints-directly rule exists to keep a KID's label from
// double-printing through the extension's detection paths; a leader has
// nothing to drive on TwoTimTwo, so there is nothing to double.
function renderLeaderLabel({ firstName, lastName, clubName, testBanner = false }) {
  const club = String(clubName == null ? '' : clubName).trim();
  return generateLabel({
    firstName, lastName, clubName: club,
    isLeader: true,
    greeting: club ? `${club} Leader` : 'Leader',
    // The greeting carries the club; the club text line would print it twice.
    template: { showClubLine: false },
    testBanner,
    footerText: labelFooterText(),
  });
}

// ── Remembered leaders ───────────────────────────────────────────────────────
// The same adults volunteer week after week, so the second time a leader needs
// a tag nobody should have to type their name again. Every successful leader
// print upserts the name here, and the three print surfaces show the remembered
// ones as one-tap chips.
//
// Its OWN file, deliberately not derived from print-history.json: history is
// capped at MAX_HISTORY rows and pruned at historyRetentionDays, so on a busy
// night a leader printed three weeks ago would silently fall out of the chips.
// This file holds one small row per leader and never ages out on its own.
//
// This is adult volunteers' names — the same category of data the dashboard
// already shows, and never a child's — but it is still personal data on disk,
// so it is capped, prunable from the UI, and nothing else is stored: no
// contact details, no birthdate, no attendance.
const LEADERS_FILE = path.join(DATA_DIR, 'leaders.json');
const LEADERS_MAX = 80;
// An Awana club year runs roughly September–May. A leader who has not needed a
// tag in that long has missed a whole season, so their chip stops taking up
// room — the row is KEPT, so printing them again brings the chip straight back
// (that is the difference between hiding and the × on the chip, which forgets).
const LEADER_ACTIVE_DAYS = 270;

const leaderKey = (firstName, lastName) => `${firstName || ''} ${lastName || ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

function loadLeaders() {
  try {
    if (!fs.existsSync(LEADERS_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(LEADERS_FILE, 'utf8'));
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const clean = [];
    for (const row of raw) {
      if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
      const firstName = security.sanitizeStoredText(row.firstName || '', 80);
      const lastName = security.sanitizeStoredText(row.lastName || '', 80);
      const key = leaderKey(firstName, lastName);
      if (!key || seen.has(key)) continue;      // a corrupt or duplicated row is dropped, not merged
      seen.add(key);
      const at = Number(row.lastPrintedAt);
      clean.push({
        key,
        firstName,
        lastName,
        clubName: security.sanitizeStoredText(row.clubName || '', 40),
        lastPrintedAt: Number.isFinite(at) ? at : 0,
        printCount: Number.isFinite(Number(row.printCount)) ? Math.max(1, Math.round(Number(row.printCount))) : 1,
      });
    }
    return clean;
  } catch (e) {
    console.warn('[leaders] Failed to load remembered leaders:', e.message);
    return [];
  }
}

function saveLeaders(list) {
  saveFileAtomic(LEADERS_FILE, JSON.stringify(list, null, 2));
}

/**
 * Upsert one leader after a successful print. Newest first, capped — the cap
 * drops the least recently printed, which is the one least likely to be needed.
 * A leader who moves between clubs keeps one row: the club follows the most
 * recent print rather than forking into two chips for the same person.
 * Pure but for the file write, so the ordering/cap/merge rules are unit-tested.
 */
function rememberLeader({ firstName, lastName, clubName }, now = Date.now(), list = loadLeaders()) {
  const key = leaderKey(firstName, lastName);
  if (!key) return list;
  const existing = list.find((l) => l.key === key);
  const next = list.filter((l) => l.key !== key);
  next.unshift({
    key,
    firstName: firstName || '',
    lastName: lastName || '',
    // An explicit club wins; a blank one keeps whatever we knew before, so a
    // quick no-club print does not erase a leader's club.
    clubName: clubName || (existing ? existing.clubName : ''),
    lastPrintedAt: now,
    printCount: existing ? existing.printCount + 1 : 1,
  });
  next.sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
  const capped = next.slice(0, LEADERS_MAX);
  saveLeaders(capped);
  return capped;
}

/** The × on a chip: forget this leader outright. */
function forgetLeader(key, list = loadLeaders()) {
  const want = String(key || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const next = list.filter((l) => l.key !== want);
  const removed = next.length !== list.length;
  if (removed) saveLeaders(next);
  return { removed, leaders: next };
}

/** Chips worth showing: printed within a season, newest first. */
function activeLeaders(list = loadLeaders(), now = Date.now()) {
  const cutoff = now - LEADER_ACTIVE_DAYS * 24 * 60 * 60 * 1000;
  return list.filter((l) => l.lastPrintedAt >= cutoff).sort((a, b) => b.lastPrintedAt - a.lastPrintedAt);
}

// The club list every dropdown reads. Static, but served rather than hardcoded
// per-surface so a club can never again be missing from one of them.
//
// GET and POST both, on purpose: the phone page sends its PIN in the body for
// every call it makes, and a PIN does not belong in a query string where it
// would land in access logs and browser history.
function clubsHandler(req, res) {
  res.json({ clubs: CLUB_LIST });
}
app.get('/clubs', clubsHandler);
app.post('/clubs', clubsHandler);

// The remembered leaders, for the chips. `hidden` lets a UI say "3 not printed
// this season" instead of pretending they never existed.
function leadersHandler(req, res) {
  const all = loadLeaders();
  const active = activeLeaders(all);
  res.json({ leaders: active, hidden: all.length - active.length, clubs: CLUB_LIST });
}
app.get('/leaders', leadersHandler);
app.post('/leaders', leadersHandler);

// POST, not DELETE: the phone page sends its PIN in the body like every other
// call it makes, and the CORS policy already refuses mutating requests from a
// non-allowlisted origin.
app.post('/leaders/forget', (req, res) => {
  const key = String((req.body && req.body.key) || '');
  if (!key.trim()) return res.status(400).json({ error: 'key is required' });
  const { removed, leaders } = forgetLeader(key);
  const active = activeLeaders(leaders);
  console.log(`[leaders] ${removed ? 'Forgot' : 'No such remembered leader:'} '${key}'`);
  res.json({ ok: true, removed, leaders: active, hidden: leaders.length - active.length });
});

// ── One-off name tags (7.18.0, owner 2026-10-08) ──────────────────────────────
// A name tag for a child that is NOT a check-in: a lost or torn tag, or a
// child who is not checking in tonight (a sibling along for the night, a
// guest). Typed first name + club (owner's choice: no roster lookup, so no
// allergy or birthday line). The label is the club's stock label for that
// name; the screens play the full welcome (a sealed `checkin` with
// `oneOff: true`, which the lobby never counts and which never enters the
// recap); the print log keeps a row marked `oneOff`, which isNonCheckinRow()
// keeps out of every count, the attendance ledger, the still-here list and
// the reconcile pass. Same route from the dashboard, the touch check-in and
// the phone (relayed).
function oneOffClub(raw) {
  const want = clubKey(String(raw || ''));
  if (!want) return '';
  return CLUB_LIST.find((c) => clubKey(c) === want) || '';
}
async function renderOneOffLabel(firstName, clubName, testBanner = false) {
  return generateLabel({
    firstName, lastName: '', clubName,
    footerText: labelFooterText(),
    template: labelTemplateFor(clubName),
    testBanner,
  });
}
async function performOneOffPrint(input) {
  const b = input || {};
  const firstName = security.sanitizeStoredText(b.firstName || '', 40).replace(/\s+/g, ' ').trim();
  if (!firstName) return { status: 400, body: { error: 'Type the child\'s first name.' } };
  const clubName = oneOffClub(b.clubName);
  if (!clubName) return { status: 400, body: { error: 'Pick the child\'s club.' } };
  if (!isSafePrinterName(b.printerName)) return { status: 400, body: { error: 'invalid printer name' } };
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || PRINTER_NAME;
  // Rehearsal/demo: the TEST band, nothing recorded, nothing on the screens.
  const isDemo = b.demo === true || b.demo === 'true' || isRehearsalActive();

  // Namespaced, never a check-in's key; absorbs a double tap.
  const dupKey = `oneoff:${firstName}:${clubName}`.toLowerCase();
  if (!isDemo && isDuplicatePrint(dupKey)) {
    console.log(`[print-oneoff] '${firstName}' (${clubName}) already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return { status: 200, body: { success: true, duplicate: true, firstName, clubName } };
  }
  if (!isDemo) claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await renderOneOffLabel(firstName, clubName, isDemo);
    pngPath = result.pngPath;
    await playTuneIfEnabled(effectivePrinter);
    await printLabel(pngPath, effectivePrinter);
    if (isDemo) {
      console.log(`[print-oneoff] Printed a TEST one-off tag for '${firstName}' — nothing recorded`);
      return { status: 200, body: { success: true, demo: true, firstName, clubName } };
    }
    recordPrint(dupKey);
    addHistoryEntry({ firstName, lastName: '', clubName, printer: effectivePrinter, success: true, oneOff: true });
    // The welcome, never the count: no recap buffer, no tally change.
    events.publish(pusher, EVENT_CHANNEL, 'checkin', events.buildCheckin({
      firstName, club: clubName, isBirthday: false, isFirstTimer: false, oneOff: true,
    }));
    console.log(`[print-oneoff] ${firstName} — ${clubName}`);
    return { status: 200, body: { success: true, firstName, clubName } };
  } catch (err) {
    console.error('[print-oneoff] Error:', err.message);
    if (!isDemo) {
      addHistoryEntry({ firstName, lastName: '', clubName, printer: effectivePrinter, success: false, oneOff: true });
      recordPrintFailure(firstName, clubName, err.message);
    }
    return { status: 500, body: { error: err.message } };
  } finally {
    if (!isDemo) releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}
app.post('/print-oneoff', async (req, res) => {
  const out = await performOneOffPrint(req.body);
  res.status(out.status).json(out.body);
});

// One leader tag. Extracted from the route so "Print selected" can print a
// whole team through exactly the same path — one spool job per tag, each with
// its own duplicate guard, history row and remembered-leader upsert, so a jam
// halfway down a batch loses one tag and reports which one.
async function performLeaderPrint(input) {
  const b = input || {};
  let firstName, lastName;
  if (b.firstName !== undefined) {
    firstName = security.sanitizeStoredText(b.firstName || '', 80);
    lastName  = security.sanitizeStoredText(b.lastName  || '', 80);
  } else {
    ({ firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name || '', 160)));
  }
  if (!firstName && !lastName) return { status: 400, body: { error: 'name is required' } };
  const clubName = security.sanitizeStoredText(b.clubName || '', 40);
  if (!isSafePrinterName(b.printerName)) return { status: 400, body: { error: 'invalid printer name' } };
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || PRINTER_NAME;
  // Rehearsal/demo: a real label with the TEST band, nothing recorded — same
  // rule as /print, so a training night leaves no trace in the print log. A
  // demo tag also does not teach the remembered-leader list a name.
  const isDemo = b.demo === true || b.demo === 'true' || isRehearsalActive();

  // Namespaced so it can never collide with a child's check-in key in the
  // same recentPrints map; absorbs a phone double-tap.
  const dupKey = `leader:${firstName} ${lastName}`.toLowerCase().trim();
  if (!isDemo && isDuplicatePrint(dupKey)) {
    console.log(`[print-leader] '${firstName} ${lastName}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return { status: 200, body: { success: true, duplicate: true } };
  }
  if (!isDemo) claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await renderLeaderLabel({ firstName, lastName, clubName, testBanner: isDemo });
    pngPath = result.pngPath;
    await playTuneIfEnabled(effectivePrinter);
    await printLabel(pngPath, effectivePrinter);
    if (isDemo) {
      console.log(`[print-leader] Printed a TEST leader tag for '${firstName} ${lastName}' — nothing recorded`);
      return { status: 200, body: { success: true, demo: true } };
    }
    recordPrint(dupKey);
    addHistoryEntry({ firstName, lastName, clubName, printer: effectivePrinter, success: true, isLeader: true });
    // Remembered only after the tag actually reached the printer: a failed
    // print must not seed the chips with a name nobody has a tag for.
    rememberLeader({ firstName, lastName, clubName });
    console.log(`[print-leader] ${firstName} ${lastName}${clubName ? ' — ' + clubName : ''}`);
    return { status: 200, body: { success: true } };
  } catch (err) {
    console.error('[print-leader] Error:', err.message);
    if (!isDemo) {
      addHistoryEntry({ firstName, lastName, clubName, printer: effectivePrinter, success: false, isLeader: true });
      recordPrintFailure(`${firstName} ${lastName}`.trim(), clubName, err.message);
    }
    return { status: 500, body: { error: err.message } };
  } finally {
    if (!isDemo) releasePrint(dupKey);
    if (pngPath) fs.unlink(pngPath, () => {});
  }
}

// Batch cap: a church with more leaders than this in one go is a data-entry
// mistake, not a real night, and 25 sequential spool jobs is already ~a minute
// of printing.
const LEADER_BATCH_MAX = 25;

app.post('/print-leader', async (req, res) => {
  const b = req.body || {};

  // Batch ("Print selected" on the remembered chips). Sequential on purpose:
  // the printer is a single serial device and interleaved jobs come out of the
  // spooler in an unpredictable order.
  if (Array.isArray(b.leaders)) {
    if (!b.leaders.length) return res.status(400).json({ error: 'leaders is empty' });
    if (b.leaders.length > LEADER_BATCH_MAX) {
      return res.status(400).json({ error: `too many leaders in one batch (max ${LEADER_BATCH_MAX})` });
    }
    const results = [];
    for (const entry of b.leaders) {
      const one = await performLeaderPrint({ ...(entry || {}), printerName: b.printerName, demo: b.demo });
      const name = `${(entry && (entry.name || `${entry.firstName || ''} ${entry.lastName || ''}`)) || ''}`.trim();
      results.push({
        name,
        success: one.status === 200 && one.body.success === true,
        duplicate: one.body.duplicate === true,
        demo: one.body.demo === true,
        error: one.body.error,
      });
    }
    const printed = results.filter((r) => r.success && !r.duplicate).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(`[print-leader] Batch of ${results.length}: ${printed} printed, ${failed} failed`);
    // 200 even with failures — the body is the per-name record, and a partial
    // batch is a real outcome the operator needs to read, not an error page.
    return res.json({ success: failed === 0, batch: true, printed, failed, results });
  }

  const { status, body } = await performLeaderPrint(b);
  res.status(status).json(body);
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
// PIN-gated like every other route (the global auth gate): it is emphatically
// not LAN_PUBLIC_PATHS material — a stranger on the church WiFi has no business
// making the door printer spit labels.
const CUSTOM_PRINT_TEXT_MAX = CUSTOM_TEXT_MAX_CHARS;

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
  const effectivePrinter = (b.printerName && String(b.printerName).trim()) || PRINTER_NAME;

  // Namespaced so it can never collide with a child's check-in key or a
  // leader's in the same recentPrints map. Keyed on the TEXT, which is all a
  // custom label is, so a double-tap on the phone absorbs into one label.
  const dupKey = `custom:${norm.text.toLowerCase()}`;
  if (isDuplicatePrint(dupKey)) {
    console.log(`[print-custom] '${norm.text}' already printed within ${DUPLICATE_WINDOW_MS / 1000}s — duplicate suppressed`);
    return res.json({ success: true, duplicate: true });
  }
  claimPrint(dupKey);

  let pngPath = null;
  try {
    const result = await generateLabel({ customText: norm.text });
    pngPath = result.pngPath;
    await playTuneIfEnabled(effectivePrinter);
    await printLabel(pngPath, effectivePrinter);
    recordPrint(dupKey);
    console.log(`[print-custom] ${norm.text}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[print-custom] Error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  } finally {
    releasePrint(dupKey);
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
  return withPrinter(() => printPdfNow(pdfPath, printerName));
}

// The name of the current Windows default printer, or '' when unknown.
async function currentDefaultPrinter() {
  try {
    const raw = await runPowerShell(['-Command', 'Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Default -eq $true } | Select-Object -First 1 -ExpandProperty Name'], { timeout: 8000 });
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
    await runPowerShell(['-Command', '$p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $env:AWANA_PRINTER }; if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter | Out-Null }'], {
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

  const psPath = tmpFilePath('awana-print-pdf', 'ps1');
  try {
    fs.writeFileSync(psPath, ps, 'utf8');
    const result = await runPowerShell(['-File', psPath], {
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
app.post(PDF_UPLOAD_PATH, express.json({ limit: '18mb' }), async (req, res) => {
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
    || config.worksheetPrinter
    || PRINTER_NAME;

  const pdfPath = tmpFilePath('awana-doc', 'pdf');
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

// ── Check-in CSV write-back safety net ────────────────────────────────────────
// If a station loses its TwoTimTwo session mid-event, tonight's check-ins are
// still in print history — this exports them in the shape TwoTimTwo's own
// check-in CSV importer expects (docs/TWOTIMTWO.md §2.4, /clubber/checkin_csv,
// which does fuzzy name matching) so the director can reconcile attendance
// afterwards instead of hand-entering it.
function csvField(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// How many distinct children this server printed a label for TODAY, in LOCAL
// time. Feeds the checkout board's honest denominator.
//
// Local, not UTC, and that distinction is load-bearing. History timestamps are
// ISO/UTC, and a 17:30-20:00 local club night straddles UTC midnight for most of
// the US winter — at 19:00 EST it is already Thursday in UTC. A UTC-day filter
// would therefore drop the second half of the night, and the board would publish
// a FRESH, plausible, badly-wrong denominator right in the middle of pickup,
// which no staleness check can catch.
//
// It counts LABELS PRINTED BY THIS SERVER, which is not the same population as
// "children in the building": another station, a manual check-in or a printer jam
// all break the equivalence. Consumers must word it as the former.
function distinctChildrenPrintedToday(now = new Date()) {
  const localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = localDay(now);
  const seen = new Set();
  for (const e of loadHistory()) {
    if (!e || !e.timestamp) continue;
    const when = new Date(e.timestamp);
    if (Number.isNaN(when.getTime()) || localDay(when) !== today) continue;
    if (e.success === false) continue;   // a failed print never checked anyone in
    if (isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
    const key = historyIdentityKey(e);
    if (!key) continue;
    seen.add(key);                       // reprints must not inflate the count
  }
  return seen.size;
}

app.get('/checkin-csv-export', (req, res) => {
  const dateParam = String(req.query.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : localDayISO();

  const history = loadHistory();
  const seen = new Set();
  const rows = [];
  for (const e of history) {
    if (!e || !isOnLocalDay(e.timestamp, date)) continue;
    if (e.success === false) continue;   // a failed print never actually checked the kid in
    if (isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
    const first = String(e.firstName || '').trim();
    const last  = String(e.lastName  || '').trim();
    if (!first && !last) continue;
    // Id-first: this export is imported BACK INTO TwoTimTwo, so merging two
    // same-named children into one row would silently under-report attendance
    // for one of them.
    const key = historyIdentityKey(e);
    if (seen.has(key)) continue;         // one row per child even with reprints
    seen.add(key);
    rows.push({ first, last });
  }

  const lines = ['First Name,Last Name,Date'];
  rows.forEach(r => lines.push([csvField(r.first), csvField(r.last), csvField(date)].join(',')));
  const csv = lines.join('\r\n') + '\r\n';

  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="checkin-export-${date}.csv"`);
  res.send(csv);
});

// ── Feed receive endpoints (contract v3) ──────────────────────────────────────
// The extension scrapes TwoTimTwo's own report CSVs / iCal / admin messages
// and POSTs the results here; feeds.js validates + throttles (max one publish
// per 5s per feed) and this thin route does the actual Pusher publish.
function makeFeedRoute(feedName) {
  return async (req, res) => {
    const result = feeds.submitFeed(feedName, req.body, Date.now());
    if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
    if (result.throttled) return res.json({ ok: true, throttled: true });

    let published = false;
    try {
      published = await events.publish(pusher, EVENT_CHANNEL, feedName, result.payload);
    } catch (e) { published = false; }
    feeds.recordPublishOutcome(feedName, published);
    res.json({ ok: true, published });
  };
}

app.post('/feed/tonight',  makeFeedRoute('tonight'));
app.post('/feed/points',   makeFeedRoute('points'));
app.post('/feed/schedule', makeFeedRoute('schedule'));
app.post('/feed/notice',   makeFeedRoute('notice'));
// Who is still in the building (contract v4). An extension older than 7.16
// scrapes TwoTimTwo's /clubber/checkout page and posts its rows here. Since
// 7.16.0 (owner 2026-10-08) the print server builds the still-here list
// ITSELF (publishStillHere): that page lists nobody at KVBC, check-out
// tracking being off, and an empty scrape published here would tell every
// lobby screen the building was clear. So a post is still validated and
// answered `ok` (an older extension must not log errors all evening), but it
// is never published: the server's own list always wins. A 7.16 extension
// reads the page only to notice children checked out there
// (/feed/checked-out with source 'checkout-page').
app.post('/feed/checkout', (req, res) => {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
  const result = feeds.validateCheckoutBody(body);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
  res.json({ ok: true, published: false, superseded: 'the print server publishes its own still-here list' });
});

// Undo detection (roadmap follow-up to R-1). content.js's runReconcile()
// already polls /clubber/checkin_report every ~60s to catch check-ins the
// roster-diff detector misses; this reuses that SAME scrape for the direction
// it never covered — an undo on TwoTimTwo removes a row from that report, and
// nothing before this endpoint ever noticed. The extension posts the full
// authoritative "who's in tonight" list here on every successful reconcile
// pass (not just misses), and the server diffs it against its own
// print-history.json, which is the one place that already knows who it thinks
// is checked in.
//
// Deliberately NOT routed through makeFeedRoute()/feeds.submitFeed(): this
// never publishes a Pusher event itself (no new event type, per the contract
// freeze) — it mutates history, and only if that mutation actually changed
// anything does it call publishTally() immediately, so a display isn't stuck
// on a stale headcount until the next 60s tick.
app.post('/feed/checkin-report', (req, res) => {
  const result = feeds.submitCheckinReport(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  if (result.throttled) return res.json({ ok: true, throttled: true });

  const now = Date.now();
  // A PARTIAL report is neither the count nor an undo list: a parse that found
  // fewer children than TwoTimTwo's own "Count:" footers say it lists (7.13.0;
  // 2026-10-07 an 11-child report read as 2). The count falls back to this
  // printer's history, /health says why, and nobody is marked undone for
  // being missing from it.
  if (reportIsPartial(result.payload)) {
    lastPartialReport = { at: now, parsed: distinctReportChildren(result.payload.entries), declared: result.payload.declared };
    console.warn(`[reconcile] the report parsed ${lastPartialReport.parsed} of the ${lastPartialReport.declared} children TwoTimTwo lists; not counting from it`);
    return res.json({ ok: true, applied: false, changed: 0, reason: 'partial report' });
  }
  const outcome = reconcileHistoryWithReport(loadHistory(), result.payload.entries, now);
  if (outcome.skipped) {
    console.warn('[reconcile]', outcome.reason);
    // Deliberately NOT stored as the authoritative report. A report the
    // mass-undo guard just refused is precisely the report that would zero
    // tonight's count if authoritativeTonight() believed it; the guard is the
    // one place that judges whether a scrape is plausible, and this honours it.
    return res.json({ ok: true, applied: false, changed: 0, reason: outcome.reason });
  }
  // Applied (even with nothing to change): this is now what the count is built
  // from, until it goes stale or a newer one lands.
  lastCheckinReport = { at: now, entries: result.payload.entries };
  lastPartialReport = null;
  if (outcome.changed > 0) {
    saveHistory(outcome.history);
  }
  // Republished on EVERY applied report, not just a changed one: between polls
  // the count ticks up optimistically from history, so the report landing is
  // itself a correction the screens need even when no row moved.
  publishTally();
  res.json({ ok: true, applied: true, changed: outcome.changed });
});

// Who the extension's youth check-out has checked out tonight (7.15.0): the
// WHOLE list for the meeting date, every pass, replace semantics. Loopback /
// PIN-gated like every /feed route and never published: clubber ids only.
// A change takes those children off tonight's count at once.
//
// `source: 'checkout-page'` (7.16.0) is the extension noticing children who
// were on TwoTimTwo's Checkout page at its last good read and are gone now,
// for when check-out tracking is turned on there. A row also leaves that page
// when its check-in is UNDONE, so a child whose newest row here is undone is
// not taken for a check-out (an undo made on TwoTimTwo and not yet seen by
// the report pass can still be: an accepted ambiguity, owner 2026-10-08).
app.post('/feed/checked-out', (req, res) => {
  const result = feeds.validateCheckedOutBody(req.body);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
  const { date } = result.payload;
  let { clubberIds } = result.payload;
  if (date !== localDayISO()) return res.json({ ok: true, applied: false, reason: 'not tonight' });
  let skipped = 0;
  if (req.body.source === 'checkout-page') {
    const undone = undoneClubberIdsTonight();
    const kept = clubberIds.filter((id) => !undone.has(id));
    skipped = clubberIds.length - kept.length;
    clubberIds = kept;
  }
  // The extension's list only grows through a night; a shorter one (its
  // storage cleared) never puts children back.
  const changed = markCheckedOut(date, clubberIds, []);
  if (changed) publishTally();
  res.json({ ok: true, applied: true, checkedOut: checkedOutTonight.ids.size, skipped });
});

// Tonight's checked-out set grows by these ids / names; true when it changed.
// A new night starts it afresh.
function markCheckedOut(date, ids, names) {
  const same = checkedOutTonight.date === date;
  const nextIds = new Set(same ? checkedOutTonight.ids : []);
  const nextNames = new Set(same && checkedOutTonight.names ? checkedOutTonight.names : []);
  const before = nextIds.size + nextNames.size;
  (ids || []).forEach((id) => { const v = String(id == null ? '' : id).trim(); if (v) nextIds.add(v); });
  (names || []).forEach((n) => { const v = normalizedName(n); if (v) nextNames.add(v); });
  checkedOutTonight = { date, ids: nextIds, names: nextNames };
  return !same || nextIds.size + nextNames.size !== before;
}

// Clubber ids whose newest row tonight is undone (any reason: the phone's
// Remove or Undo check-in, the report pass, a reset).
function undoneClubberIdsTonight() {
  const out = new Set();
  const seen = new Set();
  for (const e of tonightCheckins().entries) {
    if (e.clubberId == null || !String(e.clubberId).trim()) continue;
    const id = String(e.clubberId).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (e.undone) out.add(id);
  }
  return out;
}

// #2: the extension's "didn't stick" list — kids whose driven site check-in
// never verified (label printed, TwoTimTwo never confirmed). Stored in
// memory only and surfaced as a /health warning so the dashboard shows the
// same list the widget does. Replace semantics: an empty list clears it.
app.post('/feed/unverified-checkins', (req, res) => {
  const result = feeds.submitUnverified(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  res.json({ ok: true, count: result.payload.entries.length });
});

// #293: who finished a handbook recently, so the NEXT label that child prints
// carries a trophy band. Carries full names and is therefore in the same
// loopback/PIN-gated, NEVER-published class as the two feeds above —
// deliberately NOT registered in FEED_NAMES/makeFeedRoute, which publishes to
// the public Pusher channel. Merge semantics: the extension posts one payload
// per club, so a second club's post must not wipe the first's.
app.post('/feed/completed-books', (req, res) => {
  const result = feeds.submitCompletedBooks(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  if (result.throttled) return res.json({ ok: true, throttled: true });
  res.json({ ok: true, count: result.payload.entries.length });
});

// Reset tonight (operator request): one button on the widget zeroes the
// night — every active check-in row today is marked undone (history is a
// log, rows are never deleted), tonight's date comes OUT of the attendance
// ledger (so a test night never pollutes streaks, milestones, or first-ever
// detection), the recap buffer empties (a reconnecting display must not
// replay celebrations for a night that was reset), and a fresh tally goes
// out immediately so every screen drops to zero within seconds.
// ── Lobby slides endpoints ────────────────────────────────────────────────────
// Two callers, two credentials:
//   • The dashboard's "Lobby slides" card — trusted like every other loopback
//     origin (the same trust that can already set the Pusher secret).
//   • The display app's slide editor ("Publish to all displays") — a PUBLIC
//     https origin, so it is scoped to exactly this path in corsPolicy and must
//     additionally present the publish token. The token is the credential; the
//     origin check is browser hygiene (curl can forge an Origin, a tab cannot).
// Either way the payload goes through buildSlidesDeck, so nothing but capped
// text slides can reach the wire, whoever asks.
function slidesTokenOk(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  const token = String(config.slidesPublishToken || '');
  if (!m || !token) return false;
  return security.timingSafeStringEqual(m[1].trim(), token);
}

app.post('/api/lobby-slides', (req, res) => {
  const origin = req.headers.origin;
  const fromDisplayOrigin = security.isExactAllowedOrigin(
    origin, security.sanitizeAllowedOrigins(churchConfig.displayOrigins));
  if (!isTrustedConfigOrigin(req) && !(fromDisplayOrigin && slidesTokenOk(req))) {
    if (fromDisplayOrigin && !config.slidesPublishToken) {
      return res.status(403).json({ error: 'No publish token is set on the print server. Open its dashboard → Lobby slides → Generate publish token, and paste it into this display’s Settings.' });
    }
    if (fromDisplayOrigin) {
      return res.status(403).json({ error: 'Wrong publish token. Compare it with the print server dashboard → Lobby slides.' });
    }
    console.warn(`[security] Refused lobby-slides publish from ${origin || 'no-origin non-loopback caller'}`);
    return res.status(403).json({ error: 'Lobby slides can be published from the printer dashboard or the display app’s slide editor on this computer.' });
  }
  if (signedInToSync()) return forwardToSync(res, 'slides', (req.body || {}).slides);
  const result = acceptLobbySlidesPublish((req.body || {}).slides);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

// Current deck for the dashboard card. Loopback-trusted origins only — the
// deck is lobby copy, not a secret, but nothing here needs to be readable
// cross-origin and the discipline is cheaper than the exception.
app.get('/api/lobby-slides', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The lobby deck is only readable from this computer' });
  }
  res.json({
    deckRev: lobbySlides.deckRev,
    publishedAt: lobbySlides.publishedAt || null,
    slides: lobbySlides.slides,
    tokenConfigured: Boolean(config.slidesPublishToken),
  });
});

// ── Shared display settings endpoints (contract v6) ───────────────────────────
// Same two callers and credentials as the lobby slides: this computer's own
// trusted surface, or the display app's exact origin with the publish token.
// The display's Settings publishes here when a SHARED setting changes on the
// check-in computer; every screen then receives the sealed `settings` event.
app.post('/api/display-settings', (req, res) => {
  const origin = req.headers.origin;
  const fromDisplayOrigin = security.isExactAllowedOrigin(
    origin, security.sanitizeAllowedOrigins(churchConfig.displayOrigins));
  if (!isTrustedConfigOrigin(req) && !(fromDisplayOrigin && slidesTokenOk(req))) {
    if (fromDisplayOrigin && !config.slidesPublishToken) {
      return res.status(403).json({ error: 'No publish token is set on the print server. Open its dashboard → Lobby slides → Generate publish token (the display login hands it to screens).' });
    }
    if (fromDisplayOrigin) {
      return res.status(403).json({ error: 'Wrong publish token. Log this screen in again, or compare it with the print server dashboard → Lobby slides.' });
    }
    console.warn(`[security] Refused display-settings publish from ${origin || 'no-origin non-loopback caller'}`);
    return res.status(403).json({ error: 'Display settings can be published from the display app on this computer.' });
  }
  if (signedInToSync()) return forwardToSync(res, 'settings', (req.body || {}).settings);
  const result = acceptDisplaySettingsPublish((req.body || {}).settings);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

app.get('/api/display-settings', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display settings are only readable from this computer' });
  }
  res.json({
    rev: displaySettings.rev,
    publishedAt: displaySettings.publishedAt || null,
    settings: displaySettings.settings,
  });
});

app.post('/reset-tonight', (req, res) => {
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'confirm: true required — this zeroes tonight on every surface' });
  }
  const today = localDayISO();
  const nowIso = new Date().toISOString();

  const history = loadHistory();
  let undone = 0;
  const next = history.map((row) => {
    if (!row || row.success === false || isNonCheckinRow(row)) return row;
    if (!isOnLocalDay(row.timestamp, today)) return row;
    if (row.undone === true) return row;
    undone++;
    // `undoneBy` is what makes the reset STICK. Without it,
    // reconcileHistoryWithReport() treats these rows as its own earlier work
    // and clears them again the moment TwoTimTwo's report still lists the
    // kids, which it does for the rest of the night - so the operator's zero
    // button un-zeroed itself within a minute. It is the same marker the
    // phone's Remove uses, under its own name so the phone's "Add back" (which
    // only reverses undoneBy === 'phone') cannot resurrect a reset night.
    return { ...row, undone: true, undoneAt: nowIso, undoneBy: 'reset' };
  });
  if (undone) saveHistory(next);

  // Tonight never happened, as far as the season ledger is concerned.
  const ledger = loadAttendance();
  let ledgerTouched = false;
  for (const key of Object.keys(ledger)) {
    const dates = ledger[key] && Array.isArray(ledger[key].dates) ? ledger[key].dates : null;
    if (dates && dates.includes(today)) {
      ledger[key].dates = dates.filter((d) => d !== today);
      ledgerTouched = true;
    }
  }
  if (ledgerTouched) saveAttendance(ledger);

  eventBuffer = [];
  saveFileAtomic(EVENT_BUFFER_FILE, JSON.stringify(eventBuffer));

  // Drop the report too. "Tonight never happened" has to mean it on every
  // surface, and TwoTimTwo's report will go on listing those children for the
  // rest of the evening - the `undoneBy: 'reset'` markers above cover the kids
  // this printer knows about, and this covers anyone it does not.
  lastCheckinReport = null;
  lastPartialReport = null;
  checkedOutTonight = { date: null, ids: new Set(), names: new Set() };

  publishTally();
  console.log(`[reset] Tonight reset by operator: ${undone} check-in(s) marked undone, ledger ${ledgerTouched ? 'cleared for today' : 'untouched'}`);
  res.json({ ok: true, undone });
});

// ── Event-bus publishers ──────────────────────────────────────────────────────
// Interval publishers are gated by the church-config club-night window so the
// channel stays quiet the other ~165 hours a week. Every publisher is wrapped:
// a Pusher outage can never disturb printing.

function publishTally() {
  try {
    const st = computeTonightStats();
    // Unified theming (#18): every tally carries the Screen season (already
    // resolved: pinned, calendar, or '' when the operator turned it off), so
    // the screens follow a change within a minute - and a display that boots
    // mid-night picks it up on the next tally without any handshake.
    events.publish(pusher, EVENT_CHANNEL, 'tally', events.buildTally(st.byClub, st.checkedIn, {
      season: currentScreenSeason(),
      rehearsal: isRehearsalActive(),
    }));
  } catch (e) { console.warn('[events] tally publish skipped:', e.message); }
  // Everything that moves the count (a print, an undo, a check-out, a report
  // applied, a reset) calls this, so the still-here list follows it.
  stillHereChanged();
}

// ── The lobby's still-here list (7.16.0, owner 2026-10-08) ──────────────────
// At 7:30 the lobby screens show the children not yet picked up, then "<name>
// has checked out" as each leaves (the lobby diffs successive lists).
// TwoTimTwo's Checkout page lists nobody at KVBC, so THIS is the list: the
// children here now by the count's own rules (tonightHereNow: report plus
// newer history, minus undone, minus checked out; visitors only while the
// count is history-built, exactly as the count treats them), in the clubs
// ticked under "Clubs on the pickup list" (config `pickupClubs`, default every
// club but Trek and Journey), first name + club, sorted, capped at
// CHECKOUT_MAX. It rides the existing sealed `checkout` event with `printed`
// beside it, its payload shape unchanged (events.buildCheckout). Published
// every minute in the tally window and, coalesced, within seconds of any
// change; never outside that window (names have no business on the wire at
// 2 pm Tuesday). The lobby decides when to SHOW it.
const STILL_HERE_DEBOUNCE_MS = 2000;
let lastStillHereSig = null;
let stillHereTimer = null;

function stillHereEntries() {
  return pickup.buildStillHere(tonightHereNow().children, pickup.pickupClubsOf(config), events.CHECKOUT_MAX);
}

let stillHereWindowForTests = null;
function stillHereInWindow() {
  if (typeof stillHereWindowForTests === 'function') return stillHereWindowForTests();
  return events.isClubNightNow(churchConfig.clubNights, undefined, TALLY_GRACE_MIN, TALLY_LEAD_MIN);
}

/** Publish the list now (the minute timer's job, and a change's). */
function publishStillHere() {
  try {
    const entries = stillHereEntries();
    const payload = events.buildCheckout(entries, distinctChildrenPrintedToday());
    lastStillHereSig = JSON.stringify(payload.entries);
    events.publish(pusher, EVENT_CHANNEL, 'checkout', payload);
  } catch (e) { console.warn('[events] still-here publish skipped:', e.message); }
}

/** Something that may change the list happened: publish soon if it did. */
function stillHereChanged() {
  if (stillHereTimer) return;
  stillHereTimer = setTimeout(() => {
    stillHereTimer = null;
    try {
      if (!stillHereInWindow()) return;
      const sig = JSON.stringify(events.buildCheckout(stillHereEntries()).entries);
      if (sig !== lastStillHereSig) publishStillHere();
    } catch (e) { /* the minute timer tries again */ }
  }, STILL_HERE_DEBOUNCE_MS);
  if (stillHereTimer.unref) stillHereTimer.unref();
}

function publishRecap() {
  try {
    // An EMPTY recap is published on purpose once names are encrypted, where it
    // used to be skipped. It costs one sealed frame every two minutes and buys
    // the screens a continuous key-health heartbeat: a screen needs two failed
    // frames before it admits it cannot read names, so without this the first two
    // children of the night are silently missed before anything appears on the
    // wall. With it, a wrong key is on screen before the doors even open.
    // The consumer's handleRecap iterates `entries`, so [] is a clean no-op.
    pruneEventBuffer();
    if (!eventBuffer.length && !events.getDisplayKeyState().configured) return;
    events.publish(pusher, EVENT_CHANNEL, 'recap', events.buildRecap(eventBuffer));
  } catch (e) { console.warn('[events] recap publish skipped:', e.message); }
}

function publishBirthdays() {
  try {
    const entries = [];
    for (const r of clubbers) {
      if (!isBirthdayWeek(r.Birthdate)) continue;
      const bd = parseBirthdate(r.Birthdate);
      if (!bd) continue;
      // First name + club + calendar month/day ONLY — no last name, no year.
      entries.push({
        firstName: r.FirstName || '',
        club: r.Club || '',
        month: bd.getMonth() + 1,
        day: bd.getDate(),
      });
    }
    events.publish(pusher, EVENT_CHANNEL, 'birthdays', events.buildBirthdays(entries));
  } catch (e) { console.warn('[events] birthdays publish skipped:', e.message); }
}

// ── Lobby slides (contract v5) ────────────────────────────────────────────────
// The displays' typed slide deck, published once by the operator and mirrored
// to every screen over the sealed `slides` event. State survives restarts in
// lobby-slides.json; losing that file is harmless BY DESIGN — deckRev may
// restart at 1, but consumers order solely on publishedAt, so the next publish
// (whose publishedAt is current) still wins. Never "fix" a restarted rev by
// re-seeding it.
const LOBBY_SLIDES_FILE = path.join(DATA_DIR, 'lobby-slides.json');
let lobbySlides = { deckRev: 0, publishedAt: '', slides: [] };
try {
  if (fs.existsSync(LOBBY_SLIDES_FILE)) {
    const raw = JSON.parse(fs.readFileSync(LOBBY_SLIDES_FILE, 'utf8'));
    const slides = events.buildSlidesDeck(raw.slides);
    const rev = Math.floor(Number(raw.deckRev));
    const at = Date.parse(raw.publishedAt);
    if (Number.isFinite(at) && rev >= 1) {
      lobbySlides = { deckRev: rev, publishedAt: new Date(at).toISOString(), slides };
      console.log(`[slides] Loaded lobby deck rev ${rev} (${slides.length} slide(s), published ${lobbySlides.publishedAt})`);
    }
  }
} catch (e) {
  console.warn('[slides] Could not load lobby-slides.json — starting with no deck:', e.message);
}

function persistLobbySlides() {
  saveFileAtomic(LOBBY_SLIDES_FILE, JSON.stringify(lobbySlides));
}

// Broadcast the CURRENT deck: every chunk of one publish shares its
// {deckRev, publishedAt} byte-identically, on first publish and on every
// rebroadcast — publishedAt is the consumers' ordering authority, so a
// rebroadcast that re-stamped it would masquerade as a new publish.
async function publishLobbySlides() {
  if (lobbySlides.deckRev < 1) return false;    // nothing ever published
  // Signed in to the sync service, it is the deck's one home and publishes it
  // itself: a rebroadcast from here would only repeat an older deck.
  if (signedInToSync()) return false;
  const chunks = events.buildSlidesChunks(lobbySlides.slides, lobbySlides.deckRev, lobbySlides.publishedAt);
  if (!chunks) {
    console.error('[slides] Deck no longer fits the chunk ceiling — NOT published (fail closed)');
    return false;
  }
  let ok = true;
  for (const chunk of chunks) {
    // Sequential on purpose: chunks of one deck should not race each other.
    // publish() seals (slides is an ENCRYPTED_EVENT) and never throws.
    ok = (await events.publish(pusher, EVENT_CHANNEL, 'slides', chunk)) && ok;
  }
  return ok;
}

/**
 * Accept an operator publish: sanitize, gate on total size, stamp, persist,
 * broadcast. Returns {ok:true, ...summary} or {ok:false, error}.
 */
function acceptLobbySlidesPublish(rawSlides) {
  if (!Array.isArray(rawSlides)) {
    return { ok: false, status: 400, error: 'Body must be { slides: [...] }' };
  }
  const slides = events.buildSlidesDeck(rawSlides);
  const bytes = events.slidesDeckJsonBytes(slides);
  if (bytes > events.SLIDES_DECK_JSON_MAX) {
    return {
      ok: false, status: 413,
      error: `Deck too large to broadcast (${bytes} bytes of slide text; limit ${events.SLIDES_DECK_JSON_MAX}). Shorten or remove slides.`,
    };
  }
  // Strictly-increasing stamp even across rapid re-publishes or a clock that
  // lost a second; consumers commit only on publishedAt strictly newer.
  const lastMs = Date.parse(lobbySlides.publishedAt);
  const stampMs = Math.max(Date.now(), (Number.isFinite(lastMs) ? lastMs : 0) + 1000);
  const nextRev = (lobbySlides.deckRev || 0) + 1;
  const nextStamp = new Date(stampMs).toISOString();
  // Dry-run the chunker BEFORE committing anything. The byte gate above is a
  // coarse guard, not a guarantee: greedy packing can strand nearly a full
  // slide of slack per chunk, so a deck of mid-sized (e.g. non-Latin) slides
  // can pass 40 KB yet need more than SLIDES_TOTAL_MAX chunks. Accepting such
  // a deck would be the worst kind of failure — ok:true to the operator, the
  // deck persisted, and every broadcast (now and every heartbeat after)
  // silently failing closed. Refuse it here instead, with nothing committed.
  const chunks = events.buildSlidesChunks(slides, nextRev, nextStamp);
  if (!chunks) {
    return {
      ok: false, status: 413,
      error: `Deck too large to broadcast (needs more than ${events.SLIDES_TOTAL_MAX} chunks). Shorten or remove slides.`,
    };
  }
  lobbySlides = {
    deckRev: nextRev,
    publishedAt: nextStamp,
    slides,
  };
  persistLobbySlides();
  publishLobbySlides();
  const dropped = rawSlides.length - slides.length;
  console.log(`[slides] Published lobby deck rev ${lobbySlides.deckRev} (${slides.length} slide(s)${dropped > 0 ? `, ${dropped} device-local/blank entr${dropped === 1 ? 'y' : 'ies'} dropped` : ''})`);
  return {
    ok: true,
    deckRev: lobbySlides.deckRev,
    publishedAt: lobbySlides.publishedAt,
    slideCount: slides.length,
    droppedCount: Math.max(0, dropped),
  };
}

// ── Shared display settings (contract v6) ─────────────────────────────────────
// Same shape of state as the lobby deck: one {rev, publishedAt, settings},
// persisted in display-settings.json, rebroadcast whole every ~5 minutes so a
// rebooted screen converges, and ordered by consumers on publishedAt alone.
const DISPLAY_SETTINGS_FILE = path.join(DATA_DIR, 'display-settings.json');
let displaySettings = { rev: 0, publishedAt: '', settings: {} };
try {
  if (fs.existsSync(DISPLAY_SETTINGS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(DISPLAY_SETTINGS_FILE, 'utf8'));
    const rev = Math.floor(Number(raw.rev));
    const at = Date.parse(raw.publishedAt);
    if (Number.isFinite(at) && rev >= 1) {
      displaySettings = { rev, publishedAt: new Date(at).toISOString(), settings: events.buildDisplaySettings(raw.settings) };
      console.log(`[settings] Loaded display settings rev ${rev} (${Object.keys(displaySettings.settings).length} key(s))`);
    }
  }
} catch (e) {
  console.warn('[settings] Could not load display-settings.json — starting with none:', e.message);
}

function persistDisplaySettings() {
  saveFileAtomic(DISPLAY_SETTINGS_FILE, JSON.stringify(displaySettings));
}

// Rebroadcasts reuse publishedAt byte-identically, like the deck's.
async function publishDisplaySettings() {
  if (displaySettings.rev < 1) return false;    // nothing ever published
  if (signedInToSync()) return false;            // the sync service publishes them
  const payload = events.buildSettingsPayload(displaySettings.settings, displaySettings.rev, displaySettings.publishedAt);
  if (!payload) {
    console.error('[settings] Settings no longer fit one sealed frame — NOT published (fail closed)');
    return false;
  }
  // publish() seals (settings is an ENCRYPTED_EVENT) and never throws.
  return events.publish(pusher, EVENT_CHANNEL, 'settings', payload);
}

/** Accept a publish: sanitize, gate on size, stamp, persist, broadcast. */
function acceptDisplaySettingsPublish(rawSettings) {
  if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
    return { ok: false, status: 400, error: 'Body must be { settings: { ... } }' };
  }
  const settings = events.buildDisplaySettings(rawSettings);
  const bytes = events.displaySettingsJsonBytes(settings);
  if (bytes > events.SETTINGS_JSON_MAX) {
    return { ok: false, status: 413, error: `Settings too large to broadcast (${bytes} bytes; limit ${events.SETTINGS_JSON_MAX}). Shorten the club lines.` };
  }
  const lastMs = Date.parse(displaySettings.publishedAt);
  const stampMs = Math.max(Date.now(), (Number.isFinite(lastMs) ? lastMs : 0) + 1000);
  const nextRev = (displaySettings.rev || 0) + 1;
  const nextStamp = new Date(stampMs).toISOString();
  if (!events.buildSettingsPayload(settings, nextRev, nextStamp)) {
    return { ok: false, status: 413, error: 'Settings too large to broadcast in one sealed frame. Shorten the club lines.' };
  }
  displaySettings = { rev: nextRev, publishedAt: nextStamp, settings };
  persistDisplaySettings();
  publishDisplaySettings();
  const dropped = Object.keys(rawSettings).length - Object.keys(settings).length;
  console.log(`[settings] Published display settings rev ${nextRev} (${Object.keys(settings).length} key(s)${dropped > 0 ? `, ${dropped} per-screen/unknown dropped` : ''})`);
  return {
    ok: true,
    rev: nextRev,
    publishedAt: nextStamp,
    keyCount: Object.keys(settings).length,
    droppedCount: Math.max(0, dropped),
  };
}

function onClubNight(fn) {
  return () => {
    try {
      if (!events.isClubNightNow(churchConfig.clubNights)) return;
      fn();
    } catch (e) { /* scheduler must never die */ }
  };
}

// An hour past the published end of club. The window in church-config.json is
// when club RUNS, and it is load-bearing for other behaviour (the dashboard's
// club-night badge, the extension's own polling cadence), so it is not the
// thing to widen. But the last children are checked out after it, and the R-1
// report keeps correcting the count for a while yet - and a lobby screen whose
// tally simply stops arriving shows the 8 o'clock number all evening. So the
// TALLY, and only the tally, keeps going for an extra hour.
const TALLY_GRACE_MIN = 60;
// And an hour BEFORE the published start (7.13.0). Children are checked in
// from the moment the doors open, well ahead of 6:30, and the lobby screens are
// up from 5:00: on 2026-10-07 the first kids arrived at 5:22, and with the
// tally's own tick not starting until 5:30 a screen that missed one check-in
// sat on the wrong count until the next one got through.
const TALLY_LEAD_MIN = 60;

function onTallyWindow(fn) {
  return () => {
    try {
      if (!events.isClubNightNow(churchConfig.clubNights, undefined, TALLY_GRACE_MIN, TALLY_LEAD_MIN)) return;
      fn();
    } catch (e) { /* scheduler must never die */ }
  };
}

// Club-night publish timers are started by startListening() so a bare
// require() of this module never spins up background work — but embedders
// (the Electron shell) still get them the moment the server actually starts.
// Display login (device provisioning): the display key + slides publish
// token, sealed under the passphrase-derived key, on the cache channel. No-op
// (nothing published, fail closed) unless Pusher, a passphrase AND a display
// key are all configured — a bundle carrying an empty key would tell every
// logged-in screen to drop its key. Pusher keeps the cached frame ~30 min, so
// the 5-minute heartbeat below is what lets a screen log in at all; every
// config save republishes too, so a rotated key or token reaches logged-in
// screens within seconds.
let lastProvisionAt = null;
let provisionQuietReason = null;
async function publishProvision() {
  const reason = signedInToSync() ? 'replaced by the sync service'
    : !pusher ? 'no pusher'
    : !events.getDisplayLoginState().configured ? 'no passphrase'
      : !events.getDisplayKeyState().configured ? 'no display key' : null;
  if (reason) {
    if (provisionQuietReason !== reason) console.log(`[login] Provision frame not published (${reason})`);
    provisionQuietReason = reason;
    return false;
  }
  const frame = events.buildProvisionFrame({
    displayKey: config.displayKey,
    slidesPublishToken: config.slidesPublishToken || '',
    issuedAt: new Date().toISOString(),
    // NON-SECRET (#394): where a screen fetches its display settings JSON.
    // It rides inside the same sealed bundle purely because the bundle is
    // already going there — one passphrase now sets a replacement screen up
    // completely instead of leaving weather/calendar/widgets to be typed.
    configUrl: config.fleetConfigUrl || '',
  });
  if (!frame) return false;
  const ok = await events.publish(pusher, PROVISION_CHANNEL, events.PROVISION_EVENT, frame);
  if (ok) {
    lastProvisionAt = new Date().toISOString();
    if (provisionQuietReason !== null) console.log(`[login] Provision frame published on ${PROVISION_CHANNEL} (kid ${events.getDisplayLoginState().kid})`);
    provisionQuietReason = null;
  }
  return ok;
}


// ── The sync service (one passphrase for every screen) ────────────────────────
// Signed in (config.syncSession + config.syncUrl, both written only by
// POST /config/sync-login below), this server seals with the service's display
// key, stops the `provision` login frame and the deck / settings rebroadcasts,
// and forwards a publish made on this computer to the service. Nothing here
// touches the network until someone signs in, so a server that never does
// behaves exactly as before. See print-server/sync-client.js.
let syncStatus = { state: 'none', checkedAt: null, error: null };

function signedInToSync() {
  return syncClient.isValidSyncUrl(config.syncUrl) && syncClient.isValidSession(config.syncSession);
}

function writeConfigPatch(mutate) {
  const next = loadConfigFile();
  mutate(next);
  writeConfigFile(next);
  applySavedConfig(next);
}

// Every live frame (check-ins, tally, recap, birthdays, …) also goes to the
// sync service's channel while signed in, one at a time and in order, so a
// check-in never lands after the tally that counts it any more than Pusher
// would. Only the display channel's events: never the provision frame.
//
// A QUEUE WITH LIMITS, not an endless chain (7.11.1). With the church Wi-Fi
// up and the internet down, every frame waited its 15 s timeout behind every
// earlier one: a sixty-child rush built a backlog of a hundred frames, half
// an hour of timeouts, and when the network came back the screens got stale
// frames minutes late. So: of the kinds that describe a state (the tally, the
// recap, who is still here) only the newest waits, a check-in older than two
// minutes is not sent (the recap carries it), the queue holds at most
// RELAY_QUEUE_MAX frames, and after RELAY_BREAK_AFTER failures in a row the
// relay fails fast for RELAY_BREAK_MS instead of timing out frame by frame.
const RELAY_QUEUE_MAX = 50;
const RELAY_CHECKIN_MAX_AGE_MS = 2 * 60 * 1000;
const RELAY_BREAK_AFTER = 3;
const RELAY_BREAK_MS = 30 * 1000;
// Kinds of which only the newest frame matters to a screen.
const RELAY_LATEST_ONLY = new Set(['tally', 'recap', 'birthdays', 'tonight', 'checkout', 'points', 'schedule', 'notice', 'settings']);
let relayQueue = [];
let relayDraining = false;
let relayFailures = 0;
let relayBrokenUntil = 0;
// OWED (7.13.0): the newest frame of a state kind that did not get through (a
// failed send, or one refused while the breaker was open) is sent again once
// the service answers, unless a newer one of that kind has got through first.
// Before, a tally that failed was simply gone, and a lobby screen kept the
// number it had until the next check-in or the next scheduled tally.
const RELAY_RETRY_MS = 5 * 1000;
const relayOwed = new Map();
let relayRetryTimer = null;

function oweRelay(event, body) {
  if (!RELAY_LATEST_ONLY.has(event)) return;
  relayOwed.set(event, body);
  if (relayRetryTimer) return;
  const wait = Math.max(relayBrokenUntil - Date.now(), 0) + RELAY_RETRY_MS;
  relayRetryTimer = setTimeout(() => {
    relayRetryTimer = null;
    const owed = [...relayOwed];
    relayOwed.clear();
    if (!signedInToSync()) return;
    for (const [event, body] of owed) enqueueRelay(event, body);
  }, wait);
  if (relayRetryTimer.unref) relayRetryTimer.unref();
}

function resetRelayForTest() {
  for (const q of relayQueue) for (const r of q.resolves) r(false);
  relayQueue = [];
  relayFailures = 0;
  relayBrokenUntil = 0;
  relayOwed.clear();
  if (relayRetryTimer) { clearTimeout(relayRetryTimer); relayRetryTimer = null; }
}

async function drainRelay() {
  if (relayDraining) return;
  relayDraining = true;
  try {
    while (relayQueue.length) {
      const item = relayQueue.shift();
      let ok = false;
      if (item.event === 'checkin' && Date.now() - item.at > RELAY_CHECKIN_MAX_AGE_MS) {
        // Too old to greet a child with; the recap will carry it.
      } else if (Date.now() < relayBrokenUntil) {
        // The breaker is open: fail fast, and owe a state frame.
        oweRelay(item.event, item.body);
      } else {
        const r = await syncClient.syncRequest(config.syncUrl, '/v1/publish', {
          method: 'POST', body: { event: item.event, payload: item.body }, session: config.syncSession,
        });
        if (r.status === 401) checkSyncSignIn().catch(() => {});
        ok = r.ok;
        if (ok) relayOwed.delete(item.event);   // a newer one got through
        else if (!(r.status >= 400 && r.status < 500)) oweRelay(item.event, item.body);
        if (ok || (r.status >= 400 && r.status < 500)) relayFailures = 0;   // a refusal is an answer, not an outage
        else if (++relayFailures >= RELAY_BREAK_AFTER) {
          relayBrokenUntil = Date.now() + RELAY_BREAK_MS;
          relayFailures = 0;
          console.warn(`[sync] The sync service is not reachable; not trying again for ${RELAY_BREAK_MS / 1000} s.`);
        }
      }
      for (const resolve of item.resolves) resolve(ok);
    }
  } finally {
    relayDraining = false;
  }
}

events.setRelay((channel, event, body) => {
  if (channel !== EVENT_CHANNEL || !signedInToSync()) return false;
  if (Date.now() < relayBrokenUntil) { oweRelay(event, body); return false; }
  return enqueueRelay(event, body);
});

function enqueueRelay(event, body) {
  return new Promise((resolve) => {
    if (RELAY_LATEST_ONLY.has(event)) {
      // The newest frame of this kind replaces any still waiting; whoever
      // waited on the old one hears how the new one fared.
      const resolves = [];
      relayQueue = relayQueue.filter((q) => { if (q.event !== event) return true; resolves.push(...q.resolves); return false; });
      relayQueue.push({ event, body, at: Date.now(), resolves: [...resolves, resolve] });
    } else {
      relayQueue.push({ event, body, at: Date.now(), resolves: [resolve] });
    }
    while (relayQueue.length > RELAY_QUEUE_MAX) {
      const dropped = relayQueue.shift();
      for (const r of dropped.resolves) r(false);
    }
    drainRelay();
  });
}

// One check at a time: a burst of 401s used to start one per frame, and each
// that found the session gone rewrote config.json.
let signInCheck = null;
function checkSyncSignIn() {
  if (signInCheck) return signInCheck;
  signInCheck = checkSyncSignInNow().finally(() => { signInCheck = null; });
  return signInCheck;
}

async function checkSyncSignInNow() {
  if (!signedInToSync()) return;
  const verdict = await syncClient.syncCheck(config.syncUrl, config.syncSession);
  syncStatus = { state: verdict, checkedAt: new Date().toISOString(), error: null };
  if (verdict === 'signed-out') {
    // The passphrase was changed on another screen, which also replaced the
    // display key: check-ins sealed with ours no longer open on screens that
    // signed in again. Say so loudly; the session is dropped, so the old
    // heartbeats resume until someone signs this computer in again.
    console.error('[sync] Signed out by the sync service (the passphrase was changed). Sign this computer in again: Settings → Sync service.');
    try {
      writeConfigPatch((next) => { delete next.syncSession; });
    } catch (e) { console.warn('[sync] Could not clear the session:', e.message); }
    syncStatus = { state: 'signed-out', checkedAt: syncStatus.checkedAt, error: 'The passphrase was changed on another screen. Sign this computer in again with the new one.' };
  }
}

async function forwardToSync(res, kind, payload) {
  const r = await syncClient.syncPublish(config.syncUrl, config.syncSession, kind, payload);
  if (r.status === 0) return res.status(502).json({ error: 'Could not reach the sync service from this computer. Check its internet connection, then publish again.' });
  if (r.status === 401) {
    checkSyncSignIn().catch(() => {});
    return res.status(502).json({ error: 'This computer is signed out of the sync service. Sign it in again (printer dashboard → Settings → Sync service).' });
  }
  if (!r.ok) return res.status(r.status).json({ error: (r.body && r.body.error) || `The sync service answered HTTP ${r.status}` });
  return res.json({ ok: true, viaSync: true, ...(r.body || {}) });
}

app.post('/config/sync-login', async (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'This computer can only be signed in from its own dashboard' });
  }
  const { passphrase, url } = req.body || {};
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!syncClient.isValidSyncUrl(base)) return res.status(400).json({ error: 'That is not a sync service address (https only).' });
  if (!syncClient.normalizeSyncPassphrase(passphrase)) return res.status(400).json({ error: 'Type the passphrase first.' });
  const r = await syncClient.syncLogin(base, passphrase, { seedKey: events.getDisplayKeyState().configured ? config.displayKey : '' });
  if (!r.ok) {
    const out = { error: r.error, reason: r.reason };
    if (r.triesLeft !== undefined) out.triesLeft = r.triesLeft;
    if (r.retryAfterSec !== undefined) out.retryAfterSec = r.retryAfterSec;
    return res.status(r.status === 0 ? 502 : (r.status === 401 || r.status === 429 ? r.status : 502)).json(out);
  }
  if (!events.isValidDisplayKey(r.displayKey)) return res.status(502).json({ error: 'The sync service sent an unusable display key.' });
  const changedKey = r.displayKey !== config.displayKey;
  try {
    writeConfigPatch((next) => {
      next.syncUrl = base;
      next.syncSession = r.session;
      next.displayKey = r.displayKey;
    });
  } catch (e) {
    return res.status(500).json({ error: `Could not save the sign-in: ${e.message}` });
  }
  syncStatus = { state: 'ok', checkedAt: new Date().toISOString(), error: null };
  console.log(`[sync] Signed in to the sync service (key ${events.getDisplayKeyState().kid}${changedKey ? ', adopted the service\'s key' : ''})`);
  return res.json({ ok: true, kid: events.getDisplayKeyState().kid, changedKey });
});

app.post('/config/sync-logout', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'This computer can only be signed out from its own dashboard' });
  }
  try {
    writeConfigPatch((next) => { delete next.syncSession; });
  } catch (e) {
    return res.status(500).json({ error: `Could not save: ${e.message}` });
  }
  syncStatus = { state: 'none', checkedAt: null, error: null };
  return res.json({ ok: true });
});

function startClubNightTimers() {
  startPrinterCheckTimer();
  setInterval(onClubNight(publishRecap), 2 * 60 * 1000);
  setInterval(onTallyWindow(publishTally), 60 * 1000);
  setInterval(onTallyWindow(publishStillHere), 60 * 1000);
  setInterval(onClubNight(publishBirthdays), 10 * 60 * 1000);
  // Provision heartbeat: NOT club-night-gated and load-bearing — Pusher's cache
  // holds the last frame for ~30 minutes, so this is what a screen switched on
  // at 5 pm on a Saturday logs in against. Startup publish included.
  setInterval(() => { publishProvision().catch(() => {}); }, 5 * 60 * 1000);
  publishProvision().catch(() => {});
  // Slides heartbeat is deliberately NOT club-night-gated: this server mostly
  // runs around club time anyway, and while it IS running, a screen that
  // reboots (or a brand-new one) must converge on the current deck within
  // minutes on any day — Saturday setup included. Publishes only when a deck
  // has ever been published; ~300 sealed frames/day worst case, far under
  // Pusher's quota. Startup broadcast included so a restart re-seeds quickly.
  setInterval(() => { publishLobbySlides().catch(() => {}); }, 5 * 60 * 1000);
  publishLobbySlides().catch(() => {});
  setInterval(() => { publishDisplaySettings().catch(() => {}); }, 5 * 60 * 1000);
  publishDisplaySettings().catch(() => {});
  // Signed in to the sync service: confirm the sign-in still counts (a
  // passphrase change elsewhere ends it). No network at all otherwise.
  setInterval(() => { checkSyncSignIn().catch(() => {}); }, 10 * 60 * 1000);
  setTimeout(() => { checkSyncSignIn().catch(() => {}); }, 3000);
}

// ── Selector self-test receiver ───────────────────────────────────────────────
// The extension probes the TwoTimTwo DOM (roster rows, names, #lastCheckin,
// club icons) every 10 minutes and posts the result here so silent selector
// drift is visible on the dashboard before it eats a club night. A transition
// into hard failure publishes an ops event (type/at only — no PII).
app.post('/selftest', (req, res) => {
  const body = req.body || {};
  const wasOk = !lastSelfTest || lastSelfTest.ok !== false;
  lastSelfTest = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 20).map(r => ({
          check: String(r && r.check || '').slice(0, 60),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    at: new Date().toISOString(),
  };
  recordExtensionReport(body.extensionVersion);
  if (!lastSelfTest.ok && wasOk) {
    console.warn('[selftest] Extension reports selector failure — check-in page markup may have changed');
    events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
  }
  res.json({ ok: true });
});

// Contract-drift canary (#3): the extension's full once-a-day sweep of every
// TwoTimTwo selector and endpoint docs/TWOTIMTWO.md documents as load-bearing.
// Same shape as /selftest but a superset in scope; a fresh failure publishes
// the existing ops selector-fail (no contract change) and raises a tray alert
// through the Electron shell, so the operator hears about drift BEFORE club
// night rather than when a modal click silently stops working.
app.post('/contract-canary', (req, res) => {
  const body = req.body || {};
  const wasOk = !lastContractCanary || lastContractCanary.ok !== false;
  lastContractCanary = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 40).map(r => ({
          check: String(r && r.check || '').slice(0, 80),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
          // soft (#3 refinement): meeting-dependent checks that legitimately
          // miss on a non-club day — informational, never counted as drift.
          soft: !!(r && r.soft),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    manual: body.manual === true,
    at: new Date().toISOString(),
  };
  recordExtensionReport(body.extensionVersion);
  if (!lastContractCanary.ok && wasOk) {
    const failing = lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    console.warn('[contract-canary] TwoTimTwo contract drift detected: ' + failing.join(', '));
    events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
    fireOpsAlert('Club Label Printer — site check failed',
      'The TwoTimTwo page no longer matches what the printer expects (' +
      (failing[0] || 'unknown check') + (failing.length > 1 ? ' +' + (failing.length - 1) + ' more' : '') +
      '). Open the dashboard before club night.');
  }
  res.json({ ok: true });
});

// ── Canary — end-to-end night-systems test ────────────────────────────────────
// Stage 1 prints a real label with a TEST overlay (unique name defeats the
// duplicate window; excluded from history, stats, tally, and the checkin
// event). Stage 2 publishes a canary event so displays can confirm the pipe.
app.post('/canary', async (req, res) => {
  const stages = [];
  const canaryName = 'Canary ' + new Date().toTimeString().slice(0, 8);

  let pngPath = null;
  try {
    const result = await generateLabel({
      firstName: canaryName, lastName: '', clubName: 'Test', testBanner: true,
    });
    pngPath = result.pngPath;
    const printerName = (req.body && req.body.printerName && String(req.body.printerName).trim()) || PRINTER_NAME;
    // Startup chirp (#12): the morning test print announces itself with a
    // two-second motor melody. Failure is swallowed inside — the canary's
    // job is the label and the pipe, never the music.
    await playTuneIfEnabled(printerName);
    await printLabel(pngPath, printerName);
    stages.push({ stage: 'print', passed: true, detail: `TEST label sent to ${printerName || 'default printer'}` });
  } catch (err) {
    stages.push({ stage: 'print', passed: false, detail: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }

  const published = await events.publish(pusher, EVENT_CHANNEL, 'canary', events.buildCanary());
  stages.push({
    stage: 'pusher',
    passed: published,
    detail: pusher ? (published ? `canary event on ${EVENT_CHANNEL}` : 'publish failed') : 'Pusher not configured',
  });

  // Third stage: prove the ENCRYPTED path works, not just the channel. A screen
  // that can reach Pusher but cannot open a sealed frame shows no banners, and
  // without this stage the only symptom is "the wall stopped welcoming children"
  // — discovered mid-service rather than at 5:45.
  const keyState = events.getDisplayKeyState();
  if (keyState.configured) {
    // An empty recap on purpose: the consumer's handleRecap iterates entries, so
    // [] is a clean no-op that still exercises seal -> publish -> open.
    const sealedOk = await events.publish(
      pusher, EVENT_CHANNEL, 'recap', events.buildRecap([]));
    stages.push({
      stage: 'display key',
      passed: sealedOk,
      detail: sealedOk
        ? `sealed recap sent (key ${keyState.kid}) — each screen should flash "key OK"`
        : 'could not publish the sealed test event',
    });
  } else {
    stages.push({
      stage: 'display key',
      passed: false,
      detail: "No display key set — names are going out UNENCRYPTED on a public channel. Generate one under Realtime.",
    });
  }

  lastCanary = { at: new Date().toISOString(), stages };
  console.log(`[canary] ${stages.map(s => `${s.stage}:${s.passed ? 'ok' : 'FAIL'}`).join(' ')}`);
  res.json({ ok: stages.every(s => s.passed), stages });
});

// ── Church config (read-only) ─────────────────────────────────────────────────
// The extension fetches this once at startup so club-night windows, the
// check-in URL, and shares club ids live in one place instead of hardcodes.
app.get('/config/church', (req, res) => {
  res.json(churchConfig);
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
  if (!printerName || !isSafePrinterName(printerName)) return null;
  // 'awana-print' keeps the file inside sweepOrphanedTempFiles' regex, so a
  // crash mid-probe leaves nothing behind.
  const psPath = tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, PS_READ_QUEUE, 'utf8');
    const raw = await runPowerShell(['-File', psPath], {
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
  if (!printerName || !isSafePrinterName(printerName)) return null;
  const psPath = tmpFilePath('awana-print', 'ps1');
  try {
    fs.writeFileSync(psPath, PS_CLEAR_QUEUE, 'utf8');
    const raw = await runPowerShell(['-File', psPath], {
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
// printer is (a PDF writer, or the retired receipt printer); and a chosen
// printer that looks like the retired receipt printer is said out loud.
const PRINTER_STATUS_PROBLEMS = {
  1: 'paused', 2: 'in an error state', 4: 'reporting a paper jam', 5: 'out of labels',
  7: 'reporting a paper problem', 8: 'offline (check its USB cable and power)',
};
const RECEIPT_LIKE_NAME = /\bstar\b|\btsp\s?\d|rongta|receipt|\b80\s?mm\b|\bpos[- ]?\d/i;
function printerSetupWarnings(name, printers) {
  const chosen = String(name || '').trim();
  if (!chosen) {
    return [{ type: 'printerUnset', message: 'No name tag printer is chosen, so labels go to Windows\' default printer. Pick the label printer (the D450) in Settings \u2192 Printer.' }];
  }
  const out = [];
  if (RECEIPT_LIKE_NAME.test(chosen)) {
    out.push({ type: 'printerLooksLikeReceipt', message: `The name tag printer is "${chosen}", which looks like the retired receipt printer. Pick the label printer (the D450) in Settings \u2192 Printer.` });
  }
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
  const csvPath = CSV_FILE;

  // Check CSV
  try {
    if (!fs.existsSync(csvPath)) {
      warnings.push({ type: 'csvMissing', message: 'clubbers.csv not found' });
    } else {
      const stat = fs.statSync(csvPath);
      const rows = parseCSV(fs.readFileSync(csvPath, 'utf8'));
      if (rows.length === 0) {
        warnings.push({ type: 'csvEmpty', message: 'clubbers.csv has no data rows' });
      }
      const ageHours = (now - stat.mtimeMs) / 3600000;
      if (ageHours > 24) {
        warnings.push({ type: 'csvStale', message: `clubbers.csv is ${Math.round(ageHours)}h old` });
      }
      // A roster whose consent columns nobody can read is a silent consent
      // failure (every child prints photographable). Say so, with the values.
      const consentMsg = consentWarningFor(rosterConsentSummary(rows));
      if (consentMsg) warnings.push({ type: 'photoRelease', message: consentMsg });
    }
  } catch (e) { /* ignore */ }

  // Check printer (Windows only)
  let spooler = SPOOLER_UNKNOWN;
  if (process.platform === 'win32') {
    let printers = null;
    if (PRINTER_NAME) {
      try {
        const raw = (await runPowerShell(['-Command', 'Get-Printer | Select-Object Name,PrinterStatus | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
        const parsed = JSON.parse(raw);
        printers = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) { printers = null; }
    }
    const setup = printerSetupWarnings(PRINTER_NAME, printers);
    warnings.push(...setup);
    const printerFound = !!PRINTER_NAME && !setup.some((w) => w.type === 'printerNotFound' || w.type === 'printerCheckFailed');

    // The spooler probe (#256) sits OUTSIDE that try/catch so a queue failure
    // can never be mislabelled printerCheckFailed, and is skipped entirely
    // when the printer itself is missing — the operator wants one clear
    // warning, not two confusing ones, and /health's worst-case synchronous
    // block must not double.
    if (printerFound) {
      spooler = summarizeSpoolerJobs(await readSpoolerQueue(PRINTER_NAME), now);
      if (spooler.unknown) {
        warnings.push({
          type: 'spoolerCheckFailed',
          message: `Could not read the print queue for "${PRINTER_NAME}" — the backlog is unknown, not zero.`,
        });
      } else if (spooler.stuck) {
        warnings.push({ type: 'spoolerBacklog', message: spoolerBacklogMessage(PRINTER_NAME, spooler) });
      }
    }
  }

  cachedPrinterCheck = { warnings, checkedAt: now, spooler };
  return warnings;
}

// ── Auto-update check ────────────────────────────────────────────────────────
let latestVersion = null;
const UPDATE_CHECK_INTERVAL = 6 * 3600000; // 6 hours

// Embedders (the Electron shell) own the update lifecycle: they register a
// handler that /update-now calls instead of the legacy exit-99 dance, and
// they feed electron-updater's state into /health via setLatestVersion().
let updateHandler = null;
function setUpdateHandler(fn) { updateHandler = fn; }
// "Newer" is a numeric compare of the three parts, never a string compare
// (7.10.0 sorts before 7.9.0 as strings) and never "different": an older
// version in the feed (a release pulled back, a stale mirror) used to read as
// an update and /update-now would have installed it over this one.
function isNewerVersion(candidate, current) {
  const parts = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parts(candidate), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function setLatestVersion(ver) {
  if (isNewerVersion(ver, SERVER_VERSION)) latestVersion = String(ver).trim();
}

// Where the Electron shell keeps the managed copy of the Chrome extension, and
// which version is sitting there. Pushed in rather than guessed from the
// filesystem: only the shell knows whether it actually synced, and /health
// reporting a folder the app never wrote would be worse than reporting none.
// Stays null under a standalone `node server.js`, which is the truth there.
let extensionInfo = null;
// Version skew (#7), pure half: warn only when the synced folder and the
// running extension genuinely disagree AND the running-version report is
// fresh. A report from before the sync (or from last week's session) must
// not shout "restart Chrome" at an operator whose Chrome is already fine —
// the extension reports every 10 minutes while a check-in page is open, so
// 30 minutes of freshness covers a slow tab without covering a stale one.
const EXTENSION_REPORT_FRESH_MS = 30 * 60 * 1000;
function extensionSkew(syncedVersion, report, now = Date.now()) {
  if (!syncedVersion || !report || !report.version) return null;
  if (now - report.at > EXTENSION_REPORT_FRESH_MS) return null;
  if (report.version === syncedVersion) return null;
  return { running: report.version, synced: syncedVersion };
}

function setExtensionInfo(info) {
  if (!info || !info.targetDir) { extensionInfo = null; return; }
  extensionInfo = {
    dir: String(info.targetDir),
    version: info.version ? String(info.version) : null,
    action: info.action ? String(info.action) : null,
  };
}

function checkForUpdates() {
  const url = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION';
  https.get(url, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const ver = data.trim();
      if (isNewerVersion(ver, SERVER_VERSION)) {
        latestVersion = ver;
        console.log(`[update] New version available: ${ver} (current: ${SERVER_VERSION})`);
      }
    });
  }).on('error', () => { /* ignore */ });
}

// Override health endpoint with enhanced version
app.get('/health', async (req, res) => {
  // Copy: checkPrinterWarnings() hands back its CACHED array, so appending in
  // place would re-append on every poll until the cache expired.
  const warnings = [...await checkPrinterWarnings()];
  // config.json could not be read at some point since this server started
  // (loadConfigFile): what was done about it, until a restart, so it is seen.
  if (configFileDamaged) warnings.push({ type: 'configDamaged', message: configFileDamaged });
  // A data file whose last save failed (saveFileAtomic), until one succeeds.
  const saveWarning = dataSaveWarning();
  if (saveWarning) warnings.push(saveWarning);
  // The live-channel relay's breaker is open: frames to the sync service are
  // being dropped. With Pusher also configured the screens still get them that
  // way, which is why this used to be a console line nobody saw; without
  // Pusher it was the only pipe. Either way the operator should know.
  if (signedInToSync() && Date.now() < relayBrokenUntil) {
    warnings.push({
      type: 'syncRelay',
      message: `The sync service is not answering, so live frames are not reaching screens through it (next try in ${Math.max(1, Math.ceil((relayBrokenUntil - Date.now()) / 1000))} s). Labels still print. Check the internet connection.`,
    });
  }
  // Surface security misconfiguration where the operator already looks. A
  // silently loopback-only server looks identical to a broken phone page, and
  // "I turned on phone check-in and nothing happens" must not be a mystery.
  //
  // Every entry must be a {type, message} OBJECT. The dashboard renders
  // `w.message`, so a bare string arrived as `undefined` and painted an EMPTY
  // yellow box — the loudest warnings in the file were the invisible ones, and
  // that is exactly why nobody found the display key.
  if (config.lanAccess === true && !security.isAcceptablePin(config.phonePin)) {
    warnings.push({
      type: 'phonePinMissing',
      message: 'Phone check-in is enabled but no PIN is set, so the server is only listening on this computer. Set a PIN in Settings and restart.',
    });
  }
  // Surface the realtime privacy mode where the operator already looks. An
  // unencrypted channel is not broken, so it cannot be an error — but it must
  // never be INVISIBLE, or "we set that up" becomes a belief rather than a fact.
  const keyState = events.getDisplayKeyState();
  const loginState = events.getDisplayLoginState();
  if (loginState.configured && !keyState.configured) {
    warnings.push({
      type: 'displayLoginNeedsKey',
      message: 'A display passphrase is set but there is no display key, so screens cannot be logged in. Generate the display key (Settings → Realtime privacy) and Save.',
    });
  }
  if (pusher && !keyState.configured) {
    warnings.push({
      type: 'displayKeyMissing',
      message: "No display key is set, so children's first names are published unencrypted on a channel anyone can subscribe to. Open Settings → Realtime privacy and press Generate display key.",
    });
  }
  if (config.displayKey && !keyState.configured) {
    warnings.push({
      type: 'displayKeyInvalid',
      message: 'The saved display key is invalid, so names are going out in the clear. Open Settings → Realtime privacy and generate a new one.',
    });
  }
  // #2: check-ins the extension could not verify as stuck on TwoTimTwo.
  // Names are allowed here: /health is loopback/operator-facing and this
  // list exists precisely so a human re-checks these kids on the site.
  // Version skew (#7): the app synced a new extension to disk, but Chrome is
  // still running the old code until it restarts. The widget already shows
  // its own "restart Chrome" banner; this is the dashboard half, driven by
  // what the extension itself last reported it was running.
  const skew = extensionSkew(extensionInfo && extensionInfo.version, lastExtensionReport);
  if (skew) {
    warnings.push({
      type: 'extensionSkew',
      message: `Chrome is running extension v${skew.running}, but v${skew.synced} is already installed on disk. Restart Chrome to load it — until then the browser keeps the old behavior.`,
    });
  }
  // Contract drift (#3): the daily sweep's latest verdict. A failing sweep is
  // exactly the "warn before club night" moment, so it belongs in the same
  // yellow box the operator already reads.
  if (lastContractCanary && lastContractCanary.ok === false) {
    const failing = lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    warnings.push({
      type: 'contractDrift',
      message: `The TwoTimTwo site no longer matches what this printer expects (${failing.join(', ') || 'unknown check'}). Automatic printing may be broken — run the widget's "Check site" after any fix.`,
    });
  }
  // Rehearsal mode is never an error, but it must never be INVISIBLE either:
  // an armed rehearsal turns every print into a TEST label, so the dashboard
  // has to shout it until it's turned off (or the 2h auto-disarm fires).
  if (isRehearsalActive()) {
    warnings.push({
      type: 'rehearsalArmed',
      message: 'Rehearsal mode is ON: every label prints with a TEST band and nothing is recorded or broadcast as real. Turn it off before real check-ins (it auto-disarms 2 hours after arming).',
    });
  }
  // Where tonight's number is coming from. Only the FALLBACK is a warning: the
  // report-backed count is the normal, good state and a yellow box that is up
  // 165 hours a week is a yellow box people learn to ignore. Gated on the club
  // window (or on a report having landed today and then gone stale), because
  // "no report at 3pm on a Tuesday" is not news.
  const tallyNow = authoritativeTonight();
  if (lastPartialReport && Date.now() - lastPartialReport.at < REPORT_FRESH_MS) {
    warnings.push({
      type: 'report-partial',
      message: `TwoTimTwo's check-in report lists ${lastPartialReport.declared} children but only ${lastPartialReport.parsed} could be read, so tonight's count is not taken from it. Reload the Chrome extension (chrome://extensions) or restart Chrome to pick up the newest version.`,
    });
  }
  if (tallyNow.source === 'history'
      && (events.isClubNightNow(churchConfig.clubNights) || lastCheckinReport)) {
    const mins = lastCheckinReport ? Math.round((Date.now() - lastCheckinReport.at) / 60000) : null;
    warnings.push({
      type: 'tally-source',
      message: mins === null
        ? "Tonight's count is from the printer's own history; TwoTimTwo's check-in report has not been received tonight. Open the check-in page in Chrome so the extension can read it."
        : `Tonight's count is from the printer's own history; the TwoTimTwo report has not been received in ${mins} minute${mins === 1 ? '' : 's'}. Check that the check-in page is still open in Chrome.`,
    });
  }

  const unverified = feeds.getUnverifiedCheckins(Date.now());
  if (unverified.length) {
    const names = unverified.map(e => e.name).join(', ');
    warnings.push({
      type: 'unverifiedCheckins',
      message: `${unverified.length} check-in${unverified.length > 1 ? 's' : ''} may not have stuck on TwoTimTwo: ${names}. Labels printed, but the site never confirmed - re-check these kids on the check-in page.`,
    });
  }
  // The label's brand kit (fonts + official club marks). A failed piece never
  // stops a print — the renderer falls back to the old font or the letter
  // monogram — but it must not be invisible either: a broken install would
  // otherwise just print plainer labels and nobody would know why.
  const brandKit = brand.status();
  warnings.push(...brand.warnings());
  warnings.push(...printerFallbackWarnings());
  let csvUpdatedAt = null;
  try {
    csvUpdatedAt = fs.statSync(CSV_FILE).mtime.toISOString();
  } catch { /* no CSV yet */ }
  res.json({
    status: 'ok',
    printer: PRINTER_NAME || '(default)',
    rehearsal: isRehearsalActive(),
    version: SERVER_VERSION,
    latestVersion: latestVersion,
    uptime: Math.round(process.uptime()),
    warnings,
    clubNight: events.isClubNightNow(churchConfig.clubNights),
    // Which measurement tonight's number came from, as data rather than prose,
    // so the dashboard can label the Tonight card without parsing a sentence.
    tallySource: {
      source: tallyNow.source,
      at: tallyNow.at ? new Date(tallyNow.at).toISOString() : null,
      ageMs: tallyNow.ageMs,
    },
    pusher: events.getPublishState(),
    // Never the key itself — only whether one is installed, plus its public
    // `kid` fingerprint, which is what lets a screen confirm it holds the SAME
    // key rather than merely some key. "Are we actually encrypted?" has to be
    // answerable from the dashboard, not a belief.
    displayKeyConfigured: keyState.configured,
    displayKeyId: keyState.kid,
    encryptingNames: keyState.configured,
    // Managed Chrome extension folder + the version sitting in it. Null under a
    // standalone server. The VERSION is safe for anyone (the extension itself
    // reads it to know a restart is owed); the PATH is not, because it contains
    // the operator's Windows username and /health is CORS-reachable from the
    // check-in site. So the folder is loopback-only, like the display key.
    extension: extensionInfo && (isTrustedConfigOrigin(req)
      ? extensionInfo
      : { version: extensionInfo.version, action: extensionInfo.action }),
    selectorSelfTest: lastSelfTest,
    contractCanary: lastContractCanary,
    // Musical printer observability: the last tune attempt's outcome, with
    // the exact Win32 error when the RAW path fails — "it just prints
    // normal" must be diagnosable from the dashboard.
    musicalTune: { enabled: config.musicalPrinter === true, last: lastTune },
    // Windows spooler backlog (#256), as NUMBERS rather than prose, so the
    // Night Status card and any future UI don't have to parse a sentence.
    // Counts, ages and spooler status tokens only — deliberately never a
    // DocumentName or a UserName: /health is CORS-readable from the check-in
    // site, which is exactly why the extension folder path is loopback-gated
    // just above. `unknown: true` means the queue could not be read; it is
    // never a zero.
    spooler: cachedPrinterCheck.spooler || SPOOLER_UNKNOWN,
    extensionRunning: lastExtensionReport,
    lastCanary,
    printFailures: printFailures.length,
    csv: { count: clubbers.length, updatedAt: csvUpdatedAt },
    // Which label fonts and club marks loaded: family names / club keys and a
    // short reason for each failure, never a file path (the packaged kit sits
    // under the operator's Windows profile and /health is CORS-readable).
    fonts: brandKit.fonts,
    clubMarks: brandKit.marks,
    // Freshness per POST /feed/* so the dashboard can show whether the
    // extension's tonight/points/schedule/notice scrapes are still landing.
    feeds: feeds.getFeedsHealth(),
    // The published lobby deck — rev/stamp/count only, never the slide text
    // (that is one GET away on the dashboard, and /health is CORS-reachable
    // from the check-in site).
    lobbySlides: {
      deckRev: lobbySlides.deckRev,
      publishedAt: lobbySlides.publishedAt || null,
      slideCount: lobbySlides.slides.length,
      tokenConfigured: Boolean(config.slidesPublishToken),
    },
    // Shared display settings (contract v6): which rev the screens are on.
    // Never the values themselves.
    displaySettings: {
      rev: displaySettings.rev,
      publishedAt: displaySettings.publishedAt || null,
      keyCount: Object.keys(displaySettings.settings).length,
    },
    // Display login: whether screens can log in with the passphrase, and the
    // fingerprint of the wrapping key — never the passphrase, never the key.
    // The sync service: whether this computer is signed in, never the session.
    sync: {
      signedIn: signedInToSync(),
      url: syncClient.isValidSyncUrl(config.syncUrl) ? config.syncUrl : null,
      state: signedInToSync() ? syncStatus.state : (syncStatus.state === 'signed-out' ? 'signed-out' : 'none'),
      checkedAt: syncStatus.checkedAt,
      error: syncStatus.error,
    },
    displayLogin: {
      retired: signedInToSync(),
      configured: loginState.configured,
      kid: loginState.kid,
      iterations: loginState.iterations,
      lastPublishedAt: lastProvisionAt,
    },
  });
});

// Recent print failures for the dashboard (names stay local — never on Pusher)
app.get('/failures', (req, res) => {
  res.json(printFailures);
});

// ── One-click update ──────────────────────────────────────────────────────────
// Exits with code 99, which launch-awana.bat treats as "re-run the update
// check": it downloads the latest installer, refreshes the project, and
// starts the new server. Guarded so a stray call when no update exists can't
// bounce the server mid-event for nothing.
app.post('/update-now', (req, res) => {
  if (!isNewerVersion(latestVersion, SERVER_VERSION)) {
    return res.status(409).json({ error: 'Already on the latest version', version: SERVER_VERSION });
  }
  res.json({ ok: true, updatingTo: latestVersion });
  if (updateHandler) {
    // Embedded in the Electron shell: hand the update to electron-updater.
    console.log(`[update] Update to v${latestVersion} requested — delegating to the app shell`);
    setTimeout(() => { try { updateHandler(latestVersion); } catch (e) { console.error('[update] Handler failed:', e.message); } }, 500);
  } else {
    // Legacy script install: exit 99 so launch-awana.bat re-runs the updater.
    console.log(`[update] Update to v${latestVersion} requested — exiting so the launcher can update`);
    // Let the response flush before the process exits.
    setTimeout(() => process.exit(99), 500);
  }
});

// ── Config endpoints ─────────────────────────────────────────────────────────

// The Pusher app secret and the phone PIN are the two values that must never
// leave this machine: the secret lets anyone publish to the church's screens,
// and the PIN is what gates the roster on the LAN.
//
// The previous version of this check had two holes, both closed here:
//   • `origin.endsWith(':3456')` accepted ANY host on that port, so a page
//     served from http://evil.example:3456 read both secrets cross-origin.
//   • `if (!origin) return true` trusted every request without an Origin
//     header — including a plain `curl` from any phone on the church WiFi,
//     which made the PIN self-defeating (fetch the PIN, then use it).
//
// Now: the request must come from the loopback interface, AND its Origin (when
// present) must be the extension or one of this server's own loopback pages.
// A LAN caller never gets these fields even with a valid PIN.
const SECRET_CONFIG_KEYS = ['pusherSecret', 'phonePin', 'displayKey', 'slidesPublishToken', 'displayLoginPassphrase', 'syncSession'];

// Operator text that ends up printed on a label (labelFooter, the connect-card
// greeting). Not secrets, but they go onto paper and into config.json, so only
// a single bounded printable line is ever persisted: control characters become
// spaces, whitespace collapses, and the length is capped.
function printableConfigLine(value, maxLen) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Make the live `config` object exactly mirror what was just written to disk.
//
// Object.assign() alone was NOT enough, and the gap was security-relevant. Both
// POST /config paths can DELETE a key — `delete next.phonePin` when the operator
// clears the PIN, `delete next.displayKey` when they clear the display key — and
// Object.assign copies properties but never removes them. So the file said the
// PIN was gone while the live auth gate, which reads config.phonePin per
// request, kept accepting the OLD one until someone restarted the server. An
// operator clearing a leaked PIN had every reason to believe it was revoked.
// Same for the display key: clearing it left the publisher still sealing with
// the key it was supposed to have forgotten.
function applySavedConfig(next) {
  for (const key of Object.keys(config)) {
    if (!(key in next)) delete config[key];
  }
  Object.assign(config, next);
  // Sealing is per-publish, so a key change takes effect immediately — a
  // volunteer fixing a name outage mid-event must not have to restart the server
  // that is currently printing labels.
  events.setDisplayKey(config.displayKey);
  // Same for the display login; and any change to the key, the token or the
  // passphrase re-provisions every logged-in screen right away (the Electron
  // shell calls this directly, so the hook lives here, not in the route).
  events.setDisplayLogin(config.displayLoginPassphrase, config.displayLoginSalt);
  publishProvision().catch(() => {});
}

function isTrustedConfigOrigin(req) {
  if (!security.isLoopbackRequest(req)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;                                   // same-origin GET, curl on this machine, tests
  if (origin.startsWith('chrome-extension://')) return true;   // the extension's options page
  if (origin.startsWith('moz-extension://')) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && String(url.port) === String(PORT)
      && (url.hostname === 'localhost' || security.isLoopbackAddress(url.hostname));
  } catch {
    return false;
  }
}

app.get('/config', (req, res) => {
  let saved;
  try {
    saved = fs.existsSync(CONFIG_FILE)
      ? loadConfigFile()
      : { printerName: PRINTER_NAME, checkinUrl: '' };
  } catch (e) {
    saved = { printerName: PRINTER_NAME, checkinUrl: '' };
  }
  if (!isTrustedConfigOrigin(req)) {
    saved = { ...saved };
    SECRET_CONFIG_KEYS.forEach(k => { delete saved[k]; });
  }
  // The dashboard's schedule table shows the club schedule this computer
  // actually routes by, the default included when it has none of its own.
  if (!Array.isArray(saved.schedule) || !saved.schedule.length) saved = { ...saved, schedule: scheduleRows() };
  res.json(saved);
});

// Generate a fresh display key for the dashboard's button. Loopback-only via
// isTrustedConfigOrigin: a phone on the venue Wi-Fi must never be able to mint
// the key that reads children's names, PIN or no PIN. Deliberately does NOT save
// it — the operator copies it, pastes it into the screens, and only then commits
// it here, so a mistyped paste cannot leave the screens keyed to a key the
// server has already replaced.
app.post('/config/display-key/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display key can only be generated from the dashboard on this computer' });
  }
  const key = events.generateDisplayKey();
  console.log('[realtime] Generated a new display key (not yet saved)');
  res.json({ key });
});

// The lobby-slides publish token: what the display app's slide editor must
// present to POST /api/lobby-slides from its https origin. Same loopback-only
// mint rule as the display key — a phone on the venue Wi-Fi must not be able
// to create the credential that writes to every lobby screen.
const SLIDES_TOKEN_RE = events.SLIDES_TOKEN_RE;

app.post('/config/slides-token/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The publish token can only be generated from the dashboard on this computer' });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  console.log('[slides] Generated a new publish token (not yet saved)');
  res.json({ token });
});

// The display login passphrase: what a volunteer types once on each screen.
// Loopback-only mint like the other two — this is the one string that unlocks
// the display key. Not saved here; the dashboard saves it via POST /config
// (save-on-generate, like the slides token: rotating it can never lock a
// screen out of names it already holds, it only asks screens to log in again).
app.post('/config/display-login/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display passphrase can only be generated from the dashboard on this computer' });
  }
  const passphrase = events.generateLoginPassphrase();
  console.log('[login] Generated a new display passphrase (not yet saved)');
  res.json({ passphrase });
});

app.post('/config', (req, res) => {
  const {
    printerName, checkinUrl,
    pusherAppId, pusherKey, pusherSecret, pusherCluster,
    phonePin, firstTimerInverted, connectCard, enableDrivenCheckin, lateGraceMin,
    worksheetPrinter, lanAccess, allowedOrigins, historyRetentionDays, displayKey,
    labelFooter, connectCardAutoFirstTimer, connectCardGreeting, seasonTheme,
    musicalPrinter, updateBeacon, slidesPublishToken, displayLoginPassphrase,
    trophyBand, fleetConfigUrl, pickupClubs,
    backupPrinterName,
  } = req.body || {};
  if (!isTrustedConfigOrigin(req) && SECRET_CONFIG_KEYS.some(k => (req.body || {})[k] !== undefined)) {
    return res.status(403).json({ error: 'Pusher/PIN/display-login settings can only be changed from the dashboard on this computer' });
  }
  try {
    const next = loadConfigFile();
    if (printerName !== undefined) next.printerName = printerName;
    // checkinUrl is handed to shell.openExternal() (Electron) and Start-Process
    // (legacy installer), so an unvalidated value was an arbitrary URI aimed at
    // the Windows shell — and this route accepts writes from the extension's
    // origin. Same reasoning as worksheetPrinter below: refuse to PERSIST
    // anything unsafe, so it can never be poisoned once and fire later.
    if (checkinUrl !== undefined) {
      if (!security.isSafeExternalUrl(checkinUrl)) {
        return res.status(400).json({ error: 'checkinUrl must be a plain http(s) URL' });
      }
      next.checkinUrl = String(checkinUrl).trim();
    }
    if (pusherAppId !== undefined) next.pusherAppId = pusherAppId;
    if (pusherKey !== undefined) next.pusherKey = pusherKey;
    if (pusherSecret !== undefined) next.pusherSecret = pusherSecret;
    if (pusherCluster !== undefined) next.pusherCluster = pusherCluster;
    // A PIN is the only thing between the LAN and the roster, so it has a
    // minimum length now and the 12-char cap is gone (it discouraged
    // passphrases). Clearing it is still allowed — that just turns LAN access
    // off, because the auth gate fails closed without one.
    if (phonePin !== undefined) {
      const wanted = String(phonePin);
      if (wanted === '') {
        delete next.phonePin;
      } else if (!security.isAcceptablePin(wanted)) {
        return res.status(400).json({
          error: `PIN must be ${security.PIN_MIN_LENGTH}–${security.PIN_MAX_LENGTH} characters`,
        });
      } else {
        next.phonePin = wanted;
      }
    }
    // The AES key that lets the church's own screens read children's names off
    // the public Pusher channel. Clearing it stops the three name-bearing events
    // from being published at all (they fail closed rather than reverting to
    // plaintext) — which is the whole-system rollback lever, no deploy needed.
    if (displayKey !== undefined) {
      const wanted = String(displayKey).trim();
      if (wanted === '') {
        delete next.displayKey;
      } else if (!events.isValidDisplayKey(wanted)) {
        return res.status(400).json({
          error: 'Display key must be 32 bytes of base64 — use the Generate button rather than typing one',
        });
      } else {
        next.displayKey = wanted;
      }
    }
    // The lobby-slides publish token (see /api/lobby-slides). Clearing it
    // revokes the display app's publish path immediately; the dashboard's own
    // paste flow keeps working either way.
    if (slidesPublishToken !== undefined) {
      const wanted = String(slidesPublishToken).trim();
      if (wanted === '') {
        delete next.slidesPublishToken;
      } else if (!SLIDES_TOKEN_RE.test(wanted)) {
        return res.status(400).json({
          error: 'Publish token must come from the Generate button (24–64 URL-safe base64 characters)',
        });
      } else {
        next.slidesPublishToken = wanted;
      }
    }
    // The display login passphrase (see publishProvision). A NEW salt is
    // minted only when the passphrase actually changes, so re-saving the
    // Settings form never silently rotates the wrapping key under every
    // screen; clearing it removes both and stops the provision frames.
    if (displayLoginPassphrase !== undefined) {
      const wanted = events.normalizePassphrase(displayLoginPassphrase);
      if (wanted === '') {
        delete next.displayLoginPassphrase;
        delete next.displayLoginSalt;
      } else if (!events.isValidLoginPassphrase(wanted)) {
        return res.status(400).json({
          error: `Display passphrase must be ${events.LOGIN_PASSPHRASE_MIN}–${events.LOGIN_PASSPHRASE_MAX} characters — use Generate, or type a sentence`,
        });
      } else {
        if (wanted !== next.displayLoginPassphrase || !events.isValidLoginSalt(next.displayLoginSalt)) {
          next.displayLoginSalt = events.generateLoginSalt();
        }
        next.displayLoginPassphrase = wanted;
      }
    }
    // The fleet-config URL handed to screens by the display login (#394).
    // NOT a secret — it is the same address an operator can already put in a
    // screen's `?config=` — but it is https-only and length-capped here, at
    // the point it is PERSISTED, so a bad value can never be poisoned once
    // and shipped to every screen on the next provision heartbeat. Clearing
    // it deletes the key and the next frame carries '' , which is how a
    // cleared URL reaches screens that already applied one.
    if (fleetConfigUrl !== undefined) {
      const wanted = String(fleetConfigUrl).trim();
      if (wanted === '') {
        delete next.fleetConfigUrl;
      } else if (!events.isValidFleetConfigUrl(wanted)) {
        return res.status(400).json({
          error: `Settings URL must be an https:// link of at most ${events.PROVISION_CONFIG_URL_MAX} characters`,
        });
      } else {
        next.fleetConfigUrl = wanted;
      }
    }
    // Binding beyond loopback is an explicit choice, not a default. Takes
    // effect on restart (the listening socket is already bound).
    if (lanAccess !== undefined) next.lanAccess = !!lanAccess;
    if (allowedOrigins !== undefined) next.allowedOrigins = security.sanitizeAllowedOrigins(allowedOrigins);
    if (historyRetentionDays !== undefined) {
      next.historyRetentionDays = security.normalizeRetentionDays(historyRetentionDays);
    }
    if (firstTimerInverted !== undefined) next.firstTimerInverted = !!firstTimerInverted;
    // Trophy band (#293): the finished-handbook banner on a child's next
    // label. Default ON (read as `config.trophyBand !== false` at the call
    // site), so an operator who never opens Settings still gets it.
    if (trophyBand !== undefined) next.trophyBand = !!trophyBand;
    if (connectCard !== undefined) next.connectCard = !!connectCard;
    // Label footer (#8): one short operator line (church name, a verse, service
    // times) rendered along the bottom of every label. Clearing it deletes the
    // key (same pattern as phonePin) so config.json stays clean.
    if (labelFooter !== undefined) {
      const lf = printableConfigLine(labelFooter, 60);
      if (lf === '') delete next.labelFooter;
      else next.labelFooter = lf;
    }
    // Connect card auto-trigger + greeting (#10). An empty greeting deletes the
    // key and the printed card falls back to the built-in default.
    if (connectCardAutoFirstTimer !== undefined) next.connectCardAutoFirstTimer = !!connectCardAutoFirstTimer;
    if (connectCardGreeting !== undefined) {
      const cg = printableConfigLine(connectCardGreeting, 60);
      if (cg === '') delete next.connectCardGreeting;
      else next.connectCardGreeting = cg;
    }
    // Screen season (#16/#18; the key keeps its old name, seasonTheme): 'auto'
    // is the default (and deletes the key), 'off' stops the broadcast so each
    // screen follows its own skin setting, a known season pins it. Anything
    // else is refused so a typo can't silently mean 'auto'.
    if (seasonTheme !== undefined) {
      const st = String(seasonTheme || 'auto');
      if (st === 'auto') delete next.seasonTheme;
      else if (st === 'off' || SEASON_KEYS.includes(st)) next.seasonTheme = st;
      else return res.status(400).json({ error: 'unknown seasonTheme' });
    }
    // `collectibleIcons` (the retired collectible of the week) is no longer
    // read from the body: a dashboard page cached from an older version that
    // still posts it saves fine, and the value goes nowhere.
    // Musical printer (#11/#12): OFF by default - raw TSPL bytes at an unknown
    // printer model are a party trick, not a guarantee.
    if (musicalPrinter !== undefined) next.musicalPrinter = !!musicalPrinter;
    if (updateBeacon !== undefined) next.updateBeacon = !!updateBeacon;
    // "If it fails, print on" (6.26.0). Kept even when empty: '' is a choice
    // (no backup), unlike a missing key, which means a config from before it.
    if (backupPrinterName !== undefined) {
      const bp = String(backupPrinterName || '').trim();
      if (!isSafePrinterName(bp)) return res.status(400).json({ error: 'backupPrinterName contains unsupported characters' });
      next.backupPrinterName = bp;
    }
    // The receipt-printer trial's settings leave the file on this save, and a
    // backup that named the receipt printer goes with them.
    const retiredReceipt = String(next.receiptPrinterName || '').trim().toLowerCase();
    RETIRED_PRINTER_KEYS.forEach((k) => { delete next[k]; });
    if (retiredReceipt && String(next.backupPrinterName || '').trim().toLowerCase() === retiredReceipt) next.backupPrinterName = '';
    if (enableDrivenCheckin !== undefined) next.enableDrivenCheckin = !!enableDrivenCheckin;
    // "Clubs on the pickup list" (7.16.0): the one setting every lobby
    // screen's still-here list follows. null puts it back to the default
    // (every club but Trek and Journey); a club name we do not know is a 400.
    let pickupChanged = false;
    if (pickupClubs !== undefined) {
      const pc = pickup.normalizePickupClubs(pickupClubs);
      if (!pc.ok) return res.status(400).json({ error: pc.reason });
      const before = JSON.stringify(pickup.pickupClubsOf(next));
      if (pc.value === null) delete next.pickupClubs;
      else next.pickupClubs = pc.value;
      pickupChanged = JSON.stringify(pickup.pickupClubsOf(next)) !== before;
    }
    if (lateGraceMin !== undefined) next.lateGraceMin = Math.max(0, Math.min(120, Number(lateGraceMin) || 0));
    // Worksheets (POST /print-pdf) are letter-size, not 4x2 labels, so a
    // church running two printers can route them separately.
    if (worksheetPrinter !== undefined) {
      // This value reaches a shell via printPdf(); refuse to persist anything
      // that isn't a plain printer label so it can never be poisoned once and
      // fire later during a legitimate worksheet print.
      const wp = String(worksheetPrinter || '').trim();
      if (!isSafePrinterName(wp)) {
        return res.status(400).json({ error: 'worksheetPrinter contains unsupported characters' });
      }
      next.worksheetPrinter = wp;
    }

    writeConfigFile(next);
    // Keep the live process in sync so schedule/PIN/toggle/key changes apply
    // without a restart (Pusher creds still need one — noted in the UI).
    applySavedConfig(next);
    if (pickupChanged) stillHereChanged();
    console.log('[config] Saved');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Group schedule (#28) ──────────────────────────────────────────────────────
app.get('/config/schedule', (req, res) => {
  res.json({ schedule: scheduleRows(), lateGraceMin: Number.isFinite(Number(config.lateGraceMin)) ? Number(config.lateGraceMin) : 10 });
});

app.post('/config/schedule', (req, res) => {
  const { schedule, lateGraceMin } = req.body || {};
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule must be an array' });
  const rows = schedule.slice(0, SCHEDULE_MAX_ROWS).map(r => ({
    club: String(r && r.club || '').slice(0, 30),
    startTime: /^\d{1,2}:\d{2}$/.test(String(r && r.startTime || '')) ? String(r.startTime) : '',
    location: String(r && r.location || '').slice(0, 40),
    room: String(r && r.room || '').slice(0, 40),
  })).filter(r => r.club);
  try {
    const next = loadConfigFile();
    next.schedule = rows;
    if (lateGraceMin !== undefined) next.lateGraceMin = Math.max(0, Math.min(120, Number(lateGraceMin) || 0));
    writeConfigFile(next);
    applySavedConfig(next);
    res.json({ ok: true, schedule: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Musical printer (#11/#12) — endpoint ──────────────────────────────────────
// Loopback/trusted-origin only: feeding paper is a physical act, and a phone
// on the venue Wi-Fi has no business making the printer sing mid-club.
// ── Rehearsal mode (#19) ──────────────────────────────────────────────────────
// One dashboard button arms a fake club night across BOTH apps: while armed,
// EVERY print is treated as a demo (real label, diagonal TEST band, zero
// persistent side effects — no history, no ledger, no publish, no tally), and
// every tally broadcast carries the contract's optional `rehearsal: true`
// flag (staged in v5.20.0) so the displays watermark themselves. In-memory
// only, and it auto-disarms after 2 hours: a rehearsal armed at Tuesday
// training and forgotten must never turn Wednesday's real check-ins into
// TEST labels. /health carries both the state and a loud warning while armed.
const REHEARSAL_AUTO_DISARM_MS = 2 * 60 * 60 * 1000;
let rehearsalState = { on: false, armedAt: 0 };

function isRehearsalActive(now = Date.now()) {
  if (!rehearsalState.on) return false;
  if (now - rehearsalState.armedAt > REHEARSAL_AUTO_DISARM_MS) {
    rehearsalState = { on: false, armedAt: 0 };
    console.log('[rehearsal] Auto-disarmed after 2h — rehearsal mode never outlives a training session');
    // Broadcast the disarm, or displays keep the TEST watermark until the
    // next club night's first interval tally. Deferred a tick: this getter
    // is called from inside publishTally itself, and the state above is
    // already cleared, so the deferred tally reads rehearsal=false.
    setTimeout(() => { try { publishTally(); } catch (e) { /* best-effort */ } }, 0);
    return false;
  }
  return true;
}

app.post('/rehearsal', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'Rehearsal mode can only be toggled from the dashboard on this computer' });
  }
  const on = (req.body || {}).on === true;
  rehearsalState = on ? { on: true, armedAt: Date.now() } : { on: false, armedAt: 0 };
  console.log('[rehearsal] ' + (on ? 'ARMED — every print is a TEST label, nothing is recorded, displays watermark' : 'disarmed — back to real check-ins'));
  // Broadcast immediately so screens flip their watermark within seconds,
  // not at the next 60s tally tick (and drop it just as fast on disarm).
  publishTally();
  res.json({ ok: true, rehearsal: rehearsalState.on });
});

app.post('/play-tune', async (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The tune button only works from the dashboard on this computer' });
  }
  if (config.musicalPrinter !== true) {
    return res.status(409).json({ error: 'Musical printer is off — enable it in Settings first' });
  }
  const wanted = String((req.body || {}).printerName || '').trim();
  if (wanted && !isSafePrinterName(wanted)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  const tune = String((req.body || {}).tune || '') || undefined;
  const ok = await playTuneIfEnabled(wanted || PRINTER_NAME, tune);
  res.json({ ok, tune: lastTune ? lastTune.tune : null, error: !ok && lastTune ? lastTune.error : undefined });
});

// Clear a jammed printer's backlog (#256). Gated the way /play-tune and
// /rehearsal are — trusted origin only, NOT merely the phone PIN: a volunteer's
// phone on the venue Wi-Fi must not be able to bin labels that are about to
// print. Confirm-gated too, and never invoked automatically by anything.
//
// The body is validated BEFORE the platform short-circuit, exactly as
// POST /print-pdf does, so the 400s stay observable from Linux CI.
app.post('/printer/clear-queue', async (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The print queue can only be cleared from the dashboard on this computer' });
  }
  const wanted = String((req.body || {}).printerName || '').trim();
  if (wanted && !isSafePrinterName(wanted)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'confirm:true is required' });
  }
  const target = wanted || PRINTER_NAME;
  if (!target || !isSafePrinterName(target)) {
    return res.status(400).json({ error: 'No usable printer is configured' });
  }
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'Clearing the print queue requires Windows' });
  }
  try {
    const result = await clearPrintQueue(target);
    if (!result) return res.status(500).json({ error: 'Could not clear the print queue' });
    // So the next /health tells the truth instead of a 60s-stale backlog.
    cachedPrinterCheck.checkedAt = 0;
    console.log(`[queue] Cleared ${result.removed} job(s) on ${target}${result.failed ? `, ${result.failed} refused` : ''}`);
    return res.json({ ok: true, printer: target, removed: result.removed, failed: result.failed });
  } catch (e) {
    console.error('[queue] clear failed:', e.message);
    return res.status(500).json({ error: 'Could not clear the print queue' });
  }
});

// ── Per-club label templates (#1) — endpoints ─────────────────────────────────
app.get('/config/label-templates', (req, res) => {
  res.json({
    templates: (config.labelTemplates && typeof config.labelTemplates === 'object' && !Array.isArray(config.labelTemplates))
      ? config.labelTemplates : {},
    knownClubs: Object.keys(CLUB_MONOGRAM),
    fields: LABEL_TEMPLATE_BOOLEANS,
  });
});

// Writes are gated on isTrustedConfigOrigin — stricter than the other
// non-secret keys, deliberately: a template changes what gets PRINTED for a
// whole club, and the phone PIN is a LAN-trust credential, not authorization
// to restyle every label. The dashboard and extension options page (both
// loopback) are the only writers.
app.post('/config/label-templates', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'Label templates can only be changed from the dashboard on this computer' });
  }
  const cleaned = sanitizeLabelTemplates((req.body || {}).templates);
  if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });
  try {
    const next = loadConfigFile();
    if (Object.keys(cleaned.value).length === 0) delete next.labelTemplates;
    else next.labelTemplates = cleaned.value;
    writeConfigFile(next);
    applySavedConfig(next);
    console.log('[config] Label templates saved:', Object.keys(cleaned.value).join(', ') || '(none)');
    res.json({ ok: true, templates: cleaned.value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Phone check-in (#17b) ─────────────────────────────────────────────────────
// PIN enforcement for every non-loopback caller now lives in the app-level auth
// gate near the top of the Express setup — one check, applied to every route,
// rather than a per-route opt-in that was easy to forget on a new endpoint (and
// was in fact missing from /stats/tonight, /history and /checkin-csv-export).
//
// The PIN still rides plain HTTP on the venue network, so it remains a
// LAN-trust credential rather than a cryptographic one: it stops a bystander
// reading the roster, not someone who can already sniff the church WiFi.

app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'phone.html'));
});

// The youth leaders' page (7.10.0): the same phone page, Trek and Journey only,
// check-in only. Same PIN, same calls; the filter is the page's own.
const YM_PAGE_FLAGS = "<script>window.AWANA_ONLY_CLUBS = ['trek', 'journey']; window.AWANA_SIMPLE = true;</script>\n";
function ymPhonePage(page, extra = '') {
  return page.replace('<script>\n// ── The touch check-in', `${extra}${YM_PAGE_FLAGS}<script>\n// ── The touch check-in`);
}
app.get('/phone/ym', (req, res) => {
  const page = fs.readFileSync(path.join(__dirname, 'public', 'phone.html'), 'utf8');
  res.type('html').send(ymPhonePage(page));
});

// Every identity key (id: and name:) of a child who came tonight, for the
// phone's roster: the same children the count reads (TwoTimTwo's report when it
// is fresh, so a child checked in at the desk or on TwoTimTwo itself is never
// offered again; 2026-10-08, the youth page listed them), plus this printer's
// own active rows, plus anyone checked out tonight (they came; the 7:15 youth
// check-out must not put Trek and Journey back on the list).
function rosterCheckedInKeys(tonight = tonightCheckins(), now = Date.now()) {
  const keys = new Set();
  tonight.active.forEach((row) => identityKeysOfRow(row).forEach((k) => keys.add(k)));
  tonightHereNow(tonight, now).children.forEach((c) => c.keys.forEach((k) => keys.add(k)));
  if (checkedOutTonight.date === tonight.date) {
    checkedOutTonight.ids.forEach((id) => keys.add(`id:${id}`));
    (checkedOutTonight.names || new Set()).forEach((n) => keys.add(`name:${n}`));
  }
  return keys;
}

// Roster + tonight's checked-in set for the phone page.
app.post('/phone/roster', (req, res) => {
  // PIN already verified by the auth gate for every non-loopback caller.
  clubbers = loadClubbers();
  // Same active set the tally counts (tonightCheckins): an undo made on
  // TwoTimTwo (R-1) or on a phone (Remove) frees the kid for re-check-in here
  // instead of leaving them "checkedIn: true" all night.
  const t = tonightCheckins();
  const nameOf = (e) => normalizedName(`${e.firstName || ''} ${e.lastName || ''}`);
  const checkedIn = rosterCheckedInKeys(t);
  const isIn = (keys) => keys.some((k) => checkedIn.has(k));
  // Kids a phone removed tonight (and who have not been checked in again
  // since) get an "Add back" affordance instead of "Check in": a driven
  // check-in for a kid still on TwoTimTwo would be short-circuited by the
  // station as already-checked-in, printing and counting nothing.
  const removedHere = new Set(
    t.entries.filter(e => e.undone && e.undoneBy === 'phone' && !isIn(identityKeysOfRow(e))).map(nameOf)
  );
  // `inactive` so the phone's Not-here-yet tab can leave former clubbers out
  // of a call list — loadClubbers() returns every row the CSV ever carried, so
  // without this a kid who left the program reads as missing forever. Same
  // idiom as twinDisambiguation(): any non-blank Inactive cell means inactive.
  const kids = clubbers.map(r => {
    const name = `${r.FirstName || ''} ${r.LastName || ''}`.trim();
    const key = normalizedName(name);
    const id = String(r.ClubberID || '').trim();
    return {
      name,
      club: r.Club || '',
      checkedIn: isIn(id ? [`id:${id}`, `name:${key}`] : [`name:${key}`]),
      removedHere: removedHere.has(key),
      inactive: !!String(r.Inactive || '').trim(),
    };
  }).filter(k => k.name);
  // 7.7.0: the touch check-in's families and Bible/Friend clubs (from the
  // laptop's extension) and who came the last two club nights.
  const ctx = loadTouchContext();
  res.json({ kids, households: ctx.households, items: ctx.items, recent: recentAttendance(loadAttendance()) });
});

// The identity a phone request names: `clubberId` when the phone knows it (it
// does not today — the roster it sees is name-keyed — but the shape is ready),
// else first + last. Bounded like every other stored string.
function phoneIdentity(body) {
  const b = body || {};
  let firstName = security.sanitizeStoredText(b.firstName || '', 80);
  let lastName = security.sanitizeStoredText(b.lastName || '', 80);
  if (!firstName && !lastName && b.name) ({ firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name, 160)));
  const clubberId = b.clubberId != null && String(b.clubberId).trim()
    ? security.sanitizeStoredText(String(b.clubberId), 40) : null;
  return { firstName, lastName, clubberId };
}

// Exactly who this server is counting tonight — the same deduped active set the
// lobby-screen tally is built from, so a volunteer can see the number AND the
// names behind it. Each entry is an explicit whitelist, never the raw row:
// rows carry `clubImageData` blobs, and nothing about allergies or birthdays
// belongs on this surface.
app.post('/phone/tonight', (req, res) => {
  const t = tonightCheckins();
  const st = computeTonightStats(t);
  res.json({
    date: t.date,
    checkedIn: st.checkedIn,
    checkedOut: st.checkedOut,
    visitors: st.visitors,
    byClub: st.byClub,
    // 'report' or 'history' — the phone shows the same number the lobby screen
    // does, so it has to be able to say where that number came from. Note the
    // list below is always this printer's own rows: in report mode it can hold
    // an unregistered visitor who is deliberately not in `checkedIn`.
    countSource: st.countSource,
    // What this print server can do from the Tonight list, so the website's
    // phone page (which may be newer than the laptop) offers only that.
    features: ['checkout'],
    entries: t.active.map(e => ({
      key: historyIdentityKey(e),
      firstName: e.firstName || '',
      lastName: e.lastName || '',
      clubName: (e.clubName || '').trim(),
      clubberId: e.clubberId != null ? String(e.clubberId) : null,
      // Checked out tonight (7.15.0; by name for an id-less row, 7.16.0):
      // still listed, off the count, and never offered Check out again.
      checkedOut: checkedOutTonight.date === t.date && (
        (e.clubberId != null && checkedOutTonight.ids.has(String(e.clubberId).trim()))
        || Boolean(checkedOutTonight.names && checkedOutTonight.names.has(normalizedName(`${e.firstName || ''} ${e.lastName || ''}`)))),
      visitor: !!e.visitor,
      at: e.timestamp,
    })),
  });
});

// Remove a child from tonight's count. LOCAL ONLY: history rows are marked
// undone (never deleted — history is the print log), tonight comes out of the
// child's season ledger, and a fresh tally goes out. Nothing is sent to
// TwoTimTwo; the phone page says so, and the volunteer undoes there too if
// the child really left. reconcileHistoryWithReport() respects the `undoneBy`
// marker, so the kid staying on TwoTimTwo's report cannot re-count them.
//
// With `inTwoTimTwo: true` (7.14.0, the phone's "Undo check-in") it is the
// REAL undo instead: queued for the check-in page's extension like a phone
// check-in, and nothing here changes until that extension reports TwoTimTwo's
// own "(checkin undone)" (applyTwoTimTwoUndo, from the result route). It rides
// this route, not a new one, because the website's /checkin page reaches the
// laptop only through the sync service's relay, whose allowlist already
// carries /phone/undo and /phone/status/:id. An older print server ignores
// the flag and Removes; its answer has no `id`, and the phone says so.
app.post('/phone/undo', (req, res) => {
  const ident = phoneIdentity(req.body);
  if (req.body && req.body.checkout === true) return phoneCheckout(ident, res);
  if (req.body && req.body.inTwoTimTwo === true) return queueTwoTimTwoUndo(ident, res);
  if (!ident.firstName && !ident.lastName && !ident.clubberId) {
    return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
  }
  const out = markManualUndo(loadHistory(), ident);
  if (!out.changed) return res.status(404).json({ error: 'Nobody by that name is checked in tonight' });
  saveHistory(out.history);
  stripDayFromLedger(ledgerKeysFor(ident.firstName, ident.lastName, ident.clubberId), localDayISO());
  publishTally();
  console.log(`[phone] Removed from tonight: ${ident.firstName} ${ident.lastName}`.trim());
  const st = computeTonightStats();
  res.json({ ok: true, undone: out.changed, checkedIn: st.checkedIn, byClub: st.byClub });
});

// The phone's "Undo check-in" (7.14.0). TwoTimTwo's undo takes the meeting
// and the clubber id, so a child with no id here (an unregistered visitor, a
// row printed before the roster knew them) can only be Removed. The "Allow
// driven check-ins" switch covers it exactly as it covers a phone check-in.
function queueTwoTimTwoUndo(ident, res) {
  if (!ident.clubberId) {
    return res.status(400).json({ error: 'This child has no TwoTimTwo id on the check-in laptop, so it cannot undo them there. Use Remove, and undo at the desk.' });
  }
  if (config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Undo on TwoTimTwo is turned off with phone check-ins on the check-in laptop (printer dashboard → Settings → "Allow driven check-ins").' });
  }
  prunePendingActions();
  // One undo in flight per child: a double-tap must not post twice.
  const existing = pendingActions.find(a => actionType(a) === 'undo' && a.clubberId === ident.clubberId
    && (a.status === 'pending' || a.status === 'claimed'));
  if (existing) return res.json({ id: existing.id, queued: true });
  const name = `${ident.firstName} ${ident.lastName}`.trim() || `clubber ${ident.clubberId}`;
  const action = {
    id: crypto.randomUUID(),
    type: 'undo',
    name,
    firstName: ident.firstName,
    lastName: ident.lastName,
    clubberId: ident.clubberId,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  pendingActions.push(action);
  console.log(`[phone] Undo queued: ${name}`);
  wakePendingWaiters();
  return res.json({ id: action.id, queued: true });
}

// The phone's "Check out" (7.16.0, owner 2026-10-08). Rides /phone/undo with
// `checkout: true` for the same reason Undo check-in does: the website's
// relay allowlist (lobby/worker/src/relay.js) already carries /phone/undo and
// /phone/status/:id. (An older print server ignores the flag and Removes; the
// phone shows Check out only when /phone/tonight lists 'checkout' in
// `features`, so that cannot happen from a page that knows to look.)
//
// With a clubber id it is TwoTimTwo's own check-out, queued for the check-in
// page's extension as a `{type:'checkout'}` pending action that nothing here
// applies until the extension reports TwoTimTwo's exact "OK"
// (applyTwoTimTwoCheckout). Without one (a visitor, a row printed before the
// roster knew the child) TwoTimTwo has nothing to check out, so it is a LOCAL
// mark, applied at once and said so: off the count and the still-here list,
// nothing sent anywhere.
function phoneCheckout(ident, res) {
  if (!ident.clubberId) {
    if (!ident.firstName && !ident.lastName) {
      return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
    }
    const t = tonightCheckins();
    const name = normalizedName(`${ident.firstName} ${ident.lastName}`);
    const row = t.active.find((e) => normalizedName(`${e.firstName || ''} ${e.lastName || ''}`) === name);
    if (!row) return res.status(404).json({ error: 'Nobody by that name is checked in tonight' });
    // A row that does carry an id goes through TwoTimTwo like any other.
    if (row.clubberId != null && String(row.clubberId).trim()) {
      return phoneCheckout({ ...ident, clubberId: String(row.clubberId).trim() }, res);
    }
    if (markCheckedOut(t.date, [], [name])) publishTally();
    console.log(`[phone] Marked checked out (here only): ${ident.firstName} ${ident.lastName}`.trim());
    const st = computeTonightStats();
    return res.json({ ok: true, checkedOut: true, local: true, checkedIn: st.checkedIn, byClub: st.byClub });
  }
  if (config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Check-out on TwoTimTwo is turned off with phone check-ins on the check-in laptop (printer dashboard → Settings → "Allow driven check-ins").' });
  }
  prunePendingActions();
  const existing = pendingActions.find(a => actionType(a) === 'checkout' && a.clubberId === ident.clubberId
    && (a.status === 'pending' || a.status === 'claimed'));
  if (existing) return res.json({ id: existing.id, queued: true });
  const name = `${ident.firstName} ${ident.lastName}`.trim() || `clubber ${ident.clubberId}`;
  const action = {
    id: crypto.randomUUID(),
    type: 'checkout',
    name,
    firstName: ident.firstName,
    lastName: ident.lastName,
    clubberId: ident.clubberId,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  pendingActions.push(action);
  console.log(`[phone] Check-out queued: ${name}`);
  wakePendingWaiters();
  return res.json({ id: action.id, queued: true });
}

// TwoTimTwo answered "OK": the child is checked out. Off tonight's count (the
// 7.15.0 checked-out set, which the extension also re-posts after every pass,
// so a restart of this server catches up), and off the still-here list, which
// publishTally() republishes. The attendance ledger keeps them: they came.
function applyTwoTimTwoCheckout(action) {
  const changed = markCheckedOut(localDayISO(), [action.clubberId], []);
  publishTally();
  console.log(`[phone] Checked out on TwoTimTwo: ${action.name}`);
  return changed;
}

// TwoTimTwo has undone the check-in, so this laptop does what Remove does: the
// child's rows tonight are marked undone (by 'twotimtwo', so the phone offers
// Check in again, never "Add back", which would count a child TwoTimTwo no
// longer has), tonight leaves their ledger and the screens drop them at once.
// The marker also holds the count down until the next report, which still
// lists the child, is replaced by one that does not.
function applyTwoTimTwoUndo(action) {
  const ident = { firstName: action.firstName || '', lastName: action.lastName || '', clubberId: action.clubberId || null };
  const out = markManualUndo(loadHistory(), ident, Date.now(), 'twotimtwo');
  if (out.changed) saveHistory(out.history);
  try { stripDayFromLedger(ledgerKeysFor(ident.firstName, ident.lastName, ident.clubberId), localDayISO()); } catch { /* ledger trouble never blocks the undo */ }
  publishTally();
  console.log(`[phone] Undone on TwoTimTwo: ${action.name} (${out.changed} row(s) here)`);
  return out.changed;
}

// Reverse a phone Remove ("Add back"). Only rows the phone itself undid are
// eligible — an undo detected from TwoTimTwo's report is TwoTimTwo's truth and
// stays; the way back from that is a real re-check-in.
app.post('/phone/restore', (req, res) => {
  const ident = phoneIdentity(req.body);
  if (!ident.firstName && !ident.lastName && !ident.clubberId) {
    return res.status(400).json({ error: 'firstName/lastName or clubberId is required' });
  }
  const out = clearManualUndo(loadHistory(), ident);
  if (!out.changed) return res.status(404).json({ error: 'Nothing to add back — this child was not removed from a phone' });
  saveHistory(out.history);
  try { recordAttendance(ident.firstName, ident.lastName, ident.clubberId); } catch { /* ledger trouble never blocks the restore */ }
  publishTally();
  console.log(`[phone] Added back to tonight: ${ident.firstName} ${ident.lastName}`.trim());
  const st = computeTonightStats();
  res.json({ ok: true, restored: out.changed, checkedIn: st.checkedIn, byClub: st.byClub });
});

// A first-timer label for someone NOT on the roster, straight from the phone.
// This is the one place the phone prints a check-in label directly, and it is
// safe precisely because the child has no TwoTimTwo row: roster-diff,
// reconcile and the last-check-in observer can never see them, so no second
// label is possible. A roster name is refused (409) — those go through Check
// in, so the door laptop records the real check-in; otherwise the same kid
// would get a name-keyed visitor row AND an id-keyed detection row and count
// twice. Rehearsal mode still yields a TEST label with nothing recorded, and
// the duplicate window inside performCheckinPrint absorbs a double-tap.
app.post('/phone/visitor', async (req, res) => {
  const b = req.body || {};
  const { firstName, lastName } = splitFullName(security.sanitizeStoredText(b.name || '', 160));
  if (!firstName) return res.status(400).json({ error: 'name is required' });
  const clubName = security.sanitizeStoredText(b.clubName || '', 40);
  clubbers = loadClubbers();
  if (findClubber(firstName, lastName)) {
    return res.status(409).json({
      error: `${firstName} ${lastName}`.trim() + ' is on the roster — use Check in instead so the door laptop checks them in.',
    });
  }
  const out = await performCheckinPrint({ firstName, lastName, clubName, visitor: true });
  res.status(out.status).json(out.body);
});

app.post('/phone/checkin', (req, res) => {
  // PIN already verified by the auth gate for every non-loopback caller.
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'name is required' });
  // The dashboard's "Allow driven check-ins" switch. Off, the check-in page
  // never collects these, so a phone used to wait 90 s and hear "the laptop
  // is not answering"; it now hears what is really wrong, at once.
  if (config.enableDrivenCheckin === false) {
    return res.status(409).json({ error: 'Phone check-ins are turned off on the check-in laptop (printer dashboard → Settings → "Allow driven check-ins").' });
  }
  // Bible / Brought a friend from the phone's card (7.7.0): booleans only, and
  // only the two the laptop knows how to tick.
  const o = (req.body && req.body.options) || {};
  const options = {};
  if (typeof o.Bible === 'boolean') options.Bible = o.Bible;
  if (typeof o.Friend === 'boolean') options.Friend = o.Friend;
  prunePendingActions();
  // One pending action per kid — a double-tap must not double-drive.
  const existing = pendingActions.find(a => actionType(a) === 'checkin' && a.name.toLowerCase() === name.toLowerCase() && a.status === 'pending');
  if (existing) return res.json({ id: existing.id, queued: true });
  const action = {
    id: crypto.randomUUID(),
    type: 'checkin',
    name,
    options,
    at: new Date().toISOString(),
    status: 'pending',
    detail: '',
  };
  pendingActions.push(action);
  console.log(`[phone] Check-in queued: ${name}`);
  wakePendingWaiters();
  res.json({ id: action.id, queued: true });
});

// Extension long-poll: returns pending actions immediately if any exist,
// otherwise holds the request up to 25 s waiting for one. `?accept=undo` is
// how a 7.14.0+ extension says it can also undo (see pendingFor).
app.get('/pending-actions', (req, res) => {
  prunePendingActions();
  const accept = typeof req.query.accept === 'string' ? req.query.accept.slice(0, 40) : '';
  const pending = pendingFor(accept);
  if (pending.length || pendingWaiters.length >= PENDING_WAITERS_MAX) {
    return res.json({ actions: pending });
  }
  const waiter = { res, timer: null, accept };
  waiter.timer = setTimeout(() => {
    pendingWaiters = pendingWaiters.filter(w => w !== waiter);
    try { res.json({ actions: [] }); } catch { /* client gone */ }
  }, 25000);
  req.on('close', () => {
    clearTimeout(waiter.timer);
    pendingWaiters = pendingWaiters.filter(w => w !== waiter);
  });
  pendingWaiters.push(waiter);
});

app.post('/pending-actions/:id/claim', (req, res) => {
  prunePendingActions();
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  if (action.status !== 'pending') return res.status(409).json({ error: `already ${action.status}`, status: action.status });
  action.status = 'claimed';
  action.claimedAt = Date.now();
  res.json({ ok: true, leaseMs: PENDING_CLAIM_MS });
});

app.post('/pending-actions/:id/result', (req, res) => {
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  if (isOneShot(action)) {
    // Answered once. A late or repeated result (a second tab, a retry after a
    // timeout) never re-marks the night or flips a reported failure to done.
    if (action.status === 'done' || action.status === 'failed') return res.json({ ok: true, already: action.status });
    // Only a literal true, the extension's verdict on TwoTimTwo's own
    // "(checkin undone)" reply (or, for a check-out, its exact "OK"),
    // changes anything here.
    const ok = !!req.body && req.body.ok === true;
    action.status = ok ? 'done' : 'failed';
    action.detail = String((req.body && req.body.detail) || '').slice(0, 200);
    const co = actionType(action) === 'checkout';
    if (ok) { if (co) applyTwoTimTwoCheckout(action); else applyTwoTimTwoUndo(action); }
    else console.log(`[phone] ${co ? 'Check-out' : 'Undo'} for ${action.name} failed${action.detail ? ' — ' + action.detail : ''}`);
    return res.json({ ok: true });
  }
  action.status = (req.body && req.body.ok) ? 'done' : 'failed';
  action.detail = String((req.body && req.body.detail) || '').slice(0, 200);
  console.log(`[phone] ${action.name}: ${action.status}${action.detail ? ' — ' + action.detail : ''}`);
  res.json({ ok: true });
});

app.get('/phone/status/:id', (req, res) => {
  prunePendingActions();   // so an undo nobody picked up reads as failed, with why
  const action = pendingActions.find(a => a.id === req.params.id);
  if (!action) return res.status(404).json({ error: 'unknown action' });
  res.json({ status: action.status, detail: action.detail });
});

// ── Diagnostics ──────────────────────────────────────────────────────────────
app.get('/diagnostics', async (req, res) => {
  const results = [];

  // 1. Server running
  results.push({ test: 'Server running', passed: true, detail: `v${SERVER_VERSION}, uptime ${Math.round(process.uptime())}s` });

  // 2. Printer detected
  if (process.platform === 'win32') {
    try {
      const raw = (await runPowerShell(['-Command', 'Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
      let parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) parsed = [parsed];
      const target = PRINTER_NAME || parsed.find(p => p.Default)?.Name || '(none)';
      const found = parsed.some(p => p.Name === (PRINTER_NAME || '') || (!PRINTER_NAME && p.Default));
      results.push({ test: 'Printer detected', passed: found, detail: target });
    } catch (e) {
      results.push({ test: 'Printer detected', passed: false, detail: e.message });
    }
  } else {
    results.push({ test: 'Printer detected', passed: false, detail: 'Not on Windows' });
  }

  // 3. CSV loaded
  const csvPath = CSV_FILE;
  const csvExists = fs.existsSync(csvPath);
  const csvCount = csvExists ? parseCSV(fs.readFileSync(csvPath, 'utf8')).length : 0;
  results.push({ test: 'CSV loaded', passed: csvExists && csvCount > 0, detail: csvExists ? `${csvCount} clubbers` : 'File not found' });

  // 4. Can render test label
  try {
    const testResult = await generateLabel({ firstName: 'Test', lastName: 'Child', clubName: '' });
    fs.unlink(testResult.pngPath, () => {});
    results.push({ test: 'Label rendering', passed: true, detail: `${testResult.buffer.length} bytes` });
  } catch (e) {
    results.push({ test: 'Label rendering', passed: false, detail: e.message });
  }

  res.json(results);
});

// ── Error handling middleware ─────────────────────────────────────────────────
// Registered after all routes. Malformed JSON bodies used to surface as the
// default Express HTML stack trace; return clean JSON the clients can parse.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')) {
    return res.status(400).json({ error: 'Invalid or oversized JSON body' });
  }
  console.error('[http] Unhandled route error:', err && err.message);
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

// ── Start up ──────────────────────────────────────────────────────────────────
// The full server is also requireable (#16): the Electron app requires this
// module and calls startListening() so its users get the whole feature set —
// roster enrichment, dedup, history, Pusher, phone check-in. A bare `require`
// has ZERO side effects — no port bind, no timers, no network. Everything the
// running server needs (temp-file sweep, roster load, publish timers, birthday
// push, prewarm) happens inside startListening(); only the legacy VERSION-poll
// self-update stays in the require.main block, because the Electron shell owns
// updates itself via setUpdateHandler()/setLatestVersion().

// Pre-warm: send a blank label to the printer to eliminate cold-start delay.
// Off by default — enable via config.json { "prewarmPrinter": true }
function prewarmPrinterIfConfigured() {
  try {
    const prewarmConfig = loadConfigFile();
    if (prewarmConfig.prewarmPrinter) {
      setTimeout(async () => {
        try {
          console.log('[prewarm] Sending blank label to printer...');
          const result = await generateLabel({ firstName: ' ', lastName: ' ', clubName: '' });
          await printImage(result.pngPath, PRINTER_NAME);
          fs.unlink(result.pngPath, () => {});
          console.log('[prewarm] Done');
        } catch (e) {
          console.log('[prewarm] Failed (non-critical):', e.message);
        }
      }, 5000);
    }
  } catch (e) { /* config parse error — ignore */ }
}

// Bind the port with retry: during updates, install-and-run.ps1 (or a
// just-killed previous instance) can hold port 3456 for a few seconds.
// Previously an EADDRINUSE here killed the process with no usable message.
const LISTEN_MAX_ATTEMPTS = 5;
// The Electron shell calls startListening() again every time settings are
// saved (it restarts the server to pick up a new printer). Without this latch
// each save stacked another set of publish intervals on the same process, so
// after a few visits to Settings the event bus fired tally/recap/birthday
// publishes N times a tick — and re-ran the prewarm blank print each time.
let startupTasksDone = false;
// ── What changed (#6) ─────────────────────────────────────────────────────────
// The release notes already exist — changes.md is written for every version —
// so the "what's new" panel parses that file rather than inventing a second
// changelog. changes.md ships in the packaged app (extraResources), and the
// same relative path resolves in dev (repo root) and packaged (resources/)
// because the server dir sits one level below both.
const CHANGES_FILE = path.join(__dirname, '..', 'changes.md');

// Pure: first `## [X.Y.Z] - date` heading and its body up to the next `## `.
function parseLatestChangeEntry(markdown) {
  if (typeof markdown !== 'string' || !markdown) return null;
  const text = markdown.replace(/^\uFEFF/, '');
  const m = text.match(/^## \[(\d+\.\d+\.\d+)\] - (\S+)\s*\n/m);
  if (!m) return null;
  const start = m.index + m[0].length;
  const next = text.indexOf('\n## [', start);
  const body = text.slice(start, next === -1 ? undefined : next).trim();
  return { version: m[1], date: m[2], body };
}

let cachedChangeEntry;
function latestChangeEntry() {
  if (cachedChangeEntry !== undefined) return cachedChangeEntry;
  try {
    cachedChangeEntry = parseLatestChangeEntry(fs.readFileSync(CHANGES_FILE, 'utf8'));
  } catch {
    cachedChangeEntry = null; // changes.md not shipped/readable — panel hides itself
  }
  return cachedChangeEntry;
}

app.get('/whats-new', (req, res) => {
  const entry = latestChangeEntry();
  if (!entry) return res.status(404).json({ error: 'no release notes available' });
  res.json(entry);
});

// ── Update health beacon (#5, opt-in) ────────────────────────────────────────
// After an auto-update, the operator has no confirmation the new build came
// back cleanly until they walk to the laptop. When config.updateBeacon is on,
// the first boot of a NEW version publishes ops {type:'update-ok', version} —
// version + ok flag only, nothing else rides it. The last-booted version is
// recorded on EVERY boot regardless of the setting, so turning the beacon on
// later never fires a stale beacon for an update that happened weeks ago.
const LAST_BOOT_VERSION_FILE = path.join(DATA_DIR, 'last-boot-version.json');

function shouldSendUpdateBeacon(prevVersion, currentVersion, enabled) {
  if (enabled !== true) return false;
  if (!prevVersion || typeof prevVersion !== 'string') return false; // first-ever boot is not an update
  return prevVersion !== currentVersion;
}

function recordBootVersionAndMaybeBeacon() {
  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(LAST_BOOT_VERSION_FILE, 'utf8')).version || null;
  } catch { /* first boot, or unreadable — treated as no previous version */ }
  try {
    fs.writeFileSync(LAST_BOOT_VERSION_FILE, JSON.stringify({ version: SERVER_VERSION, at: new Date().toISOString() }));
  } catch (e) { console.warn('[update-beacon] Could not record boot version:', e.message); }
  // What changed (#6): the tray half. A LOCAL notification on the first boot
  // of a new version — independent of the opt-in beacon above, which gates
  // only the PUBLIC event. Once per version by construction (prev is
  // rewritten before this runs).
  if (prev && typeof prev === 'string' && prev !== SERVER_VERSION) {
    const entry = latestChangeEntry();
    const firstLine = entry ? String(entry.body).split('\n', 1)[0].slice(0, 180) : '';
    fireOpsAlert('Club Label Printer updated to v' + SERVER_VERSION,
      firstLine || 'See the dashboard\u2019s "What\u2019s new" panel for details.');
  }
  if (shouldSendUpdateBeacon(prev, SERVER_VERSION, config.updateBeacon === true)) {
    console.log(`[update-beacon] Updated ${prev} → ${SERVER_VERSION} and came back cleanly — publishing ops update-ok`);
    try {
      events.publish(pusher, EVENT_CHANNEL, 'ops', events.buildOps('update-ok', null, { version: SERVER_VERSION }));
    } catch (e) { console.warn('[update-beacon] publish skipped:', e.message); }
  }
}

// The server that is actually bound, whichever listen attempt it came from.
// startListening() returns the FIRST attempt's server, as it always did (the
// tests wait on its 'listening' event), but a retry after EADDRINUSE makes a
// new one, which the Electron shell never saw: it held the dead first object,
// said "running", and closing it left the live one bound (so a restart hit
// EADDRINUSE itself, five times, and gave up). The shell now waits on
// `.ready` (resolves with the live server once any attempt binds, rejects
// after the last fails) and stops the server with stopListening().
let liveServer = null;
/** @type {{ resolve: Function, reject: Function } | null} */
let listenWaiter = null;

function stopListening() {
  const s = liveServer;
  liveServer = null;
  if (listenWaiter) { listenWaiter.reject(new Error('stopped before it was listening')); listenWaiter = null; }
  return new Promise((resolve) => { if (!s) return resolve(); s.close(() => resolve()); });
}

function startListening(attempt = 1) {
  if (attempt === 1 && !startupTasksDone) {
    startupTasksDone = true;
    // One-time startup work (skipped on EADDRINUSE retries and restarts).
    // Clean up any temp files a crashed previous run left behind.
    sweepOrphanedTempFiles();
    // Load clubbers before accepting requests so the first print has data ready.
    clubbers = loadClubbers();
    startClubNightTimers();
    // Publish the birthday roster once at startup so displays that boot before
    // the first club-night interval still get the list. Delayed a few seconds
    // so the CSV is loaded and Pusher has settled.
    setTimeout(() => { try { publishBirthdays(); } catch (e) { /* ignore */ } }, 5000);
    prewarmPrinterIfConfigured();
    // Update health beacon (#5): delayed so config.json is loaded and the
    // Pusher client has settled — same reasoning as the birthday publish.
    setTimeout(() => { try { recordBootVersionAndMaybeBeacon(); } catch (e) { /* never blocks boot */ } }, 4000);
    // The phone check-in relay (7.9.0): awana.kvbchurch.org/checkin's requests,
    // collected from the sync service and run here, while signed in to it.
    phoneRelay.startPhoneRelay({
      signedIn: () => (signedInToSync() ? { base: config.syncUrl, session: config.syncSession } : null),
      localBase: `http://127.0.0.1:${PORT}`,
      syncRequest: syncClient.syncRequest,
      log: (m) => console.log(m),
      setTimeoutFn: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
    });
  }
  // Bind loopback-only unless the operator has explicitly enabled LAN access
  // AND set a PIN. Previously this was a bare app.listen(PORT), which binds
  // every interface — so the roster, the check-in history and the allergy list
  // were readable by anything on the church WiFi.
  const bind = security.resolveBindHost({
    lanAccess: config.lanAccess === true,
    hasPin: security.isAcceptablePin(config.phonePin),
    envHost: process.env.AWANA_BIND_HOST,
  });
  let ready = null;
  if (attempt === 1) {
    ready = new Promise((resolve, reject) => { listenWaiter = { resolve, reject }; });
    ready.catch(() => {});   // a shell that does not await it must not see an unhandled rejection
  }
  const server = app.listen(PORT, bind.host, () => {
    liveServer = server;
    if (listenWaiter) { listenWaiter.resolve(server); listenWaiter = null; }
    console.log(`\n  Club Print Server v${SERVER_VERSION}  •  http://localhost:${PORT}`);
    console.log(`  Dashboard : http://localhost:${PORT}/`);
    console.log(`  Printer   : ${PRINTER_NAME || '(system default)'}`);
    console.log(`  Network   : bound to ${bind.host} — ${bind.reason}`);
    if (bind.lan) {
      console.log('              Phone check-in is reachable on this network; every');
      console.log('              request from it must carry the PIN.');
    } else if (config.lanAccess === true) {
      console.log('              LAN access is ON in settings but no PIN is set, so the');
      console.log('              server stayed loopback-only. Set a PIN and restart.');
    }
    console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < LISTEN_MAX_ATTEMPTS) {
      const delay = 2000 * attempt;
      console.warn(`[startup] Port ${PORT} is in use — retrying in ${delay / 1000}s (attempt ${attempt}/${LISTEN_MAX_ATTEMPTS})`);
      setTimeout(() => startListening(attempt + 1), delay);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[startup] Port ${PORT} is still in use after ${LISTEN_MAX_ATTEMPTS} attempts.`);
      console.error('[startup] Another print server is likely running — close it and restart, or reboot the machine.');
      if (listenWaiter) { listenWaiter.reject(new Error(`Port ${PORT} is still in use after ${LISTEN_MAX_ATTEMPTS} attempts. Another print server is likely running: close it and restart, or reboot the machine.`)); listenWaiter = null; }
    } else {
      console.error('[startup] Server error:', err.message);
      if (listenWaiter) { listenWaiter.reject(err); listenWaiter = null; }
    }
  });
  if (ready) server.ready = ready;
  return server;
}

module.exports = {
  app, startListening, stopListening, resetRelayForTest, setUpdateHandler, setLatestVersion, setExtensionInfo, setOpsAlertHandler,
  // For the Electron shell: this module is require-cached across settings
  // saves, so the shell pushes the freshly merged config.json and printer
  // name into the LIVE module instead of relying on load-time state.
  applySavedConfig, setPrinterName,
  // Pure helpers exported for scripts/test-server-helpers.cjs — they carry
  // the assumptions about TwoTimTwo's real /clubber/csv export format.
  parseCSV, normalizeHeader, findClubberIn, parseNoPhoto, noPhotoFor,
  lateGoToLine, scheduleRowFor, DEFAULT_SCHEDULE, recentAttendance,
  parseYesRelease, rosterConsentSummary, consentWarningFor,
  isSafePrinterName,
  parseAllergies, recapEntriesForTonight, calendarDaysBetween, isNewerVersion, historyClubImage,
  historyRowMatches, historyIdentityKey, distinctChildrenPrintedToday,
  reconcileHistoryWithReport, reportEntryIdentityKey, computeTonightStats,
  // "Is our count right?" — the pure comparison against TwoTimTwo's own
  // per-club numbers, plus our side of it. Exported so every direction
  // (short, over, explained by walk-ins, stale, no source) is unit-tested
  // without a browser or a live report.
  compareCounts, countsForCompare, SOURCE_COUNT_STALE_MS,
  // Tonight's count. authoritativeTonight() is THE definition every surface
  // reads; the setter exists so a test can put the server in report mode (and
  // in stale-report mode) without a scrape, a socket or a wall-clock wait.
  authoritativeTonight, tonightHereNow, stillHereEntries, publishStillHere, REPORT_FRESH_MS, TALLY_GRACE_MIN, TALLY_LEAD_MIN,
  _setLastCheckinReportForTests(report) { lastCheckinReport = report; },
  _setStillHereWindowForTests(fn) { stillHereWindowForTests = fn; },
  _setCheckedOutForTests(date, ids, names) { checkedOutTonight = { date, ids: new Set(ids), names: new Set((names || []).map(normalizedName)) }; },
  _getLastCheckinReportForTests() { return lastCheckinReport; },
  // Attendance audit (#311) — the diff is PURE so "unknown is not zero" and
  // "additive only" are exhaustively testable without a browser or a scrape.
  auditAttendance, ATTENDANCE_GRID_STALE_MS,
  // Trophy band (#293) — pure, so the 48-character clip and the malformed-title
  // cases are pinned without rendering a label.
  trophyBandFor, TROPHY_BAND_MAX,
  // Phone Tonight tab: the shared "who is checked in" set and the manual
  // undo/restore that must survive reconcile — pure, so they are unit-tested.
  tonightCheckins, markManualUndo, clearManualUndo, splitFullName,
  // The duplicate-print window, exported so a test that has to wait it out
  // reads the real number instead of a copy that drifts (it was 25s while the
  // extension's own client timeout was 35s, which is the bug it now outlasts).
  DUPLICATE_WINDOW_MS,
  shouldSendUpdateBeacon, parseLatestChangeEntry, extensionSkew,
  // Attendance ledger — exported so the id-migration and the auto-connect-card
  // signals (firstEver / priorNightExists) can be unit-tested against a temp
  // AWANA_DATA_DIR without driving the whole /print route.
  recordAttendance, isNonCheckinRow,
  // Range reprint (#257) — the selector is pure, so every exclusion rule
  // (awards, leader tags, failed rows, undone rows, the club filter, the
  // newest-row-per-child dedupe and the cap) is testable without printing.
  selectReprintRange, REPRINT_RANGE_MAX, REPRINT_RANGE_GAP_MS, sanitizeTouchContext,
  dropOffTagFor, generateDropOffTag, performOneOffPrint, oneOffClub,
  localDayISO, historyIdentityKey, clubKey,
  // Remembered leaders + the one club list every dropdown reads. Pure but for
  // their file, so the upsert/cap/season rules and the club-table agreement
  // are unit-tested against a temp AWANA_DATA_DIR.
  loadLeaders, saveLeaders, rememberLeader, forgetLeader, activeLeaders, leaderKey,
  // Free-text labels (POST /print-custom). The validator is pure, so every
  // rejection (blank, too long, control characters) is pinned without a
  // printer; the sizing helpers are pure too, so the wrap/shrink order is
  // testable without reading pixels.
  normalizeCustomText, splitCustomTextInTwo, CUSTOM_TEXT_MAX_CHARS,
  CLUB_LIST, CLUB_DISPLAY_NAMES, CLUB_MONOGRAM, LEADERS_MAX, LEADER_ACTIVE_DAYS,
  // Birthday/cake helpers — the half-birthday rule (#8) has date math worth
  // pinning (June–August gate, day clamping, ISO-week reuse).
  parseBirthdate, isBirthdayWeek, isHalfBirthdayWeek, isCakeWeek, birthdayAgeThisWeek,
  // Twin-safe labels (#13) — collision detection + hint preference order.
  twinDisambiguation,
  // Screen season (#16/#18) — the computus and the calendar tiling are date
  // math worth pinning; SEASON_KEYS doubles as the dashboard's option list.
  easterSunday, seasonForDate, SEASON_KEYS, currentScreenSeason,
  // Musical printer (#11/#12) — the TSPL compiler is the testable artifact.
  buildTuneTspl, nextTuneName, TUNE_NAMES, TUNE_ROTATION,
  // The dispatcher every label print goes through (with its backup printer).
  printLabel, printerFallbackWarnings, backupPrinter, RETIRED_PRINTER_KEYS, printerSetupWarnings,
  // Spooler backlog (#256). The verdict and both parsers are PURE so the one
  // piece of judgement here is exhaustively testable on a machine with no
  // Windows spooler at all — which is every CI runner this repo has.
  summarizeSpoolerJobs, spoolerBacklogMessage, parseClearQueueResult,
  SPOOLER_BACKLOG_JOBS, SPOOLER_STUCK_MS,
  // Exported for the golden-image suite (scripts/test-label-golden.cjs), which
  // has to render field combinations GET /preview cannot express — a visitor
  // with allergies, a step-up night, an all-fields-on torture case. Going
  // through HTTP would also make every baseline depend on the route's defaults
  // rather than on the renderer itself.
  generateLabel,
  // The label's type helpers (the kit voices over the old fonts), so the golden
  // suite can pin how a line of mixed faces is laid out on a canvas of its own,
  // in checks that do not depend on the host's fonts.
  labelType,
  // The thermal-logo pipeline and the group-line policy, exported so tests can
  // exercise them directly: prepareLogoForThermal against synthetic light-ink /
  // padded / blank images, effectiveHandbookGroup against TwoTimTwo's real
  // pseudo-group values ("all", "Puggles group").
  prepareLogoForThermal, effectiveHandbookGroup,
  // The security policy itself is tested through print-server/security.js;
  // re-exported here so a test can assert the server wires up the same module.
  security,
};

if (require.main === module) {
  startListening();
  // Legacy self-update: poll the repo VERSION file so /update-now + exit 99
  // can hand off to launch-awana.bat. The Electron shell does NOT get this —
  // electron-updater owns its update lifecycle (see setUpdateHandler above).
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL);
}
