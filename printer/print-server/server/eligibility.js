'use strict';
// Step Up Night, screen season, twins, birthdays, allergy and Med Release parsers.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const { CLUB_TABLE, clubKeyByLabel } = require('../clubTable');
const $config = lazy('./config');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  ALLERGY_EMOJI: { enumerable: true, get: () => ALLERGY_EMOJI },
  birthdayAgeThisWeek: { enumerable: true, get: () => birthdayAgeThisWeek },
  clubKey: { enumerable: true, get: () => clubKey },
  consentWarningFor: { enumerable: true, get: () => consentWarningFor },
  currentScreenSeason: { enumerable: true, get: () => currentScreenSeason },
  describeConsentColumns: { enumerable: true, get: () => describeConsentColumns },
  easterSunday: { enumerable: true, get: () => easterSunday },
  effectiveHandbookGroup: { enumerable: true, get: () => effectiveHandbookGroup },
  isBirthdayWeek: { enumerable: true, get: () => isBirthdayWeek },
  isCakeWeek: { enumerable: true, get: () => isCakeWeek },
  isHalfBirthdayWeek: { enumerable: true, get: () => isHalfBirthdayWeek },
  isSteppingUp: { enumerable: true, get: () => isSteppingUp },
  nextClubFor: { enumerable: true, get: () => nextClubFor },
  noPhotoFor: { enumerable: true, get: () => noPhotoFor },
  parseAllergies: { enumerable: true, get: () => parseAllergies },
  parseBirthdate: { enumerable: true, get: () => parseBirthdate },
  parseNoPhoto: { enumerable: true, get: () => parseNoPhoto },
  parseYesRelease: { enumerable: true, get: () => parseYesRelease },
  rosterConsentSummary: { enumerable: true, get: () => rosterConsentSummary },
  SEASON_KEYS: { enumerable: true, get: () => SEASON_KEYS },
  seasonForDate: { enumerable: true, get: () => seasonForDate },
  twinDisambiguation: { enumerable: true, get: () => twinDisambiguation },
});

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

// Substring matching on purpose (label text is free-form); the table and the
// matcher are lobby/shared/clubs.js, through the generated ./clubTable.js.
function clubKey(clubName) {
  return clubKeyByLabel(clubName);
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
  const cfg = String($config.config.seasonTheme || 'auto');
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
