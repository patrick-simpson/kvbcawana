import { M } from '../../lib/motion.jsx';
import { formatLongDate } from '../../lib/calendarLogic.js';
import {
  PosterDepth, Wordmark, CountdownChip, RotatingDetail,
  landsAt, keyframes, seeded, EASE_SLAM, EASE_OUT, EASE_INOUT,
} from './kit.jsx';

// ─────────────────────────────────────────────────────────────
// Parents' Night: the warm one. A title sequence, not a shout.
//
// Beat sheet (seconds into the 15 s hold):
//   0.6  one rust line starts drawing itself in from the left edge, a
//        single continuous stroke that becomes a parent, then (2.5) the
//        clasped hands and a child reaching up; a gold light trail
//        follows the pen. The camera pushes in slowly the whole time.
//        The detail line sits under it like a subtitle from 1.4 s.
//   3.6  the heart is drawn out of the joined hands with the same line.
//   4.6  both figures pour back into the hands (the parent from its
//        start, the child from its end) and a golden-hour light leak
//        sweeps the frame as the heart floods gold and grows to hero
//        size (the match cut: two people become one heart).
//   6.0  lub-dub: the heart beats, rings ripple out, a burst of little
//        hearts flies off it and three parallax layers of hearts start
//        rising in depth. Second beat at 7.0.
//   7.3  the rust wave header flows in from the left like a ribbon, a
//        paler ribbon and a gold thread trailing it; the camera pulls
//        back and the heart rises to its place on the poster (8.5).
//   8.6  "Parents' Night" assembles letter by letter with overshoot;
//        wordmark and countdown chip land on the ribbon.
//   9.6  gold rule, 9.9 the date rises through its mask, 10.4 the
//        tagline. 10.2 a second light sweep crosses the finished card.
//  11.4  the heart beats again and the chip, title, rule and halo all
//        pulse on the same beat (again at 13.0). End card holds.
//
// The LAST keyframe of everything is the finished poster, which is the
// frame ?lowPower=1 freezes on. The line drawing, light leaks, rings and
// every little heart end invisible.
// ─────────────────────────────────────────────────────────────

// The poster's fixed tagline, and so the first detail line as well: the
// detail slot plays it as a subtitle under the line drawing, then moves on
// to the contest, while the tagline carries it on the end card.
const TAGLINE = 'Spend the evening with your clubber';

export const DETAILS = Object.freeze({
  default: Object.freeze([TAGLINE, 'Posters due Oct 14', 'DEFEND poster voting that night']),
  afterContest: Object.freeze([TAGLINE, 'Vote for your favorite DEFEND poster']),
  tonight: Object.freeze([TAGLINE, 'Vote for your favorite DEFEND poster tonight']),
});

const RUST = '#c85a2e';
const GOLD = '#e2a43c';

// Every heartbeat on the poster, lub-dub, so each element that pulses
// pulses on the same clock.
const BEATS = Object.freeze([6.0, 7.0, 11.4, 13.0]);
const END_BEATS = Object.freeze([11.4, 13.0]);

/** One scale keyframe list that beats lub-dub at every time in `beats`. */
function beatFrames(beats, amp) {
  return keyframes([
    [0, { scale: 1 }],
    ...beats.flatMap((t) => [
      [t, { scale: 1 }],
      [t + 0.1, { scale: 1 + amp }],
      [t + 0.22, { scale: 1 - amp * 0.15 }],
      [t + 0.32, { scale: 1 + amp * 0.6 }],
      [t + 0.55, { scale: 1 }],
    ]),
  ], 'easeInOut');
}

// ── The one-line drawing ─────────────────────────────────────
// viewBox 1600x900. The line runs in from off the left edge along the
// ground, with a loop flourish, up a parent's back, round the head, down
// the arm to the clasped hands at (800, 470): that is the first half. The
// second half leaves the hands, climbs a child's raised arm, loops the
// head, comes down the back to the ground and flows off the right edge.
const LINE_PARENT = [
  'M-40 640',
  'C110 640 190 606 250 618',
  'C318 632 332 694 292 696',
  'C252 698 244 646 328 640',
  'C430 634 540 646 590 640',
  'C622 636 626 560 634 474',
  'C644 424 622 384 640 350',
  'C650 332 612 318 618 286',
  'C624 246 692 240 700 280',
  'C708 318 670 338 656 332',
  'C648 328 660 342 672 346',
  'C702 356 722 384 742 412',
  'C762 440 782 462 800 470',
].join(' ');

const LINE_CHILD = [
  'M800 470',
  'C814 478 822 462 810 456',
  'C798 450 794 470 814 476',
  'C846 486 884 500 914 506',
  'C926 502 912 482 916 458',
  'C920 426 966 420 972 450',
  'C978 474 956 484 942 480',
  'C962 498 970 522 964 562',
  'C960 604 956 636 990 640',
  'C1070 646 1140 644 1218 630',
  'C1280 618 1302 580 1272 574',
  'C1240 568 1238 622 1302 634',
  'C1400 652 1500 640 1640 640',
].join(' ');

// The parent's line: drawn 0.6 to 2.5, then erased from its START toward
// the hands (the visible run is [offset, offset + length] = [o, 1]).
const PARENT_DRAW = keyframes([
  [0, { pathLength: 0, pathOffset: 0, opacity: 0 }],
  [0.6, { pathLength: 0, opacity: 0 }],
  [0.65, { opacity: 1 }],
  [2.5, { pathLength: 1 }],
  [4.6, { pathLength: 1, pathOffset: 0 }],
  [5.4, { pathLength: 0, pathOffset: 1, opacity: 1 }],
  [5.5, { opacity: 0 }],
], EASE_INOUT);

// The child's line: continues out of the hands 2.5 to 4.0, then pulls
// back INTO them from its far end.
const CHILD_DRAW = keyframes([
  [0, { pathLength: 0, opacity: 0 }],
  [2.45, { pathLength: 0, opacity: 0 }],
  [2.5, { opacity: 1 }],
  [4.0, { pathLength: 1 }],
  [4.6, { pathLength: 1 }],
  [5.4, { pathLength: 0, opacity: 1 }],
  [5.5, { opacity: 0 }],
], EASE_INOUT);

/** The gold light trail: the same draw a beat later, fainter and wider. */
function trailOf(draw, lag) {
  const { animate, transition } = draw;
  return {
    initial: draw.initial,
    animate: { ...animate, opacity: animate.opacity.map((o) => o * 0.45) },
    transition: { ...transition, delay: lag },
  };
}

const CAMERA = keyframes([
  [0, { scale: 1, y: '0vh' }],
  [5.4, { scale: 1.07, y: '-1vh' }],
  [7.4, { scale: 1.09, y: '-1vh' }],
  [8.8, { scale: 1, y: '0vh' }],
], [EASE_OUT, 'linear', EASE_INOUT]);

// ── The heart ────────────────────────────────────────────────
const HEART_PATH = 'M100 180 C40 132 10 100 10 66 C10 36 34 14 62 14 C80 14 94 24 100 36 C106 24 120 14 138 14 C166 14 190 36 190 66 C190 100 160 132 100 180z';

// Where the heart travels: born small just above the clasped hands, grown
// to hero size mid-frame, then lifted to its place on the finished card.
const HEART_MOVE = keyframes([
  [0, { opacity: 0, y: '15.5vh', scale: 0.55 }],
  [3.55, { opacity: 0 }],
  [3.6, { opacity: 1 }],
  [4.9, { y: '15.5vh', scale: 0.55 }],
  [5.9, { y: '21vh', scale: 1.9 }],
  [7.5, { y: '20vh', scale: 1.84 }],
  [8.5, { y: '0vh', scale: 1, opacity: 1 }],
], [EASE_OUT, 'linear', EASE_OUT, EASE_SLAM, 'linear', EASE_INOUT]);

const HEART_STROKE = keyframes([
  [0, { pathLength: 0 }],
  [3.6, { pathLength: 0 }],
  [4.9, { pathLength: 1 }],
], EASE_INOUT);

const HEART_FILL = landsAt(5.0, 0.7, { opacity: [0, 1] }, 'easeOut');
const HEART_BEAT = beatFrames(BEATS, 0.12);

// The warm halo behind the heart swells on every beat and rests lit.
const HALO = keyframes([
  [0, { opacity: 0, scale: 0.6 }],
  [5.0, { opacity: 0, scale: 0.6 }],
  [5.8, { opacity: 0.7, scale: 1 }],
  ...BEATS.flatMap((t) => [[t, { opacity: 0.7, scale: 1 }], [t + 0.14, { opacity: 1, scale: 1.25 }], [t + 0.7, { opacity: 0.7, scale: 1 }]]),
], 'easeInOut');

// Golden-hour rays behind the heart: they open as it floods gold, turn
// slowly for the rest of the piece and rest faint behind it on the card.
const RAYS = keyframes([
  [0, { opacity: 0, scale: 0.4 }],
  [5.0, { opacity: 0, scale: 0.4 }],
  [6.0, { opacity: 0.9, scale: 1 }],
  [7.6, { opacity: 0.9, scale: 1 }],
  [8.6, { opacity: 0.5, scale: 0.9 }],
], [EASE_OUT, EASE_SLAM, 'linear', EASE_INOUT]);
const RAYS_SPIN = {
  initial: { rotate: 0 },
  animate: { rotate: [0, 360] },
  transition: { duration: 60, ease: 'linear', repeat: Infinity },
};

// A white flash as the heart floods gold.
const FLOOD = landsAt(5.0, 0.9, { opacity: [0, 0.9, 0], scale: [0.4, 1.1, 1.6] }, 'easeOut');

// One ripple ring per beat, out and gone.
const RINGS = BEATS.map((t) => ({ t, anim: landsAt(t + 0.05, 1.3, { opacity: [0, 0.75, 0], scale: [0.7, 1.5, 2.6] }, EASE_OUT) }));

// The burst off the first beat: little hearts thrown outward, gone by 8 s.
const BURST = (() => {
  const rnd = seeded(1104);
  return Array.from({ length: 14 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 14 + (rnd() - 0.5) * 0.4;
    const dist = 16 + rnd() * 14;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.8;
    const size = 1.6 + rnd() * 2.2;
    const tone = i % 3 === 0 ? RUST : GOLD;
    const at = 6.05 + rnd() * 0.25;
    return {
      key: i,
      size,
      tone,
      anim: landsAt(at, 1.7, {
        opacity: [0, 1, 1, 0],
        x: ['0vmin', `${(dx * 0.6).toFixed(1)}vmin`, `${(dx * 0.9).toFixed(1)}vmin`, `${dx.toFixed(1)}vmin`],
        y: ['0vmin', `${(dy * 0.6).toFixed(1)}vmin`, `${(dy * 0.9 - 2).toFixed(1)}vmin`, `${(dy - 5).toFixed(1)}vmin`],
        scale: [0.2, 1, 0.9, 0.5],
        rotate: [0, (rnd() - 0.5) * 50, (rnd() - 0.5) * 70, (rnd() - 0.5) * 90],
      }, EASE_OUT),
    };
  });
})();

// Three parallax layers of rising hearts: far (small, faint, slow), mid,
// and near (big, quick, only on the flanks so they never cross the copy).
// Each loops forever and its last keyframe is invisible above the frame.
const FLOAT_LAYERS = (() => {
  const rnd = seeded(2026);
  const layer = (name, count, { size, alpha, dur, lanes }) => Array.from({ length: count }, (_, i) => {
    const lane = lanes[i % lanes.length];
    const left = lane[0] + rnd() * (lane[1] - lane[0]);
    const d = dur[0] + rnd() * (dur[1] - dur[0]);
    const sway = (rnd() - 0.5) * 6;
    return {
      key: `${name}${i}`,
      left: `${left.toFixed(1)}%`,
      width: `${(size[0] + rnd() * (size[1] - size[0])).toFixed(1)}vmin`,
      tone: rnd() < 0.35 ? 'rust' : 'gold',
      initial: { opacity: 0, y: '0vh', x: '0vw', rotate: 0 },
      animate: {
        opacity: [0, alpha, alpha, 0],
        y: ['0vh', '-40vh', '-80vh', '-125vh'],
        x: ['0vw', `${sway.toFixed(1)}vw`, `${(-sway * 0.6).toFixed(1)}vw`, `${(sway * 0.4).toFixed(1)}vw`],
        rotate: [0, sway * 3, -sway * 2, sway],
      },
      transition: { duration: d, times: [0, 0.3, 0.7, 1], ease: 'linear', repeat: Infinity, delay: (i * 0.37) % 2.4 },
    };
  });
  return [
    { name: 'far', hearts: layer('f', 12, { size: [1.1, 1.9], alpha: 0.35, dur: [13, 17], lanes: [[4, 96]] }) },
    { name: 'mid', hearts: layer('m', 9, { size: [2.4, 3.6], alpha: 0.6, dur: [9, 12], lanes: [[3, 30], [70, 97]] }) },
    { name: 'near', hearts: layer('n', 5, { size: [5.5, 8], alpha: 0.8, dur: [6, 8], lanes: [[-2, 12], [88, 102]] }) },
  ];
})();
const FLOAT_GATE = landsAt(5.8, 0.8, { opacity: [0, 1] }, 'easeOut');

// ── Light ────────────────────────────────────────────────────
/** A golden-hour light leak that sweeps across once and leaves off-frame. */
function sweep(at, dur) {
  return keyframes([
    [0, { x: '-80vw', opacity: 0, rotate: 18 }],
    [at, { x: '-80vw', opacity: 0 }],
    [at + dur * 0.25, { x: '-25vw', opacity: 1 }],
    [at + dur * 0.7, { x: '74vw', opacity: 1 }],
    [at + dur, { x: '140vw', opacity: 0, rotate: 18 }],
  ], 'linear');
}
const LEAK_1 = sweep(4.6, 2.2);
const LEAK_2 = sweep(10.1, 2.4);

// ── The ribbon header ────────────────────────────────────────
const WAVE_REST = 'M0 0 H1200 V146 C980 212 220 212 0 146 Z';
const WAVE_SWELL = 'M0 0 H1200 V132 C980 180 220 228 0 162 Z';
const WAVE_BACK_REST = 'M0 0 H1200 V172 C940 236 260 232 0 176 Z';
const WAVE_BACK_SWELL = 'M0 0 H1200 V160 C940 214 260 250 0 188 Z';
const THREAD_REST = 'M0 190 C260 244 940 246 1200 186';
const THREAD_SWELL = 'M0 200 C260 262 940 226 1200 176';

const ribbonIn = (at, dur) => keyframes([
  [0, { clipPath: 'inset(0% 100% 0% 0%)', y: '-3vh' }],
  [at, { clipPath: 'inset(0% 100% 0% 0%)', y: '-3vh' }],
  [at + dur, { clipPath: 'inset(0% 0% 0% 0%)', y: '0vh' }],
], [EASE_OUT, EASE_INOUT]);
const HEADER_BACK = ribbonIn(7.2, 1.1);
const HEADER_FRONT = ribbonIn(7.4, 1.1);
const THREAD = keyframes([
  [0, { pathLength: 0, opacity: 0 }],
  [7.6, { pathLength: 0, opacity: 0 }],
  [7.65, { opacity: 1 }],
  [8.9, { pathLength: 1, opacity: 1 }],
], EASE_INOUT);

// The swell is ambient and loops; it ends on the resting shape.
const swell = (rest, peak, dur) => ({
  initial: { d: rest },
  animate: { d: [rest, peak, rest] },
  transition: { duration: dur, repeat: Infinity, ease: 'easeInOut' },
});

// ── The copy ─────────────────────────────────────────────────
/**
 * The title, set letter by letter: each glyph rises, overshoots and
 * settles on its own beat. Words stay whole so a line only ever breaks
 * between them.
 */
function AssembledTitle({ text, at }) {
  const words = text.split(' ');
  const glyphs = text.replace(/ /g, '').length;
  const stagger = Math.min(0.075, 1.15 / glyphs);
  let n = 0;
  return (
    <span className="promo-par-title-text" aria-label={text}>
      {words.map((word, w) => [
        w > 0 ? ' ' : null,
        <span className="promo-par-word" key={`${word}${w}`} aria-hidden="true">
          {[...word].map((ch, c) => {
            const i = n;
            n += 1;
            return (
              <M.span
                key={c}
                className="promo-par-glyph"
                {...landsAt(at + i * stagger, 0.75, {
                  opacity: [0, 1, 1, 1],
                  y: ['0.7em', '-0.14em', '0.03em', '0em'],
                  rotate: [i % 2 ? 14 : -14, i % 2 ? -4 : 4, 0, 0],
                  scale: [0.5, 1.12, 0.98, 1],
                }, EASE_OUT)}
              >
                {ch}
              </M.span>
            );
          })}
        </span>,
      ])}
    </span>
  );
}

const TITLE_BEAT = beatFrames(END_BEATS, 0.03);
const RULE = landsAt(9.6, 0.8, { scaleX: [0, 1.1, 1] }, EASE_OUT);
const RULE_BEAT = keyframes([
  [0, { scaleX: 1 }],
  ...END_BEATS.flatMap((t) => [[t, { scaleX: 1 }], [t + 0.12, { scaleX: 1.18 }], [t + 0.55, { scaleX: 1 }]]),
], 'easeInOut');
const DATE = landsAt(9.9, 0.8, { y: ['115%', '-6%', '0%'], opacity: [0, 1, 1] }, EASE_OUT);
const TAGLINE_IN = landsAt(10.4, 0.8, { opacity: [0, 1], y: ['0.8em', '0em'] }, EASE_OUT);

export default function ParentsPromo({ promo, lines }) {
  const { tonight } = promo;
  const title = tonight ? 'Parents’ Night is tonight!' : 'Parents’ Night';
  const dateText = tonight ? 'Welcome, parents!' : formatLongDate(promo.eventDate).toUpperCase();

  return (
    <div className={`promo-slide promo-slide--parents${tonight ? ' promo-par--tonight' : ''}`}>
      <PosterDepth />

      {/* Far and mid layers of rising hearts sit behind everything. */}
      <M.div className="promo-par-floats promo-par-floats--back" aria-hidden="true" {...FLOAT_GATE}>
        {FLOAT_LAYERS.slice(0, 2).map((layer) => layer.hearts.map((h) => (
          <M.svg
            key={h.key}
            className={`promo-par-float promo-par-float--${h.tone} promo-par-float--${layer.name}`}
            style={{ left: h.left, width: h.width }}
            viewBox="0 0 200 190"
            initial={h.initial}
            animate={h.animate}
            transition={h.transition}
          >
            <path d={HEART_PATH} fill="currentColor" />
          </M.svg>
        )))}
      </M.div>

      {/* The scene the camera moves over: the line drawing and the heart. */}
      <M.div className="promo-par-camera" {...CAMERA}>
        <svg className="promo-par-drawing" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <M.path d={LINE_PARENT} className="promo-par-trail" {...trailOf(PARENT_DRAW, 0.09)} />
          <M.path d={LINE_CHILD} className="promo-par-trail" {...trailOf(CHILD_DRAW, 0.09)} />
          <M.path d={LINE_PARENT} className="promo-par-line" {...PARENT_DRAW} />
          <M.path d={LINE_CHILD} className="promo-par-line" {...CHILD_DRAW} />
        </svg>

        <div className="promo-par-heart-slot">
          <M.div className="promo-par-heart" {...HEART_MOVE}>
            <M.div className="promo-par-rays" aria-hidden="true" {...RAYS}>
              <M.div className="promo-par-rays-disc" {...RAYS_SPIN} />
            </M.div>
            <M.div className="promo-par-halo" aria-hidden="true" {...HALO} />
            {RINGS.map((r) => (
              <M.div key={r.t} className="promo-par-ring" aria-hidden="true" {...r.anim} />
            ))}
            <M.div className="promo-par-flood" aria-hidden="true" {...FLOOD} />
            <M.svg className="promo-par-heart-svg" viewBox="0 0 200 190" aria-hidden="true" {...HEART_BEAT}>
              <M.path d={HEART_PATH} fill={GOLD} {...HEART_FILL} />
              <M.path
                d={HEART_PATH}
                fill="none"
                stroke={RUST}
                strokeWidth="9"
                strokeLinejoin="round"
                strokeLinecap="round"
                {...HEART_STROKE}
              />
            </M.svg>
            <div className="promo-par-burst" aria-hidden="true">
              {BURST.map((b) => (
                <M.svg
                  key={b.key}
                  className="promo-par-burst-heart"
                  style={{ width: `${b.size.toFixed(1)}vmin`, color: b.tone }}
                  viewBox="0 0 200 190"
                  {...b.anim}
                >
                  <path d={HEART_PATH} fill="currentColor" />
                </M.svg>
              ))}
            </div>
          </M.div>
        </div>
      </M.div>

      {/* The ribbon header: a paler ribbon, the rust one, a gold thread. */}
      <div className="promo-par-header" aria-hidden="true">
        <M.svg className="promo-par-header-svg promo-par-header-svg--back" viewBox="0 0 1200 260" preserveAspectRatio="none" {...HEADER_BACK}>
          <M.path fill="#e08a5c" {...swell(WAVE_BACK_REST, WAVE_BACK_SWELL, 8.2)} />
        </M.svg>
        <M.svg className="promo-par-header-svg" viewBox="0 0 1200 260" preserveAspectRatio="none" {...HEADER_FRONT}>
          <M.path fill={RUST} {...swell(WAVE_REST, WAVE_SWELL, 7)} />
        </M.svg>
        <svg className="promo-par-header-svg" viewBox="0 0 1200 260" preserveAspectRatio="none">
          <M.g {...THREAD}>
            <M.path fill="none" stroke={GOLD} strokeWidth="4" strokeLinecap="round" vectorEffect="non-scaling-stroke" {...swell(THREAD_REST, THREAD_SWELL, 7)} />
          </M.g>
        </svg>
      </div>
      <Wordmark at={8.7} />

      <div className="promo-par-stack">
        <M.h2 className="promo-par-title" {...TITLE_BEAT}>
          <AssembledTitle text={title} at={8.6} />
        </M.h2>
        <M.div className="promo-par-rule" {...RULE}>
          <M.div className="promo-par-rule-bar" {...RULE_BEAT} />
        </M.div>
        <div className="promo-par-date-mask">
          <M.span className={`promo-date promo-par-date${tonight ? ' promo-par-date--welcome' : ''}`} {...DATE}>
            {dateText}
          </M.span>
        </div>
        <M.p className="promo-par-tagline" {...TAGLINE_IN}>{TAGLINE}</M.p>
        <RotatingDetail lines={lines} startMs={1400} stepMs={4000} />
      </div>

      {/* The near layer of hearts drifts in FRONT, on the flanks only. */}
      <M.div className="promo-par-floats promo-par-floats--front" aria-hidden="true" {...FLOAT_GATE}>
        {FLOAT_LAYERS[2].hearts.map((h) => (
          <M.svg
            key={h.key}
            className={`promo-par-float promo-par-float--${h.tone} promo-par-float--near`}
            style={{ left: h.left, width: h.width }}
            viewBox="0 0 200 190"
            initial={h.initial}
            animate={h.animate}
            transition={h.transition}
          >
            <path d={HEART_PATH} fill="currentColor" />
          </M.svg>
        ))}
      </M.div>

      <M.div className="promo-par-leak" aria-hidden="true" {...LEAK_1} />
      <M.div className="promo-par-leak promo-par-leak--late" aria-hidden="true" {...LEAK_2} />

      <CountdownChip label={promo.countdown} at={9.1} pulses={[...END_BEATS]} />
    </div>
  );
}
