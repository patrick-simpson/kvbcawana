import { describe, it, expect } from 'vitest';
import { SCREENS, isScreenPage, screenFor, screenUrls } from './screens.js';

const SITE = 'https://awana.kvbchurch.org/lobby/';

describe('screens', () => {
  it('maps each screen to its page on the one site', () => {
    expect(screenUrls(SITE, 'lobby').page).toBe('https://awana.kvbchurch.org/lobby/index.html');
    expect(screenUrls(SITE, 'projector').page).toBe('https://awana.kvbchurch.org/lobby/countdown.html');
    expect(screenUrls(SITE, 'journey').page).toBe('https://awana.kvbchurch.org/journey/');
  });

  it('gives each a configure-mode page', () => {
    expect(screenUrls(SITE, 'lobby').configure).toBe('https://awana.kvbchurch.org/lobby/index.html?configure=1');
    expect(screenUrls(SITE, 'journey').configure).toBe('https://awana.kvbchurch.org/journey/?configure=1');
  });

  it('falls back to the lobby for anything unknown', () => {
    expect(screenFor('printer')).toBe(SCREENS.lobby);
    expect(screenFor(undefined)).toBe(SCREENS.lobby);
    expect(screenFor('__proto__')).toBe(SCREENS.lobby);
  });

  it('keeps a window inside its own folder on its own origin', () => {
    const lobby = screenUrls(SITE, 'lobby').base;
    const journey = screenUrls(SITE, 'journey').base;
    expect(isScreenPage('https://awana.kvbchurch.org/lobby/countdown.html', lobby)).toBe(true);
    expect(isScreenPage('https://awana.kvbchurch.org/journey/', lobby)).toBe(false);
    expect(isScreenPage('https://awana.kvbchurch.org/journey/about.html', journey)).toBe(true);
    expect(isScreenPage('https://awana.kvbchurch.org/', journey)).toBe(false);
    expect(isScreenPage('https://evil.example/journey/', journey)).toBe(false);
    expect(isScreenPage('not a url', journey)).toBe(false);
  });
});
