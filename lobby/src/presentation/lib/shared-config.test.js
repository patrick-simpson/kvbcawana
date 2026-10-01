import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  SCHEDULE_CONFIG,
  THEME,
  localDateKey,
  parseHHMM,
  parseScheduleConfig,
  parseThemeConfig,
} from './shared-config.js';

describe('shipped shared files', () => {
  it('schedule.json validated at import (meeting + gap-free evening)', () => {
    expect(SCHEDULE_CONFIG.meetingDay).toBe(3);
    expect(SCHEDULE_CONFIG.meetingStart).toEqual({ hour: 18, minute: 0 });
    expect(SCHEDULE_CONFIG.windows.length).toBeGreaterThan(0);
    for (let i = 1; i < SCHEDULE_CONFIG.windows.length; i++) {
      expect(SCHEDULE_CONFIG.windows[i].startMin).toBe(SCHEDULE_CONFIG.windows[i - 1].endMin);
    }
    expect(SCHEDULE_CONFIG.windows[SCHEDULE_CONFIG.windows.length - 1].endMin).toBe(24 * 60);
  });

  it('theme.json ships every scheduled club', () => {
    for (const id of ['puggles', 'cubbies', 'sparks', 'tnt']) {
      expect(THEME.clubs[id]).toBeDefined();
      expect(THEME.clubs[id].color).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it('theme.json club colors match the CSS --color-club-* tokens (drift guard)', () => {
    const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
    for (const id of ['puggles', 'cubbies', 'sparks', 'tnt']) {
      const m = css.match(new RegExp(`--color-club-${id}:\\s*(#[0-9A-Fa-f]{6})`));
      expect(m, `--color-club-${id} token missing from index.css`).not.toBeNull();
      expect(THEME.clubs[id].color.toUpperCase()).toBe(m[1].toUpperCase());
    }
  });

  it('every art path in theme.json exists under shared/', () => {
    const paths = Object.values(THEME.clubs).flatMap((c) => [
      ...(c.art.logo ? [c.art.logo] : []),
      ...(c.art.logoWhite ? [c.art.logoWhite] : []),
      ...(c.art.title ? [c.art.title] : []),
      ...(c.art.group ? [c.art.group] : []),
      ...(c.art.characters ?? []),
    ]);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(() => readFileSync(resolve(__dirname, '../../../shared', p))).not.toThrow();
    }
  });
});

describe('parseHHMM', () => {
  it('parses times and allows 24:00 as an exclusive end', () => {
    expect(parseHHMM('18:05', 't')).toBe(18 * 60 + 5);
    expect(parseHHMM('24:00', 't')).toBe(24 * 60);
  });
  it('rejects garbage', () => {
    expect(() => parseHHMM('6pm', 't')).toThrow(/shared config invalid/);
    expect(() => parseHHMM('25:00', 't')).toThrow();
    expect(() => parseHHMM(1800, 't')).toThrow();
  });
});

describe('parseScheduleConfig validation', () => {
  const valid = {
    version: 1,
    meeting: { day: 3, start: '18:00' },
    windows: [
      { kind: 'game', clubs: ['tnt'], title: 'T&T', start: '18:00', end: '19:00' },
      { kind: 'shutdown', title: 'Shutdown', start: '19:00', end: '24:00' },
    ],
  };

  it('accepts a minimal valid config', () => {
    const cfg = parseScheduleConfig(valid);
    expect(cfg.windows).toHaveLength(2);
    expect(cfg.specialDates).toEqual({});
  });

  it('rejects unknown versions, clubs, decks, kinds, and overlaps', () => {
    expect(() => parseScheduleConfig({ ...valid, version: 2 })).toThrow(/version/);
    expect(() =>
      parseScheduleConfig({
        ...valid,
        windows: [{ kind: 'game', clubs: ['dragons'], title: 'X', start: '18:00', end: '19:00' }],
      }),
    ).toThrow(/unknown club/);
    expect(() =>
      parseScheduleConfig({
        ...valid,
        windows: [{ kind: 'slideshow', deck: 'intermission', title: 'X', start: '18:00', end: '19:00' }],
      }),
    ).toThrow(/deck/);
    expect(() =>
      parseScheduleConfig({
        ...valid,
        windows: [{ kind: 'party', title: 'X', start: '18:00', end: '19:00' }],
      }),
    ).toThrow(/unknown kind/);
    expect(() =>
      parseScheduleConfig({
        ...valid,
        windows: [
          { kind: 'shutdown', title: 'A', start: '18:00', end: '19:00' },
          { kind: 'shutdown', title: 'B', start: '18:30', end: '20:00' },
        ],
      }),
    ).toThrow(/overlaps/);
  });

  it('parses specialDates (noClub and replacement tables) and rejects bad keys', () => {
    const cfg = parseScheduleConfig({
      ...valid,
      specialDates: {
        '2026-11-25': { noClub: true, label: 'Thanksgiving' },
        '2026-12-16': {
          label: 'Store Night',
          windows: [{ kind: 'shutdown', title: 'Shutdown', start: '18:00', end: '24:00' }],
        },
      },
    });
    expect(cfg.specialDates['2026-11-25']).toEqual({ noClub: true, label: 'Thanksgiving' });
    const store = cfg.specialDates['2026-12-16'];
    expect(store.noClub).not.toBe(true);
    expect('windows' in store && store.windows).toHaveLength(1);

    expect(() =>
      parseScheduleConfig({ ...valid, specialDates: { 'Dec 16': { noClub: true } } }),
    ).toThrow(/bad date key/);
  });
});

describe('parseThemeConfig validation', () => {
  it('requires all scheduled clubs and valid colors', () => {
    expect(() => parseThemeConfig({ version: 1, church: { name: 'X', displayName: 'X' }, clubs: {} })).toThrow(
      /missing scheduled club/,
    );
    expect(() =>
      parseThemeConfig({
        version: 1,
        church: { name: 'X', displayName: 'X' },
        clubs: {
          puggles: { name: 'Puggles', color: 'orange' },
        },
      }),
    ).toThrow(/bad hex color/);
  });

  const club = (extra) => ({ name: 'C', color: '#123456', ...extra });
  const theme = (sparks) => ({
    version: 1,
    church: { name: 'X', displayName: 'X' },
    clubs: { puggles: club(), cubbies: club(), sparks, tnt: club(), trek: club(), journey: club() },
  });

  it('keeps the optional catalog deep and tint, and the white mark', () => {
    const t = parseThemeConfig(theme(club({ deep: '#B82B32', tint: '#FDDACF', art: { logo: 'a.svg', logoWhite: 'w.svg' } })));
    expect(t.clubs.sparks.deep).toBe('#B82B32');
    expect(t.clubs.sparks.tint).toBe('#FDDACF');
    expect(t.clubs.sparks.art.logoWhite).toBe('w.svg');
    expect(t.clubs.puggles.deep).toBeUndefined();
  });

  it('fails the build on a typo in deep or tint, like a bad color', () => {
    expect(() => parseThemeConfig(theme(club({ deep: 'red' })))).toThrow(/clubs\.sparks\.deep: bad hex color/);
    expect(() => parseThemeConfig(theme(club({ tint: '#12345' })))).toThrow(/clubs\.sparks\.tint: bad hex color/);
  });
});

describe('localDateKey', () => {
  it('uses local date parts (never UTC), zero-padded', () => {
    // 23:30 local in Maine is already the next day in UTC — the key must
    // stay on the local date.
    const lateEvening = new Date(2026, 8, 2, 23, 30, 0);
    expect(localDateKey(lateEvening)).toBe('2026-09-02');
    expect(localDateKey(new Date(2026, 0, 5, 1, 0, 0))).toBe('2026-01-05');
  });
});
