import { useEffect, useState } from 'react';
import { FLAGS } from '../lib/flags.js';

/**
 * Optional time-travel offset for QA: open the app with
 * `?now=2026-09-16T18:04:00` to run the whole app at a simulated time.
 * The offset is fixed at load; the simulated clock still ticks forward —
 * unless `?freeze=1` is also set, in which case time stands completely
 * still (for screenshots / visual-regression tests).
 */
let offsetMs = 0;
let frozenAt = null;
if (typeof window !== 'undefined') {
  const param = new URLSearchParams(window.location.search).get('now');
  if (param) {
    const parsed = new Date(param).getTime();
    if (!Number.isNaN(parsed)) {
      offsetMs = parsed - Date.now();
      if (FLAGS.freeze) frozenAt = parsed;
    }
  }
}

export const currentTime = () => (frozenAt !== null ? new Date(frozenAt) : new Date(Date.now() + offsetMs));

/**
 * Single app-wide 1s clock, drift-corrected: each timeout is armed to
 * fire just past the next wall-clock second boundary, so displayed
 * seconds flip on the true second and never drift or skip.
 */
export function useClock() {
  const [now, setNow] = useState(() => currentTime());

  useEffect(() => {
    if (frozenAt !== null) return undefined; // time stands still — nothing to arm
    let timer;
    const arm = () => {
      timer = setTimeout(() => {
        setNow(currentTime());
        arm();
      }, 1000 - (Date.now() % 1000) + 5);
    };
    arm();
    return () => clearTimeout(timer);
  }, []);

  return now;
}
