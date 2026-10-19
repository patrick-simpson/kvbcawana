import { useEffect, useRef, useState } from 'react';
import { MIRROR_EARLY_GRACE_MS, MIRROR_OVERRUN_MS, mirrorEarly, mirrorWanted, mirrorWord } from '../lib/ceremonyMirror.js';

const TICK_MS = 5000;
/** While the frame is loaded the clock is read finely, so the early turn-over lands on its second. */
const NEAR_TICK_MS = 250;

/**
 * Test seam (e2e/ceremony-mirror.events.spec.js), read at each use:
 * `window.awanaMirrorTuning = { wanted: true, query: '&now=<ISO>' }` loads the
 * mirror whatever the clock says and time-travels the projector inside it;
 * `early: true` acts as the last ten seconds before the ceremony.
 * @returns {{ wanted?: boolean, query?: string }}
 */
const tuning = () => (typeof window !== 'undefined' && /** @type {any} */ (window).awanaMirrorTuning) || {};

/**
 * The lobby's mirror of the projector during the opening ceremony (rules:
 * lib/ceremonyMirror.js). `mounted`: the hidden frame is loaded; `up`: the
 * mirror says its ceremony is on (or it is the last ten seconds before it,
 * the projector's countdown), so the lobby shows it and holds check-ins.
 * @param {{ schedule: any, showcase: boolean, configure: boolean, settingsPage: boolean, overlay: boolean }} q
 */
export function useCeremonyMirror({ schedule, showcase, configure, settingsPage, overlay }) {
  const frameRef = useRef(/** @type {HTMLIFrameElement | null} */ (null));
  const [now, setNow] = useState(() => new Date());
  const wanted = tuning().wanted === true || mirrorWanted({ schedule, now, showcase, configure, settingsPage, overlay });
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), wanted ? NEAR_TICK_MS : TICK_MS);
    return () => clearInterval(t);
  }, [wanted]);

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

  // Ten seconds early (lib/ceremonyMirror.js mirrorEarly), and held up from
  // then until the projector says its ceremony is on (never longer than the
  // grace): no flicker back to the lobby at 6:00 itself.
  const early = !said && (tuning().early === true || (wanted && mirrorEarly({ schedule, now })));
  const [earlySince, setEarlySince] = useState(0);
  if (early && !earlySince) setEarlySince(now.getTime());
  if (said && earlySince) setEarlySince(0);
  const holding = earlySince > 0 && now.getTime() - earlySince < MIRROR_EARLY_GRACE_MS;
  if (earlySince && !early && !holding) setEarlySince(0);

  const query = typeof tuning().query === 'string' ? tuning().query : '';
  return { mounted, up: mounted && (said || early || holding), frameRef, query };
}
