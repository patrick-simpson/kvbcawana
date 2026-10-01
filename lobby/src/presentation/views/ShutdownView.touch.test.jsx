import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// The end-of-night screen on a phone or tablet: a finger taps a screen it is
// reading, so only Start Over starts the evening again (on the PC the whole
// screen is a restart click); there is no Space bar to mention; and a finger
// on the screen is the activity that keeps it lit, as a mouse move is on the PC.

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('../lib/touch.js', () => ({ useTouch: () => device.touch, usePortrait: () => false }));
vi.mock('../lib/flags.js', () => ({ FLAGS: { freeze: false, vr: false } }));

const { ShutdownView } = await import('./ShutdownView.jsx');
const { BLACKOUT_AFTER_MIN } = await import('../lib/idleBlackout.js');

const START = new Date('2026-09-16T19:40:00');
const at = (min) => new Date(START.getTime() + min * 60_000);

beforeEach(() => {
  device.touch = true;
});
afterEach(cleanup);

describe('the shutdown screen on touch', () => {
  it('restarts only from Start Over, never from a tap on its words', () => {
    const onRestart = vi.fn();
    const { container } = render(<ShutdownView now={START} onRestart={onRestart} />);
    act(() => { fireEvent.click(container.querySelector('.pj-frame')); });
    // A word of "SEE YOU NEXT WEEK!" and one of "Have a safe drive home!".
    act(() => { fireEvent.click(container.querySelector('.pj-headline .w')); });
    act(() => { fireEvent.click(container.querySelector('.pj-body .w')); });
    expect(onRestart).not.toHaveBeenCalled();
    act(() => { fireEvent.click(screen.getByRole('button', { name: /Start Over/ })); });
    expect(onRestart).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/or press Space/);
  });

  it('a finger on the screen is activity: it keeps the screen lit', () => {
    const { container, rerender } = render(<ShutdownView now={START} onRestart={() => {}} />);
    rerender(<ShutdownView now={at(BLACKOUT_AFTER_MIN - 1)} onRestart={() => {}} />);
    act(() => { fireEvent.pointerDown(window); });
    rerender(<ShutdownView now={at(BLACKOUT_AFTER_MIN + 2)} onRestart={() => {}} />);
    expect(container.querySelector('[data-blackout]')).toBeNull();
  });

  it('a tap on the idle blackout wakes it, and does not restart the evening', () => {
    const onRestart = vi.fn();
    const { container, rerender } = render(<ShutdownView now={START} onRestart={onRestart} />);
    rerender(<ShutdownView now={at(BLACKOUT_AFTER_MIN)} onRestart={onRestart} />);
    const black = container.querySelector('[data-blackout]');
    expect(black).not.toBeNull();
    act(() => { fireEvent.click(black); });
    expect(container.querySelector('[data-blackout]')).toBeNull();
    expect(onRestart).not.toHaveBeenCalled();
  });

  it('on the PC the whole screen restarts, and Space is offered', () => {
    device.touch = false;
    const onRestart = vi.fn();
    const { container } = render(<ShutdownView now={START} onRestart={onRestart} />);
    expect(container.textContent).toMatch(/or press Space/);
    act(() => { fireEvent.click(container.querySelector('.pj-frame')); });
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});
