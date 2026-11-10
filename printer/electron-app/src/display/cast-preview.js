// @ts-check
// The Cast desk's live TV miniature (owner 2026-11-09): a rate limiter and one-slot cache
// around a capture function (display.js hands in the Cast TV window's capturePage as a
// JPEG data URL). At most one real capture per MIN_GAP_MS; a call inside that window gets
// the last result. Never throws, never writes to disk. No Electron here, so it is testable.
'use strict';

const MIN_GAP_MS = 900;

/**
 * @param {{ capture: () => Promise<string | null | undefined> | string | null | undefined, now: () => number }} deps
 */
function createCastPreview({ capture, now }) {
  /** @type {string | null} */
  let last = null;
  let lastAt = -Infinity;
  /** @type {Promise<string | null> | null} */
  let inflight = null;

  return {
    /** @returns {Promise<string | null>} */
    async get() {
      if (inflight) return inflight;
      const t = now();
      if (t - lastAt < MIN_GAP_MS) return last;
      lastAt = t;
      const run = (async () => {
        try {
          const r = await capture();
          last = typeof r === 'string' && r ? r : null;
        } catch {
          last = null;
        }
        return last;
      })();
      inflight = run;
      try { return await run; } finally { inflight = null; }
    },
  };
}

module.exports = { createCastPreview, MIN_GAP_MS };
