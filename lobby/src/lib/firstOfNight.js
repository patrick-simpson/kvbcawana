// @ts-check
// "Doors are open" (#335) — the very first child checked in each night gets a
// one-time flourish instead of an ordinary banner-only arrival.
//
// The whole difficulty is that "first of the night" is a claim only a screen
// that was ALREADY AWAKE before doors can honestly make. A lobby TV that boots
// at 6:40pm, mid-program, has no idea who walked in at 6:02 — so it must stay
// quiet rather than crown whoever it happens to see first. Hence the phase
// gate: the flourish is only available while the program has not started
// ('countdown' before the first window, 'off' on a non-club day or a break
// week). Every other phase — ceremony / game-time / closing, and the
// after-hours 'shutdown' fallback — means the evening is already underway.
//
// Privacy: the persisted entry is a DATE STRING and nothing else. No name, no
// count, no club. The toast copy is composed at render time from the arriving
// payload's already-allowlisted first name and is never stored.

const STORAGE_KEY = 'awanaFirstOfNight.v1';

export { STORAGE_KEY as FIRST_OF_NIGHT_KEY };

/**
 * Phases in which the night has demonstrably not started yet, so the next
 * arrival really is the first one. See PHASES in src/lib/schedule.js for the
 * full list; resolvePhase returns 'shutdown' (not 'off') after hours, which is
 * what actually blocks the boots-late-at-night case.
 */
const FIRST_OF_NIGHT_PHASES = ['countdown', 'off'];

/**
 * Local YYYY-MM-DD key. A verbatim mirror of the private `todayKey()` in
 * src/hooks/useTally.js (lines 9-12), duplicated rather than exported from
 * there on purpose: that helper is module-private and widening useTally's
 * public surface for one string formatter would be a worse trade than four
 * repeated lines. schedule.js's own `dateKey()` makes the same call.
 *
 * @param {Date} [now]
 * @returns {string}
 */
function todayKey(now = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * May this arrival claim the night's first check-in?
 *
 * Pure: no storage, no clock, no config. Every gate must pass, and anything
 * unexpected (a missing phase, a non-integer count) falls through to false —
 * the fail-safe direction here is "stay quiet", because a wrong flourish is
 * louder and more confusing than a missing one.
 *
 * @param {{
 *   count?: unknown,          // this device's tally BEFORE the arriving child
 *   phase?: unknown,          // useSchedule's current phase
 *   presentation?: unknown,   // 'live' | 'late' | 'replay'
 *   alreadyFired?: unknown,   // in-memory latch OR today's stored day key
 * }} input
 * @returns {boolean}
 */
export function isFirstOfNight({ count, phase, presentation, alreadyFired } = {}) {
  // A recap replay is history catching up after a reconnect, not an arrival —
  // it must never crown a child who walked in half an hour ago. ('late' is
  // excluded too, but the phase gate below already covers every late phase.)
  if (presentation !== 'live') return false;
  if (!Number.isInteger(count) || count !== 0) return false;
  if (typeof phase !== 'string' || !FIRST_OF_NIGHT_PHASES.includes(phase)) return false;
  if (alreadyFired) return false;
  return true;
}

/**
 * Has this device already spent tonight's flourish? Corrupt, missing or
 * blocked storage all read as "no" — the in-memory latch in App.jsx is what
 * holds the once-per-session guarantee when storage is unavailable.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function hasFiredToday(now = new Date()) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return !!raw && raw.date === todayKey(now);
  } catch {
    return false;
  }
}

/**
 * Remember that tonight's flourish has been used. Stores ONLY a date string.
 *
 * @param {Date} [now]
 * @returns {void}
 */
export function markFiredToday(now = new Date()) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: todayKey(now) }));
  } catch {
    /* storage may be blocked; the in-memory latch still holds for this session */
  }
}

/**
 * Give the night's flourish back. Wired into Settings → "Reset tonight's
 * counter", which is the operator's documented way to undo an afternoon
 * rehearsal that consumed it.
 *
 * @returns {void}
 */
export function clearFirstOfNight() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/**
 * Toast copy, kept here so it is unit-testable — the same arrangement
 * nightMilestoneCopy has in src/lib/milestones.js. Only the first name is
 * interpolated, which is the one name-bearing field `checkin` allowlists.
 *
 * @param {string} firstName
 * @returns {{ label: string, headline: string }}
 */
export function firstOfNightCopy(firstName) {
  return {
    label: 'Doors are open',
    headline: `${firstName} is first in tonight!`,
  };
}
