// GENERATED from shared/clubNight.js by scripts/shared-copies.mjs: do not edit; edit the source and run
// `node scripts/family-assets.mjs`. scripts/check-mirrors.mjs fails when this copy drifts.
'use strict';
// @ts-check
// THE club-night rule: when a Wednesday club night is on, and when a screen
// shows for it. Pure (no Electron, no clock of its own, no DOM), so one copy
// serves every reader and the rules are unit-tested once
// (shared/clubNight.test.js).
//
// Who reads it, and how (see shared/README.md):
//   - lobby/src (the signage, the projector) imports this file through Vite;
//   - printer/electron-app (the one KVBC Awana app) ships in an installer
//     that cannot reach outside its own folder, so it carries a GENERATED copy
//     (printer/electron-app/src/display/clubNight.js) made by
//     `node scripts/family-assets.mjs`; scripts/check-mirrors.mjs fails CI
//     when it has drifted. Edit this file, then regenerate. (The old sound
//     room app, lobby/desktop, had a copy too until it was retired 2026-10-16.)
//
// The window is the computer's own hours (the printer app's settings.hours,
// owner 2026-10-11: "hours per computer"); without hours it is the church's
// 4:00 to 8:00 pm (owner 2026-10-21; was 5:00).
//
// A club night is decided the same way the signage decides one
// (lobby/src/lib/calendarLogic.js clubNights() / deriveClubInfo()):
//   1. shared/schedule.json's specialDates marks a date `noClub: true`:
//      never a club night, whatever else says so (isNoClubDate);
//   2. a specialDates entry with its own `windows` table is a special meeting
//      (the projector runs one even on a non-Wednesday): a club night;
//   3. with a calendar feed (calendar-feed.json, built nightly from TwoTimTwo,
//      listing the whole season): a date after its last event is past the
//      season (the page itself says "season over"), so not a club night; a
//      date it covers (generated on or before it) is a club night exactly
//      when it lists an uncancelled `kind: 'club'` event on it;
//   4. with no feed at all (or for a date before the feed was generated): the
//      schedule's meeting day (Wednesday).
// Rule 3's "season over" keeps the TV dark all summer; the tray's Show now is
// the way to put it up for a summer event.

/** @typedef {{ meeting?: { day?: number }, timezone?: string, specialDates?: Record<string, { noClub?: boolean, windows?: unknown[] }> }} Schedule */
/** @typedef {{ generatedAt?: string, events?: Array<{ date?: string, kind?: string, isCancelled?: boolean }> }} Feed */
/** @typedef {{ openMin: number, closeMin: number }} Hours */

const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_MEETING_DAY = 3; // Wednesday
const OPEN_AT_MIN = 16 * 60; // 4:00 pm
const CLOSE_AT_MIN = 20 * 60; // 8:00 pm
/** @type {Hours} */
const DEFAULT_HOURS = Object.freeze({ openMin: OPEN_AT_MIN, closeMin: CLOSE_AT_MIN });

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Is `dateKey` marked no-club by the schedule's specialDates table?
 *
 * @param {Record<string, { noClub?: boolean }> | null | undefined} specialDates
 * @param {string} dateKey  YYYY-MM-DD
 * @returns {boolean}
 */
function isNoClubDate(specialDates, dateKey) {
  return specialDates?.[dateKey]?.noClub === true;
}

/** Good hours, or the default: an open before its close, inside one day. */
function hoursOrDefault(/** @type {any} */ hours) {
  if (hours && Number.isInteger(hours.openMin) && Number.isInteger(hours.closeMin)
    && hours.openMin >= 0 && hours.closeMin <= 24 * 60 && hours.openMin < hours.closeMin) {
    return /** @type {Hours} */ ({ openMin: hours.openMin, closeMin: hours.closeMin });
  }
  return DEFAULT_HOURS;
}

/**
 * The wall-clock date, weekday and minute of the day at `now` in `timeZone`.
 * An unknown zone falls back to the church's default rather than throwing.
 *
 * @param {Date} now
 * @param {string} [timeZone]
 * @returns {{ dateKey: string, weekday: number, minutes: number }}
 */
function zonedParts(now, timeZone = DEFAULT_TIMEZONE) {
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  }
  /** @type {Record<string, string>} */
  const p = {};
  for (const part of fmt.formatToParts(now)) p[part.type] = part.value;
  return {
    dateKey: `${p.year}-${p.month}-${p.day}`,
    weekday: WEEKDAYS[/** @type {keyof typeof WEEKDAYS} */ (p.weekday)] ?? 0,
    minutes: (Number(p.hour) % 24) * 60 + Number(p.minute),
  };
}

/**
 * @param {string} dateKey  YYYY-MM-DD in the church's zone
 * @param {number} weekday  0 = Sunday
 * @param {{ schedule?: Schedule | null, feed?: Feed | null, timeZone?: string }} sources
 * @returns {boolean}
 */
function isClubNight(dateKey, weekday, { schedule = null, feed = null, timeZone = DEFAULT_TIMEZONE } = {}) {
  const special = schedule?.specialDates && typeof schedule.specialDates === 'object' ? schedule.specialDates : {};
  if (isNoClubDate(special, dateKey)) return false;
  if (Array.isArray(special[dateKey]?.windows) && special[dateKey].windows.length > 0) return true;

  const events = Array.isArray(feed?.events)
    ? feed.events.filter((e) => e && typeof e.date === 'string' && DATE_KEY.test(e.date))
    : [];
  const generated = feed?.generatedAt ? new Date(feed.generatedAt) : null;
  const generatedKey = generated && !Number.isNaN(generated.getTime()) ? zonedParts(generated, timeZone).dateKey : null;
  const lastKey = events.reduce((max, e) => { const d = /** @type {string} */ (e.date); return d > max ? d : max; }, '');
  if (events.length && dateKey > lastKey) return false; // past the season
  const covered = events.length > 0 && generatedKey != null && generatedKey <= dateKey;
  if (covered) {
    return events.some((e) => e.date === dateKey && e.kind === 'club' && e.isCancelled !== true);
  }

  const day = Number.isInteger(schedule?.meeting?.day) ? /** @type {number} */ (schedule?.meeting?.day) : DEFAULT_MEETING_DAY;
  return weekday === day;
}

const zoneOf = (/** @type {Schedule | null} */ schedule) => (typeof schedule?.timezone === 'string' && schedule.timezone ? schedule.timezone : DEFAULT_TIMEZONE);

/**
 * Whether `now` is inside tonight's display window, and the key of that
 * window (its date), which the "Hide until the next club night" override is
 * tied to.
 *
 * @param {Date} now
 * @param {{ schedule?: Schedule | null, feed?: Feed | null }} sources
 * @param {Hours} [hours]  this computer's hours (default 4:00 to 8:00 pm)
 * @returns {{ inWindow: boolean, windowKey: string | null, dateKey: string, minutes: number }}
 */
function displayWindow(now, { schedule = null, feed = null } = {}, hours) {
  const { openMin, closeMin } = hoursOrDefault(hours);
  const timeZone = zoneOf(schedule);
  const { dateKey, weekday, minutes } = zonedParts(now, timeZone);
  const inHours = minutes >= openMin && minutes < closeMin;
  const inWindow = inHours && isClubNight(dateKey, weekday, { schedule, feed, timeZone });
  return { inWindow, windowKey: inWindow ? dateKey : null, dateKey, minutes };
}

/**
 * The next club night's opening, as a date key, looking up to `days` ahead
 * (for the tray's status line). Null when none is found.
 *
 * @param {Date} now
 * @param {{ schedule?: Schedule | null, feed?: Feed | null }} sources
 * @param {number} [days]
 * @param {Hours} [hours]
 * @returns {string | null}
 */
function nextClubNight(now, { schedule = null, feed = null } = {}, days = 60, hours) {
  const { closeMin } = hoursOrDefault(hours);
  const timeZone = zoneOf(schedule);
  const today = zonedParts(now, timeZone);
  for (let i = 0; i <= days; i++) {
    // Noon UTC steps a whole day at a time with no DST edge to trip on.
    const [y, m, d] = today.dateKey.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d + i, 12));
    const key = probe.toISOString().slice(0, 10);
    const weekday = probe.getUTCDay();
    if (i === 0 && today.minutes >= closeMin) continue;
    if (isClubNight(key, weekday, { schedule, feed, timeZone })) return key;
  }
  return null;
}

/**
 * Whether today (in the church's zone) is a club night, at any hour: the
 * optional shutdown asks after the close, which nextClubNight() has already
 * moved past.
 *
 * @param {Date} now
 * @param {{ schedule?: Schedule | null, feed?: Feed | null }} sources
 */
function clubNightToday(now, { schedule = null, feed = null } = {}) {
  const timeZone = zoneOf(schedule);
  const { dateKey, weekday } = zonedParts(now, timeZone);
  return isClubNight(dateKey, weekday, { schedule, feed, timeZone });
}

module.exports = {
  DEFAULT_TIMEZONE,
  DEFAULT_MEETING_DAY,
  OPEN_AT_MIN,
  CLOSE_AT_MIN,
  DEFAULT_HOURS,
  isNoClubDate,
  hoursOrDefault,
  zonedParts,
  isClubNight,
  displayWindow,
  nextClubNight,
  clubNightToday,
};
