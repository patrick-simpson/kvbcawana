import { describe, expect, it } from 'vitest';
import { FILM_FIRST_NIGHT, FILM_ON, LEAD_IN_ON, alternatingStyle, clubWeek, leadInStyle, welcomeStyle } from './grandWelcomeWeek.js';

// Owner 2026-11-01: the 3D film alternates with the old style each week.
// Owner 2026-11-08: the film is off; the 2D welcome every week.
const at = (s) => new Date(s);

describe('the film is off: the 2D welcome every week (owner 2026-11-08)', () => {
  it('FILM_ON is false and every week, film weeks included, is classic', () => {
    expect(FILM_ON).toBe(false);
    for (const s of ['2026-11-04T18:00:00', '2026-11-11T18:00:00', '2026-11-18T18:00:00', '2027-03-17T18:00:00']) {
      expect(welcomeStyle(at(s))).toBe('classic');
    }
  });
});

describe('while FILM_ON, the grand welcome alternates each club week', () => {
  it('the film\'s first night is a Wednesday, and a film week', () => {
    const first = new Date(FILM_FIRST_NIGHT.year, FILM_FIRST_NIGHT.month - 1, FILM_FIRST_NIGHT.day, 18);
    expect(first.getDay()).toBe(3);
    expect(alternatingStyle(first)).toBe('film');
  });

  it('alternates Wednesday to Wednesday, both ways', () => {
    expect(alternatingStyle(at('2026-11-04T18:00:00'))).toBe('film');
    expect(alternatingStyle(at('2026-11-11T18:00:00'))).toBe('classic');
    expect(alternatingStyle(at('2026-11-18T18:00:00'))).toBe('film');
    expect(alternatingStyle(at('2026-10-28T18:00:00'))).toBe('classic');
    expect(alternatingStyle(at('2026-10-21T18:00:00'))).toBe('film');
  });

  it('a week runs Wednesday to Tuesday: the whole club night, and the days around it, agree', () => {
    for (const s of ['2026-11-04T00:00:00', '2026-11-04T17:59:45', '2026-11-04T23:59:59', '2026-11-10T23:59:59']) {
      expect(clubWeek(at(s))).toBe(0);
    }
    expect(clubWeek(at('2026-11-03T23:59:59'))).toBe(-1);
    expect(clubWeek(at('2026-11-11T00:00:00'))).toBe(1);
  });

  it('a clock change never shifts a week (local calendar days)', () => {
    // US clocks fall back on 2026-11-01 and spring forward on 2027-03-14.
    expect(alternatingStyle(at('2027-03-17T18:00:00'))).toBe(clubWeek(at('2027-03-17T18:00:00')) % 2 === 0 ? 'film' : 'classic');
    expect(clubWeek(at('2027-03-17T18:00:00')) - clubWeek(at('2027-03-10T18:00:00'))).toBe(1);
    expect(clubWeek(at('2026-11-11T18:00:00')) - clubWeek(at('2026-11-04T18:00:00'))).toBe(1);
  });
});

describe("the other screens' lead-in (owner 2026-11-11: back every week)", () => {
  it('plays every week, whatever the gym shows', () => {
    expect(LEAD_IN_ON).toBe(true);
    for (const d of [new Date(2026, 10, 4, 18), new Date(2026, 10, 11, 18), new Date(2026, 10, 18, 18), new Date(2027, 0, 6, 18)]) {
      expect(leadInStyle(d)).toBe('film');
      expect(welcomeStyle(d)).toBe('classic');
    }
  });
});
