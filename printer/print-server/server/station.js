'use strict';
// Online check-in P2: this computer as a print station.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const cloudRequest = require('../cloud-request');
const jobPuller = require('../job-puller');
const historySync = require('../history-sync');
const churchSyncModule = require('../church-sync');
const pickup = require('../pickup');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $eligibility = lazy('./eligibility');
const $ledger = lazy('./ledger');
const $http = lazy('./http');
const $history = lazy('./history');
const $publishers = lazy('./publishers');
const $relay = lazy('./relay');
const $spooler = lazy('./spooler');
const $configRoutes = lazy('./config-routes');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  churchSync: { enumerable: true, get: () => churchSyncInstance() },
  clearCheckThePrinter: { enumerable: true, get: () => clearCheckThePrinter },
  cloudStatus: { enumerable: true, get: () => cloudStatus },
  configureCloud: { enumerable: true, get: () => configureCloud },
  importLaptopHistory: { enumerable: true, get: () => importLaptopHistory },
  mergeAttendance: { enumerable: true, get: () => mergeAttendance },
  sendStationExtras: { enumerable: true, get: () => sendStationExtras },
  singlePublisherSilent: { enumerable: true, get: () => singlePublisherSilent },
  startChurchSync: { enumerable: true, get: () => startChurchSync },
  startClubNightTimers: { enumerable: true, get: () => startClubNightTimers },
  stopChurchSync: { enumerable: true, get: () => stopChurchSync },
  stopCloud: { enumerable: true, get: () => stopCloud },
  ymHandedOff: { enumerable: true, get: () => ymHandedOff },
});

// ── Online check-in, P2: this computer as a print STATION ───────────────────
// The app (electron-app/main.js) makes the station key, registers it and calls
// configureCloud() once safeStorage holds it; from then on this print server
//   * takes ALL its print jobs from the Worker (job-puller.js) and runs them
//     through the print routes above, from loopback, at most once each;
//   * pulls the sealed roster and completed books (update-csv and
//     /feed/completed-books are the paths it feeds);
//   * reads the season's attendance from the sealed history (history-sync.js)
//     into the ledger above, and seals a history row for a job that came from a
//     TwoTimTwo-page check-in;
//   * stops publishing the tally and the pickup list itself (cloudStation set:
//     publishTally / publishStillHere are inert, the Worker publishes).
// Every old path (the extension, the phone relay's job route) keeps working.
const CLOUD_ATTENDANCE_MS = 30 * 60 * 1000;
let cloudStop = null;
let cloudImporting = false;

/** Add nights from sealed history to the attendance ledger (additive, like the audit's apply). */
function mergeAttendance(entries) {
  const today = $eventBuffer.localDayISO();
  const ledger = $ledger.loadAttendance();
  let changed = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const dates = (e && Array.isArray(e.dates) ? e.dates : []).filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today);
    if (!dates.length) continue;
    const idKey = e.clubberId != null && String(e.clubberId).trim() ? `id:${String(e.clubberId).trim().toLowerCase()}` : '';
    const nameKey = String(e.name || '').toLowerCase().trim();
    const key = idKey || nameKey;
    if (!key) continue;
    if (idKey && nameKey && ledger[nameKey] && Array.isArray(ledger[nameKey].dates)) {
      // The legacy name key moves to the id key, as recordAttendance does.
      if (!ledger[idKey] || !Array.isArray(ledger[idKey].dates)) ledger[idKey] = ledger[nameKey];
      else for (const d of ledger[nameKey].dates) if (!ledger[idKey].dates.includes(d)) ledger[idKey].dates.push(d);
      delete ledger[nameKey];
    }
    const entry = ledger[key] && Array.isArray(ledger[key].dates) ? ledger[key] : { name: String(e.name || '').trim(), dates: [] };
    let added = false;
    for (const d of dates) if (!entry.dates.includes(d)) { entry.dates.push(d); added = true; }
    if (added) { entry.dates.sort(); ledger[key] = entry; changed++; }
  }
  if (changed) $ledger.saveAttendance(ledger);
  return changed;
}

// P5, the one publisher (lobby/worker/src/routes.md section 8): the Worker makes the tally, the
// ticker and the still-here list, but three of their inputs live only in this computer's config:
// the Screen season and rehearsal flag that ride the tally, and the clubs on the pickup list.
// Plaintext, non-personal; sent when one changes and at least once a minute.
const STATION_EXTRAS_EVERY_MS = 60 * 1000;
let stationExtrasSig = null;
let stationExtrasAt = 0;
let stationExtrasBusy = false;

/** The settings this computer tells the Worker. */
function stationExtrasBody() {
  return { season: $eligibility.currentScreenSeason(), rehearsal: $configRoutes.isRehearsalActive(), pickupClubs: pickup.pickupClubsOf($config.config) };
}

/** @returns {Promise<boolean>} whether the Worker has the current settings */
async function sendStationExtras(force = false) {
  if (!$config.cloudStation || stationExtrasBusy) return false;
  const body = stationExtrasBody();
  const sig = JSON.stringify(body);
  const now = Date.now();
  if (!force && sig === stationExtrasSig && now - stationExtrasAt < STATION_EXTRAS_EVERY_MS) return true;
  const where = $config.cloudStation.signedIn();
  if (!where) return false;
  stationExtrasBusy = true;
  try {
    const r = await $config.cloudStation.request(where.base, '/v1/station/extras', {
      method: 'POST', body, session: where.session, station: $config.cloudStation.stationIdFn(),
    });
    if (r.ok) { stationExtrasSig = sig; stationExtrasAt = now; }
    return !!r.ok;
  } catch { return false; } finally { stationExtrasBusy = false; }
}

function stopCloud() {
  stationExtrasSig = null;
  stationExtrasAt = 0;
  if (cloudStop) { try { cloudStop(); } catch { /* best effort */ } }
  cloudStop = null;
  $config.cloudStation = null;
}

/**
 * @param {{
 *   stationId: string, ring: () => Promise<any>, historyRing?: () => Promise<any>, historyPub?: () => (string|null),
 *   request?: Function, fetchFn?: typeof fetch, localBase?: string, journalFile?: string|null,
 *   now?: () => number, start?: boolean, heartbeatMs?: number,
 * }} opts
 */
function configureCloud(opts) {
  stopCloud();
  if (!opts || typeof opts.ring !== 'function' || typeof opts.stationId !== 'string' || !opts.stationId) {
    return { ok: false, error: 'a station needs its id and its key ring' };
  }
  const log = (m) => console.log(m);
  const signedIn = () => ($relay.signedInToSync() ? { base: $config.config.syncUrl, session: $config.config.syncSession } : null);
  const request = opts.request || cloudRequest.cloudRequest;
  const stationId = () => opts.stationId;
  const localBase = opts.localBase || `http://127.0.0.1:${$config.PORT}`;
  const journal = jobPuller.createJournal(opts.journalFile === undefined ? path.join($config.DATA_DIR, 'print-journal.json') : opts.journalFile, opts.now);
  const writer = historySync.createHistoryWriter({ pub: opts.historyPub || (() => null), signedIn, request, stationId, log, now: opts.now });
  const puller = jobPuller.createJobPuller({
    signedIn, stationId, ring: opts.ring, localBase, request, journal, fetchFn: opts.fetchFn, now: opts.now, log, heartbeatMs: opts.heartbeatMs,
    // The lease says when the church settings or the switches moved (routes.md 10.3).
    onChurch: (rev, switchesRev) => churchSyncInstance().onChurch(rev, switchesRev),
    heartbeatExtras: () => ({ version: $config.SERVER_VERSION, churchRev: churchSyncInstance().appliedRev() }),
    // A check-in made on TwoTimTwo's own page: the Worker cannot seal a history
    // row for it, so the station that prints it does.
    onPrinted: async (info) => {
      const row = historySync.rowForPrinted(info, opts.now);
      if (row) await writer.record(row.kind, row.record, row.night, row.summary);
    },
  });
  const bundles = jobPuller.createBundleSync({ signedIn, stationId, ring: opts.ring, localBase, request, fetchFn: opts.fetchFn, now: opts.now, log });
  const attendance = historySync.createAttendanceReader({
    historyRing: opts.historyRing || (async () => null), signedIn, request, stationId, merge: mergeAttendance, log, now: opts.now,
  });
  $config.cloudStation = { stationId: opts.stationId, puller, bundles, writer, attendance, journal, opts, signedIn, request, stationIdFn: stationId };
  if (opts.start !== false) {
    const unref = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; };
    const stopPull = jobPuller.startJobPuller({ puller, bundles, log, setTimeoutFn: unref });
    const readAttendance = () => attendance.syncOnce().catch(() => {});
    const first = setTimeout(readAttendance, 20 * 1000);
    const every = setInterval(() => { readAttendance(); writer.flush().catch(() => {}); }, CLOUD_ATTENDANCE_MS);
    const extrasFirst = setTimeout(() => { sendStationExtras(true).catch(() => {}); }, 5 * 1000);
    const extrasEvery = setInterval(() => { sendStationExtras().catch(() => {}); }, STATION_EXTRAS_EVERY_MS);
    for (const t of [first, every, extrasFirst, extrasEvery]) if (t.unref) t.unref();
    cloudStop = () => { stopPull(); clearTimeout(first); clearInterval(every); clearTimeout(extrasFirst); clearInterval(extrasEvery); };
  }
  console.log(`[station] This computer is print station ${opts.stationId}: print jobs come from the service; the tally and pickup list are the service's to publish.`);
  return { ok: true };
}

// ── The church settings and the Worker's switches (docs/SETTINGS-OVERHAUL.md section 4) ──
// Every signed-in print server, station or not, keeps its config.json in step with the
// church-wide settings the Worker holds (church-sync.js). Fail open: an error is logged
// and shown on /health, never thrown into a print; config.json always holds the last
// values applied, so no internet prints exactly as last night.
const CHURCH_APPLIED_FILE = () => path.join($config.DATA_DIR, 'church-applied.json');
let churchSync = null;
let churchSyncStop = null;

/** Write the Worker's values into config.json through the print server's own cleaner, once. */
function applyChurchPatch(patch, deletes) {
  const next = $config.loadConfigFile();
  const before = JSON.stringify(next);
  const keysBefore = {};
  for (const k of [...Object.keys(patch), ...deletes]) keysBefore[k] = JSON.stringify(next[k]);
  const pickupBefore = JSON.stringify(pickup.pickupClubsOf(next));
  const seasonBefore = next.seasonTheme;
  for (const k of deletes) delete next[k];
  const r = $configRoutes.cleanChurchPatch(next, patch);
  if (JSON.stringify(next) !== before) {
    $config.writeConfigFile(next);   // tmp + fsync + rename, .bak of the replaced file
    $configRoutes.applySavedConfig(next);
  }
  return {
    errors: r.errors,
    changed: Object.keys(keysBefore).filter((k) => JSON.stringify(next[k]) !== keysBefore[k]),
    pickupChanged: JSON.stringify(pickup.pickupClubsOf(next)) !== pickupBefore,
    seasonChanged: next.seasonTheme !== seasonBefore,
  };
}

function churchSyncInstance() {
  if (churchSync) return churchSync;
  churchSync = churchSyncModule.createChurchSync({
    signedIn: () => ($relay.signedInToSync() ? { base: $config.config.syncUrl, session: $config.config.syncSession } : null),
    // A station asks as the station (its own request, X-Station); any other computer with its session.
    request: (b, p, o) => ($config.cloudStation ? $config.cloudStation.request : cloudRequest.cloudRequest)(b, p, o),
    isStation: () => !!$config.cloudStation,
    stationId: () => ($config.cloudStation ? $config.cloudStation.stationIdFn() : null),
    readConfig: () => $config.loadConfigFile(),
    churchConfig: () => $config.churchConfig,
    // The local last resort (never written by any UI): config.json alone.
    localOff: () => $config.config.churchSync === false,
    applyPatch: applyChurchPatch,
    onApplied: (r) => {
      if (r.pickupChanged) $publishers.stillHereChanged();
      if (r.pickupChanged || r.seasonChanged) sendStationExtras(true).catch(() => {});
      if (r.seasonChanged) $publishers.publishTally();   // inert while the Worker is the one publisher
    },
    onSwitches: (prev, next) => {
      // SINGLE_PUBLISHER turned off at runtime: this station publishes the tally and the
      // still-here list again at once (inside the tally window), not a minute later.
      const wasSilent = !prev || prev.SINGLE_PUBLISHER !== 'off';
      if ($config.cloudStation && wasSilent && next.SINGLE_PUBLISHER === 'off') {
        console.log('[station] The service no longer publishes the count: this computer publishes the tally and the pickup list again.');
        if ($publishers.inTallyWindow()) { $publishers.publishTally(); $publishers.publishStillHere(); }
      } else if ($config.cloudStation && !wasSilent && next.SINGLE_PUBLISHER !== 'off') {
        console.log('[station] The service publishes the count again: this computer stops publishing the tally and the pickup list.');
      }
    },
    loadApplied: () => {
      const f = CHURCH_APPLIED_FILE();
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    },
    saveApplied: (st) => { $config.saveFileAtomic(CHURCH_APPLIED_FILE(), JSON.stringify(st, null, 2)); },
    log: (m) => console.log(m),
  });
  return churchSync;
}

/** The loop (started with the server; it waits for the sync sign-in). Returns its stop. */
function startChurchSync() {
  if (churchSyncStop) return churchSyncStop;
  churchSyncStop = churchSyncInstance().start();
  return churchSyncStop;
}

function stopChurchSync() {
  if (churchSyncStop) { try { churchSyncStop(); } catch { /* best effort */ } }
  churchSyncStop = null;
}

// routes.md 10.2: the station follows the Worker's runtime switches. Never fetched
// (or a Worker without them) = the behaviour before 9.3.0: a station is silent and
// hands the youth check-out to the Worker.
/** True when this station must NOT publish the tally / still-here list (the Worker does). */
function singlePublisherSilent() {
  if (!$config.cloudStation) return false;
  const sw = churchSync ? churchSync.switches() : null;
  return !sw || sw.SINGLE_PUBLISHER !== 'off';
}

/** True when this station's extension must leave the Trek/Journey check-out to the Worker. */
function ymHandedOff() {
  if (!$config.cloudStation) return false;
  const sw = churchSync ? churchSync.switches() : null;
  return !sw || sw.YM_CHECKOUT !== 'off';
}

/** "I looked at the printer": clears the CHECK THE PRINTER warning. */
function clearCheckThePrinter() {
  if ($config.cloudStation) $config.cloudStation.puller.clearChecks();
}

function cloudStatus() {
  if (!$config.cloudStation) return { station: false };
  return {
    station: true, stationId: $config.cloudStation.stationId,
    jobs: $config.cloudStation.puller.status(), history: $config.cloudStation.writer.status(),
    attendance: $config.cloudStation.attendance.status(), bundles: $config.cloudStation.bundles.status(),
  };
}

/** The one-time "Import laptop history" action (tray item and the settings page). */
async function importLaptopHistory() {
  if (!$config.cloudStation) return { ok: false, reason: 'not-a-station', error: 'This computer is not a print station yet.' };
  if (cloudImporting) return { ok: false, reason: 'busy', error: 'An import is already running.' };
  cloudImporting = true;
  try {
    const o = $config.cloudStation.opts;
    return await historySync.importLaptopHistory({
      pub: o.historyPub || (() => null), signedIn: $config.cloudStation.signedIn, request: $config.cloudStation.request, stationId: $config.cloudStation.stationIdFn,
      readHistory: () => $history.loadHistory(), readLedger: () => $ledger.loadAttendance(), log: (m) => console.log(m),
    });
  } catch (e) {
    return { ok: false, reason: 'error', error: e && e.message };
  } finally { cloudImporting = false; }
}

app.get('/cloud/print-status', (req, res) => {
  if (!$configRoutes.isTrustedOrSettingsPage(req)) return res.status(403).json({ error: 'The check-in laptop only' });
  res.json(cloudStatus());
});

// "I looked at the printer": clears the CHECK THE PRINTER warning.
app.post('/cloud/print-status/clear', (req, res) => {
  if (!$configRoutes.isTrustedOrSettingsPage(req)) return res.status(403).json({ error: 'The check-in laptop only' });
  clearCheckThePrinter();
  res.json(cloudStatus());
});

app.post('/cloud/import-history', async (req, res) => {
  if (!$configRoutes.isTrustedOrSettingsPage(req)) return res.status(403).json({ error: 'The check-in laptop only' });
  const r = await importLaptopHistory();
  res.status(r.ok ? 200 : (r.reason === 'signed-out' ? 401 : 409)).json(r);
});

function startClubNightTimers() {
  $spooler.startPrinterCheckTimer();
  setInterval($publishers.onClubNight($publishers.publishRecap), 2 * 60 * 1000);
  setInterval($publishers.onTallyWindow($publishers.publishTally), 60 * 1000);
  setInterval($publishers.onTallyWindow($publishers.publishStillHere), 60 * 1000);
  setInterval($publishers.onClubNight($publishers.publishBirthdays), 10 * 60 * 1000);
  // Slides heartbeat is deliberately NOT club-night-gated: this server mostly
  // runs around club time anyway, and while it IS running, a screen that
  // reboots (or a brand-new one) must converge on the current deck within
  // minutes on any day — Saturday setup included. Publishes only when a deck
  // has ever been published; ~300 sealed frames/day worst case, far under
  // the relay's quota. Startup broadcast included so a restart re-seeds quickly.
  setInterval(() => { $publishers.publishLobbySlides().catch(() => {}); }, 5 * 60 * 1000);
  $publishers.publishLobbySlides().catch(() => {});
  setInterval(() => { $publishers.publishDisplaySettings().catch(() => {}); }, 5 * 60 * 1000);
  $publishers.publishDisplaySettings().catch(() => {});
  // Signed in to the sync service: confirm the sign-in still counts (a
  // passphrase change elsewhere ends it). No network at all otherwise.
  setInterval(() => { $relay.checkSyncSignIn().catch(() => {}); }, 10 * 60 * 1000);
  setTimeout(() => { $relay.checkSyncSignIn().catch(() => {}); }, 3000);
}
