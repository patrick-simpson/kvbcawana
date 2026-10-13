import React from 'react';
import { useLowPowerSwitch, useReducedMotion } from '../hooks/useLowPower.js';
import { autoSkin } from '../../lib/skins.js';
import { HOUSE, KIT_CLUBS, mulberry32, shade } from '../lib/kit.js';
import { weatherLabel } from '../lib/weatherLabel.js';

// The countdown's ambient weather, redrawn in the catalog's flat language
// (owner 2026-10-12, of the old soft white blobs: "What's the weird diagonal
// white blur? Make it more obvious what it is, redesign the weather
// effects."). Every piece is a flat inline SVG or CSS shape with hard edges
// and, where it has one, a hard offset shadow: NEVER a blur, a glow or a soft
// gradient (the projector rule: flat on pure black, projected on a blank
// wall). Each weather is the shape a child would draw for it:
//
//   clear    the starfield (and a rare flat shooting star)
//   cloudy   cartoon clouds, stacked bumps on a flat base, drifting across
//   fog      flat wavy stripes and ground bands sliding at different speeds
//   rain     slanted streaks falling, little splash arcs at the bottom
//   thunder  dark clouds, rain, and a zig-zag bolt that flashes twice now
//            and then (never more than two flashes a second, never the whole
//            wall: photosensitivity)
//   snow     flat flakes in three sizes sinking and swaying
//
// plus the season's leaves, blossoms or fireflies in the same flat language,
// and a small label chip ("Cloudy · 54°F") so the wall says what it is
// drawing.
//
// Motion is transform and opacity only, on long calm loops, in plain CSS
// (index.css, "The weather scene"): every animated piece's resting place IS
// its still frame, and each loop starts from it, so with the animation off
// (a paused tab, `prefers-reduced-motion`, `still`) the wall shows a finished,
// recognisable picture. The OS (or browser) reduced-motion setting shows
// exactly that still frame and the chip (owner 2026-10-13: an accessibility
// setting asks for no motion, not for no weather; the thunder still frame is
// one bolt lit and steady, never a flash). The low-power switch (?vr=1, the
// QuickNav toggle: a weak-PC switch) still hides the whole layer, chip
// included.

/**
 * `n` deterministic places in the unit square, evenly spread with no rows,
 * columns or diagonals (a seeded Latin hypercube: one piece per column band
 * and one per row band, paired at random). Same seed, same picture.
 */
export function scatter(n, seed) {
  const rand = mulberry32(seed);
  const cols = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  return cols.map((col, row) => ({ x: (col + rand()) / n, y: (row + rand()) / n }));
}

// ── Clouds ──
// Path in a 120 x 60 box: four bumps on a flat base (a cloud, not a blob).
const CLOUD_PATH = 'M14 56 A15 15 0 0 1 20 30 A19 19 0 0 1 52 14 A22 22 0 0 1 92 22 A19 19 0 0 1 106 56 Z';
/** The hard shadow's offset, in the cloud's own 120 x 60 box. */
const CLOUD_SHADOW = { dx: 4, dy: 5 };

/**
 * One drifting cloud: `x`/`y` its place in the still frame (% of the wall),
 * `w` its width in projector units, `secs` one full pass across the wall.
 * The loop starts where the still frame has it (the negative delay), so the
 * first moving frame IS the still one.
 */
const drift = ({ x, y, w, secs }) => ({
  x, y, w, secs,
  // pjWxDrift: from 2vw past the left edge (its right side) to 2vw past the right.
  delay: -((x + w + 2) / (104 + w)) * secs,
});

// Light, cool tints at partial strength over black: a dim blue-grey cloud the
// white figures stay crisp over, with a hard shadow in the house's deep blue.
const CLOUDY_TINTS = [HOUSE.sky, HOUSE.cloud, KIT_CLUBS.cubbies.tint, KIT_CLUBS.puggles.tint];
export const CLOUDS = [
  drift({ x: 17, y: 8, w: 15, secs: 190 }),
  drift({ x: 60, y: 4, w: 19, secs: 230 }),
  drift({ x: 38, y: 15, w: 10, secs: 170 }),
  drift({ x: 78, y: 79, w: 16, secs: 210 }),
  drift({ x: 8, y: 83, w: 12, secs: 180 }),
].map((c, i) => ({ ...c, id: i, fill: CLOUDY_TINTS[i % CLOUDY_TINTS.length], shadow: HOUSE.blueDeep, opacity: 0.4 + (i % 2) * 0.06 }));

// Thunder's clouds: the Journey purples, darker and heavier, each carrying
// its own bolt so the bolt drifts with the cloud it falls from.
export const STORM_CLOUDS = [
  drift({ x: 16, y: 3, w: 18, secs: 260 }),
  drift({ x: 41, y: 0, w: 21, secs: 300 }),
  drift({ x: 66, y: 6, w: 15, secs: 280 }),
].map((c, i) => ({ ...c, id: i, fill: KIT_CLUBS.journey.deep, shadow: KIT_CLUBS.journey.ink, opacity: 0.9 }));

// ── Lightning ──
// A zig-zag bolt in a 40 x 80 box, sun yellow with a hard hot-deep shadow.
const BOLT_PATH = 'M25 0 L7 44 H19 L12 80 L36 30 H24 L31 0 Z';
/**
 * The two bolts, on STORM_CLOUDS 1 and 2. One 12 s loop each (index.css
 * pjWxBolt: two 0.18 s flashes 0.3 s apart, then dark), the second half a
 * loop behind the first, so at most two flashes fall in any second. `still`
 * says which one the still frame shows.
 */
export const BOLTS = [
  { cloud: 1, left: 42, delay: 0, still: true },
  { cloud: 2, left: 30, delay: -6, still: false },
];
export const BOLT_LOOP_SECS = 12;

// ── Rain ──
/**
 * A falling piece: `x`/`y` its still-frame place (% of the wall), `secs` one
 * fall from just above the top edge to just below the bottom, started where
 * the still frame has it.
 */
const fall = (x, y, secs) => ({ x, y, secs, delay: -((y + 8) / 112) * secs });

const RAIN_TINTS = [KIT_CLUBS.puggles.primary, HOUSE.sky, KIT_CLUBS.puggles.tint];
const RAIN_AT = scatter(46, 461);
export const RAINDROPS = RAIN_AT.map((at, i) => ({
  id: i,
  ...fall(1 + at.x * 98, 2 + at.y * 90, 2.4 + (i % 5) * 0.25),
  color: RAIN_TINTS[i % RAIN_TINTS.length],
  opacity: 0.5 + (i % 4) * 0.1,
  long: i % 3 === 0,
}));

/** Little crowns where the rain lands, along the bottom edge. */
const SPLASH_AT = scatter(10, 103);
export const SPLASHES = SPLASH_AT.map((at, i) => ({
  id: i,
  x: 3 + at.x * 92,
  bottom: 1.2 + at.y * 4,
  secs: 2.8 + (i % 4) * 0.3,
  delay: -((i * 0.73) % 3),
  // Half of them stand in the still frame; the rest only ever flicker up.
  still: i % 2 === 0,
}));

// ── Snow ──
// Three sizes: a dot, a six-armed star, a branched flake with a hard shadow.
const SNOW_AT = scatter(36, 367);
export const SNOWFLAKES = SNOW_AT.map((at, i) => {
  const size = ['small', 'medium', 'large'][i % 3];
  return {
    id: i,
    size,
    ...fall(1 + at.x * 98, 2 + at.y * 90, size === 'large' ? 22 : size === 'medium' ? 18 : 14 + (i % 4)),
    sway: 1.2 + (i % 4) * 0.5,
    swaySecs: 3.6 + (i % 5) * 0.6,
    turn: size === 'large' ? 24 : size === 'medium' ? 14 : 0,
    color: i % 4 === 1 ? HOUSE.cloud : '#FFFFFF',
    opacity: size === 'small' ? 0.65 : 0.85,
  };
});
const FLAKE_U = { small: 0.7, medium: 1.6, large: 2.6 };

// ── Fog ──
/**
 * Ground bands (a wavy top edge, filled to the floor, full width) and
 * floating wavy stripes (`x`/`w` in % of the wall, `h` in projector units):
 * the fog sign everyone knows, slid sideways at different speeds (`shift` vw
 * there and back over `secs`).
 */
export const FOG_BANDS = [
  { id: 'g1', kind: 'ground', y: 77, h: 25, opacity: 0.16, color: HOUSE.sky, shift: -9, secs: 52 },
  { id: 'g2', kind: 'ground', y: 86, h: 16, opacity: 0.22, color: HOUSE.cloud, shift: 7, secs: 44 },
  { id: 'g3', kind: 'ground', y: 93.5, h: 8, opacity: 0.26, color: KIT_CLUBS.cubbies.tint, shift: -6, secs: 38 },
  { id: 's1', kind: 'stripe', x: 17, w: 34, y: 9, h: 3, opacity: 0.26, color: HOUSE.cloud, shift: 8, secs: 64 },
  { id: 's2', kind: 'stripe', x: 55, w: 34, y: 15, h: 2.6, opacity: 0.2, color: HOUSE.sky, shift: -10, secs: 72 },
  { id: 's3', kind: 'stripe', x: 22, w: 26, y: 20, h: 2.2, opacity: 0.16, color: HOUSE.sky, shift: 9, secs: 58 },
  { id: 's4', kind: 'stripe', x: 60, w: 32, y: 71, h: 2.6, opacity: 0.2, color: HOUSE.cloud, shift: -7, secs: 66 },
];
// Flat waves in boxes stretched to the band: nothing soft.
const groundPath = (waves) => {
  let d = 'M0 22';
  for (let k = 0; k < waves; k += 1) d += ` Q${k * 100 + 50} ${k % 2 ? 0 : 8} ${(k + 1) * 100} 22`;
  return `${d} V100 H0 Z`;
};
/** A wavy centre line, `waves` humps long, in a (waves x 100 + 40) x 100 box. */
const stripePath = (waves) => {
  let d = 'M20 50';
  for (let k = 0; k < waves; k += 1) d += ` Q${k * 100 + 70} ${k % 2 ? 80 : 20} ${k * 100 + 120} 50`;
  return d;
};
const GROUND_WAVES = 14;
const GROUND_PATH = groundPath(GROUND_WAVES);

// ── Starfield (evening sky) ──
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  left: `${(i * 13.7 + 5) % 100}%`,
  top: `${(i * 17.3 + 3) % 100}%`,
  size: `${1 + (i % 4) * 0.6}px`,
  minOpacity: 0.12 + (i % 5) * 0.04,
  maxOpacity: 0.4 + (i % 4) * 0.15,
  duration: `${3 + (i % 7) * 0.8}s`,
  delay: `${-((i * 0.7) % 6)}s`,
}));

/** Flat streaks, rarely: one pass every 17-23 s each, invisible between (and in the still frame). */
const SHOOTING_STARS = [
  { id: 0, x: 18, y: 8, secs: 19, delay: -4 },
  { id: 1, x: 58, y: 14, secs: 23, delay: -15 },
];

// ── Seasonal elements ──
// Derived from the shared skin table (src/lib/skins.js, on the presentation
// import allowlist) rather than a second month table of its own. The two used
// to disagree — November was 'harvest' on the signage side and 'winter' here —
// so the same evening could be autumn on one screen and winter on the other.
//
// The ambient layer only needs a coarse bucket (which particles to drop), so
// the fine-grained skins collapse onto four.
const SKIN_SEASONS = {
  spring: 'spring',
  easter: 'spring',
  summer: 'summer',
  vbs: 'summer',
  autumn: 'autumn',
  harvest: 'autumn',
  thanksgiving: 'autumn',
  backtoschool: 'autumn',
  christmas: 'winter',
  snowday: 'winter',
};

export function getSeason(date = new Date()) {
  return SKIN_SEASONS[autoSkin(date)] ?? 'winter';
}

const LEAF_TINTS = [HOUSE.hot, HOUSE.orange, HOUSE.sun, KIT_CLUBS.sparks.primary, HOUSE.orangeDeep];
export const LEAVES = scatter(12, 127).map((at, i) => ({
  id: i,
  ...fall(3 + at.x * 94, 4 + at.y * 86, 16 + (i % 5) * 2),
  color: LEAF_TINTS[i % LEAF_TINTS.length],
  sizeU: 1.4 + (i % 3) * 0.5,
  sway: 1.6 + (i % 3) * 0.6,
  swaySecs: 3.2 + (i % 4) * 0.7,
  turn: 35,
  tilt: (i * 47) % 360,
  opacity: 0.6 + (i % 3) * 0.1,
}));

const BLOSSOM_TINTS = [KIT_CLUBS.sparks.tint, '#FFFFFF', KIT_CLUBS.journey.tint];
export const BLOSSOMS = scatter(12, 131).map((at, i) => ({
  id: i,
  ...fall(3 + at.x * 94, 4 + at.y * 86, 18 + (i % 4) * 2),
  color: BLOSSOM_TINTS[i % BLOSSOM_TINTS.length],
  sizeU: 1.1 + (i % 3) * 0.4,
  sway: 1.4 + (i % 3) * 0.5,
  swaySecs: 3.6 + (i % 4) * 0.6,
  turn: 30,
  tilt: (i * 31) % 72,
  opacity: 0.55 + (i % 3) * 0.1,
}));

export const FIREFLIES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  x: (i * 10.3 + 5) % 95,
  y: (i * 9.7 + 10) % 80,
  color: i % 3 === 0 ? KIT_CLUBS.tnt.tint : HOUSE.sun,
  glowSecs: 4 + (i % 4) * 1.2,
  wanderSecs: 9 + (i % 5) * 2,
  dx: (i % 2 ? -1 : 1) * (1.5 + (i % 3)),
  dy: (i % 3 ? -1 : 1) * (1 + (i % 4) * 0.6),
  delay: -((i * 1.3) % 8),
}));

// ── Shapes ──

/** A flat cartoon cloud with its hard offset shadow, inside a 120 x 60 box. */
const CloudShape = ({ fill, shadow, opacity }) => (
  <svg viewBox="0 0 120 60" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
    <g opacity={opacity}>
      <path d={CLOUD_PATH} fill={shadow} transform={`translate(${CLOUD_SHADOW.dx} ${CLOUD_SHADOW.dy})`} />
      <path d={CLOUD_PATH} fill={fill} />
    </g>
  </svg>
);

const BoltShape = () => (
  <svg viewBox="0 0 40 80" aria-hidden="true" focusable="false">
    <path d={BOLT_PATH} fill={HOUSE.hotDeep} transform="translate(3 3)" />
    <path d={BOLT_PATH} fill={HOUSE.sun} />
  </svg>
);

/** A flat puddle with a crown of drops jumping out of it. */
const SplashShape = ({ color }) => (
  <svg viewBox="0 0 24 12" aria-hidden="true" focusable="false">
    <ellipse cx="12" cy="10.6" rx="10" ry="1.4" fill={color} opacity="0.55" />
    <path d="M6 8.5 L3.5 5 M18 8.5 L20.5 5" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    <circle cx="9.5" cy="3.4" r="1.5" fill={color} />
    <circle cx="14.5" cy="2.4" r="1.5" fill={color} />
  </svg>
);

/** Six arms (medium) or six branched arms (large); a dot for the small flake. */
const FlakeShape = ({ size, color }) => {
  if (size === 'small') {
    return (
      <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false">
        <circle cx="5" cy="5" r="5" fill={color} />
      </svg>
    );
  }
  const arms = [0, 60, 120];
  const branches = size === 'large'
    ? [0, 60, 120, 180, 240, 300].map((a) => (
      <path key={a} d="M12 5.5 L9.2 3.2 M12 5.5 L14.8 3.2" transform={`rotate(${a} 12 12)`} />
    ))
    : null;
  const flake = (
    <>
      {arms.map((a) => <path key={a} d="M12 1.5 V22.5" transform={`rotate(${a} 12 12)`} />)}
      {branches}
    </>
  );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {size === 'large' && (
        <g stroke={HOUSE.blueDeep} strokeWidth="2.6" strokeLinecap="round" fill="none" transform="translate(1.4 1.6)">{flake}</g>
      )}
      <g stroke={color} strokeWidth={size === 'large' ? 2.6 : 2.8} strokeLinecap="round" fill="none">{flake}</g>
    </svg>
  );
};

const LeafShape = ({ color }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 1.5 C19 6 20.5 13 12 22.5 C3.5 13 5 6 12 1.5 Z" fill={color} />
    <path d="M12 5 V21" stroke={shade(color, 0.6)} strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const BlossomShape = ({ color }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {[0, 72, 144, 216, 288].map((a) => (
      <circle key={a} cx="12" cy="6.2" r="5" fill={color} transform={`rotate(${a} 12 12)`} />
    ))}
    <circle cx="12" cy="12" r="3.4" fill={HOUSE.sun} />
  </svg>
);

/** The kit's four-point sparkle: a firefly, flat, lit by opacity alone. */
const SparkleShape = ({ color }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M12 0C13.1 6.9 17.1 10.9 24 12C17.1 13.1 13.1 17.1 12 24C10.9 17.1 6.9 13.1 0 12C6.9 10.9 10.9 6.9 12 0Z" fill={color} />
  </svg>
);

/** The chip's small glyph: the same flat drawing, in the plate's colours. */
const ChipGlyph = ({ type, isDay }) => {
  switch (type) {
    case 'clear':
      return isDay ? (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g stroke={HOUSE.sun} strokeWidth="2.4" strokeLinecap="round">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path key={a} d="M12 1.5 V4.5" transform={`rotate(${a} 12 12)`} />)}
          </g>
          <circle cx="12" cy="12" r="5.2" fill={HOUSE.sun} />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M15.5 2.5 A9.5 9.5 0 1 0 21.5 17 A8 8 0 0 1 15.5 2.5 Z" fill={HOUSE.cream} />
        </svg>
      );
    case 'cloudy':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={CLOUD_PATH} fill={HOUSE.cloud} transform="translate(0 4) scale(0.2)" />
        </svg>
      );
    case 'fog':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g stroke={HOUSE.cloud} strokeWidth="2.6" strokeLinecap="round" fill="none">
            <path d="M3 7 Q7.5 4 12 7 T21 7" />
            <path d="M3 12.5 Q7.5 9.5 12 12.5 T21 12.5" />
            <path d="M3 18 Q7.5 15 12 18 T21 18" />
          </g>
        </svg>
      );
    case 'rain':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={CLOUD_PATH} fill={HOUSE.cloud} transform="translate(0 -1) scale(0.2)" />
          <g stroke={KIT_CLUBS.puggles.tint} strokeWidth="2.2" strokeLinecap="round">
            <path d="M7 15 L5.5 20" /><path d="M12.5 15 L11 20" /><path d="M18 15 L16.5 20" />
          </g>
        </svg>
      );
    case 'snow':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <g stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round">
            {[0, 60, 120].map((a) => <path key={a} d="M12 2 V22" transform={`rotate(${a} 12 12)`} />)}
          </g>
        </svg>
      );
    case 'thunder':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d={BOLT_PATH} fill={HOUSE.sun} transform="translate(6.5 1) scale(0.275)" />
        </svg>
      );
    default:
      return null;
  }
};

/**
 * The weather, said in words: a small flat pill in the label voice (Londrina)
 * on the house's deep blue with a hard offset shadow, top-right of the wall,
 * level with the Awana mark (index.css `.pj-wx-chip`; on a phone or tablet it
 * stands left of the menu button). Nothing when the weather is unknown.
 */
export const WeatherChip = ({ reading }) => {
  const label = weatherLabel(reading);
  if (!label) return null;
  return (
    <div className="pj-wx-chip" data-weather-chip={reading.type} role="img" aria-label={`Weather outside: ${label}`}>
      <ChipGlyph type={reading.type} isDay={reading.isDay !== false} />
      <span>{label}</span>
    </div>
  );
};

// ── The scene ──

/** A size in the scene's unit (`--wx-u`: the projector unit, bigger upright on a phone). */
const u = (n) => `calc(${n} * var(--wx-u))`;

const Cloud = ({ cloud, children }) => (
  <div
    className="pj-wx-cloud"
    data-wx="cloud"
    style={{
      '--wx-x': `${cloud.x}vw`,
      '--wx-y': `${cloud.y}vh`,
      '--wx-w': u(cloud.w),
      '--wx-dur': `${cloud.secs}s`,
      '--wx-delay': `${cloud.delay.toFixed(2)}s`,
    }}
  >
    <CloudShape fill={cloud.fill} shadow={cloud.shadow} opacity={cloud.opacity} />
    {children}
  </div>
);

/** A piece that falls the height of the wall (rain, snow, leaves, blossoms). */
const Faller = ({ piece, slant = 0, kind, children }) => (
  <div
    className="pj-wx-fall"
    data-wx={kind}
    style={{
      '--wx-x': `${piece.x.toFixed(2)}vw`,
      '--wx-y': `${piece.y.toFixed(2)}vh`,
      '--wx-slant': slant,
      '--wx-dur': `${piece.secs}s`,
      '--wx-delay': `${piece.delay.toFixed(2)}s`,
    }}
  >
    {children}
  </div>
);

/** Sways side to side (and turns) while its Faller sinks. */
const Sway = ({ piece, sizeU, tilt = 0, children }) => (
  <div
    className="pj-wx-sway"
    style={{
      width: u(sizeU),
      height: u(sizeU),
      opacity: piece.opacity,
      '--wx-sway': u(piece.sway),
      '--wx-turn': `${piece.turn}deg`,
      '--wx-dur': `${piece.swaySecs}s`,
      '--wx-delay': `${(-piece.swaySecs / 2).toFixed(2)}s`,
      '--wx-tilt': `${tilt}deg`,
    }}
  >
    {children}
  </div>
);

const RainLayer = ({ drops }) => (
  <div className="pj-wx__layer" data-wx-layer="rain">
    {drops.map((drop) => (
      <Faller key={drop.id} piece={drop} slant={0.25} kind="drop">
        <div
          className="pj-wx-drop"
          style={{ background: drop.color, opacity: drop.opacity, height: u(drop.long ? 4.2 : 3) }}
        />
      </Faller>
    ))}
    {SPLASHES.map((s) => (
      <div
        key={s.id}
        className="pj-wx-splash"
        data-wx="splash"
        style={{ left: `${s.x.toFixed(2)}%`, bottom: `${s.bottom.toFixed(2)}%`, opacity: s.still ? 0.75 : 0, '--wx-dur': `${s.secs}s`, '--wx-delay': `${s.delay.toFixed(2)}s` }}
      >
        <SplashShape color={KIT_CLUBS.puggles.tint} />
      </div>
    ))}
  </div>
);

/**
 * @param {{ reading?: { type: string, temp?: number, isDay?: boolean } | null, still?: boolean }} props
 *   `reading` from useWeatherReading (null = unknown: the plain starfield, no
 *   chip); `still` shows the finished still frame with no motion at all (as
 *   the OS reduced-motion setting does by itself).
 */
export const WeatherScene = ({ reading = null, still = false }) => {
  const switchedOff = useLowPowerSwitch();
  const reducedMotion = useReducedMotion();
  // Computed per render (not at module load) so a projector left
  // running for months rolls into the new season's effects.
  const season = getSeason();
  if (switchedOff) return null;
  const frozen = still || reducedMotion;
  const weather = reading?.type ?? 'clear';
  const stormy = weather === 'thunder';
  return (
    <div className={`pj-wx${frozen ? ' pj-wx--still' : ''}`} data-weather={weather} data-season={season}>
      <div className="pj-wx__layer" aria-hidden="true">

        {/* ── Starfield (always there, dimmed under heavy weather) ── */}
        <div
          className="pj-wx__layer pj-wx__stars"
          data-wx-layer="stars"
          style={{
            opacity: weather === 'rain' || stormy ? 0.15
              : weather === 'fog' || weather === 'cloudy' ? 0.3
                : weather === 'snow' ? 0.4 : 1,
          }}
        >
          {STARS.map((star) => (
            <div
              key={star.id}
              className="pj-wx-star"
              style={{
                left: star.left,
                top: star.top,
                width: star.size,
                height: star.size,
                '--star-min': star.minOpacity,
                '--star-max': star.maxOpacity,
                '--wx-dur': star.duration,
                '--wx-delay': star.delay,
              }}
            />
          ))}
          {weather === 'clear' && SHOOTING_STARS.map((s) => (
            <div
              key={s.id}
              className="pj-wx-shoot"
              data-wx="shooting-star"
              style={{ left: `${s.x}%`, top: `${s.y}%`, '--wx-dur': `${s.secs}s`, '--wx-delay': `${s.delay}s` }}
            />
          ))}
        </div>

        {/* ── Fog: flat wavy stripes and ground bands ── */}
        {weather === 'fog' && (
          <div className="pj-wx__layer" data-wx-layer="fog">
            {FOG_BANDS.map((band) => {
              const ground = band.kind === 'ground';
              const waves = ground ? GROUND_WAVES : Math.max(2, Math.round(band.w / 7));
              return (
                <div
                  key={band.id}
                  className={`pj-wx-band${ground ? ' pj-wx-band--ground' : ''}`}
                  data-wx={ground ? 'fog-band' : 'fog-stripe'}
                  style={{
                    top: `${band.y}%`,
                    ...(ground ? { height: `${band.h}%` } : { left: `${band.x}%`, width: `${band.w}%`, height: u(band.h) }),
                    opacity: band.opacity,
                    '--wx-shift': `${band.shift}vw`,
                    '--wx-dur': `${band.secs}s`,
                  }}
                >
                  <svg viewBox={`0 0 ${waves * 100 + (ground ? 0 : 40)} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
                    {ground
                      ? <path d={GROUND_PATH} fill={band.color} />
                      : (
                        <path
                          d={stripePath(waves)}
                          fill="none"
                          stroke={band.color}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeWidth: u(band.h * 0.45) }}
                        />
                      )}
                  </svg>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Cloudy: flat cartoon clouds drifting across ── */}
        {weather === 'cloudy' && (
          <div className="pj-wx__layer" data-wx-layer="clouds">
            {CLOUDS.map((cloud) => <Cloud key={cloud.id} cloud={cloud} />)}
          </div>
        )}

        {/* ── Rain ── */}
        {weather === 'rain' && <RainLayer drops={RAINDROPS} />}

        {/* ── Thunder: dark clouds, lighter rain, a bolt now and then ── */}
        {stormy && (
          <>
            <RainLayer drops={RAINDROPS.filter((d) => d.id % 3 !== 2)} />
            <div className="pj-wx__layer" data-wx-layer="storm">
              {STORM_CLOUDS.map((cloud) => (
                <Cloud key={cloud.id} cloud={cloud}>
                  {BOLTS.filter((b) => b.cloud === cloud.id).map((b) => (
                    <div
                      key={b.cloud}
                      className="pj-wx-bolt"
                      data-wx="bolt"
                      style={{
                        left: `${b.left}%`,
                        '--wx-o0': b.still ? 1 : 0,
                        '--wx-dur': `${BOLT_LOOP_SECS}s`,
                        '--wx-delay': `${b.delay}s`,
                      }}
                    >
                      <BoltShape />
                    </div>
                  ))}
                </Cloud>
              ))}
            </div>
          </>
        )}

        {/* ── Snow: flat flakes in three sizes ── */}
        {weather === 'snow' && (
          <div className="pj-wx__layer" data-wx-layer="snow">
            {SNOWFLAKES.map((flake) => (
              <Faller key={flake.id} piece={flake} kind={`flake-${flake.size}`}>
                <Sway piece={flake} sizeU={FLAKE_U[flake.size]}>
                  <FlakeShape size={flake.size} color={flake.color} />
                </Sway>
              </Faller>
            ))}
          </div>
        )}

        {/* ── The season, in the same flat language ── */}
        {season === 'autumn' && (
          <div className="pj-wx__layer" data-wx-layer="leaves">
            {LEAVES.map((leaf) => (
              <Faller key={leaf.id} piece={leaf} kind="leaf">
                <Sway piece={leaf} sizeU={leaf.sizeU} tilt={leaf.tilt}>
                  <LeafShape color={leaf.color} />
                </Sway>
              </Faller>
            ))}
          </div>
        )}

        {season === 'spring' && (
          <div className="pj-wx__layer" data-wx-layer="blossoms">
            {BLOSSOMS.map((b) => (
              <Faller key={b.id} piece={b} kind="blossom">
                <Sway piece={b} sizeU={b.sizeU} tilt={b.tilt}>
                  <BlossomShape color={b.color} />
                </Sway>
              </Faller>
            ))}
          </div>
        )}

        {season === 'summer' && (
          <div className="pj-wx__layer" data-wx-layer="fireflies">
            {FIREFLIES.map((fly) => (
              <div
                key={fly.id}
                className="pj-wx-fly"
                data-wx="firefly"
                style={{
                  left: `${fly.x}%`,
                  top: `${fly.y}%`,
                  '--wx-dur': `${fly.glowSecs}s`,
                  '--wx-wander': `${fly.wanderSecs}s`,
                  '--wx-dx': u(fly.dx),
                  '--wx-dy': u(fly.dy),
                  '--wx-delay': `${fly.delay.toFixed(2)}s`,
                }}
              >
                <SparkleShape color={fly.color} />
              </div>
            ))}
          </div>
        )}

        {/* Winter adds nothing of its own: the starfield and the weather carry it. */}
      </div>

      <WeatherChip reading={reading} />
    </div>
  );
};
