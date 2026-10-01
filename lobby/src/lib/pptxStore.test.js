import { describe, it, expect } from 'vitest';
import { deleteDeck, deleteModel, getDeck, getModel, putDeck, putModel } from './pptxStore.js';

// jsdom has no indexedDB global, which conveniently doubles as the
// "browser with IndexedDB blocked" case. The contract under test:
// every pptxStore call degrades gracefully — reads resolve null,
// writes/deletes resolve false — and nothing EVER rejects, so a
// storage problem can never take the slideshow down.
describe('pptxStore without IndexedDB available', () => {
  it('getDeck resolves null instead of rejecting', async () => {
    await expect(getDeck()).resolves.toBeNull();
  });

  it('putDeck resolves false instead of rejecting', async () => {
    await expect(putDeck(new Blob(['x']), 'deck.pptx')).resolves.toBe(false);
  });

  it('deleteDeck resolves false instead of rejecting', async () => {
    await expect(deleteDeck()).resolves.toBe(false);
  });

  it('getModel resolves null instead of rejecting', async () => {
    await expect(getModel()).resolves.toBeNull();
  });

  it('putModel resolves false instead of rejecting', async () => {
    await expect(putModel({ parserVersion: 2, deckSavedAt: 1, model: { slides: [] } })).resolves.toBe(false);
  });

  it('deleteModel resolves false instead of rejecting', async () => {
    await expect(deleteModel()).resolves.toBe(false);
  });
});
