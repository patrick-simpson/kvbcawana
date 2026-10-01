import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MotionConfig } from 'framer-motion';

vi.mock('../hooks/useCalendarEvents.js', () => ({ useCalendarEvents: () => [] }));

import { SlideshowView } from './SlideshowView.jsx';
import { nightLabel, nightOf } from './Slide.jsx';

const NOW = new Date('2026-09-16T18:00:30');
const press = (code) => act(() => { fireEvent.keyDown(window, { code }); });

const deck = (props = {}) => (
  <SlideshowView deck="opening" now={NOW} onExit={() => {}} {...props} />
);

// The opening deck's order (config.js): welcome, the two pledges, a blackout.
const ORDER = ['welcome', 'us-pledge', 'awana-pledge', 'black-slide'];

/** The slide the deck is on now (exiting slides stay mounted under AnimatePresence, so text alone cannot say). */
const current = (container) => container.querySelector('[data-slide]').dataset.slide;
/** Every sweep still on the wall, oldest first. */
const sweeps = (container) => [...container.querySelectorAll('[data-sweep]')];
/** Where the newest sweep's waves enter from: '-110%' (left, forward) or '110%' (right, back). */
const newestFrom = (container) => {
  const froms = [...sweeps(container).at(-1).querySelectorAll('[data-from]')].map((w) => w.dataset.from);
  expect(froms).toHaveLength(6);
  expect(new Set(froms).size).toBe(1);
  return froms[0];
};

describe('SlideshowView: the operator\'s keys still drive the deck', () => {
  afterEach(cleanup);

  it('opens on the welcome, kicked by the night it is', () => {
    const { container } = render(deck());
    expect(current(container)).toBe(ORDER[0]);
    expect(container.textContent).toMatch(/Wednesday night/);
    expect(container.textContent).toMatch(/WELCOME TO AWANA/);
    // No change yet, so no sweep on the wall.
    expect(container.querySelector('[data-sweep]')).toBeNull();
  });

  for (const key of ['Space', 'ArrowRight', 'PageDown']) {
    it(`${key} advances one slide, sweeping left to right`, () => {
      const { container } = render(deck());
      press(key);
      expect(current(container)).toBe(ORDER[1]);
      expect(sweeps(container)).toHaveLength(1);
      expect(newestFrom(container)).toBe('-110%');
      press(key);
      expect(current(container)).toBe(ORDER[2]);
      expect(newestFrom(container)).toBe('-110%');
    });
  }

  for (const key of ['ArrowLeft', 'PageUp']) {
    it(`${key} steps back one slide, sweeping the other way`, () => {
      const { container } = render(deck());
      press('Space');
      press('Space');
      expect(current(container)).toBe(ORDER[2]);
      press(key);
      expect(current(container)).toBe(ORDER[1]);
      expect(newestFrom(container)).toBe('110%');
      press(key);
      expect(current(container)).toBe(ORDER[0]);
      expect(newestFrom(container)).toBe('110%');
    });

    it(`${key} on the first slide does nothing (no change, no sweep)`, () => {
      const { container } = render(deck());
      press(key);
      expect(current(container)).toBe(ORDER[0]);
      expect(container.querySelector('[data-sweep]')).toBeNull();
    });
  }

  it('PageDown reaches the closing blackout, a bare wall', () => {
    const onBareChange = vi.fn();
    const { container } = render(deck({ onBareChange }));
    for (let i = 0; i < 3; i++) press('PageDown');
    expect(current(container)).toBe(ORDER[3]);
    expect(onBareChange).toHaveBeenLastCalledWith(true);
    press('PageUp');
    expect(current(container)).toBe(ORDER[2]);
    expect(onBareChange).toHaveBeenLastCalledWith(false);
  });

  // A second press while the first change's sweep is still crossing the
  // wall (a double tap to the Awana Pledge, or a press that coincides with
  // the welcome's auto-advance). Re-keying one sweep unmounted the running
  // waves and restarted them off the wall: a hard cut mid-wall.
  it('a press mid-sweep leaves the running sweep to finish and starts its own', () => {
    const { container } = render(deck());
    press('Space');
    const [first] = sweeps(container);
    press('Space');
    const both = sweeps(container);
    expect(both).toHaveLength(2);
    expect(both[0]).toBe(first); // the same element, still mounted, still crossing
    press('ArrowLeft');
    expect(sweeps(container)).toHaveLength(3);
    expect(sweeps(container)[0]).toBe(first);
    expect(newestFrom(container)).toBe('110%');
  });

  it('a sweep leaves the DOM once its last wave is off the wall', async () => {
    // Reduced motion makes the transform-only sweep instant, so it finishes
    // on the next frame instead of in 1.4 s.
    const { container } = render(<MotionConfig reducedMotion="always">{deck()}</MotionConfig>);
    press('Space');
    expect(sweeps(container)).toHaveLength(1);
    await waitFor(() => expect(sweeps(container)).toHaveLength(0));
    expect(current(container)).toBe(ORDER[1]);
  });

  it('the sweep is six club waves, in the club colours', () => {
    const { container } = render(deck());
    press('Space');
    const fills = [...container.querySelectorAll('[data-sweep] path')].map((p) => p.getAttribute('fill'));
    expect(fills).toEqual(['#1DB6D9', '#4C72B8', '#F04A4B', '#58BD79', '#047E71', '#8A649D']);
  });

  it('the blackout reports a bare wall (App takes the mark away) and back again', () => {
    const onBareChange = vi.fn();
    render(deck({ onBareChange }));
    expect(onBareChange).toHaveBeenLastCalledWith(false);
    press('Space');
    press('Space');
    press('Space');
    expect(onBareChange).toHaveBeenLastCalledWith(true);
    press('ArrowLeft');
    expect(onBareChange).toHaveBeenLastCalledWith(false);
  });

  it('one more press past the blackout hands off to games', () => {
    const onFinish = vi.fn();
    render(deck({ onFinish }));
    for (let i = 0; i < 3; i++) press('Space');
    expect(onFinish).not.toHaveBeenCalled();
    press('Space');
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('Escape is press-twice, with the toast between', () => {
    const onExit = vi.fn();
    const { container } = render(deck({ onExit }));
    press('Escape');
    expect(onExit).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="EXIT SLIDES Press ESC again"]')).not.toBeNull();
    press('Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('the pledges keep their clock', () => {
    const { container } = render(deck());
    expect(container.querySelector('.pj-slide-clock')).toBeNull();
    press('Space');
    expect(container.querySelector('.pj-slide-clock')).not.toBeNull();
  });
});

describe('slide copy helpers', () => {
  it('names the night it is', () => {
    expect(nightOf(new Date('2026-09-16T18:00:00'))).toBe('Wednesday night');
  });

  it('labels an upcoming night for its chip', () => {
    expect(nightLabel(new Date('2026-09-23T00:00:00'))).toMatch(/^WED SEP 23$/);
  });
});

describe('SlideshowView: the exit toast is a bottom overlay the setup note yields to', () => {
  afterEach(cleanup);

  it('carries the marker while it is up, and is gone with it', async () => {
    const { container } = render(deck());
    expect(container.querySelector('[data-pj-bottom-overlay]')).toBeNull();
    press('Escape');
    const toast = container.querySelector('[data-pj-bottom-overlay]');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toMatch(/Press ESC again/);
    // Escape twice leaves the deck instead: the toast is not a second, hidden state.
    const onExit = vi.fn();
    cleanup();
    const again = render(deck({ onExit }));
    press('Escape');
    press('Escape');
    expect(onExit).toHaveBeenCalledTimes(1);
    again.unmount();
  });
});
