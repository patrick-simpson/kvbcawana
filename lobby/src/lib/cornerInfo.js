// @ts-check
// The lobby's corner info, one item at a time (owner, 2026-09-27: "the lower
// right corner and upper right corner info can exist, but should only show
// one at a time, flipping in sequence with next slides and not showing up on
// paused slides. They should only update on each slide load.").
//
// Pure half: which items exist right now, which comes next, and the frozen
// snapshot of its value taken at a slide load. src/hooks/useCornerItem.js
// owns the state; App.jsx decides when a "slide load" happens and when the
// corner is hidden (a slide that holds check-ins, or the overlay feed).
//
// Problem indicators are NOT corner info: the connection / printer / name
// fault sticker keeps showing whenever there is a problem, whatever slide is
// up, because a dead pipe must never be silent.

import { weatherPresentation } from './weather.js';

/**
 * 12-hour clock parts for a timestamp, in the screen's own local time.
 * @param {number} ms
 * @returns {{ time: string, meridiem: 'AM' | 'PM' }}
 */
export function formatClock(ms) {
  const d = new Date(ms);
  const hours24 = d.getHours();
  const meridiem = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return { time: `${hours12}:${minutes}`, meridiem };
}

/** @typedef {'clock' | 'tally' | 'weather'} CornerId */

/**
 * `correction` is a tally reconciliation the room has not seen yet (#351): a
 * broadcast that moved the count by more than one. It rides into the next
 * tally snapshot, so "synced with the check-in desk" always sits under the
 * CORRECTED number, frozen with it, rather than under whatever number the
 * corner happened to be holding when the broadcast landed.
 *
 * @typedef {{
 *   clock: boolean,
 *   tally: number,
 *   weather: { temp: number, code: number, isDay?: boolean, units?: string } | null,
 *   correction?: object | null,
 *   stillHere?: number | null,
 * }} CornerSource
 *
 * `stillHere` (owner, 2026-10-01) is how many children are not checked out
 * yet, during pickup, while the board is naming them (checkoutBoard.js
 * stillHereCount): then the tally's slot counts DOWN instead, under the
 * label PICKUP. null the rest of the time, when the slot is tonight's count.
 *
 * `glyph` is the weather's sky doodle (weatherPresentation's icon), frozen
 * with the rest of the snapshot so the doodle and the words always agree.
 *
 * @typedef {{
 *   id: CornerId, label: string, value: string, spoken: string, corner: 'top' | 'bottom',
 *   note?: string | null, correction?: object | null, glyph?: string,
 * }} CornerSnapshot
 */

/** Under the tally when it carries a correction (#351). */
export const TALLY_SYNC_NOTE = 'synced with the check-in desk';

/** Under the pickup count: what the number is, and never "in the building". */
export const STILL_HERE_NOTE = 'not checked out yet';

/** @param {CornerSource} src */
const counting = (src) => typeof src.stillHere === 'number' && Number.isFinite(src.stillHere);

/**
 * The items that have something to say right now, in rotation order. The
 * tally waits for the night's first check-in, and the weather for a reading:
 * an empty chip is worse than no chip.
 * @param {CornerSource} src
 * @returns {CornerId[]}
 */
export function cornerIds(src) {
  /** @type {CornerId[]} */
  const ids = [];
  if (src.clock) ids.push('clock');
  if (counting(src) || (Number.isFinite(src.tally) && src.tally > 0)) ids.push('tally');
  if (src.weather && Number.isFinite(src.weather.temp)) ids.push('weather');
  return ids;
}

/**
 * The item after `current`, wrapping; the first one when `current` is gone
 * (its data vanished) or there was none; null when nothing exists.
 * @param {CornerId[]} ids
 * @param {CornerId | null} current
 * @returns {CornerId | null}
 */
export function nextCornerId(ids, current) {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  return i === -1 ? ids[0] : ids[(i + 1) % ids.length];
}

/**
 * The item's value frozen at this moment: the corner does not tick between
 * slide loads. Clock and tally sit bottom-right, the weather top-right,
 * where the catalog pages keep them.
 * @param {CornerId} id
 * @param {CornerSource} src
 * @param {number} now
 * @returns {CornerSnapshot | null}
 */
export function snapshotCorner(id, src, now) {
  if (id === 'clock') {
    const { time, meridiem } = formatClock(now);
    return { id, label: 'Right now', value: time, spoken: `The time is ${time} ${meridiem}`, corner: 'bottom' };
  }
  if (id === 'tally' && counting(src)) {
    const n = Math.max(0, Math.round(/** @type {number} */ (src.stillHere)));
    return {
      id,
      label: 'Pickup',
      value: String(n),
      spoken: `${n} not checked out yet`,
      corner: 'bottom',
      note: STILL_HERE_NOTE,
      correction: null,
    };
  }
  if (id === 'tally') {
    const n = Math.max(0, Math.round(src.tally));
    const correction = src.correction ?? null;
    return {
      id,
      label: 'Tonight',
      value: String(n),
      spoken: correction ? `${n} checked in tonight, ${TALLY_SYNC_NOTE}` : `${n} checked in tonight`,
      corner: 'bottom',
      note: correction ? TALLY_SYNC_NOTE : null,
      correction,
    };
  }
  if (id === 'weather' && src.weather) {
    const { label, icon } = weatherPresentation(src.weather.code, src.weather.isDay);
    const temp = Math.round(src.weather.temp);
    return { id, label, value: `${temp}°`, spoken: `${temp} degrees, ${label}`, corner: 'top', glyph: icon };
  }
  return null;
}
