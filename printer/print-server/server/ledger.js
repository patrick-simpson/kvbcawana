'use strict';
// Attendance ledger and group schedule.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const security = require('../security');
const fs    = require('fs');
const path  = require('path');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $eligibility = lazy('./eligibility');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  DEFAULT_SCHEDULE: { enumerable: true, get: () => DEFAULT_SCHEDULE },
  lateGoToLine: { enumerable: true, get: () => lateGoToLine },
  loadAttendance: { enumerable: true, get: () => loadAttendance },
  milestoneLineFor: { enumerable: true, get: () => milestoneLineFor },
  recordAttendance: { enumerable: true, get: () => recordAttendance },
  saveAttendance: { enumerable: true, get: () => saveAttendance },
  SCHEDULE_MAX_ROWS: { enumerable: true, get: () => SCHEDULE_MAX_ROWS },
  scheduleRowFor: { enumerable: true, get: () => scheduleRowFor },
  scheduleRows: { enumerable: true, get: () => scheduleRows },
  TROPHY_BAND_MAX: { enumerable: true, get: () => TROPHY_BAND_MAX },
  trophyBandFor: { enumerable: true, get: () => trophyBandFor },
});

// ── Attendance ledger (#30) ───────────────────────────────────────────────────
// Print history keeps only MAX_HISTORY old rows and ages out, so milestones
// need their own compact ledger: one dates[] per kid, one entry per day,
// season-scoped (Awana years start Aug 1). Written atomically like history.
const ATTENDANCE_FILE = path.join($config.DATA_DIR, 'attendance.json');
const MILESTONES = [5, 10, 25, 50];

function seasonStartISO(now = new Date()) {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-08-01`;
}

function loadAttendance() {
  return $config.cachedStore(ATTENDANCE_FILE, () => {
    try {
      if (fs.existsSync(ATTENDANCE_FILE)) {
        const raw = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
        if (raw && typeof raw === 'object') return raw;
      }
    } catch (e) { console.warn('[attendance] Failed to load ledger:', e.message); }
    return {};
  });
}

function saveAttendance(ledger) {
  if ($config.saveFileAtomic(ATTENDANCE_FILE, JSON.stringify(ledger))) $config.cacheStore(ATTENDANCE_FILE, ledger);
}

// Upsert tonight for this kid. Returns:
//   seasonCount      — their night count within the current season (milestones)
//   firstEver        — tonight is the first date this ledger has EVER seen them
//                      (dates[] is never pruned, so this spans seasons)
//   priorNightExists — some kid, any kid, attended on an earlier date, i.e.
//                      the club has met before tonight on this machine
// The last two exist for the auto connect card (#10): "new face at a club
// that has met before" is what distinguishes a genuine first-timer from
// opening night / a fresh install, where EVERY kid's count is 1 and firing a
// welcome card per child would bury the printer.
//
// Keyed id-first with a one-time migration from the legacy name key, mirroring
// historyIdentityKey: two same-named kids stop merging the moment a caller
// knows who they are, and a kid's existing streak moves with them. A kid whose
// entry migrated to the id key and who later prints WITHOUT an id starts a
// fresh name entry — the failure modes there are a wrong milestone line and a
// spurious welcome card, both benign, both no worse than the name-collision
// behaviour this replaces.
function recordAttendance(firstName, lastName, clubberId = null) {
  const nameKey = `${firstName} ${lastName}`.toLowerCase().trim();
  const idRaw = clubberId == null ? '' : String(clubberId).trim();
  const idKey = idRaw ? `id:${idRaw.toLowerCase()}` : '';
  if (!nameKey && !idKey) return { seasonCount: 0, firstEver: false, priorNightExists: false };
  const today = $eventBuffer.localDayISO();
  const ledger = loadAttendance();

  let priorNightExists = false;
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    if (ds.some(d => d < today)) { priorNightExists = true; break; }
  }

  if (idKey && nameKey && ledger[nameKey]) {
    // Migrate (or merge, if tonight already saw both shapes) the legacy
    // name-keyed entry into the id key, then retire the name key.
    const legacy = ledger[nameKey];
    if (!ledger[idKey] || !Array.isArray(ledger[idKey].dates)) {
      ledger[idKey] = legacy;
    } else if (Array.isArray(legacy.dates)) {
      for (const d of legacy.dates) {
        if (!ledger[idKey].dates.includes(d)) ledger[idKey].dates.push(d);
      }
    }
    delete ledger[nameKey];
  }

  const key = idKey || nameKey;
  const entry = ledger[key] && Array.isArray(ledger[key].dates)
    ? ledger[key]
    : { name: `${firstName} ${lastName}`.trim(), dates: [] };
  if (!entry.dates.includes(today)) entry.dates.push(today);
  ledger[key] = entry;
  saveAttendance(ledger);

  // Streak (#14): consecutive CLUB NIGHTS attended, tonight included. A club
  // night is any date some kid attended — walking that union (not calendar
  // weeks) means Christmas break and cancelled weeks never break a streak;
  // only a night the club met and this kid stayed home does.
  const clubNights = new Set();
  for (const k of Object.keys(ledger)) {
    const ds = ledger[k] && Array.isArray(ledger[k].dates) ? ledger[k].dates : [];
    for (const d of ds) if (typeof d === 'string' && d <= today) clubNights.add(d);
  }
  const mine = new Set(entry.dates);
  let streak = 0;
  for (const night of [...clubNights].sort().reverse()) {
    if (mine.has(night)) streak++;
    else break;
  }

  // New-kid window (#15): tonight is within 14 days of the kid's first-ever
  // night on this ledger — their first two typical club weeks. Day-based, not
  // night-based, so a make-up event in the same fortnight doesn't extend it.
  // Calendar days: the old 24-hour arithmetic came up short across
  // spring-forward and kept the sparkle a night too long.
  let isNewKid = false;
  const firstNight = entry.dates.reduce((a, b) => (a && a < b ? a : b), null);
  if (firstNight) {
    isNewKid = $eventBuffer.calendarDaysBetween(firstNight, today) < 14;
  }

  const start = seasonStartISO();
  return {
    seasonCount: entry.dates.filter(d => d >= start).length,
    firstEver: entry.dates.length === 1,
    priorNightExists,
    streak,
    isNewKid,
  };
}

function milestoneLineFor(count) {
  return MILESTONES.includes(count) ? `⭐ ${count}th club night tonight!` : '';
}

// #293: the trophy band's text. Pure and exported so the clip is pinned by a
// unit test — the renderer's own 48-character cap is inside generateLabel and
// returns nothing testable. A book title arrives from a scraped CSV, so it is
// stripped of control characters and bounded before it ever reaches a label.
const TROPHY_BAND_MAX = 48;
function trophyBandFor(book) {
  // A book title comes off a scraped CSV column, so it is always a string when
  // it is real. Anything else is garbage from a drifted parser and prints
  // nothing at all — "Finished 42" or "Finished [object Object]" on a child's
  // label is worse than no band.
  if (typeof book !== 'string') return '';
  const clean = security.sanitizeStoredText(book, 60);
  if (!clean) return '';
  return `Finished ${clean}`.slice(0, TROPHY_BAND_MAX);
}

// ── Group schedule (#28) ──────────────────────────────────────────────────────
// Where each club is, and from when — drives the "Go to:" routing line on
// late check-ins. Rows live in config.json: { club, startTime "HH:MM",
// location, room }, any number per club: each is one slot of the night, and a
// late child is sent to the club's slot that started last before they arrived
// ("Go to: Games, Fellowship Hall" at 7:10). `location` is the activity and
// `room` the place, so the line reads like the printed schedule. No line until
// the club's FIRST slot plus the grace (10 minutes by default) has passed.
//
// DEFAULT_SCHEDULE is KVBC's printed 2026-27 club schedule (owner,
// 2026-10-03), used whenever this computer has no rows of its own: an empty
// table on the dashboard means "the club schedule", so clearing it brings
// these back. Trek and Journey share a column on the poster and part only at
// 7:00, so each has its own rows.
const DEFAULT_SCHEDULE = Object.freeze([
  ['Puggles', '17:45', 'Free Time', 'Toddler Nursery'],
  ['Puggles', '18:00', 'Opening', 'Fellowship Hall'],
  ['Puggles', '18:05', 'Group Time', 'Toddler Nursery'],
  ['Puggles', '19:00', 'Games', 'Fellowship Hall'],
  ['Cubbies', '17:45', 'Free Time', 'Fellowship Hall'],
  ['Cubbies', '18:00', 'Opening', 'Fellowship Hall'],
  ['Cubbies', '18:05', 'Small Group', 'Large Classroom'],
  ['Cubbies', '18:30', 'Large Group', 'Large Classroom'],
  ['Cubbies', '19:00', 'Games', 'Fellowship Hall'],
  ['Sparks', '17:45', 'Small Group', 'Child Discipleship Wing'],
  ['Sparks', '18:30', 'Games', 'Fellowship Hall'],
  ['Sparks', '19:00', 'Large Group', 'Large Classroom'],
  ['T&T', '17:45', 'Handbook Time', 'Fellowship Hall'],
  ['T&T', '18:00', 'Opening', 'Fellowship Hall'],
  ['T&T', '18:05', 'Games', 'Fellowship Hall'],
  ['T&T', '18:30', 'Large Group', 'Child Discipleship Wing'],
  ['T&T', '19:00', 'Small Group', 'Child Discipleship Wing'],
  ['Trek', '17:45', 'Handbook Time', 'Youth Building'],
  ['Trek', '18:05', 'Games', 'Youth Building'],
  ['Trek', '18:30', 'Large Group', 'Youth Building'],
  ['Trek', '19:00', 'Small Group', 'Child Discipleship Wing'],
  ['Journey', '17:45', 'Handbook Time', 'Youth Building'],
  ['Journey', '18:05', 'Games', 'Youth Building'],
  ['Journey', '18:30', 'Large Group', 'Youth Building'],
  ['Journey', '19:00', 'Small Group', 'Youth Building'],
].map(([club, startTime, location, room]) => Object.freeze({ club, startTime, location, room })));
const SCHEDULE_MAX_ROWS = 60;

function scheduleRows() {
  return Array.isArray($config.config.schedule) && $config.config.schedule.length ? $config.config.schedule : DEFAULT_SCHEDULE;
}

// A club's slots that have a readable start, earliest first.
function clubSlots(clubName) {
  const key = $eligibility.clubKey(clubName);
  if (!key) return [];
  return scheduleRows()
    .filter(r => r && $eligibility.clubKey(r.club) === key)
    .map(r => ({ row: r, start: r.startTime ? events.parseHM(r.startTime) : null }))
    .filter(s => s.start !== null)
    .sort((a, b) => a.start - b.start);
}

// The club's slot under way at `now` (the last to have started), or its
// first slot before the night begins. Null for a club with no rows.
function scheduleRowFor(clubName, now = new Date()) {
  const slots = clubSlots(clubName);
  if (!slots.length) return null;
  const mins = now.getHours() * 60 + now.getMinutes();
  let current = slots[0];
  for (const s of slots) if (s.start <= mins) current = s;
  return current.row;
}

function lateGoToLine(clubName, now = new Date()) {
  const slots = clubSlots(clubName);
  if (!slots.length) return '';
  const graceMin = Number.isFinite(Number($config.config.lateGraceMin)) ? Number($config.config.lateGraceMin) : 10;
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins <= slots[0].start + graceMin) return '';
  const row = scheduleRowFor(clubName, now);
  const where = [row.location, row.room].filter(Boolean).join(', ');
  return where ? `Go to: ${where}` : '';
}
