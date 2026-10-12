import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './useWakeLock.js';

describe('useWakeLock', () => {
  let locks;
  beforeEach(() => {
    vi.useFakeTimers();
    locks = [];
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: vi.fn(async () => {
          const handlers = [];
          const lock = {
            addEventListener: (_n, fn) => handlers.push(fn),
            release: vi.fn(async () => {}),
            fire: () => handlers.forEach((fn) => fn()),
          };
          locks.push(lock);
          return lock;
        }),
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    delete navigator.wakeLock;
  });

  it('asks again after the OS releases the lock, with no visibility change', async () => {
    const { result } = renderHook(() => useWakeLock(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toBe('active');
    act(() => locks[0].fire());
    expect(result.current).toBe('denied');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(navigator.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('active');
  });
});
