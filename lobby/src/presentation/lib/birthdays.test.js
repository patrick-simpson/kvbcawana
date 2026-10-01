import { describe, expect, it } from 'vitest';
import {
  LIVE_BIRTHDAY_MAX_AGE_MS,
  birthdaysThisWeek,
  listNames,
  liveRoster,
  normalizeClub,
  weekStart,
} from './birthdays.js';

const entry = (name, month, day, club) => ({
  name,
  month,
  day,
  club,
});

describe('normalizeClub', () => {
  it('maps catalog spellings and loose variants', () => {
    expect(normalizeClub('Sparks')).toBe('sparks');
    expect(normalizeClub('SPARKS!')).toBe('sparks');
    expect(normalizeClub('T&T')).toBe('tnt');
    expect(normalizeClub('TnT')).toBe('tnt');
    expect(normalizeClub('Truth & Training')).toBe('tnt');
    expect(normalizeClub('Cubbies')).toBe('cubbies');
    expect(normalizeClub('cubby')).toBe('cubbies');
    expect(normalizeClub('Puggles')).toBe('puggles');
    expect(normalizeClub('Trek')).toBe('trek');
    expect(normalizeClub('TREK!')).toBe('trek');
    expect(normalizeClub('Journey')).toBe('journey');
    expect(normalizeClub('  journey  ')).toBe('journey');
    expect(normalizeClub('youth group')).toBeNull();
  });
});

describe('listNames', () => {
  it('joins names for display', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ava'])).toBe('Ava');
    expect(listNames(['Ava', 'Liam'])).toBe('Ava & Liam');
    expect(listNames(['Ava', 'Liam', 'Noah'])).toBe('Ava, Liam & Noah');
  });
});

describe('weekStart', () => {
  it('returns the Sunday of the containing week at local midnight', () => {
    // 2026-09-16 is a Wednesday → its week starts Sunday 2026-09-13.
    const start = weekStart(new Date('2026-09-16T18:04:00'));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(8);
    expect(start.getDate()).toBe(13);
    expect(start.getHours()).toBe(0);
  });
});

describe('birthdaysThisWeek', () => {
  const roster = [
    entry('Sunday Kid', 9, 13, 'sparks'),
    entry('Wednesday Kid', 9, 16, 'tnt'),
    entry('Saturday Kid', 9, 19, 'cubbies'),
    entry('Next Week Kid', 9, 20, 'puggles'),
    entry('Last Week Kid', 9, 12, 'sparks'),
  ];

  it('includes Sun–Sat of the meeting week, in day order, and nothing else', () => {
    const wed = new Date('2026-09-16T18:04:00');
    expect(birthdaysThisWeek(roster, wed).map((e) => e.name)).toEqual([
      'Sunday Kid',
      'Wednesday Kid',
      'Saturday Kid',
    ]);
  });

  it('handles weeks that span a year boundary', () => {
    // Week of Wed 2026-12-30 runs Sun Dec 27 → Sat Jan 2.
    const roster2 = [entry('NYE Kid', 12, 31, 'tnt'), entry('New Year Kid', 1, 1, 'sparks')];
    const names = birthdaysThisWeek(roster2, new Date('2026-12-30T18:00:00')).map((e) => e.name);
    expect(names).toEqual(['NYE Kid', 'New Year Kid']);
  });

  it('celebrates Feb 29 birthdays on Feb 28 in common years', () => {
    const leapKid = [entry('Leap Kid', 2, 29, 'cubbies')];
    // 2027 is a common year; Feb 28 2027 is a Sunday, so the week of
    // Wed 2027-03-03 contains it.
    expect(birthdaysThisWeek(leapKid, new Date('2027-03-03T18:00:00'))).toHaveLength(1);
    // 2028 is a leap year; Feb 29 2028 is a Tuesday.
    expect(birthdaysThisWeek(leapKid, new Date('2028-03-01T18:00:00'))).toHaveLength(1);
    // A random other week matches nothing.
    expect(birthdaysThisWeek(leapKid, new Date('2027-06-09T18:00:00'))).toHaveLength(0);
  });
});

describe('liveRoster', () => {
  const now = new Date('2026-09-16T18:00:00');
  const live = (
    name,
    club,
    ageMs = 0,
    month = 9,
    day = 16,
  ) => ({ name, month, day, club, receivedAt: now.getTime() - ageMs });

  it('maps fresh live entries to the display shape', () => {
    const roster = liveRoster([live('Liam', 'tnt')], now);
    expect(roster).toEqual([{ name: 'Liam', month: 9, day: 16, club: 'tnt' }]);
  });

  it('prunes stale entries and dedupes by club + first name', () => {
    const roster = liveRoster(
      [live('Old Kid', 'cubbies', LIVE_BIRTHDAY_MAX_AGE_MS + 1), live('Noah', 'tnt'), live('noah', 'tnt')],
      now,
    );
    expect(roster.map((e) => e.name)).toEqual(['Noah']);
  });

  it('keeps the same first name in different clubs as different kids', () => {
    expect(liveRoster([live('Ava', 'sparks'), live('Ava', 'tnt')], now)).toHaveLength(2);
  });
});
