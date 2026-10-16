// The one TwoTimTwo read clock (readbudget.js).
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS, ReadBudget } from '../src/readbudget.js';
import { fakeClock, memoryStore } from './helpers.js';

const URGENT = { urgent: true };

describe('the read budget', () => {
  it('is one read every 5 seconds, the vendor limit (the extension tab is retired); an interactive wait is longer than a slot', () => {
    expect(READ_INTERVAL_MS).toBe(5000);
    expect(INTERACTIVE_WAIT_MS).toBeGreaterThan(READ_INTERVAL_MS);
  });

  it('hands out the first slot at once, and the next only after the interval', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    expect(b.claim(0)).toMatchObject({ ok: true, waitMs: 0 });
    expect(b.claim(0)).toEqual({ ok: false, retryAfterMs: 5000 });
    c.tick(4999);
    expect(b.claim(0)).toEqual({ ok: false, retryAfterMs: 1 });
    c.tick(1);
    expect(b.claim(0).ok).toBe(true);
  });

  it('queues a patient caller behind what is booked, never two at one moment', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    const t0 = c.t;
    const slots = [b.claim(INTERACTIVE_WAIT_MS), b.claim(INTERACTIVE_WAIT_MS)];
    expect(slots.map((s) => s.ok && s.at - t0)).toEqual([0, 5000]);
    // the fifth would start at 20 s (slots 0, 5, 10, 15 are taken), the sixth at 25 s: past what it will wait
    expect(b.claim(INTERACTIVE_WAIT_MS)).toMatchObject({ ok: true });
    expect(b.claim(INTERACTIVE_WAIT_MS)).toMatchObject({ ok: true });
    expect(b.claim(INTERACTIVE_WAIT_MS)).toMatchObject({ ok: true });
    expect(b.claim(INTERACTIVE_WAIT_MS)).toEqual({ ok: false, retryAfterMs: 25000 });
    expect(b.refused).toBe(1);
  });

  it('keeps every read 5 s apart when many callers race (interleaving)', async () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep, storage: memoryStore() });
    const starts = [];
    const read = async (kind, opts) => {
      const r = await b.take(90000, kind, opts);
      if (r.ok) starts.push(r.at);
    };
    await Promise.all([read('watcher', true), read('desk'), read('phone'), read('desk-action', URGENT), read('checkout')]);
    expect(starts).toHaveLength(5);
    const sorted = [...starts].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(5000);
    expect(b.stats().taken).toEqual({ watcher: 1, desk: 1, phone: 1, 'desk-action': 1, checkout: 1 });
  });

  it('an outside read (note) pushes the clock out', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    b.note(c.t - 1000);
    expect(b.peek()).toBe(4000);
  });

  it('a restarted object keeps the clock (new instance over the same storage)', async () => {
    const c = fakeClock();
    const storage = memoryStore();
    const first = new ReadBudget({ now: c.now, sleep: c.sleep, storage });
    await first.take(0);
    c.tick(1000);
    const second = new ReadBudget({ now: c.now, sleep: c.sleep, storage });
    expect(await second.take(0)).toEqual({ ok: false, retryAfterMs: 4000 });
    c.tick(4000);
    expect((await second.take(0)).ok).toBe(true);
  });
});

describe('the report\'s reservation', () => {
  it('other reads keep one slot clear of the report: report, other, report, other', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    const t0 = c.t;
    expect(b.claim(0, 'watcher', true).ok).toBe(true);   // the report at 0
    b.reserve(t0 + 30000);                                // the next at 30 s
    // the slots between are everyone else's: 5, 10, 15, 20, 25 s; 30 s is the report's
    for (let k = 1; k <= 5; k++) {
      expect(b.claim(60000, 'desk')).toMatchObject({ ok: true, at: t0 + k * 5000 });
    }
    // 10 s on, the next free slot is 40 s (30 s away, past its 20 s wait), so it may take the report's ONCE
    c.tick(10000);
    const pushy = b.claim(INTERACTIVE_WAIT_MS, 'desk');
    expect(pushy).toMatchObject({ ok: true, at: t0 + 30000 });
    expect(b.reserved).toMatchObject({ at: t0 + 35000, bumped: true });
    // never twice: the next waiting request is turned away rather than push the report again
    expect(b.claim(INTERACTIVE_WAIT_MS, 'phone')).toEqual({ ok: false, retryAfterMs: 30000 });
    // the watcher's background reads (waitMs 0) never take it
    expect(b.peek(false)).toBeGreaterThan(0);
    // and asking again with the same moment keeps where it was moved
    b.reserve(t0 + 30000);
    expect(b.reserved).toMatchObject({ at: t0 + 35000 });
  });

  it('a background read (waitMs 0, not priority) never lands within a slot of the reserved report', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    b.reserve(c.t + 3000);
    expect(b.claim(0, 'households-catch-up')).toEqual({ ok: false, retryAfterMs: 8000 });
    expect(b.claim(0, 'watcher', true).ok).toBe(true);
  });
});

describe('a desk action\'s read (urgent): the head of the queue', () => {
  it('goes before queued reads, which give way and book again, and the 5 s spacing holds', async () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    const t0 = c.t;
    expect(b.claim(0, 'watcher', true).ok).toBe(true);   // a report read just started
    const roster = b.claim(INTERACTIVE_WAIT_MS, 'desk');   // queued at 5 s
    expect(roster).toMatchObject({ ok: true, at: t0 + 5000 });
    const desk = b.claim(INTERACTIVE_WAIT_MS, 'desk-action', URGENT);
    expect(desk).toMatchObject({ ok: true, at: t0 + 5000 });   // the head of the queue
    expect(roster.ok && roster.booking.displaced).toBe(true);
    // the roster's caller books again when it wakes (5 s on): 10 s
    c.tick(5000);
    expect(b.claim(INTERACTIVE_WAIT_MS, 'desk')).toMatchObject({ ok: true, at: t0 + 10000 });
    // never inside a slot of a read already started
    const c2 = fakeClock();
    const b2 = new ReadBudget({ now: c2.now, sleep: c2.sleep });
    b2.claim(0);
    c2.tick(2000);
    expect(b2.claim(INTERACTIVE_WAIT_MS, 'desk-action', URGENT)).toMatchObject({ ok: true, waitMs: 3000 });
  });

  it('take(): a displaced read waits and books again, still 5 s from every other', async () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: async (ms) => { await Promise.resolve(); c.tick(ms); } });
    const starts = [];
    await b.take(0, 'watcher', true);
    starts.push(c.t);
    const roster = b.take(60000, 'desk').then((r) => r.ok && starts.push(r.at));
    const desk = b.take(INTERACTIVE_WAIT_MS, 'desk-action', URGENT).then((r) => r.ok && starts.push(r.at));
    await Promise.all([roster, desk]);
    expect(starts).toHaveLength(3);
    const sorted = [...starts].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(5000);
    expect(b.stats()).toMatchObject({ displaced: 1, taken: { watcher: 1, desk: 1, 'desk-action': 1 } });
  });
});
