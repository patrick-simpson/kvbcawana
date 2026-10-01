import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

// A slide deck on a phone or tablet: the wall is the clicker (a swipe, or a
// tap in a zone), the closing blackout included, and Exit is a visible button
// pressed twice. The PC's hover pill and invisible edge zone are not there.
// (SlideshowView.test.jsx is the PC's deck, and stays as it was.)

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('../lib/touch.js', async (importActual) => ({
  ...(await importActual()),
  useTouch: () => device.touch,
}));
vi.mock('../hooks/useCalendarEvents.js', () => ({ useCalendarEvents: () => [] }));

const { SlideshowView } = await import('./SlideshowView.jsx');

const NOW = new Date('2026-09-16T18:00:30');
const ORDER = ['welcome', 'us-pledge', 'awana-pledge', 'black-slide'];
const current = (c) => c.querySelector('[data-slide]').dataset.slide;
const wall = (c) => c.querySelector('[data-slide]');
const W = window.innerWidth;

/** A finger down at (x, y), moved by (dx, dy), up `dt` ms later. */
function finger(el, { x = 0.8 * W, y = 300, dx = 0, dy = 0, dt = 80 } = {}) {
  const t0 = performance.now();
  act(() => {
    fireEvent.pointerDown(el, { pointerId: 7, isPrimary: true, clientX: x, clientY: y, timeStamp: t0 });
  });
  act(() => {
    const up = new window.Event('pointerup', { bubbles: true });
    Object.assign(up, { pointerId: 7, isPrimary: true, clientX: x + dx, clientY: y + dy });
    Object.defineProperty(up, 'timeStamp', { value: t0 + dt });
    el.dispatchEvent(up);
  });
}

beforeEach(() => {
  device.touch = true;
});
afterEach(cleanup);

describe('SlideshowView on touch', () => {
  it('has visible controls and no hover pill or invisible edge zone', () => {
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    expect(container.querySelector('[data-slideshow-nav]')).toBeNull();
    expect(container.querySelector('[aria-label="Next Slide"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Exit the slides' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous slide' }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Next slide' }).disabled).toBe(false);
  });

  it('a tap on the right of the wall is Next, on the left Prev', () => {
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    finger(wall(container), { x: 0.8 * W });
    expect(current(container)).toBe(ORDER[1]);
    finger(wall(container), { x: 0.5 * W });
    expect(current(container)).toBe(ORDER[2]);
    finger(wall(container), { x: 0.1 * W });
    expect(current(container)).toBe(ORDER[1]);
  });

  it('a swipe left is Next, right is Prev; a drag up the wall does nothing', () => {
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    finger(wall(container), { x: 0.2 * W, dx: -120, dy: 12 });
    expect(current(container)).toBe(ORDER[1]);
    finger(wall(container), { x: 0.9 * W, dx: 120 });
    expect(current(container)).toBe(ORDER[0]);
    finger(wall(container), { dx: -30, dy: -200 });
    expect(current(container)).toBe(ORDER[0]);
    // And it sweeps like a key press: every change its own sweep.
    expect(container.querySelectorAll('[data-sweep]').length).toBe(2);
  });

  it('the closing blackout answers a tap too: one more and games start', () => {
    const onFinish = vi.fn();
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} onFinish={onFinish} />);
    for (let i = 0; i < 3; i++) finger(wall(container));
    expect(current(container)).toBe(ORDER[3]);
    expect(onFinish).not.toHaveBeenCalled();
    finger(wall(container));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('a tap on a control is that control only, never also a tap zone', () => {
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    const next = screen.getByRole('button', { name: 'Next slide' });
    finger(next);
    act(() => { fireEvent.click(next); });
    expect(current(container)).toBe(ORDER[1]);
  });

  it('Exit is pressed twice, with the toast between saying so', () => {
    const onExit = vi.fn();
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={onExit} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Exit the slides' })); });
    expect(onExit).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="EXIT SLIDES Tap Exit again"]')).not.toBeNull();
    // The toast is a bottom overlay the setup note yields to, as on the PC.
    expect(container.querySelector('[data-pj-bottom-overlay]')).not.toBeNull();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Tap again to exit the slides' })); });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('keeps the keyboard, for a tablet that has one', () => {
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    act(() => { fireEvent.keyDown(window, { code: 'ArrowRight' }); });
    expect(current(container)).toBe(ORDER[1]);
  });

  it('on the PC, a pointer on the wall moves nothing (the arrows and the hover pill do)', () => {
    device.touch = false;
    const { container } = render(<SlideshowView deck="opening" now={NOW} onExit={() => {}} />);
    finger(wall(container), { dx: -150 });
    finger(wall(container));
    expect(current(container)).toBe(ORDER[0]);
    expect(container.querySelector('[data-slideshow-nav]')).not.toBeNull();
    expect(container.querySelector('[data-slideshow-touch-nav]')).toBeNull();
  });
});
