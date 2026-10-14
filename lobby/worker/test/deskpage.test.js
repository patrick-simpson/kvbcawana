// The desk's check-in page kept across a restart (desk.js `desk:page`, owner
// 2026-10-12: /checkin sat on "Reading the roster..." after a Worker deploy):
// written sealed after a read, read back once by a new object, answered at
// once as `restored`, refreshed by the watcher's alarm, purged with the night.
import { describe, expect, it } from 'vitest';
import {
  CHECKIN_PAGE_TTL_MS, DESK_PAGE_KEY, DESK_PAGE_MAX_AGE_MS, DESK_PAGE_MAX_BYTES, DESK_PAGE_PERSIST_MS, compactPage,
} from '../src/desk.js';
import { parseCheckinPage } from '../src/twotimtwo.js';
import { sealState } from '../src/watcher.js';
import { plainWords } from './helpers.js';
import { NIGHT, WED_6PM, rig, row } from './rig.js';

/**
 * A check-in page in TwoTimTwo's layout (fixtures.js CHECKIN_PAGE's) listing `kids`:
 * [{id, name, clubId, club, checkedIn}].
 */
function checkinHtml(kids) {
  const rows = kids.map((k) => `<div class="clubber checkin-box boy${k.checkedIn ? ' checked-in' : ''}" recid="${k.id}" club_id="${k.clubId || 2}">` +
    `<div class="name">${k.name}</div><div class="club"><img class="club-icon-16" alt="${k.club || 'Sparks'} "></div></div>`).join('');
  return `<html><body><div class="clubbers">${rows}</div>` +
    '<form id="checkinForm" style="display:none"><input id="checkinClubberId" name="clubber_id" value="">' +
    '<input name="calendar_id" id="calendar_id" value="368">' +
    '<select name="date"><option value="2026-10-07">Oct 7</option><option value="2026-10-14" selected>Oct 14</option></select>' +
    '<input class="event" name="events[]" value="707" recid="707" clubs="2,3,6"><label> Bible</label>' +
    '<input class="event" name="events[]" value="40" automatic="1" clubs="4,1,2,3,6"><label>Attendance</label>' +
    '</form></body></html>';
}

/** Tonight's children: names no random ciphertext could spell as whole words. */
const KIDS = [
  { id: '662', name: 'Zebulon Quixotewright', clubId: '2', club: 'Sparks' },
  { id: '98765', name: 'Philippa Marchbanksley', clubId: '3', club: 'T&T' },
];

/** A rig whose TwoTimTwo check-in page lists `page.kids` (editable), and every put to `desk:page` counted. */
async function deskRig(opts = {}) {
  const page = { kids: (opts.kids || KIDS).map((k) => ({ ...k })) };
  const t = await rig({ checkinPage: () => checkinHtml(page.kids), ...opts });
  t.tt.checkinName = KIDS[0].name;
  const puts = [];
  const realPut = t.storage.put;
  t.storage.put = async (k, v) => { if (k === DESK_PAGE_KEY) puts.push(t.clock.t); return realPut(k, v); };
  const pageReads = () => t.reads.filter((r) => r.path === '/clubber/checkin').length;
  return Object.assign(t, { page, puts, pageReads });
}

const secret = 'right-pass';   // rig.js ENV.TWOTIMTWO_PASSWORD: the state key's secret

describe('the held check-in page is written sealed after a read', () => {
  it('after the roster\'s read; at most once a minute while nothing moves; at once when a child is checked in', async () => {
    const t = await deskRig();
    const first = await t.call('GET', '/v1/desk/roster');
    expect(first.status).toBe(200);
    expect(t.puts).toHaveLength(1);
    expect(t.storage.map.get(DESK_PAGE_KEY)).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) });
    // a re-read 31 s later finds nothing moved: no write (one a minute at most)
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    await t.call('GET', '/v1/desk/roster');
    expect(t.pageReads()).toBe(2);
    expect(t.puts).toHaveLength(1);
    // ...but a child checked in on TwoTimTwo is written at once
    t.page.kids[1].checkedIn = true;
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    await t.call('GET', '/v1/desk/roster');
    expect(t.puts).toHaveLength(2);
    // nothing moves again: the next write waits out the minute, then refreshes the copy
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    await t.call('GET', '/v1/desk/roster');
    expect(t.puts).toHaveLength(2);
    t.clock.tick(DESK_PAGE_PERSIST_MS);
    await t.call('GET', '/v1/desk/roster');
    expect(t.puts).toHaveLength(3);
    expect(t.pageReads()).toBe(5);
  });

  it('the watcher\'s warm read is written too, and nothing outside the watch window', async () => {
    const t = await deskRig();
    for (let i = 0; i < 6 && !t.core.desk.hasNightPage(); i++) { await t.core.alarm(); t.clock.t = t.alarm.at; }
    expect(t.core.desk.hasNightPage()).toBe(true);
    expect(t.puts).toHaveLength(1);
    // a Monday evening (no club, the window shut): the roster reads nothing at all (noclub.test.js)...
    const monday = await deskRig({ start: Date.parse('2026-10-13T00:36:00Z') });   // Mon 2026-10-12 8:36 pm Eastern
    expect((await monday.call('GET', '/v1/desk/roster')).body.noClub).toBe(true);
    expect(monday.pageReads()).toBe(0);
    // ...and a rehearsal's read, outside the window, is held in memory only
    const st = await monday.station();
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    const res = await monday.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.noClub).toBeUndefined();
    expect(monday.pageReads()).toBe(1);
    expect(monday.puts).toHaveLength(0);
    expect(monday.storage.map.has(DESK_PAGE_KEY)).toBe(false);
  });

  it('holds no plaintext name, last name or clubber id: one sealed blob', async () => {
    const t = await deskRig();
    await t.call('GET', '/v1/desk/roster');
    const raw = JSON.stringify(t.storage.map.get(DESK_PAGE_KEY));
    expect(Object.keys(t.storage.map.get(DESK_PAGE_KEY)).sort()).toEqual(['ct', 'iv', 'v']);
    expect(raw).not.toMatch(plainWords(['Zebulon', 'Quixotewright', 'Philippa', 'Marchbanksley', 'Sparks', 'calendarId', 'roster']));
    expect(raw).not.toContain('"662"');
    expect(raw).not.toContain('"98765"');
    expect(raw).not.toContain('"368"');
  });
});

describe('the size guard', () => {
  it('300 children are kept, well under the 128 KiB a value may hold', async () => {
    const many = Array.from({ length: 300 }, (_, i) => ({
      id: String(100000 + i), name: `Bartholomew-Alexander${i} Montgomery-Fitzwilliamson`, clubId: String([1, 2, 3, 4, 6][i % 5]), club: ['Cubbies', 'Sparks', 'T&T', 'Puggles', 'Trek'][i % 5],
      checkedIn: i % 3 === 0,
    }));
    const t = await deskRig({ kids: many });
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.body.kids).toHaveLength(300);
    expect(t.puts).toHaveLength(1);
    const size = JSON.stringify(t.storage.map.get(DESK_PAGE_KEY)).length;
    expect(size).toBeLessThan(DESK_PAGE_MAX_BYTES);
    expect(size).toBeLessThan(128 * 1024);
    // ...and read back whole after a restart
    t.restart();
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    const back = await t.call('GET', '/v1/desk/roster');
    expect(back.body.restored).toBe(true);
    expect(back.body.kids).toEqual(res.body.kids);
  });

  it('keeps exactly what the desk reads; a page too big to keep is not written at all (never a cut-down list)', async () => {
    const parsed = parseCheckinPage(checkinHtml(KIDS));
    expect(compactPage({ ...parsed, extra: 'x', roster: parsed.roster.map((k) => ({ ...k, allergy: 'peanuts' })) })).toEqual({
      calendarId: '368',
      events: [{ id: '707', clubs: ['2', '3', '6'], automatic: false, label: 'Bible' }, { id: '40', clubs: ['4', '1', '2', '3', '6'], automatic: true, label: 'Attendance' }],
      roster: [
        { clubberId: '662', clubId: '2', name: 'Zebulon Quixotewright', club: 'Sparks', checkedIn: false },
        { clubberId: '98765', clubId: '3', name: 'Philippa Marchbanksley', club: 'T&T', checkedIn: false },
      ],
    });
    const huge = Array.from({ length: 1100 }, (_, i) => ({ id: String(200000 + i), name: `${'Maximiliana'.repeat(3)}${i} ${'Wolfeschlegelstein'.repeat(2)}`, club: 'Sparks' }));
    const t = await deskRig({ kids: huge });
    await t.storage.put(DESK_PAGE_KEY, { v: 1, iv: 'old', ct: 'old' });   // an earlier (smaller) copy
    t.puts.length = 0;
    const lines = [];
    t.core.desk.log = (l) => lines.push(l);
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.kids).toHaveLength(1100);
    expect(t.puts).toHaveLength(0);
    expect(t.storage.map.has(DESK_PAGE_KEY)).toBe(false);
    expect(lines.join('\n')).toMatch(/too big/);
  });
});

describe('a restart reads the held page back', () => {
  it('a restore that could not run yet (cloud check-in off, no secret) is tried again later, at most once a minute', async () => {
    for (const block of ['off', 'no-secret']) {
      const t = await deskRig();
      await t.call('GET', '/v1/desk/roster');
      expect(t.storage.map.has(DESK_PAGE_KEY)).toBe(true);
      t.restart();
      const env = t.core.rawEnv;
      const saved = { ...env };
      if (block === 'off') env.CLOUD_CHECKIN = 'off';
      else delete env.TWOTIMTWO_PASSWORD;
      const looks = [];
      const realGet = t.storage.get;
      t.storage.get = async (k) => { if (k === DESK_PAGE_KEY) looks.push(t.clock.t); return realGet(k); };
      await t.core.desk.restore();
      expect(t.core.desk.cache).toBeNull();
      // turned back on mid-evening: within the minute it is not looked at again (cheap)...
      Object.assign(env, saved);
      t.clock.tick(30 * 1000);
      await t.core.desk.restore();
      expect(t.core.desk.cache).toBeNull();
      // ...after it, the stored page is read back and the roster answers from it at once
      t.clock.tick(31 * 1000);
      const reads = t.pageReads();
      const res = await t.call('GET', '/v1/desk/roster');
      expect(res.status).toBe(200);
      expect(res.body.restored).toBe(true);
      expect(t.pageReads()).toBe(reads);
      expect(looks).toHaveLength(1);
      // a restore that ran to its end is never repeated
      t.clock.tick(5 * 60 * 1000);
      await t.core.desk.restore();
      expect(looks).toHaveLength(1);
    }
  });

  it('the roster answers at once from it, `restored` (never `stale`), with no TwoTimTwo read at all', async () => {
    const t = await deskRig();
    const before = await t.call('GET', '/v1/desk/roster');
    t.restart();
    t.clock.tick(5 * 60 * 1000);   // well past the 30 s a page is fresh for
    const calls = t.tt.calls.length;
    const start = t.clock.t;
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.restored).toBe(true);
    expect(res.body.stale).toBeUndefined();
    expect(res.body.kids).toEqual(before.body.kids);
    expect(res.body.readAt).toBe(before.body.readAt);
    expect(res.body.items).toEqual(before.body.items);
    expect(t.tt.calls.length).toBe(calls);   // nothing asked of TwoTimTwo, not even a sign-in
    expect(t.clock.t).toBe(start);           // and no wait
    expect(t.core.desk.hasNightPage()).toBe(true);
    expect((await t.core.watcher.status()).deskPage).toMatchObject({ held: true, restored: true });
  });

  it('asking marks the roster wanted: the alarm\'s next free slot reads a fresh page, which replaces the restored one', async () => {
    const t = await deskRig();
    // the night under way: the watcher read the report and warmed the page
    for (let i = 0; i < 6 && !t.core.desk.hasNightPage(); i++) { await t.core.alarm(); t.clock.t = t.alarm.at; }
    t.restart();
    t.clock.tick(60 * 1000);
    await t.call('GET', '/v1/desk/roster');
    expect(t.core.desk.cache.restored).toBe(true);
    expect(t.core.desk.rosterRefreshInMs()).toBe(0);
    expect(t.core.watcher.otherWakeInMs(await t.core.watcher.loadStatus())).toBe(0);
    t.page.kids[0].checkedIn = true;   // TwoTimTwo moved on meanwhile
    // the alarm's ticks, with the page polling between them (every 15 s, so the roster stays wanted)
    const restoredAnswers = [];
    for (let i = 0; i < 10 && t.core.desk.cache.restored; i++) {
      await t.core.alarm();
      t.clock.t = Math.max(t.clock.t, t.alarm.at);
      if (t.core.desk.cache.restored) restoredAnswers.push((await t.call('GET', '/v1/desk/roster')).body.restored);
    }
    expect(restoredAnswers.every((r) => r === true)).toBe(true);   // never a wait meanwhile
    expect(t.core.desk.cache.restored).toBeUndefined();
    expect(t.core.watcher.budget.stats().taken['roster-ahead']).toBe(1);
    const fresh = await t.call('GET', '/v1/desk/roster');
    expect(fresh.body.restored).toBeUndefined();
    expect(fresh.body.stale).toBeUndefined();
    expect(fresh.body.kids[0]).toMatchObject({ clubberId: '662', checkedIn: true });
  });

  it('a desk check-in, undo and check-out after a restart read no page (the post signs in, nothing more)', async () => {
    const t = await deskRig();
    await t.call('GET', '/v1/desk/roster');
    const st = await t.station();
    t.restart();
    t.clock.tick(10 * 60 * 1000);
    const reads = t.pageReads();
    // the first call after the restart is the check-in itself (no roster first)
    const done = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(done.body).toMatchObject({ ok: true, already: false });
    expect(t.tt.checkins).toHaveLength(1);
    expect(t.tt.checkins[0].get('calendar_id')).toBe('368');
    expect((await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).body).toMatchObject({ ok: true });
    expect((await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '98765', historyRow: row('checkout') })).body).toMatchObject({ ok: true });
    expect(t.pageReads()).toBe(reads);
  });

  it('a child this desk checked in stays checked in on the roster even when a later read of TwoTimTwo\'s page does not mark them (BARF who-list, owner 2026-10-14)', async () => {
    const t = await deskRig();
    await t.call('GET', '/v1/desk/roster');
    const st = await t.station();
    const done = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(done.body).toMatchObject({ ok: true });
    // a read of the page that began before the check-in landed: nobody marked
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    const again = (await t.call('GET', '/v1/desk/roster')).body;
    expect(again.kids.find((k) => k.clubberId === '662').checkedIn).toBe(true);
    expect(again.kids.find((k) => k.clubberId === '98765').checkedIn).toBe(false);
    // an undo takes the memory back too
    expect((await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).body).toMatchObject({ ok: true });
    t.clock.tick(CHECKIN_PAGE_TTL_MS + 1000);
    expect((await t.call('GET', '/v1/desk/roster')).body.kids.find((k) => k.clubberId === '662').checkedIn).toBe(false);
  });

  it('after a failed read the restored copy is `stale`, as any held page', async () => {
    const t = await deskRig();
    await t.call('GET', '/v1/desk/roster');
    t.restart();
    t.clock.tick(60 * 1000);
    expect((await t.call('GET', '/v1/desk/roster')).body.restored).toBe(true);
    t.tt.down = true;
    expect(await t.core.desk.refreshRoster()).toBe(true);   // the alarm's read ahead fails
    const res = await t.call('GET', '/v1/desk/roster');
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.body.restored).toBeUndefined();
  });
});

describe('a stored page that is not tonight\'s is never trusted', () => {
  /** Plant a blob, restart, ask: what the roster answered and what storage holds after. */
  async function plant(value) {
    const t = await deskRig();
    t.restart();
    await t.storage.put(DESK_PAGE_KEY, typeof value === 'function' ? await value(t) : value);
    const res = await t.call('GET', '/v1/desk/roster');
    return { t, res };
  }
  const goodPage = () => compactPage(parseCheckinPage(checkinHtml(KIDS)));

  it('another night\'s is deleted and the roster reads as before', async () => {
    const { t, res } = await plant(() => sealState(secret, { at: WED_6PM - 60 * 1000, night: '2026-10-07', page: goodPage() }));
    expect(res.status).toBe(200);
    expect(res.body.restored).toBeUndefined();
    expect(t.pageReads()).toBe(1);
    // the read wrote tonight's in its place
    expect(t.puts.length).toBeGreaterThanOrEqual(1);
    expect(t.core.desk.cache.restored).toBeUndefined();
  });

  it('one older than 6 hours is deleted', async () => {
    const { t, res } = await plant(() => sealState(secret, { at: WED_6PM - DESK_PAGE_MAX_AGE_MS - 60 * 1000, night: NIGHT, page: goodPage() }));
    expect(res.body.restored).toBeUndefined();
    expect(t.pageReads()).toBe(1);
  });

  it('one that will not open (another secret, damaged) is deleted, never an error', async () => {
    for (const value of [
      () => sealState('another-password', { at: WED_6PM, night: NIGHT, page: goodPage() }),
      { v: 1, iv: 'AAAAAAAAAAAAAAAA', ct: 'not-a-ciphertext' },
      'junk',
    ]) {
      const { t, res } = await plant(value);
      expect(res.status).toBe(200);
      expect(res.body.restored).toBeUndefined();
      expect(t.pageReads()).toBe(1);
    }
    // deleted, not left behind: with the read refused (clock booked solid) nothing comes back
    const t = await deskRig();
    t.restart();
    await t.storage.put(DESK_PAGE_KEY, await sealState('another-password', { at: WED_6PM, night: NIGHT, page: goodPage() }));
    for (let i = 0; i < 4; i++) t.core.watcher.budget.claim(60000);
    expect((await t.call('GET', '/v1/desk/roster')).status).toBe(429);
    expect(t.storage.map.has(DESK_PAGE_KEY)).toBe(false);
  });
});

describe('the end of the night', () => {
  it('the alarm after the watch window closes deletes it (and the cron\'s arm does, even with the watcher off)', async () => {
    const t = await deskRig();
    await t.call('GET', '/v1/desk/roster');
    expect(t.storage.map.has(DESK_PAGE_KEY)).toBe(true);
    t.clock.t = Date.parse('2026-10-15T01:01:00Z');   // 9:01 pm Eastern: the window has closed
    await t.core.alarm();
    expect(t.storage.map.has(DESK_PAGE_KEY)).toBe(false);
    // the cron's arm(), with cloud check-in switched off (no alarm runs then)
    const off = await deskRig();
    await off.call('GET', '/v1/desk/roster');
    off.core.watcher.env.CLOUD_CHECKIN = 'off';
    off.clock.t = Date.parse('2026-10-15T04:00:00Z');
    expect(await off.core.watcher.arm()).toBe(false);
    expect(off.storage.map.has(DESK_PAGE_KEY)).toBe(false);
  });
});
