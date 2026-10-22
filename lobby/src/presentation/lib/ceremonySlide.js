// Which slides of the opening deck are the ceremony itself (owner 2026-10-22:
// "the other screens should un duplicate once we get to the pure black
// screen"): the projector's mirror tells the lobby "ceremony" only on these, so
// the lobby, Journey and the classroom stop copying the gym at its blackout.
import { DECKS } from '../config.js';

/**
 * Whether slide `index` of the opening deck is the ceremony: the welcome or a
 * pledge, never the blackout it ends on or past its end (games).
 * @param {number} index
 */
export function ceremonySlide(index) {
  const slide = DECKS.opening[index];
  return !!slide && slide.layout !== 'black';
}
