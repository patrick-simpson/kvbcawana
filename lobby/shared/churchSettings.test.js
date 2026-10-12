import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHURCH_JSON_MAX,
  CHURCH_KEYS,
  CHURCH_SEASONS,
  CHURCH_SPEC,
  cleanChurchValue,
  mergeChurch,
  sanitizeChurch,
} from './churchSettings.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// The laptop's church part as config.json holds it today: every key, valid.
const FULL = {
  labelFooter: 'Kennebec Valley Baptist Church',
  connectCardGreeting: "We're so glad you're here!",
  firstTimerInverted: true,
  trophyBand: false,
  connectCard: true,
  connectCardAutoFirstTimer: true,
  enableDrivenCheckin: true,
  labelTemplates: { default: { version: 1, showFooter: false }, spark: { version: 1, nameMaxPt: 30, showLastName: false } },
  schedule: [{ club: 'Sparks', startTime: '18:00', location: 'Gym', room: '4' }],
  lateGraceMin: 10,
  pickupClubs: ['Puggles', 'Cubbies', 'Sparks', 'T&T'],
  seasonTheme: 'fall',
  barfNights: ['2026-10-21', '2026-11-04'],
};

describe('churchSettings', () => {
  it('names exactly the keys routes.md 10.3 lists', () => {
    expect([...CHURCH_KEYS].sort()).toEqual([
      'barfNights', 'connectCard', 'connectCardAutoFirstTimer', 'connectCardGreeting', 'enableDrivenCheckin',
      'firstTimerInverted', 'labelFooter', 'labelTemplates', 'lateGraceMin', 'pickupClubs', 'schedule',
      'seasonTheme', 'trophyBand',
    ]);
    expect(CHURCH_KEYS).toEqual(Object.keys(CHURCH_SPEC));
    expect(CHURCH_JSON_MAX).toBe(24576);
    expect(CHURCH_SEASONS).toEqual(['auto', 'off', 'back-to-school', 'fall', 'thanksgiving', 'christmas', 'winter', 'spring', 'easter', 'vbs-summer']);
  });

  it('keeps a whole valid document as it is', () => {
    expect(sanitizeChurch(FULL)).toEqual({ settings: FULL, dropped: [] });
  });

  it('never keeps a printer, a URL, a secret or an unknown key, and says so', () => {
    const r = sanitizeChurch({
      ...FULL, printerName: 'DYMO', backupPrinterName: 'x', cupsMedia: 'w', musicalPrinter: true, updateBeacon: true,
      worksheetPrinter: 'HP', checkinUrl: 'https://x', historyRetentionDays: 30, fleetConfigUrl: 'https://y',
      displayKey: 'k', syncSession: 's', phonePin: '1', slidesPublishToken: 't', __proto__junk: 1,
    });
    expect(r.settings).toEqual(FULL);
    expect(r.dropped).toEqual(expect.arrayContaining(['printerName', 'cupsMedia', 'displayKey', 'syncSession', 'checkinUrl', 'fleetConfigUrl']));
  });

  it('a line is one printable line of at most 60, and "" is kept', () => {
    expect(cleanChurchValue('labelFooter', 'a\n\tb\u0007  c')).toEqual({ ok: true, value: 'a b c' });
    expect(cleanChurchValue('labelFooter', 'x'.repeat(80)).value).toHaveLength(60);
    expect(cleanChurchValue('connectCardGreeting', '')).toEqual({ ok: true, value: '' });
    expect(cleanChurchValue('labelFooter', 42)).toEqual({ ok: false });
  });

  it('a switch is a real boolean only', () => {
    for (const k of ['firstTimerInverted', 'trophyBand', 'connectCard', 'connectCardAutoFirstTimer', 'enableDrivenCheckin']) {
      expect(cleanChurchValue(k, false)).toEqual({ ok: true, value: false });
      expect(cleanChurchValue(k, 'true')).toEqual({ ok: false });
      expect(cleanChurchValue(k, 1)).toEqual({ ok: false });
    }
  });

  it('lateGraceMin is an integer 0..120', () => {
    expect(cleanChurchValue('lateGraceMin', 0)).toEqual({ ok: true, value: 0 });
    expect(cleanChurchValue('lateGraceMin', 120)).toEqual({ ok: true, value: 120 });
    for (const bad of [-1, 121, 1.5, '10', NaN, Infinity]) expect(cleanChurchValue('lateGraceMin', bad)).toEqual({ ok: false });
  });

  it('seasonTheme is one of the seasons, auto or off', () => {
    for (const s of CHURCH_SEASONS) expect(cleanChurchValue('seasonTheme', s)).toEqual({ ok: true, value: s });
    expect(cleanChurchValue('seasonTheme', 'halloween')).toEqual({ ok: false });
    expect(cleanChurchValue('seasonTheme', 'FALL')).toEqual({ ok: false });
  });

  it('pickupClubs follows the pickup list rule (canonical, ordered, deduplicated)', () => {
    expect(cleanChurchValue('pickupClubs', ['t&t', 'Sparks', 'sparks', 'T & T'])).toEqual({ ok: true, value: ['Sparks', 'T&T'] });
    expect(cleanChurchValue('pickupClubs', [])).toEqual({ ok: true, value: [] });
    expect(cleanChurchValue('pickupClubs', ['Narnia'])).toEqual({ ok: false });
    expect(cleanChurchValue('pickupClubs', 'Sparks')).toEqual({ ok: false });
    // null is "the default": neither kept nor dropped.
    expect(sanitizeChurch({ pickupClubs: null })).toEqual({ settings: {}, dropped: [] });
  });

  it('labelTemplates keeps overrides only, by club key, at most 12 keys', () => {
    const r = cleanChurchValue('labelTemplates', {
      'Sparks - Room 4': { showClubLine: false, junk: 'x', showFooter: true },
      'T & T': { nameMaxPt: 47.2 },
      cubbies: { nameMaxPt: 48 },          // out of range: no override left, dropped
      Narnia: { showFooter: false },       // not a club
      default: { showIconPanel: false },
      puggles: 'nope',
    });
    expect(r).toEqual({ ok: true, value: { spark: { version: 1, showClubLine: false }, 't&t': { version: 1, nameMaxPt: 47 }, default: { version: 1, showIconPanel: false } } });
    expect(cleanChurchValue('labelTemplates', [])).toEqual({ ok: false });
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i < 12 ? `x${i}` : 'default', { showFooter: false }]));
    expect(cleanChurchValue('labelTemplates', many)).toEqual({ ok: true, value: {} });   // the 13th key on is never read
  });

  it('schedule rows: club 1..30, a time or "", location and room up to 40, at most 60 rows', () => {
    const r = cleanChurchValue('schedule', [
      { club: '  Sparks\n', startTime: '6:05', location: 'G'.repeat(50), room: 7 },
      { club: '', startTime: '18:00' },
      { club: 'T&T', startTime: 'six', location: 'Hall' },
      'junk',
    ]);
    expect(r).toEqual({ ok: true, value: [
      { club: 'Sparks', startTime: '6:05', location: 'G'.repeat(40), room: '' },
      { club: 'T&T', startTime: '', location: 'Hall', room: '' },
    ] });
    expect(cleanChurchValue('schedule', Array.from({ length: 70 }, () => ({ club: 'Sparks' }))).value).toHaveLength(60);
    expect(cleanChurchValue('schedule', {})).toEqual({ ok: false });
  });

  it('barfNights: real dates, unique, sorted, at most 20', () => {
    expect(cleanChurchValue('barfNights', ['2026-11-04', '2026-10-21', '2026-11-04', '2026-02-30', 'soon', 5]))
      .toEqual({ ok: true, value: ['2026-10-21', '2026-11-04'] });
    const days = Array.from({ length: 21 }, (_, i) => `2026-12-${String(i + 1).padStart(2, '0')}`);
    expect(cleanChurchValue('barfNights', days)).toEqual({ ok: false });
    expect(cleanChurchValue('barfNights', days.slice(0, 20)).value).toHaveLength(20);
  });

  it('junk in, nothing out', () => {
    for (const junk of [null, undefined, 'x', 5, [], [FULL]]) expect(sanitizeChurch(junk)).toEqual({ settings: {}, dropped: [] });
    expect(sanitizeChurch(JSON.parse('{"__proto__": {"x": 1}, "constructor": 1}')).settings).toEqual({});
  });

  it('a full document fits CHURCH_JSON_MAX with room to spare', () => {
    const big = {
      ...FULL,
      schedule: Array.from({ length: 60 }, (_, i) => ({ club: `Club ${i}`.padEnd(30, 'x'), startTime: '18:00', location: 'L'.repeat(40), room: 'R'.repeat(40) })),
      labelTemplates: Object.fromEntries(['default', 'puggle', 'cubbie', 'spark', 't&t', 'trek', 'journey'].map((k) => [k, { version: 1, showIconPanel: false, showLastName: false, showClubLine: false, showGroupLine: false, showVisitorPill: false, showFooter: false, nameMaxPt: 30 }])),
      barfNights: Array.from({ length: 20 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`),
    };
    const s = sanitizeChurch(big).settings;
    expect(new TextEncoder().encode(JSON.stringify(s)).length).toBeLessThan(CHURCH_JSON_MAX);
  });

  it('mergeChurch: null deletes, a good value replaces, a bad one leaves the old value', () => {
    const next = mergeChurch(FULL, { labelFooter: 'New', pickupClubs: null, lateGraceMin: 999, printerName: 'x', seasonTheme: 'winter' });
    expect(next.labelFooter).toBe('New');
    expect('pickupClubs' in next).toBe(false);
    expect(next.lateGraceMin).toBe(10);
    expect(next.seasonTheme).toBe('winter');
    expect('printerName' in next).toBe(false);
    expect(FULL.labelFooter).toBe('Kennebec Valley Baptist Church');   // prev untouched
    expect(mergeChurch(null, { trophyBand: true })).toEqual({ trophyBand: true });
    expect(mergeChurch(FULL, 'junk')).toEqual(FULL);
  });

  it('is a shared module the CommonJS generator can copy (named imports of shared modules, export const/function)', () => {
    const src = readFileSync(resolve(HERE, 'churchSettings.js'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./clubs.js', './pickup.js', './text.js']);
    expect(src).not.toMatch(/^export\s+(default|\{|\*)/m);
  });
});
