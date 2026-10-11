import { describe, it, expect } from 'vitest';
import { COUNT_WATCH_START, NAME_SLACK_MS, countsWithoutNamesNow, nameArrived, watchCounts } from './countsWithoutNames.js';

const MIN = 60 * 1000;
const AFTER = 6 * MIN;
const frame = (count, now, extra = {}) => ({ count, fresh: true, now, lastNameAt: null, ...extra });
const alarm = (s, now, extra = {}) => countsWithoutNamesNow(s, { now, afterMs: AFTER, fresh: true, nameFault: false, ...extra });

describe('the counts-without-names alarm', () => {
  it('never fires on the count a screen connects to, however big (last club night replayed, or a screen opened mid-evening)', () => {
    const s = watchCounts(COUNT_WATCH_START, frame(120, 0));
    expect(s).toEqual({ last: 120, riseAt: null });
    expect(alarm(s, 60 * MIN)).toBe(false);
  });

  it('ignores a stale frame entirely', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(30, MIN, { fresh: false }));
    expect(s).toEqual({ last: 10, riseAt: null });
  });

  it('fires when the count rises and no name follows for the full wait', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(11, MIN));
    s = watchCounts(s, frame(14, 3 * MIN));
    expect(s.riseAt).toBe(MIN);
    expect(alarm(s, MIN + AFTER - 1)).toBe(false);
    expect(alarm(s, MIN + AFTER)).toBe(true);
  });

  it('a name after the rise (the sealed check-in decrypts after the count) clears it', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(11, MIN));
    s = nameArrived(s);
    expect(alarm(s, MIN + AFTER)).toBe(false);
  });

  it('a name just before the rise covers it: the last child of the night never raises it', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(11, 10 * MIN, { lastNameAt: 10 * MIN - NAME_SLACK_MS }));
    expect(s.riseAt).toBe(null);
    expect(alarm(s, 30 * MIN)).toBe(false);
  });

  it('a lower count is a new night: a new baseline, no alarm', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(12, MIN));
    s = watchCounts(s, frame(0, 2 * MIN));
    expect(s).toEqual({ last: 0, riseAt: null });
  });

  it('stays down while the counts are stale or the names have their own fault', () => {
    let s = watchCounts(COUNT_WATCH_START, frame(10, 0));
    s = watchCounts(s, frame(11, MIN));
    expect(alarm(s, MIN + AFTER, { fresh: false })).toBe(false);
    expect(alarm(s, MIN + AFTER, { nameFault: true })).toBe(false);
  });
});
