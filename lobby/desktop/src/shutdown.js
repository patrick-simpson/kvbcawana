// @ts-check
// The optional club-night shutdown (owner, 2026-10-07): off until someone
// turns it on in the configurator, and then only on a club night, at the time
// set there, after a two-minute warning that can cancel it. Pure, like the
// rest of src/: main.js hands it the clock (in the church's zone) and what it
// remembers.
//
// It never shuts a PC down that was not already running before the warning
// was due: a PC switched on at 8:20, or woken from sleep after the time, is
// left alone. `armedFor` is that memory, the date on which the app saw a
// minute before the warning; it lives in memory only, so a restart during the
// warning disarms it too.

export const WARNING_MS = 2 * 60 * 1000;
const WARNING_MIN = WARNING_MS / 60_000;
// The least warning anyone gets, even when the minute tick lands late (a busy
// PC, a resume from sleep inside the window).
export const MIN_WARNING_MS = 60 * 1000;

/** @typedef {{ enabled: boolean, atMin: number }} ShutdownSettings */

/**
 * What to do this minute.
 * - 'idle': nothing;
 * - 'arm': earlier than the warning on a club night: remember the date;
 * - 'warn': the warning is due (or running) and was armed today.
 *
 * @param {ShutdownSettings} settings
 * @param {{ dateKey: string, minutes: number, clubNight: boolean, armedFor: string | null, cancelledFor: string | null }} now
 * @returns {'idle' | 'arm' | 'warn'}
 */
export function shutdownStep({ enabled, atMin }, { dateKey, minutes, clubNight, armedFor, cancelledFor }) {
  if (!enabled || !clubNight || cancelledFor === dateKey) return 'idle';
  const warnAt = atMin - WARNING_MIN;
  if (minutes < warnAt) return 'arm';
  // One minute of grace past the time itself, for a late tick; later than
  // that (asleep through it) the night's chance has passed.
  if (armedFor === dateKey && minutes <= atMin) return 'warn';
  return 'idle';
}

/**
 * When the PC goes down: the start of the set minute, but never sooner than
 * MIN_WARNING_MS from now.
 *
 * @param {number} nowMs
 * @param {number} minutes  the church-zone minute of the day at nowMs
 * @param {number} atMin
 */
export function shutdownDeadline(nowMs, minutes, atMin) {
  const intoMinute = nowMs % 60_000;
  const boundary = nowMs - intoMinute + (atMin - minutes) * 60_000;
  return Math.max(boundary, nowMs + MIN_WARNING_MS);
}
