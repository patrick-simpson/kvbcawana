import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';

// The countdown's skip on a phone or tablet: the clock is the biggest thing
// under a finger and a skip is a fifteen-minute override of the evening, so
// the first tap only asks (a toast) and a second within 3 s skips. On the PC
// one click on the clock skips, with its tooltip and hover hint, as before.

const device = vi.hoisted(() => ({ touch: true }));
vi.mock('../lib/touch.js', () => ({ useTouch: () => device.touch, usePortrait: () => false }));
vi.mock('../lib/stingers.js', () => ({ playStinger: vi.fn() }));
vi.mock('../hooks/useWeather.js', () => ({ useWeather: () => 'clear' }));
vi.mock('../hooks/useCalendarEvents.js', () => ({ useCalendarEvents: () => [] }));

const { CountdownView } = await import('./CountdownView.jsx');

const TARGET = new Date('2026-09-16T18:00:00');
const NOW = new Date(TARGET.getTime() - 25 * 60_000);
const view = (onSkip) => render(<CountdownView now={NOW} target={TARGET} theme={null} onSkip={onSkip} />);
const timer = (c) => c.querySelector('[data-timer]');
const toast = (c) => c.querySelector('[data-skip-toast]');

beforeEach(() => {
  device.touch = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the countdown skip on touch', () => {
  it('asks first: one tap on the clock only shows the question, a second skips', () => {
    const onSkip = vi.fn();
    const { container } = view(onSkip);
    expect(timer(container).getAttribute('title')).toBeNull();
    expect(container.textContent).not.toMatch(/Click to skip/);
    act(() => { fireEvent.click(timer(container)); });
    expect(onSkip).not.toHaveBeenCalled();
    expect(toast(container)).not.toBeNull();
    expect(toast(container).hasAttribute('data-pj-bottom-overlay')).toBe(true);
    expect(toast(container).querySelector('[aria-label]').getAttribute('aria-label')).toBe('START THE OPENING Tap the clock again');
    act(() => { fireEvent.click(timer(container)); });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('forgets the question after 3 s, so a stray tap later only asks again', () => {
    vi.useFakeTimers();
    const onSkip = vi.fn();
    const { container } = view(onSkip);
    act(() => { fireEvent.click(timer(container)); });
    act(() => { vi.advanceTimersByTime(3100); });
    act(() => { fireEvent.click(timer(container)); });
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('keeps the keyboard\'s one-press skip, for a tablet with a keyboard', () => {
    const onSkip = vi.fn();
    view(onSkip);
    act(() => { fireEvent.keyDown(window, { code: 'Space' }); });
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('on the PC one click on the clock skips, with its tooltip and hover hint', () => {
    device.touch = false;
    const onSkip = vi.fn();
    const { container } = view(onSkip);
    expect(timer(container).getAttribute('title')).toBe('Click to skip');
    expect(container.textContent).toMatch(/Click to skip →/);
    act(() => { fireEvent.click(timer(container)); });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(toast(container)).toBeNull();
  });
});
