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

/** Send one step to the deck on the wall. @param {1 | -1} dir @returns {boolean} heard */
export function remoteStep(dir) {
  for (const fn of listeners) fn(dir);
  return listeners.size > 0;
}
