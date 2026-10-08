import { describe, it, expect } from 'vitest';
import { CORNER_CLUB_IDS, clubKey, countForClub, getClubPalette, getAllClubs } from './clubs.js';

describe('getClubPalette', () => {
  it('is case-insensitive and trims whitespace', () => {
    expect(getClubPalette('SPARKS')).toBe(getClubPalette('sparks'));
    expect(getClubPalette('  Cubbies  ')).toBe(getClubPalette('cubbies'));
  });

  it('falls back to the default palette for unknown or missing clubs', () => {
    const fallback = getClubPalette(undefined);
    expect(fallback.primary).toBeTruthy();
    expect(getClubPalette('No Such Club')).toBe(fallback);
    expect(getClubPalette(42)).toBe(fallback);
  });

  it('has a dedicated palette for every club the debug panel can trigger', () => {
    const fallback = getClubPalette(undefined);
    for (const club of getAllClubs()) {
      expect(getClubPalette(club), `palette for ${club}`).not.toBe(fallback);
    }
  });

  it('resolves common alternate spellings to the same club', () => {
    expect(getClubPalette('Truth & Training')).toBe(getClubPalette('T&T'));
    expect(getClubPalette('TNT')).toBe(getClubPalette('t&t'));
    expect(getClubPalette('Cubbie')).toBe(getClubPalette('Cubbies'));
  });

  it('carries catalog identity data for on-screen display', () => {
    const sparks = getClubPalette('Sparks');
    expect(sparks.name).toBe('Sparks');
    expect(sparks.confetti.length).toBeGreaterThan(1);
    // Every club ships its official 2026-27 wordmark (white knockout,
    // vector, from the shared brand kit).
    for (const club of getAllClubs()) {
      expect(getClubPalette(club).logo, `logo for ${club}`).toBeTruthy();
    }
    // Mascot character art exists for the four character clubs; Trek and
    // Journey have none, and the fallback palette has neither logo nor
    // mascot.
    expect(sparks.mascot).toBeTruthy();
    expect(getClubPalette('Puggles').mascot).toBeTruthy();
    expect(getClubPalette('Cubbies').mascot).toBeTruthy();
    expect(getClubPalette('T&T').mascot).toBeTruthy();
    expect(getClubPalette('Trek').mascot).toBeNull();
    expect(getClubPalette('Journey').mascot).toBeNull();
    expect(getClubPalette(undefined).logo).toBeNull();
    expect(getClubPalette(undefined).mascot).toBeNull();
  });

  // The milestone toast bursts in these exact values (#332), so pin them.
  it('exposes a confetti palette for every club, and a default for a typo', () => {
    expect(getClubPalette('Sparks').confetti[0]).toBe('#F04A4B');
    for (const club of getAllClubs()) {
      const { confetti } = getClubPalette(club);
      expect(Array.isArray(confetti)).toBe(true);
      expect(confetti.length).toBeGreaterThan(0);
    }
    expect(getClubPalette('Sparkles!!').confetti).toEqual(['#FAA41D', '#FCB614', '#FFFFFF']);
  });

  it('no longer carries taglines or age ranges — banners show titles only', () => {
    for (const club of getAllClubs()) {
      expect(getClubPalette(club).tagline).toBeUndefined();
      expect(getClubPalette(club).ages).toBeUndefined();
    }
  });
});

describe('one club\'s count from a tally (the per-screen club count)', () => {
  it('knows a club by any spelling', () => {
    expect(clubKey('T&T')).toBe('t&t');
    expect(clubKey('tnt')).toBe('t&t');
    expect(clubKey(' Truth & Training ')).toBe('t&t');
    expect(clubKey('Sparks')).toBe('sparks');
    expect(clubKey('Guests')).toBeNull();
    expect(clubKey(null)).toBeNull();
  });

  it('every id the Settings menu offers is a club', () => {
    expect(CORNER_CLUB_IDS.map(clubKey)).toEqual(['puggles', 'cubbies', 'sparks', 't&t', 'trek', 'journey']);
  });

  it('reads the tally\'s display-name keys, and says null when the club is not in it', () => {
    const counts = { Sparks: 12, 'T&T': 9, Trek: 0 };
    expect(countForClub(counts, 'tnt')).toBe(9);
    expect(countForClub(counts, 'sparks')).toBe(12);
    expect(countForClub(counts, 'trek')).toBe(0);
    expect(countForClub(counts, 'journey')).toBeNull();
    expect(countForClub(null, 'sparks')).toBeNull();
    expect(countForClub(counts, '')).toBeNull();
    // Two spellings of one club in one tally add up.
    expect(countForClub({ 'T&T': 3, 'Truth & Training': 2 }, 'tnt')).toBe(5);
  });
});
