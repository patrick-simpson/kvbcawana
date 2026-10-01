import { useId } from 'react';
import { M } from '../lib/motion.jsx';
import { DOODLES } from '../lib/brand.js';

/**
 * The weather chip's sky doodle (stage 4a's "CLOUDY / 58°" chip dropped the
 * old animated glyph; this restores it in the kit): a small flat white
 * glyph for the weather type, riding the chip's value block. Drawn the way
 * the kit's doodles are drawn (flat white, round caps, a hand-set cloud),
 * and built from the kit's own pieces where one fits: the dot for the sun's
 * disc and the snow, the four-point sparkle for the moon's star.
 *
 * `kind` is weatherPresentation's icon (src/lib/weather.js): sun, partly,
 * cloud, fog, rain, snow, storm, or moon (a clear or partly cloudy night).
 *
 * Each glyph breathes with one gentle ambient loop (rays turning, a cloud
 * drifting, drops falling, a bolt flickering), transform and opacity only,
 * and every loop's LAST keyframe is the finished glyph, so ?lowPower=1
 * freezes on a whole sky. The chip's value stays frozen at each slide load
 * (the owner's rule); only the doodle moves.
 */

/** A puffy cloud on the 24-unit grid, flat bottom, drawn once. */
const CLOUD = 'M6.6,19C4.1,19 2.3,17.2 2.3,15C2.3,12.9 3.9,11.2 6,11.1C6.5,8 9,5.8 12.2,5.8C14.8,5.8 17,7.4 17.8,9.8C20.2,10 22,12 22,14.4C22,16.9 20,19 17.5,19Z';
const BOLT = 'M13.4,13.6L9.6,19.2H12.4L10.9,23.4L16.3,16.7H13.4L15,13.6Z';
const MOON = 'M15.2,3.4A8.9,8.9 0 1 0 20.8,18.2A7.2,7.2 0 0 1 15.2,3.4Z';

const LOOP = { repeat: Infinity, ease: 'easeInOut' };

// Every looping group starts from an `initial` holding its transform keys
// at their first keyframe. That is not decoration: framer-motion measures an
// SVG element's box (which it needs to place any transform on it) only at
// mount, and only if the element's first values already carry a transform;
// without one it throws every rotate / x / y frame away and only the opacity
// moves. Under zero animation M replaces `initial` with false, so ?lowPower=1
// still jumps straight to each loop's LAST keyframe, the finished glyph.
//
// The rays' group is symmetric about the disc, so framer-motion's default
// SVG origin (the centre of the group's own box) is the disc's centre, and
// its last keyframe (45 degrees, one ray on) is the same drawing as its first.

/** Place a kit doodle (its own viewBox) centred on (cx, cy), `w` units wide. */
function Kit({ shape, cx, cy, w }) {
  const [x0, y0, vw, vh] = shape.viewBox.split(/\s+/).map(Number);
  const s = w / vw;
  const h = vh * s;
  return (
    <path
      d={shape.d}
      fill="currentColor"
      transform={`translate(${(cx - w / 2 - x0 * s).toFixed(3)} ${(cy - h / 2 - y0 * s).toFixed(3)}) scale(${s.toFixed(4)})`}
    />
  );
}

function Rays({ cx, cy, inner, outer, width = 1.8, spin = 18 }) {
  return (
    <M.g
      data-loop="rays"
      initial={{ rotate: 0 }}
      animate={{ rotate: [0, 45] }}
      transition={{ duration: spin, repeat: Infinity, ease: 'linear' }}
    >
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        const x1 = cx + Math.cos(a) * inner;
        const y1 = cy + Math.sin(a) * inner;
        const x2 = cx + Math.cos(a) * outer;
        const y2 = cy + Math.sin(a) * outer;
        return (
          <path
            key={i}
            d={`M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`}
            stroke="currentColor"
            strokeWidth={width}
            strokeLinecap="round"
            fill="none"
          />
        );
      })}
    </M.g>
  );
}

function Drift({ children, x = 0.9, duration = 6, delay = 0 }) {
  return (
    <M.g data-loop="drift" initial={{ x: 0 }} animate={{ x: [0, x, 0] }} transition={{ duration, delay, ...LOOP }}>
      {children}
    </M.g>
  );
}

/** Something falling out of the cloud: drops away and fades, then drops back in from above to rest. */
function Fall({ children, delay, duration, depth }) {
  return (
    <M.g
      data-loop="fall"
      initial={{ y: 0, opacity: 1 }}
      animate={{ y: [0, depth, -depth * 0.5, 0], opacity: [1, 0, 0, 1] }}
      transition={{ duration, delay, times: [0, 0.55, 0.56, 1], repeat: Infinity, ease: 'easeIn' }}
    >
      {children}
    </M.g>
  );
}

function Sky({ kind, maskId }) {
  switch (kind) {
    case 'sun':
      return (
        <>
          <Rays cx={12} cy={12} inner={7} outer={10.2} />
          <Kit shape={DOODLES.dot} cx={12} cy={12} w={9.4} />
        </>
      );
    case 'moon':
      return (
        <>
          <path d={MOON} fill="currentColor" />
          <M.g
            data-loop="twinkle"
            initial={{ scale: 1, rotate: 0 }}
            animate={{ scale: [1, 0.55, 1], rotate: [0, 20, 0] }}
            transition={{ duration: 3.6, ...LOOP }}
          >
            <Kit shape={DOODLES.sparkle} cx={19.2} cy={5.2} w={6} />
          </M.g>
        </>
      );
    case 'partly':
      return (
        <>
          <defs>
            <mask id={maskId} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
              <rect x="-2" y="-2" width="28" height="28" fill="#fff" />
              <path d={CLOUD} transform="translate(4.2 3.6) scale(0.82)" fill="#000" stroke="#000" strokeWidth="3.2" strokeLinejoin="round" />
            </mask>
          </defs>
          <g mask={`url(#${maskId})`}>
            <Rays cx={8.6} cy={8.6} inner={5.2} outer={7.9} width={1.6} spin={22} />
            <Kit shape={DOODLES.dot} cx={8.6} cy={8.6} w={7} />
          </g>
          <Drift x={0.8} duration={7}>
            <path d={CLOUD} transform="translate(4.2 3.6) scale(0.82)" fill="currentColor" />
          </Drift>
        </>
      );
    case 'rain':
      return (
        <>
          <Drift x={0.6} duration={7}><path d={CLOUD} transform="translate(0 -3.4)" fill="currentColor" /></Drift>
          {[[8, 0], [12.4, 0.45], [16.8, 0.9]].map(([x, delay]) => (
            <Fall key={x} delay={delay} duration={1.5} depth={2.6}>
              <path d={`M${x},18.4L${x - 1.3},21.6`} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </Fall>
          ))}
        </>
      );
    case 'snow':
      return (
        <>
          <Drift x={0.6} duration={7}><path d={CLOUD} transform="translate(0 -3.4)" fill="currentColor" /></Drift>
          {[[7.6, 19.4, 0], [12.2, 21.2, 0.9], [16.8, 19.4, 1.8]].map(([x, y, delay]) => (
            <Fall key={x} delay={delay} duration={2.8} depth={2}>
              <Kit shape={DOODLES.dot} cx={x} cy={y} w={2.8} />
            </Fall>
          ))}
        </>
      );
    case 'storm':
      return (
        <>
          <Drift x={0.6} duration={6}><path d={CLOUD} transform="translate(0 -4.2)" fill="currentColor" /></Drift>
          <M.path
            d={BOLT}
            fill="currentColor"
            data-loop="flicker"
            initial={{ opacity: 1 }}
            animate={{ opacity: [1, 1, 0.2, 1, 0.45, 1] }}
            transition={{ duration: 4.6, times: [0, 0.7, 0.74, 0.79, 0.83, 1], repeat: Infinity, ease: 'linear' }}
          />
        </>
      );
    case 'fog':
      return (
        <>
          {[7, 12, 17].map((y, i) => (
            <Drift key={y} x={i % 2 ? -1.1 : 1.1} duration={5.5} delay={i * 0.4}>
              <path
                d={`M${3 + (i % 2) * 1.5},${y}q2.1,-2 4.2,0t4.2,0t4.2,0t4.2,0`}
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                fill="none"
              />
            </Drift>
          ))}
        </>
      );
    case 'cloud':
    default:
      return (
        <Drift>
          <path d={CLOUD} fill="currentColor" />
        </Drift>
      );
  }
}

/** The storm's bolt, exported so a test can find it in the drawing. */
export const WEATHER_BOLT = BOLT;

/** The glyph kinds this draws; anything else draws the plain cloud. */
export const WEATHER_GLYPHS = ['sun', 'moon', 'partly', 'cloud', 'fog', 'rain', 'snow', 'storm'];

/**
 * @param {{ kind: string, className?: string }} props
 */
export default function WeatherGlyph({ kind, className = '' }) {
  const maskId = `wx-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const k = WEATHER_GLYPHS.includes(kind) ? kind : 'cloud';
  return (
    <svg
      className={`weather-glyph weather-glyph--${k} ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-glyph={k}
    >
      <Sky kind={k} maskId={maskId} />
    </svg>
  );
}
