import { useSyncExternalStore } from 'react';
import { effectiveScheduleConfig, subscribeOverlay } from '../lib/scheduleOverlay.js';

/**
 * The schedule config in effect on THIS device: the validated shared
 * schedule.json plus any operator "skip week" overlay entries. Updates
 * live when the QuickNav editor changes the overlay.
 */
export function useEffectiveSchedule() {
  return useSyncExternalStore(subscribeOverlay, effectiveScheduleConfig, effectiveScheduleConfig);
}
