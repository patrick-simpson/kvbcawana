import { describe, it, expect } from 'vitest';
import { countForClub } from './tally.js';

describe('countForClub', () => {
  const t = {
    counts: { 'Truth & Training': 12, 'T&T': 3, Sparks: 9, Mystery: 4 },
    total: 28,
    at: new Date('2026-09-02T18:20:00'),
  };

  it('normalizes club-name spellings and sums duplicates', () => {
    expect(countForClub(t, 'tnt')).toBe(15);
    expect(countForClub(t, 'sparks')).toBe(9);
  });

  it('returns null (not 0) for clubs the tally does not cover', () => {
    expect(countForClub(t, 'puggles')).toBeNull();
  });

  it('a present club with zero check-ins reports 0, not null', () => {
    expect(countForClub({ counts: { Sparks: 0 } }, 'sparks')).toBe(0);
  });

  it('handles messy real-world club-name spellings (case, punctuation, spacing)', () => {
    const messy = {
      counts: {
        '  SPARKS!! ': 4,
        'truth & training': 2,
        'T & T': 1,
        'Cubbies (3s & 4s)': 6,
        'puggle class': 5,
      },
    };
    expect(countForClub(messy, 'sparks')).toBe(4);
    expect(countForClub(messy, 'tnt')).toBe(3); // both spellings summed
    expect(countForClub(messy, 'cubbies')).toBe(6);
    expect(countForClub(messy, 'puggles')).toBe(5);
  });

  it('ignores count keys that are not clubs (leaders, garbage) instead of throwing', () => {
    const noisy = { counts: { Leaders: 7, '': 3, '1234!!': 9, Sparks: 2 } };
    expect(countForClub(noisy, 'sparks')).toBe(2);
    expect(countForClub(noisy, 'tnt')).toBeNull();
  });

  it('returns null on an empty tally', () => {
    expect(countForClub({ counts: {} }, 'sparks')).toBeNull();
    expect(countForClub({ counts: {}, total: 0 }, 'tnt')).toBeNull();
  });
});
