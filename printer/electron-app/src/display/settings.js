// @ts-check
// The display's own settings (the configurator's left column), kept in the
// display's state.json beside the remembered monitor. Whatever is on disk, or
// arrives from the configurator, the wizard or the sound room app's hand-off,
// goes through normalizeSettings first: a missing or bad value becomes its
// default, so an old state.json (before these settings existed) reads as
// "the lobby, 5:00 to 8:00 pm, no shutdown", exactly how every install behaved.
//
// Moved from lobby/desktop/src/settings.js (KVBC Awana v9). New: `hours`, this
// computer's display hours (owner, 2026-10-11: "club nights, hours per
// computer", default 5:00 to 8:00 pm). /settings will edit them per computer
// once computers register there (ROADMAP.md#kvbc-awana-one-app); until then the Settings
// window and the wizard do.
'use strict';

const { DEFAULT_SCREEN, screenFor } = require('./screens');

const DEFAULT_SHUTDOWN_AT = '20:15';
const DEFAULT_HOURS = Object.freeze({ start: '17:00', end: '20:00' });
// The shutdown is a club-night thing: an evening time, after the screens open.
const EARLIEST_MIN = 17 * 60;
const LATEST_MIN = 23 * 60 + 59;
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** @typedef {{ start: string, end: string }} HoursSetting */
/** @typedef {{ screen: import('./screens').ScreenId, hours: HoursSetting, shutdown: { enabled: boolean, at: string } }} Settings */

/** @type {Settings} */
const DEFAULT_SETTINGS = Object.freeze({
  screen: DEFAULT_SCREEN,
  hours: { ...DEFAULT_HOURS },
  shutdown: { enabled: false, at: DEFAULT_SHUTDOWN_AT },
});

/** Any HH:MM of the day, as minutes; null when it is not one. */
function parseClock(/** @type {unknown} */ hhmm) {
  const m = typeof hhmm === 'string' ? HHMM.exec(hhmm) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The shutdown's time: an evening HH:MM (5:00 pm to 11:59 pm), or null. */
function parseTime(/** @type {unknown} */ hhmm) {
  const min = parseClock(hhmm);
  return min != null && min >= EARLIEST_MIN && min <= LATEST_MIN ? min : null;
}

/**
 * Display hours: both good times with the start before the end (one day, no
 * running past midnight), else the default 5:00 to 8:00 pm.
 * @param {any} raw
 * @returns {HoursSetting}
 */
function normalizeHours(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const open = parseClock(r.start);
  const close = parseClock(r.end);
  if (open == null || close == null || open >= close) return { ...DEFAULT_HOURS };
  return { start: r.start, end: r.end };
}

/** The hours as clubNight.js reads them. @param {HoursSetting} hours */
function hoursMinutes(hours) {
  const h = normalizeHours(hours);
  return { openMin: /** @type {number} */ (parseClock(h.start)), closeMin: /** @type {number} */ (parseClock(h.end)) };
}

/** @param {any} raw @returns {Settings} */
function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const s = r.shutdown && typeof r.shutdown === 'object' ? r.shutdown : {};
  return {
    screen: screenFor(r.screen).id,
    hours: normalizeHours(r.hours),
    shutdown: {
      enabled: s.enabled === true,
      at: parseTime(s.at) != null ? s.at : DEFAULT_SHUTDOWN_AT,
    },
  };
}

module.exports = {
  DEFAULT_SHUTDOWN_AT, DEFAULT_HOURS, DEFAULT_SETTINGS,
  parseClock, parseTime, normalizeHours, hoursMinutes, normalizeSettings,
};
