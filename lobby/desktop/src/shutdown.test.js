import { describe, it, expect } from 'vitest';
import { MIN_WARNING_MS, WARNING_MS, shutdownDeadline, shutdownStep } from './shutdown.js';

const ON = { enabled: true, atMin: 20 * 60 + 15 }; // 8:15 pm
const night = (minutes, extra = {}) => ({ dateKey: '2026-10-07', minutes, clubNight: true, armedFor: '2026-10-07', cancelledFor: null, ...extra });

describe('shutdownStep', () => {
  it('does nothing while turned off, or on a night without club', () => {
    expect(shutdownStep({ ...ON, enabled: false }, night(20 * 60 + 13))).toBe('idle');
    expect(shutdownStep(ON, night(20 * 60 + 13, { clubNight: false }))).toBe('idle');
  });

  it('arms before the warning and warns two minutes before the time', () => {
    expect(shutdownStep(ON, night(17 * 60, { armedFor: null }))).toBe('arm');
    expect(shutdownStep(ON, night(20 * 60 + 12))).toBe('arm');
    expect(shutdownStep(ON, night(20 * 60 + 13))).toBe('warn');
    expect(shutdownStep(ON, night(20 * 60 + 15))).toBe('warn');
  });

  it('never shuts down a PC switched on, or woken, after the warning was due', () => {
    expect(shutdownStep(ON, night(20 * 60 + 14, { armedFor: null }))).toBe('idle');
    expect(shutdownStep(ON, night(20 * 60 + 14, { armedFor: '2026-09-30' }))).toBe('idle');
    expect(shutdownStep(ON, night(20 * 60 + 16))).toBe('idle');
    expect(shutdownStep(ON, night(22 * 60))).toBe('idle');
  });

  it('a Cancel holds for the rest of that night only', () => {
    expect(shutdownStep(ON, night(20 * 60 + 14, { cancelledFor: '2026-10-07' }))).toBe('idle');
    expect(shutdownStep(ON, { ...night(20 * 60 + 14), dateKey: '2026-10-14', armedFor: '2026-10-14', cancelledFor: '2026-10-07' })).toBe('warn');
  });
});

describe('shutdownDeadline', () => {
  const at = 20 * 60 + 15;
  it('lands on the start of the set minute', () => {
    const now = Date.UTC(2026, 9, 8, 0, 13, 0, 150); // a tick at 8:13:00.150 pm Eastern
    expect(shutdownDeadline(now, 20 * 60 + 13, at)).toBe(Date.UTC(2026, 9, 8, 0, 15, 0, 0));
    expect(shutdownDeadline(now, 20 * 60 + 13, at) - now).toBeLessThanOrEqual(WARNING_MS);
  });

  it('always leaves at least a minute to cancel', () => {
    const late = Date.UTC(2026, 9, 8, 0, 14, 50);
    expect(shutdownDeadline(late, 20 * 60 + 14, at)).toBe(late + MIN_WARNING_MS);
    const past = Date.UTC(2026, 9, 8, 0, 15, 20);
    expect(shutdownDeadline(past, 20 * 60 + 15, at)).toBe(past + MIN_WARNING_MS);
  });
});
