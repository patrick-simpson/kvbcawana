// @ts-check
/**
 * Pure schedule engine — every function is a function of `now` (and an
 * explicit config, defaulting to the shared one). No memoized dates, no
 * module state: callers re-evaluate each tick, so the app can never
 * hold a stale target or fight its own scheduler.
 */
import { AppMode } from '../types.js';
import { SCHEDULE_CONFIG, localDateKey } from './shared-config.js';

/** @typedef {import('../types.js').ScheduleWindow} ScheduleWindow */
/** @typedef {import('../types.js').AppState} AppState */
/** @typedef {import('../types.js').ScheduleConfig} ScheduleConfig */

/** @param {Date} d */
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

/**
 * The window table in effect on `now`'s calendar date, or null when no
 * meeting runs that date. A dated special entry wins over the weekday
 * rule: `noClub` cancels the night, a replacement table reshapes it
 * (and applies even on a non-meeting weekday).
 * @param {Date} now
 * @param {ScheduleConfig} [cfg]
 * @returns {ScheduleWindow[] | null}
 */
export function windowsForDate(now, cfg = SCHEDULE_CONFIG) {
  const special = cfg.specialDates[localDateKey(now)];
  // The validator guarantees a non-noClub special always carries a
  // replacement table; `?? null` keeps the type honest regardless.
  if (special) return special.noClub === true ? null : (special.windows ?? null);
  return now.getDay() === cfg.meetingDay ? cfg.windows : null;
}

/**
 * The schedule only applies on meeting dates; every other moment is COUNTDOWN.
 * @param {Date} now
 * @param {ScheduleConfig} [cfg]
 * @returns {ScheduleWindow | null}
 */
export function findWindow(now, cfg = SCHEDULE_CONFIG) {
  const windows = windowsForDate(now, cfg);
  if (!windows) return null;
  const mins = minutesOfDay(now);
  return windows.find((w) => mins >= w.startMin && mins < w.endMin) ?? null;
}

/**
 * A window's end as a Date anchored to `now`'s own calendar day.
 * @param {ScheduleWindow} window
 * @param {Date} now
 * @returns {Date}
 */
export function windowEnd(window, now) {
  const end = new Date(now);
  end.setHours(Math.floor(window.endMin / 60), window.endMin % 60, 0, 0);
  return end;
}

/**
 * Next meeting (Wednesday 6:00 PM), local wall clock. Pure date-part
 * arithmetic (setHours/setDate), so DST transitions and month/year
 * rollovers keep the meeting at 18:00 local. At exactly 18:00 Wednesday
 * the answer is next week's meeting — the schedule window owns the
 * current moment. Weeks cancelled via `specialDates[...].noClub` are
 * skipped (bounded walk, ~one year).
 * @param {Date} now
 * @param {ScheduleConfig} [cfg]
 * @returns {Date}
 */
export function getNextMeeting(now, cfg = SCHEDULE_CONFIG) {
  const target = new Date(now);
  target.setHours(cfg.meetingStart.hour, cfg.meetingStart.minute, 0, 0);
  let daysUntil = (cfg.meetingDay - now.getDay() + 7) % 7;
  if (daysUntil === 0 && target.getTime() <= now.getTime()) daysUntil = 7;
  target.setDate(now.getDate() + daysUntil);

  for (let i = 0; i < 53; i++) {
    const special = cfg.specialDates[localDateKey(target)];
    if (!special || special.noClub !== true) return target;
    target.setDate(target.getDate() + 7);
  }
  return target;
}

/**
 * @param {ScheduleWindow} window
 * @param {Date} now
 * @returns {AppState}
 */
export function stateForWindow(window, now) {
  switch (window.kind) {
    case 'slideshow':
      return { mode: AppMode.SLIDESHOW, deck: window.deck, window };
    case 'game':
      return { mode: AppMode.GAME_TIME, window, endsAt: windowEnd(window, now) };
    case 'shutdown':
      return { mode: AppMode.SHUTDOWN, window };
  }
}

/**
 * @param {Date} now
 * @param {ScheduleConfig} [cfg]
 * @returns {AppState}
 */
export function resolveState(now, cfg = SCHEDULE_CONFIG) {
  const window = findWindow(now, cfg);
  if (!window) return { mode: AppMode.COUNTDOWN, target: getNextMeeting(now, cfg) };
  return stateForWindow(window, now);
}

/**
 * Whole seconds until `target`, clamped at 0.
 * @param {Date} target
 * @param {Date} now
 * @returns {number}
 */
export function secondsUntil(target, now) {
  return Math.max(0, Math.floor((target.getTime() - now.getTime()) / 1000));
}

/**
 * Stable identity for a resolved state, for keying view transitions.
 * @param {AppState} state
 * @returns {string}
 */
export function stateKey(state) {
  switch (state.mode) {
    case AppMode.COUNTDOWN:
      return 'countdown';
    case AppMode.SLIDESHOW:
      return `slideshow:${state.deck}`;
    case AppMode.GAME_TIME:
      return `game:${state.window.title}`;
    case AppMode.SHUTDOWN:
      return 'shutdown';
  }
}
