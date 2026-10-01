import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCheckInQueue } from './useCheckInQueue.js';
import { MAX_QUEUE } from '../lib/constants.js';
import { RUN_EXIT_MS } from '../lib/checkInMoment.js';

const config = {
  standardDisplayMs: 6000,
  specialDisplayMs: 8000,
  gapBetweenBannersMs: 400,
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useCheckInQueue', () => {
  it('shows queued events one at a time in FIFO order', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      result.current.enqueue({ firstName: 'Amelia', club: 'Sparks' });
      result.current.enqueue({ firstName: 'Noah', club: 'Trek' });
    });

    expect(result.current.currentEvent.firstName).toBe('Amelia');
    expect(result.current.pending).toBe(1);

    // Amelia's full hold, then Noah flips in at once: same run, next step,
    // no gap and no moment where the banner is down.
    expect(result.current.run).toBe(1);
    expect(result.current.step).toBe(0);
    act(() => vi.advanceTimersByTime(5999));
    expect(result.current.currentEvent.firstName).toBe('Amelia');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentEvent.firstName).toBe('Noah');
    expect(result.current.run).toBe(1);
    expect(result.current.step).toBe(1);
    expect(result.current.pending).toBe(0);

    // Noah's hold ends with nobody waiting: the run ends and the banner leaves.
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentEvent).toBeNull();
  });

  it('starts a new run after the gap when someone arrives once the banner is down', () => {
    const { result } = renderHook(() => useCheckInQueue(config));
    act(() => result.current.enqueue({ firstName: 'Amelia' }));
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentEvent).toBeNull();

    // Arriving during the gap waits it out, then raises a fresh wave. The
    // gap is never shorter than the run's own exit (the configured 400 ms
    // is), or Noah's hold would tick away while Amelia's wave was still
    // dropping and his moment not yet mounted.
    act(() => result.current.enqueue({ firstName: 'Noah' }));
    expect(result.current.currentEvent).toBeNull();
    act(() => vi.advanceTimersByTime(RUN_EXIT_MS - 1));
    expect(result.current.currentEvent).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentEvent.firstName).toBe('Noah');
    expect(result.current.run).toBe(2);
    expect(result.current.step).toBe(0);
  });

  it('a gap longer than the exit is honoured as configured, and zero still waits out the exit', () => {
    for (const [gap, expected] of [[1500, 1500], [0, RUN_EXIT_MS]]) {
      const { result, unmount } = renderHook(() => useCheckInQueue({ ...config, gapBetweenBannersMs: gap }));
      act(() => result.current.enqueue({ firstName: 'Amelia' }));
      act(() => vi.advanceTimersByTime(6000));
      act(() => result.current.enqueue({ firstName: 'Noah' }));
      act(() => vi.advanceTimersByTime(expected - 1));
      expect(result.current.currentEvent).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(result.current.currentEvent.firstName).toBe('Noah');
      unmount();
    }
  });

  it('under zero animation (?lowPower=1) the exit is instant, so only the configured gap applies', () => {
    const { result } = renderHook(() => useCheckInQueue({ ...config, reduceMotion: true }));
    act(() => result.current.enqueue({ firstName: 'Amelia' }));
    act(() => vi.advanceTimersByTime(6000));
    act(() => result.current.enqueue({ firstName: 'Noah' }));
    act(() => vi.advanceTimersByTime(400));
    expect(result.current.currentEvent.firstName).toBe('Noah');
  });

  it('reports the gap: true from the moment a run ends until the next may start, never while idle', () => {
    // The first-run card judges "a name is up" by the child on screen OR the
    // gap, because the gap is never shorter than the run's own exit.
    const { result } = renderHook(() => useCheckInQueue(config));
    expect(result.current.gap).toBe(false);
    act(() => result.current.enqueue({ firstName: 'Amelia' }));
    expect(result.current.gap).toBe(false);
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.gap).toBe(true);
    act(() => vi.advanceTimersByTime(RUN_EXIT_MS - 1));
    expect(result.current.gap).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.gap).toBe(false);
  });

  it('a child who flips in on the same run leaves no gap between them', () => {
    const { result } = renderHook(() => useCheckInQueue(config));
    act(() => {
      result.current.enqueue({ firstName: 'Amelia' });
      result.current.enqueue({ firstName: 'Noah' });
    });
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentEvent.firstName).toBe('Noah');
    expect(result.current.gap).toBe(false);
  });

  it('holds birthday and first-timer banners longer', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => result.current.enqueue({ firstName: 'Ava', isBirthday: true }));
    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.currentEvent?.firstName).toBe('Ava');
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.currentEvent).toBeNull();
  });

  it('ignores payloads without a firstName', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      result.current.enqueue(null);
      result.current.enqueue({ club: 'Sparks' });
    });

    expect(result.current.currentEvent).toBeNull();
    expect(result.current.pending).toBe(0);
  });

  it('skipCurrent dismisses the banner and moves on after the gap', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      result.current.enqueue({ firstName: 'Liam' });
      result.current.enqueue({ firstName: 'Emma' });
    });
    expect(result.current.currentEvent.firstName).toBe('Liam');

    act(() => result.current.skipCurrent());
    expect(result.current.currentEvent).toBeNull();
    act(() => vi.advanceTimersByTime(RUN_EXIT_MS));
    expect(result.current.currentEvent.firstName).toBe('Emma');
  });

  it('never shortens anyone during a rush: every child gets the full hold', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      for (let i = 0; i < 10; i++) {
        result.current.enqueue({ firstName: `Kid${i}`, isBirthday: i === 3 });
      }
    });

    // Ten children waiting is a real rush, and still each holds 6 s (the
    // birthday child the special 8 s), flipping in one after another.
    let at = 0;
    for (let i = 0; i < 10; i++) {
      const hold = i === 3 ? 8000 : 6000;
      expect(result.current.currentEvent.firstName).toBe(`Kid${i}`);
      expect(result.current.step).toBe(i);
      act(() => vi.advanceTimersByTime(hold - 1));
      expect(result.current.currentEvent.firstName).toBe(`Kid${i}`);
      act(() => vi.advanceTimersByTime(1));
      at += hold;
    }
    expect(at).toBe(62000);
    expect(result.current.currentEvent).toBeNull();
    expect(result.current.run).toBe(1);
  });

  it('survives broken duration config without flashing banners', () => {
    const { result } = renderHook(() => useCheckInQueue({
      ...config,
      standardDisplayMs: NaN,
    }));

    act(() => result.current.enqueue({ firstName: 'Mason' }));
    expect(result.current.currentEvent.firstName).toBe('Mason');

    // Falls back to the 6s default instead of firing immediately.
    act(() => vi.advanceTimersByTime(5999));
    expect(result.current.currentEvent?.firstName).toBe('Mason');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.currentEvent).toBeNull();
  });

  it('caps the queue at MAX_QUEUE against a runaway feed', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      for (let i = 0; i < MAX_QUEUE + 50; i++) {
        result.current.enqueue({ firstName: `Kid${i}` });
      }
    });

    // One on screen + the capped queue: never more than MAX_QUEUE in flight.
    expect(result.current.currentEvent.firstName).toBe('Kid0');
    expect(result.current.pending).toBe(MAX_QUEUE - 1);
  });

  it('normalizes the presentation field to live/replay/late only', () => {
    const { result } = renderHook(() => useCheckInQueue(config));

    act(() => {
      result.current.enqueue({ firstName: 'Zoe', presentation: 'replay' });
      result.current.enqueue({ firstName: 'Eli', presentation: 'late' });
      result.current.enqueue({ firstName: 'Ivy', presentation: 'sneaky-html' });
      result.current.enqueue({ firstName: 'Max' });
    });

    expect(result.current.currentEvent.presentation).toBe('replay');
    for (const expected of ['late', 'live', 'live']) {
      act(() => vi.advanceTimersByTime(6000)); // full hold, then the next flips in
      expect(result.current.currentEvent.presentation).toBe(expected);
    }
  });
});
