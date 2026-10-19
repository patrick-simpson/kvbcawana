import { useEffect, useRef, useState } from 'react';
import { MIRROR_OVERRUN_MS, mirrorWanted, mirrorWord } from '../lib/ceremonyMirror.js';

const TICK_MS = 5000;

/**
 * Test seam (e2e/ceremony-mirror.events.spec.js), read at each use:
 * `window.awanaMirrorTuning = { wanted: true, query: '&now=<ISO>' }` loads the
 * mirror whatever the clock says and time-travels the projector inside it.
 * @returns {{ wanted?: boolean, query?: string }}
 */
const tuning = () => (typeof window !== 'undefined' && /** @type {any} */ (window).awanaMirrorTuning) || {};

/**
 * The lobby's mirror of the projector during the opening ceremony (rules:
 * lib/ceremonyMirror.js). `mounted`: the hidden frame is loaded; `up`: the
 * mirror says its ceremony is on, so the lobby shows it and holds check-ins.
 * @param {{ schedule: any, embedded: boolean, configure: boolean, settingsPage: boolean, overlay: boolean }} q
 */
export function useCeremonyMirror({ schedule, embedded, configure, settingsPage, overlay }) {
  const frameRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(t);
  }, []);
  const wanted = tuning().wanted === true || mirrorWanted({ schedule, now, embedded, configure, settingsPage, overlay });

  const [said, setSaid] = useState(false);
  const [wantedUntil, setWantedUntil] = useState(0);
  if (wanted && wantedUntil < now.getTime()) setWantedUntil(now.getTime());
  // Kept loaded while it still says "ceremony" (a leader holding the opening
  // a little longer), never longer than the overrun.
  const mounted = wanted || (said && now.getTime() - wantedUntil < MIRROR_OVERRUN_MS);
  if (!mounted && said) setSaid(false);

  useEffect(() => {
    if (!mounted) return undefined;
    const onMessage = (event) => {
      const word = mirrorWord(event, frameRef.current?.contentWindow, window.location.origin);
      if (word !== null) setSaid(word);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [mounted]);

  const query = typeof tuning().query === 'string' ? tuning().query : '';
  return { mounted, up: mounted && said, frameRef, query };
}
