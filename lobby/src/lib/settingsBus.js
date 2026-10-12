// @ts-check
// "That value just changed somewhere else on this page" (an Undo from the
// change log): the cards showing it reload instead of showing the old value.

/** @type {Set<(what: string) => void>} */
const listeners = new Set();

/** @param {(what: string) => void} fn @returns {() => void} unsubscribe */
export function onSettingsChanged(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** @param {string} what a change log `what` word (switch, church, notice, ...) */
export function emitSettingsChanged(what) { listeners.forEach((fn) => fn(what)); }
