import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';

vi.mock('../lib/stingers.js', () => ({ playStinger: vi.fn(), playTones: vi.fn() }));

import { FILM_WAIT_MS, FinaleFilm, filmSrc, inkMatrix } from './FinaleFilm.jsx';
import { finaleFilmFor } from '../../../../shared/scoreboard.js';

// The winner film (owner 2026-11-15; video/score-finale/): tonight's film painted in the
// winner's colours, the flat winner screen whenever the film cannot play.

const SCORES = { blue: 3, red: 7, yellow: 2, green: 5, boys: 0, girls: 0, leaders: 0, kids: 0 };
const NIGHT = '2026-11-18';

describe('FinaleFilm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom has no video playback: a play() that never starts.
    window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  });
  afterEach(() => { vi.useRealTimers(); });

  it('paints the film\'s red ink as the team, its green as white, its blue as the deep colour', () => {
    expect(inkMatrix('#F04A4B', '#B82B32')).toBe('0.9412 1 0.7216 0 0  0.2902 1 0.1686 0 0  0.2941 1 0.1961 0 0  0 0 0 1 0');
  });

  it('plays tonight\'s film, painted for the winner, and names the winner for screen readers', () => {
    const { container } = render(<FinaleFilm club="sparks" scores={SCORES} night={NIGHT} still={false} />);
    const film = container.querySelector('.pj-film');
    expect(film.dataset.film).toBe(finaleFilmFor(NIGHT).id);
    expect(film.dataset.winners).toBe('red');
    expect(film.getAttribute('aria-label')).toMatch(/RED WINS!/);
    const video = container.querySelector('video');
    expect(video.getAttribute('src')).toBe(filmSrc(finaleFilmFor(NIGHT).id));
    expect(video.muted).toBe(true);
    expect(video.style.filter).toMatch(/^url\("?#pj-ink-/);
    expect(container.querySelector('feColorMatrix').getAttribute('values')).toBe(inkMatrix('#F04A4B', '#B82B32'));
  });

  it('a tie is painted in both teams\' colours', () => {
    const { container } = render(<FinaleFilm club="sparks" scores={{ ...SCORES, blue: 7 }} night={NIGHT} still={false} />);
    expect(container.querySelector('.pj-film').getAttribute('aria-label')).toMatch(/IT'S A TIE!/);
    expect(container.querySelector('feColorMatrix').getAttribute('values')).toBe(inkMatrix('#4C72B8', '#F04A4B'));
  });

  it('never a black wall: a film that does not start is the flat winner screen', () => {
    const { container } = render(<FinaleFilm club="sparks" scores={SCORES} night={NIGHT} still={false} />);
    expect(container.querySelector('.pj-finale')).toBeNull();
    act(() => { vi.advanceTimersByTime(FILM_WAIT_MS + 100); });
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.pj-finale').getAttribute('aria-label')).toMatch(/RED WINS!/);
  });

  it('low power plays the flat winner screen and never loads the film', () => {
    const { container } = render(<FinaleFilm club="sparks" scores={SCORES} night={NIGHT} still />);
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('.pj-finale')).not.toBeNull();
  });
});
