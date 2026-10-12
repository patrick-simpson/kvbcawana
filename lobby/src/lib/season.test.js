import { describe, expect, it } from 'vitest';
import { seasonChoice, seasonLine, seasonOptions, seasonWrites } from './season.js';
import { PRINTER_SEASON_TO_SKIN, SKIN_TABLE } from './skins.js';

describe('the one Season control (docs/SETTINGS-OVERHAUL.md 2.4)', () => {
  it('offers Auto, None, then every skin in SKIN_TABLE, once each', () => {
    const o = seasonOptions().map((x) => x.value);
    expect(o.slice(0, 2)).toEqual(['auto', 'none']);
    expect(o.slice(2)).toEqual(Object.keys(SKIN_TABLE));
    expect(new Set(o).size).toBe(o.length);
  });

  it('derives its value from nightTheme alone', () => {
    expect(seasonChoice('auto')).toBe('auto');
    expect(seasonChoice('none')).toBe('none');
    expect(seasonChoice('easter')).toBe('easter');
    expect(seasonChoice('nonsense')).toBe('none');
    expect(seasonChoice(undefined)).toBe('none');
  });

  it('Auto writes nightTheme auto + follow the printer, and church seasonTheme auto', () => {
    expect(seasonWrites('auto')).toEqual({ shared: { nightTheme: 'auto', followPrinterTheme: true }, church: { seasonTheme: 'auto' } });
  });

  it('None writes nightTheme none and church seasonTheme off', () => {
    expect(seasonWrites('none')).toEqual({ shared: { nightTheme: 'none' }, church: { seasonTheme: 'off' } });
  });

  it('a pinned skin writes it and the inverse printer season, or off when the printer has none', () => {
    expect(seasonWrites('easter')).toEqual({ shared: { nightTheme: 'easter' }, church: { seasonTheme: 'easter' } });
    expect(seasonWrites('autumn').church.seasonTheme).toBe('fall');
    expect(seasonWrites('harvest').church.seasonTheme).toBe('off');
    for (const [season, skin] of Object.entries(PRINTER_SEASON_TO_SKIN)) expect(seasonWrites(skin).church.seasonTheme).toBe(season);
  });

  it('says what tonight looks like and why', () => {
    expect(seasonLine('none', '2026-10-14')).toMatch(/^Tonight: the classic look/);
    expect(seasonLine('easter', '2026-10-14')).toBe('Tonight: Easter (you picked it)');
    expect(seasonLine('auto', '2026-10-14')).toBe('Tonight: Autumn (from the month)');
    expect(seasonLine('auto', '2026-10-14', 'Thanksgiving Feast')).toBe('Tonight: Thanksgiving (from tonight’s calendar title)');
  });
});
