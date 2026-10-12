import { describe, expect, it } from 'vitest';
import { buildTrends, checkoutRate, csvCell, nightCsv, rowLines, seasonAverages, seasonOf } from './historyTrends.js';

const L = (night, club, checkedIn, checkedOut = 0) => ({ night, club, checkedIn, checkedOut, undone: 0, prints: 0 });

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
