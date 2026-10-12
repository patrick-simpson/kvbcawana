import { describe, expect, it } from 'vitest';
import { CHANGE_KINDS, canUndo, describeChange, filterChanges, keyWords, whenWords } from './changeLog.js';

const e = (over) => ({ seq: 1, at: '2026-10-14T23:00:00Z', device: { kind: 'page', name: 'Chrome on Android' }, what: 'shared', keys: ['standardDisplayMs'], undoable: true, ...over });

describe('the change log words (routes.md 10.5)', () => {
  it('says who changed what, with the keys in plain words', () => {
    const d = describeChange(e());
    expect(d).toMatchObject({ who: 'Chrome on Android', what: 'church-wide screen settings', detail: 'standard display ms', undone: false, isUndo: false });
    expect(keyWords('connectCardAutoFirstTimer')).toBe('connect card auto first timer');
  });

  it('names a switch by its owner-facing words and says what it is now', () => {
    const d = describeChange(e({ what: 'switch', target: 'YM_CHECKOUT', keys: ['YM_CHECKOUT'], after: { YM_CHECKOUT: 'on' } }));
    expect(d.what).toContain('Automatic Trek and Journey check-out');
    expect(d.detail).toBe('now on');
  });

  it('a notice is sent or taken down; a missing device is an unknown device', () => {
    expect(describeChange(e({ what: 'notice', keys: [], after: { level: 'info' } })).detail).toBe('sent');
    expect(describeChange(e({ what: 'notice', keys: [], after: null })).detail).toBe('taken down');
    expect(describeChange(e({ device: undefined })).who).toBe('An unknown device');
  });

  it('caps a long key list and marks undone / undo entries', () => {
    const d = describeChange(e({ keys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], undoneBy: 9 }));
    expect(d.detail).toMatch(/and 2 more$/);
    expect(d.undone).toBe(true);
    expect(describeChange(e({ undoOf: 3 })).isUndo).toBe(true);
  });

  it('offers Undo only on an undoable, not-yet-undone, original entry', () => {
    expect(canUndo(e())).toBe(true);
    expect(canUndo(e({ undoable: false }))).toBe(false);
    expect(canUndo(e({ undoneBy: 4 }))).toBe(false);
    expect(canUndo(e({ undoOf: 2 }))).toBe(false);
  });

  it('filters by kind', () => {
    const list = [e({ seq: 1 }), e({ seq: 2, what: 'switch' }), e({ seq: 3, what: 'notice' }), e({ seq: 4, what: 'slides' }), e({ seq: 5, what: 'passphrase' })];
    expect(filterChanges(list, 'all')).toHaveLength(5);
    expect(filterChanges(list, 'switch').map((x) => x.seq)).toEqual([2]);
    expect(filterChanges(list, 'content').map((x) => x.seq)).toEqual([4]);
    expect(filterChanges(list, 'account').map((x) => x.seq)).toEqual([5]);
    expect(filterChanges(list, 'nope')).toHaveLength(5);
    expect(CHANGE_KINDS[0].id).toBe('all');
  });

  it('words a time, today by clock and other days with the weekday', () => {
    const now = Date.parse('2026-10-14T23:30:00');
    expect(whenWords(Date.parse('2026-10-14T19:05:00'), now)).toMatch(/7:05/);
    expect(whenWords('2026-10-10T19:05:00', now)).toMatch(/Sat/);
    expect(whenWords('nonsense', now)).toBe('');
  });
});
