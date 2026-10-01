import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCalendarHtml, sanitizeEvents, sanitizeFeed } from '../lib/calendarParse.js';
import { MIN_CLUB_EVENTS } from '../lib/constants.js';
import { resolveSyncUrl } from '../lib/syncService.js';
import { onSyncDoorbell, refreshCalendarViaSync, useSync } from './useSync.js';

// Layers of "the screen must never go calendar-blind":
//   0. the sync service's copy (worker/), read from the church page on demand
//      ("Refresh calendar now") and every six hours; public, so a screen not
//      yet signed in still has it
//   1. calendar-feed.json — built nightly by the GitHub Action and
//      shipped with the site (same-origin, no CORS, the normal path)
//   2. best-effort direct fetch of the calendar page (usually
//      CORS-blocked in a browser — accepted; the third-party proxy
//      dependency it replaced was the bigger liability)
//   3. the last good direct scrape, cached in localStorage
// A stale feed still beats an empty screen, so it's the final floor.

const CACHE_KEY = 'awanaCalendar.v1';
const FEED_STALE_MS = 21 * 24 * 60 * 60 * 1000; // Action heartbeats weekly; 3 missed = broken
const RECHECK_MS = 6 * 60 * 60 * 1000;

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const events = sanitizeEvents(JSON.parse(raw)?.events);
    return events.length ? events : null;
  } catch {
    return null;
  }
}

function saveCache(events) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), events }));
  } catch {
    /* localStorage may be blocked; cache is best-effort */
  }
}

async function fetchFeed() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}calendar-feed.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const feed = sanitizeFeed(await res.json());
    return feed.events.length ? feed : null;
  } catch {
    return null;
  }
}

async function fetchSynced(base) {
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/calendar`, { cache: 'no-store' });
    if (!res.ok) return null;
    const raw = await res.json();
    const feed = sanitizeFeed(raw);
    if (!feed.events.length) return null;
    const checkedAt = typeof raw?.checkedAt === 'string' && Number.isFinite(Date.parse(raw.checkedAt)) ? raw.checkedAt : null;
    return { ...feed, checkedAt };
  } catch {
    return null;
  }
}

async function fetchDirect(calendarUrl) {
  if (!calendarUrl) return null;
  try {
    const res = await fetch(calendarUrl);
    if (!res.ok) return null;
    const events = sanitizeEvents(parseCalendarHtml(await res.text()));
    return events.filter((e) => e.kind === 'club').length >= MIN_CLUB_EVENTS ? events : null;
  } catch {
    return null;
  }
}

/**
 * The club-year calendar, from the freshest source available.
 * Returns { events, source, generatedAt, checkedAt, refresh } — events is [] when
 * the feature is off or nothing loads; callers just render no slides.
 */
export function useCalendar(config) {
  const [state, setState] = useState({ events: [], source: 'none', generatedAt: null, checkedAt: null });
  const busy = useRef(/** @type {Promise<string> | null} */ (null));
  const sync = useSync();

  const { calendarEnabled, calendarUrl } = config;

  // Resolves to the source it settled on ('sync', 'feed', 'direct', 'cache',
  // 'none'); a call while one is running waits for that one instead of being
  // silently dropped (which is what made Refresh look dead).
  const load = useCallback(() => {
    if (!calendarEnabled) return Promise.resolve('none');
    if (busy.current) return busy.current;
    busy.current = (async () => {
      const base = sync.url ?? await resolveSyncUrl();
      const synced = await fetchSynced(base);
      const syncedFresh = synced
        && Date.now() - Date.parse(synced.checkedAt || synced.generatedAt || '') < FEED_STALE_MS;
      if (synced && syncedFresh) {
        setState({ events: synced.events, source: 'sync', generatedAt: synced.generatedAt, checkedAt: synced.checkedAt });
        return 'sync';
      }

      const feed = await fetchFeed();
      const feedFresh =
        feed?.generatedAt && Date.now() - Date.parse(feed.generatedAt) < FEED_STALE_MS;
      if (feed && feedFresh) {
        setState({ events: feed.events, source: 'feed', generatedAt: feed.generatedAt, checkedAt: null });
        return 'feed';
      }

      const scraped = await fetchDirect(calendarUrl);
      if (scraped) {
        saveCache(scraped);
        setState({ events: scraped, source: 'direct', generatedAt: new Date().toISOString(), checkedAt: null });
        return 'direct';
      }

      const cached = loadCache();
      if (cached) {
        setState({ events: cached, source: 'cache', generatedAt: null, checkedAt: null });
        return 'cache';
      }

      // Stale, but real data — far better than a blank club night.
      if (synced) {
        setState({ events: synced.events, source: 'sync', generatedAt: synced.generatedAt, checkedAt: synced.checkedAt });
        return 'sync';
      }
      if (feed) {
        setState({ events: feed.events, source: 'feed', generatedAt: feed.generatedAt, checkedAt: null });
        return 'feed';
      }
      return 'none';
    })().finally(() => { busy.current = null; });
    return busy.current;
  }, [calendarEnabled, calendarUrl, sync.url]);

  useEffect(() => {
    if (!calendarEnabled) return undefined;
    load();
    const timer = setInterval(load, RECHECK_MS);
    // The sync service rings when the church calendar changed.
    const off = onSyncDoorbell((what) => { if (what === 'calendar') load(); });
    return () => { clearInterval(timer); off(); };
  }, [calendarEnabled, load]);

  /**
   * "Refresh calendar now": signed in to the sync service, it reads the
   * church page right now (and every screen follows); otherwise it re-reads
   * the copies this screen can reach. Resolves to what happened, in words
   * Settings can show.
   * @returns {Promise<{ok: boolean, changed?: boolean, message?: string, source: string}>}
   */
  const refresh = useCallback(async () => {
    let remote = await refreshCalendarViaSync();
    if (!remote.ok && remote.message === 'not-signed-in') remote = null;
    const source = await load();
    if (remote && !remote.ok) return { ok: false, message: remote.message, source };
    return { ok: true, changed: remote ? Boolean(remote.changed) : undefined, viaSync: Boolean(remote), source };
  }, [load]);

  // Disabled → an empty view of whatever was loaded, without touching
  // state from inside an effect.
  if (!calendarEnabled) {
    return { events: [], source: 'none', generatedAt: null, checkedAt: null, refresh };
  }
  return { ...state, refresh };
}
