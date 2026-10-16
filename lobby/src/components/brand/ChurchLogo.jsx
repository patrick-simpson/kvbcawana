import { useState } from 'react';
import { M } from '../../lib/motion.jsx';
import { EASE } from '../../lib/brand.js';
import { holdThenLand } from '../../lib/lobbyMotion.js';
import { ARRIVAL, squishLand, withSquish } from '../../lib/squish.js';
import { LOGO_ARRIVAL, parseChurchLogo } from '../../../../shared/churchLogo.js';
import fullSvg from '../../../../shared/brand/logos/kvbc-awana-full.svg?raw';
import twoLineSvg from '../../../../shared/brand/logos/kvbc-awana-two-line.svg?raw';
import stackedSvg from '../../../../shared/brand/logos/kvbc-awana-stacked.svg?raw';

const LOGOS = {
  full: parseChurchLogo(fullSvg),
  'two-line': parseChurchLogo(twoLineSvg),
  stacked: parseChurchLogo(stackedSvg),
};

/** How one line lands: up from just below its place, onto its foot. */
export function lineArrival(part, hold = 0) {
  const beat = LOGO_ARRIVAL[part];
  const at = hold + beat.at;
  return withSquish(
    holdThenLand(at, beat.dur, { opacity: 0, y: '45%' }, { opacity: 1, y: '0%' }, EASE.settle),
    squishLand(at, 'kicker', beat.dur, ARRIVAL),
  );
}

/**
 * The church's own logo (owner 2026-10-13), drawn inline from the kit's file
 * in ONE colour, `currentColor`: the caller's CSS picks white (a coloured or
 * dark field) or ink (a light one). Never two colours, an outline, a shadow
 * or a stretch (shared/churchLogo.js has the rules and the smallest sizes).
 *
 * `arrive` lets it land ONCE, line by line (the church line, then Awana
 * Clubs, then the tagline), each settling onto its foot with the kicker's
 * whisper of a squish, `hold` seconds after it mounts. The beats are fixed at
 * mount, so no re-render ever replays them, and every line's last keyframe is
 * its place, so under zero animation (?lowPower=1) it is simply there. After
 * that it never moves. Without `arrive` (the check-in moment, the panels, a
 * still thumbnail) it is just drawn.
 *
 * @param {{ variant?: 'full' | 'two-line' | 'stacked', arrive?: boolean, hold?: number, className?: string, decorative?: boolean }} props
 */
export default function ChurchLogo({ variant = 'two-line', arrive = false, hold = 0, className = '', decorative = false }) {
  const logo = LOGOS[variant] || LOGOS['two-line'];
  // Fixed when the logo first appears: a later render never re-targets a line.
  const [beats] = useState(() => (arrive ? Object.fromEntries(logo.parts.map((p) => [p.part, lineArrival(p.part, hold)])) : null));
  const a11y = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': logo.label };
  return (
    <svg
      className={`church-logo church-logo--${variant} ${className}`.trim()}
      viewBox={logo.viewBox}
      focusable="false"
      data-arrive={beats ? 'once' : 'no'}
      {...a11y}
    >
      <g fill="currentColor" fillRule="evenodd">
        {logo.parts.map((p) => (beats
          ? <M.path key={p.part} className={`kvbc-${p.part}`} d={p.d} style={{ originX: 0.5, originY: 1 }} {...beats[p.part]} />
          : <path key={p.part} className={`kvbc-${p.part}`} d={p.d} />))}
      </g>
    </svg>
  );
}
