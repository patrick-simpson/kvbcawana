import { describe, expect, it } from 'vitest';
import { sizeLadder, stepDown } from './sizeSearch.js';

describe('sizeLadder', () => {
  it('walks max down to min on the step, rounded to 0.01', () => {
    expect(sizeLadder(7.6, 7.2, 0.1)).toEqual([7.6, 7.5, 7.4, 7.3, 7.2]);
  });
  it('keeps a min that float drift would skip', () => {
    expect(sizeLadder(1, 0.7, 0.1).at(-1)).toBe(0.7);
  });
  it('is one size when max equals min, none when min is above max', () => {
    expect(sizeLadder(3, 3, 0.5)).toEqual([3]);
    expect(sizeLadder(3, 4, 0.5)).toEqual([]);
  });
});

describe('stepDown', () => {
  it('rounds the running size at every step', () => {
    expect([...stepDown(1, 0.7, 0.1, 3)]).toEqual([1, 0.9, 0.8, 0.7]);
  });
  it('is lazy: an early exit never builds the rest', () => {
    const it = stepDown(10, 0, 1, 3);
    expect(it.next().value).toBe(10);
    expect(it.next().value).toBe(9);
  });
  it('yields nothing when min is above max', () => {
    expect([...stepDown(1, 2, 0.1, 3)]).toEqual([]);
  });
});
