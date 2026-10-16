'use strict';
// Who is checked in tonight, tonight's count.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const tonightRules = require('../tonight');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $http = lazy('./http');
const $history = lazy('./history');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  authoritativeTonight: { enumerable: true, get: () => authoritativeTonight },
  checkedOutTonight: { enumerable: true, get: () => checkedOutTonight, set: (v) => { checkedOutTonight = v; } },
  computeTonightStats: { enumerable: true, get: () => computeTonightStats },
  lastCheckinReport: { enumerable: true, get: () => lastCheckinReport, set: (v) => { lastCheckinReport = v; } },
  tonightCheckins: { enumerable: true, get: () => tonightCheckins },
  tonightHereNow: { enumerable: true, get: () => tonightHereNow },
});

// ── Who is checked in tonight ─────────────────────────────────────────────────
// THE single definition. computeTonightStats() (→ the `tally` and
// /stats/tonight) reads this. Returns:
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
// TwoTimTwo's own /clubber/checkin_report is the real answer. Until 10.0.0 the
// Chrome extension posted it here, and while a report was fresh THE REPORT
// WAS THE COUNT, this printer's history adding only the children checked in
// since it was taken. The extension is gone: the sync Worker reads the report
// and, on a station with its SINGLE_PUBLISHER switch on, publishes the count
// itself, so this printer's own count is built from its history.
// `lastCheckinReport` is no longer fed by any route; the shared rules
// (lobby/shared/tonight.js) still take one, and tests set it to pin them.
//
// Rules worth not relearning:
//   * ONLY a report the reconcile pass actually APPLIED is kept. A report the
//     mass-undo guard refused (a partial scrape, a login bounce, the wrong
//     table) is exactly the kind of report that would zero the night here, and
//     the guard is the one place that judges a report's plausibility.
//   * A person's removal WINS over the report. A row marked `undoneBy` (until
//     10.0.0 the phone's Remove, or /reset-tonight) suppresses that child even
//     though TwoTimTwo still lists them.
//   * UNREGISTERED VISITORS DO NOT COUNT while a report is fresh (owner's
//     decision, 2026-09-16). They are not in the report and they never will
//     be, so the tick-up skips them too; a visitor who IS on the report (they
//     were registered) counts like anyone else. They still appear on the phone
//     page's Tonight list and in `visitors`, which stay history-derived.
//   * Two keys, one child: a report entry carries TwoTimTwo's clubber id and a
//     history row may carry only a name, so identities are matched on BOTH and
//     collapsed. Counting the same child under `id:` and `name:` is the exact
//     over-count this is meant to remove, not one to reintroduce.
let lastCheckinReport = null;   // { at, entries } — tests only since 10.0.0 (see above)
// Who has been checked OUT tonight, by TwoTimTwo clubber id (7.15.0, owner
// 2026-10-07: "the number should go down when kids check out", on every
// surface). Filled by POST /feed/checked-out (the Chrome extension's youth
// check-out and Checkout-page reads until 10.0.0; the sync Worker does both
// now). `names` (7.16.0): children with no clubber id, by normalizedName key.
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
