import { useCallback, useRef } from 'react';
import { SEEN_EVENTS_MAX } from '../lib/constants.js';

// Dedupe ledger for checkin event ids: live delivery marks an id seen, a
// re-delivery of the same id is ignored, and recap replay skips anything
// already seen, so a display never double-banners (or double-counts) a kid,
// while one that reconnects can still replay what it missed.
//
// Persisted to LOCALSTORAGE under a day stamp, deliberately the same lifetime
// and the same `todayKey()` shape as useTally.js. It used to be sessionStorage,
// which gave the ledger a SHORTER life than the count it guards: a kiosk
// relaunch kept tonight's number and forgot everyone it had already counted, so
// the next recap replayed the whole window straight back into the total. Two
// facts about the same evening cannot live on two different clocks.
//
// Only opaque producer ids are stored. No names, ever.
const STORAGE_KEY = 'awanaSeenEvents.v1';

function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function loadMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
    // Pruned to the day: yesterday's ledger is not tonight's, and dropping it
    // wholesale is also what keeps the entry from growing forever.
    if (raw && raw.date === todayKey() && Array.isArray(raw.entries)) {
      return new Map(raw.entries.filter(
        (p) => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'number'));
    }
  } catch {
    /* corrupt or blocked storage → start empty */
  }
  return new Map();
}

export function useSeenEvents() {
  const mapRef = useRef(null);
  if (mapRef.current === null) mapRef.current = loadMap();

  const persist = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        date: todayKey(),
        entries: [...mapRef.current],
      }));
    } catch {
      /* best-effort */
    }
  }, []);

  const hasSeen = useCallback((id) => mapRef.current.has(id), []);

  const markSeen = useCallback((id, at = Date.now()) => {
    if (typeof id !== 'string' || !id) return;
    const map = mapRef.current;
    map.set(id, at);
    // Trim oldest insertion first — Map preserves insertion order.
    while (map.size > SEEN_EVENTS_MAX) {
      map.delete(map.keys().next().value);
    }
    persist();
  }, [persist]);

  const stats = useCallback(() => ({ size: mapRef.current.size }), []);

  return { hasSeen, markSeen, stats };
}
