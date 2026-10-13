import React from 'react';
import { motion } from 'framer-motion';
import awanaClubsMark from '../../../shared/brand/logos/awana-clubs-white.svg';
import { DUR, EASE } from '../lib/motion-tokens.js';

/**
 * Where the mark sits, in projector units (1u = 1% of a 16:9 frame's
 * width), measured off the approved mockup. The same on every view: game
 * time used to tuck it lower and smaller to clear the club's top edge
 * waves, which the owner removed on 2026-10-13.
 */
export const MARK_PLACEMENT = { left: 3.2, top: 2.6, width: 11 };

/**
 * The Awana Clubs mark, top-left, like a broadcast logo: rendered once at
 * the top of the page (App.jsx), outside every view and slide, so it stays
 * put through every slide change and every view crossfade. It never moves;
 * it only fades away (on the settle curve) for a deliberately bare wall: the
 * opening's closing blackout and the shutdown screen's idle blackout.
 *
 * The white knockout from the family kit (shared/brand/logos/), imported as
 * a build asset like the lobby's, so it is hashed into the build.
 *
 * @param {{ hidden?: boolean }} props
 */
export const AwanaMark = ({ hidden = false }) => {
  const base = MARK_PLACEMENT;
  return (
    <motion.img
      src={awanaClubsMark}
      alt="Awana Clubs"
      draggable={false}
      data-awana-mark
      className="pj-mark"
      // Upright on a phone or tablet the portrait block at the end of index.css
      // sets these three to a mark sized for a tall frame; everywhere else they
      // fall back to MARK_PLACEMENT.
      style={{
        left: `calc(var(--pj-mark-left, ${base.left}) * var(--u))`,
        top: `calc(var(--pj-mark-top, ${base.top}) * var(--u))`,
        width: `calc(var(--pj-mark-width, ${base.width}) * var(--u))`,
      }}
      initial={false}
      animate={{ opacity: hidden ? 0 : 1 }}
      transition={{ duration: DUR.settle, ease: EASE.settle }}
    />
  );
};
