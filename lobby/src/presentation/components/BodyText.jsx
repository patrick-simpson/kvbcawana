import React from 'react';
import { Words } from './Words.jsx';

/**
 * The read voice: Figtree, for text the room reads rather than glances at
 * (the pledges, a closing line). Balanced lines, one inline-block per word
 * so each can land on its own beat when `parts` is given.
 *
 * @param {{
 *   text: string,
 *   color?: string,
 *   size?: string,
 *   parts?: { start: number, hold?: number },
 *   className?: string,
 *   style?: React.CSSProperties,
 * }} props
 */
export const BodyText = ({ text, color = '#FFFFFF', size, parts, className = '', style }) => (
  <p className={`pj-body ${className}`.trim()} style={{ color, fontSize: size, ...style }}>
    <Words text={text} parts={parts} />
  </p>
);
