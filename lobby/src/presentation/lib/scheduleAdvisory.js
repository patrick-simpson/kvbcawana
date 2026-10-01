/**
 * Broadcast-driven schedule advisory — an ADVISORY overlay only, never
 * a replacement for shared/schedule.json or the device-local "skip
 * weeks" overlay (scheduleOverlay.js). Sourced from the print server's
 * `schedule` event (contract v3, sanitized by
 * src/lib/eventSanitizers.js sanitizeSchedule): a bare calendar date,
 * an optional public meeting theme, and an optional "no club this
 * week" flag — nothing that could ever hard-break the projector.
 *
 * Every function here is defensive about its `advisory` argument:
 * absent, stale (older than ADVISORY_MAX_AGE_MS), or missing the
 * relevant field is always treated as "say nothing", so a broken or
 * silent calendar feed leaves the projector showing exactly what it
 * would show without this module at all.
 */
import { getNextMeeting } from './schedule.js';
import { localDateKey } from './shared-config.js';

/** A stale broadcast is a no-op, not a lie — the calendar feed only needs to be fresher than this. */
export const ADVISORY_MAX_AGE_MS = 60 * 60 * 1000;

/** @typedef {{ at: Date, nextMeetingDate?: string, title?: string, noClubThisWeek?: boolean }} ScheduleAdvisory */

/** Whether `advisory` exists and is recent enough to act on. */
export function isAdvisoryFresh(advisory, now) {
  return advisory != null && now.getTime() - advisory.at.getTime() < ADVISORY_MAX_AGE_MS;
}

/**
 * `cfg` with the broadcast's `noClubThisWeek` folded in as a
 * `specialDates` entry for the next computed meeting date — the exact
 * shape the device's "Skip Weeks" overlay writes. Never overwrites an
 * existing entry (shared/schedule.json and the device overlay are both
 * canonical; the broadcast only fills a gap they don't already cover),
 * and is a complete no-op when the advisory is absent, stale, or
 * doesn't say `noClubThisWeek`.
 */
export function applyScheduleAdvisory(cfg, advisory, now) {
  if (!isAdvisoryFresh(advisory, now) || advisory.noClubThisWeek !== true) return cfg;
  const nextKey = localDateKey(getNextMeeting(now, cfg));
  if (cfg.specialDates[nextKey]) return cfg;
  return {
    ...cfg,
    specialDates: {
      ...cfg.specialDates,
      [nextKey]: { noClub: true, label: advisory.title || 'No club this week (announced)' },
    },
  };
}

/**
 * The COUNTDOWN target date, corrected by a fresh broadcast
 * `nextMeetingDate` when it disagrees with the locally computed next
 * meeting (e.g. a reschedule the calendar feed already knows about but
 * shared/schedule.json hasn't been updated for yet). Only the calendar
 * DATE is ever taken from the broadcast — the meeting TIME always
 * stays `cfg.meetingStart`, and a corrected date that would already be
 * in the past is refused rather than yanking the countdown backwards.
 */
export function advisedNextMeeting(localTarget, advisory, cfg, now) {
  if (!isAdvisoryFresh(advisory, now) || !advisory.nextMeetingDate) return localTarget;
  if (localDateKey(localTarget) === advisory.nextMeetingDate) return localTarget;

  const m = advisory.nextMeetingDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return localTarget;
  const advised = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  advised.setHours(cfg.meetingStart.hour, cfg.meetingStart.minute, 0, 0);
  if (advised.getTime() <= now.getTime()) return localTarget;
  return advised;
}

/** The advisory's church-authored meeting theme, only when fresh — for display, never for scheduling. */
export function advisoryTitle(advisory, now) {
  return isAdvisoryFresh(advisory, now) ? advisory.title : undefined;
}
