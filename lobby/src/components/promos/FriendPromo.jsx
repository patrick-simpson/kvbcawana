import { M } from '../../lib/motion.jsx';
import { formatLongDate } from '../../lib/calendarLogic.js';
import {
  PosterDepth, Wordmark, CountdownChip, RotatingDetail,
  landsAt, keyframes, buildShake, seeded,
  EASE_SLAM, EASE_OUT, EASE_INOUT,
} from './kit.jsx';

// ─────────────────────────────────────────────────────────────
// BARF Night ("Bring A Real Friend"): the printed poster, told as a
// fifteen second comic book.
//
// The sibling slime cut (BarfEpicPromo) is the loud dripping-goo piece;
// this one is pop art. Purple ground, Ben-Day halftone, ink outlines,
// panels and speech bubbles, and a splat that is the comic's IMPACT
// rather than a wall of goo.
//
// Beat sheet (seconds into the hold, one clock for everything):
//   0.7  PANEL 1 slams in, tilted: "MEANWHILE, AT SCHOOL..." and a kid
//        asking "WANNA COME TO AWANA?"
//   1.6  PANEL 2 slams in beside it: the friend, "YES!!"
//   2.5  camera pushes, the panels tear apart off-frame, speed lines
//        flash, and both kids sprint in from the edges
//   3.15 HIGH FIVE: white flash, shake, the lime splat bursts out of
//        their hands with a "SPLAT!" and a spray of droplets
//   4.3  the kids back off to the corners, the splat sinks into depth
//   4.5  the acronym: B, A, R, F slam in one tile at a time
//   6.2  the row swings into a column and every letter unfolds into
//        its word: B-RING / A / R-EAL / F-RIEND
//   6.8  the one rotating detail line starts in its caption box
//   8.9  a halftone band whips across; the initials fly up into the
//        headline (the match cut) and the end card assembles:
//   9.3  "BARF Night!" punches in over its turning comic burst
//   9.5  the splat re-slams, drips grow, BRING / A REAL / FRIEND stamp
//  10.4  the date, 10.7 the reward starburst, 10.9 the chip
//  11.2  the detail line stops on its last string; the poster holds
//
// The LAST keyframe of everything is that finished poster, so
// ?lowPower=1 (which jumps straight to it) shows the whole end card and
// none of the comic that led up to it.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({
  default: Object.freeze(['Earn 10 Awana Shares per friend', '+ a BARF bag!', 'Bring A Real Friend']),
  tonight: Object.freeze(['10 Awana Shares per friend', '+ a BARF bag!']),
});

/** The three words the finished poster sets on the splat. */
export const FRIEND_WORDS = Object.freeze(['BRING', 'A REAL', 'FRIEND']);

// The acronym, letter by letter: the initial on its tile, then the rest
// of its word unfolding out from behind it.
const ACRONYM = Object.freeze([
  { letter: 'B', rest: 'RING' },
  { letter: 'A', rest: '' },
  { letter: 'R', rest: 'EAL' },
  { letter: 'F', rest: 'RIEND' },
]);

// Timing, in seconds. Everything below reads from these.
const T = Object.freeze({
  panel1: 0.7,
  bubble1: 1.1,
  panel2: 1.6,
  bubble2: 2.0,
  tear: 2.5,
  impact: 3.15,
  retreat: 3.95,
  letters: 4.5,
  letterGap: 0.35,
  column: 6.2,
  unfold: 6.85,
  whip: 8.9,
  head: 9.3,
  splat: 9.5,
  words: 9.75,
  date: 10.4,
  badge: 10.7,
  wordmark: 10.1,
  chip: 10.9,
});

const DETAIL_START_MS = 6800;
const DETAIL_STEP_MS = 2200;

// ── Procedural art (seeded, identical on every device) ──────────

// A 14-point comic burst, the printed poster's, turning behind the headline.
function burstPoints(spikes, outer, inner, jitter = 0, seed = 1) {
  const rnd = seeded(seed);
  const pts = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const base = i % 2 === 0 ? outer : inner;
    const r = base + (jitter ? (rnd() - 0.5) * jitter : 0);
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}
const BURST_POINTS = burstPoints(14, 50, 35);
// The reward sticker and the SPLAT! balloon are rougher, hand-cut bursts.
const BADGE_POINTS = burstPoints(16, 49, 39, 5, 7);
const BOOM_POINTS = burstPoints(12, 49, 31, 10, 3);

// Radial speed lines: thin wedges from a hole in the middle out past
// the frame, in a -100..100 box.
const SPEED_LINES = (() => {
  const rnd = seeded(41);
  const out = [];
  const count = 64;
  for (let i = 0; i < count; i += 1) {
    const a = (Math.PI * 2 * i) / count + (rnd() - 0.5) * 0.06;
    const spread = 0.008 + rnd() * 0.018;
    const r0 = 34 + rnd() * 26;
    const r1 = 190;
    const p = (r, t) => `${(r * Math.cos(t)).toFixed(1)},${(r * Math.sin(t)).toFixed(1)}`;
    out.push(`M${p(r0, a)} L${p(r1, a - spread)} L${p(r1, a + spread)}z`);
  }
  return out.join(' ');
})();

// The printed poster's splat, its drips and the droplets thrown clear.
const SPLAT_PATH = 'M196 26 C238 8 292 22 306 58 C318 88 350 84 366 110 C382 136 372 172 346 190 C326 204 332 234 310 246 C286 258 258 240 236 250 C210 262 176 268 150 254 C124 240 96 246 76 228 C52 206 58 170 44 148 C28 122 40 84 70 70 C96 58 108 34 136 28 C158 24 176 34 196 26z';
const SPLAT_DRIPS = Object.freeze([
  { d: 'M128 230 c14 0 16 34 8 44 c-9 11 -22 6 -22 -10 c0 -12 4 -34 14 -34z', period: 3.6 },
  { d: 'M206 240 c16 0 18 46 8 58 c-11 13 -26 6 -26 -14 c0 -15 5 -44 18 -44z', period: 4.7 },
  { d: 'M288 222 c12 0 14 26 7 34 c-8 9 -19 5 -19 -8 c0 -9 3 -26 12 -26z', period: 5.5 },
]);
const SPLAT_DOTS = Object.freeze([
  { cx: 66, cy: 74, r: 13 },
  { cx: 336, cy: 62, r: 10 },
  { cx: 358, cy: 172, r: 15 },
  { cx: 42, cy: 186, r: 9 },
  { cx: 128, cy: 30, r: 8 },
  { cx: 288, cy: 22, r: 11 },
  { cx: 20, cy: 128, r: 7 },
]);

// The spray at the high five: droplets thrown from the hands clean off
// the frame. Transient, so every one ENDS invisible.
const SPRAY = (() => {
  const rnd = seeded(23);
  return Array.from({ length: 22 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 22 + (rnd() - 0.5) * 0.4;
    const dist = 38 + rnd() * 34;
    return {
      x: `${(Math.cos(a) * dist).toFixed(1)}vw`,
      y: `${(Math.sin(a) * dist * 0.62).toFixed(1)}vh`,
      size: (0.8 + rnd() * 2.2).toFixed(2),
      delay: rnd() * 0.12,
      tone: i % 3 === 0 ? 'pale' : 'lime',
    };
  });
})();

// ── Pieces ─────────────────────────────────────────────────────

/**
 * A kid, as a pop-art silhouette: ink body, one arm thrown up for the
 * high five. `variant` 'b' is the friend (ponytail). Drawn facing right;
 * the friend is mirrored in CSS.
 */
// The kid silhouettes, as parts: filled shapes and round-capped limbs.
// Drawn twice, a fat pale-lime pass under an ink pass, so every figure
// wears a sticker outline and reads on purple, lime or halftone.
const KID_BODY = Object.freeze([
  { limb: 'M40 104 L36 146', w: 13 },
  { limb: 'M60 104 L66 146', w: 13 },
  { shape: 'M24 150 Q24 142 36 142 Q46 142 46 150 Z' },
  { shape: 'M56 150 Q56 142 66 142 Q78 142 78 150 Z' },
  { limb: 'M36 64 L25 96', w: 11 },
  { shape: 'M25 100 m-6 0 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0' },
  { limb: 'M63 63 L88 20', w: 11 },
  { shape: 'M90 15 m-8.5 0 a8.5 8.5 0 1 0 17 0 a8.5 8.5 0 1 0 -17 0' },
  { shape: 'M31 60 Q50 49 69 60 Q74 86 68 110 Q50 116 32 110 Q26 86 31 60 Z' },
  { shape: 'M50 34 m-17 0 a17 17 0 1 0 34 0 a17 17 0 1 0 -34 0' },
]);
const KID_HAIR = Object.freeze({
  a: [{ shape: 'M33 32 Q32 14 50 13 Q68 13 67 31 L61 24 L57 29 L51 21 L45 28 L40 22 Z' }],
  b: [
    { shape: 'M33 33 Q32 15 50 14 Q68 15 67 33 Q58 22 42 25 Z' },
    { shape: 'M34 22 Q18 18 14 34 Q12 48 22 52 Q20 40 30 32 Z' },
  ],
});

function KidParts({ parts, color, grow }) {
  return parts.map((p) => (p.limb
    ? <path key={p.limb} d={p.limb} fill="none" stroke={color} strokeWidth={p.w + grow} strokeLinecap="round" />
    : <path key={p.shape} d={p.shape} fill={color} stroke={color} strokeWidth={grow} strokeLinejoin="round" />));
}

/**
 * A kid, as a pop-art silhouette: ink body, one arm thrown up for the
 * high five. `variant` 'b' is the friend (ponytail). Drawn facing right;
 * the friend is mirrored in CSS.
 */
function Kid({ variant = 'a' }) {
  const parts = [...KID_BODY, ...KID_HAIR[variant]];
  return (
    <svg className="promo-friend-kid-art" viewBox="0 0 100 160" aria-hidden="true">
      <KidParts parts={parts} color="#c7f26a" grow={7} />
      <KidParts parts={parts} color="#1e0836" grow={0} />
      {/* A glint on the face side, the only light on the ink. */}
      <path d="M58 24 Q64 28 64 36" fill="none" stroke="#7b35bd" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** A comic panel: ink border, white gutter, its own halftone. */
function Panel({ tone, caption, bubble, kid, beat, tilt, from }) {
  return (
    <M.div
      className={`promo-friend-panel promo-friend-panel--${tone}`}
      {...keyframes([
        [0, { opacity: 0, scale: 1.5, rotate: tilt * 3, x: from }],
        [beat, { opacity: 0, scale: 1.5, rotate: tilt * 3, x: from }],
        [beat + 0.32, { opacity: 1, scale: 0.97, rotate: tilt, x: '0vw' }],
        [beat + 0.5, { opacity: 1, scale: 1, rotate: tilt, x: '0vw' }],
        [T.tear, { opacity: 1, scale: 1.02, rotate: tilt, x: '0vw' }],
        [T.tear + 0.45, { opacity: 0, scale: 1.2, rotate: tilt * 4, x: tone === 'purple' ? '-70vw' : '70vw' }],
        // At rest: gone. It is the story, not the poster.
        [T.head + 3, { opacity: 0, scale: 1.2, rotate: tilt * 4, x: tone === 'purple' ? '-70vw' : '70vw' }],
      ], [EASE_OUT, EASE_SLAM, EASE_OUT, 'linear', EASE_INOUT, 'linear'])}
    >
      <div className="promo-friend-panel-dots" aria-hidden="true" />
      <svg className="promo-friend-panel-lines" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path d={SPEED_LINES} />
      </svg>
      {caption && <span className="promo-friend-panel-caption">{caption}</span>}
      <div className={`promo-friend-panel-kid promo-friend-panel-kid--${kid}`}>
        <Kid variant={kid} />
      </div>
      <M.div
        className={`promo-friend-bubble promo-friend-bubble--${kid}`}
        {...landsAt(beat + 0.4, 0.4, { opacity: [0, 1], scale: [0.2, 1.12, 1] })}
      >
        {bubble}
      </M.div>
    </M.div>
  );
}

/** The splat, its halftone, its drips and its thrown droplets. */
function Splat() {
  return (
    <svg className="promo-friend-splat" viewBox="0 0 400 300" aria-hidden="true">
      <defs>
        <pattern id="promo-friend-splat-dots" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(20)">
          <circle cx="6" cy="6" r="2.1" fill="#4f9a0e" />
        </pattern>
      </defs>
      {SPLAT_DRIPS.map((drip, i) => (
        <M.g
          key={drip.d}
          style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
          {...landsAt(T.splat + 0.3 + i * 0.12, 0.7, { scaleY: [0, 1.25, 1] }, EASE_OUT)}
        >
          <M.path
            d={drip.d}
            className="promo-friend-ink-stroke"
            fill="#7ed321"
            style={{ transformBox: 'fill-box', transformOrigin: 'center top' }}
            animate={{ scaleY: [1, 1.12, 1] }}
            transition={{ duration: drip.period, repeat: Infinity, ease: 'easeInOut' }}
          />
        </M.g>
      ))}
      <path d={SPLAT_PATH} className="promo-friend-ink-stroke" fill="#7ed321" />
      <path d={SPLAT_PATH} fill="url(#promo-friend-splat-dots)" opacity="0.55" />
      <path d="M150 60 C180 44 230 44 262 58" fill="none" stroke="#c7f26a" strokeWidth="9" strokeLinecap="round" opacity="0.8" />
      {SPLAT_DOTS.map((dot, i) => (
        <M.circle
          key={`${dot.cx}-${dot.cy}`}
          cx={dot.cx}
          cy={dot.cy}
          r={dot.r}
          fill="#7ed321"
          className="promo-friend-ink-stroke"
          {...keyframes([
            [0, { opacity: 0, scale: 0.2, x: (200 - dot.cx) * 0.8, y: (150 - dot.cy) * 0.8 }],
            [T.impact, { opacity: 0, scale: 0.2, x: (200 - dot.cx) * 0.8, y: (150 - dot.cy) * 0.8 }],
            [T.impact + 0.45 + i * 0.03, { opacity: 1, scale: 1, x: 0, y: 0 }],
            [T.splat, { opacity: 1, scale: 1, x: 0, y: 0 }],
            [T.splat + 0.12, { opacity: 1, scale: 0.4, x: (200 - dot.cx) * 0.3, y: (150 - dot.cy) * 0.3 }],
            [T.splat + 0.6 + i * 0.04, { opacity: 1, scale: 1, x: 0, y: 0 }],
          ], [EASE_OUT, EASE_SLAM, 'linear', 'easeIn', EASE_SLAM])}
        />
      ))}
    </svg>
  );
}

// ── The poster ─────────────────────────────────────────────────

export default function FriendPromo({ promo, lines }) {
  const { tonight } = promo;
  const shake = buildShake([
    { at: T.impact, amp: 26 },
    ...ACRONYM.map((_, i) => ({ at: T.letters + i * T.letterGap + 0.1, amp: 9 })),
    { at: T.head + 0.12, amp: 14 },
    { at: T.splat + 0.1, amp: 10 },
  ], 12);

  return (
    <div className="promo-slide promo-slide--friend">
      <PosterDepth />

      {/* The camera: a push-in for the sprint, a punch on the impact, a
          breath before the match cut. Rests at 1. */}
      <M.div
        className="promo-friend-camera"
        {...keyframes([
          [0, { scale: 1.06 }],
          [T.panel1, { scale: 1.06 }],
          [T.tear, { scale: 1 }],
          [T.impact - 0.05, { scale: 1.1 }],
          [T.impact + 0.12, { scale: 1.18 }],
          [T.retreat + 0.4, { scale: 1 }],
          [T.whip, { scale: 1.05 }],
          [T.head + 0.2, { scale: 0.98 }],
          [T.head + 1.2, { scale: 1 }],
        ], ['linear', EASE_OUT, 'easeIn', EASE_SLAM, EASE_INOUT, 'linear', EASE_SLAM, EASE_OUT])}
      >
        <M.div
          className="promo-friend-shaker"
          animate={{ x: shake.x, y: shake.y }}
          transition={{ duration: 12, times: shake.times, ease: 'easeOut' }}
        >
          {/* Ben-Day halftone over the whole page: static, it rests. */}
          <div className="promo-friend-halftone" aria-hidden="true" />

          {/* Speed lines, flashed on the sprint and the match cut, and a
              faint ghost of them left behind the finished poster. */}
          <M.svg
            className="promo-friend-speed"
            viewBox="-100 -100 200 200"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scale: 1.4 }],
              [T.tear, { opacity: 0, scale: 1.4 }],
              [T.tear + 0.2, { opacity: 0.85, scale: 1.1 }],
              [T.impact + 0.3, { opacity: 0.7, scale: 0.9 }],
              [T.retreat, { opacity: 0, scale: 1.2 }],
              [T.whip, { opacity: 0, scale: 1.4 }],
              [T.head, { opacity: 0.7, scale: 1 }],
              [T.head + 1.4, { opacity: 0.12, scale: 1 }],
            ], ['linear', EASE_OUT, 'linear', EASE_OUT, 'linear', EASE_SLAM, EASE_OUT])}
          >
            <path d={SPEED_LINES} />
          </M.svg>

          {/* ACT ONE: two panels. */}
          <div className="promo-friend-panels">
            <Panel
              tone="purple"
              caption="Meanwhile, at school..."
              bubble={tonight ? 'Wanna come to Awana tonight?' : 'Wanna come to Awana?'}
              kid="a"
              beat={T.panel1}
              tilt={-3}
              from="-18vw"
            />
            <Panel
              tone="lime"
              caption={null}
              bubble="YES!!"
              kid="b"
              beat={T.panel2}
              tilt={2.5}
              from="18vw"
            />
          </div>

          {/* The comic burst behind the headline (the printed poster's). */}
          <M.div
            className="promo-friend-burst-slot"
            {...keyframes([
              [0, { opacity: 0, scale: 0 }],
              [T.head - 0.1, { opacity: 0, scale: 0 }],
              [T.head + 0.35, { opacity: 1, scale: 1.12 }],
              [T.head + 0.8, { opacity: 1, scale: 1 }],
            ], ['linear', EASE_SLAM, EASE_OUT])}
          >
            <M.svg
              className="promo-friend-burst"
              viewBox="0 0 100 100"
              aria-hidden="true"
              animate={{ rotate: [0, 360] }}
              transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
            >
              <polygon points={BURST_POINTS} fill="#7b35bd" stroke="#1e0836" strokeWidth="0.9" strokeLinejoin="round" />
              <polygon points={BURST_POINTS} fill="none" stroke="#b6f06a" strokeWidth="0.35" strokeLinejoin="round" transform="translate(50 50) scale(0.86) translate(-50 -50)" opacity="0.5" />
            </M.svg>
          </M.div>

          {/* The splat: bursts from the high five, sinks into depth under
              the acronym, re-slams for the end card. */}
          <div className="promo-friend-splat-area">
            <M.div
              className="promo-friend-splat-slot"
              {...keyframes([
                [0, { opacity: 0, scale: 0, rotate: -20 }],
                [T.impact, { opacity: 0, scale: 0, rotate: -20 }],
                [T.impact + 0.18, { opacity: 1, scale: 1.3, rotate: 4 }],
                [T.impact + 0.6, { opacity: 1, scale: 1, rotate: 0 }],
                [T.retreat, { opacity: 1, scale: 1, rotate: 0 }],
                [T.retreat + 0.6, { opacity: 0, scale: 0.72, rotate: -6 }],
                [T.splat, { opacity: 0, scale: 0.72, rotate: -6 }],
                [T.splat + 0.22, { opacity: 1, scale: 1.1, rotate: 2 }],
                [T.splat + 0.7, { opacity: 1, scale: 1, rotate: 0 }],
              ], ['linear', EASE_SLAM, EASE_OUT, 'linear', EASE_INOUT, 'linear', EASE_SLAM, EASE_OUT])}
            >
              <M.div
                className="promo-friend-jelly"
                animate={{ scaleX: [1, 1.035, 0.975, 1], scaleY: [1, 0.965, 1.025, 1] }}
                transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <Splat />
              </M.div>
            </M.div>

            <div className="promo-friend-words">
              {FRIEND_WORDS.map((word, i) => (
                <M.span
                  key={word}
                  className="promo-friend-word"
                  {...landsAt(T.words + i * 0.2, 0.45, {
                    opacity: [0, 1],
                    scale: [2.4, 0.92, 1],
                    rotate: [i % 2 ? 8 : -8, i % 2 ? -1.5 : 1.5, 0],
                  })}
                >
                  {word}
                </M.span>
              ))}
            </div>
          </div>

          {/* The acronym. Row, then column, then words; the initials
              finally fly up into the headline. */}
          <M.div
            className="promo-friend-acronym"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 1, scale: 1.45, y: '0vh' }],
              [T.column, { opacity: 1, scale: 1.45, y: '0vh' }],
              [T.column + 0.7, { opacity: 1, scale: 1, y: '0vh' }],
              [T.whip, { opacity: 1, scale: 1, y: '0vh' }],
              [T.whip + 0.2, { opacity: 1, scale: 1.08, y: '2vh' }],
              [T.head + 0.05, { opacity: 0, scale: 0.34, y: '-36vh' }],
            ], ['linear', EASE_INOUT, 'linear', EASE_OUT, 'easeIn'])}
          >
            {ACRONYM.map(({ letter, rest }, i) => {
              const tileAt = T.letters + i * T.letterGap;
              const rowX = `${((i - 1.5) * 1.15 + 1.525).toFixed(3)}em`;
              const rowY = `${((1.5 - i) * 1.08).toFixed(3)}em`;
              return (
                <M.div
                  key={letter}
                  className="promo-friend-row"
                  {...landsAt(T.column + i * 0.1, 0.6, { x: [rowX, '0em'], y: [rowY, '0em'] }, EASE_INOUT)}
                >
                  <M.span
                    className={`promo-friend-tile promo-friend-tile--${i % 2 ? 'pale' : 'lime'}`}
                    {...keyframes([
                      [0, { opacity: 0, scale: 3, rotate: i % 2 ? 14 : -14 }],
                      [tileAt, { opacity: 0, scale: 3, rotate: i % 2 ? 14 : -14 }],
                      [tileAt + 0.2, { opacity: 1, scale: 0.88, rotate: i % 2 ? -3 : 3 }],
                      [tileAt + 0.42, { opacity: 1, scale: 1, rotate: 0 }],
                      [T.unfold + i * 0.18, { opacity: 1, scale: 1, rotate: 0 }],
                      [T.unfold + i * 0.18 + 0.12, { opacity: 1, scale: 1.12, rotate: 0 }],
                      [T.unfold + i * 0.18 + 0.36, { opacity: 1, scale: 1, rotate: 0 }],
                    ], ['linear', EASE_SLAM, EASE_OUT, 'linear', 'easeOut', EASE_OUT])}
                  >
                    {letter}
                  </M.span>
                  {rest && (
                    <span className="promo-friend-rest-mask">
                      <M.span
                        className="promo-friend-rest promo-outline"
                        {...landsAt(T.unfold + i * 0.18, 0.45, { x: ['-105%', '4%', '0%'], opacity: [0, 1, 1] })}
                      >
                        {rest}
                      </M.span>
                    </span>
                  )}
                </M.div>
              );
            })}
          </M.div>

          {/* The high five: two kids sprint in, meet in the middle, then
              back off to the corners of the finished poster. */}
          {['a', 'b'].map((kid) => {
            const dir = kid === 'a' ? 1 : -1;
            const at = (vw) => `${vw * dir}vw`;
            return (
              <M.div
                key={kid}
                className={`promo-friend-kid promo-friend-kid--${kid}`}
                {...keyframes([
                  [0, { opacity: 0, x: at(-60), y: '0vh', scale: 1.9 }],
                  [T.tear, { opacity: 0, x: at(-60), y: '0vh', scale: 1.9 }],
                  [T.tear + 0.05, { opacity: 1, x: at(-52), y: '0vh', scale: 1.9 }],
                  [T.tear + 0.2, { opacity: 1, x: at(-30), y: '-4vh', scale: 1.9 }],
                  [T.tear + 0.38, { opacity: 1, x: at(-6), y: '0vh', scale: 1.9 }],
                  [T.impact - 0.06, { opacity: 1, x: at(22), y: '-5vh', scale: 1.9 }],
                  [T.impact + 0.1, { opacity: 1, x: at(31), y: '-1vh', scale: 1.9 }],
                  [T.retreat, { opacity: 1, x: at(30), y: '0vh', scale: 1.9 }],
                  [T.retreat + 0.7, { opacity: 1, x: at(0), y: '0vh', scale: 1 }],
                ], ['linear', 'linear', 'easeOut', 'easeIn', 'easeOut', EASE_SLAM, 'linear', EASE_INOUT])}
              >
                <Kid variant={kid} />
              </M.div>
            );
          })}

          {/* The impact: a white flash and a SPLAT! balloon. Both end gone. */}
          <M.div
            className="promo-friend-flash"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0 }],
              [T.impact, { opacity: 0 }],
              [T.impact + 0.05, { opacity: 0.95 }],
              [T.impact + 0.4, { opacity: 0 }],
              [T.whip + 0.35, { opacity: 0 }],
              [T.head, { opacity: 0.55 }],
              [T.head + 0.4, { opacity: 0 }],
            ], ['linear', 'linear', 'easeOut', 'linear', 'linear', 'easeOut'])}
          />
          <M.div
            className="promo-friend-boom"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scale: 0, rotate: -30 }],
              [T.impact + 0.05, { opacity: 0, scale: 0, rotate: -30 }],
              [T.impact + 0.3, { opacity: 1, scale: 1.2, rotate: -6 }],
              [T.impact + 0.55, { opacity: 1, scale: 1, rotate: -8 }],
              [T.retreat - 0.1, { opacity: 1, scale: 1.04, rotate: -8 }],
              [T.retreat + 0.25, { opacity: 0, scale: 1.8, rotate: -14 }],
            ], ['linear', EASE_SLAM, EASE_OUT, 'linear', 'easeIn'])}
          >
            <svg className="promo-friend-boom-art" viewBox="0 0 100 100">
              <polygon points={BOOM_POINTS} fill="#ffffff" stroke="#1e0836" strokeWidth="2.4" strokeLinejoin="round" />
            </svg>
            <span className="promo-friend-boom-word">SPLAT!</span>
          </M.div>
          <div className="promo-friend-spray" aria-hidden="true">
            {SPRAY.map((drop, i) => (
              <M.span
                key={i}
                className={`promo-friend-drop promo-friend-drop--${drop.tone}`}
                style={{ '--drop': drop.size }}
                {...keyframes([
                  [0, { opacity: 0, x: '0vw', y: '0vh', scale: 0.3 }],
                  [T.impact + drop.delay, { opacity: 0, x: '0vw', y: '0vh', scale: 0.3 }],
                  [T.impact + drop.delay + 0.08, { opacity: 1, x: '0vw', y: '0vh', scale: 1 }],
                  [T.impact + drop.delay + 0.9, { opacity: 0, x: drop.x, y: drop.y, scale: 0.6 }],
                ], ['linear', 'linear', EASE_OUT])}
              />
            ))}
          </div>

          {/* The match-cut wipe: a halftone band whipping across. Ends off-frame. */}
          <M.div
            className="promo-friend-wipe"
            aria-hidden="true"
            {...keyframes([
              [0, { x: '-150vw' }],
              [T.whip, { x: '-150vw' }],
              [T.head + 0.2, { x: '150vw' }],
            ], ['linear', EASE_INOUT])}
          />

          {/* ── The end card ─────────────────────────────────── */}
          <M.div
            className="promo-friend-frame"
            aria-hidden="true"
            {...landsAt(T.head, 0.5, { opacity: [0, 1], scale: [1.08, 1] })}
          />

          <div className="promo-friend-head">
            <M.h2
              className={`promo-headline promo-outline promo-friend-headline ${tonight ? 'promo-friend-headline--long' : ''}`}
              {...keyframes([
                [0, { opacity: 0, scale: 0.3, y: '10vh', rotate: -6 }],
                [T.head - 0.12, { opacity: 0, scale: 0.3, y: '10vh', rotate: -6 }],
                [T.head + 0.16, { opacity: 1, scale: 1.18, y: '0vh', rotate: 2 }],
                [T.head + 0.5, { opacity: 1, scale: 1, y: '0vh', rotate: 0 }],
              ], ['linear', EASE_SLAM, EASE_OUT])}
            >
              {tonight ? 'BARF Night is tonight!' : 'BARF Night!'}
            </M.h2>
          </div>

          <div className="promo-friend-foot">
            <M.div
              className={`promo-date promo-outline promo-friend-date ${tonight ? 'promo-friend-date--long' : ''}`}
              {...landsAt(T.date, 0.55, { opacity: [0, 1], y: [40, -6, 0] })}
            >
              {tonight ? 'Bring your friend to the check-in desk' : formatLongDate(promo.eventDate).toUpperCase()}
            </M.div>
          </div>

          {/* The reward, fixed on the poster, on a hand-cut starburst. */}
          <M.div
            className="promo-friend-badge"
            {...landsAt(T.badge, 0.55, { opacity: [0, 1], scale: [0, 1.18, 1], rotate: [30, -10, -6] })}
          >
            <svg className="promo-friend-badge-art" viewBox="0 0 100 100" aria-hidden="true">
              <polygon points={BADGE_POINTS} fill="#c7f26a" stroke="#1e0836" strokeWidth="2.2" strokeLinejoin="round" />
            </svg>
            <span className="promo-friend-badge-copy">
              <span className="promo-friend-badge-big">10</span>
              {' '}
              <span className="promo-friend-badge-mid">Awana Shares</span>
              {' '}
              <span className="promo-friend-badge-small">per friend</span>
              {' '}
              <span className="promo-friend-badge-plus">+ a BARF bag!</span>
            </span>
          </M.div>
        </M.div>
      </M.div>

      <div className="promo-friend-detail">
        <RotatingDetail lines={lines} startMs={DETAIL_START_MS} stepMs={DETAIL_STEP_MS} />
      </div>
      <Wordmark at={T.wordmark} />
      <CountdownChip label={promo.countdown} at={T.chip} pulses={[12.2, 13.6]} />
    </div>
  );
}
