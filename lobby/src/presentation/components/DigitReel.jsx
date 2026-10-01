import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DUR, EASE } from '../lib/motion-tokens.js';

/**
 * Width of one digit cell, in em: Paytone One's tabular figure advance.
 * Its default figures are proportional (0.444em for "1" to 0.679em for
 * "0"), so every digit gets the same cell or the whole clock would twitch
 * each second; .pj-timer turns on its tabular figures (tnum), which the
 * type's designer drew for exactly this, every one on a 0.600em advance with
 * its ink inside it (0.021em to 0.593em, the "4" the widest at 0.566em). So
 * a cell is one tabular figure: nothing clipped, nothing touching, and the
 * spacing is the font's own.
 */
export const DIGIT_CELL_EM = 0.6;

/**
 * The roll, as one mechanism: the new figure rolls in from above as the old
 * one rolls out below, BOTH on the kit's settle curve, the leaving half on
 * the shorter exit duration (the kit's rule: exits run faster than
 * entrances). One curve is what keeps the two figures apart: the leaving
 * figure is always at least as far along as the arriving one, so the pair
 * never stands closer than the 0.9em roll and the cell never shows two
 * figures at once. The exit CURVE (slow start) would hold the old figure at
 * rest at full strength while the new one had already arrived, a double
 * exposure for ~170 ms of every second (DigitReel.test.js samples it).
 */
export const ROLL = {
  initial: { y: '-0.9em', opacity: 0 },
  animate: { y: 0, opacity: 1, transition: { duration: DUR.settle, ease: EASE.settle } },
  exit: { y: '0.9em', opacity: 0, transition: { duration: DUR.exit, ease: EASE.settle } },
};

/**
 * One odometer digit: a fixed-width cell, rolling on ROLL. The cell clips
 * only top and bottom (clip-path), so a figure's ink is never shaved at the
 * sides; its 1.06em line leaves Paytone One's figures (-0.017em to 0.703em
 * about the baseline, which sits 0.792em down the cell) clear of both edges
 * at rest.
 */
export const DigitReel = ({ value }) => (
  <span className="pj-reel" style={{ width: `${DIGIT_CELL_EM}em` }}>
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.span
        key={value}
        className="pj-reel__digit"
        initial={ROLL.initial}
        animate={ROLL.animate}
        exit={ROLL.exit}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  </span>
);
