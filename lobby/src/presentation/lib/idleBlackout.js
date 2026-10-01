// @ts-check
// Idle blackout for the end-of-night screen.
//
// shared/schedule.json's shutdown window runs 19:35 to midnight, so
// "SEE YOU NEXT WEEK!" animates on a projector for over four hours
// every club night, almost all of it to an empty room. After a long
// idle stretch the screen drops to solid black to save lamp hours; any
// key or mouse movement brings it straight back.
//
// Pure arithmetic on purpose — the thresholds are the whole feature.

/** Minutes of no keyboard/mouse activity before the screen goes black. */
export const BLACKOUT_AFTER_MIN = 20;

/**
 * Should the screen be black after `idleMs` of no activity?
 *
 * Guards, in order of how badly each would fail on a wall:
 * - A non-finite idle (a clock that has not resolved yet) is never
 *   blackout — "I don't know" must render the screen, not the void.
 * - Negative idle (the `?now=` clock jumped backwards) is not idle.
 * - A zero or negative timeout means "disabled", never "black now":
 *   the failure mode of a mis-set value has to be a visible screen.
 *
 * @param {number} idleMs milliseconds since the last key or mouse move
 * @param {number} [timeoutMin] minutes of idle to allow
 * @returns {boolean}
 */
export function shouldBlackout(idleMs, timeoutMin = BLACKOUT_AFTER_MIN) {
  if (!Number.isFinite(idleMs) || !Number.isFinite(timeoutMin)) return false;
  if (timeoutMin <= 0) return false;
  return idleMs >= timeoutMin * 60_000;
}
