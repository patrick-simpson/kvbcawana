// Is today a club day? (owner 2026-10-13, "build the no club tonight fix": on a
// Monday evening /checkin sat on "Reading the roster..." while the Worker tried
// TwoTimTwo's check-in page anyway, and what that page shows on a day with no
// club is some other meeting, whose list a tap would check a child into.)
//
// THE club-night rule, not a second one: shared/clubNight.js
// (`clubNightToday`, `nextClubNight`), the rule the TVs, the KVBC Awana app and
// the sound room use, given the schedule (shared/schedule.json: its time
// zone, meeting day and `specialDates`, so a `noClub` date is never a club day
// and a special meeting with its own windows is one) and the church calendar
// the Worker keeps (storage `calendar`, read every 6 hours: an extra club
// night it lists is a club day, a cancelled one is not, a date past its last
// event is past the season). A club day is the WHOLE local day, midnight to
// midnight in the church's time zone, not only the watch window: early
// arrivals and set-up work.
//
// Pure, and cheap on the free plan: the answer is kept per (local date,
// calendar read), so a page polling every minute costs one date format.

import schedule from '../../shared/schedule.json' with { type: 'json' };
import { clubNightToday, nextClubNight, zonedParts } from '../../shared/clubNight.js';

/** How far ahead `next` looks for the next club night (a long Christmas break is 3 weeks). */
export const NEXT_LOOKAHEAD_DAYS = 120;
/** The schedule the Worker was built with (the deploy bundles it). */
export const SCHEDULE = schedule;

/** @type {{ key: string, sched: any, value: { club: boolean, today: string, next: string|null } }|null} */
let memo = null;

/**
 * @param {number} nowMs
 * @param {any} feed the calendar the Worker keeps (`{generatedAt, events}`), or null
 * @param {any} [sched] the schedule (tests); default the bundled one
 * @returns {{ club: boolean, today: string, next: string|null }} today and next as YYYY-MM-DD in the church's zone
 */
export function clubDay(nowMs, feed, sched = schedule) {
  const now = new Date(nowMs);
  const zone = typeof sched?.timezone === 'string' && sched.timezone ? sched.timezone : undefined;
  const today = zonedParts(now, zone).dateKey;
  const events = feed && Array.isArray(feed.events) ? feed.events : null;
  const key = `${today}|${feed ? String(feed.generatedAt || '') : '-'}|${events ? events.length : -1}`;
  if (memo && memo.key === key && memo.sched === sched) return memo.value;
  const sources = { schedule: sched, feed: events ? feed : null };
  const club = clubNightToday(now, sources);
  // Today itself is not a club day here, so the first club day the rule finds is the next one.
  const next = club ? today : nextClubNight(now, sources, NEXT_LOOKAHEAD_DAYS, { openMin: 0, closeMin: 24 * 60 });
  const value = { club, today, next };
  memo = { key, sched, value };
  return value;
}
