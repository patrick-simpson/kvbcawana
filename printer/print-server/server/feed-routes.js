'use strict';
// Check-in CSV write-back, feed receive endpoints, lobby slides and display settings endpoints.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const feeds   = require('../feeds');
const security = require('../security');
const syncClient = require('../sync-client');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const crypto = require('crypto');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $ledger = lazy('./ledger');
const $http = lazy('./http');
const $history = lazy('./history');
const $tonightCount = lazy('./tonight-count');
const $publishers = lazy('./publishers');
const $relay = lazy('./relay');
const $configRoutes = lazy('./config-routes');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  distinctChildrenPrintedToday: { enumerable: true, get: () => distinctChildrenPrintedToday },
  markCheckedOut: { enumerable: true, get: () => markCheckedOut },
  settingsPageSessionOk: { enumerable: true, get: () => settingsPageSessionOk },
  slidesTokenOk: { enumerable: true, get: () => slidesTokenOk },
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

app.get('/checkin-csv-export', (req, res) => {
  const dateParam = String(req.query.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : $eventBuffer.localDayISO();

  const history = $history.loadHistory();
  const seen = new Set();
  const rows = [];
  for (const e of history) {
    if (!e || !$eventBuffer.isOnLocalDay(e.timestamp, date)) continue;
    if (e.success === false) continue;   // a failed print never actually checked the kid in
    if ($history.isNonCheckinRow(e)) continue;    // award slips / connect cards are not check-ins
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
// per 5s per feed) and this thin route does the actual publish.
function makeFeedRoute(feedName) {
  return async (req, res) => {
    const result = feeds.submitFeed(feedName, req.body, Date.now());
    if (!result.valid) return res.status(result.status || 400).json({ ok: false, error: result.reason });
    if (result.throttled) return res.json({ ok: true, throttled: true });

    let published = false;
    try {
      published = await events.publish($config.EVENT_CHANNEL, feedName, result.payload);
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
// never publishes a live-channel event itself (no new event type, per the contract
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
    $tonightCount.lastPartialReport = { at: now, parsed: distinctReportChildren(result.payload.entries), declared: result.payload.declared };
    console.warn(`[reconcile] the report parsed ${$tonightCount.lastPartialReport.parsed} of the ${$tonightCount.lastPartialReport.declared} children TwoTimTwo lists; not counting from it`);
    return res.json({ ok: true, applied: false, changed: 0, reason: 'partial report' });
  }
  const outcome = $history.reconcileHistoryWithReport($history.loadHistory(), result.payload.entries, now);
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
  $tonightCount.lastCheckinReport = { at: now, entries: result.payload.entries };
  $tonightCount.lastPartialReport = null;
  if (outcome.changed > 0) {
    $history.saveHistory(outcome.history);
  }
  // Republished on EVERY applied report, not just a changed one: between polls
  // the count ticks up optimistically from history, so the report landing is
  // itself a correction the screens need even when no row moved.
  $publishers.publishTally();
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
  if (date !== $eventBuffer.localDayISO()) return res.json({ ok: true, applied: false, reason: 'not tonight' });
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
  if (changed) $publishers.publishTally();
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
// the live channel. Merge semantics: the extension posts one payload
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

app.post('/reset-tonight', (req, res) => {
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'confirm: true required — this zeroes tonight on every surface' });
  }
  const today = $eventBuffer.localDayISO();
  const nowIso = new Date().toISOString();

  const history = $history.loadHistory();
  let undone = 0;
  const next = history.map((row) => {
    if (!row || row.success === false || $history.isNonCheckinRow(row)) return row;
    if (!$eventBuffer.isOnLocalDay(row.timestamp, today)) return row;
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
  if (undone) $history.saveHistory(next);

  // Tonight never happened, as far as the season ledger is concerned.
  const ledger = $ledger.loadAttendance();
  let ledgerTouched = false;
  for (const key of Object.keys(ledger)) {
    const dates = ledger[key] && Array.isArray(ledger[key].dates) ? ledger[key].dates : null;
    if (dates && dates.includes(today)) {
      ledger[key].dates = dates.filter((d) => d !== today);
      ledgerTouched = true;
    }
  }
  if (ledgerTouched) $ledger.saveAttendance(ledger);

  $eventBuffer.eventBuffer = [];
  $config.saveFileAtomic($eventBuffer.EVENT_BUFFER_FILE, JSON.stringify($eventBuffer.eventBuffer));

  // Drop the report too. "Tonight never happened" has to mean it on every
  // surface, and TwoTimTwo's report will go on listing those children for the
  // rest of the evening - the `undoneBy: 'reset'` markers above cover the kids
  // this printer knows about, and this covers anyone it does not.
  $tonightCount.lastCheckinReport = null;
  $tonightCount.lastPartialReport = null;
  $tonightCount.checkedOutTonight = { date: null, ids: new Set(), names: new Set() };

  $publishers.publishTally();
  console.log(`[reset] Tonight reset by operator: ${undone} check-in(s) marked undone, ledger ${ledgerTouched ? 'cleared for today' : 'untouched'}`);
  res.json({ ok: true, undone });
});
