import { describe, expect, it } from 'vitest';
import { SHARE_STALE_MS, createShareQueue, shareWords } from './shareBanner.js';

const kids = (...names) => names.map((firstName) => ({ firstName, club: 'Sparks' }));

describe('the share banner\'s words (owner 2026-11-23)', () => {
  it('one child, a few, many', () => {
    expect(shareWords({ kids: kids('Ava'), shares: 1 })).toEqual({ names: 'AVA', line: 'got 1 share!' });
    expect(shareWords({ kids: kids('Ava', 'Ben', 'Mia'), shares: 3 })).toEqual({ names: 'AVA, BEN & MIA', line: 'got 3 shares each!' });
    expect(shareWords({ kids: kids('A', 'B', 'C', 'D', 'E', 'F'), shares: 2 }).names).toBe('A, B, C & 3 MORE');
  });
  it('the queue waits while the screen is busy, one at a time, and drops old news', () => {
    const q = createShareQueue();
    q.add({ kids: kids('Ava'), shares: 1 }, 0);
    q.add({ kids: kids('Ben'), shares: 2 }, 0);
    expect(q.take(1000, true)).toBe(null);
    expect(q.take(1000, false).kids[0].firstName).toBe('Ava');
    expect(q.take(SHARE_STALE_MS + 1, false)).toBe(null);
  });
});
