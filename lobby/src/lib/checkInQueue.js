// @ts-check
// The check-in queue as a pure state machine, so every rule about who is on
// screen, for how long, and what happens when the door gets busy is testable
// without timers. src/hooks/useCheckInQueue.js owns the timers and feeds this
// reducer 'hold-done' / 'gap-done' when they fire.
//
// The rules (owner, 2026-09-27: "when the check-ins are backed up go ahead
// and do the cool animation but don't reduce the number of seconds a kid is
// on screen"):
//   - Every child holds for their FULL configured time: standard, or the
//     longer special hold for a birthday or first-timer. A rush never
//     shortens anyone's moment. (The old burst mode shrank each hold 15% per
//     waiting child, down to a 2.5 s floor; that is gone on purpose.)
//   - A RUN is one continuous stretch with a banner up. When a child's hold
//     ends and another is already waiting, the next child takes over in the
//     same run with no gap, so the wave stays up and only the name flips,
//     scoreboard style. `run` identifies the stretch; `step` counts children
//     within it (0 is the child who raised the wave).
//   - When a hold ends with nobody waiting, the run ends and the banner
//     leaves; a short gap follows before a new arrival starts the next run,
//     so the exit and the next entrance never clip into each other.
//   - While the lobby HOLDS check-ins (a promo poster or a slide marked
//     "Hold check-ins" is up, rebrand stage 4) no new run starts: arrivals
//     wait in order, and the moment the hold lifts they play as one run,
//     each for their full time. A run already on screen is never cut off
//     (the slideshow does not advance while names are up, so a held slide
//     only ever arrives between runs; this is the belt to that brace).

import { DEFAULT_HOLD_MS, MAX_QUEUE } from './constants.js';

/**
 * @typedef {{
 *   id: number, firstName: string, club: string,
 *   isBirthday: boolean, isFirstTimer: boolean, welcomeBack: boolean,
 *   milestone: number | null, presentation: 'live' | 'replay' | 'late',
 * }} QueuedCheckIn
 *
 * @typedef {{
 *   queue: QueuedCheckIn[],
 *   current: QueuedCheckIn | null,
 *   run: number,
 *   step: number,
 *   gap: boolean,
 *   held: boolean,
 * }} QueueState
 *
 * @typedef {{ type: 'enqueue', event: QueuedCheckIn }
 *   | { type: 'hold-done', id: number }
 *   | { type: 'gap-done' }
 *   | { type: 'skip' }
 *   | { type: 'hold', held: boolean }} QueueAction
 */

/** @type {QueueState} */
export const INITIAL_QUEUE_STATE = { queue: [], current: null, run: 0, step: 0, gap: false, held: false };

/** @param {QueueState} state  Start a fresh run with whoever is first in line. */
function startRun(state) {
  const [next, ...rest] = state.queue;
  return next ? { ...state, current: next, queue: rest, run: state.run + 1, step: 0 } : state;
}

/**
 * How long one child's moment holds, in ms. Birthdays and first-timers get
 * the special hold. A missing, zero, negative or non-finite setting falls
 * back to DEFAULT_HOLD_MS so a banner never flashes by or sticks forever.
 * Never depends on how many children are waiting.
 *
 * @param {{ isBirthday?: boolean, isFirstTimer?: boolean } | null | undefined} event
 * @param {{ standardDisplayMs?: number, specialDisplayMs?: number }} config
 */
export function holdMsFor(event, config) {
  const configured = event?.isBirthday || event?.isFirstTimer
    ? config?.specialDisplayMs
    : config?.standardDisplayMs;
  return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_HOLD_MS;
}

/**
 * @param {QueueState} state
 * @param {QueueAction} action
 * @returns {QueueState}
 */
export function checkInQueueReducer(state, action) {
  switch (action.type) {
    case 'enqueue': {
      // Idle, not in the post-run gap and not held: this child raises the
      // wave now.
      if (!state.current && !state.gap && !state.held && state.queue.length === 0) {
        return { ...state, current: action.event, run: state.run + 1, step: 0 };
      }
      // One on screen plus the waiting line never exceeds MAX_QUEUE, against
      // a runaway or duplicated feed. The newest arrivals are the ones kept
      // out, so nobody already promised a moment loses it.
      const room = MAX_QUEUE - (state.current ? 1 : 0);
      if (state.queue.length >= room) return state;
      return { ...state, queue: [...state.queue, action.event] };
    }
    case 'hold-done': {
      // A stale timer for a child who already left (skipped, or replaced).
      if (!state.current || state.current.id !== action.id) return state;
      const [next, ...rest] = state.queue;
      if (next) return { ...state, current: next, queue: rest, step: state.step + 1 };
      return { ...state, current: null, gap: true };
    }
    case 'gap-done': {
      if (!state.gap) return state;
      const open = { ...state, gap: false };
      return open.held ? open : startRun(open);
    }
    case 'hold': {
      const held = action.held === true;
      if (held === state.held) return state;
      const next = { ...state, held };
      // The hold lifted with children waiting and the stage clear: they go
      // now, as one run.
      return !held && !next.current && !next.gap ? startRun(next) : next;
    }
    case 'skip': {
      // The operator (or a crashed banner) dismisses the child on screen:
      // the run ends, and whoever is waiting starts a fresh one after the gap.
      if (!state.current) return state;
      return { ...state, current: null, gap: true };
    }
    default:
      return state;
  }
}
