// ONE TwoTimTwo read every 15 seconds, ALL the Worker's reads combined. TwoTimTwo's
// terms (owner 2026-10-11) are one read every 5 s; while the laptop's extension
// tab still reads TwoTimTwo beside the Worker (about 3 reads a minute), the owner
// (2026-10-12) keeps the Worker to one read every 15 s, so the two together stay
// well inside them. READ_INTERVAL_MS goes back to 5 s when the extension tab is
// retired (ROADMAP.md#cloud-check-in). That is 4 reads a minute for the
// watcher's report, the check-in page behind the desk's and phones' roster, the
// Checkout page, the household export and each hop of a sign-in. They all take
// a slot from this clock before they GET a page (TwoTimTwoClient.page does it),
// so no caller keeps its own ad-hoc wait and no two reads can ever land inside
// one interval.
//
// A slot is claimed in ONE synchronous step (no await between the check and
// the write), so two callers can never be handed the same moment. A caller
// says how long it will wait for a slot (`maxWaitMs`):
//   0              the watcher's own reads (report, Checkout page, households
//                  catch-up, the night's check-in page): if the clock is not
//                  ready it skips this turn and its alarm comes back when it is
//   INTERACTIVE_WAIT_MS  a desk or phone request: it queues behind what is
//                  already booked (longer than one slot, so it waits its turn
//                  rather than failing), and past that is refused with
//                  retryAfterMs (the caller answers from its last read, or 429)
// Every other request to TwoTimTwo takes one too (twotimtwo.js): each hop of a
// sign-in (the form, the post, its redirect) and every redirect hop, queueing
// behind the request that began them. Writes (a check-in post, an undo, a
// check-out) are not reads and take no slot themselves.
//
// THE REPORT NEVER STARVES. The watcher RESERVES the moment its next report is
// due (`reserve`). Any other read keeps one interval clear of it, so with the
// report every 30 s the slots go report, other, report, other. Only a request
// that could not otherwise be served within its wait may take the reserved
// slot, and only ONCE per reservation (the report then reads one slot later,
// 45 s after the last). `priority` reads (the watcher's report, and a hop of a
// request already under way) ignore the reservation.
//
// DESK ACTIONS FIRST (owner 2026-10-12: "When someone is checking in a child it
// should be instantaneous as much as possible, never a wait"). A check-in, undo
// or check-out normally reads nothing (desk.js keeps the check-in page for the
// night). When it has nothing cached, its read is `urgent`: the head of the
// queue, ahead of every queued roster, households, Checkout-page or report
// read (those give way and book again when they wake), and never inside one
// interval of a read already started. The spacing is never broken.
//
// The last booked moment is also kept in storage, so a restarted Durable
// Object does not start a read inside the interval of the one before it.

/** One TwoTimTwo read per this long, every Worker read combined (owner 2026-10-12; 5 s once the extension tab is retired). */
export const READ_INTERVAL_MS = 15 * 1000;
/** How long an interactive request (a desk or phone page) will queue for a slot: more than one slot. */
export const INTERACTIVE_WAIT_MS = 20 * 1000;
const KEY = 'read:next';

/** @typedef {{ at: number, urgent: boolean, displaced: boolean }} Booking */

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
    /** The reads booked, by start (ascending; ones more than an interval old are pruned). @type {Booking[]} */
    this.booked = [];
    /** No read before this (a restarted object's stored clock). */
    this.floor = 0;
    /** The watcher's next report: { at, origin, bumped } (ms). @type {{ at: number, origin: number, bumped: boolean }|null} */
    this.reserved = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
    /** @type {Record<string, number>} */
    this.taken = {};
    this.refused = 0;
    this.bumps = 0;
    this.displaced = 0;
  }

  /** The earliest moment after every booked read (and the stored clock). */
  get nextFree() {
    const last = this.booked.length ? this.booked[this.booked.length - 1].at + this.interval : 0;
    return Math.max(this.floor, last);
  }

  /** Read the stored clock once (a restart keeps it). Call before claim(). */
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const v = this.storage ? await this.storage.get(KEY) : 0;
        if (typeof v === 'number' && Number.isFinite(v)) this.floor = Math.max(this.floor, v);
      })();
    }
    return this.loading;
  }

  /**
   * The watcher's next report read is due at `atMs`: other reads keep clear of
   * it. Asked again with the same moment, a reservation already moved once
   * stays where it was moved.
   * @param {number} atMs
   */
  reserve(atMs) {
    if (!Number.isFinite(atMs)) { this.reserved = null; return; }
    if (this.reserved && this.reserved.origin === atMs) return;
    this.reserved = { at: atMs, origin: atMs, bumped: false };
  }

  /**
   * The earliest start at or after `t` that keeps one interval clear of the
   * reads that count: every booked read (for an `urgent` claim only urgent ones
   * and reads already started), the stored clock, and the reservation unless
   * `priority` or `urgent`. Pure.
   * @param {number} t @param {boolean} priority @param {boolean} [urgent]
   */
  slotFrom(t, priority, urgent = false) {
    const busy = this.booked
      .filter((b) => b.at + this.interval > t && (!urgent || b.urgent || b.at <= t))
      .map((b) => b.at);
    if (this.floor > t) busy.push(this.floor - this.interval);
    const r = this.reserved;
    if (!priority && !urgent && r && r.at + this.interval > t) busy.push(r.at);
    busy.sort((a, b) => a - b);
    let s = t;
    for (const b of busy) {
      if (b + this.interval <= s) continue;
      if (s + this.interval <= b) break;
      s = b + this.interval;
    }
    return s;
  }

  /**
   * Milliseconds until a read may start (0 when it may now). `priority` (the
   * report) ignores the reservation; the watcher's other reads ask without it.
   * @param {boolean} [priority]
   */
  peek(priority = true) {
    const t = this.now();
    return this.slotFrom(t, priority) - t;
  }

  /**
   * Book the next slot. SYNCHRONOUS: nothing awaits between the check and the
   * write. ok with the moment it starts (`waitMs` from now), or refused with
   * how long the clock is booked.
   *   priority  the watcher's report, or a hop of a request already under way:
   *             ignores the report's reservation
   *   urgent    a desk check-in, undo or check-out with nothing cached: the
   *             head of the queue (see the top of this file)
   * @param {number} [maxWaitMs]
   * @param {string} [kind]
   * @param {boolean | { priority?: boolean, urgent?: boolean }} [opts] `true` = priority
   * @returns {{ ok: true, at: number, waitMs: number, booking: Booking } | { ok: false, retryAfterMs: number }}
   */
  claim(maxWaitMs = 0, kind = 'read', opts = false) {
    const { priority = false, urgent = false } = typeof opts === 'object' && opts ? opts : { priority: !!opts };
    const t = this.now();
    this.booked = this.booked.filter((b) => b.at + this.interval > t);
    let at = this.slotFrom(t, priority, urgent);
    if (at - t > maxWaitMs && maxWaitMs > 0 && !priority && !urgent && this.reserved && !this.reserved.bumped) {
      // A waiting request that would otherwise be turned away may take the
      // report's slot, once: the report then reads one slot later. (A read that
      // will not wait, the watcher's own background ones, never does.)
      const free = this.slotFrom(t, true);
      if (free - t <= maxWaitMs) at = free;
    }
    const waitMs = at - t;
    if (waitMs > maxWaitMs) {
      this.refused += 1;
      return { ok: false, retryAfterMs: waitMs };
    }
    if (urgent) {
      // Queued reads it lands on give way; they book again when they wake.
      for (const b of this.booked) {
        if (b.at > t && !b.urgent && Math.abs(b.at - at) < this.interval) { b.displaced = true; this.displaced += 1; }
      }
      this.booked = this.booked.filter((b) => !b.displaced);
    }
    const r = this.reserved;
    if (r && !priority && Math.abs(at - r.at) < this.interval) {
      // The report's slot went to someone else: it reads one slot later.
      this.reserved = { ...r, at: at + this.interval, bumped: true };
      this.bumps += 1;
    }
    /** @type {Booking} */
    const booking = { at, urgent, displaced: false };
    this.booked.push(booking);
    this.booked.sort((a, b) => a.at - b.at);
    this.taken[kind] = (this.taken[kind] || 0) + 1;
    return { ok: true, at, waitMs, booking };
  }

  /**
   * Book a slot and wait for it: the one call a read makes. A booking an
   * urgent desk action displaced books again, within what is left of its wait.
   * @param {number} [maxWaitMs] @param {string} [kind] @param {boolean | { priority?: boolean, urgent?: boolean }} [opts]
   * @returns {Promise<{ ok: true, at: number, waitedMs: number } | { ok: false, retryAfterMs: number }>}
   */
  async take(maxWaitMs = 0, kind = 'read', opts = false) {
    await this.load();
    const start = this.now();
    for (;;) {
      const c = this.claim(Math.max(0, maxWaitMs - (this.now() - start)), kind, opts);
      if (!c.ok) return c;
      if (this.storage) await this.storage.put(KEY, this.nextFree);
      if (c.waitMs > 0) await this.sleep(c.waitMs);
      if (!c.booking.displaced) return { ok: true, at: c.at, waitedMs: this.now() - start };
      this.taken[kind] -= 1;
    }
  }

  /** A read made some other way, at `atMs`: the clock waits out its interval too. @param {number} atMs */
  note(atMs) {
    if (Number.isFinite(atMs)) {
      this.booked.push({ at: atMs, urgent: true, displaced: false });
      this.booked.sort((a, b) => a.at - b.at);
    }
  }

  /** Counts for GET /v1/cloud/status (kinds are fixed words, never a name). */
  stats() {
    const t = this.now();
    return {
      intervalMs: this.interval,
      interactiveWaitMs: INTERACTIVE_WAIT_MS,
      readyInMs: this.peek(),
      reportReservedInMs: this.reserved && this.reserved.at > t ? this.reserved.at - t : 0,
      taken: { ...this.taken },
      refused: this.refused,
      reportBumps: this.bumps,
      displaced: this.displaced,
    };
  }
}
