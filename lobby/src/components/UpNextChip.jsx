import { useState } from 'react';
import { M } from '../lib/motion.jsx';
import { DUR, EASE } from '../lib/brand.js';
import { holdThenLand } from '../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../lib/squish.js';
import { FRONT_WAVE_DELAY } from '../lib/checkInMoment.js';
import StepChip from './brand/StepChip.jsx';

/** How long the check-in moment's front wave takes to rise under the chip. */
export const WAVE_UP_SEC = FRONT_WAVE_DELAY + DUR.wipe;

/**
 * "UP NEXT / +3" while a run has a line behind it: a kit chip on the club's
 * own wave, above its mark (app.css .up-next). App mounts it only while a run
 * is on screen. On the run's first child (`rising`) the wave is still coming
 * up when the chip mounts, so it holds out of sight until the wave is under it
 * and lands with the club's mark; later in a run the wave is already up and
 * it pops at once, squashing at the pop's peak (the soft squish). Keyframes
 * rather than a delay (see holdThenLand), fixed at mount so a growing line
 * never replays it, and the last one is the resting chip, which is what
 * ?lowPower=1 shows.
 *
 * @param {{ pending: number, rising?: boolean }} props
 */
export default function UpNextChip({ pending, rising = false }) {
  const [enter] = useState(() => {
    const at = rising ? WAVE_UP_SEC : 0;
    return withSquish(
      holdThenLand(at, DUR.pop, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1 }, EASE.pop),
      squishLand(at, 'chip', DUR.pop, 'pop'),
    );
  });
  return (
    <M.div
      className="up-next"
      role="status"
      aria-label={`${pending} more coming`}
      initial={enter.initial}
      animate={enter.animate}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: DUR.exit, ease: EASE.exit } }}
      transition={enter.transition}
    >
      <StepChip label="UP NEXT" value={`+${pending}`} size="calc(2.5 * min(1vw, 1.7778vh))" />
    </M.div>
  );
}
