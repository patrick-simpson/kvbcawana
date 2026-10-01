import { describe, expect, it } from 'vitest';
import { BLACKOUT_AFTER_MIN, shouldBlackout } from './idleBlackout.js';

const MIN = 60_000;

describe('shouldBlackout', () => {
  it('defaults to twenty minutes', () => {
    expect(BLACKOUT_AFTER_MIN).toBe(20);
  });

  it('stays lit right up to the threshold', () => {
    expect(shouldBlackout(0)).toBe(false);
    expect(shouldBlackout(19 * MIN)).toBe(false);
    expect(shouldBlackout(20 * MIN - 1)).toBe(false);
  });

  it('goes black at the threshold and stays black after it', () => {
    expect(shouldBlackout(20 * MIN)).toBe(true);
    expect(shouldBlackout(20 * MIN + 1)).toBe(true);
    expect(shouldBlackout(4 * 60 * MIN)).toBe(true);
  });

  it('honours a custom timeout', () => {
    expect(shouldBlackout(5 * MIN, 10)).toBe(false);
    expect(shouldBlackout(10 * MIN, 10)).toBe(true);
  });

  it('treats a zero or negative timeout as disabled, never as "black now"', () => {
    expect(shouldBlackout(10 * 60 * MIN, 0)).toBe(false);
    expect(shouldBlackout(10 * 60 * MIN, -5)).toBe(false);
  });

  it('never blacks out on an unusable idle value', () => {
    expect(shouldBlackout(NaN)).toBe(false);
    expect(shouldBlackout(Infinity, NaN)).toBe(false);
    expect(shouldBlackout(-1_000)).toBe(false);
  });
});
