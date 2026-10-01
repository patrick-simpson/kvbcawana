import { M } from '../../lib/motion.jsx';
import { DOODLES, EASE, DUR, beats } from '../../lib/brand.js';

/** @typedef {import('../../lib/brand.js').DoodleKind} DoodleKind */

/**
 * The catalog's doodles, the way the catalog uses them: in small clusters
 * of three (a sparkle, a dot, a second sparkle, say), tinted from the
 * section's color or white, never a dense field. Each doodle pops in on a
 * beat after the one before it; `twinkle` adds a slow breathing loop whose
 * last keyframe is its resting size, so the ?lowPower=1 freeze shows every
 * doodle whole.
 *
 * Positions and sizes are CSS lengths relative to the cluster's box.
 *
 * @param {{
 *   items: Array<{ kind: DoodleKind, x: string, y: string, size: string, rotate?: number }>,
 *   color?: string,
 *   delay?: number,
 *   twinkle?: boolean,
 *   className?: string,
 * }} props
 */
export default function DoodleCluster({ items, color = '#fff', delay = 0, twinkle = false, className = '' }) {
  return (
    <div className={`brand-doodles ${className}`.trim()} aria-hidden="true">
      {items.map((it, i) => {
        const shape = DOODLES[it.kind];
        if (!shape) return null;
        const [, , vw, vh] = shape.viewBox.split(/\s+/).map(Number);
        const rest = { opacity: 1, scale: 1, rotate: it.rotate ?? 0 };
        const glyph = (
          <svg viewBox={shape.viewBox} focusable="false">
            {shape.stroked
              ? <path d={shape.d} fill="none" stroke="currentColor" strokeWidth={it.kind === 'loop' ? 2.2 : 1.6} strokeLinecap="round" />
              : <path d={shape.d} fill="currentColor" />}
          </svg>
        );
        return (
          <M.span
            key={`${it.kind}-${i}`}
            className="brand-doodle"
            style={{ left: it.x, top: it.y, width: it.size, aspectRatio: `${vw} / ${vh}`, color }}
            initial={{ opacity: 0, scale: 0, rotate: (it.rotate ?? 0) - 45 }}
            animate={rest}
            transition={{ duration: DUR.pop, delay: delay + beats(i), ease: EASE.pop }}
          >
            {twinkle ? (
              // The breathing loop lives on its own element so it never
              // replays the pop-in; it ends every cycle at full size, which
              // is also where ?lowPower=1 freezes it.
              <M.span
                className="brand-doodle__twinkle"
                animate={{ scale: [1, 0.72, 1], rotate: [0, 18, 0] }}
                transition={{ duration: 3.6, delay: delay + beats(i) + DUR.pop, ease: 'easeInOut', repeat: Infinity }}
              >
                {glyph}
              </M.span>
            ) : glyph}
          </M.span>
        );
      })}
    </div>
  );
}
