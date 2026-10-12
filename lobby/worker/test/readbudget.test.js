// The one TwoTimTwo read clock (readbudget.js).
import { describe, expect, it } from 'vitest';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS, ReadBudget } from '../src/readbudget.js';
import { fakeClock, memoryStore } from './helpers.js';

describe('the read budget', () => {
  it('is one read every 5 seconds', () => {
    expect(READ_INTERVAL_MS).toBe(5000);
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
    const slots = [b.claim(INTERACTIVE_WAIT_MS), b.claim(INTERACTIVE_WAIT_MS), b.claim(INTERACTIVE_WAIT_MS)];
    expect(slots.map((s) => s.ok && s.at - t0)).toEqual([0, 5000, 10000]);
    // the fourth would start at 15 s: past what it will wait
    expect(b.claim(INTERACTIVE_WAIT_MS)).toEqual({ ok: false, retryAfterMs: 15000 });
    expect(b.refused).toBe(1);
  });

  it('keeps every read 5 s apart when many callers race (interleaving)', async () => {
    const c = fakeClock();
    const b = new ReadBudget({ now: c.now, sleep: c.sleep, storage: memoryStore() });
    const starts = [];
    const read = async (kind) => {
      const r = await b.take(30000, kind);
      if (r.ok) starts.push(r.at);
    };
    await Promise.all([read('watcher'), read('desk'), read('phone'), read('desk'), read('checkout')]);
    expect(starts).toHaveLength(5);
    const sorted = [...starts].sort((x, y) => x - y);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(5000);
    expect(b.stats().taken).toEqual({ watcher: 1, desk: 2, phone: 1, checkout: 1 });
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
