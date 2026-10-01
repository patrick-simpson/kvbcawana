// @ts-check
// The club-colour sweep that carries the projector from one slide to the
// next (the approved mockup, replacing the old 3D flip): the six club
// colours, youngest first, cross the bottom edge once and are gone, so the
// wall is bare black again. Pure data; ColorSweep.jsx draws it.

import { CLUB_ORDER, KIT_CLUBS } from './kit.js';
import { DUR } from './motion-tokens.js';

/** Height of the sweep strip, in projector units (1u = 1% of a 16:9 frame's width). */
export const SWEEP_HEIGHT_U = 7;

/**
 * One wave per club: each a little shorter than the one behind it, each a
 * step later, alternating their curve so the stack reads as six colours and
 * not one block. `direction` is +1 for forward (left to right) and -1 for
 * back, so stepping back through a deck sweeps the other way.
 * @param {1 | -1} [direction]
 * @returns {Array<{ club: string, color: string, heightPct: number, delay: number, flip: boolean, from: string, to: string }>}
 */
export function sweepWaves(direction = 1) {
  const from = direction === -1 ? '110%' : '-110%';
  const to = direction === -1 ? '-110%' : '110%';
  return CLUB_ORDER.map((club, i) => ({
    club,
    color: KIT_CLUBS[club].primary,
    heightPct: 100 - i * 13,
    delay: 0.12 + i * 0.045,
    flip: i % 2 === 1,
    from,
    to,
  }));
}

/** Seconds from the key press until the last wave has left the wall. */
export const SWEEP_TOTAL = 0.12 + (CLUB_ORDER.length - 1) * 0.045 + DUR.sweep;
