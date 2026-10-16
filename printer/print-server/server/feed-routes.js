'use strict';
// The checked-out and completed-books feeds, lobby slides and display settings endpoints.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const feeds   = require('../feeds');
const security = require('../security');
const syncClient = require('../sync-client');
const tonightRules = require('../tonight');
const { normalizedName, historyIdentityKey } = tonightRules;
const crypto = require('crypto');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $http = lazy('./http');
const $history = lazy('./history');
const $tonightCount = lazy('./tonight-count');
const $publishers = lazy('./publishers');
const $relay = lazy('./relay');
const $configRoutes = lazy('./config-routes');
const $station = lazy('./station');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  distinctChildrenPrintedToday: { enumerable: true, get: () => distinctChildrenPrintedToday },
  settingsPageSessionOk: { enumerable: true, get: () => settingsPageSessionOk },
  slidesTokenOk: { enumerable: true, get: () => slidesTokenOk },
});

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
  for (const e of $history.loadHistory()) {
    if (!e || !e.timestamp) continue;
    const when = new Date(e.timestamp);
    if (Number.isNaN(when.getTime()) || localDay(when) !== today) continue;
    if (e.success === false) continue;   // a failed print never checked anyone in
    if ($history.isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
    const key = historyIdentityKey(e);
    if (!key) continue;
    seen.add(key);                       // reprints must not inflate the count
  }
  return seen.size;
}

// Who has been checked out tonight (7.15.0): the WHOLE list for the meeting
// date, replace semantics, merged so a shorter list never puts a child back.
// Loopback only and never published: clubber ids only. A change takes those
// children off tonight's count at once. Until 10.0.0 the Chrome extension
// posted it (its youth check-out, and with `source: 'checkout-page'` the
// children gone from TwoTimTwo's Checkout page); the sync Worker does both
// now. A row also leaves that page when its check-in is UNDONE, so with that
// source a child whose newest row here is undone is not taken for a check-out.
app.post('/feed/checked-out', (req, res) => {
  const result = feeds.validateCheckedOutBody(req.body);
  if (!result.ok) return res.status(400).json({ ok: false, error: result.reason });
  const { date } = result.payload;
  let { clubberIds } = result.payload;
  if (date !== $eventBuffer.localDayISO()) return res.json({ ok: true, applied: false, reason: 'not tonight' });
  let skipped = 0;
  if (req.body.source === 'checkout-page') {
    const undone = undoneClubberIdsTonight();
    const kept = clubberIds.filter((id) => !undone.has(id));
    skipped = clubberIds.length - kept.length;
    clubberIds = kept;
  }
  // The list only grows through a night; a shorter one never puts children back.
  const changed = markCheckedOut(date, clubberIds, []);
  if (changed) $publishers.publishTally();
  // A station hands the Checkout page's check-outs to the Worker (the one publisher).
  if (req.body.source === 'checkout-page') $station.sendCheckedOut(date, [...$tonightCount.checkedOutTonight.ids]).catch(() => {});
  res.json({ ok: true, applied: true, checkedOut: $tonightCount.checkedOutTonight.ids.size, skipped });
});

// Tonight's checked-out set grows by these ids / names; true when it changed.
// A new night starts it afresh.
function markCheckedOut(date, ids, names) {
  const same = $tonightCount.checkedOutTonight.date === date;
  const nextIds = new Set(same ? $tonightCount.checkedOutTonight.ids : []);
  const nextNames = new Set(same && $tonightCount.checkedOutTonight.names ? $tonightCount.checkedOutTonight.names : []);
  const before = nextIds.size + nextNames.size;
  (ids || []).forEach((id) => { const v = String(id == null ? '' : id).trim(); if (v) nextIds.add(v); });
  (names || []).forEach((n) => { const v = normalizedName(n); if (v) nextNames.add(v); });
  $tonightCount.checkedOutTonight = { date, ids: nextIds, names: nextNames };
  return !same || nextIds.size + nextNames.size !== before;
}

// Clubber ids whose newest row tonight is undone (any reason: the phone's
// Remove or Undo check-in, the report pass, a reset).
function undoneClubberIdsTonight() {
  const out = new Set();
  const seen = new Set();
  for (const e of $tonightCount.tonightCheckins().entries) {
    if (e.clubberId == null || !String(e.clubberId).trim()) continue;
    const id = String(e.clubberId).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (e.undone) out.add(id);
  }
  return out;
}

// #293: who finished a handbook recently, so the NEXT label that child prints
// carries a trophy band. Carries full names, so loopback only and NEVER
// published. The station's job puller posts the Worker's sealed books bundle
// here (job-puller.js createBundleSync). Merge semantics: a second post must
// not wipe the first's.
app.post('/feed/completed-books', (req, res) => {
  const result = feeds.submitCompletedBooks(req.body, Date.now());
  if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
  if (result.throttled) return res.json({ ok: true, throttled: true });
  res.json({ ok: true, count: result.payload.entries.length });
});

// ── Lobby slides endpoints ────────────────────────────────────────────────────
// Two callers, two credentials:
//   • The dashboard's "Lobby slides" card — trusted like every other loopback
//     origin (the same trust that can already set the phone PIN).
//   • The display app's slide editor ("Publish to all displays") — a PUBLIC
//     https origin, so it is scoped to exactly this path in corsPolicy and must
//     additionally present the publish token. The token is the credential; the
//     origin check is browser hygiene (curl can forge an Origin, a tab cannot).
// Either way the payload goes through buildSlidesDeck, so nothing but capped
// text slides can reach the wire, whoever asks.
// The settings page's sync sessions the sync service has confirmed, by their
// SHA-256 (never the session itself), each good for SETTINGS_SESSION_OK_MS so
// a page's dozen calls cost one check. Only for this computer's own browser
// (corsPolicy checks the socket first), and only while this print server
// has a sync service on record (a sign-in that was since dropped keeps its
// address, so the page can sign the computer back in): the page's session is
// checked against config.syncUrl, never an address the request names.
const SETTINGS_SESSION_OK_MS = 10 * 60 * 1000;
const settingsPageSessions = new Map();
async function settingsPageSessionOk(req) {
  const m = /^Sync\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!m || !syncClient.isValidSession(m[1]) || !syncClient.isValidSyncUrl($config.config.syncUrl)) return false;
  const key = crypto.createHash('sha256').update(m[1]).digest('hex');
  const until = settingsPageSessions.get(key);
  if (until && until > Date.now()) return true;
  settingsPageSessions.delete(key);
  if ((await syncClient.syncCheck($config.config.syncUrl, m[1])) !== 'ok') return false;
  if (settingsPageSessions.size >= 32) settingsPageSessions.clear();
  settingsPageSessions.set(key, Date.now() + SETTINGS_SESSION_OK_MS);
  return true;
}

function slidesTokenOk(req) {
  const m = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  const token = String($config.config.slidesPublishToken || '');
  if (!m || !token) return false;
  return security.timingSafeStringEqual(m[1].trim(), token);
}

app.post('/api/lobby-slides', (req, res) => {
  const origin = req.headers.origin;
  const fromDisplayOrigin = security.isExactAllowedOrigin(
    origin, security.sanitizeAllowedOrigins($config.churchConfig.displayOrigins));
  if (!$configRoutes.isTrustedConfigOrigin(req) && !(fromDisplayOrigin && slidesTokenOk(req))) {
    if (fromDisplayOrigin && !$config.config.slidesPublishToken) {
      return res.status(403).json({ error: 'No publish token is set on the print server. Publish the deck from awana.kvbchurch.org/settings instead: it needs none.' });
    }
    if (fromDisplayOrigin) {
      return res.status(403).json({ error: 'Wrong publish token. Publish the deck from awana.kvbchurch.org/settings instead: it needs none.' });
    }
    console.warn(`[security] Refused lobby-slides publish from ${origin || 'no-origin non-loopback caller'}`);
    return res.status(403).json({ error: 'Lobby slides can be published from awana.kvbchurch.org/settings or the display app’s slide editor on this computer.' });
  }
  if ($relay.signedInToSync()) return $relay.forwardToSync(res, 'slides', (req.body || {}).slides);
  const result = $publishers.acceptLobbySlidesPublish((req.body || {}).slides);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

// Current deck for the dashboard card. Loopback-trusted origins only — the
// deck is lobby copy, not a secret, but nothing here needs to be readable
// cross-origin and the discipline is cheaper than the exception.
app.get('/api/lobby-slides', (req, res) => {
  if (!$configRoutes.isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The lobby deck is only readable from this computer' });
  }
  res.json({
    deckRev: $publishers.lobbySlides.deckRev,
    publishedAt: $publishers.lobbySlides.publishedAt || null,
    slides: $publishers.lobbySlides.slides,
    tokenConfigured: Boolean($config.config.slidesPublishToken),
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
    origin, security.sanitizeAllowedOrigins($config.churchConfig.displayOrigins));
  if (!$configRoutes.isTrustedConfigOrigin(req) && !(fromDisplayOrigin && slidesTokenOk(req))) {
    if (fromDisplayOrigin && !$config.config.slidesPublishToken) {
      return res.status(403).json({ error: 'No publish token is set on the print server. Publish from awana.kvbchurch.org/settings instead: it needs none.' });
    }
    if (fromDisplayOrigin) {
      return res.status(403).json({ error: 'Wrong publish token. Log this screen in again, or publish from awana.kvbchurch.org/settings.' });
    }
    console.warn(`[security] Refused display-settings publish from ${origin || 'no-origin non-loopback caller'}`);
    return res.status(403).json({ error: 'Display settings can be published from the display app on this computer.' });
  }
  if ($relay.signedInToSync()) return $relay.forwardToSync(res, 'settings', (req.body || {}).settings);
  const result = $publishers.acceptDisplaySettingsPublish((req.body || {}).settings);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});

app.get('/api/display-settings', (req, res) => {
  if (!$configRoutes.isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display settings are only readable from this computer' });
  }
  res.json({
    rev: $publishers.displaySettings.rev,
    publishedAt: $publishers.displaySettings.publishedAt || null,
    settings: $publishers.displaySettings.settings,
  });
});
