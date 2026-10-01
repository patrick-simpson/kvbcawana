// @ts-check
// Wrap-up warnings for the game-time clock.
//
// Game windows are a rotation: T&T hands the gym to Sparks at 6:30,
// Sparks to Puggles & Cubbies at 7:00. Leaders watching a plain
// descending clock regularly run past the boundary, so the last two
// minutes get a named state the view can colour and label.
//
// Pure and free of React/DOM on purpose — the thresholds are the whole
// feature, so they get tested directly.

/** Seconds left when the amber "wrap it up" heads-up starts. */
export const TWO_MINUTE_SECONDS = 120;
/** Seconds left when the red "line them up now" warning starts. */
export const FINAL_THIRTY_SECONDS = 30;

/**
 * @typedef {'none' | 'two-minute' | 'final-thirty'} GameWarning
 */

/**
 * The warning state for a game clock with `seconds` left.
 *
 * Zero (and anything past it) is deliberately `'none'`: the window is
 * over, the room is already changing hands, and a stale "LAST 30
 * SECONDS" badge over a 0:00 clock would be a lie. This matches
 * BigTimer's own `seconds > 0` guard on its urgent treatment.
 *
 * @param {number} seconds
 * @returns {GameWarning}
 */
export function warningFor(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'none';
  if (seconds <= FINAL_THIRTY_SECONDS) return 'final-thirty';
  if (seconds <= TWO_MINUTE_SECONDS) return 'two-minute';
  return 'none';
}

/** Badge copy per state. Said plainly — leaders read this across a gym. */
export const WARNING_LABELS = /** @type {Record<string, string>} */ ({
  'two-minute': 'TWO MINUTES',
  'final-thirty': 'LAST 30 SECONDS',
});

/**
 * Chime intensity per state, matching the countdown screen's split: the
 * heads-up gets the two-note chime, the final call the big three-note
 * one. `playStinger` is a no-op unless the operator armed countdown
 * sounds in QuickNav, so this stays silent by default.
 */
export const WARNING_STINGER_INTENSITY = /** @type {Record<string, number>} */ ({
  'two-minute': 0.5,
  'final-thirty': 1,
});
