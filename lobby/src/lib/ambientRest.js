// @ts-check
// Bringing an ambient CSS loop (app.css .lobby-ambient) to rest, and letting
// it go again, without a jump.
//
// The flagship's 3D intro (FlagshipIntro.jsx) hands the scene's house waves
// over to its video, whose waves are the waves at REST. The sunflower wave
// rolls (lobby-roll, 18 s), so before the hand-over it is brought home: it
// runs on (or back) to the nearest end of its loop, where every ambient loop
// is at rest, a little faster than usual so it arrives in time, and stops
// there. Let go, it carries on from that rest point. Read through the Web
// Animations API (a CSS animation is an Animation); a browser without it, or
// a loop that is not running (zero animation, reduced motion), is left alone.

/**
 * How to get from `progress` (0..1 through a loop of `durationMs`) to the
 * nearest rest point within `withinMs`: the playback rate (negative = back)
 * and how long it takes. Never slower than the loop's own speed.
 * @param {number} progress
 * @param {number} durationMs
 * @param {number} withinMs
 */
export function restPlan(progress, durationMs, withinMs) {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const back = p < 0.5;
  const distance = (back ? p : 1 - p) * durationMs;
  const rate = Math.max(1, distance / Math.max(1, withinMs));
  return { rate: back ? -rate : rate, ms: distance / rate };
}

/**
 * The running CSS animation named `name` on `el`, if any.
 * @param {Element | null | undefined} el
 * @param {string} name
 * @returns {Animation | null}
 */
export function cssAnimation(el, name) {
  const all = typeof el?.getAnimations === 'function' ? el.getAnimations() : [];
  return /** @type {Animation | undefined} */ (all.find((a) => /** @type {any} */ (a).animationName === name)) ?? null;
}

/**
 * Every ambient CSS loop running inside `root` (app.css `.lobby-ambient`: the
 * field's drifting clouds, floating and twinkling doodles). A promo that ends
 * on the lobby at rest (GrandPrixPromo.jsx) brings them all home under it.
 * @param {Element | null | undefined} root
 * @returns {Animation[]}
 */
export function ambientLoops(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return [...root.querySelectorAll('.lobby-ambient')].flatMap((el) => (
    typeof el.getAnimations === 'function'
      ? el.getAnimations().filter((a) => typeof /** @type {any} */ (a).animationName === 'string')
      : []
  ));
}

/**
 * Bring `anim` to rest within `withinMs` and hold it there. Returns a
 * cancel function (stops the settling where it is, nothing else).
 * @param {Animation | null} anim
 * @param {number} withinMs
 */
export function settleToRest(anim, withinMs) {
  const effect = /** @type {KeyframeEffect | null} */ (anim?.effect ?? null);
  if (!anim || !effect || anim.playState !== 'running') return () => {};
  const timing = effect.getComputedTiming();
  const duration = Number(timing.duration) || 0;
  if (!duration) return () => {};
  const plan = restPlan(timing.progress ?? 0, duration, withinMs);
  anim.playbackRate = plan.rate;
  const t = setTimeout(() => {
    anim.pause();
    anim.playbackRate = 1;
    // Exactly on the loop's end: its active time a whole number of loops.
    const delay = Number(effect.getTiming().delay) || 0;
    const active = Number(anim.currentTime) - delay;
    anim.currentTime = delay + Math.round(active / duration) * duration;
  }, plan.ms);
  return () => clearTimeout(t);
}

/**
 * Let a loop held by settleToRest carry on from where it rests.
 * @param {Animation | null} anim
 */
export function resumeFromRest(anim) {
  if (!anim) return;
  anim.playbackRate = 1;
  if (anim.playState === 'paused') anim.play();
}
