// @ts-check
import { useEffect, useState } from 'react';

/**
 * `flag`, kept true for `ms` after it goes false: the falling edge lingers,
 * the rising edge is immediate. For a fact that flips before the room can see
 * it (a held slide's `special` drops the moment the slideshow moves on, while
 * the poster is still on screen under the stinger's wave until the swap), so
 * whatever must not stand over it waits for the wave to clear.
 *
 * The linger starts in the SAME render the flag falls in (React's "adjust
 * state during render", the pattern useSlideTransition uses), never from an
 * effect after it: an effect would leave one committed frame with the flag
 * off and the linger not yet on, and that frame is the one this exists to
 * remove. `ms` of 0 (zero animation: nothing is leaving) lingers not at all.
 *
 * @param {boolean} flag
 * @param {number} ms
 * @returns {boolean}
 */
export function useLinger(flag, ms) {
  const [seen, setSeen] = useState(flag);
  const [lingering, setLingering] = useState(false);
  if (flag !== seen) {
    setSeen(flag);
    setLingering(seen && !flag && ms > 0);
  }
  useEffect(() => {
    if (!lingering) return undefined;
    const t = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(t);
  }, [lingering, ms]);
  return flag || lingering;
}
