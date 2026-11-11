// ─────────────────────────────────────────────────────────────
// The promo kit: the timing helpers the season promos are built from.
//
// Each showreel poster is a piece of motion design that ends on its own
// finished printed poster (the Veterans Day poster and the snow-alerts slide
// are the ones in this folder today). What they share is below: the easing
// curves, the beat helpers and a seeded random. The fall 2026 posters had
// more parts here (the church wordmark, the countdown chip, the rotating
// detail line, the grain and vignette layers, a screen shake, the slime
// splat); they went with those posters on 2026-11-10 and are in git history.
//
// Rules every poster keeps (CLAUDE.md, "Season promos, snow alerts, flagship"):
//   • Every animated element is M.* from src/lib/motion.jsx, never
//     framer-motion's `motion`, so ?lowPower=1 freezes it.
//   • Beats are KEYFRAMES (landsAt / keyframes below), never `initial` plus
//     a long `delay`: framer-motion runs opacity on the browser's own
//     timeline and everything else on its JS frameloop, so an element
//     waiting out a long delay can paint at its ANIMATE value long before
//     its beat.
//   • The LAST keyframe of everything is the finished poster. Zero-animation
//     mode jumps straight there, and that is the frame the Pi sits on.
// ─────────────────────────────────────────────────────────────

// The expo-out curve most things land on: fast in, hard stop.
export const EASE_SLAM = [0.16, 1, 0.3, 1];
// A softer out-curve for things that settle rather than slam.
export const EASE_OUT = [0.22, 1, 0.36, 1];

/**
 * ONE BEAT, as keyframes: hold at the first value until `at` seconds into the
 * hold, then travel through the rest over `dur`, ending on the resting value.
 *
 * @param {number} at seconds into the hold when this lands
 * @param {number} dur how long the landing itself takes
 * @param {Record<string, Array<any>>} values first value, then the landing
 * @param {any} [ease] the curve for the landing segments
 */
export function landsAt(at, dur, values, ease = EASE_SLAM) {
  const total = at + dur;
  const steps = Math.max(...Object.values(values).map((v) => v.length));
  const times = [0];
  for (let i = 0; i < steps; i += 1) times.push((at + (dur * i) / (steps - 1)) / total);
  const initial = {};
  const animate = {};
  for (const [key, frames] of Object.entries(values)) {
    // A value with fewer frames than the busiest one simply waits longer.
    const pad = Array(steps - frames.length).fill(frames[0]);
    animate[key] = [frames[0], frames[0], ...pad, ...frames.slice(1)];
    initial[key] = frames[0];
  }
  // One easing per segment: the hold is linear, every landing step is the curve.
  const eases = ['linear', ...Array(steps - 1).fill(ease)];
  return { initial, animate, transition: { duration: total, times, ease: eases } };
}

/**
 * A whole choreography for one element on ONE clock, in absolute seconds:
 *
 *   keyframes([
 *     [0,   { opacity: 0, x: '-40vw' }],
 *     [2.1, { opacity: 0, x: '-40vw' }],   // hold, nothing yet
 *     [2.6, { opacity: 1, x: '0vw' }],     // in
 *     [6.0, { opacity: 1, x: '0vw' }],     // sit
 *     [6.4, { opacity: 0.3, x: '8vw' }],   // pushed aside
 *     [12,  { opacity: 1, x: '0vw' }],     // the end card (RESTING)
 *   ])
 *
 * For moves landsAt can't say: something that arrives, leaves, and comes
 * back. A prop missing from a frame carries the previous frame's value
 * forward. The first frame must be at 0 and carry every prop; the LAST frame
 * is the resting value ?lowPower=1 freezes on, so make it the finished poster.
 *
 * `ease` is one curve for every segment, or an array with one per segment.
 *
 * @param {Array<[number, Record<string, any>]>} frames
 * @param {any} [ease]
 */
export function keyframes(frames, ease = EASE_OUT) {
  if (!frames.length || frames[0][0] !== 0) throw new Error('keyframes: the first frame must be at 0');
  const total = frames[frames.length - 1][0];
  const keys = Object.keys(frames[0][1]);
  const animate = {};
  const initial = {};
  for (const key of keys) {
    let last = frames[0][1][key];
    animate[key] = frames.map(([, v]) => {
      if (key in v) last = v[key];
      return last;
    });
    initial[key] = frames[0][1][key];
  }
  const times = frames.map(([t]) => (total ? t / total : 0));
  const eases = Array.isArray(ease) && typeof ease[0] !== 'number' ? ease : Array(frames.length - 1).fill(ease);
  return { initial, animate, transition: { duration: total, times, ease: eases } };
}

/**
 * A tiny seeded LCG, so procedural art (splats, star fields, particle
 * layouts) is identical on every device and in every screenshot. Never
 * Math.random in a poster.
 *
 * @param {number} seed
 * @returns {() => number} uniform in [0, 1)
 */
export function seeded(seed) {
  let s = (seed * 2654435761) % 2147483647;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483647;
    return (s < 0 ? s + 2147483647 : s) / 2147483647;
  };
}
