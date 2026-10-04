import { useEffect, useRef } from 'react';
import { WATCHDOG_DISCONNECT_MIN } from '../lib/constants.js';
import { selfReload } from '../lib/reloadLedger.js';

const CHECK_MS = 60 * 1000;

/**
 * Kiosk self-heal: a display that runs unattended for days can wedge in
 * ways no in-app retry fixes (a renderer that leaked, a socket stack
 * that gave up). If the realtime pipe has not been connected for
 * `watchdogReloadMin` minutes (0 disables), reload the page once —
 * capped at WATCHDOG_MAX_RELOADS_PER_HOUR per hour via a sessionStorage
 * ledger so a genuinely dead network can't put the screen in a reload
 * loop. A display with no Pusher key configured (status 'off') is never
 * reloaded: nothing to heal.
 *
 * "Not connected" is anything but 'connected': both transports pass
 * through 'connecting' on every retry, and a screen that could not connect
 * at all used to reset its "down since" stamp on each attempt and never
 * reload. The stamp is set when the status leaves 'connected' and cleared
 * only when it comes back.
 */
export function useWatchdogReload(status, watchdogReloadMin = WATCHDOG_DISCONNECT_MIN) {
  const downSinceRef = useRef(null);

  useEffect(() => {
    if (status === 'connected' || status === 'off') {
      downSinceRef.current = null;
    } else {
      downSinceRef.current = downSinceRef.current ?? Date.now();
    }
  }, [status]);

  useEffect(() => {
    if (!watchdogReloadMin || watchdogReloadMin <= 0) return undefined;
    const timer = setInterval(() => {
      const downSince = downSinceRef.current;
      if (!downSince) return;
      if (Date.now() - downSince < watchdogReloadMin * 60 * 1000) return;
      // The clock starts over: a reload the browser did not carry out is
      // asked for again only after another full stretch, and the hourly cap
      // (shared with the crash boundary, reloadLedger) still bounds it.
      downSinceRef.current = Date.now();
      selfReload();
    }, CHECK_MS);
    return () => clearInterval(timer);
  }, [watchdogReloadMin]);
}
