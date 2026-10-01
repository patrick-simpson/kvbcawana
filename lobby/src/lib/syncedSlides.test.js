import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SYNCED_SLIDES_STORAGE,
  clearSyncedDeck,
  loadSyncedDeck,
  saveSyncedDeck,
} from './syncedSlides.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';

// The synced deck is feed STATE, not a setting: it must live outside
// awanaConfig.v1 so a ?config= file can never inject a deck (bypassing the
// sealed transport) and a settings export never drags a deck along.

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const DECK = {
  deckRev: 3,
  publishedAt: Date.parse('2026-09-16T22:12:00.000Z'),
  slides: [{ id: 's_1', eyebrow: '', text: 'Hello', theme: 'auto', durationSec: 0, textSize: 'auto' }],
};

describe('cache round-trip', () => {
  it('stores outside awanaConfig.v1', () => {
    expect(SYNCED_SLIDES_STORAGE).not.toBe('awanaConfig.v1');
    saveSyncedDeck(DECK);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(localStorage.getItem(SYNCED_SLIDES_STORAGE)).toBeTruthy();
  });

  it('round-trips a deck, sanitizing slides on the way out', () => {
    saveSyncedDeck(DECK);
    const loaded = loadSyncedDeck();
    expect(loaded.deckRev).toBe(3);
    expect(loaded.publishedAt).toBe(DECK.publishedAt);
    expect(loaded.slides).toHaveLength(1);
    expect(loaded.slides[0].text).toBe('Hello');
  });

  it('an EMPTY deck round-trips — "published empty" is a real value', () => {
    saveSyncedDeck({ ...DECK, slides: [] });
    const loaded = loadSyncedDeck();
    expect(loaded).not.toBeNull();
    expect(loaded.slides).toEqual([]);
  });

  it('returns null for a corrupt or missing cache, never throws', () => {
    expect(loadSyncedDeck()).toBeNull();
    localStorage.setItem(SYNCED_SLIDES_STORAGE, '{not json');
    expect(loadSyncedDeck()).toBeNull();
    localStorage.setItem(SYNCED_SLIDES_STORAGE, JSON.stringify({ deckRev: 0, publishedAt: 'never', slides: [] }));
    expect(loadSyncedDeck()).toBeNull();
  });

  it('clears', () => {
    saveSyncedDeck(DECK);
    clearSyncedDeck();
    expect(loadSyncedDeck()).toBeNull();
  });

  it('survives blocked storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveSyncedDeck(DECK)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadSyncedDeck()).toBeNull();
  });

  it('announces changes in the same tab', () => {
    const seen = vi.fn();
    window.addEventListener('awana-synced-slides-change', seen);
    saveSyncedDeck(DECK);
    clearSyncedDeck();
    expect(seen).toHaveBeenCalledTimes(2);
    window.removeEventListener('awana-synced-slides-change', seen);
  });
});

describe('the deck is not a config key', () => {
  it('a ?config= file cannot inject a synced deck', () => {
    const out = sanitizeOverrides({
      syncedSlides: DECK,
      awanaSyncedSlides: DECK,
      syncedDeck: DECK,
      manualSlides: [{ text: 'legit local deck' }],
    });
    expect(out).not.toHaveProperty('syncedSlides');
    expect(out).not.toHaveProperty('awanaSyncedSlides');
    expect(out).not.toHaveProperty('syncedDeck');
    // manualSlides IS a config key (the local deck) — that stays.
    expect(out.manualSlides[0].text).toBe('legit local deck');
    expect(loadSyncedDeck()).toBeNull();
  });
});
