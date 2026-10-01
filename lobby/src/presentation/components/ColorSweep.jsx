import React from 'react';
import { motion } from 'framer-motion';
import { WAVE } from './ClubWave.jsx';
import { DUR, EASE } from '../lib/motion-tokens.js';
import { SWEEP_HEIGHT_U, sweepWaves } from '../lib/sweep.js';

/**
 * The club-colour sweep between two slides (the approved mockup, in place of
 * the old 3D flip): the six club waves cross the bottom edge once, youngest
 * first, and are gone, so the wall is bare black again. Mount one per
 * change; it plays once and rests OFF the wall, which is also where ?vr=1
 * and reduced motion (both skip transforms) leave it, and calls `onDone`
 * when its last wave has left, which is when it may be unmounted (never
 * before: a sweep taken away mid-wall snaps its waves off in one frame).
 * `direction` -1 (stepping back through a deck) sweeps right to left; each
 * wave carries where it enters from as `data-from`.
 *
 * @param {{ direction?: 1 | -1, onDone?: () => void }} props
 */
export const ColorSweep = ({ direction = 1, onDone }) => (
  <div
    className="pj-sweep"
    data-sweep
    aria-hidden="true"
    style={{ height: `calc(${SWEEP_HEIGHT_U} * var(--u))` }}
  >
    {sweepWaves(direction).map((w, i, all) => (
      <motion.div
        key={w.club}
        className="pj-wave"
        data-from={w.from}
        style={{ height: `${w.heightPct}%`, left: 0, right: 0, bottom: 0 }}
        initial={{ x: w.from }}
        animate={{ x: w.to }}
        transition={{ duration: DUR.sweep, ease: EASE.wipe, delay: w.delay }}
        // The last wave starts last and so leaves last.
        onAnimationComplete={i === all.length - 1 ? onDone : undefined}
      >
        <svg
          viewBox={WAVE.viewBox}
          preserveAspectRatio="none"
          style={w.flip ? { transform: 'scaleX(-1)' } : undefined}
          focusable="false"
        >
          <path d={WAVE.d} fill={w.color} />
        </svg>
      </motion.div>
    ))}
  </div>
);
