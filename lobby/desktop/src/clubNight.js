// @ts-check
// When the lobby display should be on screen: club nights, 5:00 to 8:00 pm,
// in the church's own time zone. Pure (no Electron, no clock of its own), so
// the rules are unit-tested; main.js hands it the time and the two files.
//
// A club night is decided the same way the signage decides one
// (src/lib/calendarLogic.js clubNights() / deriveClubInfo()):
//   1. shared/schedule.json's specialDates marks a date `noClub: true`:
//      never a club night, whatever else says so;
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

export const DEFAULT_TIMEZONE = 'America/New_York';
export const DEFAULT_MEETING_DAY = 3; // Wednesday
export const OPEN_AT_MIN = 17 * 60; // 5:00 pm
export const CLOSE_AT_MIN = 20 * 60; // 8:00 pm

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * The wall-clock date, weekday and minute of the day at `now` in `timeZone`.
 * An unknown zone falls back to the church's default rather than throwing.
 *
 * @param {Date} now
 * @param {string} [timeZone]
 * @returns {{ dateKey: string, weekday: number, minutes: number }}
 */
export function zonedParts(now, timeZone = DEFAULT_TIMEZONE) {
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
export function isClubNight(dateKey, weekday, { schedule = null, feed = null, timeZone = DEFAULT_TIMEZONE } = {}) {
  const special = schedule?.specialDates && typeof schedule.specialDates === 'object' ? schedule.specialDates : {};
  if (special[dateKey]?.noClub === true) return false;
  if (Array.isArray(special[dateKey]?.windows) && special[dateKey].windows.length > 0) return true;

  const events = Array.isArray(feed?.events)
    ? feed.events.filter((e) => e && typeof e.date === 'string' && DATE_KEY.test(e.date))
    : [];
  const generated = feed?.generatedAt ? new Date(feed.generatedAt) : null;
  const generatedKey = generated && !Number.isNaN(generated.getTime()) ? zonedParts(generated, timeZone).dateKey : null;
  const lastKey = events.reduce((max, e) => (e.date > max ? e.date : max), '');
  if (events.length && dateKey > lastKey) return false; // past the season
  const covered = events.length > 0 && generatedKey != null && generatedKey <= dateKey;
  if (covered) {
    return events.some((e) => e.date === dateKey && e.kind === 'club' && e.isCancelled !== true);
  }

  const day = Number.isInteger(schedule?.meeting?.day) ? /** @type {number} */ (schedule?.meeting?.day) : DEFAULT_MEETING_DAY;
  return weekday === day;
}

/**
 * Whether `now` is inside tonight's display window, and the key of that
 * window (its date), which the "Hide until the next club night" override is
 * tied to.
 *
 * @param {Date} now
 * @param {{ schedule?: Schedule | null, feed?: Feed | null }} sources
 * @returns {{ inWindow: boolean, windowKey: string | null, dateKey: string, minutes: number }}
 */
export function displayWindow(now, { schedule = null, feed = null } = {}) {
  const timeZone = typeof schedule?.timezone === 'string' && schedule.timezone ? schedule.timezone : DEFAULT_TIMEZONE;
  const { dateKey, weekday, minutes } = zonedParts(now, timeZone);
  const inHours = minutes >= OPEN_AT_MIN && minutes < CLOSE_AT_MIN;
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
 * @returns {string | null}
 */
export function nextClubNight(now, { schedule = null, feed = null } = {}, days = 60) {
  const timeZone = typeof schedule?.timezone === 'string' && schedule.timezone ? schedule.timezone : DEFAULT_TIMEZONE;
  const today = zonedParts(now, timeZone);
  for (let i = 0; i <= days; i++) {
    // Noon UTC steps a whole day at a time with no DST edge to trip on.
    const [y, m, d] = today.dateKey.split('-').map(Number);
    const probe = new Date(Date.UTC(y, m - 1, d + i, 12));
    const key = probe.toISOString().slice(0, 10);
    const weekday = probe.getUTCDay();
    if (i === 0 && today.minutes >= CLOSE_AT_MIN) continue;
    if (isClubNight(key, weekday, { schedule, feed, timeZone })) return key;
  }
  return null;
}

/**
 * Whether today (in the church's zone) is a club night, at any hour: the
 * optional shutdown asks after the 8:00 pm close, which nextClubNight() has
 * already moved past.
 *
 * @param {Date} now
 * @param {{ schedule?: Schedule | null, feed?: Feed | null }} sources
 */
export function clubNightToday(now, { schedule = null, feed = null } = {}) {
  const timeZone = typeof schedule?.timezone === 'string' && schedule.timezone ? schedule.timezone : DEFAULT_TIMEZONE;
  const { dateKey, weekday } = zonedParts(now, timeZone);
  return isClubNight(dateKey, weekday, { schedule, feed, timeZone });
}
