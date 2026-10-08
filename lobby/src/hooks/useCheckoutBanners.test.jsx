import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCheckoutBanners } from './useCheckoutBanners.js';

const name = (n) => ({ kind: 'name', firstName: n, club: 'Sparks' });

afterEach(() => vi.useRealTimers());

describe('useCheckoutBanners', () => {
  it('shows one banner at a time, each for its hold', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCheckoutBanners({ holdMs: 3000 }));
    act(() => result.current.add([name('Ava'), name('Liam')]));
    expect(result.current.current).toMatchObject({ firstName: 'Ava' });
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.current).toMatchObject({ firstName: 'Ava' });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.current).toMatchObject({ firstName: 'Liam' });
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.current).toBeNull();
  });

  it('waits, unseen, while a check-in is up, then gives the head its full time', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ held }) => useCheckoutBanners({ held, holdMs: 3000 }), { initialProps: { held: false } });
    act(() => result.current.add([name('Ava')]));
    act(() => vi.advanceTimersByTime(2000));
    rerender({ held: true });
    expect(result.current.current).toBeNull();
    act(() => vi.advanceTimersByTime(10_000));
    rerender({ held: false });
    expect(result.current.current).toMatchObject({ firstName: 'Ava' });
    act(() => vi.advanceTimersByTime(2999));
    expect(result.current.current).toMatchObject({ firstName: 'Ava' });
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.current).toBeNull();
  });

  it('collapses a rush past six into one line, and clears', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCheckoutBanners({ holdMs: 3000 }));
    act(() => result.current.add(Array.from({ length: 10 }, (_, i) => name(`K${i}`))));
    for (let i = 0; i < 6; i += 1) act(() => vi.advanceTimersByTime(3000));
    expect(result.current.current).toMatchObject({ kind: 'more', count: 4 });
    act(() => result.current.clear());
    expect(result.current.current).toBeNull();
  });
});
