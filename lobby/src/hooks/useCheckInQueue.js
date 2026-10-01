import { useCallback, useEffect, useReducer, useRef } from 'react';
import { BURST_THRESHOLD } from '../lib/constants.js';
import { checkInQueueReducer, holdMsFor, INITIAL_QUEUE_STATE } from '../lib/checkInQueue.js';
import { RUN_EXIT_MS } from '../lib/checkInMoment.js';

/**
 * FIFO queue for check-in events: one child on screen at a time, each for
 * their full hold (birthdays and first-timers hold longer), nobody's moment
 * skipped or shortened. The rules live in the pure reducer in
 * src/lib/checkInQueue.js; this hook only owns the two timers.
 *
 * During a rush the banner stays up and the next child flips in the moment
 * the previous hold ends (same `run`, next `step`), instead of the wave
 * dropping and rising again for every child.
 */
export { BURST_THRESHOLD };

/**
 * @param {object} config
 * @param {{ held?: boolean }} [lobby]  held: the slide on screen holds
 *   check-ins (a promo poster or a slide marked "Hold check-ins"); arrivals
 *   wait and start one run the moment it lifts.
 */
export function useCheckInQueue(config, { held = false } = {}) {
  const [state, dispatch] = useReducer(checkInQueueReducer, INITIAL_QUEUE_STATE);
  const nextIdRef = useRef(1);
  const { current, gap } = state;

  useEffect(() => {
    dispatch({ type: 'hold', held });
  }, [held]);

  const enqueue = useCallback((payload) => {
    if (!payload || !payload.firstName) return;
    dispatch({
      type: 'enqueue',
      event: {
        id: nextIdRef.current++,
        firstName: payload.firstName,
        club: payload.club || '',
        isBirthday: !!payload.isBirthday,
        isFirstTimer: !!payload.isFirstTimer,
        // Sealed celebration flags (#9/#10) — must survive BOTH allowlists
        // (the sanitizer and this one) or they vanish before the banner.
        welcomeBack: payload.welcomeBack === true,
        milestone: Number.isInteger(payload.milestone) && payload.milestone > 0
          ? payload.milestone : null,
        // 'live' (default) | 'replay' (recap after reconnect) | 'late'
        // (arrived mid-program) — presentation only, never logic.
        presentation: payload.presentation === 'replay' || payload.presentation === 'late'
          ? payload.presentation
          : 'live',
      },
    });
  }, []);

  // One hold timer per child on screen, keyed on the child: a flip to the
  // next child restarts it, so each one gets the whole configured time.
  const hold = holdMsFor(current, config);
  const currentId = current?.id;
  useEffect(() => {
    if (currentId == null) return undefined;
    const t = setTimeout(() => dispatch({ type: 'hold-done', id: currentId }), hold);
    return () => clearTimeout(t);
  }, [currentId, hold]);

  // The short breath between runs, so an exit and the next entrance never
  // clip into each other. Never shorter than the run's own exit: the next
  // run only mounts once the last one has left, and its first child's hold
  // must not tick away while they are not on screen yet. Under zero
  // animation the exit is instant, so the configured gap is the whole wait.
  const configuredGap = Number.isFinite(config.gapBetweenBannersMs) && config.gapBetweenBannersMs >= 0
    ? config.gapBetweenBannersMs
    : 0;
  const gapMs = config.reduceMotion === true ? configuredGap : Math.max(configuredGap, RUN_EXIT_MS);
  useEffect(() => {
    if (!gap) return undefined;
    const t = setTimeout(() => dispatch({ type: 'gap-done' }), gapMs);
    return () => clearTimeout(t);
  }, [gap, gapMs]);

  const skipCurrent = useCallback(() => dispatch({ type: 'skip' }), []);

  return {
    currentEvent: current,
    run: state.run,
    step: state.step,
    enqueue,
    skipCurrent,
    pending: state.queue.length,
    held: state.held,
    // The breath between runs: nobody on screen, but the last run is still
    // leaving (the gap is never shorter than its exit) or the next is about
    // to start. Anything that must not stand on the wave's ground (the
    // first-run card) treats it as "a name is up".
    gap,
  };
}
