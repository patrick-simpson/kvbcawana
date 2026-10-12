'use strict';
// Attendance audit, who came lately, touch context.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const security = require('../security');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $eligibility = lazy('./eligibility');
const $ledger = lazy('./ledger');
const $http = lazy('./http');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  ATTENDANCE_GRID_STALE_MS: { enumerable: true, get: () => ATTENDANCE_GRID_STALE_MS },
  auditAttendance: { enumerable: true, get: () => auditAttendance },
  loadTouchContext: { enumerable: true, get: () => loadTouchContext },
  recentAttendance: { enumerable: true, get: () => recentAttendance },
  sanitizeTouchContext: { enumerable: true, get: () => sanitizeTouchContext },
});

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
// registered feed to the live channel, and these rows carry full
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
function auditAttendance(ledger, grid, now = Date.now(), today = $eventBuffer.localDayISO()) {
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

  const clubOf = (c) => $eligibility.clubKey(c) || String(c || '').trim().toLowerCase();
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
  res.json(auditAttendance($ledger.loadAttendance(), attendanceGrid));
});

// ── Who came lately (7.3.0, the touch check-in's bottom row) ─────────────────
// The last two club nights before today, and every child who was at either:
// the touch check-in moves a family whose children were at neither down to
// a row of smaller buttons. A club night is any date some child attended (the
// streak's rule), so a cancelled week never counts against anyone. Fewer than
// two club nights so far means nothing is split (ready: false).
function recentAttendance(ledger, today = $eventBuffer.localDayISO()) {
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
  res.json(recentAttendance($ledger.loadAttendance()));
});

// What the phone page needs to look like the touch check-in (7.7.0), sent by
// the check-in laptop's extension, which can read TwoTimTwo: the household
// groupings (children's names only, lowercased, two or more to a household)
// and which clubs' check-in has Bible / Brought a friend (club names). Nothing
// else is accepted. Loopback only (the extension), kept on disk so phones keep
// their families across a restart.
const TOUCH_CONTEXT_FILE = path.join($config.DATA_DIR, 'touch-context.json');
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
  const ledger = $ledger.loadAttendance();
  const today = $eventBuffer.localDayISO();
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
  if (added) $ledger.saveAttendance(ledger);
  console.log(`[audit] Applied ${added} missing attendance date(s) across ${touched.length} child(ren); 0 deleted`);
  res.json({ ok: true, added, children: touched, deleted: 0 });
});
