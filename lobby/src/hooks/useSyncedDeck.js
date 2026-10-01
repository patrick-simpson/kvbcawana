// The synced slide deck: feed sealed-and-sanitized `slides` chunks in, get the
// committed deck out. Chunk reassembly and the strictly-newer commit rule live
// in the pure src/lib/slidesSync.js; this hook only owns React state and the
// localStorage cache, so a screen that reboots renders its last deck at boot
// with zero network.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDeckAssembler, isNewerDeck } from '../lib/slidesSync.js';
import {
  SYNCED_SLIDES_CHANGE_EVENT,
  SYNCED_SLIDES_STORAGE,
  clearSyncedDeck,
  loadSyncedDeck,
  saveSyncedDeck,
} from '../lib/syncedSlides.js';

export function useSyncedDeck() {
  const [deck, setDeck] = useState(loadSyncedDeck);
  const deckRef = useRef(deck);
  useEffect(() => { deckRef.current = deck; }, [deck]);

  const assemblerRef = useRef(null);
  if (assemblerRef.current == null) { assemblerRef.current = createDeckAssembler(); }

  // Other tabs (the `storage` event) and this tab's own Settings actions both
  // announce cache changes; reload but keep the object identity stable when
  // nothing actually changed, so a no-op event can't re-key the slideshow.
  useEffect(() => {
    const reload = () => {
      const next = loadSyncedDeck();
      setDeck((prev) => (prev?.publishedAt === next?.publishedAt ? prev : next));
    };
    const onStorage = (e) => { if (e.key === SYNCED_SLIDES_STORAGE) reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(SYNCED_SLIDES_CHANGE_EVENT, reload);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(SYNCED_SLIDES_CHANGE_EVENT, reload);
    };
  }, []);

  /** Socket handler for sanitized `slides` chunks. */
  const onSlides = useCallback((chunk) => {
    const completed = assemblerRef.current.feed(chunk);
    if (!completed) return;                              // waiting on more chunks
    if (!isNewerDeck(deckRef.current, completed)) return; // heartbeat dup / stale replay
    deckRef.current = completed;
    saveSyncedDeck(completed);
    setDeck(completed);
  }, []);

  // The recovery lever (Settings → "Forget received deck"): clears the cache
  // and the committed stamp, so the next broadcast — whatever its stamp —
  // commits fresh. Needed only for the pathological publisher-clock-rollback
  // case, and to stop showing a deck from a printer that is gone for good.
  const forget = useCallback(() => {
    clearSyncedDeck();
    deckRef.current = null;
    setDeck(null);
  }, []);

  return { deck, onSlides, forget };
}
