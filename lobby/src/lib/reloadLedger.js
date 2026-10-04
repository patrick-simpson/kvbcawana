// How many times this screen has reloaded itself lately, so a self-heal (the
// realtime watchdog, a crashed render) can never turn a genuinely dead
// network or a persistent crash into a reload loop. One sessionStorage ledger
// for every self-reload on the page; both pages read it (the projector is
// allowed this file: one copy of "may this screen reload" is the point).

import { WATCHDOG_MAX_RELOADS_PER_HOUR } from './constants.js';

const RELOADS_KEY = 'awanaWatchdogReloads.v1';
const HOUR_MS = 60 * 60 * 1000;

/** The self-reloads of the last hour, oldest first. */
export function recentReloads(now = Date.now()) {
  try {
    const list = JSON.parse(sessionStorage.getItem(RELOADS_KEY)) || [];
    return list.filter((t) => Number.isFinite(t) && now - t < HOUR_MS);
  } catch {
    return [];
  }
}

/** Whether one more self-reload is within the hourly cap. */
export function mayReload(now = Date.now()) {
  return recentReloads(now).length < WATCHDOG_MAX_RELOADS_PER_HOUR;
}

/** Record a self-reload that is about to happen. */
export function recordReload(now = Date.now()) {
  try {
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...recentReloads(now), now]));
  } catch {
    /* storage blocked: the reload still happens, just uncounted */
  }
}

/**
 * Reload the page as a self-heal, if the hourly cap allows. Returns whether it
 * was asked for.
 */
export function selfReload(now = Date.now()) {
  if (!mayReload(now)) return false;
  recordReload(now);
  window.location.reload();
  return true;
}
