// ONE TwoTimTwo read every 5 seconds, ALL reads combined (TwoTimTwo's terms,
// owner 2026-10-11): the watcher's report, the check-in page behind a desk
// check-in, the desk's roster, the phone page's roster and tonight, the
// checkout page. They all take a slot from this clock before they GET a
// page (TwoTimTwoClient.page does it), so no caller keeps its own ad-hoc
// wait and no two reads can ever land inside one interval.
//
// A slot is claimed in ONE synchronous step (no await between the check and
// the write), so two callers can never be handed the same moment. A caller
// says how long it will wait for a slot (`maxWaitMs`):
//   0              the watcher's own report: if the clock is not ready it
//                  skips this turn and its alarm sets itself for `retryAfterMs`
//   a few seconds  a desk or phone request: it queues behind what is already
//                  booked, and past that is refused with retryAfterMs (the
//                  caller answers from its last read, or 429)
// Every other request to TwoTimTwo takes one too (twotimtwo.js): each hop of a
// sign-in (the form, the post, its redirect) and every redirect hop, queueing
// behind the request that began them. Writes (a check-in post, an undo, a
// check-out) are not reads and take no slot themselves.
//
// The next free moment is also kept in storage, so a restarted Durable
// Object does not start a read inside the interval of the one before it.

export const READ_INTERVAL_MS = 5 * 1000;
/** How long an interactive request (a desk or phone page) will queue for a slot. */
export const INTERACTIVE_WAIT_MS = 12 * 1000;
const KEY = 'read:next';

export class ReadBudget {
  /**
   * @param {{ now: () => number, sleep?: (ms: number) => Promise<void>,
   *   storage?: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void> }, interval?: number }} deps
   */
  constructor({ now, sleep, storage, interval = READ_INTERVAL_MS }) {
    this.now = now;
    this.sleep = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.storage = storage || null;
    this.interval = interval;
    /** The earliest moment the next read may start (ms). */
    this.nextFree = 0;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {Record<string, number>} */
    this.taken = {};
    this.refused = 0;
  }

  /** Read the stored clock once (a restart keeps it). Call before claim(). */
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const v = this.storage ? await this.storage.get(KEY) : 0;
        if (typeof v === 'number' && Number.isFinite(v)) this.nextFree = Math.max(this.nextFree, v);
      })();
    }
    return this.loading;
  }

  /** Milliseconds until a read may start (0 when it may now). */
  peek() {
    return Math.max(0, this.nextFree - this.now());
  }

  /**
   * Book the next slot. SYNCHRONOUS: nothing awaits between the check and the
   * write. ok with the moment it starts (`waitMs` from now), or refused with
   * how long the clock is booked.
   * @param {number} [maxWaitMs]
   * @param {string} [kind]
   * @returns {{ ok: true, at: number, waitMs: number } | { ok: false, retryAfterMs: number }}
   */
  claim(maxWaitMs = 0, kind = 'read') {
    const t = this.now();
    const at = Math.max(t, this.nextFree);
    const waitMs = at - t;
    if (waitMs > maxWaitMs) {
      this.refused += 1;
      return { ok: false, retryAfterMs: waitMs };
    }
    this.nextFree = at + this.interval;
    this.taken[kind] = (this.taken[kind] || 0) + 1;
    return { ok: true, at, waitMs };
  }

  /**
   * Book a slot and wait for it: the one call a read makes.
   * @param {number} [maxWaitMs] @param {string} [kind]
   * @returns {Promise<{ ok: true, at: number, waitedMs: number } | { ok: false, retryAfterMs: number }>}
   */
  async take(maxWaitMs = 0, kind = 'read') {
    await this.load();
    const c = this.claim(maxWaitMs, kind);
    if (!c.ok) return c;
    if (this.storage) await this.storage.put(KEY, this.nextFree);
    if (c.waitMs > 0) await this.sleep(c.waitMs);
    return { ok: true, at: c.at, waitedMs: c.waitMs };
  }

  /** A read made some other way, at `atMs`: the clock waits out its interval too. @param {number} atMs */
  note(atMs) {
    if (Number.isFinite(atMs)) this.nextFree = Math.max(this.nextFree, atMs + this.interval);
  }

  /** Counts for GET /v1/cloud/status (kinds are fixed words, never a name). */
  stats() {
    return { intervalMs: this.interval, readyInMs: this.peek(), taken: { ...this.taken }, refused: this.refused };
  }
}
