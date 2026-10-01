import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// The ?now= offset is computed once at module load, so each test resets
// the module registry, points the jsdom URL where it wants, pins the
// system clock, and imports a fresh copy of the module.
const REAL_TIME = new Date(2026, 6, 15, 12, 0, 0, 0); // exact second boundary

async function loadClock(search) {
  vi.resetModules();
  window.history.replaceState(null, '', search || '/');
  return import('./useClock.js');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(REAL_TIME);
});

afterEach(() => {
  vi.useRealTimers();
  window.history.replaceState(null, '', '/');
});

describe('?now= time-travel offset', () => {
  it('shifts currentTime() to the simulated moment and keeps ticking', async () => {
    const { currentTime } = await loadClock('/?now=2026-09-16T18:04:00');
    const simulated = new Date('2026-09-16T18:04:00').getTime();
    expect(currentTime().getTime()).toBe(simulated);

    // The offset is fixed at load; the simulated clock still moves.
    vi.advanceTimersByTime(5000);
    expect(currentTime().getTime()).toBe(simulated + 5000);
  });

  it('ignores an unparseable ?now= value', async () => {
    const { currentTime } = await loadClock('/?now=banana');
    expect(currentTime().getTime()).toBe(REAL_TIME.getTime());
  });

  it('uses real time when no ?now= is present', async () => {
    const { currentTime } = await loadClock('/');
    expect(currentTime().getTime()).toBe(REAL_TIME.getTime());
  });
});

describe('useClock ticking', () => {
  it('starts at the current time and flips just past each second boundary', async () => {
    const { useClock } = await loadClock('/');
    const { result, unmount } = renderHook(() => useClock());
    expect(result.current.getTime()).toBe(REAL_TIME.getTime());

    // Armed for 1000 - (now % 1000) + 5 = 1005ms from an exact boundary.
    act(() => vi.advanceTimersByTime(1004));
    expect(result.current.getTime()).toBe(REAL_TIME.getTime());
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.getTime()).toBe(REAL_TIME.getTime() + 1005);

    // Drift correction: the next timeout re-anchors to the second, so the
    // displayed second flips again exactly 1000ms later (at +2005).
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.getTime()).toBe(REAL_TIME.getTime() + 2005);
    expect(result.current.getSeconds()).toBe(2);
    unmount();
  });

  it('honors the ?now= offset inside the hook too', async () => {
    const { useClock } = await loadClock('/?now=2026-09-16T18:04:00');
    const { result, unmount } = renderHook(() => useClock());
    expect(result.current.getTime()).toBe(new Date('2026-09-16T18:04:00').getTime());
    unmount();
  });
});
