import { useEffect, useState } from 'react';
import { DEFAULT_SCHEDULE, resolvePhase, sanitizeSchedule } from '../lib/schedule.js';

// Fetch → cache → baked default, in that order. The shared schedule is
// published by the countdown repo's Pages site so all three Awana apps
// read the same program; a display with no network still resolves
// phases from cache or the baked KVBC fallback.
const CACHE_KEY = 'awanaSchedule.v1';
const REFRESH_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 30 * 1000;
// A stable empty table: a fresh {} per render would give the calendar-slides
// memo a new dependency identity every time and restart the slideshow's hold
// timer — the exact bug that memo's comment in App.jsx exists to prevent.
const NO_SPECIAL_DATES = {};

function loadCache() {
  try {
    return sanitizeSchedule(JSON.parse(localStorage.getItem(CACHE_KEY))?.raw);
  } catch {
    return null;
  }
}

function saveCache(raw) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), raw }));
  } catch {
    /* best-effort */
  }
}

/**
 * Returns { phase, schedule, specialDates, source } — phase re-resolves every
 * 30 s so banner styling flips on the program boundaries without a reload.
 *
 * `specialDates` is hoisted out of the schedule (#342) because two consumers
 * need it and neither wants the rest: the calendar slides subtract break weeks
 * from "nights remaining", and resolvePhase already reads it internally to
 * force 'off' on a cancelled night.
 */
export function useSchedule(config) {
  const url = config.sharedScheduleUrl;
  const [state, setState] = useState(() => {
    const cached = loadCache();
    return cached
      ? { schedule: cached, source: 'cache' }
      : { schedule: DEFAULT_SCHEDULE, source: 'default' };
  });
  // Phase is derived, not stored: a 30 s clock tick re-renders and
  // resolvePhase(schedule, now) recomputes — so it also flips
  // immediately when a fresh schedule arrives.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const phase = resolvePhase(state.schedule, now);

  useEffect(() => {
    if (!url) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return;
        const raw = await res.json();
        const clean = sanitizeSchedule(raw);
        if (clean && !cancelled) {
          saveCache(raw);
          setState({ schedule: clean, source: 'shared' });
        }
      } catch {
        /* offline / CORS / bad deploy — cache or default carries on */
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [url]);

  return {
    phase,
    schedule: state.schedule,
    // Always an object, so a caller never has to guard: the baked default and
    // every sanitized schedule both carry one.
    specialDates: state.schedule?.specialDates ?? NO_SPECIAL_DATES,
    source: state.source,
  };
}
