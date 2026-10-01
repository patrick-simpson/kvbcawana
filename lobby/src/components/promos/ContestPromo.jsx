import { M } from '../../lib/motion.jsx';
import { formatLongDate } from '../../lib/calendarLogic.js';
import {
  PosterDepth,
  Wordmark,
  CountdownChip,
  RotatingDetail,
  landsAt,
  keyframes,
  buildShake,
  seeded,
  EASE_SLAM,
  EASE_OUT,
  EASE_INOUT,
  SHOWREEL_SEC,
} from './kit.jsx';

// ─────────────────────────────────────────────────────────────
// The DEFEND poster contest, as a 15 second showreel.
//
// The printed poster is a navy field, a hand-made sign with DEFEND on it
// taped up by its four corners, gold and white confetti and a tilted gold
// band carrying the deadline. The piece is a kid's art studio that ends on
// exactly that poster:
//
//   0.4  ACT 1, THE GALLERY. A wall of kids' posters pins itself up in three
//        depths while a spotlight sweeps across it; POSTER and CONTEST slam
//        in from either side (0.95 / 1.3).
//   2.7  The camera pushes THROUGH the wall: each depth scales at its own
//        rate so the near posters fly past the lens, a flash, and the
//        headline rides up to its place at the top.
//   3.3  ACT 2, THE SIGN. A blank sheet slaps onto the wall (shockwave,
//        shake); four strips of tape fly in and stick it down, corner by
//        corner (3.8 to 4.55).
//   4.85 A marker writes D-E-F-E-N-D in navy strokes, letter by letter.
//   6.9  Gold paint fills each letter from the bottom up.
//   7.35 REVEAL. Every letter jumps, confetti cannons fire from both lower
//        corners, a sparkle burst, a light sweep across the sheet, a flash
//        and a camera punch.
//   7.9  ACT 3, THE POSTER. The sign swings up into its hanging place and
//        settles like a pendulum while the gold band wipes in from the left
//        (7.95) with "Posters due" and the date dropping in word by word.
//   8.8  The detail line starts turning over on the band (8.8 / 10.3 /
//        11.8); the wordmark, the chip, the verse reference written onto
//        the sign (or, tonight, a DUE TONIGHT rubber stamp) land by 10.4.
//  11.8  END CARD, complete: it holds to 15 s with only ambient motion (the
//        pendulum, twinkles, slow confetti, one more light sweep, two chip
//        pulses).
//
// Every element's LAST keyframe is the finished poster, which is the frame
// ?lowPower=1 freezes on; the gallery, marker, sketch strokes, flashes and
// the cannon confetti all end invisible or off-frame.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({
  // No verse reference here: by default it is written on the sign, and
  // the rotating line would say it twice.
  default: Object.freeze([
    'Open to all clubbers',
    'Voting at Parents’ Night · Nov 4',
  ]),
  tonight: Object.freeze([
    'Voting at Parents’ Night · Nov 4',
    '1 Peter 3:15 NKJV',
  ]),
});

/** The theme verse, by reference only: the verse text itself never shows. */
export const VERSE_REF = '1 Peter 3:15 NKJV';

const DEFEND = ['D', 'E', 'F', 'E', 'N', 'D'];

// ── The clock ────────────────────────────────────────────────
const T = Object.freeze({
  pinStart: 0.35,
  poster: 0.95,
  contest: 1.3,
  push: 2.7,
  pushEnd: 3.2,
  slap: 3.3,
  tape: [3.8, 4.05, 4.3, 4.55],
  write: 4.85,
  writeStep: 0.33,
  fill: 6.9,
  reveal: 7.35,
  settle: 7.9,
  band: 7.95,
  kicker: 8.35,
  date: 8.5,
  detailMs: 8800,
  detailStepMs: 1500,
  wordmark: 9.3,
  verse: 10.35,
  chip: 9.6,
  stamp: 10.1,
});

// Hand-drawn single-stroke caps in a 100x100 letter box (the box is the
// glyph's own advance by 1em, so each stroke sits under its gold letter).
const SKETCH = Object.freeze({
  D: 'M26 84 L26 16 Q80 16 80 50 Q80 84 26 84',
  E: 'M76 16 L26 16 L26 84 L76 84 M26 50 L66 50',
  F: 'M76 16 L26 16 L26 86 M26 50 L66 50',
  N: 'M24 86 L24 16 L76 84 L76 14',
});

// ── Act 1: the gallery wall ──────────────────────────────────
const DOODLES = Object.freeze({
  shield: (
    <>
      <path d="M50 14 L82 25 C82 58 72 82 50 96 C28 82 18 58 18 25 Z" fill="#f8a91c" stroke="#1f2a5c" strokeWidth="5" strokeLinejoin="round" />
      <path d="M50 30 V82 M32 48 H68" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" />
    </>
  ),
  star: <path d="M50 12 L60 40 L89 40 L65 57 L74 86 L50 68 L26 86 L35 57 L11 40 L40 40 Z" fill="#ffd98a" stroke="#f8a91c" strokeWidth="5" strokeLinejoin="round" />,
  heart: <path d="M50 90 C16 66 10 46 22 32 C33 20 47 26 50 38 C53 26 67 20 78 32 C90 46 84 66 50 90 Z" fill="#e0463b" stroke="#1f2a5c" strokeWidth="4" strokeLinejoin="round" />,
  sun: (
    <>
      <circle cx="50" cy="52" r="20" fill="#f8a91c" />
      <path d="M50 14 V24 M50 80 V90 M12 52 H22 M78 52 H88 M23 25 L30 32 M70 72 L77 79 M77 25 L70 32 M30 72 L23 79" stroke="#f8a91c" strokeWidth="6" strokeLinecap="round" />
    </>
  ),
  cross: <path d="M43 12 H57 V38 H82 V52 H57 V94 H43 V52 H18 V38 H43 Z" fill="#32427f" stroke="#1f2a5c" strokeWidth="3" strokeLinejoin="round" />,
  crown: <path d="M16 80 L20 34 L37 56 L50 24 L63 56 L80 34 L84 80 Z" fill="#ffd98a" stroke="#1f2a5c" strokeWidth="5" strokeLinejoin="round" />,
  book: (
    <>
      <path d="M14 26 Q32 18 50 28 Q68 18 86 26 V84 Q68 76 50 86 Q32 76 14 84 Z" fill="#5cc8f0" stroke="#1f2a5c" strokeWidth="5" strokeLinejoin="round" />
      <path d="M50 28 V86" stroke="#1f2a5c" strokeWidth="4" />
    </>
  ),
});
const DOODLE_KEYS = Object.keys(DOODLES);
const PAPERS = ['#ffffff', '#f3efe4', '#ffd98a', '#d6e2ff', '#fff4d6'];

// [left %, top %, size vmin] per depth; far, mid, near.
const WALL = Object.freeze([
  { depth: 'far', push: [0.94, 1.24, 3.1], cards: [[8, 12, 12], [24, 7, 11], [41, 13, 12], [59, 8, 11], [76, 13, 12], [91, 22, 11], [15, 41, 12], [86, 45, 12], [31, 72, 11], [69, 73, 12], [50, 86, 11], [6, 79, 12], [94, 77, 11]] },
  { depth: 'mid', push: [0.9, 1.38, 4.6], cards: [[19, 25, 17], [66, 27, 16], [37, 47, 16], [82, 60, 17], [11, 61, 16], [55, 62, 17]] },
  { depth: 'near', push: [0.88, 1.6, 6.4], cards: [[4, 30, 25], [95, 9, 24], [27, 90, 24], [78, 92, 25]] },
]);

function buildWall() {
  const rnd = seeded(15);
  let n = 0;
  return WALL.map((layer) => ({
    ...layer,
    cards: layer.cards.map(([left, top, size]) => {
      const card = {
        left,
        top,
        size,
        rot: Math.round((rnd() - 0.5) * 22),
        doodle: DOODLE_KEYS[Math.floor(rnd() * DOODLE_KEYS.length)],
        paper: PAPERS[Math.floor(rnd() * PAPERS.length)],
        lines: [40 + Math.round(rnd() * 40), 30 + Math.round(rnd() * 45)],
        order: n,
      };
      n += 1;
      return card;
    }),
  }));
}
const GALLERY = buildWall();

function MiniPoster({ card }) {
  const w = card.size;
  const h = card.size * 1.3;
  return (
    <div
      className="promo-contest-card-slot"
      style={{ left: `${card.left}%`, top: `${card.top}%`, width: `${w}vmin`, height: `${h}vmin`, marginLeft: `${-w / 2}vmin`, marginTop: `${-h / 2}vmin` }}
    >
      <M.div
        className="promo-contest-card"
        style={{ backgroundColor: card.paper }}
        {...landsAt(T.pinStart + card.order * 0.055, 0.5, {
          opacity: [0, 1, 1],
          scale: [0.2, 1.1, 1],
          rotate: [card.rot - 24, card.rot + 4, card.rot],
        }, EASE_OUT)}
      >
        <span className="promo-contest-card-tape" />
        <svg viewBox="0 0 100 130" className="promo-contest-card-art">
          <g transform="translate(0 4)">{DOODLES[card.doodle]}</g>
          <path d={`M18 108 q8 -5 16 0 t16 0 t16 0 L${18 + card.lines[0] * 0.8} 108`} stroke="#1f2a5c" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity="0.7" />
          <path d={`M18 120 q8 -4 16 0 t16 0 L${18 + card.lines[1] * 0.8} 120`} stroke="#f8a91c" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity="0.8" />
        </svg>
      </M.div>
    </div>
  );
}

function GalleryWall() {
  return (
    <div className="promo-contest-gallery" aria-hidden="true">
      {GALLERY.map((layer) => (
        <M.div
          key={layer.depth}
          className={`promo-contest-depth promo-contest-depth--${layer.depth}`}
          {...keyframes([
            [0, { scale: layer.push[0], opacity: 1 }],
            [0.5, { scale: layer.push[0] }],
            [T.push, { scale: layer.push[1], opacity: 1 }],
            [T.pushEnd, { scale: layer.push[2], opacity: 0 }],
          ], [EASE_OUT, EASE_INOUT, [0.55, 0, 0.9, 0.4]])}
        >
          {layer.cards.map((card) => <MiniPoster key={card.order} card={card} />)}
        </M.div>
      ))}
    </div>
  );
}

// ── Particles ───────────────────────────────────────────────
function buildCannon() {
  const rnd = seeded(41);
  const out = [];
  for (let i = 0; i < 52; i += 1) {
    const side = i % 2 === 0 ? 1 : -1;
    const peakX = 8 + rnd() * 52;
    const peakY = 50 + rnd() * 45;
    out.push({
      side,
      tone: ['gold', 'white', 'pale', 'gold'][Math.floor(rnd() * 4)],
      shape: rnd() < 0.3 ? 'dot' : 'strip',
      w: 0.7 + rnd() * 0.7,
      h: 1.4 + rnd() * 1.4,
      peakX,
      peakY,
      endX: peakX + 6 + rnd() * 18,
      up: 0.5 + rnd() * 0.35,
      fall: 1.8 + rnd() * 1.4,
      spin: Math.round((rnd() - 0.5) * 1440),
      lag: rnd() * 0.12,
    });
  }
  return out;
}
const CANNON = buildCannon();

function ConfettiCannon() {
  return (
    <div className="promo-contest-cannon" aria-hidden="true">
      {CANNON.map((p, i) => {
        const t0 = T.reveal + p.lag;
        const sx = (v) => `${p.side * v}vw`;
        return (
          <M.span
            // Fixed, seeded layout: the index is a stable identity.
            key={i}
            className={`promo-contest-bit promo-contest-bit--${p.tone} promo-contest-bit--${p.shape} promo-contest-bit--${p.side > 0 ? 'l' : 'r'}`}
            style={{ width: `${p.w}vmin`, height: `${p.shape === 'dot' ? p.w : p.h}vmin` }}
            {...keyframes([
              [0, { x: '0vw', y: '0vh', rotate: 0, opacity: 0 }],
              [t0, { x: '0vw', y: '0vh', rotate: 0, opacity: 0 }],
              [t0 + 0.02, { opacity: 1 }],
              [t0 + p.up, { x: sx(p.peakX), y: `${-p.peakY}vh`, rotate: p.spin * 0.4 }],
              [t0 + p.up + p.fall, { x: sx(p.endX), y: '14vh', rotate: p.spin }],
              [t0 + p.up + p.fall + 0.05, { opacity: 0 }],
            ], ['linear', 'linear', [0.1, 0.75, 0.3, 1], [0.5, 0, 0.85, 0.7], 'linear'])}
          />
        );
      })}
    </div>
  );
}

// Slow ambient confetti once the poster is up. Each piece loops a fall
// that ends below the frame, so a frozen screen shows none of them mid-air.
const DRIFT = Object.freeze([
  { left: '5%', w: 0.85, h: 2.1, tone: 'gold', duration: 9, delay: 0, spin: 260 },
  { left: '15%', w: 0.7, h: 1.7, tone: 'white', duration: 11, delay: 2.5, spin: -180 },
  { left: '27%', w: 1, h: 2.4, tone: 'gold', duration: 8.5, delay: 1.2, spin: 320 },
  { left: '39%', w: 0.75, h: 1.8, tone: 'white', duration: 10, delay: 3.4, spin: -240 },
  { left: '61%', w: 0.9, h: 2.2, tone: 'gold', duration: 12, delay: 0.6, spin: 200 },
  { left: '72%', w: 0.7, h: 1.6, tone: 'white', duration: 9.5, delay: 2.1, spin: -300 },
  { left: '84%', w: 1, h: 2.3, tone: 'gold', duration: 10.5, delay: 1.6, spin: 280 },
  { left: '95%', w: 0.8, h: 1.9, tone: 'white', duration: 8, delay: 3, spin: -220 },
]);

function Drift() {
  return (
    <M.div className="promo-contest-drift" aria-hidden="true" {...landsAt(T.settle, 0.6, { opacity: [0, 1] }, 'easeOut')}>
      {DRIFT.map((p) => (
        <M.span
          key={p.left}
          className={`promo-contest-bit promo-contest-bit--${p.tone} promo-contest-bit--strip`}
          style={{ left: p.left, top: 0, width: `${p.w}vmin`, height: `${p.h}vmin` }}
          animate={{ y: ['-8vh', '108vh'], rotate: [0, p.spin] }}
          transition={{ duration: p.duration, delay: p.delay * 0.1, repeat: Infinity, ease: 'linear' }}
        />
      ))}
    </M.div>
  );
}

const SPARKLE_D = 'M20 0 c2.6 14.4 3 14.8 20 20 c-17 5.2 -17.4 5.6 -20 20 c-2.6 -14.4 -3 -14.8 -20 -20 c17 -5.2 17.4 -5.6 20 -20z';

// Resting sparkles: they pop in on the reveal and twinkle; the twinkle's
// last keyframe is full size, so the frozen poster keeps them.
const SPARKLES = Object.freeze([
  { pos: 'a', size: 4.4, gold: true, period: 3.4 },
  { pos: 'b', size: 2.8, gold: false, period: 4.6 },
  { pos: 'c', size: 3.4, gold: true, period: 5.2 },
  { pos: 'd', size: 3.9, gold: false, period: 4.1 },
  { pos: 'e', size: 3.1, gold: true, period: 3.9 },
  { pos: 'f', size: 3.6, gold: false, period: 4.8 },
]);

function Sparkles() {
  return SPARKLES.map((s, i) => (
    <M.div
      key={s.pos}
      className={`promo-contest-sparkle promo-contest-sparkle--${s.pos} ${s.gold ? 'promo-contest-sparkle--gold' : ''}`}
      style={{ width: `${s.size}vmin`, height: `${s.size}vmin` }}
      aria-hidden="true"
      {...landsAt(T.reveal + 0.1 + i * 0.07, 0.5, { opacity: [0, 1, 1], scale: [0, 1.5, 1], rotate: [-90, 10, 0] })}
    >
      <M.svg
        viewBox="0 0 40 40"
        className="promo-contest-sparkle-art"
        animate={{ scale: [1, 0.55, 1], rotate: [0, 45, 0] }}
        transition={{ duration: s.period, repeat: Infinity, ease: 'easeInOut' }}
      >
        <path d={SPARKLE_D} fill="currentColor" />
      </M.svg>
    </M.div>
  ));
}

// A burst of sparkles flung out of the sign on the reveal; all gone after.
const BURST = Array.from({ length: 10 }, (_, i) => {
  const a = (Math.PI * 2 * i) / 10 + 0.3;
  const r = i % 2 ? 34 : 44;
  return { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, gold: i % 2 === 0 };
});

function SparkleBurst() {
  return (
    <div className="promo-contest-burst" aria-hidden="true">
      {BURST.map((b, i) => (
        <M.svg
          key={i}
          viewBox="0 0 40 40"
          className={`promo-contest-burst-star ${b.gold ? 'promo-contest-sparkle--gold' : ''}`}
          {...keyframes([
            [0, { x: '0vw', y: '0vh', scale: 0, opacity: 0, rotate: 0 }],
            [T.reveal, { x: '0vw', y: '0vh', scale: 0, opacity: 0, rotate: 0 }],
            [T.reveal + 0.05, { opacity: 1 }],
            [T.reveal + 0.55, { x: `${b.x}vw`, y: `${b.y}vh`, scale: 1.3, rotate: 120 }],
            [T.reveal + 1.1, { x: `${b.x * 1.15}vw`, y: `${b.y * 1.15}vh`, scale: 0, opacity: 0, rotate: 200 }],
          ], ['linear', 'linear', EASE_SLAM, 'easeIn'])}
        >
          <path d={SPARKLE_D} fill="currentColor" />
        </M.svg>
      ))}
    </div>
  );
}

// ── Act 2: the sign ─────────────────────────────────────────
const TAPES = Object.freeze([
  { corner: 'tl', rest: -38, from: { x: '-46vw', y: '-40vh', rotate: -320 } },
  { corner: 'tr', rest: 38, from: { x: '46vw', y: '-44vh', rotate: 300 } },
  { corner: 'br', rest: -38, from: { x: '48vw', y: '42vh', rotate: -280 } },
  { corner: 'bl', rest: 38, from: { x: '-48vw', y: '44vh', rotate: 340 } },
]);

function Tape({ tape, at }) {
  return (
    <M.span
      className={`promo-contest-tape promo-contest-tape--${tape.corner}`}
      aria-hidden="true"
      {...keyframes([
        [0, { ...tape.from, scale: 1.8, opacity: 0 }],
        [at - 0.32, { ...tape.from, scale: 1.8, opacity: 0 }],
        [at - 0.3, { opacity: 1 }],
        [at, { x: '0vw', y: '0vh', rotate: tape.rest, scale: 1.25 }],
        [at + 0.18, { scale: 1 }],
      ], ['linear', 'linear', [0.3, 0.1, 0.4, 1], EASE_OUT])}
    />
  );
}

function Letter({ letter, i }) {
  const t0 = T.write + i * T.writeStep;
  return (
    <span className="promo-contest-letter-slot">
      <M.svg
        className="promo-contest-sketch"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        {...keyframes([[0, { opacity: 1 }], [T.fill + 0.4, { opacity: 1 }], [T.reveal + 0.2, { opacity: 0 }]], 'easeOut')}
      >
        <M.path
          d={SKETCH[letter]}
          {...landsAt(t0, 0.3, { pathLength: [0, 1], opacity: [0, 1] }, 'easeInOut')}
        />
      </M.svg>
      <M.span
        className="promo-contest-letter promo-outline"
        {...landsAt(T.fill + i * 0.07, 0.34, {
          clipPath: ['inset(120% -30% -30% -30%)', 'inset(-30% -30% -30% -30%)'],
        }, EASE_OUT)}
      >
        <M.span
          className="promo-beat"
          {...landsAt(T.reveal + i * 0.045, 0.7, {
            scale: [1, 1.3, 0.94, 1],
            y: ['0em', '-0.14em', '0.02em', '0em'],
          }, EASE_OUT)}
        >
          {letter}
        </M.span>
      </M.span>
    </span>
  );
}

// The marker that writes DEFEND. The track spans the word, so its x in %
// is a fraction of the word's width; the pen rides its centre.
function markerFrames() {
  const frames = [
    [0, { x: '70%', y: '120%', rotate: 20, opacity: 0 }],
    [T.write - 0.45, { x: '70%', y: '120%', rotate: 20, opacity: 0 }],
    [T.write - 0.3, { opacity: 1 }],
  ];
  DEFEND.forEach((_, i) => {
    const t0 = T.write + i * T.writeStep;
    const left = ((i + 0.22) / 6 - 0.5) * 100;
    const mid = ((i + 0.5) / 6 - 0.5) * 100;
    const right = ((i + 0.8) / 6 - 0.5) * 100;
    frames.push([t0, { x: `${left}%`, y: '-30%', rotate: -4 }]);
    frames.push([t0 + 0.15, { x: `${mid}%`, y: '32%', rotate: 6 }]);
    frames.push([t0 + 0.3, { x: `${right}%`, y: '-6%', rotate: 0 }]);
  });
  const done = T.write + 6 * T.writeStep;
  frames.push([done + 0.25, { x: '62%', y: '-160%', rotate: 40, opacity: 0 }]);
  return keyframes(frames, 'easeInOut');
}
const MARKER = markerFrames();

function Marker() {
  return (
    <M.div className="promo-contest-marker-track" aria-hidden="true" {...MARKER}>
      <svg className="promo-contest-marker" viewBox="0 0 40 140">
        <path d="M14 120 L20 138 L26 120 Z" fill="#1f2a5c" />
        <rect x="11" y="92" width="18" height="30" rx="3" fill="#e9e4d6" />
        <rect x="8" y="10" width="24" height="86" rx="6" fill="#1f2a5c" />
        <rect x="8" y="40" width="24" height="18" fill="#f8a91c" />
        <rect x="6" y="0" width="28" height="18" rx="6" fill="#32427f" />
      </svg>
    </M.div>
  );
}

function Sign({ tonight }) {
  return (
    <M.div
      className="promo-contest-stage"
      {...keyframes([
        [0, { opacity: 0, scale: 2.6, rotate: 9, y: '5vh' }],
        [T.slap, { opacity: 0, scale: 2.6, rotate: 9, y: '5vh' }],
        [T.slap + 0.2, { opacity: 1, scale: 1.12, rotate: -2.6 }],
        [T.slap + 0.36, { scale: 1.22, rotate: -1 }],
        [T.slap + 0.52, { scale: 1.2, rotate: -1.4 }],
        [T.settle, { scale: 1.2, rotate: -1.4, y: '5vh' }],
        [T.settle + 0.8, { scale: 1, rotate: 0, y: '0vh' }],
      ], [
        'linear',
        [0.5, 0, 0.9, 0.5],
        EASE_OUT,
        EASE_INOUT,
        'linear',
        EASE_INOUT,
      ])}
    >
      <M.span
        className="promo-contest-ring"
        aria-hidden="true"
        {...keyframes([
          [0, { scale: 0.7, opacity: 0 }],
          [T.slap + 0.18, { scale: 0.7, opacity: 0 }],
          [T.slap + 0.2, { opacity: 0.7 }],
          [T.slap + 0.9, { scale: 1.9, opacity: 0 }],
        ], ['linear', 'linear', EASE_OUT])}
      />
      <M.div
        className="promo-contest-swing"
        {...keyframes([
          [0, { rotate: 0 }],
          [T.settle + 0.1, { rotate: 0 }],
          [T.settle + 0.6, { rotate: -4 }],
          [T.settle + 1.3, { rotate: 3 }],
          [T.settle + 2.0, { rotate: -2.2 }],
          [T.settle + 2.8, { rotate: 1.6 }],
          [T.settle + 3.7, { rotate: -1.2 }],
          [T.settle + 4.7, { rotate: 0.9 }],
          [T.settle + 5.8, { rotate: -0.7 }],
          [SHOWREEL_SEC, { rotate: -1 }],
        ], 'easeInOut')}
      >
        <div className="promo-contest-sign">
          <div className="promo-contest-glintbox" aria-hidden="true">
            <M.span
              className="promo-contest-glint"
              {...keyframes([
                [0, { x: '-160%', opacity: 1 }],
                [T.reveal + 0.1, { x: '-160%' }],
                [T.reveal + 0.8, { x: '420%' }],
                [T.reveal + 0.82, { opacity: 0 }],
                [T.reveal + 0.84, { x: '-160%' }],
                [12.6, { opacity: 0 }],
                [12.62, { opacity: 1 }],
                [13.4, { x: '420%' }],
              ], 'easeInOut')}
            />
          </div>
          {TAPES.map((tape, i) => <Tape key={tape.corner} tape={tape} at={T.tape[i]} />)}
          <div className="promo-contest-word">
            {DEFEND.map((letter, i) => (
              // Fixed copy, so the index is a stable identity here.
              <Letter key={`${letter}-${i}`} letter={letter} i={i} />
            ))}
            <Marker />
          </div>
          {tonight && (
            <M.span
              className="promo-contest-stamp"
              {...landsAt(T.stamp, 0.4, {
                opacity: [0, 1, 1],
                scale: [2.6, 0.92, 1],
                rotate: [-30, -12, -14],
              })}
            >
              Due tonight
            </M.span>
          )}
          {!tonight && (
            <M.span
              className="promo-contest-verse"
              {...landsAt(T.verse, 0.7, {
                clipPath: ['inset(-20% 100% -20% -5%)', 'inset(-20% -5% -20% -5%)'],
              }, 'easeInOut')}
            >
              {VERSE_REF}
            </M.span>
          )}
        </div>
      </M.div>
    </M.div>
  );
}

// ── Act 3: the band ─────────────────────────────────────────
function Band({ promo, lines }) {
  const { tonight } = promo;
  const head = tonight ? 'Hand yours in at the check-in desk' : formatLongDate(promo.eventDate).toUpperCase();
  const words = head.split(' ');
  const step = tonight ? 0.08 : 0.15;
  return (
    <M.div
      className="promo-contest-band"
      {...landsAt(T.band, 0.8, { x: ['-112%', '2%', '0%'], rotate: [-8, -2.4, -3] })}
    >
      <div className="promo-contest-glintbox" aria-hidden="true">
        <M.span
          className="promo-contest-glint promo-contest-glint--band"
          {...landsAt(T.date + 0.7, 0.9, { x: ['-160%', '900%'] }, 'easeInOut')}
        />
      </div>
      <div className="promo-contest-band-copy">
        <M.span
          className="promo-contest-kicker"
          {...landsAt(T.kicker, 0.4, { opacity: [0, 1], y: ['0.8em', '0em'] }, EASE_OUT)}
        >
          {tonight ? 'Posters due tonight' : 'Posters due'}
        </M.span>
        <span className={`promo-date promo-outline promo-contest-due ${tonight ? 'promo-contest-due--long' : ''}`}>
          {words.map((word, i) => (
            <span key={`${word}-${i}`}>
              <M.span
                className="promo-contest-due-word"
                {...landsAt(T.date + i * step, 0.5, {
                  opacity: [0, 1, 1],
                  y: ['-0.7em', '0.06em', '0em'],
                  scale: [1.3, 0.97, 1],
                })}
              >
                {word}
              </M.span>
              {i < words.length - 1 ? ' ' : ''}
            </span>
          ))}
        </span>
        <RotatingDetail lines={lines} startMs={T.detailMs} stepMs={T.detailStepMs} />
      </div>
    </M.div>
  );
}

const SHAKE_BEATS = [
  { at: T.slap + 0.2, amp: 16 },
  ...T.tape.map((at) => ({ at, amp: 5 })),
  { at: T.reveal, amp: 20 },
  { at: T.band + 0.3, amp: 7 },
];
const SHAKE = buildShake(SHAKE_BEATS, SHOWREEL_SEC);
// Tonight the rubber stamp lands with a thump of its own.
const SHAKE_TONIGHT = buildShake([...SHAKE_BEATS, { at: T.stamp + 0.3, amp: 9 }], SHOWREEL_SEC);

export default function ContestPromo({ promo, lines }) {
  const shake = promo.tonight ? SHAKE_TONIGHT : SHAKE;
  return (
    <div className="promo-slide promo-slide--contest">
      <PosterDepth />

      <M.div
        className="promo-contest-camera"
        {...keyframes([
          [0, { scale: 1 }],
          [T.reveal, { scale: 1 }],
          [T.reveal + 0.1, { scale: 1.05 }],
          [T.reveal + 0.9, { scale: 1 }],
        ], ['linear', 'linear', EASE_OUT])}
      >
        <M.div
          className="promo-contest-shake"
          animate={{ x: shake.x, y: shake.y }}
          transition={{ duration: SHOWREEL_SEC, times: shake.times, ease: 'linear' }}
        >
          <GalleryWall />

          <M.div
            className="promo-contest-spot"
            aria-hidden="true"
            {...keyframes([
              [0, { x: '-75vw', opacity: 0 }],
              [0.6, { x: '-75vw', opacity: 0 }],
              [0.9, { opacity: 1 }],
              [T.push, { x: '52vw' }],
              [T.slap, { x: '0vw', opacity: 0.45 }],
              [T.reveal, { opacity: 0.45 }],
              [T.reveal + 0.15, { opacity: 1 }],
              [T.settle + 1, { opacity: 0.8 }],
            ], ['linear', 'linear', EASE_INOUT, EASE_OUT, 'linear', EASE_OUT, 'easeOut'])}
          />

          <Drift />
          <Sparkles />

          <div className="promo-contest-stack">
            <M.h2
              className="promo-headline promo-contest-headline"
              {...keyframes([
                [0, { y: '26vh', scale: 1.9 }],
                [T.push, { y: '26vh', scale: 1.9 }],
                [T.pushEnd + 0.1, { y: '0vh', scale: 1 }],
              ], ['linear', EASE_INOUT])}
            >
              <M.span
                className="promo-contest-hword"
                {...landsAt(T.poster, 0.55, { x: ['-80vw', '2vw', '0vw'], opacity: [0, 1, 1], skewX: [-24, 6, 0] })}
              >
                Poster
              </M.span>
              {' '}
              <M.span
                className="promo-contest-hword promo-contest-hword--gold"
                {...landsAt(T.contest, 0.55, { x: ['80vw', '-2vw', '0vw'], opacity: [0, 1, 1], skewX: [24, -6, 0] })}
              >
                Contest
              </M.span>
            </M.h2>

            <Sign tonight={promo.tonight} />
          </div>

          <SparkleBurst />
          <Band promo={promo} lines={lines} />
          <ConfettiCannon />
        </M.div>
      </M.div>

      <M.div
        className="promo-contest-flash"
        aria-hidden="true"
        {...keyframes([
          [0, { opacity: 0 }],
          [T.push + 0.3, { opacity: 0 }],
          [T.push + 0.42, { opacity: 0.55 }],
          [T.slap + 0.1, { opacity: 0 }],
          [T.reveal, { opacity: 0 }],
          [T.reveal + 0.06, { opacity: 0.6 }],
          [T.reveal + 0.5, { opacity: 0 }],
        ], ['linear', 'easeIn', 'easeOut', 'linear', 'easeIn', 'easeOut'])}
      />

      <Wordmark at={T.wordmark} />
      <CountdownChip label={promo.countdown} at={T.chip} pulses={[11.4, 13.4]} />
    </div>
  );
}
