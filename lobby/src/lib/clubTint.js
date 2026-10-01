// @ts-check
// "Let the background breathe the arriving club's color" (#349).
//
// The banner has always been club-coloured and the room behind it never was,
// so a Cubbies arrival and a T&T arrival painted the same wall. While a banner
// holds the stage, this hands the background scene that child's own club
// accent to wash over itself; when the banner leaves, the wash fades back out
// (a plain CSS transition in app.css, so .zero-animation-mode's blanket rule
// already reduces it to an instant snap under reduceMotion / ?lowPower=1).
//
// It is OFF by default, because it competes with something the operator chose
// on purpose: a themed night skin is a deliberate look, and a screen dressed
// for Easter should not start flashing pastel club colours because the app
// updated. Turning it on is a decision, the same as the checkout board.
//
// All of the "may the room be tinted right now" judgement lives here, pure, so
// it can be tested exhaustively rather than inferred from App.jsx's render.
import { getClubPalette } from './clubs.js';

/**
 * Background sources that are not ours to tint. A looping video file and an
 * uploaded PowerPoint are somebody else's pixels filling the screen — there is
 * no scene of ours underneath to wash, and painting a colour film over a
 * church's own video would be vandalism, not delight.
 */
export const UNTINTABLE_SOURCES = ['video', 'pptx'];

/**
 * The club accent the background should be breathing, or null for "leave the
 * scene alone".
 *
 * @param {{
 *   enabled?: unknown,          // config.clubTintBackground
 *   active?: unknown,           // is a banner holding the stage right now?
 *   overlay?: unknown,          // ?overlay=1 — an OBS / ProPresenter feed
 *   panicMode?: unknown,        // config.panicMode
 *   backgroundSource?: unknown, // config.backgroundSource
 *   club?: unknown,             // the arriving child's club, as sanitized
 * }} [input]
 * @returns {string|null}
 */
export function clubTintFor({
  enabled, active, overlay, panicMode, backgroundSource, club,
} = {}) {
  // Opt-in only, and only ever while a banner is up.
  if (enabled !== true) return null;
  if (!active) return null;
  // Overlay mode is a transparent keyed feed of banners and confetti alone —
  // the background layer is not even mounted, and tinting a chroma key would
  // break the key.
  if (overlay) return null;
  // Panic mode means "something looks wrong and the room is full": it strips
  // the screen to its reliable core, so it must not add an effect.
  if (panicMode === true) return null;
  if (typeof backgroundSource === 'string' && UNTINTABLE_SOURCES.includes(backgroundSource)) {
    return null;
  }
  // An unknown or misspelled club still tints — getClubPalette falls back to
  // the warm house accent — because a typo in the check-in system should give
  // the room something sensible, not a flash of white.
  return getClubPalette(typeof club === 'string' ? club : '').accent;
}
