import { M } from '../../lib/motion.jsx';
import { SHAPES } from '../../lib/brand.js';

/**
 * The catalog's club wave: the S-curved color field that rises from the
 * bottom of every club opener page (p.63) and carries the club's name. It
 * stretches to whatever box it is given (preserveAspectRatio="none"), so
 * size and position it with CSS; `flip` mirrors it so two layers can cross.
 *
 * It is an M.div, so callers animate it with ordinary framer-motion props
 * (initial / animate / exit / transition) and it still freezes under
 * ?lowPower=1. Keep the LAST keyframe the resting position: that is the
 * frame the Pi Zero embed shows.
 *
 * @param {{ color: string, flip?: boolean, className?: string } & Record<string, any>} props
 */
export default function Wave({ color, flip = false, className = '', ...motionProps }) {
  return (
    <M.div className={`brand-wave ${className}`.trim()} aria-hidden="true" {...motionProps}>
      <svg
        viewBox={SHAPES.wave.viewBox}
        preserveAspectRatio="none"
        style={flip ? { transform: 'scaleX(-1)' } : undefined}
        focusable="false"
      >
        <path d={SHAPES.wave.d} fill={color} />
      </svg>
    </M.div>
  );
}
