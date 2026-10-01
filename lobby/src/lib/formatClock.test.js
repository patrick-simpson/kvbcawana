import { describe, it, expect } from 'vitest';
import { formatClock } from '../lib/cornerInfo.js';

describe('formatClock', () => {
  it('formats an afternoon time as 12-hour with PM', () => {
    const ms = new Date(2026, 5, 10, 18, 5, 0, 0).getTime();
    expect(formatClock(ms)).toEqual({ time: '6:05', meridiem: 'PM' });
  });

  it('formats a morning time with AM and no leading hour zero', () => {
    const ms = new Date(2026, 5, 10, 9, 30, 0, 0).getTime();
    expect(formatClock(ms)).toEqual({ time: '9:30', meridiem: 'AM' });
  });

  it('shows 12 for midnight and noon', () => {
    const midnight = new Date(2026, 5, 10, 0, 0, 0, 0).getTime();
    const noon = new Date(2026, 5, 10, 12, 0, 0, 0).getTime();
    expect(formatClock(midnight)).toEqual({ time: '12:00', meridiem: 'AM' });
    expect(formatClock(noon)).toEqual({ time: '12:00', meridiem: 'PM' });
  });
});
