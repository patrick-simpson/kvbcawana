import { useContext, useEffect, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { M, ZeroAnimationContext } from '../../lib/motion.jsx';
import { PROMO_DURATION_SEC } from '../../lib/promos.js';

// ─────────────────────────────────────────────────────────────
// The promo kit: what every fall showreel poster is built from.
//
// Each poster (ContestPromo, FriendPromo, BarfEpicPromo, ParentsPromo in
// this folder) is a 15 second piece of motion design that ends on its own
// finished printed poster. The pieces below are the parts they share: the
// timing helpers, the Awana wordmark, the countdown chip, the one rotating
// detail line and the depth layers.
//
// Rules every poster keeps (CLAUDE.md, "Season promo slides"):
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

/** Every showreel runs for this long; promos.js holds the slide for it. */
export const SHOWREEL_SEC = PROMO_DURATION_SEC;

// The expo-out curve most things land on: fast in, hard stop.
export const EASE_SLAM = [0.16, 1, 0.3, 1];
// A softer out-curve for things that settle rather than slam.
export const EASE_OUT = [0.22, 1, 0.36, 1];
// In-out for moves that leave as well as arrive (camera pushes, wipes).
export const EASE_INOUT = [0.65, 0, 0.35, 1];

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
 * A screen shake: one x/y jitter per beat, as one keyframe list for a single
 * wrapper transform. Starts and ends at 0, the resting position.
 *
 * @param {ReadonlyArray<{at: number, amp: number}>} beats amp in px
 * @param {number} total seconds
 */
export function buildShake(beats, total) {
  const shape = [
    [0.00, 1.00, -0.62],
    [0.06, -0.80, 0.52],
    [0.12, 0.50, -0.34],
    [0.18, -0.26, 0.18],
    [0.25, 0, 0],
  ];
  const times = [0];
  const x = [0];
  const y = [0];
  for (const beat of beats) {
    for (const [offset, fx, fy] of shape) {
      times.push((beat.at + offset) / total);
      x.push(Math.round(beat.amp * fx * 10) / 10);
      y.push(Math.round(beat.amp * fy * 10) / 10);
    }
  }
  times.push(1);
  x.push(0);
  y.push(0);
  return { times, x, y };
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

/**
 * A splat: a closed blob with `arms` long points between short ones,
 * smoothed through its own midpoints so the arms read as thrown goo
 * rather than a star, in a 100x100 box. `seed` is the only variation.
 *
 * @param {number} seed
 * @param {number} arms
 * @returns {string}
 */
export function splatPath(seed, arms = 7) {
  const rnd = seeded(seed);
  const pts = [];
  const count = arms * 2;
  for (let i = 0; i < count; i += 1) {
    const long = i % 2 === 0;
    const r = long ? 32 + rnd() * 15 : 21 + rnd() * 7;
    const a = (Math.PI * 2 * i) / count + (rnd() - 0.5) * 0.28;
    pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
  }
  const mid = (a, b) => `${((a[0] + b[0]) / 2).toFixed(1)} ${((a[1] + b[1]) / 2).toFixed(1)}`;
  let d = `M${mid(pts[count - 1], pts[0])}`;
  for (let i = 0; i < count; i += 1) {
    const p = pts[i];
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${mid(p, pts[(i + 1) % count])}`;
  }
  return `${d}z`;
}

// Same recipe as config.js's fromSiteRoot: a fork or mirror serves its
// own copy of shared/, and a non-browser context (tests) must not throw.
function siteRootUrl(path) {
  try {
    return new URL(path, window.location.href).href;
  } catch {
    return '';
  }
}

const LOGO_URL = siteRootUrl('shared/art/awana-clubs-logo.png');

/**
 * The Awana Clubs wordmark, which simply is not there if the art 404s.
 * `at` is when it lands (seconds); it rests fully lit.
 */
export function Wordmark({ at = 0, className = '' }) {
  const [broken, setBroken] = useState(false);
  if (broken || !LOGO_URL) return null;
  return (
    <div className={`promo-wordmark-slot ${className}`}>
      <M.img
        className="promo-wordmark"
        src={LOGO_URL}
        alt="Awana Clubs"
        onError={() => setBroken(true)}
        {...landsAt(at, 0.55, { opacity: [0, 1], y: [-20, 0] }, EASE_OUT)}
      />
    </div>
  );
}

/**
 * The live counter ("3 club nights left" / "Next club night" / "Tonight!").
 * It lands at `at` and pulses once at each second in `pulses`. The slot owns
 * the landing and the pill owns the pulse, so they never share a transform.
 * A poster that wants the chip somewhere else styles `.promo-chip-slot`
 * under its own `.promo-slide--*` class.
 */
export function CountdownChip({ label, at = 1.2, pulses = [] }) {
  if (!label) return null;
  const pulse = pulses.length
    ? keyframes([
      [0, { scale: 1 }],
      ...pulses.flatMap((t) => [[t, { scale: 1 }], [t + 0.18, { scale: 1.14 }], [t + 0.5, { scale: 1 }]]),
    ], 'easeInOut')
    : {};
  return (
    <M.div
      className="promo-chip-slot"
      {...landsAt(at, 0.5, { opacity: [0, 1], scale: [0.6, 1.08, 1] })}
    >
      <M.div className="promo-chip" {...pulse}>{label}</M.div>
    </M.div>
  );
}

/**
 * The one supporting line on a poster, at full size, one string at a
 * time, fading in at `startMs` and turning over every `stepMs` until it
 * stops on the last string.
 *
 * `lines` must be a stable array (the DETAILS tables), because it keys the
 * timer chain. Timers are cleared on unmount. Under zero animation it
 * shows the LAST string at once and never rotates: that is the finished
 * poster ?lowPower=1 freezes on.
 */
export function RotatingDetail({ lines, startMs = 1600, stepMs = 2200 }) {
  // Under zero animation the poster IS its finished frame, so the line is
  // already on the last string it would have stopped on, with no timers.
  const still = useContext(ZeroAnimationContext);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (still || lines.length < 2) return undefined;
    let timer = 0;
    let shown = 0;
    const step = () => {
      shown += 1;
      setIndex(shown);
      if (shown < lines.length - 1) timer = setTimeout(step, stepMs);
    };
    timer = setTimeout(step, startMs + stepMs);
    return () => clearTimeout(timer);
  }, [still, lines, startMs, stepMs]);

  if (!lines.length) return null;
  const line = still ? lines[lines.length - 1] : lines[index];

  return (
    <M.div
      className="promo-detail-slot"
      {...landsAt(startMs / 1000, 0.4, { opacity: [0, 1] }, 'easeOut')}
    >
      <AnimatePresence mode="wait" initial={false}>
        <M.span
          key={line}
          className="promo-detail"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
        >
          {line}
        </M.span>
      </AnimatePresence>
    </M.div>
  );
}

/** The two static depth layers every poster sits on: grain and vignette. */
export function PosterDepth() {
  return (
    <>
      <div className="promo-texture" aria-hidden="true" />
      <div className="promo-vignette" aria-hidden="true" />
    </>
  );
}
