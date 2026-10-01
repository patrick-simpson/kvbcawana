// @ts-check
// Pure machinery for the synced slide deck — chunk reassembly and the commit
// rule. No React, no storage, no clock of its own (injected for tests), so
// every ordering edge can be tested exhaustively.
//
// The wire unit is one sanitized `slides` chunk (see sanitizeSlidesChunk):
// { deckRev, publishedAt, seq, total, slides }. All chunks of one publish
// share {deckRev, publishedAt} byte-for-byte, including on the print server's
// ~5-minute rebroadcasts.
//
// THE COMMIT RULE — publishedAt, strictly newer, and nothing else.
//
// deckRev looks like the obvious ordering key and must never be used as one:
// it is an operator-facing counter persisted in the print server's data
// folder, and a disk wipe or reinstall restarts it at 1. If displays ordered
// by rev, a printer that lost its state file could NEVER update the fleet
// again — every new publish would look older than the committed deck. Ordering
// by wall-clock publishedAt makes that recovery automatic (the fresh publish
// has a current timestamp), makes rebroadcasts idempotent (equal stamp →
// ignored), and makes replaying a captured old frame useless (older stamp →
// ignored; GCM+AAD already guarantees the frame is authentic, this guards
// against it being STALE).

import { sanitizeSlides } from './slides.js';

/** A partial deck older than this is abandoned — its publish failed midway. */
export const ASSEMBLY_TIMEOUT_MS = 30 * 1000;

/** Concurrent partial groups kept; beyond this the stalest is evicted. */
const MAX_GROUPS = 8;

/**
 * @typedef {{deckRev: number, publishedAt: number, slides: Array<object>}} SyncedDeck
 */

/**
 * Create a chunk assembler. Feed it sanitized chunks; it returns a completed
 * deck when the last piece of a publish arrives, else null.
 *
 * @param {() => number} [now] Clock, injectable for tests.
 */
export function createDeckAssembler(now = () => Date.now()) {
  /** @type {Map<string, {total: number, parts: Map<number, Array<object>>, lastAt: number, deckRev: number, publishedAt: number}>} */
  const groups = new Map();

  /** @param {number} t */
  function purge(t) {
    for (const [key, group] of groups) {
      if (t - group.lastAt > ASSEMBLY_TIMEOUT_MS) groups.delete(key);
    }
    while (groups.size > MAX_GROUPS) {
      let stalestKey = null;
      let stalestAt = Infinity;
      for (const [key, group] of groups) {
        if (group.lastAt < stalestAt) { stalestAt = group.lastAt; stalestKey = key; }
      }
      if (stalestKey === null) break;
      groups.delete(stalestKey);
    }
  }

  return {
    /**
     * @param {import('./eventSanitizers.js').SlidesChunkEvent} chunk Sanitized.
     * @returns {SyncedDeck | null} The completed deck, or null.
     */
    feed(chunk) {
      if (!chunk || typeof chunk !== 'object') return null;
      const t = now();
      purge(t);
      const key = `${chunk.publishedAt}:${chunk.deckRev}`;
      let group = groups.get(key);
      // A total that disagrees with the group's makes BOTH sides suspect —
      // drop the group and start over from this chunk rather than guessing.
      if (group && group.total !== chunk.total) {
        groups.delete(key);
        group = undefined;
      }
      if (!group) {
        group = {
          total: chunk.total,
          parts: new Map(),
          lastAt: t,
          deckRev: chunk.deckRev,
          publishedAt: chunk.publishedAt,
        };
        groups.set(key, group);
      }
      group.lastAt = t;
      // Duplicate seq (a rebroadcast racing the original): first one wins;
      // the chunks of one publish are byte-identical anyway.
      if (!group.parts.has(chunk.seq)) group.parts.set(chunk.seq, chunk.slides);
      if (group.parts.size < group.total) return null;

      groups.delete(key);
      /** @type {Array<object>} */
      const all = [];
      for (let seq = 0; seq < group.total; seq++) {
        const part = group.parts.get(seq);
        if (!part) return null;   // unreachable (size===total), belt and braces
        all.push(...part);
      }
      // Final gate: the SAME sanitizer the local editor's decks go through —
      // dedupes ids, enforces MAX_SLIDES, drops anything malformed. Defence in
      // depth on well-tested code, and it keeps "a deck is a deck" true no
      // matter which door it came in through.
      return { deckRev: group.deckRev, publishedAt: group.publishedAt, slides: sanitizeSlides(all) };
    },
  };
}

/**
 * Should `candidate` replace `committed`? Strictly-newer publishedAt only.
 * Equal is a rebroadcast (ignore); older is a stale replay (ignore).
 *
 * @param {SyncedDeck | null | undefined} committed
 * @param {SyncedDeck | null | undefined} candidate
 * @returns {boolean}
 */
export function isNewerDeck(committed, candidate) {
  if (!candidate || typeof candidate.publishedAt !== 'number') return false;
  if (!committed || typeof committed.publishedAt !== 'number') return true;
  return candidate.publishedAt > committed.publishedAt;
}
