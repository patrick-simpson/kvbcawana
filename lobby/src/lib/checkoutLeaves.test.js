import { describe, it, expect } from 'vitest';
import { LEAVE_QUEUE_CAP, departures, enqueueLeaves, leaveText, leavesFor, listFresh } from './checkoutLeaves.js';

// "<First name> has checked out" (owner, 2026-10-08). Safeguarding first: a
// name only appears for a child who really left a list this screen saw fresh
// twice in a row, and only while the list is still long enough to name.

const kid = (firstName, club = 'Sparks') => ({ firstName, club });
const NOW = 1_800_000_000_000;
const list = (entries, ago = 0) => ({ entries, stamp: NOW - ago });
const base = { now: NOW, staleMin: 8, namesAbove: 3, pickup: true };

describe('departures (a multiset of first name + club)', () => {
  it('finds who left, in the old list\'s order', () => {
    expect(departures([kid('Ava'), kid('Liam'), kid('Noah')], [kid('Noah')])).toEqual([kid('Ava'), kid('Liam')]);
  });

  it('counts two children of one name in one club as two', () => {
    expect(departures([kid('Ava'), kid('Ava')], [kid('Ava')])).toEqual([kid('Ava')]);
    expect(departures([kid('Ava'), kid('Ava')], [kid('Ava'), kid('Ava')])).toEqual([]);
  });

  it('tells clubs apart, and ignores case and spacing in the club', () => {
    expect(departures([kid('Ava', 'Sparks')], [kid('Ava', 'T&T')])).toEqual([kid('Ava', 'Sparks')]);
    expect(departures([kid('Ava', 'Sparks')], [kid('Ava', ' sparks ')])).toEqual([]);
  });

  it('a child arriving on the list is no departure', () => {
    expect(departures([kid('Ava')], [kid('Ava'), kid('Mia')])).toEqual([]);
    expect(departures(null, [kid('Ava')])).toEqual([]);
  });
});

describe('leavesFor: when a departure may be said', () => {
  const before = list([kid('Ava'), kid('Liam'), kid('Noah'), kid('Mia'), kid('Eli')], 60_000);
  const after = list([kid('Liam'), kid('Noah'), kid('Mia'), kid('Eli')]);

  it('names a child who left a long list', () => {
    expect(leavesFor({ ...base, before, after })).toEqual([{ kind: 'name', firstName: 'Ava', club: 'Sparks' }]);
  });

  it('never on the first list after a load or a reconnect', () => {
    expect(leavesFor({ ...base, before: null, after })).toEqual([]);
  });

  it('never before pickup time', () => {
    expect(leavesFor({ ...base, pickup: false, before, after })).toEqual([]);
  });

  it('never from or to a stale list, so never because the feed went quiet', () => {
    expect(leavesFor({ ...base, before: list(before.entries, 9 * 60_000), after })).toEqual([]);
    expect(leavesFor({ ...base, before, after: list([], 20 * 60_000) })).toEqual([]);
    expect(listFresh(NOW - 8 * 60_000, 8, NOW)).toBe(true);
    expect(listFresh(NOW - 8 * 60_000 - 1, 8, NOW)).toBe(false);
    expect(listFresh(undefined, 8, NOW)).toBe(false);
  });

  it('at or below the naming threshold says "a child", with no name and no club', () => {
    const short = list([kid('Liam'), kid('Noah'), kid('Mia')]);
    const out = leavesFor({ ...base, before: list([kid('Ava'), ...short.entries], 1000), after: short });
    expect(out).toEqual([{ kind: 'child' }]);
    expect(JSON.stringify(out)).not.toMatch(/Ava|Sparks/);
    expect(leaveText(out[0])).toBe('A child has checked out');
  });

  it('the guard switched off (0) names every departure', () => {
    expect(leavesFor({ ...base, namesAbove: 0, before: list([kid('Ava'), kid('Liam')], 1000), after: list([kid('Liam')]) }))
      .toEqual([{ kind: 'name', firstName: 'Ava', club: 'Sparks' }]);
  });

  it('a fresh empty list names the last ones only while the guard allows it', () => {
    // The list emptying is a real event, but an empty list is below any
    // threshold: the last children are never named on their way out.
    expect(leavesFor({ ...base, before: list([kid('Ava'), kid('Liam')], 1000), after: list([]) })).toEqual([{ kind: 'child' }, { kind: 'child' }]);
  });
});

describe('the queue', () => {
  const name = (n) => ({ kind: 'name', firstName: n, club: 'Sparks' });

  it('holds one after another, up to the cap', () => {
    const q = enqueueLeaves([], [name('A'), name('B')]);
    expect(q).toEqual([name('A'), name('B')]);
  });

  it('collapses what does not fit into one "and N more", which grows', () => {
    const many = Array.from({ length: 9 }, (_, i) => name(`K${i}`));
    const q = enqueueLeaves([], many);
    expect(q).toHaveLength(LEAVE_QUEUE_CAP + 1);
    expect(q.at(-1)).toEqual({ kind: 'more', count: 3 });
    expect(leaveText(q.at(-1))).toBe('and 3 more have checked out');
    const q2 = enqueueLeaves(q, [name('Z')]);
    expect(q2.at(-1)).toEqual({ kind: 'more', count: 4 });
    expect(leaveText({ kind: 'more', count: 1 })).toBe('and 1 more has checked out');
  });

  it('words a named banner', () => {
    expect(leaveText(name('Ava'))).toBe('Ava has checked out');
  });
});
