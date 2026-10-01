import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutEffect } from 'react';
import { act, renderHook } from '@testing-library/react';
import { useLinger } from './useLinger.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useLinger', () => {
  it('rises with the flag at once, and falls only after the linger', () => {
    const { result, rerender } = renderHook(({ flag }) => useLinger(flag, 1000), { initialProps: { flag: false } });
    expect(result.current).toBe(false);
    rerender({ flag: true });
    expect(result.current).toBe(true);

    rerender({ flag: false });
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('is already lingering in the very commit the flag falls in, never a frame late', () => {
    // An effect that started the linger would commit one frame with the flag
    // off and the linger not yet on: the frame this exists to remove. (The
    // render React throws away and re-runs on the spot is not a frame, so
    // what is recorded is what was committed.)
    const committed = [];
    const { rerender } = renderHook(({ flag }) => {
      const v = useLinger(flag, 1000);
      useLayoutEffect(() => { committed.push([flag, v]); });
      return v;
    }, { initialProps: { flag: true } });
    rerender({ flag: false });
    const falling = committed.filter(([flag]) => flag === false);
    expect(falling.length).toBeGreaterThan(0);
    expect(falling.every(([, v]) => v === true)).toBe(true);
  });

  it('a flag that comes back during the linger keeps it up, and the old timer cannot end it', () => {
    const { result, rerender } = renderHook(({ flag }) => useLinger(flag, 1000), { initialProps: { flag: true } });
    rerender({ flag: false });
    act(() => vi.advanceTimersByTime(600));
    rerender({ flag: true });
    act(() => vi.advanceTimersByTime(600));
    expect(result.current).toBe(true);
    // ...and the next fall gets a whole linger of its own.
    rerender({ flag: false });
    act(() => vi.advanceTimersByTime(999));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false);
  });

  it('a linger of zero (nothing is leaving) follows the flag exactly', () => {
    const { result, rerender } = renderHook(({ flag }) => useLinger(flag, 0), { initialProps: { flag: true } });
    expect(result.current).toBe(true);
    rerender({ flag: false });
    expect(result.current).toBe(false);
  });

  it('a flag that starts false never lingers', () => {
    const { result } = renderHook(() => useLinger(false, 1000));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(5000));
    expect(result.current).toBe(false);
  });
});
