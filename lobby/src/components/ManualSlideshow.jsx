import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M, ZeroAnimationContext } from '../lib/motion.jsx';
import { EASE } from '../lib/brand.js';
import {
  HANDOFF, STINGER_SEC, SWAP_AT, firstTransition, holdThenLand, holdThenLeave, nextTransition,
} from '../lib/lobbyMotion.js';
import { slideFrame } from '../lib/lobbyFrame.js';
import CatalogScene from './CatalogScene.jsx';
import SlideCopy from './SlideCopy.jsx';
import Wave from './brand/Wave.jsx';
import PromoSlide from './PromoSlide.jsx';
import FlagshipSlide from './FlagshipSlide.jsx';
import { flagshipIntroLap, introFits, isFlagshipSlide } from '../lib/flagship.js';
import { SEAMLESS_GRACE_SEC, isPromoSlide, promoForLap } from '../lib/promos.js';
import {
  holdsCheckIns,
  isVideoSlide,
  resolveTheme,
  resolveSizeClass,
  slideDurationMs,
  videoSlideTimerMs,
} from '../lib/slides.js';
import { getVideo } from '../lib/videoStore.js';

// If a video can't load (blob missing on this device, decode error,
// IndexedDB blocked) the show skips ahead after this long instead of
// wedging on a black screen.
export const MISSING_VIDEO_SKIP_MS = 4000;

// The stinger: when a transition involves a slide that holds check-ins (a
// promo poster or a marked slide), a full-screen house wave sweeps up over
// the lobby, the slides swap underneath it, and it sweeps on up and away
// (the mockup's "wipe"). Ordinary slide-to-slide changes hand off instead
// (see src/lib/lobbyMotion.js). The swap happens while the wave covers the
// screen, so the slides' own change waits for it.
//
// Where the stinger travels, as a share of its own height: in from below
// the screen, a hold high enough that the back wave's trough clears the top
// edge (at 0% the crest left a band of the old slide showing across the top
// of the TV while the slides swapped), and out past the top, fills and all.
// The fills run 22% below the box (app.css) so the bottom stays covered at
// the hold.
export const STINGER_Y = ['120%', '-14%', '-14%', '-126%'];

function Stinger() {
  return (
    <M.div
      className="slide-stinger"
      aria-hidden="true"
      initial={{ y: STINGER_Y[0] }}
      // Ends off the top: the frame ?lowPower=1 jumps to shows nothing.
      animate={{ y: STINGER_Y }}
      transition={{ duration: STINGER_SEC, times: [0, 0.47, 0.53, 1], ease: [EASE.wipe, 'linear', EASE.wipe] }}
    >
      <Wave className="slide-stinger__wave slide-stinger__wave--back" color="var(--brand-sun)" flip />
      <div className="slide-stinger__fill slide-stinger__fill--back" />
      <Wave className="slide-stinger__wave slide-stinger__wave--front" color="var(--brand-orange)" />
      <div className="slide-stinger__fill slide-stinger__fill--front" />
    </M.div>
  );
}

/**
 * Tracks which slide is up and how the lobby got there, captured once per
 * real change (derived state, the CheckInMoment flip-tracking pattern). The
 * rules are the pure nextTransition() in src/lib/lobbyMotion.js.
 */
function useSlideTransition(showing) {
  const [seen, setSeen] = useState(() => firstTransition(showing));
  const next = nextTransition(seen, showing);
  if (next !== seen) setSeen(next);
  return next;
}

/**
 * A video or a poster over the field. Under the stinger it swaps in (or out)
 * in one frame while the wave covers the screen; otherwise it fades.
 */
function mediaIn(wipe) {
  return wipe
    ? holdThenLand(SWAP_AT, 0.01, { opacity: 0 }, { opacity: 1 }, 'linear')
    : holdThenLand(0, HANDOFF.media, { opacity: 0 }, { opacity: 1 }, 'easeInOut');
}
const MEDIA_VARIANTS = {
  leave: (wipe) => (wipe
    ? holdThenLeave(SWAP_AT, 0.01, { opacity: 1 }, { opacity: 0 }, 'linear')
    : holdThenLeave(0, HANDOFF.media, { opacity: 1 }, { opacity: 0 }, 'easeInOut')),
};

function Media({ wipe, children }) {
  const [enter] = useState(() => mediaIn(wipe));
  return (
    <M.div
      className="manual-slide lobby-media"
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
      variants={MEDIA_VARIANTS}
      exit="leave"
    >
      {children}
    </M.div>
  );
}

/** AnimatePresence, except under zero animation, where a change is a cut. */
function Presence({ zero, custom, children }) {
  if (zero) return children;
  return <AnimatePresence initial custom={custom}>{children}</AnimatePresence>;
}

/**
 * Plays the user's typed slides full-screen behind the check-in moment, on
 * the lobby scene (CatalogScene): one persistent studio (field and chrome)
 * with only the copy changing. Same layering as the setup placeholder
 * (z-index 0), so the check-in moment and confetti stack above.
 *
 * Video slides play muted (kiosk reloads have no user gesture, and
 * unmuted autoplay is blocked). durationSec 0 = play to the end, then
 * advance; >0 = hold that long with the video looping underneath.
 *
 * `paused`: names are on screen, so the slide on screen keeps its place and
 * its remaining time (the slideshow timer stops, it does not restart).
 * `onSlide({ key, special, poster })`: told on every slide change; `special`
 * is whether that slide holds check-ins, `poster` whether it is the promo
 * poster (full-bleed art the band notice steps aside for). A deck that could never move on to an
 * ordinary slide (one slide, or only held ones) never holds, so a child's
 * moment can never wait forever. `still` skips the studio's ambient loops
 * (weak hardware; see BackgroundIframe).
 */
export default function ManualSlideshow({ slides, slideshowDelaySec, clubTint = null, paused = false, onSlide, still = false }) {
  // A step counter that only ever goes UP, rather than an index that wraps:
  // the deck position is `step % length` and the LAP is `step / length`, and
  // the promo slot uses the lap to show a different promo each time round
  // (see src/lib/promos.js for why there is only one slot). Deriving both from
  // one number keeps `advance` a pure state updater — incrementing a second
  // piece of state from inside the updater would double-count under React's
  // strict-mode double invocation.
  const [step, setStep] = useState(0);

  // The deck can shrink mid-show (editor save); keep the position valid
  // without waiting for the next timer tick.
  const safe = slides.length ? step % slides.length : 0;
  const lap = slides.length ? Math.floor(step / slides.length) : 0;

  // A promo slot can have nothing to show on a lap (the snow-alerts slide's
  // cadence leaves empty laps, src/lib/promos.js): the step past it is skipped,
  // so the deck moves straight on to its next slide. Read through a ref so
  // `advance` stays one stable function for every timer that holds it.
  const deck = useRef(slides);
  useLayoutEffect(() => {
    deck.current = slides;
  }, [slides]);
  const advance = useCallback(() => {
    setStep((prev) => nextStep(prev, deck.current));
  }, []);

  const slide = slides[safe];
  // Which promo this lap is showing, resolved ONCE so the hold and the art
  // can never disagree about it.
  const promo = isPromoSlide(slide) ? promoForLap(slide, lap, slides.length) : null;
  // Landed on an empty lap of the slot without advancing into it (the first
  // step, or a deck that grew under the step): move on before it paints.
  const skipped = slides.length > 1 && isPromoSlide(slide) && promo == null;
  // A NUMBER, not the array: App re-renders on every event and can hand
  // down an equal-but-new deck; keying the timer on the array restarted the
  // hold each time, and the show stalled on one slide through a whole
  // check-in rush. Video slides with no explicit duration have no timer at
  // all — their <video> ended event drives the advance instead.
  //
  // The promo slot holds for THE POSTER IT IS SHOWING: each descriptor
  // carries its own hold (all four showreels run 15 seconds today, but the
  // number belongs to the poster, not the slot). slideDurationMs stays a
  // pure function of one slide; the
  // slideshow just hands it the promo rather than the slot when the promo
  // names its own hold.
  const held = promo?.durationSec != null ? promo : slide;

  // Which slide is up, as one key: the step (so the same slide coming round
  // again is a new showing) and its id (so an editor save that swaps what is
  // at this position is too).
  const slideKey = `${step}:${slide?.id ?? ''}`;
  const canHold = slides.length > 1 && slides.some((s) => !holdsCheckIns(s));
  const special = Boolean(slide) && canHold && holdsCheckIns(slide);
  const kind = !slide ? null : isVideoSlide(slide) ? 'video' : isPromoSlide(slide) ? 'promo' : isFlagshipSlide(slide) ? 'flagship' : 'copy';
  // A promo that ENDS on the lobby itself (src/lib/promos.js `exit:
  // 'seamless'`, the Grand Prix video): the field behind it wears the theme it
  // ends in, and leaving it is an ordinary change, not the stinger
  // (lobbyMotion.js nextTransition). It brings the scene's ambient loops to
  // rest and its chrome home under it (`promoScene`), and ends its own
  // showing (`promoFinished`), the hold only a cap.
  const seamless = kind === 'promo' && promo?.exit === 'seamless';
  const theme = seamless && promo.theme ? promo.theme : resolveTheme(slide, safe);
  const transition = useSlideTransition(seamless
    ? { key: slideKey, special, kind, theme, exit: 'seamless' }
    : { key: slideKey, special, kind, theme });
  const zero = useContext(ZeroAnimationContext);

  // Now and then the flagship carries on into the 3D intro video (src/lib/
  // flagship.js, FlagshipIntro.jsx): on the passes flagshipIntroLap picks, with
  // motion on, on a screen it fits. Decided once per showing (a resize
  // mid-showing changes nothing). The intro then owns the showing's end, the
  // way a video slide's `ended` does, and hands the scene's tab and waves
  // over to the video and back.
  const wantIntro = kind === 'flagship' && !zero && !still && slides.length > 1 && flagshipIntroLap(lap);
  const [introFor, setIntroFor] = useState({ key: '', on: false });
  let intro = introFor.on;
  if (introFor.key !== slideKey) {
    intro = wantIntro && introPlayable();
    setIntroFor({ key: slideKey, on: intro });
  }
  const [handOver, setHandOver] = useState({ key: '', away: false, rest: false });
  const handedOver = handOver.key === slideKey && handOver.away;
  // The seamless promo's word on the scene behind it, for its own showing.
  const [promoState, setPromoState] = useState({ key: '', rest: false, home: false });
  const promoRest = seamless && promoState.key === slideKey && promoState.rest;
  const promoHome = seamless && promoState.key === slideKey && promoState.home;
  const ambientRest = (handOver.key === slideKey && handOver.rest) || promoRest;

  // A seamless promo with motion on ends itself (its video's end); its own
  // hold plus SEAMLESS_GRACE_SEC is only the cap that keeps a late or stalled
  // video from holding the deck. With no motion it is a still: its plain hold.
  const capped = seamless && !zero && !still;
  const holdMs = slides.length <= 1 || !slide || intro
    ? null
    : isVideoSlide(slide) ? videoSlideTimerMs(slide)
      : capped ? slideDurationMs(held, slideshowDelaySec) + SEAMLESS_GRACE_SEC * 1000
        : slideDurationMs(held, slideshowDelaySec);

  // The hold timer, pausable: time already spent on this slide survives a
  // pause, so names on screen stop the clock instead of resetting it.
  // Timed on the monotonic clock: a wall-clock step (NTP) must not bend the hold.
  const timing = useRef({ key: '', spent: 0, startedAt: 0 });
  useEffect(() => {
    const t = timing.current;
    if (t.key !== slideKey) {
      t.key = slideKey;
      t.spent = 0;
    }
    if (holdMs == null || paused) return undefined;
    t.startedAt = performance.now();
    const timer = setTimeout(advance, Math.max(0, holdMs - t.spent));
    return () => {
      clearTimeout(timer);
      t.spent += performance.now() - t.startedAt;
    };
  }, [holdMs, slideKey, paused, advance]);

  // A video that ends while names are up waits for them before advancing.
  const pending = useRef(false);
  const pausedNow = useRef(paused);
  useEffect(() => {
    pausedNow.current = paused;
    if (!paused && pending.current) {
      pending.current = false;
      advance();
    }
  }, [paused, advance]);
  const finishVideo = useCallback(() => {
    if (pausedNow.current) pending.current = true;
    else advance();
  }, [advance]);

  // The intro's two callbacks belong to ITS showing: an intro still fading
  // out after the deck moved on (AnimatePresence keeps it a moment) must not
  // advance the deck again or touch the next slide's chrome.
  const keyNow = useRef(slideKey);
  useLayoutEffect(() => {
    keyNow.current = slideKey;
  }, [slideKey]);
  const introHandOver = (/** @type {{ away: boolean, rest: boolean }} */ state) => {
    if (keyNow.current === slideKey) setHandOver({ key: slideKey, ...state });
  };
  const introFinished = () => {
    if (keyNow.current === slideKey) finishVideo();
  };
  // The seamless promo's two callbacks, guarded the same way.
  const promoScene = (/** @type {{ rest: boolean, home: boolean }} */ state) => {
    if (keyNow.current === slideKey) setPromoState({ key: slideKey, rest: state.rest, home: state.home });
  };
  const promoFinished = () => {
    if (keyNow.current === slideKey) finishVideo();
  };

  // Told before the frame is painted (a layout effect, not a passive one): App
  // turns what stands over the lobby (the first-run card) off the moment a
  // held slide mounts. Passive, the report landed a frame or more after the
  // slide, and under zero animation (?lowPower=1, where a poster is on screen
  // at once, and a weak Pi is slow to run the effect) the card was drawn over
  // the new poster's date chip for that long.
  useLayoutEffect(() => {
    if (skipped) {
      advance();
      return;
    }
    onSlide?.({ key: slideKey, special, poster: kind === 'promo' });
  }, [onSlide, slideKey, special, kind, skipped, advance]);
  // Leaving the slideshow (the background switched away) must never leave
  // the lobby holding check-ins.
  useEffect(() => () => onSlide?.({ key: 'none', special: false, poster: false }), [onSlide]);

  if (!slides.length || !slide || skipped) return null;

  return (
    <div className="manual-slideshow">
      <CatalogScene
        theme={transition.theme}
        wipe={transition.wipe}
        // The flagship keeps the scene's own chrome (the orange tab and house
        // waves every other slide has); only a video or a poster covers it,
        // until a seamless promo, ending on the lobby, brings it home over
        // itself, fading in over the identical picture.
        chromeAway={(kind === 'video' || kind === 'promo') && !promoHome}
        // ...but its small logo steps aside while the flagship's big one is
        // up: the same mark twice on one screen reads as a doubling.
        logoAway={kind === 'flagship'}
        chromeHandedOver={handedOver}
        ambientRest={ambientRest}
        fieldRest={promoRest}
        chromeVia={promoHome ? 'reveal' : transition.via}
        swell={transition.swells}
        clubTint={clubTint}
        still={still}
      >
        {/* The copy slot: the step-back target while a name is up. Keyed by
            slide id, the incoming copy mounts beside the outgoing one and
            waits for it to lift clear (mode "sync" with timed holds rather
            than "wait", so the hand-off's beats are one clock and a slide
            coming straight back revives instead of doubling). */}
        <div className="lobby-stage manual-slide-copy">
          <Presence zero={zero} custom={transition.wipe}>
            {kind === 'copy' && (
              <SlideCopy
                key={slide.id}
                className="manual-slide"
                slide
                frame={slideFrame(slide)}
                theme={theme}
                via={transition.via}
                sizeClass={resolveSizeClass(slide)}
              />
            )}
          </Presence>
        </div>
        <Presence zero={zero} custom={transition.wipe}>
          {kind === 'video' && (
            <Media key={slide.id} wipe={transition.wipe}>
              <VideoSlide
                slide={slide}
                // A lone video loops forever (nothing to advance to);
                // a timed video loops so it never freezes mid-hold.
                loop={slides.length <= 1 || slide.durationSec > 0}
                onFinished={slides.length > 1 ? finishVideo : undefined}
              />
            </Media>
          )}
          {/* One slot, one promo per lap. The key stays `slide.id`, so the
              slot remounts on every visit and each promo's entrance
              animation plays from the top. */}
          {kind === 'promo' && (
            <Media key={slide.id} wipe={transition.wipe}>
              <PromoSlide
                promo={promo}
                still={still}
                lead={transition.wipe ? SWAP_AT : 0}
                onScene={seamless ? promoScene : undefined}
                onFinished={seamless && slides.length > 1 ? promoFinished : undefined}
              />
            </Media>
          )}
          {/* The permanent welcome slide: a full-bleed title sequence that
              check-ins play over (it never holds them). Remounts on every
              visit so its entrance plays from the top. */}
          {kind === 'flagship' && (
            <Media key={`${slide.id}:${step}`} wipe={transition.wipe}>
              <FlagshipSlide
                intro={intro}
                paused={paused}
                onHandOver={intro ? introHandOver : undefined}
                onFinished={intro ? introFinished : undefined}
              />
            </Media>
          )}
        </Presence>
      </CatalogScene>
      {transition.wipes > 0 && <Stinger key={transition.wipes} />}
    </div>
  );
}

const playMuted = (el) => { el?.play?.()?.catch?.(() => {}); };

/**
 * Can this screen play the flagship's 3D intro? Its shape (introFits), and
 * the OS's reduced motion (a 3D fly-through is all motion) says no.
 */
function introPlayable() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false;
  // A phone or tablet shows the 16:9 frame centred (app.css, pointer: coarse):
  // the intro plays in that frame, scaled down to the phone's width.
  const touch = window.matchMedia?.('(pointer: coarse)')?.matches
    && !document.documentElement.classList.contains('embedded');
  if (touch) {
    const width = Math.min(window.innerWidth, window.innerHeight * 16 / 9);
    return introFits(width, (width * 9) / 16, true);
  }
  return introFits(window.innerWidth, window.innerHeight);
}

function VideoSlide({ slide, loop, onFinished }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  // Pull the blob out of IndexedDB and hand the <video> an object URL.
  // Created once per mount, revoked on cleanup — AnimatePresence keeps
  // the exiting slide mounted until its fade ends, so the URL stays
  // valid for the whole crossfade.
  useEffect(() => {
    let cancelled = false;
    let url = null;
    getVideo(slide.videoId).then((blob) => {
      if (cancelled) return;
      if (!blob) {
        setFailed(true);
        return;
      }
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [slide.videoId]);

  // Never wedge the rotation on a broken video — skip ahead shortly.
  useEffect(() => {
    if (!failed || !onFinished) return undefined;
    const timer = setTimeout(onFinished, MISSING_VIDEO_SKIP_MS);
    return () => clearTimeout(timer);
  }, [failed, onFinished]);

  return (
    <div className="manual-slide-video-wrap">
      {src && !failed ? (
        <video
          className="manual-slide-video"
          src={src}
          muted
          autoPlay
          playsInline
          loop={loop}
          onEnded={onFinished}
          onError={() => setFailed(true)}
          // Autoplay is allowed because the video is muted, but a
          // rejected play() promise must never surface as an error.
          // The callback is stable: a fresh one each render makes React call
          // it again, and play() on an ended video restarts it.
          ref={playMuted}
        />
      ) : (
        <span className="manual-slide-video-missing">
          {failed ? 'Video not available on this device' : ''}
        </span>
      )}
    </div>
  );
}

/**
 * The step after `prev`, past any lap on which a promo slot has nothing to
 * show. Gives up after one full turn of every slot's cycle, so a deck that is
 * nothing but empty laps (which buildPromoSlot never makes) still advances.
 *
 * @param {number} prev
 * @param {Array<any>} slides
 */
export function nextStep(prev, slides) {
  const n = slides.length;
  if (n <= 1) return prev + 1;
  const longest = Math.max(1, ...slides.map((s) => (isPromoSlide(s) ? s.promos?.length || 1 : 1)));
  for (let step = prev + 1; step <= prev + n * longest; step += 1) {
    const s = slides[step % n];
    if (!isPromoSlide(s) || promoForLap(s, Math.floor(step / n), n) != null) return step;
  }
  return prev + 1;
}
