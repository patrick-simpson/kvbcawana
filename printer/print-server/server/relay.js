'use strict';
// The sync service: relay queue and sign-in.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const syncClient = require('../sync-client');
const $config = lazy('./config');
const $http = lazy('./http');
const $configRoutes = lazy('./config-routes');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  checkSyncSignIn: { enumerable: true, get: () => checkSyncSignIn },
  forwardToSync: { enumerable: true, get: () => forwardToSync },
  relayBrokenUntil: { enumerable: true, get: () => relayBrokenUntil },
  resetRelayForTest: { enumerable: true, get: () => resetRelayForTest },
  sendGreeting: { enumerable: true, get: () => sendGreeting },
  signedInToSync: { enumerable: true, get: () => signedInToSync },
  syncStatus: { enumerable: true, get: () => syncStatus },
});

// ── The sync service (one passphrase for every screen) ────────────────────────
// Signed in (config.syncSession + config.syncUrl, both written only by
// POST /config/sync-login below), this server seals with the service's display
// key, stops the deck / settings rebroadcasts,
// and forwards a publish made on this computer to the service. Nothing here
// touches the network until someone signs in, so a server that never does
// behaves exactly as before. See print-server/sync-client.js.
let syncStatus = { state: 'none', checkedAt: null, error: null };

function signedInToSync() {
  return syncClient.isValidSyncUrl($config.config.syncUrl) && syncClient.isValidSession($config.config.syncSession);
}

function writeConfigPatch(mutate) {
  const next = $config.loadConfigFile();
  mutate(next);
  $config.writeConfigFile(next);
  $configRoutes.applySavedConfig(next);
}

// Every live frame (check-ins, tally, recap, birthdays, …) also goes to the
// sync service's channel while signed in, one at a time and in order, so a
// check-in never lands after the tally that counts it any more than the channel
// would. Only the display channel's events.
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
        const r = await syncClient.syncRequest($config.config.syncUrl, '/v1/publish', {
          method: 'POST', body: { event: item.event, payload: item.body }, session: $config.config.syncSession,
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

// A station's greeting, to the Worker as the station: with the id of the print job it just
// ran (`X-Job`), or with the child it printed a job-less label for (`greet` in the body), and
// `late` when a job met a label already printed. The single publisher lets one greeting per
// child per night through and drops any other `checkin`. A refusal is an answer (a duplicate
// or a dropped job is not retried); only an unreachable service is. `meta` may be a job id.
const GREETING_TRIES = 3;
async function sendGreeting(body, meta) {
  const m = typeof meta === 'string' ? { job: meta } : (meta || {});
  const publishBody = { event: 'checkin', payload: body, ...(m.child ? { greet: m.child } : {}), ...(m.late ? { late: true } : {}) };
  for (let attempt = 0; attempt < GREETING_TRIES; attempt++) {
    const station = $config.cloudStation;
    const where = station && station.signedIn();
    if (!where) return false;
    const r = await station.request(where.base, '/v1/publish', {
      method: 'POST', body: publishBody, session: where.session,
      station: station.stationIdFn(), ...(m.job ? { headers: { 'X-Job': m.job } } : {}),
    });
    if (r.status === 401) checkSyncSignIn().catch(() => {});
    if (r.ok) return true;
    if (r.status >= 400 && r.status < 500) return false;
    await new Promise((resolve) => { const t = setTimeout(resolve, 1500); if (t.unref) t.unref(); });
  }
  return false;
}

events.setRelay((channel, event, body, meta) => {
  if (channel !== $config.EVENT_CHANNEL || !signedInToSync()) return false;
  if (event === 'checkin' && meta && (meta.job || meta.child) && $config.cloudStation) return sendGreeting(body, meta);
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
  const verdict = await syncClient.syncCheck($config.config.syncUrl, $config.config.syncSession);
  syncStatus = { state: verdict, checkedAt: new Date().toISOString(), error: null };
  if (verdict === 'signed-out') {
    // The passphrase was changed on another screen, which also replaced the
    // display key: check-ins sealed with ours no longer open on screens that
    // signed in again. Say so loudly; the session is dropped, so the old
    // heartbeats resume until someone signs this computer in again.
    console.error('[sync] Signed out by the sync service (the passphrase was changed). Sign this computer in again: awana.kvbchurch.org/settings → Printing → At the laptop → This laptop’s sign-in.');
    try {
      writeConfigPatch((next) => { delete next.syncSession; });
    } catch (e) { console.warn('[sync] Could not clear the session:', e.message); }
    syncStatus = { state: 'signed-out', checkedAt: syncStatus.checkedAt, error: 'The passphrase was changed on another screen. Sign this computer in again with the new one.' };
  }
}

async function forwardToSync(res, kind, payload) {
  const r = await syncClient.syncPublish($config.config.syncUrl, $config.config.syncSession, kind, payload);
  if (r.status === 0) return res.status(502).json({ error: 'Could not reach the sync service from this computer. Check its internet connection, then publish again.' });
  if (r.status === 401) {
    checkSyncSignIn().catch(() => {});
    return res.status(502).json({ error: 'This computer is signed out of the sync service. Sign it in again (awana.kvbchurch.org/settings → Printing → At the laptop → This laptop’s sign-in).' });
  }
  if (!r.ok) return res.status(r.status).json({ error: (r.body && r.body.error) || `The sync service answered HTTP ${r.status}` });
  return res.json({ ok: true, viaSync: true, ...(r.body || {}) });
}

app.post('/config/sync-login', async (req, res) => {
  // This computer's own app (the setup wizard), or the settings page once its
  // session is confirmed (corsPolicy). The page never names the service: it
  // signs this computer in again to the one it already uses.
  const fromApp = $configRoutes.isTrustedConfigOrigin(req);
  if (!fromApp && req.settingsPage !== true) {
    return res.status(403).json({ error: 'This computer can only be signed in from the settings page on it, or its own app' });
  }
  const { passphrase, url } = req.body || {};
  const base = String(fromApp ? (url || '') : ($config.config.syncUrl || '')).trim().replace(/\/+$/, '');
  if (!syncClient.isValidSyncUrl(base)) return res.status(400).json({ error: 'That is not a sync service address (https only).' });
  if (!syncClient.normalizeSyncPassphrase(passphrase)) return res.status(400).json({ error: 'Type the passphrase first.' });
  const r = await syncClient.syncLogin(base, passphrase, { seedKey: events.getDisplayKeyState().configured ? $config.config.displayKey : '' });
  if (!r.ok) {
    const out = { error: r.error, reason: r.reason };
    if (r.triesLeft !== undefined) out.triesLeft = r.triesLeft;
    if (r.retryAfterSec !== undefined) out.retryAfterSec = r.retryAfterSec;
    return res.status(r.status === 0 ? 502 : (r.status === 401 || r.status === 429 ? r.status : 502)).json(out);
  }
  if (!events.isValidDisplayKey(r.displayKey)) return res.status(502).json({ error: 'The sync service sent an unusable display key.' });
  const changedKey = r.displayKey !== $config.config.displayKey;
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
  if (!$configRoutes.isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'This computer can only be signed out from its own app' });
  }
  try {
    writeConfigPatch((next) => { delete next.syncSession; });
  } catch (e) {
    return res.status(500).json({ error: `Could not save: ${e.message}` });
  }
  syncStatus = { state: 'none', checkedAt: null, error: null };
  return res.json({ ok: true });
});
