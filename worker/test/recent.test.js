// "Not here the last two club nights" (src/recent.js): the club nights looked back
// over, the hashed rows in D1, the answer the roster carries, the watcher's
// recording and the cron's back-fill from TwoTimTwo's check-in report.
import { describe, expect, it } from 'vitest';
import { d1Stub } from './d1stub.js';
import { memoryStore } from './helpers.js';
import { NIGHT, WED_6PM, kid, rig } from './rig.js';

const THU = Date.parse('2026-10-15T16:00:00Z');   // Thursday 12 pm EDT
const PREV = '2026-10-07';
const WED_BEFORE = '2026-09-30';
const HOUR = 60 * 60 * 1000;

/** The calendar the Worker keeps: the season's Wednesdays, with `cancel` dates cancelled. */
function feed({ cancel = [] } = {}) {
  const events = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.UTC(2026, 8, 2 + 7 * i, 12)).toISOString().slice(0, 10);
    events.push({ date, kind: 'club', title: 'Awana Clubs', ...(cancel.includes(date) ? { isCancelled: true } : {}) });
  }
  return { version: 2, generatedAt: '2026-09-01T10:00:00Z', checkedAt: '2026-09-01T10:00:00Z', sourceUrl: 'https://example.org/calendar', events };
}

async function setup({ db = d1Stub(), start = THU, calendar = null, kids = [] } = {}) {
  const storage = memoryStore();
  if (calendar) await storage.put('calendar', calendar);
  const t = await rig({ storage, env: db ? { HISTORY_DB: db } : {}, start, kids });
  return { t, db, storage, recent: t.core.recent };
}

const entries = (...ids) => ids.map((id) => ({ clubberId: String(id), name: `Kid${id} Tester`, club: 'Sparks' }));
const rows = (db, night) => db.query('SELECT tag FROM seen_nights WHERE night = ?', night).map((r) => r.tag);
const reportReads = (t) => t.tt.calls.filter((c) => c.path.startsWith('/clubber/checkin_report')).map((c) => c.path);
const quiet = (recent) => { recent.log = () => {}; };

describe('pastNights', () => {
  it('on Thursday 2026-10-15 the two past club nights are the last two Wednesdays', async () => {
    const { recent } = await setup();
    expect(recent.pastNights(THU, null)).toEqual(['2026-10-14', PREV]);
    expect(recent.pastNights(THU, feed())).toEqual(['2026-10-14', PREV]);
  });

  it('is the days before today only: on the club night itself, tonight is not one of them', async () => {
    const { recent } = await setup();
    expect(recent.pastNights(WED_6PM, null)).toEqual([PREV, WED_BEFORE]);
  });

  it('skips a night the stored calendar cancelled', async () => {
    const { recent } = await setup();
    expect(recent.pastNights(THU, feed({ cancel: ['2026-10-14'] }))).toEqual([PREV, WED_BEFORE]);
  });

  it('skips a special noClub date', async () => {
    const { recent } = await setup();
    recent.schedule = { version: 1, timezone: 'America/New_York', meeting: { day: 3 }, specialDates: { [PREV]: { noClub: true } } };
    expect(recent.pastNights(THU, null)).toEqual(['2026-10-14', WED_BEFORE]);
  });
});

describe('record', () => {
  it('writes hashed rows: no clubber id in D1, tags 16 to 64 characters', async () => {
    const { db, recent } = await setup();
    expect(await recent.record(NIGHT, entries(662, 9137, 40))).toBe(3);
    const tags = rows(db, NIGHT);
    expect(tags).toHaveLength(3);
    for (const tag of tags) expect(tag.length >= 16 && tag.length <= 64).toBe(true);
    expect(new Set(tags).size).toBe(3);
    for (const id of ['662', '9137']) expect(tags.some((tag) => tag === id)).toBe(false);
    expect(db.dump()).not.toMatch(/Tester|clubberId/);
    expect(db.query('SELECT night, tag FROM seen_nights').every((r) => !/^\d+$/.test(r.tag))).toBe(true);
  });

  it('the same children again write nothing new; a new child adds one row', async () => {
    const { db, recent } = await setup();
    await recent.record(NIGHT, entries(662, 9137));
    const batches = db.batches;
    expect(await recent.record(NIGHT, entries(662, 9137))).toBe(0);
    expect(db.batches).toBe(batches);
    expect(await recent.record(NIGHT, entries(662, 9137, 77))).toBe(1);
    expect(db.batches).toBe(batches + 1);
    expect(rows(db, NIGHT)).toHaveLength(3);
  });

  it('keeps one hash for a child on every night, and ignores entries with no usable id', async () => {
    const { db, recent } = await setup();
    await recent.record(NIGHT, entries(662));
    await recent.record(PREV, [...entries(662), { clubberId: 'abc' }, { name: 'x' }]);
    expect(rows(db, PREV)).toEqual(rows(db, NIGHT));
  });
});

describe('seenOf', () => {
  it('is null with no rows, and null with only one of the two nights', async () => {
    const { recent } = await setup();
    expect(await recent.seenOf(['662'])).toBeNull();
    await recent.record('2026-10-14', entries(662));
    expect(await recent.seenOf(['662'])).toBeNull();
  });

  it('is a Set of the ids seen on either night once both have rows; others are not in it', async () => {
    const { recent } = await setup();
    await recent.record('2026-10-14', entries(1, 2));
    await recent.record(PREV, entries(2, 3));
    const seen = await recent.seenOf(['1', '2', '3', '4']);
    expect(seen).toBeInstanceOf(Set);
    expect([...seen].sort()).toEqual(['1', '2', '3']);
    expect(seen.has('4')).toBe(false);
  });

  it('a night older than the two does not count', async () => {
    const { recent } = await setup();
    await recent.record('2026-10-14', entries(1));
    await recent.record(PREV, entries(2));
    await recent.record(WED_BEFORE, entries(5));
    expect([...(await recent.seenOf(['1', '2', '5']))].sort()).toEqual(['1', '2']);
  });

  it('caches the answer for 3 minutes, then asks D1 again', async () => {
    const { t, db, recent } = await setup();
    await recent.record('2026-10-14', entries(1));
    await recent.record(PREV, entries(2));
    let reads = 0;
    const prepare = db.prepare;
    db.prepare = (text) => { if (/FROM seen_nights/.test(text)) reads += 1; return prepare(text); };
    await recent.seenOf(['1']);
    expect(reads).toBe(1);
    t.clock.tick(2 * 60 * 1000);
    await recent.seenOf(['1', '2']);
    expect(reads).toBe(1);
    t.clock.tick(61 * 1000);
    await recent.seenOf(['1']);
    expect(reads).toBe(2);
  });

  it('a new record drops the cache', async () => {
    const { recent } = await setup();
    await recent.record('2026-10-14', entries(1));
    await recent.record(PREV, entries(2));
    expect((await recent.seenOf(['9'])).has('9')).toBe(false);
    await recent.record(PREV, entries(9));
    expect((await recent.seenOf(['9'])).has('9')).toBe(true);
  });

  it('D1 down answers null, never throws', async () => {
    const { db, recent } = await setup();
    await recent.record('2026-10-14', entries(1));
    await recent.record(PREV, entries(2));
    db.down = true;
    const err = console.error;
    console.error = () => {};
    try { expect(await recent.seenOf(['1'])).toBeNull(); } finally { console.error = err; }
  });
});

describe('the roster', () => {
  // Wednesday 6 pm: the last two club nights are 2026-10-07 and 2026-09-30.
  const roster = (t) => t.call('GET', '/v1/desk/roster');

  it('carries awayReady and a per-kid away when both nights are known', async () => {
    // The rig's check-in page lists two children: 662 (not yet in) and 663 (checked in).
    const { t, recent } = await setup({ start: WED_6PM, kids: [kid('1')] });
    await recent.record(PREV, entries(662));
    await recent.record(WED_BEFORE, entries(5));
    const res = await roster(t);
    expect(res.status).toBe(200);
    expect(res.body.awayReady).toBe(true);
    const away = Object.fromEntries(res.body.kids.map((k) => [String(k.clubberId), k.away]));
    expect(away).toEqual({ 662: false, 663: true });
  });

  it('carries neither key when the nights are not known', async () => {
    const { t, recent } = await setup({ start: WED_6PM, kids: [kid('1')] });
    let res = await roster(t);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('awayReady');
    expect(res.body.kids.every((k) => !('away' in k))).toBe(true);
    await recent.record(PREV, entries(662));   // one night only
    t.clock.tick(20 * 1000);
    res = await roster(t);
    expect(res.body).not.toHaveProperty('awayReady');
    expect(res.body.kids.every((k) => !('away' in k))).toBe(true);
  });
});

describe('the watcher', () => {
  it('records the night as it reads reports during the watch window', async () => {
    const { t, db } = await setup({ start: WED_6PM, kids: [kid('662'), kid('663')] });
    expect(rows(db, NIGHT)).toEqual([]);
    await t.core.watcher.tick();
    expect(rows(db, NIGHT)).toHaveLength(2);
    t.night.kids.push(kid('664'));
    t.clock.tick(30 * 1000);
    await t.core.watcher.tick();
    expect(rows(db, NIGHT)).toHaveLength(3);
    expect(db.dump()).not.toMatch(/Tester/);
  });
});

describe('backfill', () => {
  it('reads each past night with no rows once, records it, and does not read again within 5 hours', async () => {
    const { t, db, recent } = await setup({ kids: [kid('1'), kid('2')] });
    quiet(recent);
    const out = await recent.backfill();
    expect(out.filled).toEqual(['2026-10-14', PREV]);
    expect(reportReads(t)).toEqual(['/clubber/checkin_report?date=2026-10-14', `/clubber/checkin_report?date=${PREV}`]);
    expect(rows(db, '2026-10-14')).toHaveLength(2);
    expect(rows(db, PREV)).toHaveLength(2);
    const before = reportReads(t).length;
    await recent.backfill();
    expect(reportReads(t).length).toBe(before);
    expect([...(await recent.seenOf(['1', '3']))]).toEqual(['1']);
  });

  it('runs from the cron', async () => {
    const { t, db } = await setup({ kids: [kid('1')] });
    t.core.recent.log = () => {};
    await t.core.cron();
    expect(reportReads(t)).toEqual(expect.arrayContaining(['/clubber/checkin_report?date=2026-10-14', `/clubber/checkin_report?date=${PREV}`]));
    expect(rows(db, PREV)).toHaveLength(1);
  });

  it('a night with rows is not read', async () => {
    const { t, recent } = await setup({ kids: [kid('1')] });
    quiet(recent);
    await recent.record(PREV, entries(1));
    const out = await recent.backfill();
    expect(out.filled).toEqual(['2026-10-14']);
    expect(reportReads(t)).toEqual(['/clubber/checkin_report?date=2026-10-14']);
  });

  it('after 5 hours a night still empty is read again', async () => {
    const { t, recent } = await setup({ kids: [] });
    quiet(recent);
    await recent.backfill();   // an empty report records nothing, so both nights stay empty
    const first = reportReads(t).length;
    expect(first).toBe(2);
    t.clock.tick(4 * HOUR);
    await recent.backfill();
    expect(reportReads(t).length).toBe(first);
    t.clock.tick(HOUR + 1000);
    await recent.backfill();
    expect(reportReads(t).length).toBe(first + 2);
  });

  it('deletes rows older than 300 days and keeps newer ones', async () => {
    const { db, recent } = await setup();
    quiet(recent);
    await db.prepare('INSERT INTO seen_nights (night, tag) VALUES (?1, ?2)').bind('2025-12-01', 'a'.repeat(20)).run();
    await db.prepare('INSERT INTO seen_nights (night, tag) VALUES (?1, ?2)').bind('2026-08-12', 'b'.repeat(20)).run();
    await recent.backfill();
    const left = db.query('SELECT night FROM seen_nights').map((r) => r.night);
    expect(left).not.toContain('2025-12-01');
    expect(left).toContain('2026-08-12');
  });

  it('a failing report read is logged and does not throw', async () => {
    const { t, recent } = await setup({ kids: [kid('1')] });
    const lines = [];
    recent.log = (m) => lines.push(m);
    t.tt.down = true;
    const out = await recent.backfill();
    expect(out.filled).toEqual([]);
    expect(out.failed.length).toBeGreaterThan(0);
    expect(lines.some((l) => /could not read/.test(l))).toBe(true);
  });

  it('uses the calendar: a cancelled night is not read, the one before it is', async () => {
    const { t, recent } = await setup({ calendar: feed({ cancel: ['2026-10-14'] }), kids: [kid('1')] });
    quiet(recent);
    await recent.backfill();
    expect(reportReads(t)).toEqual([`/clubber/checkin_report?date=${PREV}`, `/clubber/checkin_report?date=${WED_BEFORE}`]);
  });
});

describe('with no HISTORY_DB', () => {
  it('record returns 0, seenOf is null, backfill reads nothing', async () => {
    const { t, recent } = await setup({ db: null, kids: [kid('1')] });
    expect(await recent.record(NIGHT, entries(1))).toBe(0);
    expect(await recent.seenOf(['1'])).toBeNull();
    expect(await recent.backfill()).toEqual({ filled: [], failed: [] });
    expect(reportReads(t)).toEqual([]);
  });

  it('the roster still works, without the keys', async () => {
    const { t } = await setup({ db: null, start: WED_6PM, kids: [kid('1')] });
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.kids.length).toBeGreaterThan(0);
    expect(res.body).not.toHaveProperty('awayReady');
    expect(res.body.kids.every((k) => !('away' in k))).toBe(true);
  });
});

describe('usual arrivals', () => {
  const at = (db, night) => db.query('SELECT at FROM seen_nights WHERE night = ?', night).map((r) => r.at);

  it('a live report on tonight\'s date stamps the minutes it first saw each child; later reports keep the first', async () => {
    const { t, db, recent } = await setup({ start: WED_6PM });
    await recent.record(NIGHT, entries(1, 2));
    expect(at(db, NIGHT)).toEqual([18 * 60, 18 * 60]);
    t.clock.tick(5 * 60 * 1000);
    recent.written = { night: '', tags: new Set() };   // a restarted Worker writes again
    await recent.record(NIGHT, entries(1, 3));
    const rowsAt = db.query('SELECT at FROM seen_nights WHERE night = ? ORDER BY at', NIGHT).map((r) => r.at);
    expect(rowsAt).toEqual([18 * 60, 18 * 60, 18 * 60 + 5]);
  });

  it('a past night (the fill, or another date) has no times', async () => {
    const { db, recent } = await setup();
    await recent.record(PREV, entries(1));
    await recent.record('2026-10-15', entries(2), { timed: false });
    expect(at(db, PREV)).toEqual([null]);
    expect(at(db, '2026-10-15')).toEqual([null]);
  });

  it('usualOf averages this season\'s timed nights before today, by child, and leaves out the untimed', async () => {
    const { db, recent } = await setup();
    const tag = async (id) => recent.hashOf(id);
    const put = async (night, id, minutes) => db.prepare('INSERT INTO seen_nights (night, tag, at) VALUES (?1, ?2, ?3)').bind(night, await tag(id), minutes).run();
    await put('2026-09-30', '1', 18 * 60);
    await put(PREV, '1', 18 * 60 + 10);
    await put(PREV, '2', 18 * 60 + 25);
    await put('2026-07-15', '2', 17 * 60);          // last season: not counted
    await put('2026-10-15', '2', 17 * 60);          // today: not counted
    await put('2026-10-14', '3', null);             // filled, untimed
    const u = await recent.usualOf(['1', '2', '3', '4']);
    expect(Object.fromEntries(u)).toEqual({ 1: 18 * 60 + 5, 2: 18 * 60 + 25 });
  });

  it('the roster carries `usual` for a child with times only', async () => {
    // The rig's check-in page lists 662 and 663.
    const { t, db, recent } = await setup({ start: WED_6PM, kids: [kid('1')] });
    await db.prepare('INSERT INTO seen_nights (night, tag, at) VALUES (?1, ?2, ?3)').bind(PREV, await recent.hashOf('662'), 18 * 60 + 2).run();
    const res = await t.call('GET', '/v1/desk/roster');
    const byId = Object.fromEntries(res.body.kids.map((k) => [String(k.clubberId), k]));
    expect(byId['662'].usual).toBe(18 * 60 + 2);
    expect('usual' in byId['663']).toBe(false);
  });

  it('with no database: null, and no `usual` on the roster', async () => {
    const { recent } = await setup({ db: null });
    expect(await recent.usualOf(['1'])).toBeNull();
  });
});
