import { describe, it, expect } from 'vitest';
import { CLUB_ALIASES, CLUB_TABLE, clubIdByAlias, clubKeyByLabel } from './clubs.js';
import theme from './theme.json';
import tokens from './brand/tokens.json';

describe('the club table', () => {
  it('lists the six clubs, youngest first, each once', () => {
    expect(CLUB_TABLE.map((c) => c.id)).toEqual(['puggles', 'cubbies', 'sparks', 't&t', 'trek', 'journey']);
    expect(new Set(CLUB_TABLE.map((c) => c.key)).size).toBe(6);
    expect(CLUB_TABLE.map((c) => c.key)).toEqual(['puggle', 'cubbie', 'spark', 't&t', 'trek', 'journey']);
    expect(CLUB_TABLE.map((c) => c.name)).toEqual(['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey']);
    expect(CLUB_TABLE.map((c) => c.monogram)).toEqual(['P', 'C', 'S', 'T&T', 'TR', 'J']);
    expect(CLUB_TABLE.map((c) => c.mark)).toEqual(['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey']);
  });

  it('carries the colors theme.json and the brand tokens carry', () => {
    for (const c of CLUB_TABLE) {
      const themeKey = c.id === 't&t' ? 'tnt' : c.id;
      expect(theme.clubs[themeKey].color.toLowerCase(), c.id).toBe(c.primary.toLowerCase());
      expect(JSON.stringify(tokens)).toContain(c.primary);
    }
  });

  it('files each alias under its club', () => {
    expect(CLUB_ALIASES).toEqual({
      puggle: 'puggles', cubbie: 'cubbies', spark: 'sparks',
      'truth & training': 't&t', 'truth and training': 't&t', tnt: 't&t', 't & t': 't&t',
    });
  });
});

describe('clubIdByAlias (the lobby: an exact spelling)', () => {
  it('reads a table alias, then the extra ones, else the text itself, trimmed and lower-cased', () => {
    expect(clubIdByAlias('  TnT ')).toBe('t&t');
    expect(clubIdByAlias('Truth And Training')).toBe('t&t');
    expect(clubIdByAlias('Sparks')).toBe('sparks');
    expect(clubIdByAlias('Brownies', { brownies: 'sparks' })).toBe('sparks');
    expect(clubIdByAlias('Sparks - Room 4')).toBe('sparks - room 4');
  });
});

describe('clubKeyByLabel (the print server: a substring of free text)', () => {
  it('finds a club inside label text', () => {
    expect(clubKeyByLabel('Sparks - Room 4')).toBe('spark');
    expect(clubKeyByLabel('AWANA CUBBIES')).toBe('cubbie');
    expect(clubKeyByLabel('Puggles group')).toBe('puggle');
    expect(clubKeyByLabel('Trek')).toBe('trek');
    expect(clubKeyByLabel('Journey 7th')).toBe('journey');
  });

  it('reads every spelling of T&T, and tnt only whole', () => {
    for (const s of ['T&T', 't & t', 'TNT', 'T T', 'T&T Grades 3-6']) expect(clubKeyByLabel(s), s).toBe('t&t');
    expect(clubKeyByLabel('Truth & Training')).toBeNull();
    expect(clubKeyByLabel('tnt night')).toBeNull();
  });

  it('is null for nothing, and for text no club is in', () => {
    for (const s of ['', '   ', null, undefined, 0, 'Brownies']) expect(clubKeyByLabel(s), String(s)).toBeNull();
  });

  it('answers every key in the table from every name in the table', () => {
    for (const c of CLUB_TABLE) expect(clubKeyByLabel(c.name), c.id).toBe(c.key);
  });
});
