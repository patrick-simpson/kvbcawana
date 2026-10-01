// Pure club-night phase resolution — where are we in tonight's program?
// The shared schedule is hosted by this repo's own Pages site
// (…/Awana-Check-in-Display/shared/schedule.json); useSchedule fetches
// it with a cache and this baked fallback underneath.
//
// Phases drive presentation, not logic-critical behavior: after the
// ceremony starts, live check-in banners switch to the calm 'late'
// styling and the chime ducks, so a straggler's arrival doesn't blast
// over the pledges happening in the next room.

export const PHASES = ['off', 'countdown', 'ceremony', 'game-time', 'closing', 'shutdown'];

// shared/schedule.json window `kind` → display phase.
const KIND_TO_PHASE = {
  slideshow: (w) => (w.deck === 'closing' ? 'closing' : 'ceremony'),
  game: () => 'game-time',
  shutdown: () => 'shutdown',
};

// Baked KVBC fallback — mirrors shared/schedule.json in the countdown
// repo, already reduced to phases.
export const DEFAULT_SCHEDULE = {
  meetingDay: 3, // Wednesday
  specialDates: {},
  windows: [
    { start: '18:00', end: '18:05', phase: 'ceremony' },
    { start: '18:05', end: '19:30', phase: 'game-time' },
    { start: '19:30', end: '19:35', phase: 'closing' },
    { start: '19:35', end: '24:00', phase: 'shutdown' },
  ],
};

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A real local calendar day, not merely digits in the right shape:
 * '2026-13-45' has the shape and cannot be a date, and a key that can never
 * match a day is a typo the operator needs to see (the drift test in
 * schedule.test.js is what shows it to them).
 *
 * @param {string} key
 * @returns {boolean}
 */
function isRealDateKey(key) {
  const m = DATE_KEY_RE.exec(key);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(y, mo - 1, d);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === d;
}

// A shared file with hundreds of exceptions is a mistake, not a schedule;
// cap it so a runaway generator can't bloat this device's cache.
const MAX_SPECIAL_DATES = 400;

/**
 * Local-time YYYY-MM-DD key for a Date — the same recipe as
 * calendarLogic.localDateStr and useTally.todayKey, repeated here rather than
 * imported so this module stays dependency-free (it is the phase engine the
 * whole stage's timing hangs off).
 *
 * @param {Date} d
 * @returns {string}
 */
function dateKey(d) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Parse `specialDates` out of a fetched shared/schedule.json.
 *
 * This is the SIGNAGE side's own reader, deliberately a second one: the
 * presentation page has its own parser in src/presentation/lib/shared-config.js
 * and the isolation rule in CLAUDE.md forbids importing across that line. The
 * two therefore agree by test, not by sharing code — see schedule.test.js's
 * drift case, which runs the real checked-in file through this parser.
 *
 * The two readers differ on purpose in one way: the presentation parser FAILS
 * the build on a malformed entry (a projector operator wants to know at deploy
 * time), while this one drops the bad entry and keeps the rest. A lobby TV that
 * refuses its whole schedule because someone fat-fingered one break week is a
 * worse outcome than a lobby TV that forgets that one break week.
 *
 * Accepted per key: a strict YYYY-MM-DD key that is a REAL calendar day,
 * mapping to an object. `noClub:
 * true` means no club that day (the only field that changes what the signage
 * screen does); `label` is the church's own words for it, optional — a break
 * week with no label is still a break week, so a missing label must never
 * discard the entry. Per-date `windows` (the presentation's other variant) are
 * accepted and ignored: this page reduces windows to phases, and a one-off
 * timing change is the projector's business.
 *
 * @param {unknown} raw
 * @returns {Record<string, { noClub: boolean, label?: string }>}
 */
export function sanitizeSpecialDates(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, { noClub: boolean, label?: string }>} */
  const clean = {};
  for (const [key, value] of Object.entries(raw).slice(0, MAX_SPECIAL_DATES)) {
    if (!isRealDateKey(key)) continue;
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = /** @type {Record<string, unknown>} */ (value);
    const label = typeof entry.label === 'string' && entry.label.trim()
      ? entry.label.trim().slice(0, 80)
      : undefined;
    clean[key] = label === undefined
      ? { noClub: entry.noClub === true }
      : { noClub: entry.noClub === true, label };
  }
  return clean;
}

/**
 * Is `dateStr` (YYYY-MM-DD) marked no-club by the shared schedule?
 *
 * @param {{ specialDates?: Record<string, { noClub: boolean }> }|null|undefined} schedule
 * @param {string} dateStr
 * @returns {boolean}
 */
export function isNoClubDate(schedule, dateStr) {
  return schedule?.specialDates?.[dateStr]?.noClub === true;
}

/**
 * The shared schedule's entry for a date, or null.
 *
 * @param {{ specialDates?: Record<string, { noClub: boolean, label?: string }> }|null|undefined} schedule
 * @param {string} dateStr
 * @returns {{ noClub: boolean, label?: string }|null}
 */
export function specialDateFor(schedule, dateStr) {
  return schedule?.specialDates?.[dateStr] ?? null;
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(typeof s === 'string' ? s.trim() : '');
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Strict-parse a fetched shared/schedule.json into { meetingDay,
 * windows: [{start, end, phase}], specialDates }; null on anything malformed
 * so a bad deploy of the shared file can never break the display — the baked
 * DEFAULT_SCHEDULE takes over instead.
 *
 * `specialDates` is the one part that is repaired rather than rejected, per
 * entry — see sanitizeSpecialDates.
 */
export function sanitizeSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const meetingDay = Number(raw.meeting?.day);
  if (!Number.isInteger(meetingDay) || meetingDay < 0 || meetingDay > 6) return null;
  if (!Array.isArray(raw.windows) || raw.windows.length === 0) return null;
  const windows = [];
  for (const w of raw.windows.slice(0, 20)) {
    if (!w || typeof w !== 'object') return null;
    const start = parseHM(w.start);
    const end = parseHM(w.end);
    const toPhase = KIND_TO_PHASE[w.kind];
    if (start === null || end === null || !toPhase || end <= start) return null;
    windows.push({ start: w.start, end: w.end, phase: toPhase(w) });
  }
  return { meetingDay, windows, specialDates: sanitizeSpecialDates(raw.specialDates) };
}

/**
 * The current program phase, as a pure function of the schedule and a
 * Date. Non-meeting days are 'off'; a meeting day before the first
 * window is 'countdown'; a date the shared file marks `noClub` is 'off'
 * even when it IS the meeting day.
 */
export function resolvePhase(schedule, now = new Date()) {
  const s = schedule && Array.isArray(schedule.windows) && schedule.windows.length
    ? schedule
    : DEFAULT_SCHEDULE;
  // A cancelled or break week is 'off' whatever the clock says, so the calm
  // late-phase banner treatment and the checkout board's pickup window behave
  // on a snow-day cancellation exactly as they do on a Tuesday. The projector
  // already knew this; now the lobby TV does too (#342).
  if (isNoClubDate(s, dateKey(now))) return 'off';
  if (now.getDay() !== s.meetingDay) return 'off';
  const mins = now.getHours() * 60 + now.getMinutes();
  for (const w of s.windows) {
    const start = parseHM(w.start);
    const end = parseHM(w.end);
    if (start !== null && end !== null && mins >= start && mins < end) return w.phase;
  }
  const first = parseHM(s.windows[0]?.start);
  if (first !== null && mins < first) return 'countdown';
  return 'shutdown';
}

/**
 * Live banners arriving after the ceremony has started get the calm
 * treatment: the room is mid-program, so no confetti cannon and a
 * ducked chime.
 */
export function isLatePhase(phase) {
  return phase === 'ceremony' || phase === 'game-time' || phase === 'closing';
}
