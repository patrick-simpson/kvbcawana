// @ts-check
// The flagship slide: one permanent, built-in "Welcome to Awana!" piece of
// motion design that leads every pass through the typed slideshow.
//
// It is not stored, published or editable, and has no setting; only the
// clock (flagshipOnAir) takes it off, during Wednesday club: like the calendar slides and the
// promo slot it is derived (here, a constant) and added at the head of the
// deck the slideshow rotates, so an operator's own slides, a published deck
// and the calendar's auto-slides all come after it. Unlike a promo it never
// HOLDS check-ins (holdsCheckIns is false for it): names play over it like
// over any typed slide, and it steps back for them.

export const FLAGSHIP_ID = 'flagship_welcome';

/** How long it holds; its beat sheet (FlagshipSlide.jsx) is written against this. */
export const FLAGSHIP_DURATION_SEC = 10;

export const FLAGSHIP_SLIDE = Object.freeze({
  id: FLAGSHIP_ID,
  type: 'flagship',
  durationSec: FLAGSHIP_DURATION_SEC,
});

/**
 * @param {any} slide
 * @returns {boolean}
 */
export function isFlagshipSlide(slide) {
  return slide?.type === 'flagship';
}

/**
 * The flagship is off the air during club itself: Wednesdays from 6:30 pm up
 * to (not including) 8:30 pm, local time (owner, 2026-09-29). Outside that
 * window it is always in the rotation.
 *
 * @param {Date} [now]
 * @returns {boolean}
 */
export function flagshipOnAir(now = new Date()) {
  if (now.getDay() !== 3) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  return !(minutes >= 18 * 60 + 30 && minutes < 20 * 60 + 30);
}

/**
 * The deck with the flagship slide first (unless it is off the air). Any flagship already in it (there
 * should never be one: nothing else makes them, and the wire's slide
 * allowlist drops the type) is dropped so it can only ever appear once.
 *
 * @template T
 * @param {T[] | null | undefined} deck
 * @param {boolean} [onAir]  flagshipOnAir(now); false leaves it out.
 * @returns {Array<T | typeof FLAGSHIP_SLIDE>}
 */
export function withFlagship(deck, onAir = true) {
  const rest = (deck || []).filter((s) => !isFlagshipSlide(s));
  return onAir ? [FLAGSHIP_SLIDE, ...rest] : rest;
}
