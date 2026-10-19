// The opening-ceremony remote's Next and Back (owner 2026-10-19), handed from
// App.jsx (where /settings' actions arrive, through useScreenSync's
// sanitizer) to the deck on the wall. The deck listens while it is mounted;
// a step nobody hears is answered `false`, so App can decide what a Next
// means on another view (the countdown: start the ceremony).

/** @type {Set<(dir: 1 | -1) => void>} */
const listeners = new Set();

/** Listen for remote steps; returns the unsubscribe. @param {(dir: 1 | -1) => void} fn */
export function onRemoteStep(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** @type {Set<(index: number) => void>} */
const goers = new Set();

/** Listen for "go to slide N" (a mirror following the gym projector); returns the unsubscribe. @param {(index: number) => void} fn */
export function onRemoteGo(fn) {
  goers.add(fn);
  return () => { goers.delete(fn); };
}

/** Send the deck on the wall to slide `index` (past its end = hand off to games). @param {number} index @returns {boolean} heard */
export function remoteGo(index) {
  for (const fn of goers) fn(index);
  return goers.size > 0;
}

/** Send one step to the deck on the wall. @param {1 | -1} dir @returns {boolean} heard */
export function remoteStep(dir) {
  for (const fn of listeners) fn(dir);
  return listeners.size > 0;
}
