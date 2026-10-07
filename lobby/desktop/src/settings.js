// @ts-check
// The app's own settings (the configurator's left column), kept in state.json
// beside the remembered monitor. Whatever is on disk, or arrives from the
// configurator, goes through normalizeSettings first: a missing or bad value
// becomes its default, so an old state.json (before these settings existed)
// reads as "the lobby, no shutdown", exactly how every install behaved.

import { DEFAULT_SCREEN, screenFor } from './screens.js';

export const DEFAULT_SHUTDOWN_AT = '20:15';
// The shutdown is a club-night thing: an evening time, after the screens open.
const EARLIEST_MIN = 17 * 60;
const LATEST_MIN = 23 * 60 + 59;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** @typedef {{ screen: import('./screens.js').ScreenId, shutdown: { enabled: boolean, at: string } }} Settings */

/** @type {Settings} */
export const DEFAULT_SETTINGS = { screen: DEFAULT_SCREEN, shutdown: { enabled: false, at: DEFAULT_SHUTDOWN_AT } };

/** @param {string} hhmm @returns {number | null} minutes of the day */
export function parseTime(hhmm) {
  const m = typeof hhmm === 'string' ? HHMM.exec(hhmm) : null;
  if (!m) return null;
  const min = Number(m[1]) * 60 + Number(m[2]);
  return min >= EARLIEST_MIN && min <= LATEST_MIN ? min : null;
}

/** @param {any} raw @returns {Settings} */
export function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = r.shutdown && typeof r.shutdown === 'object' ? r.shutdown : {};
  return {
    screen: screenFor(r.screen).id,
    shutdown: {
      enabled: s.enabled === true,
      at: parseTime(s.at) != null ? s.at : DEFAULT_SHUTDOWN_AT,
    },
  };
}
