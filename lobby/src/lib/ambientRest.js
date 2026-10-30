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
  const t = setTimeout(() => stopOnEnd(anim, effect, duration), plan.ms);
  return () => clearTimeout(t);
}

/** Stop `anim` exactly on its loop's nearest end: its active time a whole number of loops. */
function stopOnEnd(/** @type {Animation} */ anim, /** @type {KeyframeEffect} */ effect, /** @type {number} */ duration) {
  anim.pause();
  anim.playbackRate = 1;
  const delay = Number(effect.getTiming().delay) || 0;
  const active = Number(anim.currentTime) - delay;
  anim.currentTime = delay + Math.round(active / duration) * duration;
}

/**
 * Put `anim` at rest AT ONCE (no run home): for a field that appears while
 * the scene is already at rest (the promo's theme fading in over a field
 * brought to rest before it; its rest point is the same picture, since every
 * field's loops share one clock and rest on a loop's end), while it is still
 * unseen. Let go with resumeFromRest.
 * @param {Animation | null} anim
 */
export function holdAtRest(anim) {
  const effect = /** @type {KeyframeEffect | null} */ (anim?.effect ?? null);
  if (!anim || !effect || anim.playState !== 'running') return;
  const duration = Number(effect.getComputedTiming().duration) || 0;
  if (duration) stopOnEnd(anim, effect, duration);
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

/**
 * Whether the lobby scene `scene` (a `.catalog-scene`) is showing its plain
 * screen at rest, so a video whose first frame is that screen can appear over
 * it with nothing on screen changing (GrandPrixPromo.jsx, `enter:
 * 'seamless'`): one field, in `theme`, fully faded in (the outgoing one is
 * gone); no slide words and no other picture (`media`, the one showing, is
 * allowed); the tab's logo fully drawn; and every ambient loop (the field's
 * drift, float and twinkle, the sunflower wave's roll) stopped at rest. A
 * browser without the Web Animations API has no loop to wait for. Measured
 * off the DOM, so it is right whatever got the scene there.
 * @param {Element | null | undefined} scene
 * @param {{ theme?: string, media?: Element | null }} [want]
 */
export function sceneAtRest(scene, { theme, media = null } = {}) {
  if (!scene || typeof scene.querySelectorAll !== 'function') return false;
  const fields = scene.querySelectorAll('.lobby-field');
  if (fields.length !== 1) return false;
  const field = fields[0];
  if (theme && !field.classList.contains(`lobby-field--${theme}`)) return false;
  if (field.classList.contains('is-leaving') || !opaque(field)) return false;
  if (scene.querySelector('.manual-slide-copy .manual-slide')) return false;
  for (const m of scene.querySelectorAll('.lobby-media')) {
    if (!media || !m.contains(media)) return false;
  }
  for (const logo of scene.querySelectorAll('.lobby-tab__logo')) {
    if (!opaque(logo)) return false;
  }
  if (scene.querySelector('.lobby-chrome--logo-away, .lobby-chrome--away')) return false;
  return ambientLoops(scene).every((a) => a.playState !== 'running');
}

/** Drawn at full strength (its computed opacity, transitions included). */
function opaque(/** @type {Element} */ el) {
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return true;
  const o = Number.parseFloat(view.getComputedStyle(el).opacity);
  return !Number.isFinite(o) || o >= 0.999;
}
