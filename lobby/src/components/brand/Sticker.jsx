import { M } from '../../lib/motion.jsx';
import { SHAPES } from '../../lib/brand.js';

/**
 * The catalog's one hot sticker: a starburst ("MORE APPAREL", p.18) or a
 * plain disc ("NEW!", p.11) in the hot red-orange, set slightly askew and
 * always overlapping the edge of whatever it tags. It marks what is new or
 * special: a first-timer, a birthday.
 *
 * @param {{
 *   kind?: 'starburst' | 'disc',
 *   color?: string,
 *   tilt?: number,
 *   className?: string,
 *   children?: import('react').ReactNode,
 * } & Record<string, any>} props
 */
export default function Sticker({ kind = 'starburst', color = 'var(--brand-hot)', tilt = -8, className = '', children, ...motionProps }) {
  return (
    <M.div className={`brand-sticker brand-sticker--${kind} ${className}`.trim()} {...motionProps}>
      <svg viewBox={kind === 'disc' ? '0 0 100 100' : SHAPES.starburst.viewBox} aria-hidden="true" focusable="false">
        {kind === 'disc'
          ? <circle cx="50" cy="50" r="49" fill={color} />
          : <path d={SHAPES.starburst.d} fill={color} />}
      </svg>
      <div className="brand-sticker__text" style={{ transform: `rotate(${tilt}deg)` }}>{children}</div>
    </M.div>
  );
}
