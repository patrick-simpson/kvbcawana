import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCelebrationQueue } from './useCelebrationQueue.js';

const HOLD = 1000;

// `onReady` rather than mutating a ref prop: the lint rule that forbids
// writing to props is right, and a callback keeps the harness honest about
// re-render timing.
function Harness({ onReady }) {
  const queue = useCelebrationQueue(HOLD);
  onReady(queue);
  return <div data-testid="current">{queue.current ? JSON.stringify(queue.current) : 'none'}</div>;
}

function setup() {
  const api = { current: null };
  const view = render(<Harness onReady={(q) => { api.current = q; }} />);
  return { api, view };
}

describe('useCelebrationQueue', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows nothing initially', () => {
    const { api } = setup();
    expect(api.current.current).toBeNull();
  });

  it('promotes the first enqueued celebration immediately', () => {
    const { api } = setup();
    act(() => { api.current.enqueue({ kind: 'tally', count: 25 }); });
    expect(api.current.current).toMatchObject({ kind: 'tally', count: 25 });
  });

  it('holds the second one back instead of overlapping', () => {
    // The whole point: a night milestone and a club milestone firing in the
    // same instant used to render two toasts into the same corner.
    const { api } = setup();
    act(() => {
      api.current.enqueue({ kind: 'night', count: 100 });
      api.current.enqueue({ kind: 'club', club: 'Sparks', count: 10 });
    });
    expect(api.current.current).toMatchObject({ kind: 'night' });
    expect(api.current.depth()).toBe(1);
  });

  it('promotes the queued one after the hold elapses', () => {
    const { api } = setup();
    act(() => {
      api.current.enqueue({ kind: 'night', count: 100 });
      api.current.enqueue({ kind: 'club', club: 'Sparks', count: 10 });
    });
    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toMatchObject({ kind: 'club', club: 'Sparks' });
    expect(api.current.depth()).toBe(0);
  });

  it('clears once the queue is drained', () => {
    const { api } = setup();
    act(() => { api.current.enqueue({ kind: 'tally', count: 25 }); });
    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toBeNull();
  });

  it('preserves order across a long queue', () => {
    const { api } = setup();
    act(() => {
      for (let i = 1; i <= 4; i++) api.current.enqueue({ kind: 'tally', count: i });
    });
    const seen = [];
    for (let i = 0; i < 4; i++) {
      seen.push(api.current.current.count);
      act(() => { vi.advanceTimersByTime(HOLD + 10); });
    }
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  // #358 — handbook progress adds two more kinds that fire off the SAME
  // `tonight` broadcast as the night thresholds, so all three can land in one
  // instant. The queue is the only thing keeping them from stacking up in one
  // corner with three confetti bursts on top of each other.
  it('shows three simultaneous kinds one at a time, in arrival order', () => {
    const { api } = setup();
    act(() => {
      api.current.enqueue({ kind: 'night', count: 100, label: 'Triple digits', headline: '100 kids tonight!' });
      api.current.enqueue({ kind: 'books', count: 10, label: 'Handbooks', headline: '10 books finished tonight!' });
      api.current.enqueue({ kind: 'awards', count: 25, label: 'Awards earned', headline: '25 awards earned tonight!' });
    });
    expect(api.current.current).toMatchObject({ kind: 'night' });
    expect(api.current.depth()).toBe(2);

    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toMatchObject({ kind: 'books', headline: '10 books finished tonight!' });
    expect(api.current.depth()).toBe(1);

    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toMatchObject({ kind: 'awards', headline: '25 awards earned tonight!' });
    expect(api.current.depth()).toBe(0);

    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toBeNull();
  });

  it('ignores null enqueues', () => {
    const { api } = setup();
    act(() => { api.current.enqueue(null); api.current.enqueue(undefined); });
    expect(api.current.current).toBeNull();
    expect(api.current.depth()).toBe(0);
  });

  it('accepts a new celebration while one is showing and after it clears', () => {
    const { api } = setup();
    act(() => { api.current.enqueue({ kind: 'tally', count: 25 }); });
    act(() => { vi.advanceTimersByTime(HOLD + 10); });
    expect(api.current.current).toBeNull();
    act(() => { api.current.enqueue({ kind: 'tally', count: 50 }); });
    expect(api.current.current).toMatchObject({ count: 50 });
  });
});

describe('useCelebrationQueue while the lobby holds check-ins', () => {
  it('brings nothing new forward while held, and catches up when the hold lifts', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ held }) => useCelebrationQueue(3000, { held }), { initialProps: { held: true } });
      act(() => { result.current.enqueue({ kind: 'first', firstName: 'Maya' }); });
      expect(result.current.current).toBeNull();
      rerender({ held: false });
      expect(result.current.current).toMatchObject({ kind: 'first', firstName: 'Maya' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a celebration already on screen finish when a hold begins', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(({ held }) => useCelebrationQueue(3000, { held }), { initialProps: { held: false } });
      act(() => { result.current.enqueue({ kind: 'tally', count: 25 }); });
      act(() => { result.current.enqueue({ kind: 'tally', count: 50 }); });
      expect(result.current.current).toMatchObject({ count: 25 });
      rerender({ held: true });
      expect(result.current.current).toMatchObject({ count: 25 });
      act(() => vi.advanceTimersByTime(3000));
      // The next one waits for the hold to lift.
      expect(result.current.current).toBeNull();
      rerender({ held: false });
      expect(result.current.current).toMatchObject({ count: 50 });
    } finally {
      vi.useRealTimers();
    }
  });
});
