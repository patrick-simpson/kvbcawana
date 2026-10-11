// @ts-check
// "COUNTS RISING, NO NAMES — CHECK THE PRINTER": the one alarm for a print
// server that publishes counts but not the sealed name events (most often a
// missing display key on its side). It must fire only on what its words say:
// the count RISING, while THIS screen watches, with no name arriving.
//
// It used to fire whenever tonight's count was above zero and no name had
// reached this screen for COUNTS_WITHOUT_NAMES_MS. But the sync Worker hands a
// connecting screen the last `tonight` frame it holds (live.js, REPLAYED), so
// on a Sunday every screen read last Wednesday's 120 as "counts" and, six
// minutes later, told the lobby to check a printer that was fine. A screen
// opened mid-evening did the same: the names had all come and gone before it
// was watching. (Owner report, 2026-10-11.)
//
// So: the first fresh frame is a baseline (like the night milestones), a
// stale frame is ignored, and only a rise this screen sees, with no name
// within NAME_SLACK_MS before it, starts the clock. Any name clears it. The
// printer's `tally` and sealed `checkin` arrive in either order (CLAUDE.md,
// "Tonight counter"), hence the slack on the near side; a name after the
// rise simply clears it.

export const NAME_SLACK_MS = 60 * 1000;

/** @typedef {{ last: number|null, riseAt: number|null }} CountWatch */

/** @type {CountWatch} */
export const COUNT_WATCH_START = Object.freeze({ last: null, riseAt: null });

/**
 * Fold one `tonight` frame into the watch.
 * @param {CountWatch} state
 * @param {{ count: number, fresh: boolean, now: number, lastNameAt: number|null|undefined }} frame
 * @returns {CountWatch}
 */
export function watchCounts(state, { count, fresh, now, lastNameAt }) {
  if (!fresh) return state;
  if (state.last == null || count < state.last) return { last: count, riseAt: null };
  if (count === state.last) return state;
  const named = typeof lastNameAt === 'number' && now - lastNameAt <= NAME_SLACK_MS;
  return { last: count, riseAt: named ? state.riseAt : (state.riseAt ?? now) };
}

/**
 * A name reached this screen: names are flowing, whatever the count did.
 * @param {CountWatch} state
 * @returns {CountWatch}
 */
export function nameArrived(state) {
  return state.riseAt == null ? state : { ...state, riseAt: null };
}

/**
 * Show the alarm? Only after a rise has gone unnamed for `afterMs`, while the
 * count is still fresh (a printer that went quiet is not this fault).
 * @param {CountWatch} state
 * @param {{ now: number, afterMs: number, fresh: boolean, nameFault: boolean }} opts
 */
export function countsWithoutNamesNow(state, { now, afterMs, fresh, nameFault }) {
  return !nameFault && fresh && state.riseAt != null && now - state.riseAt >= afterMs;
}
