import { describe, expect, it } from 'vitest';
import { calendarDaysUntil } from './useCalendarEvents.js';
import { daysLeftThisWeek } from '../components/EventChips.jsx';

describe('counting days to a calendar night', () => {
  const wed = new Date(2026, 9, 14, 17, 45);   // Wednesday, club night
  it('tonight is today, not tomorrow (a noon-dated event used to round up)', () => {
    expect(calendarDaysUntil(new Date('2026-10-14T12:00:00'), wed)).toBe(0);
  });
  it('counts whole days after that, across a clock change', () => {
    expect(calendarDaysUntil(new Date('2026-10-15T12:00:00'), wed)).toBe(1);
    expect(calendarDaysUntil(new Date('2026-11-04T12:00:00'), wed)).toBe(21);
  });
  it('this week runs through Saturday', () => {
    expect(daysLeftThisWeek(wed)).toBe(3);
    expect(daysLeftThisWeek(new Date(2026, 9, 18))).toBe(6);   // Sunday
  });
});
