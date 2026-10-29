import { M } from '../../lib/motion.jsx';
import { formatLongDate } from '../../lib/calendarLogic.js';
import {
  PosterDepth,
  Wordmark,
  CountdownChip,
  RotatingDetail,
  landsAt,
  keyframes,
  seeded,
  EASE_SLAM,
  EASE_OUT,
  EASE_INOUT,
} from './kit.jsx';
import OLDER_1 from '../../assets/promos/finalists/older-1.jpg';
import OLDER_2 from '../../assets/promos/finalists/older-2.jpg';
import OLDER_3 from '../../assets/promos/finalists/older-3.jpg';
import YOUNGER_1 from '../../assets/promos/finalists/younger-1.jpg';
import YOUNGER_2 from '../../assets/promos/finalists/younger-2.jpg';
import YOUNGER_3 from '../../assets/promos/finalists/younger-3.jpg';

// ─────────────────────────────────────────────────────────────
// The DEFEND poster contest's six finalists: "vote for your favorite"
// (owner 2026-10-28), an 18 second showreel in the contest poster's navy and
// gold that ends on a framed gallery of the six, numbered for the vote that
// ends Wednesday, November 4 (owner 2026-10-28: the promo never names
// Parents' Night, only that voting ends that Wednesday). Two divisions (owner 2026-10-28), one vote in each: Older
// Kids is the top row, Younger Kids the bottom, each numbered 1 to 3 (the
// paper ballot's numbers).
//
// The art is the clubbers' own posters, photographed on the wall, squared up
// and white-balanced; every name on them is painted out (a name label on one,
// a signature on another): the finalists are judged by number, and nothing
// on a lobby screen carries a child's last name.
//
// Beats, seconds into the 21 s hold:
//   0.3  "DEFEND Poster Contest" kicker, then 0.55 THE FINALISTS slams in
//        under a spotlight, a gold rule sweeps under it; 1.7 it lifts away.
//   1.8  THE PARADE, one poster every 1.85 s, each with its EPIC ZOOM (owner
//        2026-10-28: "Give each one of them an epic zoom in"): it bursts in
//        from small and zooms in until it fills the screen (the spotlight
//        flares), hangs there a beat, pulls back to its presented size with a
//        small overshoot while the art inside slowly pushes in (Ken Burns),
//        captioned with its division and number, then glides into its frame
//        in the 3 x 2 gallery (the last lands at 13.35); each row's division
//        label lands with its first poster.
//  13.5  THE CALL: the left panel lands: kicker, VOTE FOR YOUR FAVORITE!
//        word by word, "Pick one in each division.", the gold band with
//        VOTING ENDS and its date; the logo, the chip and the detail line.
//  16.2  Ambient: the number badges pulse in turn, then the finished
//        end card holds to 21 s.
//
// Every element's LAST keyframe is the finished poster (?lowPower=1 freezes on
// it: the gallery in place, the call landed, no title card, no spotlight).
// Laid out in a 16:9 frame in container units (cqw), so the Settings preview,
// a phone's frame and a 4K wall all draw the same picture.
// ─────────────────────────────────────────────────────────────

export const DETAILS = Object.freeze({
  default: Object.freeze([
    'One vote in each division',
    'Made by our clubbers',
  ]),
  tonight: Object.freeze([
    'Last chance to vote',
    'Voting ends tonight',
  ]),
});

/** The two divisions, top row first. */
export const DIVISIONS = Object.freeze(['Older Kids', 'Younger Kids']);

// Each poster's own shape (width / height of its file): its frame hugs it, so
// the one tall poster hangs in a tall frame rather than in a sea of mat.
const ART = [[OLDER_1, 2000 / 1326], [OLDER_2, 2000 / 1336], [OLDER_3, 1552 / 1976], [YOUNGER_1, 2000 / 1276], [YOUNGER_2, 2000 / 1298], [YOUNGER_3, 1986 / 1319]];

/** The six finalists in gallery order (left to right, top row first): each division numbered 1 to 3. */
export const FINALISTS = Object.freeze(ART.map(([src, aspect], i) => Object.freeze({
  src,
  aspect,
  division: DIVISIONS[Math.floor(i / 3)],
  n: (i % 3) + 1,
})));

/** How long the slideshow holds this poster (promos.js SEASON_PROMOS carries the same number). */
export const FINALISTS_SEC = 21;

// ── The clock ────────────────────────────────────────────────
export const T = Object.freeze({
  kicker: 0.3,
  title: 0.55,
  rule: 0.85,
  titleOut: 1.7,
  parade: 1.8,
  every: 1.85,
  zoom: 0.5,
  fill: 0.25,
  settle: 0.6,
  hold: 0.5,
  glide: 0.45,
  call: 13.5,
  words: [13.7, 13.95, 14.2],
  sub: 14.65,
  band: 14.95,
  chip: 15.3,
  wordmark: 13.5,
  detailMs: 15700,
  detailStepMs: 1800,
  pulse: 16.2,
  pulseStep: 0.45,
  end: FINALISTS_SEC,
});

/**
 * Poster `i`'s (0..5) beats: it starts (`t`), fills the screen (`full`), lets
 * go of it (`release`), is presented (`shown`), starts to glide, and lands.
 */
export function paradeBeats(i) {
  const t = T.parade + i * T.every;
  const full = t + T.zoom;
  const release = full + T.fill;
  const shown = release + T.settle;
  const glide = shown + T.hold;
  return { t, full, release, shown, glide, landed: glide + T.glide };
}

// The gallery, in cqw of the 16:9 frame (100 x 56.25): a 3 x 2 grid on the
// right, the call on the left.
// Each row wears its division's label in the gap above it.
export const GRID = Object.freeze({ left: 33.4, top: 12.4, w: 19.6, h: 14.8, gapX: 2.6, gapY: 4.8 });
const CENTRE = Object.freeze({ x: 50, y: 28.125 });
const PRESENT_SCALE = 2.35;
// Each frame is DRAWN at its presented size (RASTER x its gallery size) and
// rests shrunk into its slot: the browser paints a layer once at its own size
// and a scaled-up layer goes soft, so the long look at the centre is the sharp
// one. Every scale in frameBeat() is in gallery units, divided by RASTER.
const RASTER = PRESENT_SCALE;
// The epic zoom: the frame scaled until the poster fills the 16:9 screen.
const FILL_SCALE = 4.7;

// The mat's padding (each side) in cqw, as finalists.css draws it.
const MAT = 0.75;

/** The frame for art of `aspect`, as big as fits the slot, centred in it. */
export function frameBox(aspect) {
  const inner = { w: GRID.w - 2 * MAT, h: GRID.h - 2 * MAT };
  const artW = Math.min(inner.w, inner.h * aspect);
  const w = artW + 2 * MAT;
  const h = artW / aspect + 2 * MAT;
  return { w, h, dx: (GRID.w - w) / 2, dy: (GRID.h - h) / 2 };
}

function slot(i) {
  const col = i % 3;
  const row = Math.floor(i / 3);
  const left = GRID.left + col * (GRID.w + GRID.gapX);
  const top = GRID.top + row * (GRID.h + GRID.gapY);
  return { left, top, cx: left + GRID.w / 2, cy: top + GRID.h / 2 };
}

/**
 * One poster's journey: out of the dark and zoomed in until it fills the
 * screen, held there, pulled back to be presented at the centre (with a small
 * overshoot), then into its frame (its resting place).
 */
function frameBeat(i) {
  const { t, full, release, shown, glide, landed } = paradeBeats(i);
  const s = slot(i);
  const dx = `${(CENTRE.x - s.cx).toFixed(2)}cqw`;
  const dy = `${(CENTRE.y - s.cy).toFixed(2)}cqw`;
  const tilt = i % 2 ? 2.2 : -2.2;
  const under = PRESENT_SCALE * 0.96;
  return keyframes([
    [0, { opacity: 0, x: dx, y: dy, scale: 0.3 / RASTER, rotate: tilt * 4 }],
    [t, { opacity: 0, x: dx, y: dy, scale: 0.3 / RASTER, rotate: tilt * 4 }],
    [full, { opacity: 1, x: dx, y: dy, scale: FILL_SCALE / RASTER, rotate: 0 }],
    [release, { opacity: 1, x: dx, y: dy, scale: (FILL_SCALE * 1.03) / RASTER, rotate: 0 }],
    [release + T.settle * 0.7, { opacity: 1, x: dx, y: dy, scale: under / RASTER, rotate: tilt }],
    [shown, { opacity: 1, x: dx, y: dy, scale: PRESENT_SCALE / RASTER, rotate: tilt }],
    [glide, { opacity: 1, x: dx, y: dy, scale: (PRESENT_SCALE * 1.015) / RASTER, rotate: tilt * 0.6 }],
    [landed, { opacity: 1, x: '0cqw', y: '0cqw', scale: 1 / RASTER, rotate: 0 }],
  ], ['linear', EASE_SLAM, 'linear', EASE_INOUT, EASE_OUT, 'easeInOut', EASE_INOUT]);
}

/** The art's slow push-in while it is presented (Ken Burns), back to rest as it glides. */
function artDrift(i) {
  const { release, glide, landed } = paradeBeats(i);
  return keyframes([
    [0, { scale: 1 }],
    [release, { scale: 1 }],
    [glide, { scale: 1.07 }],
    [landed, { scale: 1 }],
  ], ['linear', 'easeOut', EASE_INOUT]);
}

/** The spotlight flares as each poster fills the screen. */
const FLARE = keyframes([
  [0, { opacity: 0 }],
  ...Array.from({ length: 6 }, (_, i) => {
    const { t, full, shown } = paradeBeats(i);
    return [[t + 0.05, { opacity: 0 }], [full, { opacity: 0.55 }], [shown, { opacity: 0 }]];
  }).flat(),
  [T.call, { opacity: 0 }],
], 'easeInOut');

/** The badge's pulse in the ambient tail (its own turn), resting at 1. */
function badgePulse(i) {
  const at = T.pulse + i * T.pulseStep;
  return keyframes([
    [0, { scale: 1 }],
    [at, { scale: 1 }],
    [at + 0.18, { scale: 1.28 }],
    [at + 0.5, { scale: 1 }],
  ], ['linear', EASE_OUT, 'easeInOut']);
}

/** The spotlight under the parade: up with the title, gone once the gallery is full. */
const SPOT = keyframes([
  [0, { opacity: 0, scale: 0.7 }],
  [0.4, { opacity: 0, scale: 0.7 }],
  [1.0, { opacity: 1, scale: 1 }],
  [T.call - 0.2, { opacity: 1, scale: 1.04 }],
  [T.call + 0.6, { opacity: 0, scale: 1.2 }],
]);

/** The title card's lift: in, then up and away (it ends invisible). */
const TITLE_OUT = keyframes([
  [0, { opacity: 1, y: '0cqw', scale: 1 }],
  [T.titleOut, { opacity: 1, y: '0cqw', scale: 1 }],
  [T.titleOut + 0.45, { opacity: 0, y: '-6cqw', scale: 0.9 }],
], ['linear', EASE_INOUT]);

// Gold dust, seeded so every screen draws the same sky; each mote twinkles
// and rests where it started.
const DUST = (() => {
  const rnd = seeded(1104);
  return Array.from({ length: 26 }, (_, k) => ({
    k,
    left: `${(rnd() * 100).toFixed(2)}%`,
    top: `${(rnd() * 100).toFixed(2)}%`,
    size: `${(0.18 + rnd() * 0.32).toFixed(2)}cqw`,
    at: 0.4 + rnd() * 2,
    dur: 3 + rnd() * 3,
  }));
})();

function Dust() {
  return (
    <div className="promo-fin-dust" aria-hidden="true">
      {DUST.map((d) => (
        <M.i
          key={d.k}
          className="promo-fin-mote"
          style={{ left: d.left, top: d.top, width: d.size, height: d.size }}
          {...keyframes([
            [0, { opacity: 0 }],
            [d.at, { opacity: 0 }],
            [d.at + d.dur * 0.4, { opacity: 0.9 }],
            [d.at + d.dur, { opacity: 0.35 }],
          ], 'easeInOut')}
        />
      ))}
    </div>
  );
}

/** A row's division label: lands with the row's first poster. */
function RowLabel({ row }) {
  const top = slot(row * 3).top;
  return (
    <M.p
      className="promo-fin-row"
      style={{ top: `${(top - 3.1).toFixed(2)}cqw` }}
      {...landsAt(paradeBeats(row * 3).landed - 0.1, 0.45, { opacity: [0, 1], y: ['0.8cqw', '0cqw'] }, EASE_OUT)}
    >
      <span>{DIVISIONS[row]}</span>
    </M.p>
  );
}

/** Under the presented poster: its division and number, while it holds the centre. */
function presentCaption(i) {
  const { release, shown, glide } = paradeBeats(i);
  return keyframes([
    [0, { opacity: 0, y: '1cqw' }],
    [release + 0.1, { opacity: 0, y: '1cqw' }],
    [shown, { opacity: 1, y: '0cqw' }],
    [glide + 0.1, { opacity: 1, y: '0cqw' }],
    [glide + 0.35, { opacity: 0, y: '0cqw' }],
  ], ['linear', EASE_OUT, 'linear', 'easeIn']);
}

function Frame({ finalist, i }) {
  const { src, aspect, division, n } = finalist;
  const s = slot(i);
  const box = frameBox(aspect);
  return (
    <M.figure
      className={`promo-fin-frame promo-fin-frame--${i + 1}`}
      style={{
        left: `${(s.cx - (box.w * RASTER) / 2).toFixed(2)}cqw`,
        top: `${(s.cy - (box.h * RASTER) / 2).toFixed(2)}cqw`,
        width: `${(box.w * RASTER).toFixed(2)}cqw`,
        height: `${(box.h * RASTER).toFixed(2)}cqw`,
        '--fin-k': RASTER,
        zIndex: 10 + i,
      }}
      {...frameBeat(i)}
    >
      <div className="promo-fin-mat">
        <M.img className="promo-fin-art" src={src} alt={`${division} ${n}`} draggable="false" decoding="async" {...artDrift(i)} />
      </div>
      <M.span className="promo-fin-badge" {...badgePulse(i)}>{n}</M.span>
    </M.figure>
  );
}

const CALL_WORDS = ['Vote for', 'your', 'favorite!'];

/** The finalists poster. `promo` is a descriptor from buildPromoSlot(). */
export default function FinalistsPromo({ promo, lines }) {
  const tonight = promo.tonight;
  const date = tonight ? 'TONIGHT' : formatLongDate(promo.eventDate).toUpperCase();
  return (
    <div className={`promo-slide promo-slide--finalists${tonight ? ' promo-fin--tonight' : ''}`}>
      <PosterDepth />
      <div className="promo-fin-stage">
        <Dust />
        <M.div className="promo-fin-spot" aria-hidden="true" {...SPOT} />
        <M.div className="promo-fin-flare" aria-hidden="true" {...FLARE} />

        {/* Act 1: the title card (transient: it ends invisible). */}
        <M.div className="promo-fin-title" aria-hidden="true" {...TITLE_OUT}>
          <M.p className="promo-fin-title-kicker" {...landsAt(T.kicker, 0.4, { opacity: [0, 1], y: ['1.2cqw', '0cqw'] }, EASE_OUT)}>
            DEFEND Poster Contest
          </M.p>
          <M.p className="promo-fin-title-word" {...landsAt(T.title, 0.5, { opacity: [0, 1], scale: [1.6, 0.96, 1] })}>
            The Finalists
          </M.p>
          <M.i className="promo-fin-title-rule" {...landsAt(T.rule, 0.5, { scaleX: [0, 1] }, EASE_OUT)} />
        </M.div>

        {/* Act 2: the gallery. */}
        <div className="promo-fin-gallery">
          {DIVISIONS.map((d, row) => <RowLabel key={d} row={row} />)}
          {FINALISTS.map((f, i) => <Frame key={f.src} finalist={f} i={i} />)}
        </div>
        <div className="promo-fin-captions" aria-hidden="true">
          {FINALISTS.map((f, i) => (
            <M.p key={f.src} className="promo-fin-caption" {...presentCaption(i)}>
              {f.division} <b>No. {f.n}</b>
            </M.p>
          ))}
        </div>

        {/* Act 3: the call. */}
        <div className="promo-fin-call">
          <M.p className="promo-fin-kicker" {...landsAt(T.call, 0.4, { opacity: [0, 1], x: ['-2cqw', '0cqw'] }, EASE_OUT)}>
            DEFEND Poster Contest
          </M.p>
          <h1 className="promo-fin-headline">
            {CALL_WORDS.map((w, k) => (
              <M.span key={w} className="promo-fin-word" {...landsAt(T.words[k], 0.45, { opacity: [0, 1], y: ['3cqw', '-0.4cqw', '0cqw'], scale: [0.8, 1.04, 1] })}>
                {w}
              </M.span>
            ))}
          </h1>
          <M.p className="promo-fin-sub" {...landsAt(T.sub, 0.4, { opacity: [0, 1] }, EASE_OUT)}>
            Pick one in each division.
          </M.p>
          <M.div className="promo-fin-band" {...landsAt(T.band, 0.5, { opacity: [0, 1], clipPath: ['inset(0 100% 0 0)', 'inset(0 0% 0 0)'] }, EASE_INOUT)}>
            <span className="promo-fin-band-what">Voting ends</span>
            <span className="promo-fin-band-date">{date}</span>
          </M.div>
          <div className="promo-fin-detail">
            <RotatingDetail lines={lines} startMs={T.detailMs} stepMs={T.detailStepMs} />
          </div>
        </div>
      </div>
      <Wordmark at={T.wordmark} />
      <CountdownChip label={promo.countdown} at={T.chip} pulses={[17.2, 19.6]} />
    </div>
  );
}
