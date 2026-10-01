import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import CornerChip from './CornerChip.jsx';
import { useCornerItem } from '../hooks/useCornerItem.js';

afterEach(cleanup);
const still = (ui) => <ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>;

const clock = { id: 'clock', label: 'Right now', value: '7:56', spoken: 'The time is 7:56 PM', corner: 'bottom' };
const weather = { id: 'weather', label: 'Overcast', value: '58°', spoken: '58 degrees, Overcast', corner: 'top' };

describe('CornerChip', () => {
  it('shows the item only in its own corner, as a stepped chip', async () => {
    const { container, rerender } = render(still(<CornerChip item={clock} corner="bottom" loads={1} />));
    expect(container.querySelector('.step-chip').getAttribute('aria-label')).toBe('RIGHT NOW 7:56');
    rerender(still(<CornerChip item={clock} corner="top" loads={1} />));
    await waitFor(() => expect(container.querySelector('.step-chip')).toBeNull());
    rerender(still(<CornerChip item={weather} corner="top" loads={2} />));
    expect(container.querySelector('.step-chip').getAttribute('aria-label')).toBe('OVERCAST 58°');
  });

  it('steps aside when hidden (a slide that holds check-ins)', () => {
    const { container } = render(still(<CornerChip item={clock} corner="bottom" loads={1} hidden />));
    expect(container.querySelector('.corner-chip')).toBeNull();
  });

  it('shows the note its snapshot carries, unless Settings turned notes off', async () => {
    const tally = {
      id: 'tally', label: 'Tonight', value: '78', spoken: '78 checked in tonight', corner: 'bottom', note: 'synced',
      correction: { from: 75, to: 78 },
    };
    const { container, rerender } = render(still(<CornerChip item={tally} corner="bottom" loads={1} />));
    expect(container.querySelector('.corner-chip__note').textContent).toBe('synced');
    // Gated at render: switching it off hides one that is already up.
    rerender(still(<CornerChip item={tally} corner="bottom" loads={1} showNote={false} />));
    expect(container.querySelector('.corner-chip__note')).toBeNull();
    // A snapshot with no note has none, whatever the setting.
    rerender(still(<CornerChip item={clock} corner="bottom" loads={2} />));
    await waitFor(() => expect(container.querySelector('.corner-chip__note')).toBeNull());
  });

  it("the pickup count always says what it is: the setting only hides a correction's note", () => {
    const pickup = {
      id: 'tally', label: 'Pickup', value: '12', spoken: '12 not checked out yet', corner: 'bottom',
      note: 'not checked out yet', correction: null,
    };
    const { container } = render(still(<CornerChip item={pickup} corner="bottom" loads={1} showNote={false} />));
    expect(container.querySelector('.corner-chip__note').textContent).toBe('not checked out yet');
    expect(container.textContent).toContain('PICKUP');
  });
});

describe('useCornerItem', () => {
  const source = (tally) => ({ clock: true, tally, weather: null });

  it('moves one item per slide load and freezes its value until the next', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 19, 56, 0));
    try {
      const { result, rerender } = renderHook(({ s }) => useCornerItem(s), { initialProps: { s: source(5) } });
      expect(result.current.item).toBeNull();
      act(() => result.current.advance());
      expect(result.current.item).toMatchObject({ id: 'clock', value: '7:56' });
      // Time passes and the count moves, but nothing on the corner changes...
      act(() => vi.advanceTimersByTime(3 * 60 * 1000));
      rerender({ s: source(9) });
      expect(result.current.item).toMatchObject({ id: 'clock', value: '7:56' });
      // ...until the next slide loads: the tally, as it is now.
      act(() => result.current.advance());
      expect(result.current.item).toMatchObject({ id: 'tally', value: '9' });
      act(() => result.current.advance());
      expect(result.current.item).toMatchObject({ id: 'clock', value: '7:59' });
      expect(result.current.loads).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tells onShown about every load, whichever path made it', () => {
    vi.useFakeTimers();
    try {
      const onShown = vi.fn();
      const { result } = renderHook(() => useCornerItem(source(5), { fallbackMs: 8000, onShown }));
      act(() => vi.advanceTimersByTime(0));
      expect(onShown).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'clock' }));
      act(() => result.current.advance());
      expect(onShown).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'tally', value: '5' }));
      expect(onShown).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries a correction into the next tally load only', () => {
    const correction = { from: 80, to: 78 };
    const { result, rerender } = renderHook(({ s }) => useCornerItem(s), {
      initialProps: { s: { clock: true, tally: 78, weather: null, correction } },
    });
    act(() => result.current.advance());
    expect(result.current.item).toMatchObject({ id: 'clock' });
    act(() => result.current.advance());
    expect(result.current.item).toMatchObject({ id: 'tally', value: '78', note: 'synced with the check-in desk' });
    // App spends the latch once the corner has carried it.
    rerender({ s: { clock: true, tally: 78, weather: null, correction: null } });
    act(() => result.current.advance());
    act(() => result.current.advance());
    expect(result.current.item).toMatchObject({ id: 'tally', note: null });
  });

  it('with no slides to follow, a timer stands in for the slide loads', () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useCornerItem(source(5), { fallbackMs: 8000 }));
      act(() => vi.advanceTimersByTime(0));
      expect(result.current.item?.id).toBe('clock');
      act(() => vi.advanceTimersByTime(8000));
      expect(result.current.item?.id).toBe('tally');
    } finally {
      vi.useRealTimers();
    }
  });
});
