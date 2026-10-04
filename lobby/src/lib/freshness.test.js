import { describe, expect, it } from 'vitest';
import { CLOCK_SKEW_TOLERANCE_MS, isFresh, stampOf, stampReceived } from './freshness.js';

describe('isFresh', () => {
  const now = 1_000_000;

  it('is fresh right at the timestamp', () => {
    expect(isFresh(now, 60000, now)).toBe(true);
  });

  it('is fresh just inside the max age', () => {
    expect(isFresh(now - 59999, 60000, now)).toBe(true);
  });

  it('is stale once the max age is exceeded', () => {
    expect(isFresh(now - 60001, 60000, now)).toBe(false);
  });

  it('is fresh exactly at the max age boundary', () => {
    expect(isFresh(now - 60000, 60000, now)).toBe(true);
  });

  it('rejects a missing timestamp', () => {
    expect(isFresh(undefined, 60000, now)).toBe(false);
    expect(isFresh(null, 60000, now)).toBe(false);
  });

  it('rejects a non-numeric or non-finite timestamp', () => {
    expect(isFresh('2026-01-01', 60000, now)).toBe(false);
    expect(isFresh(NaN, 60000, now)).toBe(false);
    expect(isFresh(Infinity, 60000, now)).toBe(false);
  });

  it('defaults `now` to the real clock when omitted', () => {
    expect(isFresh(Date.now(), 60000)).toBe(true);
    expect(isFresh(Date.now() - 60 * 60 * 1000, 60000)).toBe(false);
  });
});

describe('stampReceived / stampOf: age by this screen\'s clock, within reason', () => {
  it('stamps when the payload landed, without touching what the printer sent', () => {
    const p = stampReceived({ checkedIn: 3, at: 1000 }, 5000);
    expect(p).toEqual({ checkedIn: 3, at: 1000, receivedAt: 5000 });
    expect(stampOf(p)).toBe(5000);
  });
  it('falls back to the printer\'s at only for an unstamped payload', () => {
    expect(stampOf({ at: 42 })).toBe(42);
    expect(stampOf(null)).toBeUndefined();
    expect(stampOf(undefined)).toBeUndefined();
  });
  it('a printer clock far ahead of this screen does not make a fresh payload stale', () => {
    const now = 10_000_000;
    const p = stampReceived({ at: now + 20 * 60 * 1000 }, now);   // the printer is twenty minutes fast
    expect(isFresh(stampOf(p), 10 * 60 * 1000, now + 1000)).toBe(true);
    expect(isFresh(p.at, 10 * 60 * 1000, now + 1000)).toBe(true);   // and never false either way
    const q = stampReceived({ at: now - 20 * 60 * 1000 }, now);   // or twenty minutes slow
    expect(isFresh(stampOf(q), 10 * 60 * 1000, now + 1000)).toBe(true);
    expect(isFresh(q.at, 10 * 60 * 1000, now + 1000)).toBe(false);   // this is what the widgets used to read
  });
  it('a payload the printer stamped more than the tolerance ago really is old: its own at is believed', () => {
    const now = 10_000_000_000;
    const replayed = stampReceived({ at: now - CLOCK_SKEW_TOLERANCE_MS - 1 }, now);   // last week's frame, replayed on connect
    expect(stampOf(replayed)).toBe(replayed.at);
    expect(isFresh(stampOf(replayed), 15 * 60 * 1000, now)).toBe(false);   // two hours old is old for a 15-minute rule
    const skewed = stampReceived({ at: now - CLOCK_SKEW_TOLERANCE_MS + 1 }, now);     // within the tolerance: clocks apart
    expect(stampOf(skewed)).toBe(now);
  });
});
