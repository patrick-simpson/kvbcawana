// What the Chrome extension fed the print server besides check-ins, now the
// Worker's (stationfeeds.js, owner 2026-10-16): the roster export and the completed
// books, SEALED to the stations (routes.md 4), the meeting report's counts and award
// slips, and the check-outs made by hand on the Checkout page (ymcheckout.js). The
// parsers are the extension's (chrome-extension/feeds.js), rule for rule; every name
// here is made up.
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { STATION_PAD_LADDER, generateKeyPair, sealForStations } from '../../shared/cloud-crypto.js';
import {
  BOOK_CLUB_IDS, MEETING_MS, ROSTER_FRESH_MS, ROSTER_RETRY_MS, SLIPS_FROM_VERSION, SLIP_CAP, inClubHours, versionAtLeast,
} from '../src/stationfeeds.js';
import {
  parseCheckoutIds, parseCompletedBooksCsv, parseMeetingReportCsv, parseRosterCsv, trimRosterCsv,
} from '../src/twotimtwo.js';
import { READ_INTERVAL_MS } from '../src/watcher.js';
import { checkoutDisappearances } from '../src/ymcheckout.js';
import { booksCsv, checkoutPage, rosterCsv } from './fixtures.js';
import { everything, openAsStation } from './helpers.js';
import { kid, rig } from './rig.js';

const require = createRequire(import.meta.url);
/** The print server's own roster parser (printer/print-server/server/clubbers.js): what reads the CSV the stations get. */
const { parseCSV } = require('../../../printer/print-server/server/clubbers.js');

// Wednesday 2026-10-14 in the church's zone (EDT, UTC-4).
const AT = (/** @type {string} */ hm, day = '2026-10-14') => {
  const [h, m, s = 0] = hm.split(':').map(Number);
  return Date.parse(`${day}T00:00:00Z`) + ((h + 4) * 3600 + m * 60 + s) * 1000;
};
const KIDS = [
  { id: 662, first: 'Kit', last: 'Zyxelquill', club: 'Sparks', notes: 'Allergic to peanuts' },
  { id: 700, first: 'Ottoline', last: 'Quillfeather', club: 'Cubbies', notes: '' },
  { id: 701, first: 'Bram', last: 'Wexlowe', club: 'T&T', notes: 'Bee stings', photo: 'No' },
];

/** Run the alarm as the Durable Object would, until `ms` from now. */
async function drive(t, ms) {
  const until = t.clock.t + ms;
  while (t.clock.t < until) {
    await t.core.alarm();
    if (!(t.alarm.at > t.clock.t)) throw new Error('the alarm did not move forward');
    t.clock.t = Math.min(t.alarm.at, until);
  }
}
const readsOf = (t, path) => t.reads.filter((r) => r.path === path);
/** A station on KVBC Awana 10.0.0 (its heartbeat says so): no Chrome extension left on it. */
async function modern(t, ...args) {
  const st = await t.station(...args);
  await st.call('POST', '/v1/print/heartbeat', { version: '10.0.0', printer: { state: 'ok' } });
  return st;
}

describe('the roster export, parsed and trimmed', () => {
  it('reads the 66-column export, stops at its footer, and knows a cut download', () => {
    const r = parseRosterCsv(rosterCsv(KIDS));
    expect(r.rows).toHaveLength(3);
    expect(r.declared).toBe(3);
    expect(r.partial).toBe(false);
    expect(parseRosterCsv(rosterCsv(KIDS, { count: 4 })).partial).toBe(true);
    expect(parseRosterCsv('<html><input name="LoginForm[password]"></html>')).toBeNull();
    expect(parseRosterCsv('Login Required')).toBeNull();
    expect(parseRosterCsv('<!doctype html><html><body>Oops</body></html>')).toBeNull();
    expect(parseRosterCsv('"Household ID","Active Clubbers"\r\n"1","A B"\r\n')).toBeNull();
  });

  it('keeps what a label reads and drops the household\'s contact, address and payment columns', () => {
    const { csv, columns } = trimRosterCsv(/** @type {any} */ (parseRosterCsv(rosterCsv(KIDS))));
    expect(columns).toBeLessThan(30);
    for (const gone of ['555-0100', 'family@example.org', 'Elmwood', 'Augusta', '04330', 'Grandma', 'Dr Example', 'Pat Zyxelquill', 'Parent/Guardian', 'Primary Phone']) {
      expect(csv).not.toContain(gone);
    }
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ ClubberID: '662', FirstName: 'Kit', LastName: 'Zyxelquill', Club: 'Sparks', Notes: 'Allergic to peanuts', MedRelease: 'Yes', PhotoRelease: 'Yes', Birthdate: '3/3/2017', HandbookGroup: 'Group 1', Group: 'Red' });
    expect(rows[2].PhotoRelease).toBe('No');
    expect(csv.trimEnd().endsWith('Clubber Count=3')).toBe(true);
  });

  it('a quote, a comma and a line break in Notes survive the print server\'s parser', () => {
    const tricky = [{ id: 9, first: 'Jo', last: 'Quill', notes: 'Peanuts, "tree nuts"\nEpiPen in bag' }];
    const rows = parseCSV(trimRosterCsv(/** @type {any} */ (parseRosterCsv(rosterCsv(tricky)))).csv);
    expect(rows[0].Notes).toBe('Peanuts, "tree nuts"\nEpiPen in bag');
  });

  it('sealing a church-sized roster to ONE station fits the free plan\'s CPU (printed: Node is not workerd)', async () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ id: 1000 + i, first: `Child${i}`, last: `Family${i % 40}`, club: ['Sparks', 'T&T', 'Cubbies'][i % 3], notes: i % 5 ? '' : 'Allergic to peanuts and tree nuts; EpiPen in backpack' }));
    const text = rosterCsv(many);
    let t0 = performance.now();
    let trimmed = trimRosterCsv(/** @type {any} */ (parseRosterCsv(text)));
    const coldMs = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < 10; i++) trimmed = trimRosterCsv(/** @type {any} */ (parseRosterCsv(text)));
    const parseMs = (performance.now() - t0) / 10;
    const kp = await generateKeyPair();
    const item = { id: 'rosterAAAAAAAAAAAAAAAA', night: '2026-10-14', kind: 'roster', record: { csv: trimmed.csv } };
    await sealForStations([{ publicKey: kp.publicKey }], item);
    const runs = 10;
    t0 = performance.now();
    for (let i = 0; i < runs; i++) await sealForStations([{ publicKey: kp.publicKey }], item);
    const sealMs = (performance.now() - t0) / runs;
    const full = { ...item, record: { csv: text } };
    t0 = performance.now();
    await sealForStations([{ publicKey: kp.publicKey }], full);
    const fullMs = performance.now() - t0;
    const rung = STATION_PAD_LADDER.find((r) => JSON.stringify(item.record).length + 4 <= r);
    console.warn(`roster: export ${text.length} B, trimmed ${trimmed.csv.length} B (${trimmed.columns} columns, rung ${rung}); parse+trim ${parseMs.toFixed(2)} ms (first run ${coldMs.toFixed(2)} ms); seal to 1 station ${sealMs.toFixed(2)} ms (untrimmed ${fullMs.toFixed(2)} ms)`);
    expect(rung).toBeLessThanOrEqual(65536);
    expect(sealMs).toBeLessThan(10);
    expect(parseMs).toBeLessThan(10);
  });
});

describe('the roster, read by the Worker and sealed to the stations', () => {
  /** A fresh stand-in export per test: `t.src.csv` is what TwoTimTwo answers. */
  const make = async (extra = {}) => {
    const src = { csv: rosterCsv(KIDS) };
    const t = await rig({ roster: () => src.csv, ...extra });
    return Object.assign(t, { src });
  };

  it('reads /clubber/csv in a free slot, seals it to every station one tick each, and serves it', async () => {
    const t = await make();
    const a = await modern(t, 'station-aaaaaaaa');
    const b = await modern(t, 'station-bbbbbbbb', 'Second laptop');
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(1);
    for (const st of [a, b]) {
      const res = await st.call('GET', '/v1/station/roster?night=2026-10-14');
      expect(res.status).toBe(200);
      expect(res.body.bundle.kind).toBe('roster');
      expect(res.body.bundle.to).toHaveLength(2);
      const rec = await openAsStation(st.ring, res.body.bundle);
      expect(rec.csv).toContain('Allergic to peanuts');
      expect(rec.csv).not.toContain('555-0100');
      expect(parseCSV(rec.csv).map((r) => r.FirstName)).toEqual(['Kit', 'Ottoline', 'Bram']);
    }
    // every Worker read still 15 s apart
    const all = t.reads.map((r) => r.at);
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('keeps no name, no allergy and no clubber id in plain storage, and the status names nobody', async () => {
    const t = await make();
    await modern(t);
    await drive(t, 3 * 60 * 1000);
    const all = everything(t.storage);
    for (const s of ['Zyxelquill', 'Quillfeather', 'peanuts', 'Bee stings', '"662"', 'Ottoline']) expect(all).not.toContain(s);
    const s = (await t.call('GET', '/v1/cloud/status')).body.stationFeeds;
    expect(s.roster).toMatchObject({ rows: 3, stations: 1, error: null });
    expect(JSON.stringify(s)).not.toMatch(/Kit|Zyxelquill|peanut/);
  });

  it('reads again about hourly in the window, not sooner; an unchanged roster is not sealed again', async () => {
    const t = await make();
    const st = await modern(t);
    await drive(t, 3 * 60 * 1000);
    const first = (await st.call('GET', '/v1/station/roster')).body.bundle.id;
    await drive(t, ROSTER_FRESH_MS - 2 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(1);
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(2);
    expect((await st.call('GET', '/v1/station/roster')).body.bundle.id).toBe(first);
    t.src.csv = rosterCsv([...KIDS, { id: 702, first: 'Nell', last: 'Quorrin' }]);
    await drive(t, ROSTER_FRESH_MS + 60 * 1000);
    const next = (await st.call('GET', '/v1/station/roster')).body;
    expect(next.bundle.id).not.toBe(first);
    expect(next.rows).toBe(4);
  });

  it('a cut download, a page or a sign-in form keeps the last good copy, and tries again after 10 minutes', async () => {
    const t = await make();
    const st = await modern(t);
    await drive(t, 3 * 60 * 1000);
    const good = (await st.call('GET', '/v1/station/roster')).body.bundle.id;
    t.src.csv = rosterCsv(KIDS, { count: 9 });
    t.clock.t += ROSTER_FRESH_MS;
    await drive(t, 60 * 1000);
    expect((await st.call('GET', '/v1/station/roster')).body.bundle.id).toBe(good);
    expect((await t.call('GET', '/v1/cloud/status')).body.stationFeeds.roster.error).toBe('roster-partial');
    const tries = readsOf(t, '/clubber/csv').length;
    await drive(t, ROSTER_RETRY_MS - 2 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(tries);
    t.src.csv = '<html><body>Something went wrong</body></html>';
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(tries + 1);
    expect((await st.call('GET', '/v1/station/roster')).body.bundle.id).toBe(good);
    expect((await t.call('GET', '/v1/cloud/status')).body.stationFeeds.roster.error).toBe('roster-unreadable');
  });

  it('a roster that suddenly loses half its children is taken only when a second read agrees', async () => {
    const big = Array.from({ length: 30 }, (_, i) => ({ id: 2000 + i, first: `Kid${i}`, last: 'Tester' }));
    const src = { csv: rosterCsv(big) };
    const t = await rig({ roster: () => src.csv });
    const st = await modern(t);
    await drive(t, 3 * 60 * 1000);
    expect((await st.call('GET', '/v1/station/roster')).body.rows).toBe(30);
    src.csv = rosterCsv(big.slice(0, 5));
    t.clock.t += ROSTER_FRESH_MS;
    await drive(t, 3 * 60 * 1000);
    expect((await st.call('GET', '/v1/station/roster')).body.rows).toBe(30);
    await drive(t, ROSTER_RETRY_MS + 60 * 1000);
    expect((await st.call('GET', '/v1/station/roster')).body.rows).toBe(5);
  });

  it('a station that registers later gets its own copy: the roster is read and sealed again', async () => {
    const t = await make();
    const a = await modern(t, 'station-aaaaaaaa');
    await drive(t, 3 * 60 * 1000);
    const b = await modern(t, 'station-bbbbbbbb', 'New laptop');
    const miss = await b.call('GET', '/v1/station/roster');
    expect(miss.status).toBe(404);
    expect(miss.body.reason).toBe('resealing');
    await drive(t, 3 * 60 * 1000);
    const res = await b.call('GET', '/v1/station/roster');
    expect(res.status).toBe(200);
    expect((await openAsStation(b.ring, res.body.bundle)).csv).toContain('Kit');
    expect(await openAsStation(a.ring, res.body.bundle)).toBeTruthy();
  });

  it('outside the window: once a day, and at once when a station asks with no copy', async () => {
    const t = await make({ start: AT('10:00', '2026-10-16') });   // a Friday morning
    const st = await modern(t);
    expect((await st.call('GET', '/v1/station/roster')).status).toBe(404);
    expect(t.alarm.at - t.clock.t).toBeLessThanOrEqual(2000);   // the station asked: read soon
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(1);
    expect((await st.call('GET', '/v1/station/roster')).status).toBe(200);
    await drive(t, 6 * 60 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(1);   // the same day: nothing more
    t.clock.t = AT('09:00', '2026-10-17');
    await st.call('GET', '/v1/station/roster');
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(2);
  });

  it('reads nothing without a station (no one could open it)', async () => {
    const t = await make();
    await drive(t, 2 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(0);
  });

  it('the hand-over: a 9.4.9 station (its extension syncs) is answered 404 as before, and no roster or books are read for it', async () => {
    const t = await make();
    const old = await t.station();
    await old.call('POST', '/v1/print/heartbeat', { version: '9.4.9' });
    await drive(t, 6 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(0);
    expect(readsOf(t, '/report/completed_books')).toHaveLength(0);
    for (const p of ['/v1/station/roster?night=2026-10-14', '/v1/station/books?night=2026-10-14']) {
      const res = await old.call('GET', p);
      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('old-app');
    }
    // the same laptop after its 10.0.0 update
    await old.call('POST', '/v1/print/heartbeat', { version: '10.0.0' });
    await drive(t, 3 * 60 * 1000);
    expect(readsOf(t, '/clubber/csv')).toHaveLength(1);
    expect((await old.call('GET', '/v1/station/roster')).status).toBe(200);
  });

  it('routes.md 4: PUT takes a bundle sealed to every station, roster-source passes the export through, never twice in 5 minutes', async () => {
    const t = await make();
    const st = await modern(t);
    expect(t.core.registry.list()).toEqual(expect.arrayContaining([
      'GET /v1/station/roster-source station', 'GET /v1/station/roster station', 'PUT /v1/station/roster station',
      'GET /v1/station/books station', 'PUT /v1/station/books station',
    ]));
    const src = await st.call('GET', '/v1/station/roster-source?night=2026-10-14');
    expect(src.status).toBe(200);
    expect(src.body.csv).toBe(t.src.csv.replace(/^\uFEFF/, ''));
    expect(src.body.rows).toBe(3);
    expect((await st.call('GET', '/v1/station/roster-source')).status).toBe(429);
    expect(everything(t.storage)).not.toContain('Zyxelquill');
    const bundle = await sealForStations([{ publicKey: st.pub }], { id: 'putAAAAAAAAAAAAAAAAAAA', night: '2026-10-14', kind: 'roster', record: { csv: 'x' } });
    expect((await st.call('PUT', '/v1/station/roster', { night: '2026-10-14', bundle })).body).toEqual({ ok: true });
    expect((await st.call('GET', '/v1/station/roster')).body.bundle.id).toBe('putAAAAAAAAAAAAAAAAAAA');
    expect((await st.call('PUT', '/v1/station/roster', { night: '2026-10-13', bundle })).status).toBe(400);
    expect((await st.call('PUT', '/v1/station/books', { night: '2026-10-14', bundle })).body.reason).toBe('unsealed');   // its kind is roster
    expect((await t.call('GET', '/v1/station/roster')).status).toBe(403);
  });
});

describe('completed books', () => {
  it('the extension\'s parser: Name / Book / Date, footers skipped, header drift refused', () => {
    expect(parseCompletedBooksCsv(booksCsv([{ name: 'Kit Zyxelquill', book: 'HangGlider', date: '2026-10-07' }]) + 'Count=1\r\n'))
      .toEqual([{ name: 'Kit Zyxelquill', book: 'HangGlider', date: '2026-10-07' }]);
    expect(parseCompletedBooksCsv('"Name","Book","Date"\r\n')).toBeNull();   // a header alone is not a report the extension trusts
    expect(parseCompletedBooksCsv(`${booksCsv([{ name: 'A B', book: 'X', date: '' }])}`)).toEqual([{ name: 'A B', book: 'X', date: '' }]);
    expect(parseCompletedBooksCsv('"Clubber","Handbook"\r\n"A","B"\r\n')).toBeNull();
    expect(parseCompletedBooksCsv('<html>')).toBeNull();
    expect(parseCompletedBooksCsv(`"Name","Book"\r\n"${'N'.repeat(100)}","${'B'.repeat(100)}"\r\n`)[0]).toEqual({ name: 'N'.repeat(80), book: 'B'.repeat(60), date: '' });
  });

  it('one read per club in free slots, merged into ONE sealed bundle every 10 min in club hours', async () => {
    const asked = [];
    const t = await rig({
      books: (clubId, from, to) => {
        asked.push({ clubId, from, to });
        if (clubId === '5') return null;   // a club with no report: skipped, as the extension did
        return booksCsv([{ name: `Kid Club${clubId}`, book: `Book ${clubId}`, date: '2026-10-07' }]);
      },
    });
    const st = await modern(t);
    await drive(t, 6 * 60 * 1000);
    expect(asked.map((a) => a.clubId)).toEqual(BOOK_CLUB_IDS.map(String));
    expect(asked[0]).toMatchObject({ from: '2026-09-23', to: '2026-10-14' });
    const res = await st.call('GET', '/v1/station/books?night=2026-10-14');
    expect(res.status).toBe(200);
    const rec = await openAsStation(st.ring, res.body.bundle);
    expect(rec.entries.map((e) => e.name)).toEqual(['Kid Club2', 'Kid Club3', 'Kid Club4', 'Kid Club6']);
    expect(everything(t.storage)).not.toContain('Kid Club');
    await drive(t, 5 * 60 * 1000);
    expect(asked).toHaveLength(BOOK_CLUB_IDS.length);
    await drive(t, 8 * 60 * 1000);
    expect(asked).toHaveLength(2 * BOOK_CLUB_IDS.length);
  });

  it('a pass where no club could be read keeps the last good bundle; outside club hours nothing is read', async () => {
    const src = { ok: true };
    const t = await rig({ books: () => (src.ok ? booksCsv([{ name: 'Kit Zyxelquill', book: 'Wings', date: '2026-10-07' }]) : '<html>no</html>') });
    const st = await modern(t);
    await drive(t, 6 * 60 * 1000);
    const good = (await st.call('GET', '/v1/station/books')).body.bundle.id;
    src.ok = false;
    await drive(t, 14 * 60 * 1000);
    expect((await st.call('GET', '/v1/station/books')).body.bundle.id).toBe(good);
    const late = await rig({ books: () => booksCsv([]), start: AT('20:05') });
    await modern(late);
    await drive(late, 10 * 60 * 1000);
    expect(readsOf(late, '/report/completed_books')).toHaveLength(0);
    expect(inClubHours(AT('17:29'))).toBe(false);
    expect(inClubHours(AT('17:30'))).toBe(true);
    expect(inClubHours(AT('19:59'))).toBe(true);
  });
});

describe('the meeting report', () => {
  it('the extension\'s parser: award and book columns counted, a slip per child and award', () => {
    const csv = '"First Name","Last Name","Club","Award: Sparks Ticket","Section Completed"\r\n'
      + '"Kit","Zyxelquill","Sparks","Ticket",""\r\n"Bram","Wexlowe","T&T","","2.3"\r\n"","","","",""\r\nCount=2\r\n';
    expect(parseMeetingReportCsv(csv)).toEqual({
      booksCompleted: 1, awardsEarned: 1,
      slips: [{ name: 'Kit Zyxelquill', clubName: 'Sparks', award: 'Award: Sparks Ticket' }, { name: 'Bram Wexlowe', clubName: 'T&T', award: 'Section Completed' }],
    });
    // TwoTimTwo's documented header (printer/docs/TWOTIMTWO.md 8.1): "Clubber" is no name
    // column the extension knows, so it counts and slips nobody (kept rule for rule).
    const live = '"HBGroup","Clubber","Book","Unit","Award","Note"\r\n"1","Kit Zyxelquill","HangGlider","2","Ticket",""\r\n';
    expect(parseMeetingReportCsv(live)).toEqual({ booksCompleted: 1, awardsEarned: 1, slips: [] });
    expect(parseMeetingReportCsv('<html>')).toBeNull();
    expect(parseMeetingReportCsv('"Only"\r\n"x"\r\n')).toBeNull();
  });

  const MEETING = (awards) => () => `"First Name","Last Name","Club","Award"\r\n${awards.map((a) => `"${a[0]}","${a[1]}","Sparks","${a[2]}"`).join('\r\n')}\r\n`;

  it('its counts reach the Worker\'s own tonight frame, every 5 minutes in club hours, with tonight\'s meeting id', async () => {
    const asked = [];
    const t = await rig({ env: { SINGLE_PUBLISHER: 'on' }, meeting: (cal) => { asked.push(cal); return MEETING([['Kit', 'Zyxelquill', 'Ticket'], ['Bram', 'Wexlowe', 'Ticket']])(); } });
    await drive(t, 2 * 60 * 1000);
    expect(asked.length).toBe(1);
    expect(asked[0]).toBe('368');   // the check-in page the watcher read first
    expect(t.sent.filter((f) => f.e === 'tonight').at(-1).d).toMatchObject({ awardsEarned: 2, booksCompleted: 0 });
    await drive(t, MEETING_MS);
    expect(asked.length).toBe(2);
  });

  it('award slips print from the Worker only once every station runs 10.0.0; each child and award once a night', async () => {
    const list = [['Kit', 'Zyxelquill', 'Ticket']];
    const t = await rig({ meeting: () => MEETING(list)() });
    const st = await t.station();
    await drive(t, 3 * 60 * 1000);
    expect((await t.call('GET', '/v1/print/status')).body.queued).toBe(0);   // 9.4.9: its extension prints slips
    expect((await t.call('GET', '/v1/cloud/status')).body.stationFeeds.meeting).toMatchObject({ slipsHeld: 1, slipsQueued: 0, slipsOpen: false });
    expect(versionAtLeast('9.4.9', SLIPS_FROM_VERSION)).toBe(false);
    expect(versionAtLeast('10.0.0', SLIPS_FROM_VERSION)).toBe(true);
    expect(versionAtLeast('10.0.1', SLIPS_FROM_VERSION) && versionAtLeast('11.0.0', SLIPS_FROM_VERSION)).toBe(true);
    await st.call('POST', '/v1/print/heartbeat', { version: '10.0.0', printer: { state: 'ok' } });
    list.push(['Bram', 'Wexlowe', 'Ticket']);
    await drive(t, MEETING_MS + 60 * 1000);
    const next = await st.call('GET', '/v1/print/next?max=10');
    expect(next.body.jobs).toHaveLength(1);   // Kit's was the extension's: only Bram's is new
    const job = next.body.jobs[0];
    expect(job.kind).toBe('reprint');
    expect(job.jobId).toMatch(/^reprint:/);
    expect(await openAsStation(st.ring, job.bundle)).toEqual({ route: '/print-award', body: { name: 'Bram Wexlowe', clubName: 'Sparks', award: 'Award' } });   // the column's header names the award (the extension's rule)
    await st.call('POST', '/v1/print/done', { jobId: job.jobId });
    await drive(t, 2 * MEETING_MS);
    expect((await st.call('GET', '/v1/print/next?max=10')).body.jobs).toHaveLength(0);
    expect(everything(t.storage)).not.toMatch(/Wexlowe|Zyxelquill/);
  });

  it('at most 10 new slips a read; the rest wait for the next', async () => {
    const list = Array.from({ length: 14 }, (_, i) => [`Kid${i}`, 'Tester', 'Ticket']);
    const t = await rig({ meeting: () => MEETING(list)() });
    const st = await t.station();
    await st.call('POST', '/v1/print/heartbeat', { version: '10.0.0' });
    await drive(t, 3 * 60 * 1000);
    expect((await t.call('GET', '/v1/print/status')).body.queued).toBe(SLIP_CAP);
    await drive(t, MEETING_MS + 30 * 1000);
    expect((await t.call('GET', '/v1/print/status')).body.queued).toBe(14);
  });
});

describe('check-outs made by hand on the Checkout page', () => {
  // The cases of printer/scripts/test-checkout-parser.cjs and test-pickup-board.cjs.
  const row = (name, club, id) => ({ id, name, club });
  const filters = (flags) => flags.map((c, i) => `<input class="filter" type="checkbox" name="clubs[${i}]"${c ? ' checked' : ''}>`).join('');
  const withFilters = (html, flags) => html.replace('<form>', `<form>${filters(flags)}`);

  it('reads every club\'s ids only from a genuine page (the extension\'s four guards)', () => {
    const r1 = parseCheckoutIds(checkoutPage({ rows: [row('Amy A', 'Sparks', '11'), row('Ben B', 'T&T', '12'), row('Cy C', 'Sparks', '13')] }), 'x');
    expect(r1).toEqual({ date: '2026-10-14', ids: ['11', '12', '13'] });
    expect(JSON.stringify(r1)).not.toContain('Amy');
    expect(parseCheckoutIds('<html><input name="LoginForm[password]"></html>', 'x')).toBeNull();
    expect(parseCheckoutIds('', 'x')).toBeNull();
    expect(parseCheckoutIds(checkoutPage({ title: 'KVBC - Dashboard', rows: [row('Amy A', 'Sparks', '11')] }), 'x')).toBeNull();
    expect(parseCheckoutIds(withFilters(checkoutPage({ rows: [row('Amy A', 'Sparks', '11')] }), [true, false, true]), 'x')).toBeNull();
    expect(parseCheckoutIds(withFilters(checkoutPage({ rows: [row('Amy A', 'Sparks', '11')] }), [true, true, true]), 'x')).toEqual({ date: '2026-10-14', ids: ['11'] });
    expect(parseCheckoutIds(checkoutPage(), 'x')).toEqual({ date: '2026-10-14', ids: [] });   // the page's own "nobody here"
    const drifted = checkoutPage({ rows: [row('Amy A', 'Sparks', '11')] }).replace('class="clubber name M"', 'class="somethingelse"');
    expect(parseCheckoutIds(drifted, 'x')).toBeNull();
    const noData = checkoutPage().replace(/<table class="table">[\s\S]*<\/table>/, '');
    expect(parseCheckoutIds(noData, 'x')).toBeNull();   // only the notices table
  });

  it('compares two genuine reads of one meeting (checkoutDisappearances)', () => {
    let st = checkoutDisappearances(null, { date: 'd', ids: ['11', '12', '13'] });
    expect(st.left).toEqual([]);
    st = checkoutDisappearances(st, null);
    expect(st.left).toEqual([]);
    expect(st.seen.ids).toEqual(['11', '12', '13']);
    st = checkoutDisappearances(st, { date: 'd', ids: ['11', '13'] });
    expect(st.left).toEqual(['12']);
    expect(st.gone.ids).toEqual(['12']);
    st = checkoutDisappearances(st, { date: 'd', ids: [] });
    expect(st.left).toEqual(['11', '13']);
    expect(st.gone.ids).toEqual(['12', '11', '13']);
    const other = checkoutDisappearances(st, { date: 'e', ids: [] });
    expect(other.left).toEqual([]);
    expect(other.gone.ids).toEqual([]);
  });

  const ON = { YM_CHECKOUT: 'on', SINGLE_PUBLISHER: 'on' };
  const YOUNG = [kid('8001', 'Sparks', 'Amy Ample'), kid('8002', 'T&T', 'Ben Bright'), kid('8003', 'Cubbies', 'Cy Cobble')];
  const tally = (t) => t.sent.filter((f) => f.e === 'tally').at(-1)?.d;

  it('a child gone from the page between two genuine reads leaves tonight\'s count', async () => {
    const t = await rig({ env: ON, kids: YOUNG, start: AT('19:15') });
    t.night.out = YOUNG.map((k) => row(k.name, k.club, k.id));
    await drive(t, 3 * 60 * 1000);
    expect(tally(t)).toMatchObject({ total: 3 });
    t.night.out = t.night.out.filter((r) => r.id !== '8002');
    await drive(t, 150 * 1000);
    expect(tally(t)).toMatchObject({ total: 2 });
    expect((await t.call('GET', '/v1/desk/tonight')).body).toMatchObject({ checkedIn: 2 });
    expect((await t.call('GET', '/v1/cloud/status')).body.ymCheckout).toMatchObject({ leftPage: 1, leftPageCounted: 1 });
    expect(everything(t.storage)).not.toMatch(/8002|Bright/);
  });

  it('a filtered or unreadable page compares nothing: nobody leaves', async () => {
    const t = await rig({ env: ON, kids: YOUNG, start: AT('19:15') });
    t.night.out = YOUNG.map((k) => row(k.name, k.club, k.id));
    await drive(t, 3 * 60 * 1000);
    t.night.checkoutPage = () => withFilters(checkoutPage({ rows: [] }), [true, false]);
    await drive(t, 150 * 1000);
    t.night.checkoutPage = () => checkoutPage({ rows: [] }).replace('Checkout Clubber', 'Dashboard');
    await drive(t, 150 * 1000);
    expect(tally(t)).toMatchObject({ total: 3 });
    t.night.checkoutPage = null;   // the genuine page again, everyone still listed
    await drive(t, 150 * 1000);
    expect(tally(t)).toMatchObject({ total: 3 });
  });
});
