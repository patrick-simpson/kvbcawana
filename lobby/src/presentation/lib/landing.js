// @ts-check
// How type arrives and leaves on the projector, as framer-motion keyframe
// lists. Pure data, so the choreography is testable without a browser.
//
// Why keyframes and not `initial` plus a `delay`: framer-motion runs opacity
// on the browser's own animation timeline and everything else on its JS
// frameloop, so an element waiting out a delay can paint at its target
// opacity before its beat (measured on the signage build; see CLAUDE.md's
// promo notes). "Hold, then land" as one keyframe list cannot be
// reinterpreted, and its LAST value is always the finished design, which is
// what ?vr=1 and reduced motion jump straight to.

import { DUR, EASE } from './motion-tokens.js';

/** How far a word rises as it lands (and climbs as it leaves). */
export const RISE = '0.5em';

/**
 * Hold at `from` for `at` seconds, then move to `to` over `dur` on `ease`.
 * A `from` of null is framer-motion's "wherever it is now" (see FROM_NOW).
 * @param {number} at
 * @param {number} dur
 * @param {Record<string, number | string | null>} from
 * @param {Record<string, number | string>} to
 * @param {any} ease
 * @returns {Record<string, any>} a framer-motion target with its own transition
 */
export function holdThen(at, dur, from, to, ease) {
  const hold = Math.max(0, at);
  const total = hold + dur;
  /** @type {Record<string, any>} */
  const target = {};
  for (const key of Object.keys(to)) {
    const start = key in from ? from[key] : to[key];
    target[key] = hold > 0 ? [start, start, to[key]] : [start, to[key]];
  }
  target.transition = hold > 0
    ? { duration: total, times: [0, hold / total, 1], ease: ['linear', ease] }
    : { duration: total, ease };
  return target;
}

/**
 * When part `i` of a slide lands, in seconds after `hold`: the first four
 * parts (the kicker and the headline's first words) one beat-ish apart, the
 * rest (a pledge's thirty words) in a quick ripple behind them. The approved
 * mockup's cadence.
 * @param {number} i
 * @param {number} hold
 */
export function landsAt(i, hold = 0) {
  const n = Math.max(0, i);
  return hold + (n < 4 ? n * 0.08 : 0.32 + (n - 4) * 0.018);
}

/**
 * When part `i` starts to leave: one after another, top to bottom, and never
 * more than twelve steps behind the first so a long pledge clears quickly.
 * @param {number} i
 */
export function leavesAt(i) {
  return Math.min(Math.max(0, i), 12) * 0.022;
}

/** The last part's leave finishes by this (seconds): the incoming slide waits for it. */
export const LEAVE_TOTAL = leavesAt(12) + DUR.exit;

/**
 * Where a leave starts: from wherever the part is NOW (null is framer-motion's
 * "current value" keyframe), never from its landed state. A press that
 * catches a slide before all of it has landed (a quick double press, or one
 * that coincides with an auto-advance) sends parts that are still invisible
 * straight to `gone`; an explicit 1 would paint every one of them at full
 * strength for a frame and then fade it, flashing text the room never saw.
 * A part that has landed is at 1 anyway, so an ordinary change is unchanged.
 *
 * A landing starts from here too. A press straight back (Space, then ← to
 * correct an overshoot) returns a slide that is still leaving, and a landing
 * that started from an explicit 0 blanked it for a frame and ran its whole
 * entrance again. A part that has just mounted is already at its `hidden`
 * values, so an ordinary landing is unchanged.
 */
export const FROM_NOW = null;

/**
 * The three states of one part of a slide (a kicker, a headline word, a
 * body word), as variants a slide's parts inherit from their slide:
 * `hidden` (before it lands), `shown` (landed) and `gone` (left upward).
 * @param {number} i the part's place in reading order
 * @param {number} hold seconds the slide waits before its first part lands
 */
export function partVariants(i, hold = 0) {
  return {
    hidden: { opacity: 0, y: RISE },
    shown: holdThen(landsAt(i, hold), DUR.settle, { opacity: FROM_NOW, y: FROM_NOW }, { opacity: 1, y: '0em' }, EASE.settle),
    gone: holdThen(leavesAt(i), DUR.exit, { opacity: FROM_NOW, y: FROM_NOW }, { opacity: 0, y: `-${RISE}` }, EASE.exit),
  };
}

/**
 * The same states for a slide's ambient layer (particles, doodles): it fades
 * with the type rather than climbing.
 * @param {number} hold
 */
export function ambientVariants(hold = 0) {
  return {
    hidden: { opacity: 0 },
    shown: holdThen(hold, DUR.settle, { opacity: FROM_NOW }, { opacity: 1 }, EASE.settle),
    gone: holdThen(0, LEAVE_TOTAL, { opacity: FROM_NOW }, { opacity: 0 }, EASE.exit),
  };
}
