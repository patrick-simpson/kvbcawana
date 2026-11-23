// Backwards Night on a screen (owner 2026-11-23; rules shared/backwards.js,
// the Worker's switch worker/src/theme.js, routes.md 10.22). On the
// presentation isolation allowlist (src/presentation/isolation.test.js).
//
// Signed in, it reads GET /v1/theme once, then follows the doorbell
// `changed {what: 'theme', backwards}` (the answer rides the ring), with a
// slow safety-net read every 10 minutes while visible (the calendar's
// Automatic flips at midnight) and on becoming visible again. `?backwards=1`
// in the address forces it on for this page (a preview); `?backwards=0` off.

import { createContext, useContext, useEffect, useState } from 'react';
import { onSyncDoorbell, syncAuthed, useSync } from './useSync.js';
import { backwardsText } from '../../../shared/backwards.js';

export const BACKWARDS_READ_MS = 10 * 60 * 1000;

/** `?backwards=1|0` on this page's address, else null. */
export function backwardsFlag() {
  try {
    const v = new URLSearchParams(window.location.search).get('backwards');
    return v === '1' ? true : v === '0' ? false : null;
  } catch { return null; }
}

/** @param {{ enabled?: boolean }} [opts] @returns {boolean} */
export function useBackwards({ enabled = true } = {}) {
  const { signedIn } = useSync();
  const [on, setOn] = useState(false);
  const [flag] = useState(backwardsFlag);
  const live = enabled && signedIn && flag === null;

  useEffect(() => {
    if (!live) return undefined;
    let gone = false;
    const read = async () => {
      const res = await syncAuthed('/v1/theme');
      if (!gone && res.ok && res.body && typeof res.body.backwards === 'boolean') setOn(res.body.backwards);
    };
    const first = window.setTimeout(read, 0);
    const off = onSyncDoorbell((what, payload) => {
      if (what !== 'theme') return;
      if (payload && typeof payload.backwards === 'boolean') setOn(payload.backwards);
      else read();
    });
    const tick = window.setInterval(() => { if (!document.hidden) read(); }, BACKWARDS_READ_MS);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      gone = true;
      off();
      window.clearTimeout(first);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live]);

  if (flag !== null) return enabled && flag;
  return live && on;
}

/** Tonight is Backwards Night, for every signage component below App. */
export const BackwardsContext = createContext(false);

/** `bw(text)`: the text spelled backwards on Backwards Night, as it is otherwise. */
export function useBw() {
  const on = useContext(BackwardsContext);
  return on ? backwardsText : (/** @type {<T>(t: T) => T} */ (t) => t);
}
