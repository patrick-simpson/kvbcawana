import { describe, expect, it } from 'vitest';
import { RIBBON_FORWARD_DAYS, birthdayRibbon, clubKey } from './birthdayWeek.js';

/** A local Date at midnight, month is 1-based here for readability. */
const day = (y, m, d) => new Date(y, m - 1, d);

/** One roster entry. */
const entry = (firstName, club, month, d) => ({ firstName, club, month, day: d });

describe('clubKey', () => {
  it('ignores case and punctuation', () => {
    expect(clubKey('Sparks')).toBe(clubKey(' sparks '));
    expect(clubKey('T&T')).toBe(clubKey('t & t'));
  });

  it('folds the T&T spellings onto one key', () => {
    const tt = clubKey('T&T');
    expect(clubKey('TnT')).toBe(tt);
    expect(clubKey('Truth and Training')).toBe(tt);
    expect(clubKey('Truth & Training')).toBe(tt);
  });

  it('is empty for nothing at all', () => {
    expect(clubKey(undefined)).toBe('');
    expect(clubKey(null)).toBe('');
  });
});

describe('birthdayRibbon', () => {
  // Wednesday 2026-09-09; the birthday is that Saturday.
  const wednesday = day(2026, 9, 9);

  it('names the day for a unique roster match later this week', () => {
    const label = birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 9, 12)], wednesday);
    expect(label).toBe('Birthday this Saturday!');
  });

  it('matches across case and stray whitespace in the name', () => {
    const label = birthdayRibbon('  ellie  ', 'sparks', [entry('Ellie', 'Sparks', 9, 12)], wednesday);
    expect(label).toBe('Birthday this Saturday!');
  });

  it("agrees about T&T's many spellings", () => {
    const label = birthdayRibbon('Ellie', 'TnT', [entry('Ellie', 'T&T', 9, 12)], wednesday);
    expect(label).toBe('Birthday this Saturday!');
  });

  it('refuses when two roster entries share the name and club', () => {
    const roster = [entry('Ellie', 'Sparks', 9, 12), entry('Ellie', 'Sparks', 11, 2)];
    expect(birthdayRibbon('Ellie', 'Sparks', roster, wednesday)).toBeNull();
  });

  it('says nothing when the birthday is today — the birthday banner owns the day', () => {
    expect(birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 9, 9)], wednesday)).toBeNull();
  });

  it('includes the last day of the window and excludes the day after', () => {
    const last = new Date(wednesday.getTime());
    last.setDate(last.getDate() + RIBBON_FORWARD_DAYS);
    const past = new Date(wednesday.getTime());
    past.setDate(past.getDate() + RIBBON_FORWARD_DAYS + 1);

    expect(birthdayRibbon(
      'Ellie', 'Sparks', [entry('Ellie', 'Sparks', last.getMonth() + 1, last.getDate())], wednesday,
    )).toMatch(/^Birthday this \w+!$/);
    expect(birthdayRibbon(
      'Ellie', 'Sparks', [entry('Ellie', 'Sparks', past.getMonth() + 1, past.getDate())], wednesday,
    )).toBeNull();
  });

  it('says nothing for a birthday eight days out', () => {
    expect(birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 9, 17)], wednesday)).toBeNull();
  });

  it('says nothing when the clubs disagree', () => {
    expect(birthdayRibbon('Ellie', 'Cubbies', [entry('Ellie', 'Sparks', 9, 12)], wednesday)).toBeNull();
  });

  it('crosses a month boundary', () => {
    const label = birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 10, 1)], day(2026, 9, 28));
    expect(label).toBe('Birthday this Thursday!');
  });

  it('celebrates a Feb-29 birthday on Feb 28 in a common year', () => {
    // 2027 is not a leap year: Feb 28 is the Sunday of that week.
    const label = birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 2, 29)], day(2027, 2, 25));
    expect(label).toBe('Birthday this Sunday!');
  });

  it('keeps Feb 29 itself in a leap year', () => {
    const label = birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 2, 29)], day(2028, 2, 26));
    expect(label).toBe('Birthday this Tuesday!');
    // …and does not double-fire on the 28th in a leap year.
    expect(birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', 2, 29)], day(2028, 2, 28)))
      .toBe('Birthday this Tuesday!');
  });

  it('is null and never throws for missing or malformed input', () => {
    expect(birthdayRibbon('Ellie', 'Sparks', undefined, wednesday)).toBeNull();
    expect(birthdayRibbon('Ellie', 'Sparks', {}, wednesday)).toBeNull();
    expect(birthdayRibbon('Ellie', 'Sparks', [], wednesday)).toBeNull();
    expect(birthdayRibbon('Ellie', 'Sparks', [null, undefined], wednesday)).toBeNull();
    expect(birthdayRibbon('', 'Sparks', [entry('', 'Sparks', 9, 12)], wednesday)).toBeNull();
    expect(birthdayRibbon('Ellie', 'Sparks', [{ firstName: 'Ellie', club: 'Sparks' }], wednesday)).toBeNull();
    expect(birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', '9', '12')], wednesday)).toBeNull();
  });

  it('defaults `today` to now rather than throwing', () => {
    const t = new Date();
    t.setDate(t.getDate() + 2);
    expect(birthdayRibbon('Ellie', 'Sparks', [entry('Ellie', 'Sparks', t.getMonth() + 1, t.getDate())]))
      .toMatch(/^Birthday this \w+!$/);
  });
});
