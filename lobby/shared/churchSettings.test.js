import { describe, expect, it } from 'vitest';
import { CHURCH_JSON_MAX, CHURCH_KEYS, CHURCH_SPEC, mergeChurch, sanitizeChurch } from './churchSettings.js';

describe('the church settings allowlist (routes.md 10.3)', () => {
  it('lists exactly the keys that move off the laptop', () => {
    expect(CHURCH_KEYS).toEqual([
      'labelFooter', 'firstTimerInverted', 'trophyBand', 'connectCard', 'connectCardAutoFirstTimer',
      'connectCardGreeting', 'enableDrivenCheckin', 'labelTemplates', 'schedule', 'lateGraceMin',
      'pickupClubs', 'seasonTheme', 'barfNights',
    ]);
    expect(Object.keys(CHURCH_SPEC)).toEqual(CHURCH_KEYS);
    expect(CHURCH_JSON_MAX).toBe(24576);
  });

  it('never keeps a per-laptop key or a secret', () => {
    const { settings, dropped } = sanitizeChurch({
      printerName: 'DYMO', backupPrinterName: 'x', cupsMedia: 'w', musicalPrinter: true, updateBeacon: true,
      worksheetPrinter: 'y', checkinUrl: 'https://e.x', historyRetentionDays: 9, fleetConfigUrl: 'https://e.x',
      displayKey: 'k', syncSession: 's', slidesPublishToken: 't', labelFooter: 'KVBC',
    });
    expect(settings).toEqual({ labelFooter: 'KVBC' });
    expect(dropped).toContain('displayKey');
    expect(dropped).toContain('printerName');
  });

  it('keeps one printable line of at most 60 for the two texts, and an empty one', () => {
    const { settings } = sanitizeChurch({ labelFooter: '  Kennebec\nValley\u0007  Bible  ', connectCardGreeting: '' });
    expect(settings.labelFooter).toBe('Kennebec Valley Bible');
    expect(settings.connectCardGreeting).toBe('');
    expect(sanitizeChurch({ labelFooter: 'x'.repeat(80) }).settings.labelFooter).toHaveLength(60);
    expect(sanitizeChurch({ labelFooter: 5 }).dropped).toEqual(['labelFooter']);
  });

  it('keeps booleans only as booleans', () => {
    const { settings, dropped } = sanitizeChurch({ trophyBand: false, connectCard: 'yes', enableDrivenCheckin: true });
    expect(settings).toEqual({ trophyBand: false, enableDrivenCheckin: true });
    expect(dropped).toEqual(['connectCard']);
  });

  it('keeps label templates by club key, overrides only, at most 12', () => {
    const { settings } = sanitizeChurch({
      labelTemplates: {
        Sparks: { showLastName: false, nameMaxPt: 30, extra: 'no' },
        'T & T': { showFooter: false, nameMaxPt: 48 },
        default: { showIconPanel: true },
        Unknown: { showLastName: false },
      },
    });
    expect(settings.labelTemplates).toEqual({
      spark: { version: 1, showLastName: false, nameMaxPt: 30 },
      't&t': { version: 1, showFooter: false },
    });
  });

  it('cleans the schedule rows and drops a row with no club', () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({ club: `Sparks ${i}`, startTime: '6:30', location: 'Gym', room: '4' }));
    rows.unshift({ club: '', startTime: '6:00' }, { club: 'Cubbies', startTime: 'soon', location: 'L'.repeat(50) });
    const out = sanitizeChurch({ schedule: rows }).settings.schedule;
    expect(out).toHaveLength(59);
    expect(out[0]).toEqual({ club: 'Cubbies', startTime: '', location: 'L'.repeat(40), room: '' });
    expect(sanitizeChurch({ schedule: 'no' }).dropped).toEqual(['schedule']);
  });

  it('clamps the late grace and refuses junk', () => {
    expect(sanitizeChurch({ lateGraceMin: 500 }).settings.lateGraceMin).toBe(120);
    expect(sanitizeChurch({ lateGraceMin: '15' }).settings.lateGraceMin).toBe(15);
    expect(sanitizeChurch({ lateGraceMin: 'soon' }).dropped).toEqual(['lateGraceMin']);
  });

  it('reads the pickup list with the shared rule (null is the default)', () => {
    expect(sanitizeChurch({ pickupClubs: ['trek', 'sparks', 'Sparks'] }).settings.pickupClubs).toEqual(['Sparks', 'Trek']);
    expect(sanitizeChurch({ pickupClubs: null }).settings.pickupClubs).toBeNull();
    expect(sanitizeChurch({ pickupClubs: ['Chess'] }).dropped).toEqual(['pickupClubs']);
  });

  it('keeps a known season only, and BARF nights as unique sorted dates', () => {
    expect(sanitizeChurch({ seasonTheme: 'fall' }).settings.seasonTheme).toBe('fall');
    expect(sanitizeChurch({ seasonTheme: 'summer' }).dropped).toEqual(['seasonTheme']);
    const nights = sanitizeChurch({ barfNights: ['2026-10-14', '2026-09-30', '2026-10-14', 'tomorrow', 7] }).settings.barfNights;
    expect(nights).toEqual(['2026-09-30', '2026-10-14']);
  });

  it('keeps null only as an edit\'s delete', () => {
    expect(sanitizeChurch({ labelFooter: null }).dropped).toEqual(['labelFooter']);
    expect(sanitizeChurch({ labelFooter: null }, { patch: true }).settings).toEqual({ labelFooter: null });
  });

  it('merges an edit: null deletes, unknown keys are ignored, nothing is changed in place', () => {
    const prev = { labelFooter: 'A', trophyBand: false };
    const next = mergeChurch(prev, { labelFooter: null, connectCard: true, junk: 1 });
    expect(next).toEqual({ trophyBand: false, connectCard: true });
    expect(prev).toEqual({ labelFooter: 'A', trophyBand: false });
  });

  it('is safe on junk', () => {
    for (const junk of [null, undefined, 3, 'x', [], [1]]) {
      expect(sanitizeChurch(junk)).toEqual({ settings: {}, dropped: [] });
      expect(mergeChurch(junk, junk)).toEqual({});
    }
  });
});
