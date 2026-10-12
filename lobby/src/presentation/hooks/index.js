import { useEffect, useRef, useSyncExternalStore } from 'react';
import { effectiveScheduleConfig, subscribeOverlay } from '../lib/scheduleOverlay.js';

/**
 * Shared window keydown listener with a stable subscription — the
 * handler ref is swapped per render, so callers never re-attach
 * listeners (and never leak them).
 */
export function useKeydown(handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    const listen = (e) => ref.current(e);
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}

/**
 * The schedule config in effect on THIS device: the validated shared
 * schedule.json plus any operator "skip week" overlay entries. Updates
 * live when the QuickNav editor changes the overlay.
 */
export function useEffectiveSchedule() {
  return useSyncExternalStore(subscribeOverlay, effectiveScheduleConfig, effectiveScheduleConfig);
}
