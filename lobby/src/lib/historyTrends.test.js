import { describe, expect, it } from 'vitest';
import {
  buildTrends, checkoutRate, csvCell, nightCheckoutRate, nightCsv, nightSourceNote, rowLines, seasonAverages, seasonOf,
} from './historyTrends.js';

const L = (night, club, checkedIn, checkedOut = 0) => ({ night, club, checkedIn, checkedOut, undone: 0, prints: 0 });
// An imported line, exactly as GET /v1/history/summary answers one (worker/src/history.js).
const I = (night, club, checkedIn) => ({ night, club, checkedIn, checkedOut: 0, undone: 0, prints: 0, imported: true });

describe('trends', () => {
  it('seasons run August to July', () => {
    expect(seasonOf('2026-09-02')).toBe('2026-27');
    expect(seasonOf('2027-03-10')).toBe('2026-27');
    expect(seasonOf('2027-08-04')).toBe('2027-28');
  });

  it('totals per night, visitors from the kinds, averages per season', () => {
    const t = buildTrends(
      [L('2026-10-07', 'Sparks', 10, 9), L('2026-10-07', 'T&T', 6, 6), L('2026-10-14', 'Sparks', 12, 6), L('2027-09-08', 'Sparks', 20)],
      [{ night: '2026-10-07', kinds: { checkin: 16, visitor: 2 } }, { night: '2026-10-14', kinds: {} }],
    );
    expect(t.clubs).toEqual(['Sparks', 'T&T']);
    expect(t.perNight[0]).toMatchObject({ night: '2026-10-07', checkedIn: 16, checkedOut: 15, visitors: 2, byClub: { Sparks: 10, 'T&T': 6 } });
    expect(t.perNight[1].byClub['T&T']).toBe(0);
    expect(t.seasons).toEqual(['2026-27', '2027-28']);
    expect(seasonAverages(t)[0]).toEqual({ season: '2026-27', nights: 2, avg: { Sparks: 11, 'T&T': 6 } });
  });

  it('a live-only night is unchanged: check-outs and visitors as the desk counted them', () => {
    const t = buildTrends([L('2026-10-07', 'Sparks', 10, 9), L('2026-10-07', 'T&T', 6, 6)], [{ night: '2026-10-07', kinds: { visitor: 3 } }]);
    expect(t.perNight[0]).toMatchObject({ checkedIn: 16, deskCheckedIn: 16, checkedOut: 15, visitors: 3, imported: false, importedClubs: [] });
    expect(nightCheckoutRate(t.perNight[0])).toBe(94);
    expect(nightSourceNote(t.perNight[0])).toBe('');
  });

  it('a night counted wholly from TwoTimTwo has NO check-out rate and NO visitor count (null, never 0)', () => {
    const t = buildTrends([I('2019-10-02', 'Sparks', 21), I('2019-10-02', 'T&T', 30)], []);
    expect(t.perNight[0]).toMatchObject({ night: '2019-10-02', checkedIn: 51, byClub: { Sparks: 21, 'T&T': 30 }, checkedOut: null, visitors: null, imported: true });
    expect(nightCheckoutRate(t.perNight[0])).toBeNull();
    expect(nightSourceNote(t.perNight[0])).toBe(' (from TwoTimTwo)');
  });

  it('an imported-only season: attendance and averages count every night; nothing invents check-outs or visitors', () => {
    const t = buildTrends([
      I('2019-09-11', 'Sparks', 18), I('2019-09-11', 'Cubbies', 9),
      I('2019-09-18', 'Sparks', 22), I('2019-09-18', 'Cubbies', 11),
      L('2026-10-07', 'Sparks', 20, 18),
    ], [{ night: '2026-10-07', kinds: { visitor: 1 } }]);
    expect(t.seasons).toEqual(['2019-20', '2026-27']);
    const old = t.perNight.filter((p) => p.season === '2019-20');
    expect(old.every((p) => p.imported && p.checkedOut === null && p.visitors === null)).toBe(true);
    expect(old.map((p) => p.checkedIn)).toEqual([27, 33]);
    expect(seasonAverages(t)[0]).toEqual({ season: '2019-20', nights: 2, avg: { Sparks: 20, Cubbies: 10 } });
    // Totals across seasons still add every club on every night.
    expect(t.perNight.reduce((n, p) => n + p.checkedIn, 0)).toBe(27 + 33 + 20);
    expect(t.perNight.filter((p) => !p.imported).map(nightCheckoutRate)).toEqual([90]);
  });

  it('a mixed night uses only its desk clubs for check-outs; attendance counts every club', () => {
    // The desk counted Sparks (10 in, 9 out); T&T came from TwoTimTwo (20, no check-outs known).
    const t = buildTrends([L('2026-10-07', 'Sparks', 10, 9), I('2026-10-07', 'T&T', 20)], [{ night: '2026-10-07', kinds: { visitor: 2 } }]);
    const p = t.perNight[0];
    expect(p).toMatchObject({ checkedIn: 30, deskCheckedIn: 10, checkedOut: 9, visitors: 2, imported: false, importedClubs: ['T&T'] });
    expect(nightCheckoutRate(p)).toBe(90);                 // 9 of the desk's 10, not 9 of 30
    expect(nightSourceNote(p)).toBe(' (some clubs from TwoTimTwo)');
  });

  it('the check-out rate is a whole percent, null with no check-ins', () => {
    expect(checkoutRate(9, 10)).toBe(90);
    expect(checkoutRate(0, 0)).toBeNull();
    expect(checkoutRate(12, 10)).toBe(100);
  });
});

describe('the CSV', () => {
  it('quotes, and defuses a typed name that a spreadsheet would run as a formula', () => {
    expect(csvCell('Ann, "AJ" Lee')).toBe('"Ann, ""AJ"" Lee"');
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe("'+1");
  });

  it('one line per row under a header, and only the fields a leader needs', () => {
    const lines = rowLines([{ id: 'a', kind: 'checkin', record: { first: 'Ada', last: 'Tester', club: 'Sparks', ts: Date.parse('2026-10-14T22:30:00Z'), medical: 'never shown' } }]);
    expect(lines[0]).toEqual({ id: 'a', time: '6:30 PM', kind: 'checkin', name: 'Ada Tester', club: 'Sparks', friend: '' });
    expect(nightCsv('2026-10-14', lines)).toBe('Night,Time,What,Name,Club,Friend\r\n2026-10-14,6:30 PM,checkin,Ada Tester,Sparks,\r\n');
  });
});
