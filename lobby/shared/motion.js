// @ts-check
// THE motion table, read straight from the brand kit (brand/tokens.json): one
// beat, four curves and the kit's durations. The lobby (src/lib/brand.js
// re-exports it) and the projector (src/presentation/lib/motion-tokens.js,
// which adds the two timings only the projector has) both take their timing
// from here, so there is one copy of each number. The CSS spellings are the
// custom properties in each app's stylesheet; their tests pin them to these.
//
// Pinned by shared/motion.test.js.

import tokens from './brand/tokens.json';

/** One beat, in seconds (framer-motion's unit). Everything starts on one. */
export const BEAT = tokens.motion.beatMs / 1000;

/** @param {number} n */
export const beats = (n) => Math.round(n * tokens.motion.beatMs) / 1000;

/**
 * The only four curves on screen, as framer-motion cubic-bezier arrays:
 * wipe (color fields and waves), settle (type landing), pop (stickers and
 * chips, a small overshoot) and exit (leaving; exits run faster).
 * @type {{ wipe: number[], settle: number[], pop: number[], exit: number[] }}
 */
export const EASE = tokens.motion.curves;

/** Durations in seconds, keyed like tokens.json's durationsMs. */
export const DUR = /** @type {Record<string, number>} */ (
  Object.fromEntries(Object.entries(tokens.motion.durationsMs).map(([k, ms]) => [k, ms / 1000]))
);
