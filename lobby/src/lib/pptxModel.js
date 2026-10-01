// ─────────────────────────────────────────────────────────────
// Deck-model orchestration: glues the deck bytes (pptxStore 'decks')
// to the parsed-model cache (pptxStore 'models') so the display only
// re-runs the JSZip/DOM parse when the deck or the parser changed.
//
// Cache validity: a cached record is used iff its parserVersion matches
// PARSER_VERSION (parser upgrades invalidate old models) AND its
// deckSavedAt matches the stored deck's savedAt (re-uploads invalidate
// stale models). Cache writes are best-effort — a blocked IndexedDB
// costs a re-parse per boot, never a failure.
// ─────────────────────────────────────────────────────────────

import { PARSER_VERSION, parsePptxToModel } from './pptxHandler.js';
import { getDeck, getModel, putModel } from './pptxStore.js';

/**
 * The slide model for the deck uploaded on this device: the cached
 * model when it's still valid, else a fresh parse of the stored blob.
 * Throws when there is no stored deck or the blob can't be parsed —
 * the caller (PptxSlideshow) falls back to the embed/placeholder.
 */
export async function getStoredDeckModel() {
  const deck = await getDeck();
  if (!deck) throw new Error('No uploaded deck on this device');

  const cached = await getModel();
  if (
    cached &&
    cached.parserVersion === PARSER_VERSION &&
    cached.deckSavedAt === deck.savedAt &&
    cached.model
  ) {
    return cached.model;
  }

  const model = await parsePptxToModel(deck.blob);
  // Best-effort cache write; putModel never rejects.
  await putModel({ parserVersion: PARSER_VERSION, deckSavedAt: deck.savedAt, model });
  return model;
}

/**
 * Upload path: parse the just-saved blob and cache the model keyed to
 * the deck's savedAt. Returns the model (so the Settings panel can
 * report slide counts); throws only when the blob can't be parsed at
 * all — a failed cache write is swallowed.
 */
export async function parseAndCacheDeck(blob, savedAt) {
  const model = await parsePptxToModel(blob);
  await putModel({ parserVersion: PARSER_VERSION, deckSavedAt: savedAt, model });
  return model;
}
