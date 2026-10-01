import { useContext, useState } from 'react';
import { AnimatePresence, useIsPresent } from 'framer-motion';
import { M, ZeroAnimationContext } from '../lib/motion.jsx';
import { DOODLES, EASE, SHAPES } from '../lib/brand.js';
import {
  HANDOFF, SWAP_AT, chromeMove, chromeSpot, holdThenLand, holdThenLeave, swellKeyframes,
} from '../lib/lobbyMotion.js';
import { LOBBY_THEMES, lobbyTheme } from '../lib/lobbyFrame.js';
import CornerTab from './brand/CornerTab.jsx';
import Wave from './brand/Wave.jsx';
import awanaClubsMark from '../../shared/brand/logos/awana-clubs-white.svg';

// The lobby (rebrand stage 4b): the approved mockup's studio, behind every
// typed slide, calendar slide and the idle placeholder. Three layers, and
// only the middle one ever changes with the slide:
//
//   the FIELD   a flat colour, two big tone-on-tone clouds and a sparse
//               scatter of small white kit doodles, drifting and twinkling
//               (CSS keyframes, transform only, compositor-driven);
//   the COPY    whatever the caller renders as children (SlideCopy, a video,
//               a poster), on a 16:9 box centred on the screen;
//   the CHROME  the orange corner tab carrying the Awana Clubs mark, and the
//               house waves low along the bottom: sunflower behind (slowly
//               rolling), Awana orange in front.
//
// The scene is ONE persistent layer: a slide change swaps the copy, never the
// studio. When two slides want different themes the field crossfades under
// the hand-off (the incoming field fades up over the outgoing one, both
// drifting in step because their loops share one clock). A poster or a video
// takes the chrome out of the way and brings it back after: under the stinger
// it goes and comes back in one frame while the wave covers the screen; a
// video on an ordinary change slides it aside (tab up, waves down).
//
// `still` renders a frozen frame with no ambient loops: the slide editor's
// thumbnails show a dozen scenes at once. Under ?lowPower=1 the blanket
// .zero-animation-mode rule stops the CSS loops at their resting frame and M
// jumps every framer-motion value to its last keyframe.

/** The operator themes, in the kit palette (see src/lib/lobbyFrame.js). */
export const THEMES = LOBBY_THEMES;

// The field's clouds and doodles, from the mockup's lobbyBack(), as % of the
// screen (a 16:9 screen gives exactly the mockup's cqw) so the studio fills
// any aspect ratio; doodle widths are in u so they keep their own shape.
const CLOUDS = [
  { left: -8, top: -10.7, width: 52, height: 64, rotate: -8, drift: 'a' },
  { left: 62, top: 32, width: 48, height: 60.4, rotate: 14, drift: 'b' },
];
const FIELD_DOODLES = [
  { kind: 'squiggle', left: 9, top: 26.7, size: 3.2, motion: 'float', delay: 0 },
  { kind: 'sparkle', left: 14, top: 20.4, size: 2.4, motion: 'twinkle', delay: -1.1 },
  { kind: 'dot', left: 18.5, top: 28.4, size: 1, motion: 'float', delay: -3.4 },
  { kind: 'zigzag', left: 86, top: 35.6, size: 3.4, motion: 'float', delay: -2.2 },
  { kind: 'sparkleX', left: 82, top: 26.7, size: 2, motion: 'twinkle', delay: -2.6 },
  { kind: 'ring', left: 90, top: 26.3, size: 1.3, motion: 'float', delay: -5.1 },
];

// One clock for every field's ambient loops: each field sets its CSS
// animations' delay to "started at page load", so two fields crossfading
// drift in step and only their colours differ.
const EPOCH = typeof performance !== 'undefined' ? performance.now() : 0;
const sinceEpoch = () => (typeof performance !== 'undefined' ? (performance.now() - EPOCH) / 1000 : 0);

function Doodle({ kind, left, top, size, motion, delay }) {
  const shape = DOODLES[kind];
  const [, , vw, vh] = shape.viewBox.split(/\s+/).map(Number);
  return (
    <span
      className={`lobby-doodle lobby-ambient lobby-ambient--${motion}`}
      style={{ left: `${left}%`, top: `${top}%`, width: `calc(${size} * var(--u))`, aspectRatio: `${vw} / ${vh}`, '--d': `${delay}s` }}
    >
      <svg viewBox={shape.viewBox} aria-hidden="true" focusable="false">
        {shape.stroked
          ? <path d={shape.d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          : <path d={shape.d} fill="currentColor" />}
      </svg>
    </span>
  );
}

/**
 * The field's crossfade: fade up over the outgoing field (which holds until
 * the incoming one is opaque, so the room never sees a thin frame), or,
 * under the stinger, swap in one frame while the wave covers the screen.
 */
function fieldIn(wipe) {
  return wipe
    ? holdThenLand(SWAP_AT, 0.01, { opacity: 0 }, { opacity: 1 }, 'linear')
    : holdThenLand(0, HANDOFF.field, { opacity: 0 }, { opacity: 1 }, EASE.wipe);
}
const FIELD_VARIANTS = {
  leave: (wipe) => holdThenLeave(wipe ? SWAP_AT : HANDOFF.field, 0.02, { opacity: 1 }, { opacity: 0 }, 'linear'),
};

function Field({ theme, wipe, animated }) {
  const t = LOBBY_THEMES[theme];
  const present = useIsPresent();
  // How long after page load this field appeared: its loops start that far
  // in, so they run in step with every other field's.
  const [phase] = useState(sinceEpoch);
  // The entrance is fixed at mount: a later change of `wipe` (the next slide
  // change) must never replay it.
  const [enter] = useState(() => fieldIn(wipe));
  const style = { '--field': t.field, '--cloud': t.cloud, '--doodle': t.doodle, '--lobby-t': `${-phase}s` };
  const body = (
    <>
      {CLOUDS.map((c, i) => (
        <span
          key={i}
          className={`lobby-cloud lobby-ambient lobby-ambient--drift-${c.drift}`}
          style={{ left: `${c.left}%`, top: `${c.top}%`, width: `${c.width}%`, height: `${c.height}%` }}
        >
          <svg viewBox={SHAPES.tipBlob.viewBox} preserveAspectRatio="none" style={{ transform: `rotate(${c.rotate}deg)` }} aria-hidden="true" focusable="false">
            <path d={SHAPES.tipBlob.d} fill="currentColor" />
          </svg>
        </span>
      ))}
      {FIELD_DOODLES.map((d) => <Doodle key={d.kind} {...d} />)}
    </>
  );
  const className = `lobby-field lobby-field--${theme}${present ? '' : ' is-leaving'}`;
  if (!animated) return <div className={className} style={style} aria-hidden="true">{body}</div>;
  return (
    <M.div
      className={className}
      style={style}
      aria-hidden="true"
      initial={enter.initial}
      animate={enter.animate}
      transition={enter.transition}
      variants={FIELD_VARIANTS}
      exit="leave"
    >
      {body}
    </M.div>
  );
}

/**
 * The corner tab and the house waves. `away` (a poster or a video is up)
 * sends them out of the way and they come back after: under the stinger they
 * go and come back in one frame while it covers the screen, otherwise they
 * slide (see chromeMove in src/lib/lobbyMotion.js for why a wipe moves them
 * by opacity). `swell` counts hand-offs: each new count swells the orange
 * wave once, and nothing else ever replays it.
 */
function Chrome({ away, via, swell, still }) {
  // Where the chrome is and how it got there, captured once per change of
  // spot (derived state), so a later change of `via` alone never replays it.
  const [state, setState] = useState(() => ({ spot: chromeSpot('home', away, via), from: null, via }));
  const spot = chromeSpot(state.spot, away, via);
  let current = state;
  if (spot !== state.spot) {
    current = { spot, from: state.spot, via };
    setState(current);
  }
  const tab = chromeMove(current.from, current.spot, current.via, '-112%');
  const waves = chromeMove(current.from, current.spot, current.via, '112%');
  // The swell's keyframes stay on the wave for as long as its count stands,
  // away or not: framer-motion replays a target that goes and comes back,
  // so dropping them while the chrome was away swelled it again on return.
  const swelling = !still && swell > 0 ? swellKeyframes('-16%') : null;
  return (
    <div className={`lobby-chrome lobby-chrome--${current.spot}${away ? ' lobby-chrome--away' : ''}`} aria-hidden="true">
      <M.div className="lobby-waves" initial={false} animate={waves.animate} transition={waves.transition}>
        <Wave className="lobby-wave lobby-wave--sun lobby-ambient lobby-ambient--roll" color="var(--brand-sun)" />
        {/* Remounted per hand-off, so each count plays its swell once. */}
        <Wave
          key={swell}
          className="lobby-wave lobby-wave--house"
          color="var(--brand-orange)"
          {...(swelling ?? {})}
        />
      </M.div>
      <CornerTab
        className="lobby-tab"
        color="var(--brand-orange)"
        initial={false}
        animate={tab.animate}
        transition={tab.transition}
      >
        <img className="lobby-tab__mark" src={awanaClubsMark} alt="" draggable="false" />
      </CornerTab>
    </div>
  );
}

/**
 * The lobby scene behind everything.
 *
 * `theme` is the slide's (or, for the idle placeholder, the season's: see
 * lib/skins.js sceneForSkin). `cozy`/`dim` are the WEATHER's contribution:
 * rather than swapping the theme, which would make a deliberately chosen VBS
 * or Easter skin silently vanish on a wet night, the weather only cools and
 * dims whatever the season painted.
 *
 * @param {{
 *   theme?: string,
 *   still?: boolean,
 *   cozy?: boolean,
 *   dim?: number,
 *   clubTint?: string | null,
 *   wipe?: boolean,
 *   chromeAway?: boolean,
 *   chromeVia?: string,
 *   swell?: number,
 *   children?: import('react').ReactNode,
 * }} props
 */
export default function CatalogScene({
  theme = 'sky', still = false, cozy = false, dim = 1,
  // The arriving child's club accent while their banner holds the stage, or
  // null the rest of the time (#349); see src/lib/clubTint.js for the rules.
  clubTint = null,
  // How the current theme arrived (true: under the stinger), how the chrome
  // should move, and the hand-off count that swells the house wave.
  wipe = false, chromeAway = false, chromeVia = 'handoff', swell = 0,
  children,
}) {
  const key = lobbyTheme(theme);
  const zero = useContext(ZeroAnimationContext);
  const animated = !still && !zero;

  // The colour outlives the tint itself. `clubTint` goes null the instant the
  // banner leaves, and the wash needs something to fade OUT to the club's own
  // colour. Adjusted during render, not in an effect, so the class and the
  // custom property land in the same paint.
  const [heldTint, setHeldTint] = useState(clubTint);
  if (clubTint && clubTint !== heldTint) setHeldTint(clubTint);

  const field = <Field key={key} theme={key} wipe={wipe} animated={animated} />;

  return (
    <div
      className={`catalog-scene lobby catalog-scene--${key}${still ? ' lobby--still' : ''}${cozy ? ' catalog-scene--cozy' : ''}${clubTint ? ' catalog-scene--club-tinted' : ''}`}
      style={{
        // Clamped so a bad value can never black out the room; 1 is a no-op.
        '--scene-dim': String(Math.max(0.6, Math.min(1, Number(dim) || 1))),
        ...(heldTint ? { '--club-tint': heldTint } : null),
      }}
    >
      <div className="lobby-fields">
        {animated
          ? <AnimatePresence initial={false} custom={wipe}>{field}</AnimatePresence>
          : field}
      </div>

      {/* The arriving club's wash (#349). Always mounted, opacity-only, over
          the field but UNDER the copy, because slide copy must never go
          pastel. Plain CSS, so the .zero-animation-mode rule kills the fade. */}
      <div className="scene-club-tint" aria-hidden />

      <div className="lobby-content">{children}</div>

      <Chrome away={chromeAway} via={chromeVia} swell={swell} still={still} />
    </div>
  );
}
