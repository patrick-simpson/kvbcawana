import { chipGeometry, inkEm, measureEm } from '../../lib/brand.js';
import { useFontsReady } from '../../hooks/useFontsReady.js';

const TEXT = {
  fill: '#fff',
  textAnchor: 'middle',
  dominantBaseline: 'central',
  lengthAdjust: 'spacingAndGlyphs',
  style: { fontFamily: 'var(--font-shout)' },
};

/**
 * The catalog's stepped chip (p.63 "GRADES / 9-12"): a small label on a
 * pill-shaped tier, a big value on a wider block that steps out beneath it,
 * a translucent charcoal plate printed slightly out of register with its
 * white keyline. On our screens it carries every label-over-value lockup:
 * "RIGHT NOW / 7:56", "TONIGHT / 23", "WED / SEP 30".
 *
 * The plate is built around its own text (chipGeometry), so a long value
 * widens the chip instead of spilling off it, and each text is pinned to
 * its measured width with textLength: a late-loading font can squeeze, but
 * never overflow. The value's ink is measured too, so a mark over or under
 * its capitals (JOSÉ, ȘTEFAN) keeps off the block's keyline. Scale the whole
 * chip with `size` (the value's font size).
 *
 * `icon` puts a small decorative glyph at the head of the value block (the
 * weather chip's sky doodle, src/components/WeatherGlyph.jsx), `iconEm`
 * wide: the block grows to make room, so the value never sits under it.
 * It is an HTML overlay on the chip's own em grid, so it can animate like
 * any M element; the chip's accessible name stays its label and value.
 *
 * @param {{
 *   label: string | number,
 *   value: string | number,
 *   size?: string,
 *   plate?: string,
 *   icon?: import('react').ReactNode,
 *   iconEm?: number,
 *   className?: string,
 *   style?: import('react').CSSProperties,
 * }} props
 */
export default function StepChip({ label, value, size = '1rem', plate, icon = null, iconEm = 1.15, className = '', style }) {
  useFontsReady();
  const l = String(label);
  const v = String(value);
  const g = chipGeometry(measureEm(l), measureEm(v), icon ? iconEm : 0, inkEm(v));
  const plateFill = plate ? { fill: plate } : { fill: '#030404', fillOpacity: 0.5 };
  return (
    <span
      className={`step-chip ${className}`.trim()}
      role="img"
      aria-label={`${l} ${v}`}
      style={{ fontSize: size, width: `${g.width.toFixed(3)}em`, height: `${g.height.toFixed(3)}em`, ...style }}
    >
      <svg viewBox={`-0.04 -0.04 ${g.width.toFixed(3)} ${g.height.toFixed(3)}`} aria-hidden="true" focusable="false">
        <path className="step-chip__plate" d={g.d} {...plateFill} transform="translate(0.12 0.07)" />
        <path className="step-chip__keyline" d={g.d} fill="none" stroke="#fff" strokeWidth="0.045" />
        <text {...TEXT} x={g.label.x} y={g.label.y} fontSize={g.label.size} textLength={g.label.width.toFixed(3)}>
          {l}
        </text>
        <text {...TEXT} x={g.value.x} y={g.value.y} fontSize={g.value.size} textLength={g.value.width.toFixed(3)}>
          {v}
        </text>
      </svg>
      {icon && g.icon && (
        <span
          className="step-chip__icon"
          aria-hidden="true"
          style={{
            left: `${(g.icon.x + 0.04).toFixed(3)}em`,
            top: `${(g.icon.y + 0.04).toFixed(3)}em`,
            width: `${g.icon.size.toFixed(3)}em`,
            height: `${g.icon.size.toFixed(3)}em`,
          }}
        >
          {icon}
        </span>
      )}
    </span>
  );
}
