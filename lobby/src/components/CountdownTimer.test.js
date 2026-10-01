import { describe, it, expect } from 'vitest';
import { resolveTarget, formatRemaining } from './CountdownTimer.jsx';

describe('resolveTarget', () => {
  // A fixed reference point: today at 12:00 local time.
  const noon = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();

  it('targets later today when the time has not passed yet', () => {
    const result = resolveTarget('18:30', noon);
    expect(result.isTomorrow).toBe(false);
    expect(new Date(result.ms).getHours()).toBe(18);
    expect(result.ms).toBeGreaterThan(noon);
  });

  it('rolls over to tomorrow when the time already passed', () => {
    const result = resolveTarget('08:00', noon);
    expect(result.isTomorrow).toBe(true);
    expect(result.ms).toBeGreaterThan(noon);
    expect(new Date(result.ms).getHours()).toBe(8);
  });

  it('rejects invalid input', () => {
    expect(resolveTarget('', noon)).toBeNull();
    expect(resolveTarget(null, noon)).toBeNull();
    expect(resolveTarget('25:00', noon)).toBeNull();
    expect(resolveTarget('12:75', noon)).toBeNull();
    expect(resolveTarget('soon', noon)).toBeNull();
  });

  describe('club-night gating', () => {
    // noon is local 2026-06-10.
    it('counts down when today is a club night', () => {
      const result = resolveTarget('18:30', noon, ['2026-06-10', '2026-09-02']);
      expect(result).not.toBeNull();
      expect(result.isTomorrow).toBe(false);
    });

    it('hides when the next occurrence is not a club night — the summer-break bug', () => {
      // Club resumes months out; the timer must not claim it starts today.
      expect(resolveTarget('18:30', noon, ['2026-09-02'])).toBeNull();
    });

    it('after tonight passes, only shows "tomorrow" if tomorrow is a club night', () => {
      expect(resolveTarget('08:00', noon, ['2026-06-11'])).not.toBeNull();
      expect(resolveTarget('08:00', noon, ['2026-06-10'])).toBeNull();
    });

    it('an empty club list hides the timer entirely', () => {
      expect(resolveTarget('18:30', noon, [])).toBeNull();
    });

    it('null clubDates keeps the calendar-less everyday behavior', () => {
      expect(resolveTarget('18:30', noon, null)).not.toBeNull();
    });
  });
});

describe('formatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(formatRemaining(90_000)).toBe('01:30');
    expect(formatRemaining(0)).toBe('00:00');
  });

  it('includes hours when needed', () => {
    expect(formatRemaining(3_661_000)).toBe('1:01:01');
  });

  it('never goes negative', () => {
    expect(formatRemaining(-5000)).toBe('00:00');
  });
});
