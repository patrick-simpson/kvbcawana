'use strict';
// Who is checked in tonight, tonight's count, is our count right.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const tonightRules = require('../tonight');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $labelType = lazy('./label-type');
const $http = lazy('./http');
const $history = lazy('./history');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  authoritativeTonight: { enumerable: true, get: () => authoritativeTonight },
  checkedOutTonight: { enumerable: true, get: () => checkedOutTonight, set: (v) => { checkedOutTonight = v; } },
  compareCounts: { enumerable: true, get: () => compareCounts },
  computeTonightStats: { enumerable: true, get: () => computeTonightStats },
  countsForCompare: { enumerable: true, get: () => countsForCompare },
  lastCheckinReport: { enumerable: true, get: () => lastCheckinReport, set: (v) => { lastCheckinReport = v; } },
  lastPartialReport: { enumerable: true, get: () => lastPartialReport, set: (v) => { lastPartialReport = v; } },
  SOURCE_COUNT_STALE_MS: { enumerable: true, get: () => SOURCE_COUNT_STALE_MS },
  tonightCheckins: { enumerable: true, get: () => tonightCheckins },
  tonightHereNow: { enumerable: true, get: () => tonightHereNow },
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
function tonightCheckins(history = $history.loadHistory(), today = $eventBuffer.localDayISO()) {
  return tonightRules.tonightRows(history, today, { onDay: $eventBuffer.isOnLocalDay, isNonCheckin: $history.isNonCheckinRow });
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

/** The state the shared rules read: this printer's rows, its trusted report, its check-outs, its clock. */
function tonightState(tonight, now) {
  return { tonight, report: lastCheckinReport, checkedOut: checkedOutTonight, dayOf: (ms) => $eventBuffer.localDayISO(new Date(ms)) };
}

/**
 * WHO is here now tonight: one entry per child, by the rules of the count
 * (lobby/shared/tonight.js, the SAME code the sync Worker runs). The lobby's
 * still-here list (7.16.0, publishStillHere) names them. Pure but for its
 * reads of lastCheckinReport and checkedOutTonight.
 *
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            children:Array<{keys:string[], club:string, firstName:string}>,
 *            checkedOut:number}}
 */
function tonightHereNow(tonight = tonightCheckins(), now = Date.now()) {
  return tonightRules.tonightHereNow(tonightState(tonight, now), now);
}

/**
 * THE one function every surface asks "how many children are here tonight"
 * (lobby/shared/tonight.js).
 *
 * @returns {{source:'report'|'history', at:number|null, ageMs:number|null,
 *            checkedIn:number, byClub:Object}}
 */
function authoritativeTonight(tonight = tonightCheckins(), now = Date.now()) {
  return tonightRules.authoritativeTonight(tonightState(tonight, now), now);
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

    const record = $clubbers.findClubber(e.firstName, e.lastName);
    if (!record) return;
    const tokens = $eligibility.parseAllergies(record.Allergies || record.Notes || '');
    if (tokens.length) allergyKids.push({ name, allergies: tokens });
    if ($eligibility.isBirthdayWeek(record.Birthdate)) birthdayKids.push(name);
    if ($eligibility.noPhotoFor(record)) noPhotoKids.push(name);
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
// too. Kept deliberately LOCAL: this never becomes a live-channel event, so the
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
    return $eligibility.clubKey(decoded) || decoded.trim().toLowerCase() || 'no club';
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
      club: $labelType.CLUB_DISPLAY_NAMES[key] || key,
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
