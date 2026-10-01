import { useCallback, useEffect, useRef, useState } from 'react';
import { cornerIds, nextCornerId, snapshotCorner } from '../lib/cornerInfo.js';

/**
 * The corner's one item and its frozen value (src/lib/cornerInfo.js).
 *
 * `advance()` is a slide load: it moves to the next item and snapshots it.
 * App calls it from the typed slideshow's onSlide. A background with no
 * slides we can see (a PowerPoint embed, a video, a lone slide) passes
 * `fallbackMs`, and a timer stands in for the slide loads it cannot report.
 * `onShown(snapshot)` hears every load, whichever path made it (App uses it
 * to spend a tally correction once the corner has carried it).
 *
 * @param {import('../lib/cornerInfo.js').CornerSource} source  read at each load
 * @param {{
 *   fallbackMs?: number | null,
 *   onShown?: (item: import('../lib/cornerInfo.js').CornerSnapshot | null) => void,
 * }} [opts]
 */
export function useCornerItem(source, { fallbackMs = null, onShown } = {}) {
  const latest = useRef({ source, onShown });
  useEffect(() => {
    latest.current = { source, onShown };
  });

  const [item, setItem] = useState(/** @type {import('../lib/cornerInfo.js').CornerSnapshot | null} */ (null));
  const [loads, setLoads] = useState(0);
  // The item on screen, for picking the next one outside a state updater
  // (so the snapshot can be handed to onShown without a side effect inside
  // an updater, which StrictMode would run twice).
  const shown = useRef(/** @type {import('../lib/cornerInfo.js').CornerSnapshot | null} */ (null));

  const advance = useCallback(() => {
    const { source: src, onShown: tell } = latest.current;
    const id = nextCornerId(cornerIds(src), shown.current?.id ?? null);
    const next = id ? snapshotCorner(id, src, Date.now()) : null;
    shown.current = next;
    setItem(next);
    setLoads((n) => n + 1);
    tell?.(next);
  }, []);

  useEffect(() => {
    if (!fallbackMs) return undefined;
    // First load straight away, then one per stand-in "slide".
    const first = setTimeout(advance, 0);
    const every = setInterval(advance, fallbackMs);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [fallbackMs, advance]);

  return { item, advance, loads };
}
