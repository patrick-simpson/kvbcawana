// @ts-check
// The trends back-fill's status (GET /v1/history/import-status, routes.md
// section 3), asked gently: once when the History section opens, then every
// 60 s while it stays open AND the tab is visible. A hidden tab asks nothing;
// coming back to the front asks at once if a minute has passed since the last
// ask. A Worker without the route (404) is not asked again.

import { useEffect, useState } from 'react';
import { IMPORT_STATUS_POLL_MS, fetchImportStatus } from '../lib/trendsClient.js';

/**
 * @param {{ enabled: boolean }} opts ask only while the section is open and signed in
 * @returns {import('../lib/trendsClient.js').ImportStatus | null} the last good answer
 */
export function useImportStatus({ enabled }) {
  const [status, setStatus] = useState(/** @type {import('../lib/trendsClient.js').ImportStatus | null} */ (null));

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    let inFlight = false;
    let stopped = false;
    let lastStart = -Infinity;
    const visible = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden');
    const tick = async () => {
      clearTimeout(timer);
      timer = undefined;
      if (!live || inFlight || stopped || !visible()) return;
      inFlight = true;
      lastStart = Date.now();
      const a = await fetchImportStatus();
      inFlight = false;
      if (!live) return;
      if (a.ok) setStatus(a.status);
      else if (a.missing) { stopped = true; return; }
      if (visible()) timer = setTimeout(tick, IMPORT_STATUS_POLL_MS);
    };
    const onVisibility = () => {
      if (!visible()) { clearTimeout(timer); timer = undefined; return; }
      if (inFlight || stopped || timer !== undefined) return;
      const wait = IMPORT_STATUS_POLL_MS - (Date.now() - lastStart);
      if (wait <= 0) tick(); else timer = setTimeout(tick, wait);
    };
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisibility); };
  }, [enabled]);

  return status;
}
