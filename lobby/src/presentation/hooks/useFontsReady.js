import { useEffect, useState } from 'react';

/**
 * Re-render whenever the page finishes loading web fonts, so anything that
 * measures its own text (the stepped chip) gets a second pass with the real
 * face instead of the fallback it measured on first render. `fonts.ready`
 * covers a load already under way; `loadingdone` covers a face the browser
 * only starts fetching later (a chip is often the first thing on screen to
 * use Paytone One). The projector's own copy of the lobby's hook, which the
 * isolation rule keeps out of reach.
 * @returns {number} how many font loads have finished since mount
 */
export function useFontsReady() {
  const [loads, setLoads] = useState(0);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return undefined;
    let alive = true;
    const bump = () => { if (alive) setLoads((n) => n + 1); };
    if (fonts.status !== 'loaded') fonts.ready.then(bump, () => {});
    fonts.addEventListener?.('loadingdone', bump);
    return () => {
      alive = false;
      fonts.removeEventListener?.('loadingdone', bump);
    };
  }, []);
  return loads;
}
