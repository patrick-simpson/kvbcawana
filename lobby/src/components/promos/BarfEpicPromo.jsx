import { M } from '../../lib/motion.jsx';
import { formatLongDate } from '../../lib/calendarLogic.js';
import {
  PosterDepth, Wordmark, CountdownChip, RotatingDetail,
  SHOWREEL_SEC, EASE_SLAM, EASE_OUT, EASE_INOUT,
  landsAt, keyframes, buildShake, seeded, splatPath,
} from './kit.jsx';

// ─────────────────────────────────────────────────────────────
// BARF Night, the slime cut: the loud one. A 15 second blockbuster
// trailer for the same night as the BARF ("Bring A Real Friend") poster,
// cut in trailer grammar and landing on the finished slime poster.
//
//   0.6  COLD OPEN. Darkness, an anamorphic flare, a trailer card
//        ("THIS OCTOBER" / "TONIGHT"), and a huge glossy drop swelling
//        on a strand at the top of frame.
//   1.9  The drop lets go and falls at the lens, bigger and bigger,
//        until it SPLATS on the glass at 2.2 (flash, hard shake).
//   2.35 A TIDAL WAVE of goo curls in from the left, its crest rolling
//        (a morphing SVG path), spray flung ahead of it. At 2.95 the
//        whole screen is slime.
//   3.15 On the slime: THE, then BIGGEST, slam in with a chromatic split.
//   4.0  The flood slides off the glass (a liquid wipe down the screen),
//        leaving the goo wall at the top, its strands snapping back, and
//        a puddle mid-screen. THE BIGGEST rides up to its place.
//   4.95 B, A, R, F slam one at a time, each throwing a splat at the
//        glass; 6.15 EVER lands with the biggest hit of the piece.
//   6.55 A drop swells on the goo wall, falls, and hits the puddle at
//        7.15: a splash crown and a ripple.
//   7.3  Two plum kids rise out of the puddle and high-five (7.95).
//   7.9  BRING A REAL FRIEND rises out of the same puddle.
//   8.7  The date card (or, tonight, "Bring them to the check-in desk"),
//        9.35 the reward line, 9.6 the chip, 9.9 the wordmark, 10.3 the
//        closer. Finished poster by ~10.8 s; light sweeps across BARF at
//        11.0 and 13.0 while it holds.
//
// The frozen frame IS the poster (?lowPower=1 jumps every keyframe list to
// its end): every fact rests at opacity 1 in place, the splats end as
// stains, and every transient (card, macro drop, wave, flood, flashes,
// spray, crown, ghosts, sweeps) ends invisible or off-frame.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({
  default: Object.freeze(['Who will you bring?']),
  tonight: Object.freeze(['Welcome!']),
});

// Fixed copy, same either night.
export const EPIC_FRIEND_LINE = 'Bring A Real Friend';
export const EPIC_SHARES_LINE = '10 Awana Shares per friend + a BARF bag!';
export const EPIC_TONIGHT_LINE = 'Bring them to the check-in desk';

const LIME = '#7ed321';
const PALE = '#c7f26a';
const PLUM = '#3b1a63';
const DEEP_LIME = '#4f9a12';

// ── The beat sheet (seconds into the hold) ───────────────────
const T_CARD = 0.62;
const T_DROP_FALL = 1.9;
const T_GLASS = 2.2;
const T_WAVE = 2.35;
const T_FLOODED = 2.95;
const T_THE = 3.15;
const T_BIGGEST = 3.5;
const T_DRAIN = 4.0;
const T_PUDDLE = 4.5;
const T_BARF = [4.95, 5.21, 5.47, 5.73];
const T_EVER = 6.15;
const T_SWELL = 6.55;
const T_FALL = 6.9;
const T_SPLASH = 7.15;
const T_KIDS = 7.3;
const T_FIVE = 7.95;
const T_FRIEND = 7.9;
const T_DATE = 8.7;
const T_SHARES = 9.35;
const T_CHIP = 9.6;
const T_MARK = 9.9;
const T_CLOSER = 10.3;
const T_SWEEPS = [11.0, 13.0];
// Ambient loops wait for the poster to be standing.
const T_AMBIENT = 6.4;

/** Every hit knocks the whole frame; one keyframe list, ending at rest. */
export const EPIC_SHAKE = buildShake(
  [
    { at: T_GLASS, amp: 16 },
    { at: 2.66, amp: 7 },
    { at: T_THE + 0.03, amp: 8 },
    { at: T_BIGGEST + 0.03, amp: 10 },
    ...T_BARF.map((at, i) => ({ at: at + 0.03, amp: 6 + i * 2 })),
    { at: T_EVER + 0.03, amp: 16 },
    { at: T_SPLASH, amp: 4 },
    { at: T_FIVE, amp: 5 },
    { at: T_DATE + 0.03, amp: 7 },
  ],
  SHOWREEL_SEC,
);

/**
 * White flash spikes, one per hit, as keyframes that always end at 0.
 * Each spike decays before the next one starts, so times stay ordered.
 *
 * @param {ReadonlyArray<[number, number]>} peaks [at, opacity]
 */
export function flashFrames(peaks) {
  const frames = [[0, { opacity: 0 }]];
  peaks.forEach(([at, peak], i) => {
    const next = peaks[i + 1] ? peaks[i + 1][0] : Infinity;
    const decay = Math.min(0.3, next - at - 0.06);
    frames.push([at, { opacity: 0 }], [at + 0.035, { opacity: peak }], [at + 0.035 + decay, { opacity: 0 }]);
  });
  return frames;
}

const FLASH = keyframes(
  flashFrames([
    [T_GLASS, 0.42], [T_FLOODED, 0.3], [T_THE, 0.35], [T_BIGGEST, 0.35],
    ...T_BARF.map((at, i) => [at, i === 3 ? 0.32 : 0.2]),
    [T_EVER, 0.8], [T_FIVE, 0.25], [T_DATE, 0.3],
  ]),
  'easeOut',
);

// ── Pieces ───────────────────────────────────────────────────

/**
 * A word (or letter) that SLAMS: lands from huge, overshoots, and throws a
 * chromatic split (two tinted ghosts that snap back and vanish). The ghosts
 * are aria-hidden duplicates, so they carry the text but not the meaning.
 */
function Slam({ as = 'span', className = '', at, from = 3.2, tilt = 0, children, extra = null }) {
  const Tag = M[as];
  return (
    <Tag
      className={`promo-epic-slam ${className}`}
      {...landsAt(at, 0.42, {
        opacity: [0, 1],
        scale: [from, 0.9, 1.03, 1],
        rotate: [tilt, -tilt * 0.2, 0, 0],
      })}
    >
      {children}
      <M.span
        className="promo-epic-ghost promo-epic-ghost--pink"
        aria-hidden="true"
        {...keyframes([
          [0, { opacity: 0, x: '-0.09em' }],
          [at + 0.04, { opacity: 0, x: '-0.09em' }],
          [at + 0.09, { opacity: 0.95, x: '-0.07em' }],
          [at + 0.42, { opacity: 0, x: '0em' }],
        ], 'easeOut')}
      >
        {children}
      </M.span>
      <M.span
        className="promo-epic-ghost promo-epic-ghost--cyan"
        aria-hidden="true"
        {...keyframes([
          [0, { opacity: 0, x: '0.09em' }],
          [at + 0.04, { opacity: 0, x: '0.09em' }],
          [at + 0.09, { opacity: 0.95, x: '0.07em' }],
          [at + 0.42, { opacity: 0, x: '0em' }],
        ], 'easeOut')}
      >
        {children}
      </M.span>
      {extra}
    </Tag>
  );
}

/**
 * Goo running off something: grows downward from its anchor, then sags
 * forever. Two elements so the growth and the sag never share a scaleY.
 */
function Drip({ left, width, height, grow, period, tone = LIME }) {
  return (
    <M.span className="promo-epic-drip" style={{ left, width, height }} {...grow}>
      <M.span
        className="promo-epic-drip-body"
        style={{ background: tone }}
        animate={{ scaleY: [1, 1.18, 1] }}
        transition={{ duration: period, delay: T_AMBIENT, repeat: Infinity, ease: 'easeInOut' }}
      />
    </M.span>
  );
}

const dripGrow = (at) => landsAt(at, 0.5, { scaleY: [0, 1.18, 1] });

/**
 * A splat on the glass: bursts, settles, then slides into a stain. `rest`
 * is where it ends (0.72 is a stain; 0 for one that is only a transient).
 */
function GlassSplat({ seed, arms = 7, className, at, rest = 0.72, slide = '4vh', life = 6 }) {
  const total = at + life;
  return (
    <M.svg
      className={`promo-epic-splat ${className}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
      {...keyframes([
        [0, { opacity: 0, scale: 0.12, y: '0vh' }],
        [at, { opacity: 0, scale: 0.12, y: '0vh' }],
        [at + 0.12, { opacity: 1, scale: 1.18, y: '0vh' }],
        [at + 0.45, { opacity: 0.95, scale: 1, y: '0.4vh' }],
        [total, { opacity: rest, scale: 1.03, y: slide }],
      ], ['linear', EASE_SLAM, 'easeOut', 'easeInOut'])}
    >
      <path d={splatPath(seed, arms)} fill={LIME} />
      <ellipse cx="40" cy="37" rx="11" ry="6.5" fill={PALE} opacity="0.6" transform="rotate(-26 40 37)" />
      <circle cx="58" cy="30" r="3" fill="#ffffff" opacity="0.55" />
    </M.svg>
  );
}

/** One kid, in plum, one hand up ready to be met by the other one. */
function KidSilhouette({ flip }) {
  return (
    <svg
      className={`promo-epic-kid-art ${flip ? 'promo-epic-kid-art--flip' : ''}`}
      viewBox="0 0 110 140"
      aria-hidden="true"
    >
      <g fill={PLUM}>
        <circle cx="40" cy="24" r="19" />
        <rect x="24" y="46" width="34" height="48" rx="13" />
        <rect x="27" y="86" width="12" height="50" rx="6" />
        <rect x="45" y="86" width="12" height="50" rx="6" />
        <rect x="14" y="48" width="10" height="40" rx="5" transform="rotate(-13 19 52)" />
        <rect x="51" y="4" width="11" height="50" rx="5.5" transform="rotate(46.6 56.5 54)" />
        <circle cx="93" cy="19" r="10" />
      </g>
    </svg>
  );
}

// ── Art data (fixed, so indices are stable identities) ───────

// The tidal wave: a plunging breaker in a 4400x1000 box, its lip thrown
// further on each frame. Every frame has the same commands, so the path
// morphs point for point.
const WAVE_D = [
  'M0 1000 L0 150 C1400 120 2800 90 3600 130 C3900 150 4120 230 4200 380 C4260 500 4190 590 4090 560 C4010 535 4030 450 4110 470 C4040 600 3990 800 3980 1000 Z',
  'M0 1000 L0 140 C1400 100 2800 60 3650 100 C3980 120 4260 220 4340 420 C4390 560 4290 650 4170 610 C4080 580 4100 480 4190 500 C4100 640 4040 820 4030 1000 Z',
  'M0 1000 L0 150 C1400 120 2800 100 3700 150 C4050 180 4330 320 4380 560 C4410 700 4300 760 4200 720 C4120 690 4150 610 4220 630 C4150 740 4100 880 4090 1000 Z',
];

const WAVE_MORPH = keyframes([
  [0, { d: WAVE_D[0] }],
  [T_WAVE, { d: WAVE_D[0] }],
  [T_WAVE + 0.3, { d: WAVE_D[1] }],
  [T_FLOODED, { d: WAVE_D[2] }],
], ['linear', 'easeInOut', 'easeIn']);

// Spray thrown ahead of the crest: seeded, so every screen throws the
// same droplets. Each ends invisible.
const SPRAY = (() => {
  const rnd = seeded(907);
  return Array.from({ length: 18 }, (_, i) => {
    const t = T_WAVE + 0.12 + rnd() * 0.42;
    // Roughly where the crest is at that moment, then flung ahead.
    const x0 = -8 + ((t - T_WAVE) / (T_FLOODED - T_WAVE)) * 100;
    return {
      id: i,
      left: `${x0.toFixed(1)}vw`,
      top: `${(22 + rnd() * 26).toFixed(1)}vh`,
      size: 1 + rnd() * 2.6,
      t,
      dx: 6 + rnd() * 16,
      up: 6 + rnd() * 14,
      fall: 10 + rnd() * 26,
    };
  });
})();

// Bubbles rising through the flood while THE BIGGEST sits in it.
const BUBBLES = (() => {
  const rnd = seeded(521);
  return Array.from({ length: 14 }, (_, i) => ({
    id: i,
    left: `${(4 + rnd() * 92).toFixed(1)}%`,
    top: `${(35 + rnd() * 55).toFixed(1)}vh`,
    size: 1.2 + rnd() * 3.4,
    t: T_FLOODED + 0.05 + rnd() * 0.9,
    rise: 10 + rnd() * 18,
  }));
})();

// The flood's top edge as it slides off the glass.
const SHEET_D = [
  'M0 80 C150 20 300 60 450 30 C600 0 750 60 900 30 C1050 0 1150 50 1200 20 V80 Z',
  'M0 80 C150 45 300 8 450 46 C600 72 750 12 900 42 C1050 66 1150 14 1200 42 V80 Z',
];

const CURTAIN_D = 'M0 0 H1200 V78 C1150 118 1104 74 1050 96 C996 118 950 70 896 94 C842 118 796 72 742 96 C688 120 640 74 586 98 C532 122 486 76 432 98 C378 120 332 74 278 96 C224 118 178 72 124 94 C70 116 44 78 0 88 Z';

// The strands hanging off the goo wall: stretched long while the flood
// still hangs from them, snapping back as it lets go.
const CURTAIN_DRIPS = Object.freeze([
  { left: '5%', width: '1.6vmin', height: '5.5vh', lag: 0.02, period: 4.2 },
  { left: '13%', width: '1.1vmin', height: '3.4vh', lag: 0.1, period: 5.4 },
  { left: '24%', width: '1.4vmin', height: '4.6vh', lag: 0.05, period: 3.8 },
  { left: '34%', width: '0.9vmin', height: '2.6vh', lag: 0.14, period: 4.6 },
  { left: '66%', width: '1vmin', height: '3vh', lag: 0.12, period: 5.1 },
  { left: '76%', width: '1.2vmin', height: '4vh', lag: 0.07, period: 4.9 },
  { left: '87%', width: '1.7vmin', height: '5.2vh', lag: 0.03, period: 4.4 },
  { left: '95%', width: '1.2vmin', height: '3vh', lag: 0.11, period: 5.8 },
]);

const snapBack = (lag) => keyframes([
  [0, { scaleY: 0 }],
  [T_FLOODED, { scaleY: 0 }],
  [T_FLOODED + 0.02, { scaleY: 5 }],
  [T_DRAIN + 0.1 + lag, { scaleY: 5 }],
  [T_DRAIN + 0.6 + lag, { scaleY: 0.7 }],
  [T_DRAIN + 0.85 + lag, { scaleY: 1.12 }],
  [T_DRAIN + 1.05 + lag, { scaleY: 1 }],
], ['linear', 'linear', 'linear', EASE_INOUT, 'easeOut', 'easeInOut']);

const EDGE_DRIPS = Object.freeze([
  { side: 'left', top: '2%', size: 1.3, duration: 16, delay: -3 },
  { side: 'left', top: '4%', size: 0.9, duration: 21, delay: -12 },
  { side: 'left', top: '1%', size: 1.1, duration: 26, delay: -19 },
  { side: 'right', top: '3%', size: 1.4, duration: 18, delay: -7 },
  { side: 'right', top: '2%', size: 1, duration: 24, delay: -15 },
  { side: 'right', top: '5%', size: 1.2, duration: 29, delay: -22 },
]);

const BARF_LETTERS = ['B', 'A', 'R', 'F'];
const BARF_TILT = [-14, 10, -9, 13];
const BARF_DRIPS = Object.freeze([
  { width: '0.085em', height: '0.17em', period: 3.6 },
  { width: '0.065em', height: '0.1em', period: 4.8 },
  { width: '0.075em', height: '0.14em', period: 4.1 },
  { width: '0.06em', height: '0.08em', period: 5.3 },
]);
// One splat thrown at the glass with each letter, kept to the sides.
const BARF_SPLATS = Object.freeze([
  { seed: 41, arms: 7, cls: 'a' },
  { seed: 88, arms: 6, cls: 'b' },
  { seed: 123, arms: 8, cls: 'c' },
  { seed: 205, arms: 7, cls: 'd' },
]);

// The high-five burst: rays and droplets from where the hands meet.
const RAYS = Array.from({ length: 9 }, (_, i) => -90 + (i - 4) * 22);
const BURST = (() => {
  const rnd = seeded(333);
  return Array.from({ length: 12 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 12 + rnd() * 0.4;
    const r = 5 + rnd() * 6;
    return { id: i, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.8 - 2, size: 0.6 + rnd() * 0.9 };
  });
})();

function monthOf(eventDate) {
  const long = formatLongDate(eventDate);
  const month = long.split(', ')[1];
  return month ? month.split(' ')[0].toUpperCase() : 'OCTOBER';
}

// ── The poster ───────────────────────────────────────────────

export default function BarfEpicPromo({ promo, lines }) {
  const { tonight } = promo;
  const card = tonight ? 'TONIGHT' : `THIS ${monthOf(promo.eventDate)}`;

  return (
    <div className="promo-slide promo-slide--barf-epic">
      <PosterDepth />

      <M.div
        className="promo-epic-stage"
        animate={{ x: EPIC_SHAKE.x, y: EPIC_SHAKE.y }}
        transition={{ duration: SHOWREEL_SEC, times: EPIC_SHAKE.times, ease: 'linear' }}
      >
        {/* The cold open's darkness: lifts once the wave has covered it. */}
        <M.div
          className="promo-epic-night"
          aria-hidden="true"
          {...keyframes([[0, { opacity: 1 }], [T_FLOODED, { opacity: 1 }], [T_FLOODED + 0.05, { opacity: 0 }]])}
        />

        <div className="promo-epic-edges" aria-hidden="true">
          {EDGE_DRIPS.map((d, i) => (
            <M.span
              key={`${d.side}-${i}`}
              className={`promo-epic-edge-drip promo-epic-edge-drip--${d.side}`}
              style={{ top: d.top, width: `${d.size}vmin`, height: `${d.size * 2.6}vmin` }}
              animate={{ y: ['-14vh', '114vh'] }}
              transition={{ duration: d.duration, delay: d.delay, repeat: Infinity, ease: 'linear' }}
            />
          ))}
        </div>

        {/* The stains BARF throws at the glass. */}
        {BARF_SPLATS.map((s, i) => (
          <GlassSplat
            key={s.cls}
            seed={s.seed}
            arms={s.arms}
            className={`promo-epic-splat--${s.cls}`}
            at={T_BARF[i] + 0.02}
          />
        ))}
        <GlassSplat seed={17} arms={8} className="promo-epic-splat--e" at={T_EVER + 0.04} />

        {/* The goo wall, left behind as the flood lets go of the glass. */}
        <div className="promo-epic-curtain" aria-hidden="true">
          <M.div
            className="promo-epic-curtain-wall"
            {...keyframes([
              [0, { opacity: 0, scaleY: 3 }],
              [T_FLOODED, { opacity: 0, scaleY: 3 }],
              [T_FLOODED + 0.02, { opacity: 1, scaleY: 3 }],
              [T_DRAIN + 0.1, { opacity: 1, scaleY: 3 }],
              [T_DRAIN + 0.55, { opacity: 1, scaleY: 0.86 }],
              [T_DRAIN + 0.8, { opacity: 1, scaleY: 1.06 }],
              [T_DRAIN + 1.0, { opacity: 1, scaleY: 1 }],
            ], ['linear', 'linear', 'linear', EASE_INOUT, 'easeOut', 'easeInOut'])}
          >
            <svg viewBox="0 0 1200 130" preserveAspectRatio="none">
              <path d={CURTAIN_D} fill={LIME} />
              <path d="M0 22 C300 40 900 6 1200 26" stroke={PALE} strokeWidth="7" fill="none" opacity="0.55" strokeLinecap="round" />
            </svg>
            {CURTAIN_DRIPS.map((d) => (
              <Drip key={d.left} {...d} grow={snapBack(d.lag)} />
            ))}
          </M.div>
        </div>

        {/* The drop that falls off the goo wall into the puddle. */}
        <div className="promo-epic-faller-slot" aria-hidden="true">
          <M.div
            className="promo-epic-faller"
            {...keyframes([
              [0, { opacity: 0, scale: 0, y: '0vh', scaleY: 1 }],
              [T_SWELL, { opacity: 0, scale: 0, y: '0vh', scaleY: 1 }],
              [T_SWELL + 0.05, { opacity: 1, scale: 0.3 }],
              [T_FALL, { scale: 1, scaleY: 1.25 }],
              [T_SPLASH - 0.02, { y: '56vh', scaleY: 1.5 }],
              [T_SPLASH, { opacity: 0, y: '56vh', scaleY: 1 }],
            ], ['linear', 'easeOut', 'easeInOut', 'easeIn', 'linear'])}
          />
        </div>

        {/* THE BIGGEST: slams on the slime at centre, then rides up. */}
        <M.div
          className="promo-epic-row promo-epic-row--top"
          {...keyframes([
            [0, { y: '28vh', scale: 2.5 }],
            [T_THE, { y: '28vh', scale: 2.5 }],
            [T_DRAIN, { y: '28vh', scale: 2.75 }],
            [T_DRAIN + 0.62, { y: '0vh', scale: 1 }],
          ], ['linear', 'linear', EASE_INOUT])}
        >
          <Slam className="promo-epic-small promo-outline" at={T_THE} tilt={-8}>The</Slam>
          <Slam className="promo-epic-small promo-epic-biggest promo-outline" at={T_BIGGEST} tilt={6}>Biggest</Slam>
        </M.div>

        {/* BARF, the hero, with a jelly wobble on its own element. */}
        <div className="promo-epic-row promo-epic-row--hero">
          <M.div
            className="promo-epic-hero-wobble"
            animate={{ scaleX: [1, 1.025, 0.99, 1], scaleY: [1, 0.975, 1.012, 1] }}
            transition={{ duration: 3.2, delay: T_AMBIENT, repeat: Infinity, ease: 'easeInOut' }}
          >
            <div className="promo-epic-hero">
              {BARF_LETTERS.map((letter, i) => (
                <Slam
                  key={letter}
                  className="promo-epic-hero-letter promo-outline"
                  at={T_BARF[i]}
                  from={3.6}
                  tilt={BARF_TILT[i]}
                  extra={(
                    <Drip
                      left="50%"
                      width={BARF_DRIPS[i].width}
                      height={BARF_DRIPS[i].height}
                      grow={dripGrow(T_BARF[i] + 0.4)}
                      period={BARF_DRIPS[i].period}
                    />
                  )}
                >
                  {letter}
                </Slam>
              ))}
              {/* A light sweep across the letters, twice, ending off them. */}
              <M.span
                className="promo-epic-sweep"
                aria-hidden="true"
                {...keyframes([
                  [0, { backgroundPosition: '-120% 0%' }],
                  [T_SWEEPS[0], { backgroundPosition: '-120% 0%' }],
                  [T_SWEEPS[0] + 0.9, { backgroundPosition: '220% 0%' }],
                  [T_SWEEPS[1], { backgroundPosition: '-120% 0%' }],
                  [T_SWEEPS[1] + 0.9, { backgroundPosition: '220% 0%' }],
                ], ['linear', 'easeInOut', 'linear', 'easeInOut'])}
              >
                BARF
              </M.span>
            </div>
          </M.div>
        </div>

        {/* EVER, and the shockwave ring it throws. */}
        <div className="promo-epic-row promo-epic-row--ever">
          <M.span
            className="promo-epic-shock"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scale: 0.2 }],
              [T_EVER + 0.05, { opacity: 0, scale: 0.2 }],
              [T_EVER + 0.1, { opacity: 0.9, scale: 0.6 }],
              [T_EVER + 0.7, { opacity: 0, scale: 3.4 }],
            ], 'easeOut')}
          />
          <Slam className="promo-epic-small promo-epic-ever promo-outline" at={T_EVER} from={4.2} tilt={-5}>Ever</Slam>
        </div>

        {/* The puddle: kids stand on it, the friend line rises out of it. */}
        <div className="promo-epic-lower">
          <M.div
            className="promo-epic-puddle"
            {...keyframes([
              [0, { opacity: 0, scaleX: 0.08, scaleY: 1 }],
              [T_PUDDLE, { opacity: 0, scaleX: 0.08, scaleY: 1 }],
              [T_PUDDLE + 0.08, { opacity: 1, scaleX: 0.5 }],
              [T_PUDDLE + 0.45, { scaleX: 1.05 }],
              [T_PUDDLE + 0.7, { scaleX: 1 }],
              [T_SPLASH, { scaleX: 1, scaleY: 1 }],
              [T_SPLASH + 0.12, { scaleX: 1.04, scaleY: 0.82 }],
              [T_SPLASH + 0.34, { scaleX: 0.98, scaleY: 1.08 }],
              [T_SPLASH + 0.6, { scaleX: 1, scaleY: 1 }],
            ], ['linear', 'easeOut', EASE_SLAM, 'easeInOut', 'linear', 'easeOut', 'easeInOut', 'easeInOut'])}
          >
            <svg viewBox="0 0 1000 120" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M40 60 C40 20 120 12 200 18 C300 4 380 22 480 10 C580 0 660 20 760 12 C860 6 960 24 960 60 C960 98 880 110 780 104 C680 116 600 98 500 110 C400 120 320 100 220 108 C120 116 40 100 40 60 Z"
                fill={LIME}
              />
              <path d="M140 34 C300 22 520 30 700 24" stroke={PALE} strokeWidth="9" fill="none" strokeLinecap="round" opacity="0.7" />
            </svg>
            <div className="promo-epic-riser">
              <M.span
                className="promo-epic-friend"
                {...landsAt(T_FRIEND, 0.62, { y: ['125%', '-8%', '0%'] })}
              >
                {EPIC_FRIEND_LINE}
              </M.span>
            </div>
          </M.div>

          {/* The splash crown and ripple where the falling drop lands. */}
          <M.svg
            className="promo-epic-crown"
            viewBox="0 0 200 100"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scaleY: 0, scaleX: 0.6 }],
              [T_SPLASH, { opacity: 0, scaleY: 0, scaleX: 0.6 }],
              [T_SPLASH + 0.02, { opacity: 1, scaleY: 0.3 }],
              [T_SPLASH + 0.2, { scaleY: 1.2, scaleX: 1.1 }],
              [T_SPLASH + 0.5, { opacity: 0, scaleY: 0.1, scaleX: 1.3 }],
            ], ['linear', 'linear', EASE_SLAM, 'easeIn'])}
          >
            <path d="M20 100 C30 70 22 40 14 24 C34 46 44 66 56 78 C58 50 60 28 68 6 C74 34 80 58 84 78 C92 52 100 32 110 14 C112 44 110 64 114 82 C126 60 140 44 156 30 C148 56 140 76 142 90 C156 78 170 70 188 62 C176 80 176 92 180 100 Z" fill={LIME} />
          </M.svg>
          <M.span
            className="promo-epic-ripple"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scale: 0.2 }],
              [T_SPLASH, { opacity: 0, scale: 0.2 }],
              [T_SPLASH + 0.04, { opacity: 1, scale: 0.4 }],
              [T_SPLASH + 0.8, { opacity: 0, scale: 2.4 }],
            ], 'easeOut')}
          />

          {/* Two kids rise out of the goo and meet in a high five. */}
          <div className="promo-epic-kids">
            {[false, true].map((flip) => {
              const s = flip ? 1 : -1;
              return (
                <M.div
                  key={String(flip)}
                  className="promo-epic-kid"
                  {...keyframes([
                    [0, { y: '110%', x: `${s * 55}%` }],
                    [T_KIDS + (flip ? 0.1 : 0), { y: '110%', x: `${s * 55}%` }],
                    [T_KIDS + 0.45 + (flip ? 0.1 : 0), { y: '-7%' }],
                    [T_FIVE - 0.3, { y: '0%', x: `${s * 55}%` }],
                    [T_FIVE, { x: `${s * -6}%` }],
                    [T_FIVE + 0.25, { x: '0%' }],
                  ], ['linear', EASE_SLAM, 'easeInOut', 'easeIn', 'easeOut'])}
                >
                  <M.div
                    className="promo-epic-kid-bounce"
                    {...landsAt(T_FIVE + 0.05, 0.5, { y: ['0%', '-12%', '0%'], rotate: [0, s * 5, 0] }, 'easeOut')}
                  >
                    <KidSilhouette flip={flip} />
                  </M.div>
                </M.div>
              );
            })}
            <div className="promo-epic-pop-slot" aria-hidden="true">
              <M.span
                className="promo-epic-pop"
                {...keyframes([
                  [0, { opacity: 0, scale: 0.2 }],
                  [T_FIVE, { opacity: 0, scale: 0.2 }],
                  [T_FIVE + 0.06, { opacity: 1, scale: 0.8 }],
                  [T_FIVE + 0.5, { opacity: 0, scale: 2.2 }],
                ], 'easeOut')}
              />
              {RAYS.map((deg) => (
                <span key={deg} className="promo-epic-ray-slot" style={{ rotate: `${deg}deg` }}>
                  <M.span
                    className="promo-epic-ray"
                    {...keyframes([
                      [0, { opacity: 0, scaleX: 0, x: '0%' }],
                      [T_FIVE, { opacity: 0, scaleX: 0, x: '0%' }],
                      [T_FIVE + 0.08, { opacity: 1, scaleX: 1, x: '60%' }],
                      [T_FIVE + 0.42, { opacity: 0, scaleX: 0.2, x: '190%' }],
                    ], 'easeOut')}
                  />
                </span>
              ))}
              {BURST.map((b) => (
                <M.span
                  key={b.id}
                  className="promo-epic-burst"
                  style={{ width: `${b.size}vmin`, height: `${b.size}vmin` }}
                  {...keyframes([
                    [0, { opacity: 0, x: '0vmin', y: '0vmin' }],
                    [T_FIVE, { opacity: 0, x: '0vmin', y: '0vmin' }],
                    [T_FIVE + 0.04, { opacity: 1 }],
                    [T_FIVE + 0.55, { opacity: 0, x: `${b.x.toFixed(1)}vmin`, y: `${(b.y + 4).toFixed(1)}vmin` }],
                  ], 'easeOut')}
                />
              ))}
            </div>
          </div>
        </div>

        {/* The date card: slams in over an anamorphic flare. */}
        <div className="promo-epic-row promo-epic-row--date">
          <M.span
            className="promo-epic-flare promo-epic-flare--date"
            aria-hidden="true"
            {...keyframes([
              [0, { opacity: 0, scaleX: 0 }],
              [T_DATE, { opacity: 0, scaleX: 0 }],
              [T_DATE + 0.08, { opacity: 1, scaleX: 0.6 }],
              [T_DATE + 0.9, { opacity: 0, scaleX: 1.4 }],
            ], 'easeOut')}
          />
          <Slam
            className={`promo-date promo-outline promo-epic-date ${tonight ? 'promo-epic-date--long' : ''}`}
            at={T_DATE}
            from={1.9}
          >
            {tonight ? EPIC_TONIGHT_LINE : formatLongDate(promo.eventDate).toUpperCase()}
          </Slam>
        </div>

        {/* The reward line, wiped on behind a lime bar. */}
        <div className="promo-epic-row promo-epic-row--shares">
          <span className="promo-epic-shares-clip">
            <M.span
              className="promo-epic-shares"
              {...landsAt(T_SHARES + 0.12, 0.5, { opacity: [0, 1], x: ['-104%', '0%'] }, EASE_OUT)}
            >
              {EPIC_SHARES_LINE}
            </M.span>
            <M.span
              className="promo-epic-shares-bar"
              aria-hidden="true"
              {...keyframes([
                [0, { scaleX: 0, x: '0%' }],
                [T_SHARES, { scaleX: 0, x: '0%' }],
                [T_SHARES + 0.3, { scaleX: 1, x: '0%' }],
                [T_SHARES + 0.65, { scaleX: 1, x: '102%' }],
              ], ['linear', EASE_SLAM, EASE_INOUT])}
            />
          </span>
        </div>

        {/* The closer: the one detail slot, held off until its beat. */}
        <M.div
          className="promo-epic-row promo-epic-row--closer"
          {...landsAt(T_CLOSER, 0.5, { opacity: [0, 1], y: ['40%', '0%'] }, EASE_OUT)}
        >
          <RotatingDetail lines={lines} startMs={0} stepMs={2200} />
        </M.div>

        {/* ── Trailer layers above the poster; all end invisible ── */}

        {/* The flood left behind by the wave, sliding off the glass. */}
        <M.div
          className="promo-epic-flood"
          aria-hidden="true"
          {...keyframes([
            [0, { opacity: 0, y: '0vh' }],
            [T_FLOODED - 0.05, { opacity: 0, y: '0vh' }],
            [T_FLOODED, { opacity: 1, y: '0vh' }],
            [T_DRAIN, { opacity: 1, y: '0vh' }],
            [T_DRAIN + 0.85, { opacity: 1, y: '112vh' }],
            [T_DRAIN + 0.9, { opacity: 0, y: '112vh' }],
          ], ['linear', 'linear', 'linear', EASE_INOUT, 'linear'])}
        >
          {BUBBLES.map((b) => (
            <M.span
              key={b.id}
              className="promo-epic-bubble"
              style={{ left: b.left, top: b.top, width: `${b.size}vmin`, height: `${b.size}vmin` }}
              {...keyframes([
                [0, { opacity: 0, y: '0vh', scale: 0.4 }],
                [b.t, { opacity: 0, y: '0vh', scale: 0.4 }],
                [b.t + 0.15, { opacity: 0.9, scale: 1 }],
                [b.t + 0.9, { opacity: 0, y: `${-b.rise}vh`, scale: 1.15 }],
              ], ['linear', 'easeOut', 'easeIn'])}
            />
          ))}
          <svg className="promo-epic-flood-edge" viewBox="0 0 1200 80" preserveAspectRatio="none">
            <M.path
              fill={LIME}
              {...keyframes([
                [0, { d: SHEET_D[0] }],
                [T_DRAIN, { d: SHEET_D[0] }],
                [T_DRAIN + 0.4, { d: SHEET_D[1] }],
                [T_DRAIN + 0.85, { d: SHEET_D[0] }],
              ], 'easeInOut')}
            />
          </svg>
        </M.div>

        {/* The tidal wave: a curling crest that crosses the frame. */}
        <M.div
          className="promo-epic-wave"
          aria-hidden="true"
          {...keyframes([
            [0, { opacity: 1, x: '0vw' }],
            [T_WAVE, { opacity: 1, x: '0vw' }],
            [T_FLOODED, { opacity: 1, x: '126vw' }],
            [T_FLOODED + 0.08, { opacity: 0, x: '126vw' }],
          ], ['linear', [0.35, 0, 0.65, 1], 'linear'])}
        >
          <svg viewBox="0 0 4400 1000" preserveAspectRatio="none">
            <g transform="translate(70 -60)">
              <M.path fill={PALE} {...WAVE_MORPH} />
            </g>
            <M.path fill={LIME} {...WAVE_MORPH} />
            <g transform="translate(-40 40)" opacity="0.5">
              <M.path fill={DEEP_LIME} {...WAVE_MORPH} />
            </g>
            <g transform="translate(-160 90)">
              <M.path fill={LIME} {...WAVE_MORPH} />
            </g>
          </svg>
        </M.div>

        <div className="promo-epic-spray" aria-hidden="true">
          {SPRAY.map((p) => (
            <M.span
              key={p.id}
              className="promo-epic-spray-drop"
              style={{ left: p.left, top: p.top, width: `${p.size}vmin`, height: `${p.size}vmin` }}
              {...keyframes([
                [0, { opacity: 0, x: '0vw', y: '0vh' }],
                [p.t, { opacity: 0, x: '0vw', y: '0vh' }],
                [p.t + 0.03, { opacity: 1 }],
                [p.t + 0.22, { x: `${(p.dx * 0.6).toFixed(1)}vw`, y: `${(-p.up).toFixed(1)}vh` }],
                [p.t + 0.5, { opacity: 0, x: `${p.dx.toFixed(1)}vw`, y: `${p.fall.toFixed(1)}vh` }],
              ], ['linear', 'linear', 'easeOut', 'easeIn'])}
            />
          ))}
        </div>

        {/* COLD OPEN: the trailer card and its flare. */}
        <M.div
          className="promo-epic-card"
          aria-hidden="true"
          {...keyframes([
            [0, { opacity: 0, scale: 1.16 }],
            [T_CARD, { opacity: 0, scale: 1.16 }],
            [T_CARD + 0.3, { opacity: 1 }],
            [T_DROP_FALL, { opacity: 1, scale: 1.02 }],
            [T_DROP_FALL + 0.2, { opacity: 0, scale: 0.96 }],
          ], ['linear', 'easeOut', 'linear', 'easeIn'])}
        >
          <M.span
            className="promo-epic-flare"
            {...landsAt(T_CARD, 0.7, { scaleX: [0, 1] }, EASE_OUT)}
          />
          <M.span
            className="promo-epic-card-title"
            {...landsAt(T_CARD, 1.2, { letterSpacing: ['0.9em', '0.34em'] }, EASE_OUT)}
          >
            {card}
          </M.span>
          <M.span
            className="promo-epic-card-sub"
            {...landsAt(T_CARD + 0.5, 0.5, { opacity: [0, 1], y: ['40%', '0%'] }, EASE_OUT)}
          >
            One night. One friend.
          </M.span>
        </M.div>

        {/* The macro drop: swells on its strand, lets go, and falls at the
            lens until it hits the glass. */}
        <div className="promo-epic-macro-slot" aria-hidden="true">
          <M.span
            className="promo-epic-strand"
            {...keyframes([
              [0, { opacity: 0, scaleY: 0 }],
              [T_CARD, { opacity: 0, scaleY: 0 }],
              [T_CARD + 0.1, { opacity: 1, scaleY: 0.4 }],
              [T_DROP_FALL, { opacity: 1, scaleY: 1 }],
              [T_DROP_FALL + 0.22, { opacity: 0, scaleY: 0.2 }],
            ], ['linear', 'easeOut', 'easeInOut', EASE_SLAM])}
          />
          <M.div
            className="promo-epic-macro"
            {...keyframes([
              [0, { opacity: 0, scale: 0.2, y: '0vh', scaleY: 1 }],
              [T_CARD, { opacity: 0, scale: 0.2, y: '0vh', scaleY: 1 }],
              [T_CARD + 0.15, { opacity: 1, scale: 0.35 }],
              [T_DROP_FALL - 0.3, { scale: 0.92, scaleY: 1.14 }],
              [T_DROP_FALL, { scale: 1, scaleY: 1.22, y: '0vh' }],
              [T_GLASS - 0.02, { opacity: 1, scale: 7, scaleY: 1, y: '22vh' }],
              [T_GLASS, { opacity: 0, scale: 7, y: '22vh' }],
            ], ['linear', 'easeOut', 'easeInOut', 'easeInOut', 'easeIn', 'linear'])}
          >
            <svg viewBox="0 0 100 130">
              <defs>
                <radialGradient id="promo-epic-drop-fill" cx="0.38" cy="0.62" r="0.7">
                  <stop offset="0" stopColor={PALE} />
                  <stop offset="0.45" stopColor={LIME} />
                  <stop offset="1" stopColor={DEEP_LIME} />
                </radialGradient>
              </defs>
              <path d="M50 2 C56 30 92 58 92 86 C92 111 73 128 50 128 C27 128 8 111 8 86 C8 58 44 30 50 2 Z" fill="url(#promo-epic-drop-fill)" />
              <ellipse cx="34" cy="84" rx="9" ry="15" fill="#ffffff" opacity="0.55" transform="rotate(18 34 84)" />
              <circle cx="64" cy="104" r="4" fill="#ffffff" opacity="0.4" />
            </svg>
          </M.div>
        </div>

        {/* The big one, dead centre on the glass: gone once the wave hits. */}
        <GlassSplat seed={64} arms={9} className="promo-epic-splat--glass" at={T_GLASS} rest={0} slide="12vh" life={0.75} />

        <M.div className="promo-epic-flash" aria-hidden="true" {...FLASH} />
      </M.div>

      <Wordmark at={T_MARK} />
      <CountdownChip label={promo.countdown} at={T_CHIP} pulses={[11.8, 13.8]} />
    </div>
  );
}
