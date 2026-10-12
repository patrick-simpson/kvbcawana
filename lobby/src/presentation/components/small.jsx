import React from 'react';
import { Words } from './Words.jsx';

// The projector's two small shared shells: the black frame every view draws
// in (ScreenFrame) and the read voice for a line of body copy (BodyText).

/**
 * The shared pure-black shell and ambient layer stack, applied
 * identically on every view. Flat and crisp — no scanlines, no
 * edge-darkening vignette, and (by operator request) no brand bars:
 * this is a projector on a white wall, edge to edge black.
 */
export const ScreenFrame = ({
  layers,
  shake = false,
  className = '',
  children,
}) => (
  <div
    className={`w-full h-full flex flex-col relative overflow-hidden ${shake ? 'animate-screen-shake' : ''} ${className}`}
    style={{ background: '#000000' }}
  >
    {layers}

    <div className="relative z-10 flex-1 flex flex-col min-h-0">{children}</div>
  </div>
);

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
