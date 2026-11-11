// doc.js: one stored document, loaded once. A FAILED load must not be kept
// (2026-11-10): the cached rejection made every later check-in a 500 until the
// Durable Object restarted.
import { describe, expect, it } from 'vitest';
import { Doc } from '../src/doc.js';
import { ReadBudget } from '../src/readbudget.js';

function flakyStorage(failures) {
  const map = new Map();
  let left = failures;
  let gets = 0;
  return {
    map,
    gets: () => gets,
    get: async (k) => { gets += 1; if (left > 0) { left -= 1; throw new Error('storage hiccup'); } return map.get(k); },
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
  };
}

describe('a failed storage read is tried again', () => {
  it('Doc: the first load rejects, the next one reads and works', async () => {
    const storage = flakyStorage(1);
    storage.map.set('ledger', { claims: ['kept'] });
    const doc = new Doc(storage, 'ledger', () => ({ claims: [] }));
    await expect(doc.load()).rejects.toThrow('storage hiccup');
    await doc.load();
    expect(doc.data).toEqual({ claims: ['kept'] });   // the stored copy, never a fresh empty one over it
    await doc.load();
    expect(storage.gets()).toBe(2);                   // and a good load is still made only once
  });

  it('Doc: callers waiting on the same failed load all see the failure, then recover together', async () => {
    const storage = flakyStorage(1);
    const doc = new Doc(storage, 'printq', () => ({ jobs: [] }));
    const [a, b] = await Promise.allSettled([doc.load(), doc.load()]);
    expect([a.status, b.status]).toEqual(['rejected', 'rejected']);
    await Promise.all([doc.load(), doc.load()]);
    expect(doc.data).toEqual({ jobs: [] });
    expect(storage.gets()).toBe(2);
  });

  it('the read clock recovers the same way', async () => {
    const storage = flakyStorage(1);
    const budget = new ReadBudget({ storage, now: () => 1000, sleep: async () => {} });
    await expect(budget.load()).rejects.toThrow('storage hiccup');
    await budget.load();
    expect(storage.gets()).toBe(2);
  });
});
