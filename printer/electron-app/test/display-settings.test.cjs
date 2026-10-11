'use strict';
// Moved from lobby/desktop/src/settings.test.js (KVBC Awana v9); vitest -> node:test.
// The hours are new in v9: per computer, default 5:00 to 8:00 pm.
const { describe, it } = require('node:test');
const { expect } = require('./expect.cjs');
const { DEFAULT_SETTINGS, hoursMinutes, normalizeHours, normalizeSettings, parseClock, parseTime } = require('../src/display/settings');

const HOURS = { start: '17:00', end: '20:00' };

describe('settings', () => {
  it('reads an old state.json (no settings) as the lobby, 5 to 8 pm, with no shutdown', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual({ screen: 'lobby', hours: HOURS, shutdown: { enabled: false, at: '20:15' } });
    // The sound room app's own state.json (no hours) reads the same way.
    expect(normalizeSettings({ screen: 'projector', shutdown: { enabled: true, at: '20:30' } }))
      .toEqual({ screen: 'projector', hours: HOURS, shutdown: { enabled: true, at: '20:30' } });
  });

  it('keeps good values and replaces bad ones', () => {
    expect(normalizeSettings({ screen: 'journey', hours: { start: '16:30', end: '21:00' }, shutdown: { enabled: true, at: '21:05' } }))
      .toEqual({ screen: 'journey', hours: { start: '16:30', end: '21:00' }, shutdown: { enabled: true, at: '21:05' } });
    expect(normalizeSettings({ screen: 'nope', hours: 'all night', shutdown: { enabled: 'yes', at: '25:00' } }))
      .toEqual({ screen: 'lobby', hours: HOURS, shutdown: { enabled: false, at: '20:15' } });
  });

  it('accepts only an evening time for the shutdown', () => {
    expect(parseTime('20:15')).toBe(20 * 60 + 15);
    expect(parseTime('17:00')).toBe(17 * 60);
    expect(parseTime('23:59')).toBe(23 * 60 + 59);
    expect(parseTime('09:00')).toBeNull();
    expect(parseTime('8:15')).toBeNull();
    expect(parseTime(null)).toBeNull();
  });
});

describe('display hours', () => {
  it('takes any start before its end, on one day', () => {
    expect(normalizeHours({ start: '09:00', end: '12:30' })).toEqual({ start: '09:00', end: '12:30' });
    expect(hoursMinutes({ start: '16:45', end: '20:30' })).toEqual({ openMin: 16 * 60 + 45, closeMin: 20 * 60 + 30 });
  });

  it('falls back to 5:00 to 8:00 pm for anything else', () => {
    expect(normalizeHours(null)).toEqual(HOURS);
    expect(normalizeHours({ start: '20:00', end: '17:00' })).toEqual(HOURS); // backwards
    expect(normalizeHours({ start: '18:00', end: '18:00' })).toEqual(HOURS); // empty
    expect(normalizeHours({ start: '18:00', end: '24:00' })).toEqual(HOURS); // not a time
    expect(normalizeHours({ start: '6pm', end: '8pm' })).toEqual(HOURS);
    expect(hoursMinutes(undefined)).toEqual({ openMin: 17 * 60, closeMin: 20 * 60 });
  });

  it('reads a clock time of any hour', () => {
    expect(parseClock('00:00')).toBe(0);
    expect(parseClock('23:59')).toBe(23 * 60 + 59);
    expect(parseClock('7:00')).toBeNull();
  });
});
