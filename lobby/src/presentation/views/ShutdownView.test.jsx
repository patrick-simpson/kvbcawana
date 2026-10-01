import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

// FLAGS is read once at module load from the real URL, so the vr case
// needs a mock we can flip between tests.
const { flags } = vi.hoisted(() => ({ flags: { freeze: false, vr: false } }));
vi.mock('../lib/flags.js', () => ({ FLAGS: flags }));

import { ShutdownView } from './ShutdownView.jsx';
import { BLACKOUT_AFTER_MIN } from '../lib/idleBlackout.js';

const START = new Date('2026-09-16T19:40:00');
/** `now`, `minutes` after the screen first appeared. */
const at = (minutes) => new Date(START.getTime() + minutes * 60_000);

const view = (now, onRestart = () => {}) => <ShutdownView now={now} onRestart={onRestart} />;

const isBlack = (container) => container.querySelector('[data-blackout="1"]') !== null;

describe('ShutdownView idle blackout', () => {
  beforeEach(() => {
    flags.vr = false;
  });
  afterEach(cleanup);

  it('shows the full screen immediately on mount', () => {
    const { container } = render(view(START));
    expect(isBlack(container)).toBe(false);
    expect(container.textContent).toMatch(/SEE YOU NEXT WEEK/i);
  });

  it('stays lit right up to the threshold, then goes black', () => {
    const { container, rerender } = render(view(START));
    rerender(view(at(BLACKOUT_AFTER_MIN - 1)));
    expect(isBlack(container)).toBe(false);
    expect(container.textContent).toMatch(/SEE YOU NEXT WEEK/i);

    rerender(view(at(BLACKOUT_AFTER_MIN)));
    expect(isBlack(container)).toBe(true);
    // Nothing but black: every ambient layer is gone with it.
    expect(container.textContent).toBe('');
  });

  it('wakes on a mouse move and stays awake for another full timeout', () => {
    const { container, rerender } = render(view(START));
    rerender(view(at(BLACKOUT_AFTER_MIN)));
    expect(isBlack(container)).toBe(true);

    act(() => {
      fireEvent.mouseMove(window);
    });
    expect(isBlack(container)).toBe(false);
    expect(container.textContent).toMatch(/SEE YOU NEXT WEEK/i);

    // The idle clock restarted from the wake, not from mount.
    rerender(view(at(2 * BLACKOUT_AFTER_MIN - 1)));
    expect(isBlack(container)).toBe(false);
    rerender(view(at(2 * BLACKOUT_AFTER_MIN)));
    expect(isBlack(container)).toBe(true);
  });

  it('wakes on any key without restarting the evening', () => {
    const onRestart = vi.fn();
    const { container, rerender } = render(view(START, onRestart));
    rerender(view(at(BLACKOUT_AFTER_MIN), onRestart));
    expect(isBlack(container)).toBe(true);

    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(isBlack(container)).toBe(false);
    expect(onRestart).not.toHaveBeenCalled();

    // A second press, now against a screen the operator can see, does.
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('restarts on Space as before while the screen is awake', () => {
    const onRestart = vi.fn();
    render(view(START, onRestart));
    act(() => {
      fireEvent.keyDown(window, { code: 'Space' });
    });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('never blacks out under ?vr=1, so screenshots capture the view', () => {
    flags.vr = true;
    const { container, rerender } = render(view(START));
    rerender(view(at(10 * BLACKOUT_AFTER_MIN)));
    expect(isBlack(container)).toBe(false);
    expect(container.textContent).toMatch(/SEE YOU NEXT WEEK/i);
  });

  it('reports the blackout as a bare wall (App takes the Awana Clubs mark with it)', () => {
    const onBareChange = vi.fn();
    const { rerender, unmount } = render(<ShutdownView now={START} onRestart={() => {}} onBareChange={onBareChange} />);
    expect(onBareChange).toHaveBeenLastCalledWith(false);
    rerender(<ShutdownView now={at(BLACKOUT_AFTER_MIN)} onRestart={() => {}} onBareChange={onBareChange} />);
    expect(onBareChange).toHaveBeenLastCalledWith(true);
    act(() => {
      fireEvent.mouseMove(window);
    });
    expect(onBareChange).toHaveBeenLastCalledWith(false);
    rerender(<ShutdownView now={at(2 * BLACKOUT_AFTER_MIN)} onRestart={() => {}} onBareChange={onBareChange} />);
    expect(onBareChange).toHaveBeenLastCalledWith(true);
    unmount();
    // Leaving the view always gives the mark back.
    expect(onBareChange).toHaveBeenLastCalledWith(false);
  });

  it('never blacks out without a clock to measure against', () => {
    const { container, rerender } = render(view(undefined));
    rerender(view(undefined));
    expect(isBlack(container)).toBe(false);
  });
});
