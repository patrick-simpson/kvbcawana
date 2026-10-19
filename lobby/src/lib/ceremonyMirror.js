// The lobby mirrors the game time projector during the opening ceremony
// (owner 2026-10-19: "From 6 to 6:05 I want the lobby screen to replicate the
// games projector screen as well. Once the t&t games slide starts the lobby
// should animate back"; "During that time all check in kids names should be
// paused"; held names play after). Pure rules; the hook is
// hooks/useCeremonyMirror.js.
//
// The lobby loads the projector page itself (countdown.html?mirror=1) in a
// hidden frame a little before the ceremony: silent, no menus, never a
// registered screen. The mirror follows the gym projector's slide
// announcements (slide-go) and backups on the live channel, and tells this
// page, by one message, when its ceremony starts and ends, so the lobby turns
// over to it to the second and comes back when T&T game time starts (or the
// gym starts games early).
import { resolvePhase } from './schedule.js';

/** The mirror's message (presentation/App.jsx MIRROR_MESSAGE, the same string; embed.test.js pins both). */
export const MIRROR_MESSAGE = 'awana-display:projector-mirror';
/** The hidden frame loads this long before the ceremony, so 6:00 is not a page load. */
export const MIRROR_PRELOAD_MS = 2 * 60 * 1000;
/** A mirror still saying "ceremony" this long after the schedule's ceremony ended is let go anyway. */
export const MIRROR_OVERRUN_MS = 20 * 60 * 1000;

/**
 * Whether the hidden mirror should be loaded now: in the ceremony, or within
 * MIRROR_PRELOAD_MS of it, on a club night the shared schedule knows. Never
 * in an embedded lobby (Journey's check-in display, the classroom's frame),
 * the configure or settings page, or an OBS overlay feed.
 * @param {{ schedule: any, now: Date, embedded?: boolean, configure?: boolean, settingsPage?: boolean, overlay?: boolean }} q
 */
export function mirrorWanted({ schedule, now, embedded = false, configure = false, settingsPage = false, overlay = false }) {
  if (embedded || configure || settingsPage || overlay) return false;
  return resolvePhase(schedule, now) === 'ceremony'
    || resolvePhase(schedule, new Date(now.getTime() + MIRROR_PRELOAD_MS)) === 'ceremony';
}

/**
 * The mirror's word from a message event, or null when the message is not
 * the mirror's: it must come from our own frame, at our own origin.
 * @param {MessageEvent} event
 * @param {Window | null | undefined} frame
 * @param {string} origin
 * @returns {boolean | null} true = the ceremony is on the wall
 */
export function mirrorWord(event, frame, origin) {
  if (!frame || event.source !== frame || event.origin !== origin) return null;
  const d = /** @type {any} */ (event.data);
  if (!d || d.type !== MIRROR_MESSAGE || typeof d.ceremony !== 'boolean') return null;
  return d.ceremony;
}
