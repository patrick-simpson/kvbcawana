// @ts-check
// Moved from lobby/desktop/src (KVBC Awana v9, ROADMAP.md#kvbc-awana-one-app); behaviour unchanged.
// Whether the lobby display is on screen, as one pure rule, so the tray's
// overrides and the clock can never disagree about it:
//
//   visible = (inside tonight's window AND not hidden for this window)
//             OR a manual "Show now" that has not yet run out.
//
// - The schedule opens it at this computer's open time and closes it at
//   exactly its close (5:00 and 8:00 pm unless set otherwise).
// - Tray "Hide" during a window hides it until the next club night (it is
//   tied to this window's key, so it lapses on its own).
// - Tray "Show now" shows it for MANUAL_SHOW_MS (three hours) and then it
//   hides itself, so a forgotten one never runs all night; it is not closed
//   at the close, because a person chose it.
// - "Resume schedule" drops both overrides.
'use strict';

const MANUAL_SHOW_MS = 3 * 60 * 60 * 1000;

/**
 * @typedef {{ hiddenForWindow: string | null, manualUntil: number }} Overrides
 */

/** @type {Overrides} */
const NO_OVERRIDES = Object.freeze({ hiddenForWindow: null, manualUntil: 0 });

/**
 * @param {{ inWindow: boolean, windowKey: string | null }} window
 * @param {Overrides} overrides
 * @param {number} nowMs
 * @returns {{ visible: boolean, reason: 'manual' | 'schedule' | 'hidden' | 'off' }}
 */
function decideVisibility(window, overrides, nowMs) {
  if (overrides.manualUntil > nowMs) return { visible: true, reason: 'manual' };
  if (window.inWindow) {
    if (overrides.hiddenForWindow != null && overrides.hiddenForWindow === window.windowKey) {
      return { visible: false, reason: 'hidden' };
    }
    return { visible: true, reason: 'schedule' };
  }
  return { visible: false, reason: 'off' };
}

/**
 * Tray "Show now".
 * @param {Overrides} overrides
 * @param {number} nowMs
 * @returns {Overrides}
 */
function showNow(overrides, nowMs) {
  return { ...overrides, hiddenForWindow: null, manualUntil: nowMs + MANUAL_SHOW_MS };
}

/**
 * Tray "Hide": ends a manual show, and inside a window keeps the display
 * hidden until that window is over.
 * @param {Overrides} _overrides
 * @param {{ inWindow: boolean, windowKey: string | null }} window
 * @returns {Overrides}
 */
function hide(_overrides, window) {
  return { hiddenForWindow: window.inWindow ? window.windowKey : null, manualUntil: 0 };
}

/**
 * Drops overrides that can no longer matter (a hide for a window that has
 * ended, a manual show that has run out), so saved state never grows stale.
 * @param {Overrides} overrides
 * @param {{ inWindow: boolean, windowKey: string | null }} window
 * @param {number} nowMs
 * @returns {Overrides}
 */
function tidy(overrides, window, nowMs) {
  const hiddenForWindow = overrides.hiddenForWindow != null && overrides.hiddenForWindow === window.windowKey
    ? overrides.hiddenForWindow : null;
  const manualUntil = overrides.manualUntil > nowMs ? overrides.manualUntil : 0;
  if (hiddenForWindow === overrides.hiddenForWindow && manualUntil === overrides.manualUntil) return overrides;
  return { hiddenForWindow, manualUntil };
}

module.exports = { MANUAL_SHOW_MS, NO_OVERRIDES, decideVisibility, showNow, hide, tidy };
