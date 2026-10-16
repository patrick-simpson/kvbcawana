'use strict';
// Start up, what changed, update beacon, listen and stop.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const fs    = require('fs');
const path  = require('path');
const SERVER_DIR = path.join(__dirname, '..'); // print-server/, where server.js lives
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $images = lazy('./images');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $http = lazy('./http');
const $publishers = lazy('./publishers');
const $relay = lazy('./relay');
const $station = lazy('./station');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  parseLatestChangeEntry: { enumerable: true, get: () => parseLatestChangeEntry },
  shouldSendUpdateBeacon: { enumerable: true, get: () => shouldSendUpdateBeacon },
  startListening: { enumerable: true, get: () => startListening },
  stopListening: { enumerable: true, get: () => stopListening },
});

// ── Start up ──────────────────────────────────────────────────────────────────
// The full server is also requireable (#16): the Electron app requires this
// module and calls startListening() so its users get the whole feature set —
// roster enrichment, dedup, history, the relay, phone check-in. A bare `require`
// has ZERO side effects — no port bind, no timers, no network. Everything the
// running server needs (temp-file sweep, roster load, publish timers, birthday
// push, prewarm) happens inside startListening(); only the legacy VERSION-poll
// self-update stays in the require.main block, because the Electron shell owns
// updates itself and reports it via setLatestVersion().

// Pre-warm: send a blank label to the printer to eliminate cold-start delay.
// Off by default — enable via config.json { "prewarmPrinter": true }
function prewarmPrinterIfConfigured() {
  try {
    const prewarmConfig = $config.loadConfigFile();
    if (prewarmConfig.prewarmPrinter) {
      setTimeout(async () => {
        try {
          console.log('[prewarm] Sending blank label to printer...');
          const result = await $labelRender.generateLabel({ firstName: ' ', lastName: ' ', clubName: '' });
          await $printing.printImage(result.pngPath, $config.PRINTER_NAME);
          fs.unlink(result.pngPath, () => {});
          console.log('[prewarm] Done');
        } catch (e) {
          console.log('[prewarm] Failed (non-critical):', e.message);
        }
      }, 5000);
    }
  } catch (e) { /* config parse error — ignore */ }
}

// Bind the port with retry: during updates a just-killed previous instance
// can hold port 3456 for a few seconds.
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
const CHANGES_FILE = path.join(SERVER_DIR, '..', 'changes.md');

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
const LAST_BOOT_VERSION_FILE = path.join($config.DATA_DIR, 'last-boot-version.json');

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
    fs.writeFileSync(LAST_BOOT_VERSION_FILE, JSON.stringify({ version: $config.SERVER_VERSION, at: new Date().toISOString() }));
  } catch (e) { console.warn('[update-beacon] Could not record boot version:', e.message); }
  // What changed (#6): the tray half. A LOCAL notification on the first boot
  // of a new version — independent of the opt-in beacon above, which gates
  // only the PUBLIC event. Once per version by construction (prev is
  // rewritten before this runs).
  if (prev && typeof prev === 'string' && prev !== $config.SERVER_VERSION) {
    const entry = latestChangeEntry();
    const firstLine = entry ? String(entry.body).split('\n', 1)[0].slice(0, 180) : '';
    $eventBuffer.fireOpsAlert('Club Label Printer updated to v' + $config.SERVER_VERSION,
      firstLine || 'See the dashboard\u2019s "What\u2019s new" panel for details.');
  }
  if (shouldSendUpdateBeacon(prev, $config.SERVER_VERSION, $config.config.updateBeacon === true)) {
    console.log(`[update-beacon] Updated ${prev} → ${$config.SERVER_VERSION} and came back cleanly — publishing ops update-ok`);
    try {
      events.publish($config.EVENT_CHANNEL, 'ops', events.buildOps('update-ok', null, { version: $config.SERVER_VERSION }));
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
  // The warm print helper goes too (a label it is printing finishes first); the next
  // label after a restart starts a new one.
  $printing.printHelper.stop();
  return new Promise((resolve) => { if (!s) return resolve(); s.close(() => resolve()); });
}

function startListening(attempt = 1) {
  if (attempt === 1 && !startupTasksDone) {
    startupTasksDone = true;
    // One-time startup work (skipped on EADDRINUSE retries and restarts).
    // Clean up any temp files a crashed previous run left behind.
    $images.sweepOrphanedTempFiles();
    // The warm print helper starts now, in the background, so the night's first labels
    // find it ready; until it is, labels print the old way (print-helper.js waitReadyMs).
    try { $printing.printHelper.warm(); } catch { /* the old way still prints */ }
    // Load clubbers before accepting requests so the first print has data ready.
    $clubbers.clubbers = $clubbers.loadClubbers();
    $station.startClubNightTimers();
    // Publish the birthday roster once at startup so displays that boot before
    // the first club-night interval still get the list. Delayed a few seconds
    // so the CSV is loaded.
    setTimeout(() => { try { $publishers.publishBirthdays(); } catch (e) { /* ignore */ } }, 5000);
    prewarmPrinterIfConfigured();
    // Update health beacon (#5): delayed so config.json is loaded and the
    // relay has settled — same reasoning as the birthday publish.
    setTimeout(() => { try { recordBootVersionAndMaybeBeacon(); } catch (e) { /* never blocks boot */ } }, 4000);
    // The church-wide settings from the sync Worker (church-sync.js): waits for the
    // sync sign-in, then keeps config.json in step. Never in a print's way.
    $station.startChurchSync();
  }
  // Loopback only, always (Online only, 2026-10-12): the roster, the check-in
  // history and the allergy list never listen on the church Wi-Fi.
  const bindHost = '127.0.0.1';
  let ready = null;
  if (attempt === 1) {
    ready = new Promise((resolve, reject) => { listenWaiter = { resolve, reject }; });
    ready.catch(() => {});   // a shell that does not await it must not see an unhandled rejection
  }
  const server = app.listen($config.PORT, bindHost, () => {
    liveServer = server;
    if (listenWaiter) { listenWaiter.resolve(server); listenWaiter = null; }
    console.log(`\n  Club Print Server v${$config.SERVER_VERSION}  •  http://localhost:${$config.PORT}`);
    console.log(`  Settings  : ${$http.SETTINGS_URL} (open it on this computer)`);
    console.log(`  Printer   : ${$config.PRINTER_NAME || '(system default)'}`);
    console.log(`  Network   : bound to ${bindHost} (this computer only)`);
    console.log('  Waiting for check-ins. Press Ctrl+C to stop.\n');
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < LISTEN_MAX_ATTEMPTS) {
      const delay = 2000 * attempt;
      console.warn(`[startup] Port ${$config.PORT} is in use — retrying in ${delay / 1000}s (attempt ${attempt}/${LISTEN_MAX_ATTEMPTS})`);
      setTimeout(() => startListening(attempt + 1), delay);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[startup] Port ${$config.PORT} is still in use after ${LISTEN_MAX_ATTEMPTS} attempts.`);
      console.error('[startup] Another print server is likely running — close it and restart, or reboot the machine.');
      if (listenWaiter) { listenWaiter.reject(new Error(`Port ${$config.PORT} is still in use after ${LISTEN_MAX_ATTEMPTS} attempts. Another print server is likely running: close it and restart, or reboot the machine.`)); listenWaiter = null; }
    } else {
      console.error('[startup] Server error:', err.message);
      if (listenWaiter) { listenWaiter.reject(err); listenWaiter = null; }
    }
  });
  if (ready) server.ready = ready;
  return server;
}
