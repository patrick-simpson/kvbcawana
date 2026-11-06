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

// ── Taps that could not be sent (owner 2026-11-06: "don't lose taps") ─────

/** The first wait before a tap that did not get through is sent again; it doubles to RETRY_MAX_MS. */
export const RETRY_MIN_MS = 1000;
export const RETRY_MAX_MS = 8000;
/** At most this many taps wait on the phone (a whole game's worth). */
export const OUTBOX_MAX = 200;

/**
 * A tap that should be sent again: it never got there or the answer was lost
 * (status 0), or the service was busy or down (429, 5xx). Its id makes a
 * second arrival count once (worker/src/scoreboard.js). A 4xx refusal is final.
 * @param {number} status
 */
export function retryable(status) {
  return status === 0 || status === 429 || status >= 500;
}

/** The wait after one more failure. @param {number} ms */
export function nextRetryMs(ms) {
  return Math.min(RETRY_MAX_MS, Math.max(RETRY_MIN_MS, ms * 2));
}

/** The status line while taps wait. @param {number} n */
export function waitingWords(n) {
  return n === 1 ? '1 tap waiting to send · still trying' : `${n} taps waiting to send · still trying`;
}

/**
 * A tap's id (8-40 of A-Za-z0-9_-; worker/src/scoreboard.js TAP_ID).
 * @param {() => string} [uuid]
 */
export function newTapId(uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : '')) {
  const id = uuid();
  if (/^[A-Za-z0-9_-]{8,40}$/.test(id)) return id;
  let out = '';
  while (out.length < 20) out += Math.random().toString(36).slice(2);
  return `t${out.slice(0, 20)}`;
}
