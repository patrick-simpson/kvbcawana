import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FLAGSHIP_DURATION_SEC, FLAGSHIP_INTRO, FLAGSHIP_INTRO_SRC } from '../lib/flagship.js';

// ─────────────────────────────────────────────────────────────
// The 3D intro (owner 2026-10-27: "occasionally replace the awana confetti
// slide with a smooth transition in and out of this video. It should look
// seamless."). Played by FlagshipSlide on the passes ManualSlideshow picks
// (src/lib/flagship.js flagshipIntroLap), over the bounce + glad showing.
//
// The video's first and last frames ARE that slide at rest, the scene's tab
// and house waves included (video/awana-intro: fitted to the lobby as
// tools/measure-lobby.mjs measures it). So nothing on screen changes at
// either hand-over; only which layer is drawing it:
//
//   0       the showing starts as usual (its bounce, ~3.5 s, then still); the
//           video loads unseen. The scene's sunflower wave, which rolls,
//           comes to rest (CatalogScene `ambientRest`): the video's is still.
//   lead    the video starts. On its first frame it fades in OVER the slide
//           (identical), then the scene's tab and waves, which stand over
//           every slide, fade out over it (`onHandOver({ away: true })`) so
//           the video's own can fly off in 3D. Both inside the video's
//           opening still (0.6 s).
//   homeAt  (video time) its world has flattened back into the slide: the
//           scene's tab and waves fade back in over it, still identical.
//   end     the video fades out over the slide, which holds `tail`, then
//           the showing ends (`onFinished`) and the deck moves on.
//
// Names (`paused`): a child's moment plays over a calm field, so the video
// pauses and steps aside like the slide's own logo does, the scene's tab and
// waves come back, and it carries on from where it was once the names are
// done. Anything wrong (a screen it does not fit, no video, a decode error,
// a stall) never holds the deck: the video is let go and the showing ends at
// the flagship's usual FLAGSHIP_DURATION_SEC (or at once if that has passed).
//
// Plain <video> and CSS opacity transitions: nothing here is framer-motion,
// and the intro never runs under zero animation (ManualSlideshow).
// ─────────────────────────────────────────────────────────────

const TICK_MS = 50;

/**
 * @param {{
 *   paused?: boolean,
 *   onHandOver?: (state: { away: boolean, rest: boolean }) => void,
 *   onFinished?: () => void,
 *   src?: string,
 *   timing?: typeof FLAGSHIP_INTRO,
 * }} props
 */
export default function FlagshipIntro({ paused = false, onHandOver, onFinished, src = FLAGSHIP_INTRO_SRC, timing = FLAGSHIP_INTRO }) {
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));
  const [shown, setShown] = useState(false);
  const [gone, setGone] = useState(false);
  // The newest props, for the one clock below (it is started once).
  const live = useRef({ paused, onHandOver, onFinished });
  useLayoutEffect(() => {
    live.current = { paused, onHandOver, onFinished };
  });

  useEffect(() => {
    const born = performance.now();
    const since = () => (performance.now() - born) / 1000;
    const fadeMs = timing.fade * 1000;
    let phase = 'lead'; // lead | starting | playing | names | home | tail | done
    let waited = 0; // unpaused seconds spent waiting for the video after `lead`
    let lastTick = since();
    let lastPos = -1;
    let stuckFor = 0;
    let handTimer = 0;
    let clock = 0;
    let away = false;
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };

    const hand = (next) => {
      clearTimeout(handTimer);
      if (away === next) return;
      away = next;
      live.current.onHandOver?.({ away: next, rest: phase !== 'done' });
    };
    const finish = () => {
      if (phase === 'done') return;
      phase = 'done';
      clearInterval(clock);
      hand(false);
      live.current.onHandOver?.({ away: false, rest: false });
      live.current.onFinished?.();
    };
    // Let the video go: back to the slide, end when a plain showing would.
    const letGo = () => {
      if (phase === 'done' || phase === 'tail') return;
      phase = 'tail';
      video.current?.pause?.();
      setShown(false);
      hand(false);
      later(() => setGone(true), fadeMs);
      later(finish, Math.max(fadeMs, (FLAGSHIP_DURATION_SEC - since()) * 1000));
    };
    // Show the video, then (once it is fully over the slide) hand the scene's
    // tab and waves over to it.
    const showVideo = (handOver) => {
      setShown(true);
      if (handOver) {
        clearTimeout(handTimer);
        handTimer = setTimeout(() => hand(true), fadeMs);
      }
    };

    const v = video.current;
    const fits = Boolean(v) && typeof v.canPlayType === 'function'
      && v.canPlayType('video/mp4; codecs="avc1.640028"') !== '';
    if (!fits) {
      // Nothing to play here: the showing is a plain one.
      later(finish, FLAGSHIP_DURATION_SEC * 1000);
      return () => timers.forEach(clearTimeout);
    }
    live.current.onHandOver?.({ away: false, rest: true });
    v.addEventListener('error', letGo);

    const tick = () => {
      const now = since();
      const dt = now - lastTick;
      lastTick = now;
      const names = live.current.paused;
      if (phase === 'lead') {
        if (now < timing.lead || names) return;
        if (v.readyState >= 3) {
          phase = 'starting';
          v.play()?.catch?.(letGo);
          return;
        }
        waited += dt;
        if (waited > timing.waitMax) letGo();
        return;
      }
      if (phase === 'starting') {
        // Its first frame is on screen once its clock has moved.
        if (v.currentTime > 0 && !v.paused) {
          phase = 'playing';
          showVideo(true);
          return;
        }
        waited += dt;
        if (waited > timing.waitMax) letGo();
        return;
      }
      if (phase === 'playing' || phase === 'home') {
        if (names) {
          phase = phase === 'home' ? 'home-names' : 'names';
          v.pause();
          setShown(false);
          hand(false);
          return;
        }
        if (v.ended) {
          phase = 'tail';
          hand(false);
          setShown(false);
          later(() => setGone(true), fadeMs);
          later(finish, timing.tail * 1000);
          return;
        }
        if (phase === 'playing' && v.currentTime >= Math.min(timing.homeAt, (v.duration || Infinity) - 0.3)) {
          phase = 'home';
          hand(false);
        }
        // A video whose clock stops (a stalled download) is let go.
        if (v.currentTime === lastPos) stuckFor += dt;
        else stuckFor = 0;
        lastPos = v.currentTime;
        if (stuckFor > timing.stall) letGo();
        return;
      }
      if ((phase === 'names' || phase === 'home-names') && !names) {
        const home = phase === 'home-names';
        phase = home ? 'home' : 'playing';
        stuckFor = 0;
        if (v.ended) return;
        v.play()?.catch?.(letGo);
        showVideo(!home);
      }
    };
    clock = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(clock);
      clearTimeout(handTimer);
      timers.forEach(clearTimeout);
      v.removeEventListener('error', letGo);
      v.pause?.();
    };
  }, [timing]);

  if (gone) return null;
  return (
    <video
      ref={video}
      className={`flagship-intro${shown ? ' is-shown' : ''}`}
      src={src}
      muted
      playsInline
      preload="auto"
      aria-hidden="true"
      style={{ '--intro-fade': `${timing.fade}s` }}
    />
  );
}
