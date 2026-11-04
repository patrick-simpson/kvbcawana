// @ts-check
// The poster contest vote tally (owner 2026-11-04: "a little tally counter so
// that I can easily count up votes for each poster ... put it in the project
// so that I can access it from any device", counts shared across devices;
// src/routes.md 10.15). The page is awana.kvbchurch.org/tools/tally/.
//
// Six numbers and nothing else: the paper ballot's two divisions (Older Kids,
// Younger Kids), posters 1 to 3 in each. Finalists go by number, never a name.
//
// Storage:
//   tally:poster   {counts: {older: [n, n, n], younger: [n, n, n]}, rev, at}
//
// Every press is ONE synchronous step on the cached copy, then written through
// (no await between the read and the change), so two phones tapping at once
// both count. A count never goes below 0. A change rings the live channel's
// doorbell, `changed {what: 'tally', rev}`, so another open page updates at
// once; the page also reads the state every few seconds while it is visible.

import { fail, json } from './http.js';

export const TALLY_KEY = 'tally:poster';
export const TALLY_DIVISIONS = Object.freeze(['older', 'younger']);
export const TALLY_POSTERS = 3;
/** No count above this (a guard, not a real limit). */
export const TALLY_MAX = 99999;

/** @returns {{ counts: { older: number[], younger: number[] }, rev: number, at: number|null }} */
const empty = () => ({ counts: { older: [0, 0, 0], younger: [0, 0, 0] }, rev: 0, at: null });

/** A stored doc read back safely (anything odd = zeros). @param {any} d */
function clean(d) {
  const out = empty();
  if (!d || typeof d !== 'object') return out;
  for (const div of TALLY_DIVISIONS) {
    const arr = d.counts && d.counts[div];
    if (Array.isArray(arr) && arr.length === TALLY_POSTERS && arr.every((n) => Number.isInteger(n) && n >= 0 && n <= TALLY_MAX)) out.counts[div] = arr.slice();
  }
  if (Number.isInteger(d.rev) && d.rev >= 0) out.rev = d.rev;
  if (Number.isFinite(d.at)) out.at = d.at;
  return out;
}

export class Tally {
  /** @param {{ storage: any, now: () => number, ring?: (payload: Record<string, unknown>) => void }} deps */
  constructor({ storage, now, ring }) {
    this.storage = storage;
    this.now = now;
    this.ring = (/** @type {Record<string, unknown>} */ p) => { try { ring?.(p); } catch { /* the page's own read catches up */ } };
    /** @type {ReturnType<typeof empty>|null} */
    this.cache = null;
  }

  async doc() {
    if (!this.cache) this.cache = clean(await this.storage.get(TALLY_KEY));
    return this.cache;
  }

  /** @param {ReturnType<typeof empty>} d */
  answer(d) {
    return json({ ok: true, counts: d.counts, rev: d.rev, at: d.at ? new Date(d.at).toISOString() : null });
  }

  /** GET /v1/tally */
  async state() {
    return this.answer(await this.doc());
  }

  /** POST /v1/tally {division, poster, delta}: one tap. @param {any} body */
  async press(body) {
    const division = body?.division;
    const poster = Number(body?.poster);
    const delta = Number(body?.delta);
    if (!TALLY_DIVISIONS.includes(division) || !Number.isInteger(poster) || poster < 1 || poster > TALLY_POSTERS || (delta !== 1 && delta !== -1)) {
      return fail('That is not a poster or a vote.', 400, { reason: 'bad-press' });
    }
    const d = await this.doc();
    // One synchronous step: read, change, stamp.
    const i = poster - 1;
    const next = Math.min(TALLY_MAX, Math.max(0, d.counts[division][i] + delta));
    const moved = next !== d.counts[division][i];
    if (moved) {
      d.counts[division][i] = next;
      d.rev += 1;
      d.at = this.now();
    }
    if (moved) {
      await this.storage.put(TALLY_KEY, d);
      this.ring({ what: 'tally', rev: d.rev });
    }
    return this.answer(d);
  }

  /** POST /v1/tally/reset: every count back to 0. */
  async reset() {
    const d = await this.doc();
    d.counts = { older: [0, 0, 0], younger: [0, 0, 0] };
    d.rev += 1;
    d.at = this.now();
    await this.storage.put(TALLY_KEY, d);
    this.ring({ what: 'tally', rev: d.rev });
    return this.answer(d);
  }
}

/**
 * The routes (src/routes.md 10.15), a session each.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountTally(registry, core) {
  const t = () => /** @type {Tally} */ (core.tally);
  registry.add('GET', '/v1/tally', 'session', async () => t().state());
  registry.add('POST', '/v1/tally', 'session', async ({ body }) => t().press(await body()));
  registry.add('POST', '/v1/tally/reset', 'session', async () => t().reset());
}
