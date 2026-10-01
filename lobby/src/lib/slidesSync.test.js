import { describe, it, expect } from 'vitest';
import { ASSEMBLY_TIMEOUT_MS, createDeckAssembler, isNewerDeck } from './slidesSync.js';

// The assembler and commit rule carry the whole "every screen shows the same
// deck" promise, so the rare paths — out-of-order chunks, duplicates from a
// rebroadcast racing the original, a printer that lost its state file, a
// replayed old frame — are exactly the ones tested here.

const T0 = Date.parse('2026-09-16T22:12:00.000Z');

/** A sanitized chunk, shaped like sanitizeSlidesChunk's output. */
function chunk(over = {}) {
  return {
    deckRev: 1,
    publishedAt: T0,
    seq: 0,
    total: 1,
    slides: [{ eyebrow: '', text: 'Hello', theme: 'auto', textSize: 'auto', durationSec: 0 }],
    ...over,
  };
}

function slidesNamed(...texts) {
  return texts.map((text) => ({ eyebrow: '', text, theme: 'auto', textSize: 'auto', durationSec: 0 }));
}

describe('createDeckAssembler', () => {
  it('completes a single-chunk deck immediately', () => {
    const a = createDeckAssembler(() => 1000);
    const deck = a.feed(chunk());
    expect(deck).not.toBeNull();
    expect(deck.deckRev).toBe(1);
    expect(deck.publishedAt).toBe(T0);
    expect(deck.slides).toHaveLength(1);
    expect(deck.slides[0].text).toBe('Hello');
  });

  it('completes an EMPTY deck — a cleared deck is a real publish', () => {
    const a = createDeckAssembler(() => 1000);
    const deck = a.feed(chunk({ slides: [] }));
    expect(deck).not.toBeNull();
    expect(deck.slides).toEqual([]);
  });

  it('assembles out-of-order chunks in seq order', () => {
    const a = createDeckAssembler(() => 1000);
    expect(a.feed(chunk({ seq: 2, total: 3, slides: slidesNamed('C') }))).toBeNull();
    expect(a.feed(chunk({ seq: 0, total: 3, slides: slidesNamed('A') }))).toBeNull();
    const deck = a.feed(chunk({ seq: 1, total: 3, slides: slidesNamed('B') }));
    expect(deck.slides.map((s) => s.text)).toEqual(['A', 'B', 'C']);
  });

  it('ignores duplicate seqs (a rebroadcast racing the original)', () => {
    const a = createDeckAssembler(() => 1000);
    expect(a.feed(chunk({ seq: 0, total: 2, slides: slidesNamed('A') }))).toBeNull();
    expect(a.feed(chunk({ seq: 0, total: 2, slides: slidesNamed('A') }))).toBeNull();
    const deck = a.feed(chunk({ seq: 1, total: 2, slides: slidesNamed('B') }));
    expect(deck.slides.map((s) => s.text)).toEqual(['A', 'B']);
  });

  it('keeps interleaved publishes apart (different stamps never mix)', () => {
    const a = createDeckAssembler(() => 1000);
    expect(a.feed(chunk({ publishedAt: T0, deckRev: 4, seq: 0, total: 2, slides: slidesNamed('old-0') }))).toBeNull();
    // A newer publish lands completely while the old one is still partial.
    const fresh = a.feed(chunk({ publishedAt: T0 + 5000, deckRev: 5, seq: 0, total: 1, slides: slidesNamed('new') }));
    expect(fresh.slides[0].text).toBe('new');
    // The old publish can still complete afterwards — the COMMIT rule (not the
    // assembler) is what rejects it as stale.
    const old = a.feed(chunk({ publishedAt: T0, deckRev: 4, seq: 1, total: 2, slides: slidesNamed('old-1') }));
    expect(old.slides.map((s) => s.text)).toEqual(['old-0', 'old-1']);
  });

  it('abandons a partial deck after the timeout — a failed publish cannot wedge the next one', () => {
    let now = 1000;
    const a = createDeckAssembler(() => now);
    expect(a.feed(chunk({ seq: 0, total: 2, slides: slidesNamed('A') }))).toBeNull();
    now += ASSEMBLY_TIMEOUT_MS + 1;
    // The straggler arrives after the window: it starts a NEW group rather
    // than completing the stale one...
    expect(a.feed(chunk({ seq: 1, total: 2, slides: slidesNamed('B') }))).toBeNull();
    // ...so the deck completes only when seq 0 arrives again (the heartbeat).
    const deck = a.feed(chunk({ seq: 0, total: 2, slides: slidesNamed('A') }));
    expect(deck.slides.map((s) => s.text)).toEqual(['A', 'B']);
  });

  it('drops a group whose chunks disagree about total', () => {
    const a = createDeckAssembler(() => 1000);
    expect(a.feed(chunk({ seq: 0, total: 3, slides: slidesNamed('A') }))).toBeNull();
    // Same publish key claims a different total: both sides suspect, start over.
    expect(a.feed(chunk({ seq: 1, total: 2, slides: slidesNamed('B') }))).toBeNull();
    const deck = a.feed(chunk({ seq: 0, total: 2, slides: slidesNamed('A2') }));
    expect(deck.slides.map((s) => s.text)).toEqual(['A2', 'B']);
  });

  it('runs the assembled deck through sanitizeSlides — ids are minted and dupes de-duped', () => {
    const a = createDeckAssembler(() => 1000);
    const deck = a.feed(chunk({
      slides: [
        { id: 'dup', eyebrow: '', text: 'One', theme: 'auto', textSize: 'auto', durationSec: 0 },
        { id: 'dup', eyebrow: '', text: 'Two', theme: 'auto', textSize: 'auto', durationSec: 0 },
      ],
    }));
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0].id).not.toBe(deck.slides[1].id);
    expect(deck.slides.every((s) => typeof s.id === 'string' && s.id)).toBe(true);
  });
});

describe('isNewerDeck — the commit rule', () => {
  const committed = { deckRev: 9, publishedAt: T0, slides: [] };

  it('commits anything when nothing is committed yet', () => {
    expect(isNewerDeck(null, { deckRev: 1, publishedAt: T0 - 99999, slides: [] })).toBe(true);
    expect(isNewerDeck(undefined, { deckRev: 1, publishedAt: 0, slides: [] })).toBe(true);
  });

  it('commits a strictly newer stamp', () => {
    expect(isNewerDeck(committed, { deckRev: 10, publishedAt: T0 + 1, slides: [] })).toBe(true);
  });

  it('ignores an equal stamp — the 5-minute heartbeat is idempotent', () => {
    expect(isNewerDeck(committed, { deckRev: 9, publishedAt: T0, slides: [] })).toBe(false);
  });

  it('ignores an older stamp — an authentic-but-replayed frame cannot roll the deck back', () => {
    expect(isNewerDeck(committed, { deckRev: 9, publishedAt: T0 - 1, slides: [] })).toBe(false);
  });

  it('a printer that lost its state file (rev restarts at 1) still updates the fleet', () => {
    // The whole reason deckRev is NOT the ordering key: this candidate has a
    // LOWER rev but a current stamp, and it must win.
    expect(isNewerDeck(committed, { deckRev: 1, publishedAt: T0 + 60_000, slides: [] })).toBe(true);
  });

  it('never commits garbage', () => {
    expect(isNewerDeck(committed, null)).toBe(false);
    expect(isNewerDeck(committed, {})).toBe(false);
  });
});
