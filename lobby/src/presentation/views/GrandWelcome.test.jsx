import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { GRAND_WELCOME_SEC, GrandWelcome } from './GrandWelcome.jsx';
import { DECKS } from '../config.js';
import { setLowPowerPreference } from '../hooks/useLowPower.js';
import { FILM, filmSrc, preloadFilm, resetFilmForTests } from '../lib/grandWelcomeFilm.js';

// The grand welcome film (owner 2026-11-01, video/grand-welcome/): the
// opening's first slide, 20 s, silent, 1080p60.

afterEach(() => {
  cleanup();
  setLowPowerPreference(false);
  resetFilmForTests();
  vi.useRealTimers();
});

const state = (c) => c.querySelector('[data-grand-welcome]').dataset.grandWelcome;

describe('the grand welcome film', () => {
  it('is the opening deck\'s first slide, 20 seconds long (the deck shifts 5 s)', () => {
    expect(DECKS.opening[0]).toMatchObject({ id: 'welcome', layout: 'grand-welcome', duration: GRAND_WELCOME_SEC });
    expect(GRAND_WELCOME_SEC).toBe(20);
  });

  it('plays the film, muted, its first frame (the countdown\'s 0:00) up the instant it lands', () => {
    const { container } = render(<GrandWelcome />);
    const v = container.querySelector('video');
    expect(v.getAttribute('src')).toBe(FILM.src);
    expect(v.getAttribute('poster')).toBe(FILM.first);
    expect(v.muted).toBe(true);
    expect(v.hasAttribute('playsinline')).toBe(true);
    expect(state(container)).toBe('loading');
    act(() => { fireEvent(v, new Event('playing')); });
    expect(state(container)).toBe('playing');
  });

  it('ends its slide when the film ends', () => {
    const onEnd = vi.fn();
    const { container } = render(<GrandWelcome onEnd={onEnd} />);
    act(() => { fireEvent(container.querySelector('video'), new Event('ended')); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('on the low-power switch shows the landed frame, still, for the film\'s length', () => {
    vi.useFakeTimers();
    setLowPowerPreference(true);
    const onEnd = vi.fn();
    const { container } = render(<GrandWelcome onEnd={onEnd} />);
    expect(state(container)).toBe('still');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img').getAttribute('src')).toBe(FILM.still);
    act(() => { vi.advanceTimersByTime(FILM.sec * 1000 - 10); });
    expect(onEnd).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(20); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('a film that can\'t play gives way to the still: never black', () => {
    const { container } = render(<GrandWelcome />);
    act(() => { fireEvent(container.querySelector('video'), new Event('error')); });
    expect(state(container)).toBe('still');
    expect(container.querySelector('img').getAttribute('src')).toBe(FILM.still);
  });

  it('a film that never starts, or stalls, gives way to the still', () => {
    vi.useFakeTimers();
    const first = render(<GrandWelcome />);
    act(() => { vi.advanceTimersByTime(FILM.waitMs + 10); });
    expect(state(first.container)).toBe('still');
    cleanup();
    const second = render(<GrandWelcome />);
    const v = second.container.querySelector('video');
    act(() => { fireEvent(v, new Event('waiting')); });
    act(() => { vi.advanceTimersByTime(FILM.stallMs - 10); });
    act(() => { fireEvent(v, new Event('playing')); });
    act(() => { vi.advanceTimersByTime(FILM.stallMs); });
    expect(state(second.container)).not.toBe('still');   // it caught up in time
    act(() => { fireEvent(v, new Event('waiting')); });
    act(() => { vi.advanceTimersByTime(FILM.stallMs + 10); });
    expect(state(second.container)).toBe('still');
  });
});

describe('the film\'s preload', () => {
  it('fetches the whole film once and plays it from memory', async () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:film');
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) }));
    expect(filmSrc()).toBe(FILM.src);
    await Promise.all([preloadFilm(fetchImpl), preloadFilm(fetchImpl)]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(FILM.src);
    expect(filmSrc()).toBe('blob:film');
    created.mockRestore();
  });

  it('a failed preload leaves the film to stream, and never throws', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    await expect(preloadFilm(fetchImpl)).resolves.toBeNull();
    expect(filmSrc()).toBe(FILM.src);
  });
});
