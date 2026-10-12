// The one TwoTimTwo read clock (readbudget.js).
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS, ReadBudget } from '../src/readbudget.js';
import { fakeClock, memoryStore } from './helpers.js';

const URGENT = { urgent: true };

describe('the read budget', () => {
  it('is one read every 15 seconds while the extension tab still reads (owner 2026-10-12); an interactive wait is longer than a slot', () => {
    expect(READ_INTERVAL_MS).toBe(15000);
    expect(INTERACTIVE_WAIT_MS).toBeGreaterThan(READ_INTERVAL_MS);
  });

  it('hands out the first slot at once, and the next only after the interval', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    expect(b.claim(0)).toMatchObject({ ok: true, waitMs: 0 });
    expect(b.claim(0)).toEqual({ ok: false, retryAfterMs: 15000 });
    c.tick(14999);
    expect(b.claim(0)).toEqual({ ok: false, retryAfterMs: 1 });
    c.tick(1);
    expect(b.claim(0).ok).toBe(true);
  });

  it('queues a patient caller behind what is booked, never two at one moment', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    const t0 = c.t;
    const slots = [b.claim(INTERACTIVE_WAIT_MS), b.claim(INTERACTIVE_WAIT_MS)];
    expect(slots.map((s) => s.ok && s.at - t0)).toEqual([0, 15000]);
    // the third would start at 30 s: past what it will wait
    expect(b.claim(INTERACTIVE_WAIT_MS)).toEqual({ ok: false, retryAfterMs: 30000 });
    expect(b.refused).toBe(1);
  });

  it('keeps every read 15 s apart when many callers race (interleaving)', async () => {
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
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(15000);
    expect(b.stats().taken).toEqual({ watcher: 1, desk: 1, phone: 1, 'desk-action': 1, checkout: 1 });
  });

  it('an outside read (note) pushes the clock out', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    b.note(c.t - 1000);
    expect(b.peek()).toBe(14000);
  });

  it('a restarted object keeps the clock (new instance over the same storage)', async () => {
    const c = fakeClock();
    const storage = memoryStore();
    const first = new ReadBudget({ now: c.now, sleep: c.sleep, storage });
    await first.take(0);
    c.tick(1000);
    const second = new ReadBudget({ now: c.now, sleep: c.sleep, storage });
    expect(await second.take(0)).toEqual({ ok: false, retryAfterMs: 14000 });
    c.tick(14000);
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
    const other = b.claim(INTERACTIVE_WAIT_MS, 'desk');
    expect(other).toMatchObject({ ok: true, at: t0 + 15000 });
    // 10 s on, the next free slot is 45 s (35 s away, past its 20 s wait), so it may take the report's ONCE
    c.tick(10000);
    const pushy = b.claim(INTERACTIVE_WAIT_MS, 'desk');
    expect(pushy).toMatchObject({ ok: true, at: t0 + 30000 });
    expect(b.reserved).toMatchObject({ at: t0 + 45000, bumped: true });
    // never twice: the next waiting request is turned away rather than push the report again
    c.tick(15000);
    expect(b.claim(INTERACTIVE_WAIT_MS, 'phone')).toEqual({ ok: false, retryAfterMs: 35000 });
    // the watcher's background reads (waitMs 0) never take it
    expect(b.peek(false)).toBeGreaterThan(0);
    // and asking again with the same moment keeps where it was moved
    b.reserve(t0 + 30000);
    expect(b.reserved).toMatchObject({ at: t0 + 45000 });
  });

  it('a background read (waitMs 0, not priority) never lands within a slot of the reserved report', () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    b.reserve(c.t + 10000);
    expect(b.claim(0, 'households-catch-up')).toEqual({ ok: false, retryAfterMs: 25000 });
    expect(b.claim(0, 'watcher', true).ok).toBe(true);
  });
});

describe('a desk action\'s read (urgent): the head of the queue', () => {
  it('goes before queued reads, which give way and book again, and the 15 s spacing holds', async () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep });
    const t0 = c.t;
    expect(b.claim(0, 'watcher', true).ok).toBe(true);   // a report read just started
    const roster = b.claim(INTERACTIVE_WAIT_MS, 'desk');   // queued at 15 s
    expect(roster).toMatchObject({ ok: true, at: t0 + 15000 });
    const desk = b.claim(INTERACTIVE_WAIT_MS, 'desk-action', URGENT);
    expect(desk).toMatchObject({ ok: true, at: t0 + 15000 });   // the head of the queue
    expect(roster.ok && roster.booking.displaced).toBe(true);
    // the roster's caller books again when it wakes (15 s on): 30 s
    c.tick(15000);
    expect(b.claim(INTERACTIVE_WAIT_MS, 'desk')).toMatchObject({ ok: true, at: t0 + 30000 });
    // never inside a slot of a read already started
    const c2 = fakeClock();
    const b2 = new ReadBudget({ now: c2.now, sleep: c2.sleep });
    b2.claim(0);
    c2.tick(4000);
    expect(b2.claim(INTERACTIVE_WAIT_MS, 'desk-action', URGENT)).toMatchObject({ ok: true, waitMs: 11000 });
  });

  it('take(): a displaced read waits and books again, still 15 s from every other', async () => {
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
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(15000);
    expect(b.stats()).toMatchObject({ displaced: 1, taken: { watcher: 1, desk: 1, 'desk-action': 1 } });
  });
});
