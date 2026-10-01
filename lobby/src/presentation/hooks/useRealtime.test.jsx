import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// useRealtime's only socket-adjacent dependency — stub it so this test
// drives the handlers directly instead of standing up real Pusher.
const socketHandlers = { current: null };
vi.mock('../../hooks/useSocket.js', () => ({
  useSocket: vi.fn((handlers) => {
    socketHandlers.current = handlers;
    return { status: 'connected' };
  }),
}));

import { useRealtime } from './useRealtime.js';
import { _resetForTest as resetConfigStore } from '../../hooks/useConfig.js';

afterEach(() => { cleanup(); /* no global RTL cleanup in this repo — hooks share one config store */
  localStorage.clear();
  socketHandlers.current = null;
});

beforeEach(() => {
  resetConfigStore();
  // Clean querystring between tests (the ?key=/&cluster= adoption chore).
  window.history.replaceState({}, '', '/');
});

describe('useRealtime — schedule broadcast', () => {
  it('starts with no schedule advisory', () => {
    const { result } = renderHook(() => useRealtime());
    expect(result.current.schedule).toBeNull();
  });

  it('onSchedule adapts the sanitized payload, keeping only the advisory fields', () => {
    const { result } = renderHook(() => useRealtime());
    act(() => {
      socketHandlers.current.onSchedule({
        at: 1_800_000_000_000,
        nextMeetingDate: '2026-09-16',
        title: 'Family Fun Night',
        noClubThisWeek: false,
      });
    });
    expect(result.current.schedule).toEqual({
      at: new Date(1_800_000_000_000),
      nextMeetingDate: '2026-09-16',
      title: 'Family Fun Night',
      noClubThisWeek: false,
    });
  });

  it('passes through a bare noClubThisWeek broadcast with no date/title', () => {
    const { result } = renderHook(() => useRealtime());
    act(() => {
      socketHandlers.current.onSchedule({ at: 1000, noClubThisWeek: true });
    });
    expect(result.current.schedule.noClubThisWeek).toBe(true);
    expect(result.current.schedule.nextMeetingDate).toBeUndefined();
    expect(result.current.schedule.title).toBeUndefined();
  });
});

describe('useRealtime — existing tally/birthdays wiring is unaffected', () => {
  it('onTally still adapts to { counts, total, at: Date }', () => {
    const { result } = renderHook(() => useRealtime());
    act(() => {
      socketHandlers.current.onTally({ counts: { Sparks: 4 }, total: 4, at: 1000 });
    });
    expect(result.current.tally).toEqual({ counts: { Sparks: 4 }, total: 4, at: new Date(1000) });
  });

  it('registers all three handlers with useSocket', () => {
    renderHook(() => useRealtime());
    expect(Object.keys(socketHandlers.current).sort()).toEqual(
      ['onBirthdays', 'onSchedule', 'onTally'].sort(),
    );
  });
});
