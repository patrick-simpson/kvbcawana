import { describe, expect, it } from 'vitest';
import { isFresh } from './freshness.js';

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
