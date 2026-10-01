import { useCallback, useEffect, useRef, useState } from 'react';
import { AppMode } from '../types.js';
import { CHURCH } from '../church.config.js';
import { evaluateOverride } from '../lib/watchdog.js';
import { advisedNextMeeting, applyScheduleAdvisory } from '../lib/scheduleAdvisory.js';
import { useEffectiveSchedule } from './useEffectiveSchedule.js';
import {
  getNextMeeting,
  resolveState,
  stateForWindow,
  stateKey,
  windowsForDate,
} from '../lib/schedule.js';

/**
 * Quick-nav target: the live countdown (`{ type: 'countdown' }`) or one
 * schedule window by index (`{ type: 'window', index }`).
 *
 * `scheduleAdvisory` (optional — the sanitized `schedule` broadcast via
 * hooks/useRealtime.js) is folded in as a read-only ADVISORY layer on
 * top of shared/schedule.json + the device overlay: never a
 * replacement, and a complete no-op when omitted, absent, or stale (see
 * lib/scheduleAdvisory.js) — every existing caller and test that omits
 * it keeps today's exact behavior.
 *
 * Returns { state, isOverride, resumeAt, select, resume, stay }:
 * - resumeAt: when the watchdog will hand a window override back to
 *   the schedule (null for countdown overrides — countdown is the
 *   safe default and never times out). Drives the "back to
 *   schedule in Ns" pill.
 * - select: pin the app to a view, ignoring the clock until resume()/watchdog.
 * - resume: return control to the schedule.
 * - stay: operator "Stay" — re-arm the watchdog timeout for another full period.
 */
export function useSchedule(now, scheduleAdvisory = null) {
  const [override, setOverride] = useState(null);

  // Shared schedule.json + this device's "skip week" overlay, plus the
  // broadcast advisory (a no-op layer when there's nothing fresh to say).
  const localCfg = useEffectiveSchedule();
  const cfg = applyScheduleAdvisory(localCfg, scheduleAdvisory, now);

  // A fresh broadcast `nextMeetingDate` can correct the COUNTDOWN
  // target's calendar date (never its configured time) — applied to
  // whatever countdown state is in play, natural or overridden.
  const withAdvisedTarget = (state) =>
    state.mode === AppMode.COUNTDOWN
      ? { ...state, target: advisedNextMeeting(state.target, scheduleAdvisory, cfg, now) }
      : state;

  const natural = withAdvisedTarget(resolveState(now, cfg));
  const naturalKey = stateKey(natural);

  // The clock and natural key the callbacks should capture, without
  // re-creating the callbacks every tick ("latest ref" — written from an
  // effect so render itself never touches the ref).
  const liveRef = useRef({ now, naturalKey });
  useEffect(() => {
    liveRef.current = { now, naturalKey };
  });

  // The window table in effect today (special dates can replace it), so
  // an override index always points into what QuickNav displayed.
  const effectiveWindows = windowsForDate(now, cfg) ?? cfg.windows;

  let state = natural;
  let resumeAt = null;
  let shouldResume = false;

  if (override !== null) {
    if (override.target.type === 'countdown') {
      state = withAdvisedTarget({ mode: AppMode.COUNTDOWN, target: getNextMeeting(now, cfg) });
      // No timeout: countdown is the safe default (this is also the
      // post-shutdown restart path). Resume when the schedule catches up
      // or crosses a boundary underneath us.
      shouldResume = naturalKey === 'countdown' || naturalKey !== override.naturalKeyAtSet;
    } else {
      const index = Math.min(override.target.index, effectiveWindows.length - 1);
      state = stateForWindow(effectiveWindows[index], now);
      const verdict = evaluateOverride({
        overrideKey: stateKey(state),
        naturalKey,
        naturalKeyAtSet: override.naturalKeyAtSet,
        setAt: override.setAt,
        lastStayAt: override.lastStayAt,
        now,
        timeoutMin: CHURCH.watchdog.overrideTimeoutMin,
      });
      resumeAt = verdict.resumeAt;
      shouldResume = verdict.action === 'resume';
    }
  }

  // Render-phase reset (the React-docs "adjust state during render"
  // pattern — no effect, no cascading tick). When the watchdog says
  // resume, the natural state is identical or newer — dropping the
  // override is at most one crossfade.
  if (shouldResume) {
    setOverride(null);
    state = natural;
    resumeAt = null;
  }

  const select = useCallback((target) => {
    const { now: liveNow, naturalKey: liveKey } = liveRef.current;
    setOverride({ target, setAt: liveNow, naturalKeyAtSet: liveKey, lastStayAt: null });
  }, []);

  const resume = useCallback(() => setOverride(null), []);

  const stay = useCallback(() => {
    const { now: liveNow } = liveRef.current;
    setOverride((o) => (o === null ? null : { ...o, lastStayAt: liveNow }));
  }, []);

  return { state, isOverride: override !== null, resumeAt, select, resume, stay };
}
