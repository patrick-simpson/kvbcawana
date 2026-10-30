import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';
import { sceneAtRest } from '../../lib/ambientRest.js';

// ─────────────────────────────────────────────────────────────
// The Awana Grand Prix (owner 2026-10-29: "The flat brand one is the one that
// I wanted to keep. Get that one set to show up on the displays starting in
// January."; then, the same day, restyled in Awana's official Grand Prix
// sub-brand: "make it epic and extremely well produced"; then the torn cut,
// which opens and closes on the lobby itself). Not a showreel drawn here but
// a 33.68 s (2021 frames) silent video made by
// video/grand-prix/concepts/gp-brand/ (1920x1080, 60 fps, H.264, moov first:
// output/gp-brand/grand-prix-torn-1080p60.mp4), shown from 2027-01-01
// through race day (src/lib/promos.js).
//
// Its story, in video time (measured in Chrome against
// video/grand-prix/concepts/lobby-plate-sky.png, 0.32/255 after encoding):
//   0      the lobby's normal screen in the sky theme, at rest (the plate,
//          tab and house waves drawn in), still until `openPlate` 1.0;
//   1.0    the plate strains like paper; 1.80 the first crack, 1.95 it rips,
//          2.17 the halves peel, ~2.4 a half whips past the lens;
//   2.5    the official logo on grainy black, the torn edge to the red, "The
//          Awana Grand Prix", the race film;
//   ~24    the RED end card: the logo, Kids, Trek, Journey & Adults, register
//          by Sunday, Feb 28, build day Saturday, March 6, race day Saturday,
//          March 20, 2:00 pm, the church's two-line logo; still to 30.5;
//   30.5   the torn halves fly back over it, 31.8 the gap closes, 32.3 the
//          tear heals; from 32.75 the picture IS the plate again, to the end.
//
// So it comes in and hands back with nothing on screen changing (the
// descriptor's `enter` and `exit: 'seamless'`; ManualSlideshow and
// lobbyMotion.js do the rest). With `enter` (ManualSlideshow, motion on):
//
//   mount   the deck's ordinary change: the last slide's words lift away and
//           the field turns to sky; the video loads, paused on its first
//           frame and unseen. `onScene({ rest })`: the scene's sunflower roll
//           and the field's drift, float and twinkle stay at rest (the
//           slideshow began bringing them home in the last slide's final
//           3 s, `preRest`) or run home now.
//   ready   once the scene IS the plate at rest (`sceneAtRest`, measured off
//           the DOM: one sky field fully in, no words, no other picture, the
//           tab's logo drawn, every ambient loop stopped) and the video can
//           play, it fades in over it (`fade`, between identical frames),
//   +fade   then the scene's tab and waves step away under it (`onScene({
//           shown })`: they are drawn in the video),
//   +2fade  and it plays, well inside its opening plate (`openPlate`), before
//           the tear. Not ready by `waitMax`: the end card still, as below
//           (the room saw only the lobby until then).
//
// Without `enter` (it came in under the stinger, or the Settings preview) it
// plays from `lead` and the scene behind it rests once it is playing. Either
// way, at `homeAt`, once the closing plate is fully drawn, the scene's corner
// tab and house waves come home over it, exactly where the video draws them
// (`onScene({ home })`); at its end it says so (`onFinished`), and the
// slideshow moves on with an ordinary change: no stinger, the video fades
// away over the identical lobby and the next slide's words land.
//
// Zero animation (?lowPower=1, reduced motion) and `still` play no video:
// the red end card at rest (`grand-prix-end.jpg`, the frame at 27.5 s) is the
// finished poster, the M rule's last keyframe. It is NOT the lobby, so the
// chrome stays away over it (`home: false`); leaving it is the ordinary change
// to the next slide. A video that cannot play here, errors, never starts or
// stalls falls back to that same picture for the rest of the hold (never a
// black frame, never a wedge: the slideshow's cap, durationSec +
// SEAMLESS_GRACE_SEC, ends the showing).
// ─────────────────────────────────────────────────────────────

/** The video, beside the page (public/promos/; the site streams it with Range). */
export const GRAND_PRIX_SRC = './promos/grand-prix.mp4';
/** The end card at rest: the zero-animation picture and the fallback. */
export const GRAND_PRIX_STILL = './promos/grand-prix-end.jpg';

/**
 * Seconds. `homeAt`: video time the chrome comes home over it (the closing
 * plate is fully drawn from 32.75; the tear heals at 32.3). `openPlate`: video
 * time its opening plate (the lobby at rest) holds until, before the strain
 * (the hand-over must be over by then). `fade`: the video's
 * fade in over the identical scene, and the scene's tab and waves stepping
 * away under it (app.css `.lobby-chrome--handed-over`, the same 0.15 s as the
 * flagship intro's). `waitMax`: how long it may take to start once asked (with
 * `enter`, from mount: the scene's rest included). `stall`: how long its
 * clock may stand still while playing.
 */
export const GRAND_PRIX = Object.freeze({ homeAt: 32.85, openPlate: 1.0, fade: 0.15, waitMax: 6, stall: 4 });

const TICK_MS = 50;

// The end card's words, which are the video's (and the still's) only text.
export const DETAILS = Object.freeze({
  default: Object.freeze([
    'Kids, Trek, Journey & Adults',
    'Register by Sunday, Feb 28',
    'Build day: Saturday, March 6 · 2:00 pm',
    'Race day: Saturday, March 20 · 2:00 pm',
  ]),
});

const LABEL = `Awana Grand Prix. ${DETAILS.default.join('. ')}.`;

/**
 * Is the lobby scene this video lies over at rest, in its plate's theme?
 * @param {HTMLVideoElement} v
 * @param {string} theme
 */
function lobbyAtRest(v, theme) {
  const scene = v.closest?.('.catalog-scene');
  return !scene || sceneAtRest(scene, { theme, media: v });
}

/**
 * @typedef {{ rest: boolean, home: boolean, shown: boolean }} PromoScene
 * `rest`: the scene's ambient loops to rest; `home`: its tab and waves home
 * over the picture (the closing plate is up); `shown`: the picture is fully
 * over the scene (with `enter`, the tab and waves step away under it).
 */

/**
 * @param {{
 *   promo?: any,
 *   lines?: ReadonlyArray<string>,
 *   still?: boolean,
 *   lead?: number,
 *   enter?: boolean,
 *   theme?: string,
 *   sceneReady?: (video: HTMLVideoElement) => boolean,
 *   onScene?: (state: PromoScene) => void,
 *   onFinished?: () => void,
 *   src?: string,
 *   poster?: string,
 *   timing?: typeof GRAND_PRIX,
 * }} props
 * `lead`: seconds to wait before playing (the stinger's swap, when it came in
 * under the wave, so its first frame is its first frame on screen).
 * `enter`: it came in on an ordinary change over the lobby itself: wait for
 * the scene to rest (`sceneReady`, the DOM measure by default), then fade in
 * over it and play.
 */
export default function GrandPrixPromo({
  still = false, lead = 0, enter = false, theme = 'sky', sceneReady, onScene, onFinished,
  src = GRAND_PRIX_SRC, poster = GRAND_PRIX_STILL, timing = GRAND_PRIX,
}) {
  const zero = useContext(ZeroAnimationContext);
  const plain = zero || still;
  const [failed, setFailed] = useState(false);
  // With `enter`: the video is fully over the scene (and so may be seen).
  const [shown, setShown] = useState(false);
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));
  // The newest callbacks, for the one clock below (started once).
  const live = useRef({ onScene, onFinished, sceneReady, theme });
  useLayoutEffect(() => {
    live.current = { onScene, onFinished, sceneReady, theme };
  });
  // Decided at mount: a later change of `lead` or `enter` (none is expected)
  // never restarts it.
  const [leadSec] = useState(() => Math.max(0, Number(lead) || 0));
  const [entering] = useState(() => Boolean(enter) && !plain);
  // Whether the room had seen the video before it fell back (a still that
  // replaces the lobby fades in; one that replaces the video is a cut).
  const [wasShown, setWasShown] = useState(false);

  // The picture is the red end card at rest, not the lobby: the scene rests
  // under it and its chrome stays away. Before the frame is painted, so the
  // chrome is never drawn over it.
  const showStill = plain || failed;
  useLayoutEffect(() => {
    if (showStill) live.current.onScene?.({ rest: true, home: false, shown: true });
  }, [showStill]);

  useEffect(() => {
    if (plain) return undefined;
    const v = video.current;
    const playable = Boolean(v) && typeof v.canPlayType === 'function'
      && v.canPlayType('video/mp4; codecs="avc1.640028"') !== '';
    if (!v || !playable) {
      setFailed(true);
      return undefined;
    }
    const born = performance.now();
    let last = 0;
    // settle | showing | handing (with `enter`) | lead | starting | playing | home | done
    let phase = entering ? 'settle' : 'lead';
    let shownAt = 0;
    let waited = 0;
    let lastPos = -1;
    let stuckFor = 0;
    let clock = 0;
    let seen = false;
    const stop = () => {
      phase = 'done';
      clearInterval(clock);
    };
    const fail = () => {
      if (phase === 'done') return;
      stop();
      v.pause?.();
      setWasShown(seen);
      setFailed(true);
    };
    const scene = (/** @type {Partial<PromoScene>} */ s) => live.current.onScene?.({ rest: true, home: false, shown: true, ...s });
    const ready = () => {
      const ask = live.current.sceneReady;
      return ask ? ask(v) : lobbyAtRest(v, live.current.theme);
    };
    const tick = () => {
      const now = (performance.now() - born) / 1000;
      const dt = now - last;
      last = now;
      if (phase === 'settle') {
        // The lobby keeps showing its own plate meanwhile.
        waited += dt;
        if (v.readyState >= 3 && ready()) {
          phase = 'showing';
          shownAt = now;
          seen = true;
          setShown(true);
          return;
        }
        if (waited > timing.waitMax) fail();
        return;
      }
      if (phase === 'showing') {
        if (now - shownAt < timing.fade) return;
        // Fully over the scene: its tab and waves step away under it.
        phase = 'handing';
        scene({ shown: true });
        return;
      }
      if (phase === 'handing') {
        if (now - shownAt < timing.fade * 2) return;
        phase = 'starting';
        waited = 0;
        v.play()?.catch?.(fail);
        return;
      }
      if (phase === 'lead') {
        if (now < leadSec) return;
        phase = 'starting';
        v.play()?.catch?.(fail);
        return;
      }
      if (phase === 'starting') {
        // Its first frame is on screen once its clock has moved.
        if (v.currentTime > 0 && !v.paused) {
          phase = 'playing';
          seen = true;
          scene({ shown: true });
          return;
        }
        waited += dt;
        if (waited > timing.waitMax) fail();
        return;
      }
      if (phase === 'playing' || phase === 'home') {
        if (v.ended) {
          if (phase === 'playing') scene({ home: true });
          stop();
          live.current.onFinished?.();
          return;
        }
        if (phase === 'playing' && v.currentTime >= Math.min(timing.homeAt, (v.duration || Infinity) - 0.5)) {
          phase = 'home';
          scene({ home: true });
        }
        // A video whose clock stops (a stalled download) is let go.
        if (v.currentTime === lastPos) stuckFor += dt;
        else stuckFor = 0;
        lastPos = v.currentTime;
        if (stuckFor > timing.stall) fail();
      }
    };
    v.addEventListener('error', fail);
    // With `enter`, the scene starts coming to rest at once: the video
    // appears only over the plate at rest.
    if (entering) scene({ shown: false });
    clock = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(clock);
      v.removeEventListener('error', fail);
      v.pause?.();
    };
  }, [plain, leadSec, entering, timing]);

  const fadeStill = entering && !wasShown && failed;
  return (
    <div
      className={`promo-slide promo-slide--grand-prix grand-prix-promo${entering ? ' grand-prix-promo--enter' : ''}`}
      role="img"
      aria-label={LABEL}
      style={entering ? { '--gp-fade': `${timing.fade}s` } : undefined}
    >
      {showStill ? (
        <img
          className={`grand-prix-promo__still${fadeStill ? ' grand-prix-promo__still--fade' : ''}`}
          src={poster}
          alt=""
          draggable={false}
        />
      ) : (
        <video
          ref={video}
          className={`grand-prix-promo__video${shown ? ' is-shown' : ''}`}
          src={src}
          muted
          playsInline
          autoPlay={!entering && leadSec === 0}
          preload="auto"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
