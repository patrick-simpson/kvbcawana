import { useEffect, useRef } from 'react';
import { WATCHDOG_DISCONNECT_MIN, WATCHDOG_MAX_RELOADS_PER_HOUR } from '../lib/constants.js';

const RELOADS_KEY = 'awanaWatchdogReloads.v1';
const CHECK_MS = 60 * 1000;

function recentReloads() {
  try {
    const list = JSON.parse(sessionStorage.getItem(RELOADS_KEY)) || [];
    return list.filter((t) => Number.isFinite(t) && Date.now() - t < 60 * 60 * 1000);
  } catch {
    return [];
  }
}

function recordReload(list) {
  try {
    sessionStorage.setItem(RELOADS_KEY, JSON.stringify([...list, Date.now()]));
  } catch {
    /* storage blocked — the reload still happens, just uncounted */
  }
}

/**
 * Kiosk self-heal: a display that runs unattended for days can wedge in
 * ways no in-app retry fixes (a renderer that leaked, a socket stack
 * that gave up). If the realtime pipe has been continuously down for
 * `watchdogReloadMin` minutes (0 disables), reload the page once —
 * capped at WATCHDOG_MAX_RELOADS_PER_HOUR per hour via a sessionStorage
 * ledger so a genuinely dead network can't put the screen in a reload
 * loop. A display with no Pusher key configured (status 'off') is never
 * reloaded: nothing to heal.
 */
export function useWatchdogReload(status, watchdogReloadMin = WATCHDOG_DISCONNECT_MIN) {
  const downSinceRef = useRef(null);

  useEffect(() => {
    if (status === 'disconnected') {
      downSinceRef.current = downSinceRef.current ?? Date.now();
    } else {
      downSinceRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (!watchdogReloadMin || watchdogReloadMin <= 0) return undefined;
    const timer = setInterval(() => {
      const downSince = downSinceRef.current;
      if (!downSince) return;
      if (Date.now() - downSince < watchdogReloadMin * 60 * 1000) return;
      const list = recentReloads();
      if (list.length >= WATCHDOG_MAX_RELOADS_PER_HOUR) return;
      recordReload(list);
      window.location.reload();
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [watchdogReloadMin]);
}
