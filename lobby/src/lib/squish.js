// @ts-check
// The soft squish: squash and stretch with a small wobble that ends at rest
// (owner request 2026-09-30, "jelly inspired animations on transitions and
// button pushes"). One physics for everything that squishes: Jelly UI's own
// scale spring (public/vendor/jelly-ui.js, `E(this.scale, this.scaleVelocity,
// 1, 260, 17, t)`, mass 1). Both halves come from it: the keyframe lists the
// lobby's M elements land with (squishLand) and the CSS easing an operator
// button springs back on (releaseEasing).
//
// Pure numbers and pure functions, and it imports NOTHING, on purpose: the
// projector (src/presentation/) may not import the signage's modules, so it
// will take a verbatim copy of this file, pinned equal by a test. The kit
// durations it defaults to are written out below and pinned to
// shared/brand/tokens.json by squish.test.js.
//
// The rules a squish keeps (CLAUDE.md, "Soft squish"):
//   - it is a keyframe list from the first frame (hold at rest until `at`,
//     never `initial` plus a `delay`), and its LAST keyframe is exactly 1 on
//     every axis, which is the frame ?lowPower=1 and the visual baselines show;
//   - it rides framer-motion's per-value transitions (`transition.scaleX` /
//     `transition.scaleY`), so everything else a beat animates keeps its own
//     keyframes and timing byte for byte (withSquish);
//   - scaleY carries the squash; scaleX answers the other way at BULGE of it,
//     which is less than volume-preserving on purpose, so neighbouring letters
//     and words never touch.

/** Jelly UI's scale spring (stiffness N/m, damping N·s/m, mass kg). */
export const SPRING = Object.freeze({ stiffness: 260, damping: 17, mass: 1 });

const OMEGA = Math.sqrt(SPRING.stiffness / SPRING.mass);
/** Damping ratio, about 0.527: underdamped, so it rings a little. */
const ZETA = SPRING.damping / (2 * Math.sqrt(SPRING.stiffness * SPRING.mass));
const OMEGA_D = OMEGA * Math.sqrt(1 - ZETA * ZETA);

/** Seconds between the released spring's extremes (π / ω_d, about 229 ms). */
export const HALF_PERIOD = Math.PI / OMEGA_D;
/** How much of each swing the next one keeps, the other way (about 14.2%). */
export const OVERSHOOT = Math.exp(-ZETA * OMEGA * HALF_PERIOD);

/**
 * @typedef {'text' | 'name' | 'kicker' | 'chip' | 'sticker' | 'plate' | 'figure' | 'wave' | 'press'} SquishKind
 * @typedef {'settle' | 'pop' | 'wipe'} SquishCurve
 * @typedef {{ duration: number, times: number[], ease: string[] }} SquishTiming
 * @typedef {{
 *   scaleX?: number[],
 *   scaleY: number[],
 *   transition: { scaleX?: SquishTiming, scaleY: SquishTiming },
 * }} Squish
 */

/**
 * How far scaleY squashes on impact, per kind. The readability caps: a name
 * never below 0.93, a headline word's bulge (DEPTH x BULGE) never past 3%, the
 * kicker a whisper. `plate` is a toast, a band notice or the status sticker;
 * `figure` a count; `press` an operator's button (PRESS below).
 */
export const DEPTH = Object.freeze({
  text: 0.06, name: 0.07, kicker: 0.03, chip: 0.08, sticker: 0.12, plate: 0.06, figure: 0.04, wave: 0.12, press: 0.08,
});

/**
 * The share of the scaleY swing scaleX answers with, the other way. Figures
 * and waves never change scaleX: a count's digits keep their width, and a
 * wave only breathes up and down.
 */
export const BULGE = Object.freeze({
  text: 0.5, name: 0.5, kicker: 0.5, chip: 0.5, sticker: 0.5, plate: 0.5, figure: 0, wave: 0, press: 0.5,
});

/** A wobble smaller than this is rest. */
export const REST = 0.004;

/**
 * Where a piece landing on each kit curve arrives, as a share of its run:
 * settle is 88% home at 30%, wipe 95% home at 76%, and pop reaches its
 * overshoot's peak (1.098) at 57%. squish.test.js samples the kit's beziers.
 */
export const IMPACT = Object.freeze({ settle: 0.3, pop: 0.57, wipe: 0.76 });

/**
 * A beat that grows as it lands (an entrance's own uniform `scale`, from 0.7
 * or 0.85 up to 1) squashes AT ARRIVAL: passed as squishLand's `curve`, the
 * impact is the very end of its run, where that scale is exactly 1, so what
 * is drawn (scale x scaleY) is never lower than the squish's own scaleY.
 * Squashing at the settle curve's 30% instead stacked the two: a name at
 * 0.896 of its height while fully opaque, against a cap of 0.93.
 */
export const ARRIVAL = 1;

/** The kit durations the helpers default to (tokens.json: settle 520, pop 460). */
const SETTLE_SEC = 0.52;
const POP_SEC = 0.46;

/**
 * An operator's press: squash in over `ms`, then spring back over
 * `releaseMs` on releaseEasing(). The pill's amount is DEPTH.press /
 * BULGE.press; a control that needs a softer (or, small and round, a
 * firmer) squash has its own. app.css carries every number as a `--squish-*`
 * property on :root, and squishCss.test.js pins the two equal.
 */
export const PRESS = Object.freeze({
  ms: 100,
  releaseMs: 750,
  scaleX: 1.04,
  scaleY: 0.92,
  gear: Object.freeze({ scaleX: 1.1, scaleY: 0.88 }),
  tab: Object.freeze({ scaleX: 1.03, scaleY: 0.94 }),
  tile: Object.freeze({ scaleX: 1.02, scaleY: 0.94 }),
  box: Object.freeze({ scaleX: 0.88, scaleY: 0.88 }),
});

/** @param {number} v */
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/**
 * The released spring's position as a share of the way home, t seconds
 * after release: its analytic step response.
 * @param {number} t
 */
export function springProgress(t) {
  const decay = Math.exp(-ZETA * OMEGA * t);
  return 1 - decay * (Math.cos(OMEGA_D * t) + ((ZETA * OMEGA) / OMEGA_D) * Math.sin(OMEGA_D * t));
}

/**
 * The spring's extremes after an impact `depth` deep, as { t (seconds after
 * the impact), v (the squash: scaleY = 1 - v) }: each a half-period after the
 * last and OVERSHOOT of it the other way, until one is smaller than REST,
 * which ends it at rest.
 * @param {number} depth
 * @returns {Array<{ t: number, v: number }>}
 */
export function springPeaks(depth) {
  const peaks = [];
  for (let n = 0; ; n += 1) {
    const v = depth * (-OVERSHOOT) ** n;
    if (Math.abs(v) < REST) {
      peaks.push({ t: n * HALF_PERIOD, v: 0 });
      return peaks;
    }
    peaks.push({ t: n * HALF_PERIOD, v });
  }
}

/**
 * Keyframes and per-value timing from a list of [seconds, squash] frames.
 * @param {Array<[number, number]>} frames
 * @param {string[]} ease one per segment
 * @param {SquishKind} kind
 * @returns {Squish}
 */
function build(frames, ease, kind) {
  const total = frames[frames.length - 1][0];
  /** @returns {SquishTiming} */
  const timing = () => ({ duration: total, times: frames.map(([t]) => t / total), ease: [...ease] });
  const scaleY = frames.map(([, v]) => round4(1 - v));
  const bulge = BULGE[kind];
  if (!bulge) return { scaleY, transition: { scaleY: timing() } };
  return {
    scaleX: frames.map(([, v]) => round4(1 + v * bulge)),
    scaleY,
    transition: { scaleX: timing(), scaleY: timing() },
  };
}

/**
 * A piece landing: hold at rest for `at` seconds, stretch along its travel
 * while it comes in, squash as it arrives (IMPACT of the way through its
 * landing), then ring down on the spring and sit at exactly 1. A pop-curve
 * piece does not stretch: its own `scale` already overshoots, so it squashes
 * at that peak, or it would read as a double bounce. `curve` may instead be
 * the impact as a share of `dur`, for a landing that is not on a kit curve.
 *
 * The hold is a keyframe, never a `delay`, and nothing here depends on
 * anything but `at`, `kind`, `dur` and `curve`, so a caller that fixes those
 * when a piece first appears never re-targets (and so never replays) it.
 *
 * @param {number} at seconds of hold
 * @param {SquishKind} kind
 * @param {number} [dur] the landing's own run (default: the kit's settle)
 * @param {SquishCurve | number} [curve]
 * @returns {Squish}
 */
export function squishLand(at, kind, dur = SETTLE_SEC, curve = 'settle') {
  const hold = Math.max(0, at);
  const impact = typeof curve === 'number' ? curve : IMPACT[curve];
  const hit = hold + dur * impact;
  const depth = DEPTH[kind];
  /** @type {Array<[number, number]>} */
  const frames = [[0, 0]];
  const ease = [];
  if (hold > 0) {
    frames.push([hold, 0]);
    ease.push('linear');
  }
  if (curve !== 'pop') {
    frames.push([(hold + hit) / 2, -depth / 2]);
    ease.push('easeOut');
  }
  springPeaks(depth).forEach(({ t, v }, n) => {
    frames.push([hit + t, v]);
    ease.push(n === 0 ? 'easeIn' : 'easeInOut');
  });
  return build(frames, ease, kind);
}

/**
 * The same squish with no hold, for a value that changes in place (a count
 * that remounts to pop): it squashes as the new value lands.
 * @param {SquishKind} kind
 * @param {number} [dur] (default: the kit's pop)
 * @param {SquishCurve | number} [curve]
 */
export function squishBump(kind, dur = POP_SEC, curve = 'pop') {
  return squishLand(0, kind, dur, curve);
}

/**
 * Bring both axes home from wherever they are (a target that takes over
 * mid-squish, a way out): `null` is framer-motion's "the current value".
 * @param {number} at seconds of hold
 * @param {number} dur
 * @param {any} ease
 */
export function settleScale(at, dur, ease) {
  const hold = Math.max(0, at);
  const total = hold + dur;
  const frames = () => (hold > 0 ? [null, null, 1] : [null, 1]);
  const timing = () => (hold > 0
    ? { duration: total, times: [0, hold / total, 1], ease: ['linear', ease] }
    : { duration: total, ease });
  return { scaleX: frames(), scaleY: frames(), transition: { scaleX: timing(), scaleY: timing() } };
}

/**
 * Compose a squish onto a beat, in either shape framer-motion takes here:
 * `{ initial, animate, transition }` (holdThenLand, landsAt, keyframes) or a
 * target that carries its own nested `transition` (holdThenLeave, a
 * notice's ENTER / BACK, a variant). The squish only ADDS: scaleX / scaleY
 * keyframes, their per-value `transition.scaleX` / `transition.scaleY`, and
 * (beat shape) an `initial` at rest for them. Every existing key, its
 * keyframe array and the top-level timing are handed back untouched, because
 * framer-motion looks a value's timing up as `transition[key]` before
 * falling back to the whole transition. null is the identity.
 *
 * A target without a transition of its own is refused: giving it one would
 * take every other value off the element's `transition` prop.
 *
 * @template {Record<string, any>} T
 * @param {T} beat
 * @param {Squish | ReturnType<typeof settleScale> | null | undefined} squish
 * @returns {T}
 */
export function withSquish(beat, squish) {
  if (!squish) return beat;
  const { transition: per, ...keys } = squish;
  const b = /** @type {Record<string, any>} */ (beat);
  /** @type {any} */
  let out;
  if (b.animate && typeof b.animate === 'object' && !Array.isArray(b.animate)) {
    const rest = Object.fromEntries(Object.keys(keys).map((k) => [k, 1]));
    out = {
      ...b,
      initial: { ...b.initial, ...rest },
      animate: { ...b.animate, ...keys },
      transition: { ...b.transition, ...per },
    };
    return out;
  }
  if (!b.transition || typeof b.transition !== 'object') {
    throw new TypeError('withSquish: a target needs its own transition');
  }
  out = { ...b, ...keys, transition: { ...b.transition, ...per } };
  return out;
}

/**
 * The spring as a CSS `linear()` easing: its step response at `stops` even
 * steps over `ms`, to three places, ending on exactly 1. It does not depend
 * on how deep the press went, so one easing serves both axes. app.css writes
 * this string out literally (a `linear()` behind var() could not fall back),
 * and squishCss.test.js pins the two equal.
 * @param {number} [stops]
 * @param {number} [ms]
 */
export function releaseEasing(stops = 16, ms = PRESS.releaseMs) {
  const values = [];
  for (let i = 0; i <= stops; i += 1) {
    values.push(i === stops ? 1 : Math.round(springProgress(((i / stops) * ms) / 1000) * 1000) / 1000);
  }
  return `linear(${values.join(', ')})`;
}
