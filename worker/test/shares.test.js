import { describe, expect, it } from 'vitest';
import { Shares, calendarSaysStore, parseShareBalanceCsv, shareKey } from '../src/shares.js';

const WED_5PM = Date.parse('2026-11-18T22:00:00Z');   // 5:00 pm Eastern, a club Wednesday

function store(feed) {
  const m = new Map(feed ? [['calendar', feed]] : []);
  return { get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k) };
}

describe('share balance report', () => {
  it('reads "Name","Balance" rows, skips the header and odd values', () => {
    const map = parseShareBalanceCsv('"Name","Balance"\n"Avery  McAdam","12"\n"Ben Stone","0"\n"Bad Row","x"\n');
    expect(Object.fromEntries(map)).toEqual({ 'avery mcadam': 12, 'ben stone': 0 });
  });
  it('a login page is not a report', () => {
    expect(parseShareBalanceCsv('<html><form>login</form></html>')).toBe(null);
  });
  it('keys names loosely', () => { expect(shareKey('  Avery   McAdam ')).toBe('avery mcadam'); });
});

describe('store night', () => {
  const feed = { events: [{ date: '2026-11-18', title: 'Awana Store Night', isCancelled: false }] };
  it('the calendar decides on auto', () => {
    expect(calendarSaysStore(feed, '2026-11-18')).toBe(true);
    expect(calendarSaysStore({ events: [{ date: '2026-11-18', title: 'T&T Prayer Meeting' }] }, '2026-11-18')).toBe(false);
    expect(calendarSaysStore({ events: [{ ...feed.events[0], isCancelled: true }] }, '2026-11-18')).toBe(false);
  });

  const make = (f, pages) => {
    const calls = [];
    const client = { page: async (path) => { calls.push(path); return pages(path); } };
    const watcher = { creds: () => ({ password: 'x' }), clientFor: () => client };
    return { s: new Shares({ storage: store(f), watcher, now: () => WED_5PM }), calls };
  };

  it('auto with no store event: off, no reads, no numbers', async () => {
    const { s } = make({ events: [] }, () => ({ ok: true, html: '' }));
    await s.prepare();
    expect(s.active()).toBe(false);
    expect(s.due()).toBe(false);
  });

  it('switched on: reads the five clubs, then labels get balance + 1', async () => {
    const { s, calls } = make({ events: [] }, (path) => ({ ok: true, html: path.includes('club_id=3') ? '"Name","Balance"\n"Ava Stone","7"\n' : '"Name","Balance"\n' }));
    await s.prepare();
    expect(await s.setMode('on', null)).toMatchObject({ mode: 'on', active: true });
    expect(s.due()).toBe(true);
    for (let i = 0; i < 5; i += 1) await s.readOne();
    expect(calls).toHaveLength(5);
    expect(calls[0]).toBe('/report/shekelBalance?club_id=2&output=csv');
    expect(s.due()).toBe(false);
    expect(s.labelShares('Ava', 'Stone')).toBe(8);
    expect(s.labelSharesFor('ava  stone')).toBe(8);
    expect(s.labelShares('Nobody', 'Here')).toBe(null);
    expect(s.view()).toMatchObject({ balances: 1, clubsRead: 5, error: null });
    await s.setMode('off', null);
    expect(s.labelShares('Ava', 'Stone')).toBe(null);
  });

  it('refuses an unknown mode', async () => {
    const { s } = make(null, () => ({ ok: true, html: '' }));
    await s.prepare();
    expect(await s.setMode('maybe', null)).toBe(null);
  });
});
