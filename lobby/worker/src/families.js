// TwoTimTwo's households (families), for the check-in page's families-first
// search and its brothers and sisters (GET /v1/desk/families; routes.md §5).
// Names only, held in this object's memory, never stored.
//
// One read of the household export serves FAMILIES_TTL_MS (half an hour, as
// the extension). A family registered tonight would wait that long to group,
// so the Worker also notices a child the roster or the report names that the
// export it holds does not list at all, and re-reads the export from the
// watcher's alarm (`wanted()` / `refresh()`): at most one such read every
// CATCH_UP_GAP_MS, on the read clock with waitMs 0 (it takes a slot nobody
// else wants), and at most once per unknown child per night (a child the
// export still does not list is not looked for again). The roster answer
// carries `familiesAt`, so a page sees the export changed and asks again.

import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';

/** One good read of the export serves this long. */
export const FAMILIES_TTL_MS = 30 * 60 * 1000;
/** A failed read is kept this long, so pages do not sign in once each while the export is refused. */
export const FAMILIES_RETRY_MS = 5 * 60 * 1000;
/** Unknown children re-read the export at most this often (one read slot). */
export const CATCH_UP_GAP_MS = READ_INTERVAL_MS;
/** More unknown names than this in one night is not a registration wave: stop looking. */
const UNKNOWN_MAX = 200;

/** The one way names are compared (case and spacing only). @param {unknown} name */
export const nameKey = (name) => String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();

export class Families {
  /** @param {{ watcher: import('./watcher.js').Watcher, now: () => number }} deps */
  constructor({ watcher, now }) {
    this.watcher = watcher;
    this.now = now;
    /** @type {{ at: number, households: string[][], names: Set<string>, error?: string }|null} */
    this.cache = null;
    /** Tonight's unknown children: waiting for a re-read, and already looked for. */
    this.night = '';
    /** @type {Set<string>} */
    this.waiting = new Set();
    /** @type {Set<string>} */
    this.looked = new Set();
    this.lastCatchUp = 0;
    this.catchUps = 0;
    /** @type {Promise<any>|null} */
    this.inflight = null;
  }

  /**
   * Children the roster or the report names (in memory, for this call): any
   * the export held does not list, and that were not looked for tonight, wait
   * for a re-read. Synchronous. @param {string} night @param {Iterable<unknown>} names
   */
  noteChildren(night, names) {
    if (night !== this.night) { this.night = night; this.waiting = new Set(); this.looked = new Set(); }
    const c = this.cache;
    if (!c || c.error) return;   // nothing held yet: the page's own first read brings it
    for (const n of names) {
      const k = nameKey(n);
      if (!k || c.names.has(k) || this.looked.has(k) || this.waiting.has(k)) continue;
      if (this.waiting.size + this.looked.size >= UNKNOWN_MAX) return;
      this.waiting.add(k);
    }
  }

  /** Is a catch-up re-read due (an unknown child waiting, the gap passed)? */
  wanted() {
    return this.waiting.size > 0 && this.now() - this.lastCatchUp >= CATCH_UP_GAP_MS && !this.inflight;
  }

  /** How long until a catch-up read is due (ms), or null when none waits. */
  wakeInMs() {
    if (!this.waiting.size) return null;
    return Math.max(0, this.lastCatchUp + CATCH_UP_GAP_MS - this.now());
  }

  /** Keep a read's answer. @param {{ ok: boolean, households?: string[][], names?: string[], error?: string }} r */
  keep(r) {
    if (r.ok) {
      this.cache = { at: this.now(), households: r.households || [], names: new Set((r.names || []).map(nameKey)) };
    } else if (!this.cache || this.cache.error) {
      // A failure never replaces a good list (the page keeps its families).
      this.cache = { at: this.now(), households: [], names: new Set(), error: r.error };
    }
  }

  /**
   * The watcher's catch-up read (waitMs 0: only when the clock has a slot now).
   * true when it read (or tried), false when the clock turned it away.
   */
  async refresh() {
    const client = this.watcher.clientFor();
    if (!client || !this.waiting.size) return false;
    const asked = [...this.waiting];
    this.inflight = client.households({ waitMs: 0, kind: 'households-catch-up' });
    let r;
    try { r = await this.inflight; } finally { this.inflight = null; }
    if (!r.ok && r.error === 'read-busy') return false;
    this.lastCatchUp = this.now();
    this.catchUps += 1;
    // Once per child per night, found or not.
    for (const k of asked) { this.waiting.delete(k); this.looked.add(k); }
    this.keep(r);
    return true;
  }

  /**
   * GET /v1/desk/families: the held list while young enough, else one read
   * through the clock (a desk or phone request: it queues). A read only
   * turned away by the clock is not kept: `{busy: retryAfterMs}`.
   * @returns {Promise<{ households: string[][], at: number|null, error?: string } | { busy: number } | { notConfigured: true }>}
   */
  async get() {
    const c = this.cache;
    if (c && this.now() - c.at < (c.error ? FAMILIES_RETRY_MS : FAMILIES_TTL_MS)) return this.view();
    const client = this.watcher.clientFor();
    if (!client || this.watcher.mode === 'off') return { notConfigured: true };
    if (!this.inflight) {
      this.inflight = client.households({ waitMs: INTERACTIVE_WAIT_MS, kind: 'desk-families' });
      this.inflight.finally(() => { this.inflight = null; }).catch(() => {});
    }
    const r = await this.inflight;
    if (!r.ok && r.error === 'read-busy') return { busy: r.retryAfterMs ?? READ_INTERVAL_MS };
    this.keep(r);
    return this.view();
  }

  view() {
    const c = this.cache;
    if (!c) return { households: [], at: null };
    return { households: c.households, at: c.error ? null : c.at, ...(c.error ? { error: c.error } : {}) };
  }

  /** When the held export was read (ISO), for the roster answer, or null. */
  readAt() {
    return this.cache && !this.cache.error ? new Date(this.cache.at).toISOString() : null;
  }

  /** For GET /v1/cloud/status: counts only. */
  stats() {
    return { held: !!this.cache && !this.cache.error, readAt: this.readAt(), waiting: this.waiting.size, lookedFor: this.looked.size, catchUps: this.catchUps };
  }
}
