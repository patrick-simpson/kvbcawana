// The scoreboard phone page's pure words and numbers (tested in logic.test.js).
// The rules themselves are shared/scoreboard.js, one copy with the Worker and
// the projector.

import { SCORE_ALL_TEAMS, TIMER_MAX_MS, gameClockWords } from '../../../shared/scoreboard.js';

/** The phone's field behind everything, per club (owner 2026-11-05: "Deep club shade"). */
export const CLUB_FIELDS = Object.freeze({
  tnt: '#1F5E35',
  sparks: '#7E1D23',
  cubbies: '#1A2A4F',
  none: '#1B1E26',
});

/** Two taps within this to End the game, or to switch away from a club with points. */
export const CONFIRM_MS = 4000;
/** The timer stepper's step. */
export const TIMER_STEP_S = 15;
/** The shortest timer the stepper sets. */
export const TIMER_MIN_S = 15;

/**
 * The scores to draw: the board's, plus this phone's taps still on their way
 * (shown at once; the Worker's answer replaces them).
 * @param {any} board @param {string|null} club @param {Record<string, number>} pending
 */
export function shownScores(board, club, pending) {
  const base = board && club ? board.scores[club] : null;
  const out = {};
  for (const t of SCORE_ALL_TEAMS) out[t] = Math.max(0, (base ? base[t] : 0) + (pending[t] || 0));
  return out;
}

/** The game clock line (shared/scoreboard.js, one copy with the lobby's score bar). */
export { gameClockWords };

/** The timer stepper: seconds moved by one step, kept 15 s to 60 min. @param {number} secs @param {1|-1} dir */
export function stepTimer(secs, dir) {
  const next = secs + dir * TIMER_STEP_S;
  return Math.max(TIMER_MIN_S, Math.min(TIMER_MAX_MS / 1000, next));
}

/** Seconds as m:ss. @param {number} secs */
export function mmss(secs) {
  const s = Math.max(0, Math.round(secs));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The sheet's buttons for the clock as it is, for the kind on show.
 * @param {null | {kind: string, running: boolean, done: boolean}} reading  null = no clock
 * @param {'stopwatch'|'timer'} kind
 * @returns {{go: string, goOp: 'start'|'pause'|'resume', reset: string, resetShown: boolean, setting: boolean}}
 */
export function sheetButtons(reading, kind) {
  if (!reading || reading.kind !== kind) {
    return { go: kind === 'timer' ? 'Start timer' : 'Start', goOp: 'start', reset: 'Reset', resetShown: false, setting: kind === 'timer' };
  }
  if (reading.done) return { go: 'Start again', goOp: 'start', reset: 'Clear', resetShown: true, setting: true };
  if (reading.running) return { go: 'Pause', goOp: 'pause', reset: kind === 'timer' ? 'Cancel' : 'Reset', resetShown: true, setting: false };
  return { go: 'Resume', goOp: 'resume', reset: kind === 'timer' ? 'Cancel' : 'Reset', resetShown: true, setting: false };
}

/** The status line's words for the live link. @param {'ok'|'poll'|'off'|'wait'} state */
export function liveWords(state) {
  return {
    ok: '● Live on the projector',
    poll: 'Connected · updating',
    off: 'Offline: taps will not reach the projector',
    wait: 'Connecting…',
  }[state] || 'Connecting…';
}
