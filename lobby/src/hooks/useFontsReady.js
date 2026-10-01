import { useEffect, useState } from 'react';

/**
 * Re-render whenever the page finishes loading web fonts. Anything that
 * measures text to size itself (the stepped chip does) measured the
 * fallback face on its first render; this gives it another pass with the
 * real one. Both signals matter: `fonts.ready` covers a load already under
 * way at mount, and `loadingdone` covers a face the browser only starts
 * fetching later (a chip is often the first thing on screen to use
 * Paytone One, so its own text is what kicks that load off). No document.fonts
 * (tests, very old browsers) means no second pass, which the chip's own
 * textLength pin already copes with.
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
