// @ts-check

export const AppMode = Object.freeze({
  COUNTDOWN: 'COUNTDOWN',
  SLIDESHOW: 'SLIDESHOW',
  GAME_TIME: 'GAME_TIME',
  SHUTDOWN: 'SHUTDOWN',
});

/**
 * @typedef {Object} ScheduleWindow
 * @property {'slideshow'|'game'|'shutdown'} kind
 * @property {string} title
 * @property {number} startMin Minute-of-day, inclusive.
 * @property {number} endMin Minute-of-day, exclusive (1440 = midnight).
 * @property {string} [deck] Slideshow deck id (kind 'slideshow' only).
 * @property {string[]} [clubs] Club ids (kind 'game' only).
 */

/**
 * @typedef {Object} SpecialDate
 * @property {boolean} [noClub] True cancels the night entirely.
 * @property {ScheduleWindow[]} [windows] Replacement table for that date.
 */

/**
 * @typedef {Object} ScheduleConfig
 * @property {number} meetingDay 0–6 (Sunday = 0).
 * @property {{hour: number, minute: number}} meetingStart
 * @property {ScheduleWindow[]} windows
 * @property {Record<string, SpecialDate>} specialDates Keyed YYYY-MM-DD.
 */

/**
 * The resolved display state — a discriminated union on `mode`.
 * @typedef {(
 *   { mode: 'COUNTDOWN', target: Date } |
 *   { mode: 'SLIDESHOW', deck: string|undefined, window: ScheduleWindow } |
 *   { mode: 'GAME_TIME', window: ScheduleWindow, endsAt: Date } |
 *   { mode: 'SHUTDOWN', window: ScheduleWindow }
 * )} AppState
 */
