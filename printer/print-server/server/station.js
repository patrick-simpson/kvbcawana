'use strict';
// Online check-in P2: this computer as a print station.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const cloudRequest = require('../cloud-request');
const jobPuller = require('../job-puller');
const historySync = require('../history-sync');
const pickup = require('../pickup');
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
  clearCheckThePrinter: { enumerable: true, get: () => clearCheckThePrinter },
  cloudStatus: { enumerable: true, get: () => cloudStatus },
  configureCloud: { enumerable: true, get: () => configureCloud },
  importLaptopHistory: { enumerable: true, get: () => importLaptopHistory },
  mergeAttendance: { enumerable: true, get: () => mergeAttendance },
  sendStationExtras: { enumerable: true, get: () => sendStationExtras },
  startClubNightTimers: { enumerable: true, get: () => startClubNightTimers },
  stopCloud: { enumerable: true, get: () => stopCloud },
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
