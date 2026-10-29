import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ZeroAnimationContext } from '../../lib/motion.jsx';

// ─────────────────────────────────────────────────────────────
// The Awana Grand Prix (owner 2026-10-29: "The flat brand one is the one that
// I wanted to keep. Get that one set to show up on the displays starting in
// January."). Not a showreel drawn here but a 30 s silent video, the flat
// brand cut made by video/grand-prix/ (1920x1080, 60 fps, H.264, moov first),
// shown from 2027-01-01 through race day (src/lib/promos.js).
//
// Its story, in video time:
//   0     colour lanes build; "The Awana Grand Prix is back."; a pinewood race;
//         "This year, grown-ups race too." / "Kids race first. Then Trek,
//         Journey and adults race together."
//   ~20.5 the lobby's own orange waves sweep the race away, and from ~21.5 the
//         picture IS the lobby's normal screen in the sky theme (field, clouds
//         and doodles at rest, the corner tab with the two-line logo, the
//         house waves at rest), with the end card's words on it:
//         AWANA GRAND PRIX, Kids, Trek, Journey & Adults, register by Sunday,
//         Feb 28, build day Saturday, March 6, race day Saturday, March 20,
//         2:00 pm; readable and still ~22.4 to ~28.4.
//   ~29   the words have gone: the last second is the bare lobby screen
//         (video/grand-prix/concepts/lobby-plate-sky.png, mean difference ~0).
//
// So it hands back to the lobby with nothing on screen changing (the
// descriptor's `exit: 'seamless'`; ManualSlideshow and lobbyMotion.js do the
// rest): once it is playing, the scene behind it comes to rest (`onScene({
// rest })`: the sunflower wave's roll and the field's drift, all hidden under
// it); at `homeAt`, inside the still end card, the scene's corner tab and
// house waves come home over it, exactly where the video draws them
// (`onScene({ home })`); at its end it says so (`onFinished`), and the
// slideshow moves on with an ordinary change: no stinger, the video fades
// away over the identical lobby and the next slide's words land.
//
// Zero animation (?lowPower=1, reduced motion) and `still` play no video:
// the end card at rest (`grand-prix-end.jpg`, the frame at 25.0 s) is the
// finished poster, the M rule's last keyframe. A video that cannot play here,
// errors, never starts or stalls falls back to that same picture for the
// rest of the hold (never a black frame, never a wedge: the slideshow's cap,
// durationSec + SEAMLESS_GRACE_SEC, ends the showing).
// ─────────────────────────────────────────────────────────────

/** The video, beside the page (public/promos/; the site streams it with Range). */
export const GRAND_PRIX_SRC = './promos/grand-prix.mp4';
/** The end card at rest: the zero-animation picture and the fallback. */
export const GRAND_PRIX_STILL = './promos/grand-prix-end.jpg';

/**
 * Seconds. `homeAt`: video time the chrome comes home over it (the lobby is
 * drawn, still, from ~21.5). `waitMax`: how long it may take to start once
 * asked. `stall`: how long its clock may stand still while playing.
 */
export const GRAND_PRIX = Object.freeze({ homeAt: 23, waitMax: 6, stall: 4 });

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
 * @param {{
 *   promo?: any,
 *   lines?: ReadonlyArray<string>,
 *   still?: boolean,
 *   lead?: number,
 *   onScene?: (state: { rest: boolean, home: boolean }) => void,
 *   onFinished?: () => void,
 *   src?: string,
 *   poster?: string,
 *   timing?: typeof GRAND_PRIX,
 * }} props
 * `lead`: seconds to wait before playing (the stinger's swap, when it came in
 * under the wave, so its first frame is its first frame on screen).
 */
export default function GrandPrixPromo({
  still = false, lead = 0, onScene, onFinished,
  src = GRAND_PRIX_SRC, poster = GRAND_PRIX_STILL, timing = GRAND_PRIX,
}) {
  const zero = useContext(ZeroAnimationContext);
  const plain = zero || still;
  const [failed, setFailed] = useState(false);
  const video = useRef(/** @type {HTMLVideoElement | null} */ (null));
  // The newest callbacks, for the one clock below (started once).
  const live = useRef({ onScene, onFinished });
  useLayoutEffect(() => {
    live.current = { onScene, onFinished };
  });
  // Decided at mount: a later change of `lead` (none is expected) never restarts it.
  const [leadSec] = useState(() => Math.max(0, Number(lead) || 0));

  // The picture is the end card at rest, so the scene's chrome is home over it.
  const showStill = plain || failed;
  useEffect(() => {
    if (showStill) live.current.onScene?.({ rest: true, home: true });
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
    let phase = 'lead'; // lead | starting | playing | home | done
    let waited = 0;
    let lastPos = -1;
    let stuckFor = 0;
    let clock = 0;
    const stop = () => {
      phase = 'done';
      clearInterval(clock);
    };
    const fail = () => {
      if (phase === 'done') return;
      stop();
      v.pause?.();
      setFailed(true);
    };
    const tick = () => {
      const now = (performance.now() - born) / 1000;
      const dt = now - last;
      last = now;
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
          live.current.onScene?.({ rest: true, home: false });
          return;
        }
        waited += dt;
        if (waited > timing.waitMax) fail();
        return;
      }
      if (phase === 'playing' || phase === 'home') {
        if (v.ended) {
          if (phase === 'playing') live.current.onScene?.({ rest: true, home: true });
          stop();
          live.current.onFinished?.();
          return;
        }
        if (phase === 'playing' && v.currentTime >= Math.min(timing.homeAt, (v.duration || Infinity) - 1)) {
          phase = 'home';
          live.current.onScene?.({ rest: true, home: true });
        }
        // A video whose clock stops (a stalled download) is let go.
        if (v.currentTime === lastPos) stuckFor += dt;
        else stuckFor = 0;
        lastPos = v.currentTime;
        if (stuckFor > timing.stall) fail();
      }
    };
    v.addEventListener('error', fail);
    clock = setInterval(tick, TICK_MS);
    return () => {
      clearInterval(clock);
      v.removeEventListener('error', fail);
      v.pause?.();
    };
  }, [plain, leadSec, timing]);

  return (
    <div className="promo-slide promo-slide--grand-prix grand-prix-promo" role="img" aria-label={LABEL}>
      {showStill ? (
        <img className="grand-prix-promo__still" src={poster} alt="" draggable={false} />
      ) : (
        <video
          ref={video}
          className="grand-prix-promo__video"
          src={src}
          muted
          playsInline
          autoPlay={leadSec === 0}
          preload="auto"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
