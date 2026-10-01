import React from 'react';
import { Words } from './Words.jsx';
import { inkEm, inkOverflow, measureEm } from '../lib/chip.js';
import { useFontsReady } from '../hooks/useFontsReady.js';

/**
 * The font size (in projector units) that sets `text` on ONE line across
 * `widthU`, never above `maxU`; below `minU` it stops shrinking and wraps
 * (between words) instead, so a long closing title stays readable.
 * @param {string} text
 * @param {{ maxU: number, widthU: number, minU?: number }} fit
 */
export function fittedSize(text, fit) {
  return `calc(${fittedU(text, fit).toFixed(3)} * var(--u))`;
}

/**
 * fittedSize as a number of projector units, for a layout that has to know
 * how much room the headline takes.
 * @param {string} text
 * @param {{ maxU: number, widthU: number, minU?: number }} fit
 */
export function fittedU(text, { maxU, widthU, minU = maxU * 0.7 }) {
  const em = measureEm(String(text).toUpperCase());
  const one = em > 0 ? widthU / em : maxU;
  return Math.max(minU, Math.min(maxU, one));
}

/** The headline's line height for plain caps (index.css .pj-headline). */
export const HEADLINE_LINE_HEIGHT = 0.93;

/**
 * The line box a headline's marks need, in em. Plain caps keep
 * HEADLINE_LINE_HEIGHT and no padding. Paytone One draws the marks over and
 * under its capitals tall (É reaches 1.045em, Ễ 1.161em, Ș's comma
 * -0.351em), so a title that carries one gets room above its first row and
 * below its last, and, if it can wrap at all (it has a space), rows far
 * enough apart that one row's marks clear the next by 0.06em. The rows
 * themselves are the browser's (text-wrap: balance), so the tallest and
 * deepest marks anywhere in the title are assumed to meet.
 * @param {string} text
 * @returns {{ lineHeight: number, padTop: number, padBottom: number }}
 */
export function headlineBox(text) {
  const shouted = String(text).toUpperCase();
  const words = shouted.split(/\s+/).filter(Boolean);
  if (!words.length) return { lineHeight: HEADLINE_LINE_HEIGHT, padTop: 0, padBottom: 0 };
  const inks = words.map((w) => inkEm(w));
  const ink = {
    ascent: Math.max(...inks.map((i) => i.ascent)),
    descent: Math.max(...inks.map((i) => i.descent)),
  };
  const wraps = words.length > 1;
  const lineHeight = wraps
    ? Math.max(HEADLINE_LINE_HEIGHT, Math.ceil((ink.descent + 0.06 + ink.ascent) * 100 - 1e-6) / 100)
    : HEADLINE_LINE_HEIGHT;
  const { top, bottom } = inkOverflow(ink, lineHeight);
  return { lineHeight, padTop: top, padBottom: bottom };
}

/**
 * The projector's one headline. Every view shouts the same way: Paytone
 * One (the kit's shout voice) in caps, flat colour, broken only between words.
 * It replaces the three treatments that came before it (the per-letter
 * "crayon" tilt, the flat gold title, and the tilted GAME TIME!).
 *
 * `size` is a CSS length (projector units, e.g. `calc(7.6 * var(--u))`);
 * `fit` sizes it by measurement instead, so a title sits on one line when it
 * can (see fittedSize). `parts` makes each word an animated part of its
 * slide (see Words.jsx); without it nothing here touches framer-motion.
 *
 * @param {{
 *   text: string,
 *   as?: React.ElementType,
 *   color?: string,
 *   size?: string,
 *   fit?: { maxU: number, widthU: number, minU?: number },
 *   parts?: { start: number, hold?: number },
 *   className?: string,
 *   style?: React.CSSProperties,
 * }} props
 */
export const Headline = ({ text, as: Tag = 'h1', color = '#FFFFFF', size, fit, parts, className = '', style }) => {
  useFontsReady();
  const fontSize = fit ? fittedSize(text, fit) : size;
  const box = headlineBox(text);
  const room = box.lineHeight === HEADLINE_LINE_HEIGHT && !box.padTop && !box.padBottom
    ? null
    : { lineHeight: box.lineHeight, paddingTop: `${box.padTop}em`, paddingBottom: `${box.padBottom}em` };
  return (
    <Tag className={`pj-headline ${className}`.trim()} style={{ color, fontSize, ...room, ...style }}>
      <Words text={text} parts={parts} />
    </Tag>
  );
};
