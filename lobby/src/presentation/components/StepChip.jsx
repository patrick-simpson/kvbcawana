import React from 'react';
import { chipGeometry, inkEm, measureEm } from '../lib/chip.js';
import { useFontsReady } from '../hooks/useFontsReady.js';

const TEXT = {
  fill: '#fff',
  textAnchor: 'middle',
  dominantBaseline: 'central',
  lengthAdjust: 'spacingAndGlyphs',
  style: { fontFamily: 'var(--font-display)' },
};

/**
 * The catalog's stepped chip, drawn for the projector: a small label on a
 * pill-shaped tier over a big value on a wider block that steps out beneath
 * it, the plate printed slightly out of register with its white keyline.
 * It replaces the old die-cut pill badge everywhere a label sits over a
 * value: "GAME ENDS / 6:30 PM", "CHECKED IN / 23", "THIS WEEK / Pajama Night".
 *
 * The plate is built around its own text, so a long value widens the chip
 * instead of spilling off it, and each text is pinned to its measured width
 * with textLength. `fitValue` sizes the value block for a wider stand-in
 * (a ticking count sized for its widest digits) while the real value is
 * drawn at its natural width (at the size it is drawn), so a counting chip
 * neither twitches nor stretches its glyphs. The value's ink is measured
 * too, so a mark over or under its capitals (Élodie, Ștefan) keeps off the
 * block's keyline. Scale the whole chip with `size` (the value's font size).
 *
 * @param {{
 *   label: string | number,
 *   value: string | number,
 *   size?: string,
 *   plate?: string,
 *   fitValue?: string,
 *   className?: string,
 *   style?: React.CSSProperties,
 * }} props
 */
export const StepChip = ({ label, value, size = '1rem', plate, fitValue, className = '', style }) => {
  useFontsReady();
  // The label is the kit's label voice: always caps.
  const l = String(label).toUpperCase();
  const v = String(value);
  const valueEm = measureEm(v);
  const g = chipGeometry(measureEm(l), Math.max(valueEm, fitValue ? measureEm(fitValue) : 0), inkEm(v));
  const plateFill = plate ? { fill: plate } : { fill: '#030404', fillOpacity: 0.5 };
  return (
    <span
      className={`pj-chip ${className}`.trim()}
      role="img"
      aria-label={`${l} ${v}`}
      style={{ fontSize: size, width: `${g.width.toFixed(3)}em`, height: `${g.height.toFixed(3)}em`, ...style }}
    >
      <svg viewBox={`-0.04 -0.04 ${g.width.toFixed(3)} ${g.height.toFixed(3)}`} aria-hidden="true" focusable="false">
        <path d={g.d} {...plateFill} transform="translate(0.12 0.07)" />
        <path d={g.d} fill="none" stroke="#fff" strokeWidth="0.045" />
        <text {...TEXT} x={g.label.x} y={g.label.y} fontSize={g.label.size} textLength={g.label.width.toFixed(3)}>
          {l}
        </text>
        <text {...TEXT} x={g.value.x} y={g.value.y} fontSize={g.value.size} textLength={(valueEm * g.value.size).toFixed(3)}>
          {v}
        </text>
      </svg>
    </span>
  );
};
