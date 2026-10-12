import { describe, expect, it } from 'vitest';
import {
  clubMilestoneCrossings, freshCrossings, isPrinterFailure, recapInWindow, tallyMilestoneHit,
} from './lobbyEvents.js';
import { CLOCK_SKEW_TOLERANCE_MS } from './freshness.js';

describe('clubMilestoneCrossings', () => {
  it('names each club that passed a multiple, at that multiple', () => {
    expect(clubMilestoneCrossings({ Sparks: 9, TNT: 3 }, { Sparks: 10, TNT: 4 }, 10))
      .toEqual([{ club: 'Sparks', count: 10, key: 'Sparks:10' }]);
  });
  it('treats first sight of a club as a baseline', () => {
    expect(clubMilestoneCrossings({}, { Sparks: 25 }, 10)).toEqual([]);
  });
  it('is the multiple crossed, not the count, after a jump', () => {
    expect(clubMilestoneCrossings({ A: 8 }, { A: 31 }, 10)).toEqual([{ club: 'A', count: 30, key: 'A:30' }]);
  });
  it('ignores a drop, no change and an off setting', () => {
    expect(clubMilestoneCrossings({ A: 12 }, { A: 9 }, 10)).toEqual([]);
    expect(clubMilestoneCrossings({ A: 12 }, { A: 12 }, 10)).toEqual([]);
    expect(clubMilestoneCrossings({ A: 9 }, { A: 10 }, 0)).toEqual([]);
  });
});

describe('freshCrossings', () => {
  it('is empty for a baseline and for a non-number', () => {
    expect(freshCrossings(null, 120, new Set())).toEqual([]);
    expect(freshCrossings(undefined, 120, new Set())).toEqual([]);
    expect(freshCrossings(10, undefined, new Set())).toEqual([]);
  });
  it('returns the crossed thresholds not yet fired', () => {
    expect(freshCrossings(8, 27, new Set([10]), [5, 10, 25])).toEqual([25]);
  });
  it('lists a repeated threshold once', () => {
    expect(freshCrossings(0, 6, new Set(), [5, 5])).toEqual([5]);
  });
  it('uses the night thresholds when none are given', () => {
    expect(freshCrossings(40, 60, new Set())).toEqual([50]);
  });
});

describe('tallyMilestoneHit', () => {
  it('fires on an increase to a multiple only', () => {
    expect(tallyMilestoneHit(24, 25, 25)).toBe(true);
    expect(tallyMilestoneHit(25, 25, 25)).toBe(false);
    expect(tallyMilestoneHit(26, 25, 25)).toBe(false);
    expect(tallyMilestoneHit(24, 26, 25)).toBe(false);
  });
  it('is off for 0 and undefined', () => {
    expect(tallyMilestoneHit(0, 25, 0)).toBe(false);
    expect(tallyMilestoneHit(0, 25, undefined)).toBe(false);
  });
});

describe('recapInWindow', () => {
  const MIN = 60 * 1000;
  it('keeps entries within the window of the newest, drops older ones', () => {
    const now = 100 * MIN;
    const entries = [{ at: now - 30 * MIN }, { at: now - 5 * MIN }, { at: now }];
    expect(recapInWindow(entries, { maxAgeMin: 20, now })).toEqual([{ at: now - 5 * MIN }, { at: now }]);
  });
  it('defaults to 20 minutes', () => {
    const now = 100 * MIN;
    expect(recapInWindow([{ at: now - 21 * MIN }, { at: now }], { maxAgeMin: undefined, now })).toEqual([{ at: now }]);
  });
  it('measures from the recap, not the clock, but this clock still bounds it', () => {
    const at = 1_000_000;
    const entries = [{ at }];
    // a TV twenty minutes fast
    expect(recapInWindow(entries, { maxAgeMin: 20, now: at + 40 * MIN })).toEqual(entries);
    // last Wednesday's recap replayed on Thursday
    expect(recapInWindow(entries, { maxAgeMin: 20, now: at + 20 * MIN + CLOCK_SKEW_TOLERANCE_MS + 1 })).toEqual([]);
  });
  it('is empty for no entries', () => {
    expect(recapInWindow([], { maxAgeMin: 20, now: 1 })).toEqual([]);
  });
});

describe('isPrinterFailure', () => {
  it('counts the failure types only', () => {
    expect(isPrinterFailure({ type: 'print-failure' })).toBe(true);
    expect(isPrinterFailure({ type: 'selector-fail' })).toBe(true);
    expect(isPrinterFailure({ type: 'update-ok' })).toBe(false);
    expect(isPrinterFailure({ type: 'canary' })).toBe(false);
  });
});
