import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import {
  NIGHTS_KEY, STORE_MIN, Shares, balancesFromRoster, calendarSaysStore, isStoreTitle, sharesGained, storeTagNumber,
} from '../src/shares.js';
import { storeTitleOnPage } from '../src/twotimtwo.js';

// Wednesdays in the watch window (5:00 pm Eastern) and one outside it (noon).
const NOV18_5PM = Date.parse('2026-11-18T22:00:00Z');
const NOV25_5PM = Date.parse('2026-11-25T22:00:00Z');
const NOV25_NOON = Date.parse('2026-11-25T17:00:00Z');

function memory(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { m, get: async (k) => m.get(k), put: async (k, v) => { m.set(k, v); }, delete: async (k) => m.delete(k) };
}

const roster = (rows) => ({
  header: ['Clubber ID', 'First Name', 'Last Name', 'Club', 'Share Balance', 'Notes'],
  rows: rows.map(([id, bal]) => [String(id), 'A', 'B', 'Sparks', String(bal), '']),
});

function make({ at, storage = memory(), ttt = false, cal = null }) {
  if (cal) storage.m.set('calendar', cal);
  const clock = { t: at };
  const s = new Shares({ storage, watcher: {}, now: () => clock.t, secret: () => 'state-secret', tttSaysStore: () => ttt });
  return { s, storage, clock };
}

describe('share numbers', () => {
  it('reads balances by Clubber ID from the roster export, not by name', () => {
    expect(balancesFromRoster(roster([[101, 7], [102, '15'], [103, ''], ['x', 3]]))).toEqual({ 101: 7, 102: 15 });
    expect(balancesFromRoster({ header: ['Clubber ID', 'First Name'], rows: [] })).toBe(null);
  });

  it('the store tag: balance + 1, never under 10, 10 for a child not listed (owner 2026-11-21)', () => {
    expect(STORE_MIN).toBe(10);
    expect(storeTagNumber(7)).toBe(10);
    expect(storeTagNumber(9)).toBe(10);
    expect(storeTagNumber(15)).toBe(16);
    expect(storeTagNumber(undefined)).toBe(10);
  });

  it('"+N": tonight minus last week, only when it went up; a top-up counts on store nights', () => {
    expect(sharesGained(8, 5, false)).toBe(4);      // 8 + 1 tonight - 5
    expect(sharesGained(4, 5, false)).toBe(null);   // went down (spent): nothing
    expect(sharesGained(4, 5, true)).toBe(5);       // store night: topped up to 10, 10 - 5
    expect(sharesGained(20, 30, true)).toBe(null);  // spent at the store: nothing
    expect(sharesGained(8, undefined, false)).toBe(null); // no last week: nothing
    expect(sharesGained(undefined, 3, false)).toBe(null);
  });
});

describe('tonight\'s balances', () => {
  it('only the first roster read of a club night counts, and it survives a restart sealed', async () => {
    const { s, storage, clock } = make({ at: NOV18_5PM });
    await s.prepare();
    expect(s.wantsRoster()).toBe(true);
    expect(await s.takeRoster(roster([[101, 5]]), clock.t)).toBe(true);
    expect(await s.takeRoster(roster([[101, 6]]), clock.t + 60000)).toBe(false); // later read: ignored
    expect(s.wantsRoster()).toBe(false);
    const sealed = storage.m.get(NIGHTS_KEY);
    expect(JSON.stringify(sealed)).not.toContain('101');                         // sealed, no id in the clear

    // The next week, a fresh Worker (a deploy) opens last week's balances again.
    const next = make({ at: NOV25_5PM, storage });
    await next.s.prepare();
    expect(next.s.lastNight()).toBe('2026-11-18');
    await next.s.takeRoster(roster([[101, 8], [102, 2]]), next.clock.t);
    expect(next.s.gainedFor('101')).toBe(4);
    expect(next.s.gainedFor('102')).toBe(null);   // new: no last week
    expect(next.s.tagFor('101')).toBe(null);      // not store night: no tag number
  });

  it('an export with no Share Balance column is not asked for again all night', async () => {
    const { s } = make({ at: NOV25_5PM });
    await s.prepare();
    expect(await s.takeRoster({ header: ['Clubber ID', 'First Name', 'Last Name'], rows: [['101', 'A', 'B']] }, NOV25_5PM)).toBe(false);
    expect(s.wantsRoster()).toBe(false);
    expect(s.view().error).toBe('no-share-column');
  });

  it('a read outside the watch window is never a night\'s balances', async () => {
    const { s } = make({ at: NOV25_NOON });
    await s.prepare();
    expect(s.wantsRoster()).toBe(false);
    expect(await s.takeRoster(roster([[101, 5]]), NOV25_NOON)).toBe(false);
  });
});

describe('store night switch', () => {
  it('Automatic follows the church calendar OR TwoTimTwo\'s page; On and Off override', async () => {
    const calendar = { events: [{ date: '2026-11-25', title: 'Awana Store Night', isCancelled: false }] };
    expect(calendarSaysStore(calendar, '2026-11-25')).toBe(true);
    const a = make({ at: NOV25_5PM, cal: calendar });
    await a.s.prepare();
    expect(a.s.active()).toBe(true);

    const b = make({ at: NOV25_5PM, cal: { events: [{ date: '2026-11-25', title: 'T&T Prayer Meeting' }] }, ttt: true });
    await b.s.prepare();
    expect(b.s.active()).toBe(true);   // the 11-18 miss: TwoTimTwo said store, the calendar did not
    await b.s.setMode('off', null);
    expect(b.s.active()).toBe(false);

    const c = make({ at: NOV25_5PM });
    await c.s.prepare();
    expect(c.s.active()).toBe(false);
    await c.s.setMode('on', null);
    await c.s.takeRoster(roster([[101, 3]]), NOV25_5PM);
    expect(c.s.tagFor('101')).toBe(10);
    expect(c.s.tagFor('999')).toBe(10);
    expect(await c.s.setMode('maybe', null)).toBe(null);
  });

  it('the calendar test wants the word store, not Restore (IP-20261125-11)', () => {
    expect(isStoreTitle('Awana Store Night')).toBe(true);
    expect(isStoreTitle('Restore night')).toBe(false);
    expect(calendarSaysStore({ events: [{ date: '2026-11-25', title: 'Restore Evening' }] }, '2026-11-25')).toBe(false);
  });

  it('TwoTimTwo\'s check-in page: a store title counts, a Store link in its menu never does', () => {
    const page = (body) => parseHTML(`<html><body>${body}</body></html>`).document;
    expect(storeTitleOnPage(page('<nav><a>Store</a></nav><h2>Checkin</h2>'))).toBe(false);
    expect(storeTitleOnPage(page('<nav><a>Store</a></nav><h2 class="title">Awana Store Night</h2>'))).toBe(true);
    expect(storeTitleOnPage(page('<div class="calendar-event">AWANA STORE</div>'))).toBe(true);
    expect(storeTitleOnPage(page('<select name="date"><option selected>11/25 - Awana Store</option></select>'))).toBe(true);
    expect(storeTitleOnPage(page('<h3>Restore the roster</h3>'))).toBe(false);
  });
});

describe('On lasts for tonight only (IP-20261125-05)', () => {
  const DEC2_5PM = Date.parse('2026-12-02T22:00:00Z');
  it('On set on one day reads as Automatic the next day; Off stays off', async () => {
    const a = make({ at: NOV25_5PM });
    await a.s.prepare();
    await a.s.setMode('on', null);
    expect(a.s.active()).toBe(true);
    expect(a.s.view().mode).toBe('on');
    a.clock.t = DEC2_5PM;
    await a.s.prepare();
    expect(a.s.mode).toBe('auto');
    expect(a.s.active()).toBe(false);
    await a.s.setMode('off', null);
    a.clock.t = DEC2_5PM + 7 * 24 * 3600 * 1000;
    expect(a.s.mode).toBe('off');
  });
  it('an old On with no date is Automatic', async () => {
    const storage = memory({ 'store:mode': { mode: 'on', at: '2026-11-18T22:00:00.000Z', by: null } });
    const a = make({ at: NOV25_5PM, storage });
    await a.s.prepare();
    expect(a.s.mode).toBe('auto');
    expect(a.s.active()).toBe(false);
  });
});

