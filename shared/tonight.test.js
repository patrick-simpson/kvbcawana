import { describe, expect, it } from 'vitest';
import {
  REPORT_FRESH_MS, authoritativeTonight, distinctReportChildren, historyIdentityKey, identityKeysOfRow,
  firstLast, massUndoRefused, normalizedName, reportIsPartial, splitFullName, tonightHereNow, tonightRows,
} from './tonight.js';

const DATE = '2026-10-14';
const NOW = Date.parse('2026-10-14T22:30:00Z');
const dayOf = () => DATE;
const row = (firstName, lastName, clubName, extra = {}) => ({ firstName, lastName, clubName, timestamp: new Date(NOW - 60000).toISOString(), ...extra });
const state = ({ rows = [], report = null, checkedOut = { date: DATE, ids: new Set(), names: new Set() } } = {}) => {
  const tonight = tonightRows(rows, DATE, { onDay: () => true });
  return { tonight, report, checkedOut, dayOf };
};
const entry = (clubberId, name, club) => ({ clubberId, name, club });

describe('the pure rules (the same code the printer and the Worker run)', () => {
  it('counts the report when it is fresh, by club, one child per id', () => {
    const report = { at: NOW - 30000, entries: [entry('1', 'Ada Tester', 'Sparks'), entry('2', 'Bo Tester', 'T&amp;T'), entry('2', 'Bo Tester', 'T&amp;T')] };
    const a = authoritativeTonight(state({ report }), NOW);
    expect(a).toMatchObject({ source: 'report', checkedIn: 2, byClub: { Sparks: 1, 'T&T': 1 } });
  });

  it('falls back to the rows when the report is stale, from another day, or from the future', () => {
    const rows = [row('Ada', 'Tester', 'Sparks', { clubberId: '1' }), row('Vi', 'Sitor', 'Cubbies', { visitor: true })];
    for (const at of [NOW - REPORT_FRESH_MS - 1, NOW + 1000]) {
      expect(authoritativeTonight(state({ rows, report: { at, entries: [entry('9', 'X Y', 'Trek')] } }), NOW)).toMatchObject({ source: 'history', checkedIn: 2 });
    }
    const otherDay = { ...state({ rows, report: { at: NOW - 1000, entries: [entry('9', 'X Y', 'Trek')] } }), dayOf: () => '2026-10-07' };
    expect(authoritativeTonight(otherDay, NOW).source).toBe('history');
  });

  it('a person\'s removal beats the report, and a visitor does not count while a report is fresh', () => {
    const rows = [row('Ada', 'Tester', 'Sparks', { clubberId: '1', undone: true, undoneBy: 'desk' }), row('Vi', 'Sitor', 'Cubbies', { visitor: true })];
    const report = { at: NOW - 1000, entries: [entry('1', 'Ada Tester', 'Sparks'), entry('2', 'Bo Tester', 'Sparks')] };
    expect(authoritativeTonight(state({ rows, report }), NOW)).toMatchObject({ checkedIn: 1, byClub: { Sparks: 1 } });
  });

  it('adds only children who checked in after the report; two ids are two children; id and name are one', () => {
    const report = { at: NOW - 120000, entries: [entry('1', 'Ada Tester', 'Sparks'), entry('3', 'Sam Same', 'Sparks'), entry('4', 'Sam Same', 'Sparks')] };
    const rows = [
      row('Ada', 'Tester', 'Sparks', { timestamp: new Date(NOW - 10000).toISOString() }),   // by name, after the report: ONE child with the report's Ada
      row('Cy', 'New', 'Cubbies', { clubberId: '7', timestamp: new Date(NOW - 10000).toISOString() }),
    ];
    const here = tonightHereNow(state({ rows, report }), NOW);
    expect(here.children.map((c) => c.firstName).sort()).toEqual(['Ada', 'Cy', 'Sam', 'Sam']);
  });

  it('checked out (by id or by name) is off the count in both modes', () => {
    const report = { at: NOW - 1000, entries: [entry('1', 'Ada Tester', 'Sparks'), entry('2', 'Bo Tester', 'Sparks')] };
    const checkedOut = { date: DATE, ids: new Set(['2']), names: new Set() };
    expect(authoritativeTonight(state({ report, checkedOut }), NOW)).toMatchObject({ checkedIn: 1, checkedOut: 1 });
    const rows = [row('Dee', 'Walkin', 'Sparks')];
    const byName = { date: DATE, ids: new Set(), names: new Set(['dee walkin']) };
    expect(authoritativeTonight(state({ rows, checkedOut: byName }), NOW)).toMatchObject({ source: 'history', checkedIn: 0, checkedOut: 1 });
    // another night's marks are not tonight's
    expect(authoritativeTonight(state({ report, checkedOut: { ...checkedOut, date: '2026-10-07' } }), NOW).checkedIn).toBe(2);
  });

  it('a report entry may carry only a first name (the Worker holds nothing more)', () => {
    const report = { at: NOW - 1000, entries: [{ clubberId: '5', firstName: 'Mary Kate', club: 'Cubbies' }] };
    expect(tonightHereNow(state({ report }), NOW).children).toEqual([{ keys: ['id:5'], club: 'Cubbies', firstName: 'Mary Kate' }]);
  });

  it('partial reports and the mass-undo guard', () => {
    expect(reportIsPartial({ entries: [entry('1', 'A B', 'x')], declared: 3 })).toBe(true);
    expect(reportIsPartial({ entries: [entry('1', 'A B', 'x')], declared: 1 })).toBe(false);
    expect(reportIsPartial({ entries: [], declared: null })).toBe(false);
    expect(distinctReportChildren([entry('1', 'A B', 'x'), entry('1', 'A B', 'x'), { name: 'No Id' }])).toBe(2);
    expect(massUndoRefused(5, 10)).toBe(false);
    expect(massUndoRefused(6, 10)).toBe(true);
    expect(massUndoRefused(3, 0)).toBe(false);
  });

  it('tonightRows keeps the newest row per child, drops undone ones and prefers the id row', () => {
    const history = [
      row('Ada', 'T', 'Sparks', { clubberId: '1', undone: true }),   // newest: undone, so she is out
      row('Ada', 'T', 'Sparks', { clubberId: '1' }),
      row('Bo', 'T', 'Sparks'),                                      // name only...
      row('Bo', 'T', 'Sparks', { clubberId: '2' }),                  // ...and with an id: one child
      row('Ox', 'T', 'Sparks', { oneOff: true }),
    ];
    const t = tonightRows(history, DATE, { onDay: () => true, isNonCheckin: (r) => !!r.oneOff });
    expect(t.entries).toHaveLength(4);
    expect(t.active.map(historyIdentityKey)).toEqual(['id:2']);
  });

  it('small helpers', () => {
    expect(splitFullName('  Mary   Kate Smith ')).toEqual({ firstName: 'Mary', lastName: 'Kate Smith' });
    expect(identityKeysOfRow({ clubberId: 4, firstName: 'A', lastName: 'B' })).toEqual(['id:4', 'name:a b']);
  });
});

describe('"Sort by: Last Name" (owner 2026-10-15: duplicate labels printed "Last, First")', () => {
  it('reads "Simpson, Micah" as Micah Simpson; leaves "Smith, Jr." and plain names alone', () => {
    expect(firstLast('Simpson, Micah')).toBe('Micah Simpson');
    expect(firstLast('  De la Cruz ,  Ana Maria ')).toBe('Ana Maria De la Cruz');
    expect(firstLast('John Smith, Jr.')).toBe('John Smith, Jr.');
    expect(firstLast('Micah Simpson')).toBe('Micah Simpson');
    expect(firstLast(null)).toBe('');
  });
  it('so the split, the identity and the match all see one child', () => {
    expect(splitFullName('Simpson, Micah')).toEqual({ firstName: 'Micah', lastName: 'Simpson' });
    expect(normalizedName('Simpson, Micah')).toBe(normalizedName('Micah Simpson'));
  });
});
