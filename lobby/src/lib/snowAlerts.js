// @ts-check
// ─────────────────────────────────────────────────────────────
// The snow-alerts slide, the pure half: WHEN it may show, HOW OFTEN, and
// WHAT it says. No React, no network.
//
// The slide asks parents to sign up at kvbchurch.org/alerts for the text the
// church sends when snow cancels club (owner, 2026-10-11). The owner's calls:
//   • Only in Maine's snow season, November 1 through March 31, every year.
//   • Rarely on an ordinary week: about one lap in six through the deck.
//   • More when it matters: when the forecast has an inch or more of snow
//     on the next club night or the day before it (a Tuesday storm closes
//     Wednesday's roads too), every other lap, and the copy names the night.
//   • It holds check-ins like the fall posters, so a parent mid-scan never
//     loses the code under a name.
//
// Same house rules as the promos: every comparison is on a bare local
// YYYY-MM-DD key (never toISOString(), which in a US-Eastern evening is
// already tomorrow), and "which nights are club nights" is calendarLogic's
// clubNights(), so a break week the shared schedule marks noClub is never
// mistaken for a night the snow could cancel.
// ─────────────────────────────────────────────────────────────

import { clubNights, daysBetween } from './calendarLogic.js';
import { dateKey, pad2 } from './time.js';

/** Month-day keys, inclusive, wrapping the new year. */
export const SNOW_SEASON = Object.freeze({ from: '11-01', until: '03-31' });

/** Inches of forecast snow that make a club night a snow risk. */
export const SNOW_INCHES = 1;

/** How far ahead a club night can be and still count as "this coming week". */
export const SNOW_LOOKAHEAD_DAYS = 7;

/**
 * How often the slide airs, in laps of the deck: one turn in `calm` laps on an
 * ordinary week, one in `storm` when snow is forecast near club night.
 */
export const SNOW_CADENCE = Object.freeze({ calm: 6, storm: 2 });

/** The slide's hold. The QR is on screen, still, for the last 13+ seconds. */
export const SNOW_ALERT_SEC = 20;

/**
 * Is a local date key inside the snow season?
 * @param {string} todayStr
 * @returns {boolean}
 */
export function inSnowSeason(todayStr) {
  const md = /^\d{4}-(\d{2}-\d{2})$/.exec(String(todayStr ?? ''))?.[1];
  if (!md) return false;
  // The window wraps the new year: on or after Nov 1, or on or before Mar 31.
  return md >= SNOW_SEASON.from || md <= SNOW_SEASON.until;
}

/**
 * @typedef {Object} SnowForecast
 * @property {string[]} time   local date keys, one per forecast day
 * @property {number[]} inches forecast snowfall for that day, in inches
 */

/**
 * @typedef {Object} SnowOutlook
 * @property {string} date     the club night the snow threatens
 * @property {'tonight'|'tomorrow'|'later'} when
 * @property {string} weekday  'Wednesday'
 * @property {number} inches   the most forecast on that night or the day before
 */

/**
 * 'YYYY-MM-DD' shifted by whole days, in local calendar terms.
 * @param {string} dateStr
 * @param {number} n
 */
function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const date = new Date(y, m - 1, d + n);
  return dateKey(date);
}

/** @param {string} dateStr */
function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long' });
}

/**
 * Is snow forecast for the next club night (or the day before it)?
 *
 * The next club night is the first one on the calendar from today on that is
 * not cancelled (the calendar's own cancellations and the shared schedule's
 * noClub weeks alike), and only within SNOW_LOOKAHEAD_DAYS: next month's
 * storm is not this week's news. Null whenever there is nothing honest to
 * say: no feed, no forecast, no club night this week, or not enough snow.
 *
 * @param {Array<any>|null|undefined} events
 * @param {string} todayStr
 * @param {SnowForecast|null|undefined} forecast
 * @param {Record<string, any>|null} [specialDates]
 * @returns {SnowOutlook|null}
 */
export function snowOutlook(events, todayStr, forecast, specialDates = null) {
  if (!forecast || !Array.isArray(forecast.time) || !Array.isArray(forecast.inches)) return null;
  const next = clubNights(events, specialDates)
    .filter((e) => !e.isCancelled && typeof e.date === 'string' && e.date >= todayStr)
    .map((e) => e.date)
    .sort()[0];
  if (!next) return null;
  const ahead = daysBetween(todayStr, next);
  if (!(ahead >= 0 && ahead <= SNOW_LOOKAHEAD_DAYS)) return null;

  /** @param {string} date */
  const snowOn = (date) => {
    const i = forecast.time.indexOf(date);
    const v = i >= 0 ? Number(forecast.inches[i]) : NaN;
    return Number.isFinite(v) ? v : 0;
  };
  const inches = Math.max(snowOn(next), snowOn(addDays(next, -1)));
  if (inches < SNOW_INCHES) return null;
  return {
    date: next,
    when: ahead === 0 ? 'tonight' : ahead === 1 ? 'tomorrow' : 'later',
    weekday: weekdayOf(next),
    inches: Math.round(inches * 10) / 10,
  };
}

/**
 * The slide's words. One headline whatever the week; the kicker turns
 * urgent, and names the night, when snow is forecast for it.
 *
 * @param {SnowOutlook|null|undefined} outlook
 * @returns {{ kicker: string, headline: string[], storm: boolean }}
 */
export function snowAlertCopy(outlook) {
  const headline = ['Sign up for', 'cancellation', 'texts'];
  if (!outlook) return { kicker: 'Snow day?', headline, storm: false };
  const night = outlook.when === 'tonight' ? 'Tonight'
    : outlook.when === 'tomorrow' ? 'Tomorrow'
      : outlook.weekday;
  return {
    kicker: `${night} looks snowy`,
    headline,
    storm: true,
  };
}

/**
 * The phone's sample text: the church's real cancellation message, word for
 * word (owner, 2026-10-11, with the apostrophe in "weeks’" put right), dated
 * the day the slide is on screen, and the lock screen's date to match.
 *
 * @param {Date} now
 * @returns {{ weekday: string, lockDate: string, text: string }}
 */
export function sampleAlertText(now) {
  const yy = pad2(now.getFullYear() % 100);
  const date = `${now.getMonth() + 1}/${now.getDate()}/${yy}`;
  const wd = now.toLocaleDateString('en-US', { weekday: 'short' });
  const mon = now.toLocaleDateString('en-US', { month: 'short' });
  return {
    weekday: now.toLocaleDateString('en-US', { weekday: 'long' }),
    // The Pixel lock screen's date line: "Sun, Oct 11".
    lockDate: `${wd}, ${mon} ${now.getDate()}`,
    text: `Awana has been cancelled on ${date} at KVBC. Clubbers should come prepared with both weeks’ sections next week.`,
  };
}

/**
 * The Pixel lock screen's clock: 12-hour, no leading zero, no AM/PM ("4:30").
 *
 * @param {Date} now
 */
export function lockTime(now) {
  const h = now.getHours() % 12 || 12;
  return `${h}:${pad2(now.getMinutes())}`;
}

/**
 * The phone's battery reads tonight's check-ins, as a percentage that stops
 * at 100 (owner, 2026-10-11).
 *
 * @param {number|null|undefined} checkedIn
 */
export function batteryLevel(checkedIn) {
  const n = Number.isFinite(checkedIn) ? Math.floor(Number(checkedIn)) : 0;
  return Math.max(0, Math.min(100, n));
}
