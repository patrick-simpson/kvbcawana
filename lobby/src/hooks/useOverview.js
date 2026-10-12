// @ts-check
// Mission control's one poll: GET /v1/tonight/overview (routes.md 10.6), every
// 10 s while Tonight is open and the tab visible, every 60 s while hidden, and
// it STOPS after 3 failures in a row (a "Try again" restarts it). Counts,
// codes and station names only: nothing the overview says is a child.

import { useCallback, useEffect, useRef, useState } from 'react';
import { OVERVIEW_MAX_FAILURES, OVERVIEW_POLL_MS, OVERVIEW_SLOW_POLL_MS } from '../lib/missionControl.js';
import { getOverview } from '../lib/workerClient.js';

/**
 * @param {{ enabled: boolean }} opts poll only while Tonight is open and signed in
 * @returns {{ overview: any, error: string, stopped: boolean, loading: boolean, retry: () => void }}
 */
export function useOverview({ enabled }) {
  const [overview, setOverview] = useState(/** @type {any} */ (null));
  const [error, setError] = useState('');
  const [stopped, setStopped] = useState(false);
  const [loading, setLoading] = useState(false);
  const failuresRef = useRef(0);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;
    const visible = () => (typeof document === 'undefined' ? true : document.visibilityState !== 'hidden');
    const tick = async () => {
      if (!live) return;
      setLoading(true);
      const a = await getOverview();
      if (!live) return;
      setLoading(false);
      if (a.ok && a.body && typeof a.body === 'object') {
        failuresRef.current = 0;
        setOverview(a.body);
        setError('');
      } else {
        failuresRef.current += 1;
        setError(a.message);
        if (failuresRef.current >= OVERVIEW_MAX_FAILURES) { setStopped(true); return; }
      }
      timer = setTimeout(tick, visible() ? OVERVIEW_POLL_MS : OVERVIEW_SLOW_POLL_MS);
    };
    // A tab coming back to the front reads at once, rather than waiting out a slow beat.
    const onVisible = () => { if (visible() && failuresRef.current < OVERVIEW_MAX_FAILURES) { clearTimeout(timer); tick(); } };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { live = false; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, round]);

  const retry = useCallback(() => {
    failuresRef.current = 0;
    setStopped(false);
    setError('');
    setRound((n) => n + 1);
  }, []);

  return { overview, error, stopped, loading, retry };
}
