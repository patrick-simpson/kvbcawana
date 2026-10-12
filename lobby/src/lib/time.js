// @ts-check
// Local-time formatting shared across the signage app. Every helper reads the
// screen's own clock (never UTC), so a date key is the calendar day the room
// is actually in. Dependency-free on purpose: the phase engine (schedule.js)
// and the stores that key on a night both import it.

/**
 * Two-digit, zero-padded number: 7 -> "07", 12 -> "12".
 *
 * @param {number} n
 * @returns {string}
 */
export function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Local-time YYYY-MM-DD key for a Date: the screen's calendar day.
 *
 * @param {Date} [d]
 * @returns {string}
 */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
