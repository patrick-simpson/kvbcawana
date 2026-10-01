import React from 'react';
import { motion } from 'framer-motion';
import awanaClubsMark from '../../../shared/brand/logos/awana-clubs-white.svg';
import { DUR, EASE } from '../lib/motion-tokens.js';

/**
 * Where the mark sits, in projector units (1u = 1% of a 16:9 frame's
 * width), measured off the approved mockup. Game time tucks it lower and a
 * little smaller so it clears the club's top edge waves.
 */
export const MARK_PLACEMENTS = {
  default: { left: 3.2, top: 2.6, width: 11 },
  game: { left: 3.2, top: 4.4, width: 9.5 },
};

/** The mark's own aspect (height / width), from its viewBox (225 x 94). */
const MARK_ASPECT = 94 / 225;

/**
 * The Awana Clubs mark, top-left, like a broadcast logo: rendered once at
 * the top of the page (App.jsx), outside every view and slide, so it stays
 * put through every slide change and every view crossfade. It moves only
 * between its two placements (transform-only, on the settle curve) and
 * fades away for a deliberately bare wall: the opening's closing blackout
 * and the shutdown screen's idle blackout.
 *
 * The white knockout from the family kit (shared/brand/logos/), imported as
 * a build asset like the lobby's, so it is hashed into the build.
 *
 * @param {{ placement?: keyof typeof MARK_PLACEMENTS, hidden?: boolean }} props
 */
export const AwanaMark = ({ placement = 'default', hidden = false }) => {
  const base = MARK_PLACEMENTS.default;
  const at = MARK_PLACEMENTS[placement] ?? base;
  // A translate percentage is of the element's own (unscaled) height, which
  // keeps the move in projector units without animating a calc() string.
  const dropPct = ((at.top - base.top) / (base.width * MARK_ASPECT)) * 100;
  return (
    <motion.img
      src={awanaClubsMark}
      alt="Awana Clubs"
      draggable={false}
      data-awana-mark
      className="pj-mark"
      // Upright on a phone or tablet the portrait block at the end of index.css
      // sets these three to a mark sized for a tall frame; everywhere else they
      // fall back to the table above.
      style={{
        left: `calc(var(--pj-mark-left, ${base.left}) * var(--u))`,
        top: `calc(var(--pj-mark-top, ${base.top}) * var(--u))`,
        width: `calc(var(--pj-mark-width, ${base.width}) * var(--u))`,
        transformOrigin: '0 0',
      }}
      initial={false}
      animate={{
        opacity: hidden ? 0 : 1,
        y: `${dropPct.toFixed(3)}%`,
        scale: at.width / base.width,
      }}
      transition={{ duration: DUR.settle, ease: EASE.settle }}
    />
  );
};
