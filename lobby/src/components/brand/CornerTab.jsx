import { M } from '../../lib/motion.jsx';
import { SHAPES } from '../../lib/brand.js';

/**
 * The catalog's corner tab: a wavy blob bleeding off the top-left corner
 * (p.64 "STUDENT RESOURCES") whose color names the section. Whatever it
 * wraps (a label, the Awana Clubs mark, a club mark) sits in its fat end.
 * Size it with CSS; it is an M.div, so it animates (and freezes under
 * ?lowPower=1) like any other M element.
 *
 * @param {{ color: string, className?: string, style?: Record<string, any>, children?: import('react').ReactNode } & Record<string, any>} props
 */
export default function CornerTab({ color, className = '', style, children, ...motionProps }) {
  return (
    <M.div className={`brand-tab ${className}`.trim()} style={{ ...style, '--tab-color': color }} {...motionProps}>
      <svg viewBox={SHAPES.tab.viewBox} preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d={SHAPES.tab.d} fill="var(--tab-color)" />
      </svg>
      <div className="brand-tab__content">{children}</div>
    </M.div>
  );
}
