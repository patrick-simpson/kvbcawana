import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, parseTime } from './settings.js';

describe('settings', () => {
  it('reads an old state.json (no settings) as the lobby with no shutdown', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual({ screen: 'lobby', shutdown: { enabled: false, at: '20:15' } });
  });

  it('keeps good values and replaces bad ones', () => {
    expect(normalizeSettings({ screen: 'journey', shutdown: { enabled: true, at: '21:05' } }))
      .toEqual({ screen: 'journey', shutdown: { enabled: true, at: '21:05' } });
    expect(normalizeSettings({ screen: 'nope', shutdown: { enabled: 'yes', at: '25:00' } }))
      .toEqual({ screen: 'lobby', shutdown: { enabled: false, at: '20:15' } });
  });

  it('accepts only an evening time', () => {
    expect(parseTime('20:15')).toBe(20 * 60 + 15);
    expect(parseTime('17:00')).toBe(17 * 60);
    expect(parseTime('23:59')).toBe(23 * 60 + 59);
    expect(parseTime('09:00')).toBeNull();
    expect(parseTime('8:15')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});
