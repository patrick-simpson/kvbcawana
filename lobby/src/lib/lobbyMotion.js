// @ts-check
// The lobby's between-slides choreography (rebrand stage 4b): how one slide
// hands off to the next, and the stinger's timing that a change into or out
// of a held slide rides on. Pure numbers and pure functions only; the
// components that play them are ManualSlideshow, CatalogScene and SlideCopy.
//
// Every value is on the brand rhythm (src/lib/brand.js): one 100 ms beat and
// the four curves. Where the kit's duration table has the right length it is
// used as-is; the rest are counted in beats.

import { DUR, EASE, beats } from './brand.js';
import { ARRIVAL, squishLand, withSquish } from './squish.js';

/* ── The stinger (a change that involves a held slide) ───────────── */

/** The whole sweep: up over the lobby, a short hold, and on up and away. */
export const STINGER_SEC = DUR.stinger * 2 + 0.08;
/** Mid-cover: the wave fills the screen from 47% to 53% of its run. */
export const SWAP_AT = STINGER_SEC * 0.5;

/* ── The hand-off (an ordinary slide to an ordinary slide) ───────── */

/**
 * The approved mockup's `handOff` + `landSlide`, in seconds. The outgoing
 * kicker, words and chip lift away one after another; the house wave swells
 * once; then the incoming kicker lands, its words land one by one and its
 * chip pops last. About one second, end to end.
 */
export const HANDOFF = {
  /** Each outgoing piece lifts away on the exit curve. */
  exit: DUR.exit,
  /** …a beat's worth of stagger between pieces… */
  exitStagger: beats(0.4),
  /** …capped, so a long headline never keeps the next slide waiting. */
  exitSpread: beats(2),
  /** The incoming copy waits this long for the outgoing to clear. */
  hold: beats(5),
  /** After a video fades away (there were no words to lift). */
  reveal: beats(4.5),
  /** The very first slide after the page loads. */
  boot: beats(2),
  kicker: beats(3.6),
  wordAt: beats(1.2),
  wordStagger: beats(0.7),
  word: DUR.settle,
  lineStagger: beats(1),
  chipAt: beats(2.6),
  chip: DUR.pop,
  /** The house wave's one swell, a little after the words start to leave. */
  swellAt: beats(1.8),
  swell: beats(7),
  /** The field's crossfade when two slides have different themes. */
  field: DUR.wipe,
  /** A video or poster fading in or out over the field. */
  media: DUR.wipe,
  /** The corner tab and house waves stepping aside for a poster or video. */
  chrome: DUR.wipe,
};

/** @typedef {'boot' | 'handoff' | 'wipe' | 'reveal'} Via */
/** @typedef {'copy' | 'video' | 'promo' | 'flagship' | null} SlideKind */

/**
 * How long a newly mounted slide's copy holds before its first piece lands.
 * A wipe lands after the stinger has gone (the mockup's `wipe`), so the words
 * arrive on a clear screen rather than under the wave.
 * @param {Via} via
 */
export function entranceHold(via) {
  if (via === 'wipe') return STINGER_SEC;
  if (via === 'handoff') return HANDOFF.hold;
  if (via === 'reveal') return HANDOFF.reveal;
  return HANDOFF.boot;
}

/**
 * When outgoing piece `i` of `n` starts to lift: one stagger step each, but
 * never later than the spread cap, so the whole exit is over by
 * `exitSpread + exit` however long the headline.
 * @param {number} i
 * @param {number} n
 */
export function exitDelay(i, n) {
  if (n <= 1 || i <= 0) return 0;
  return Math.min(HANDOFF.exitStagger, HANDOFF.exitSpread / (n - 1)) * i;
}

/**
 * The swell's keyframes: flat until `swellAt`, up to its crest at 45% of the
 * swell, back to rest. Its last keyframe is the resting wave, which is the
 * frame ?lowPower=1 shows.
 * @param {string} crest the crest's offset (e.g. '-16%')
 */
export function swellKeyframes(crest) {
  const total = HANDOFF.swellAt + HANDOFF.swell;
  return {
    animate: { y: ['0%', '0%', crest, '0%'] },
    transition: {
      duration: total,
      times: [0, HANDOFF.swellAt / total, (HANDOFF.swellAt + HANDOFF.swell * 0.45) / total, 1],
      ease: /** @type {any[]} */ (['linear', EASE.settle, EASE.settle]),
    },
  };
}

/**
 * "Hold, then land" as one keyframe list per value: sit at `from` for `at`
 * seconds, then move to `to` over `dur` on `ease`. One animation from the
 * first frame, rather than `initial` plus a `delay`, because framer-motion
 * runs opacity on the browser's own timeline and a delayed opacity can paint
 * at its target before its beat (measured on this build; see CLAUDE.md's
 * promo notes). The last keyframe is always `to`, which is what ?lowPower=1
 * jumps to.
 *
 * @param {number} at seconds of hold
 * @param {number} dur seconds of movement
 * @param {Record<string, number | string>} from
 * @param {Record<string, number | string>} to
 * @param {any} ease the moving segment's curve
 */
export function holdThenLand(at, dur, from, to, ease) {
  const hold = Math.max(0, at);
  const total = hold + dur;
  /** @type {Record<string, Array<number | string>>} */
  const animate = {};
  for (const key of Object.keys(to)) {
    const start = key in from ? from[key] : to[key];
    animate[key] = hold > 0 ? [start, start, to[key]] : [start, to[key]];
  }
  const transition = hold > 0
    ? { duration: total, times: [0, hold / total, 1], ease: ['linear', ease] }
    : { duration: total, ease };
  return { initial: { ...from }, animate, transition };
}

/**
 * The outgoing half: hold at `from` for `at`, then go to `to` over `dur`.
 * Built the same way as holdThenLand, for exit variants.
 * @param {number} at
 * @param {number} dur
 * @param {Record<string, number | string>} from
 * @param {Record<string, number | string>} to
 * @param {any} ease
 */
export function holdThenLeave(at, dur, from, to, ease) {
  const { animate, transition } = holdThenLand(at, dur, from, to, ease);
  return { ...animate, transition };
}

/**
 * Leaving under the stinger: stay exactly as you are until the wave covers
 * the screen, then go in one frame. Nothing lifts or fades where the room
 * could see it half-done.
 * @param {Record<string, number | string>} rest
 * @param {Record<string, number | string>} gone
 */
export function vanishAtSwap(rest, gone) {
  return holdThenLeave(SWAP_AT, 0.01, rest, gone, 'linear');
}

/**
 * @typedef {{
 *   key: string,
 *   special: boolean,
 *   kind: SlideKind,
 *   theme: string,
 * }} SlideShowing
 *
 * @typedef {SlideShowing & {
 *   wipe: boolean,
 *   via: Via,
 *   wipes: number,
 *   swells: number,
 * }} SlideTransition
 */

/**
 * The lobby as it first appears: nothing to hand off from.
 * @param {SlideShowing} showing
 * @returns {SlideTransition}
 */
export function firstTransition(showing) {
  return { ...showing, wipe: false, via: 'boot', wipes: 0, swells: 0 };
}

/**
 * How the lobby got from what it was showing to `next`, captured once per
 * real change. A held slide on either side wipes (the stinger); an ordinary
 * slide after an ordinary slide hands off (words lift, the house wave swells,
 * the next words land); anything after a video reveals. The field keeps its
 * theme under a video or poster, so there is nothing to crossfade when the
 * lobby comes back to the same sky. The two counters key the stinger and the
 * swell, so each change plays each exactly once.
 *
 * @param {SlideTransition} seen
 * @param {SlideShowing} next
 * @returns {SlideTransition}
 */
export function nextTransition(seen, next) {
  if (seen.key === next.key) {
    // The same showing, edited in place (an editor save that re-themes or
    // re-marks the slide on screen): take the new facts, play nothing.
    const theme = next.kind === 'copy' ? next.theme : seen.theme;
    if (seen.special === next.special && seen.kind === next.kind && seen.theme === theme) return seen;
    return { ...seen, special: next.special, kind: next.kind, theme };
  }
  const wipe = seen.special || next.special;
  /** @type {Via} */
  const via = wipe ? 'wipe' : seen.kind === 'copy' ? 'handoff' : seen.kind ? 'reveal' : 'boot';
  const swell = !wipe && seen.kind === 'copy' && next.kind === 'copy';
  return {
    key: next.key,
    special: next.special,
    kind: next.kind,
    theme: next.kind === 'copy' || !seen.theme ? next.theme : seen.theme,
    wipe,
    via,
    wipes: seen.wipes + (wipe ? 1 : 0),
    swells: seen.swells + (swell ? 1 : 0),
  };
}

/* ── The chrome (the corner tab and the house waves) ─────────────── */

/**
 * Where the lobby's chrome is: at HOME, stepped ASIDE (the tab up and out,
 * the waves down and out) or HIDDEN where it stands.
 * @typedef {'home' | 'aside' | 'hidden'} ChromeSpot
 */

/**
 * Where the chrome goes for the slide now showing: home for words; for a
 * video or a poster, aside when it came on an ordinary change and hidden
 * when it came under the stinger. While it is away it stays where it went.
 * @param {ChromeSpot} spot where it is now
 * @param {boolean} away whether the slide now showing wants it out of the way
 * @param {Via | string} via how that slide arrived
 * @returns {ChromeSpot}
 */
export function chromeSpot(spot, away, via) {
  if (!away) return 'home';
  if (spot !== 'home') return spot;
  return via === 'wipe' ? 'hidden' : 'aside';
}

/**
 * One piece of the chrome (`off` is its way out: '-112%' for the tab,
 * '112%' for the waves) going from one spot to another, as framer-motion's
 * animate and transition, or at rest in `to` when `from` is null.
 *
 * Under the stinger it moves only while the wave covers the screen, in one
 * frame at SWAP_AT, both ways, as the mockup's wipe() repaints it; and it
 * goes by opacity, with any move of y hidden behind it. That is not a
 * transform alone because the app honours the OS's reduced motion
 * (MotionConfig reducedMotion="user"), and framer-motion then makes every
 * transform instant, delay and keyframe times and all: a y move timed to the
 * swap jumped at t=0, in plain view, with no stinger to hide it. Opacity
 * keyframes are never reduced, so they hold, then land, on time either way.
 * Otherwise (a video that came or went on an ordinary change) it slides on
 * the wipe curve.
 *
 * @param {ChromeSpot | null} from
 * @param {ChromeSpot} to
 * @param {Via | string} via
 * @param {string} off
 */
export function chromeMove(from, to, via, off) {
  /** @param {ChromeSpot} spot */
  const at = (spot) => ({ y: spot === 'aside' ? off : '0%', opacity: spot === 'hidden' ? 0 : 1 });
  if (!from || from === to) return { animate: at(to), transition: { duration: 0 } };
  const start = at(from);
  const end = at(to);
  if (via === 'wipe') {
    if (start.y !== end.y) start.opacity = 0;
    const { animate, transition } = holdThenLand(SWAP_AT, 0.01, start, end, 'linear');
    return { animate, transition };
  }
  const { animate, transition } = holdThenLand(0, HANDOFF.chrome, start, end, EASE.wipe);
  return { animate, transition };
}

/**
 * @typedef {{ index: number, at: number }} Beat
 * @typedef {{
 *   pieces: number,
 *   kicker: Beat | null,
 *   tokens: Beat[],
 *   sub: Beat | null,
 *   chip: Beat | null,
 * }} CopyBeats
 */

/**
 * The beat sheet for one slide's copy: when each piece lands (seconds after
 * mount) and its place in the exit order (kicker, headline, the supporting
 * line, the chip). The kicker lands first; a shouted headline word by word,
 * a read one row by row (every token on a row shares its beat and leaves
 * with it); the supporting line after them and the chip pops last, all after
 * `hold`. One beat per headline token, whatever the layout, so a refit (a web
 * font landing late) can re-lay the same elements out without replaying them.
 *
 * @param {{ kicker: unknown, headline: { mode: 'shout' | 'read', tokens: unknown[], starts: number[] }, sub: unknown, chip: unknown }} fit
 * @param {number} hold
 * @returns {CopyBeats}
 */
export function copyBeats(fit, hold) {
  let index = 0;
  const kicker = fit.kicker ? { index: index++, at: hold } : null;
  const { mode, tokens, starts } = fit.headline;
  const shout = mode === 'shout';
  // The row each token starts on (a token cut across rows starts on its first).
  /** @type {number[]} */
  const rowOf = [];
  let row = 0;
  for (let t = 0; t < tokens.length; t += 1) {
    const first = starts.indexOf(t);
    if (first >= 0) row = first;
    rowOf.push(row);
  }
  /** @type {Map<number, number>} */
  const rowIndex = new Map();
  const tokenBeats = tokens.map((_, t) => {
    if (shout) return { index: index++, at: hold + HANDOFF.wordAt + HANDOFF.wordStagger * t };
    if (!rowIndex.has(rowOf[t])) rowIndex.set(rowOf[t], index++);
    return { index: /** @type {number} */ (rowIndex.get(rowOf[t])), at: hold + HANDOFF.wordAt + HANDOFF.lineStagger * rowOf[t] };
  });
  const landed = hold + HANDOFF.wordStagger * (shout ? tokens.length : starts.length);
  const sub = fit.sub ? { index: index++, at: landed + HANDOFF.wordAt + HANDOFF.lineStagger } : null;
  const chip = fit.chip ? { index: index++, at: landed + HANDOFF.chipAt + (sub ? HANDOFF.lineStagger : 0) } : null;
  return { pieces: index, kicker, tokens: tokenBeats, sub, chip };
}

/* ── Letters and words that grow as they land ─────────────────────── */

/**
 * The three letter entrances a name can be dealt (src/lib/nameAccent.js,
 * #336), re-cut to the brand's settle curve; `i` is the letter's place in the
 * whole name. `pop` and `wave` grow from 0.7 / 0.85, which is why their squish
 * waits for ARRIVAL.
 */
export const LETTER_FROM = {
  pop: () => ({ opacity: 0, y: '0.55em', scale: 0.7 }),
  wave: (/** @type {number} */ i) => ({ opacity: 0, y: `${(0.5 * Math.sin(i * 0.9 + 0.4)).toFixed(3)}em`, scale: 0.85 }),
  drop: () => ({ opacity: 0, y: '-0.6em', scale: 1 }),
};
export const LETTER_TO = { opacity: 1, y: '0em', scale: 1 };

/**
 * One piece of a name (a letter, or a word of a long name) landing on its
 * beat: one "hold, then land" keyframe list with the squish composed on, so
 * the squash ripples across the name at the letter stagger. It squashes at
 * arrival (see ARRIVAL), so the drawn height never goes under the name's cap.
 * @param {{ at: number, dur: number, from: Record<string, number | string> }} beat
 */
export const letterEnter = ({ at, dur, from }) => withSquish(
  holdThenLand(at, dur, from, LETTER_TO, EASE.settle),
  squishLand(at, 'name', dur, ARRIVAL),
);

/** How a headline token lands, per the layout it was first fitted in. */
export const WORD_FROM = {
  shout: { opacity: 0, y: '0.45em', scale: 0.85 },
  read: { opacity: 0, y: '0.45em', scale: 1 },
};
export const WORD_TO = { opacity: 1, y: '0em', scale: 1 };

/**
 * A headline word landing at `at`. A shouted word squashes onto its baseline
 * at arrival (see ARRIVAL); a read word only lands.
 * @param {number} at
 * @param {number} dur
 * @param {'shout' | 'read'} landing
 */
export const wordLanding = (at, dur, landing) => withSquish(
  holdThenLand(at, dur, WORD_FROM[landing], WORD_TO, EASE.settle),
  landing === 'shout' ? squishLand(at, 'text', dur, ARRIVAL) : null,
);
