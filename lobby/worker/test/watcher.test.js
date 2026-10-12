// The cloud check-in report watcher, phase 1 (read-only shadow).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLUB_NIGHTS,
  GRACE_MIN,
  LEAD_MIN,
  READ_INTERVAL_MS,
  SEAL_PER_TICK,
  WATCH_INTERVAL_MS,
  Watcher,
  compareReport,
  lastClubNight,
  localTime,
  openState,
  sealState,
  watchWindow,
} from '../src/watcher.js';
import { SyncCore } from '../src/sync.js';
import { CHECKIN_PAGE, fakeTwoTimTwo, page, table } from './fixtures.js';

const WED_6PM = Date.parse('2026-10-14T22:00:00Z'); // 6:00 pm EDT, a club night
const ENV = { CLOUD_CHECKIN: 'shadow', TWOTIMTWO_USERNAME: 'checkin@example.org', TWOTIMTWO_PASSWORD: 'right-pass' };

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => { map.set(k, structuredClone(v)); },
    delete: async (k) => map.delete(k),
  };
}

/** A night whose report the test edits: kids is [{id, name, club}]. */
function setup({ env = ENV, start = WED_6PM, kids = [] } = {}) {
  let t = start;
  const night = { kids: [...kids], count: null };
  const render = () => {
    const clubs = [...new Set(night.kids.map((k) => k.club))];
    return page(...clubs.map((club) => {
      const these = night.kids.filter((k) => k.club === club);
      return table(`${club} `, these.map((k) => ({ id: k.id, name: k.name })), { count: night.count ?? these.length });
    }), clubs.length ? '' : table('Sparks ', []));
  };
  const tt = fakeTwoTimTwo({ report: render });
  const storage = memoryStore();
  const alarm = { at: null };
  const lines = [];
  const w = new Watcher({
    storage, env, fetchFn: tt.fetchFn, now: () => t, sleep: async (ms) => { t += ms; },
    alarms: { set: (at) => { alarm.at = at; }, get: () => alarm.at },
    log: (line) => lines.push(line),
  });
  return { w, tt, storage, alarm, lines, night, tick: (ms) => { t += ms; }, now: () => t };
}

const kid = (id, club = 'Sparks', name = `Kid${id} Tester`) => ({ id, name, club });
const reportReads = (s) => s.tt.calls.filter((c) => c.path.startsWith('/clubber/checkin_report')).length;

describe('the watch window', () => {
  it('is the printer\'s club night, an hour either side', () => {
    const config = JSON.parse(readFileSync(new URL('../../../printer/print-server/church-config.json', import.meta.url), 'utf8'));
    expect(CLUB_NIGHTS).toEqual(config.clubNights);
    expect(LEAD_MIN).toBe(60);
    expect(GRACE_MIN).toBe(60);
  });

  it('opens at 4:30 pm and closes at 9:00 pm Eastern on Wednesdays, either side of the clock change', () => {
    expect(watchWindow(Date.parse('2026-10-14T20:29:00Z')).open).toBe(false); // 4:29 pm EDT
    expect(watchWindow(Date.parse('2026-10-14T20:30:00Z')).open).toBe(true);  // 4:30 pm EDT
    expect(watchWindow(Date.parse('2026-10-15T00:59:00Z')).open).toBe(true);  // 8:59 pm EDT
    expect(watchWindow(Date.parse('2026-10-15T01:00:00Z')).open).toBe(false); // 9:00 pm EDT
    expect(watchWindow(Date.parse('2026-11-04T21:30:00Z')).open).toBe(true);  // 4:30 pm EST
    expect(watchWindow(Date.parse('2026-11-04T21:29:00Z')).open).toBe(false);
    expect(watchWindow(Date.parse('2026-10-13T22:00:00Z')).open).toBe(false); // a Tuesday
  });

  it('says how long until it opens', () => {
    expect(watchWindow(Date.parse('2026-10-14T20:00:00Z')).untilMs).toBe(30 * 60 * 1000);
    expect(watchWindow(Date.parse('2026-10-15T01:00:00Z')).untilMs).toBe((7 * 24 * 60 - 270) * 60 * 1000);
  });

  it('dates the report by the church\'s own day, not UTC\'s', () => {
    expect(localTime(Date.parse('2026-10-15T00:30:00Z')).date).toBe('2026-10-14');
  });
});

describe('comparing two reads', () => {
  const report = (ids, declared = ids.length) => ({ entries: ids.map((id) => ({ clubberId: String(id), name: 'x', club: 'Sparks' })), declared });
  const prev = (ids) => Object.fromEntries(ids.map((id) => [String(id), 'Sparks']));

  it('the first read of a night is the baseline', () => {
    expect(compareReport(null, report([1, 2])).verdict).toBe('baseline');
  });

  it('finds check-ins and undos made on TwoTimTwo', () => {
    const r = compareReport(prev([1, 2, 3]), report([1, 2, 4]));
    expect(r).toMatchObject({ verdict: 'applied', added: ['4'], gone: ['3'] });
  });

  it('a partial report changes nothing', () => {
    expect(compareReport(prev([1]), report([1, 2], 5))).toMatchObject({ verdict: 'partial', added: [], gone: [] });
  });

  it('refuses a read that would drop more than half the room', () => {
    expect(compareReport(prev([1, 2, 3, 4]), report([1])).verdict).toBe('mass-undo');
    expect(compareReport(prev([1, 2, 3, 4]), report([1, 2])).verdict).toBe('applied');
  });

  it('one child is one clubber id, whatever the rows', () => {
    const r = compareReport(null, { entries: [{ clubberId: '1', name: 'a', club: 'Sparks' }, { clubberId: '1', name: 'a', club: 'Sparks' }], declared: 2 });
    expect(Object.keys(r.kids)).toEqual(['1']);
  });
});

describe('the sealed state', () => {
  it('opens only with the same password, and holds no plaintext', async () => {
    const sealed = await sealState('right-pass', { date: '2026-10-14', kids: { 662: 'Sparks' } });
    expect(JSON.stringify(sealed)).not.toMatch(/662|Sparks/);
    expect(await openState('right-pass', sealed)).toEqual({ date: '2026-10-14', kids: { 662: 'Sparks' } });
    expect(await openState('other-pass', sealed)).toBeNull();
    expect(await openState('right-pass', { v: 1, iv: 'AAAA', ct: 'AAAA' })).toBeNull();
  });
});

describe('the watcher', () => {
  it('stays idle, touching nothing, while it is off or has no TwoTimTwo user', async () => {
    for (const env of [{ ...ENV, CLOUD_CHECKIN: 'off' }, { CLOUD_CHECKIN: 'shadow' }, { ...ENV, CLOUD_CHECKIN: undefined }]) {
      const s = setup({ env });
      expect(await s.w.tick()).toEqual({ next: null });
      expect(await s.w.arm()).toBe(false);
      expect(s.tt.calls).toHaveLength(0);
      expect(s.alarm.at).toBeNull();
    }
  });

  it('outside the window it sleeps until the window, at most six hours at a time', async () => {
    const s = setup({ start: Date.parse('2026-10-13T22:00:00Z') });
    await s.w.tick();
    expect(s.tt.calls).toHaveLength(0);
    expect(s.alarm.at - s.now()).toBe(6 * 60 * 60 * 1000);
    const near = setup({ start: Date.parse('2026-10-14T20:20:00Z') });
    await near.w.tick();
    expect(near.alarm.at - near.now()).toBe(10 * 60 * 1000);
  });

  it('reads the report about every 15 s, and every read of every kind shares one 5 s clock', async () => {
    expect(READ_INTERVAL_MS).toBe(5000);
    expect(WATCH_INTERVAL_MS).toBe(15000);
    expect(SEAL_PER_TICK).toBe(1);
    const s = setup({ kids: [kid(1)] });
    await s.w.tick();
    expect(reportReads(s)).toBe(1);
    expect(s.alarm.at - s.now()).toBe(WATCH_INTERVAL_MS);
    s.tick(2000);
    // read-now is a read like any other: 3 s of the 5 s clock are left
    expect((await s.w.readNow()).throttled).toBe(true);
    await s.w.tick();
    expect(reportReads(s)).toBe(1);
    expect(s.alarm.at - s.now()).toBe(WATCH_INTERVAL_MS - 2000);
    s.tick(WATCH_INTERVAL_MS - 2000);
    await s.w.tick();
    expect(reportReads(s)).toBe(2);
  });

  it('any other read on the session (a phone\'s roster) takes its slot: the watcher waits its turn, never doubles up', async () => {
    const s = setup({ kids: [kid(1)] });
    await s.w.tick();
    s.tick(WATCH_INTERVAL_MS);
    const client = /** @type {any} */ (s.w.clientFor());
    await client.checkinPage({ waitMs: 12000, kind: 'phone-roster' });   // takes the slot now
    await s.w.tick();                                                    // the report is due, the clock is not
    expect(reportReads(s)).toBe(1);
    expect(s.alarm.at - s.now()).toBe(READ_INTERVAL_MS);
    s.tick(READ_INTERVAL_MS);
    await s.w.tick();
    expect(reportReads(s)).toBe(2);
  });

  it('two reads at once share one request', async () => {
    const s = setup({ kids: [kid(1)] });
    await Promise.all([s.w.read(), s.w.read(), s.w.readNow()]);
    expect(reportReads(s)).toBe(1);
  });

  it('a club night in shadow: baseline, check-ins and undos on TwoTimTwo, the tally it would publish', async () => {
    const s = setup({ kids: [kid(1), kid(2, 'Cubbies')] });
    await s.w.tick();
    s.tick(READ_INTERVAL_MS);
    await s.w.tick();   // no report due, the clock is free: the check-in page, once a night
    let st = await s.w.status();
    expect(st).toMatchObject({ mode: 'shadow', configured: true, windowOpen: true, checkedIn: 2, verdict: 'baseline' });
    expect(st.byClub).toEqual({ Sparks: 1, Cubbies: 1 });
    expect(st.checkinPage).toMatchObject({ ok: true, calendarId: '368', events: 2, attendanceItem: true, roster: 2 });

    s.night.kids.push(kid(3), kid(4, 'T&amp;T'));
    s.tick(WATCH_INTERVAL_MS);
    await s.w.tick();
    s.night.kids = s.night.kids.filter((k) => k.id !== 2);
    s.tick(WATCH_INTERVAL_MS);
    await s.w.tick();
    st = await s.w.status();
    expect(st.checkedIn).toBe(3);
    expect(st.byClub).toEqual({ Sparks: 2, 'T&T': 1 });
    expect(st.tonight).toMatchObject({ baseline: 2, addedOnTwoTimTwo: 2, undoneOnTwoTimTwo: 1 });
    expect(st.log.map((l) => l.kind)).toEqual(expect.arrayContaining(['new-night', 'sign-in', 'baseline', 'checked-in-on-twotimtwo', 'undone-on-twotimtwo']));
    const tallies = s.lines.filter((l) => l.includes('would publish tally'));
    expect(JSON.parse(tallies.at(-1).split('tally ')[1])).toMatchObject({ counts: { Sparks: 2, 'T&T': 1 }, total: 3 });
    // The check-in page is read once a night, not every 5 s.
    expect(s.tt.calls.filter((c) => c.path === '/clubber/checkin')).toHaveLength(1);
  });

  it('phase 1 publishes nothing and never posts to TwoTimTwo but its sign-in', async () => {
    const s = setup({ kids: [kid(1)] });
    for (let i = 0; i < 4; i++) { await s.w.tick(); s.tick(WATCH_INTERVAL_MS); }
    expect(s.tt.calls.filter((c) => c.method === 'POST').every((c) => c.path === '/site/login')).toBe(true);
    const core = new SyncCore({ storage: memoryStore(), env: ENV, fetchFn: s.tt.fetchFn, now: s.now, sleep: async (ms) => { s.tick(ms); },
      publish: async () => { throw new Error('published'); }, broadcast: () => { throw new Error('broadcast'); } });
    await core.alarm();
  });

  it('a partial report and a mass drop change nothing', async () => {
    const s = setup({ kids: [kid(1), kid(2), kid(3), kid(4)] });
    await s.w.tick();
    s.night.count = 9;
    s.tick(WATCH_INTERVAL_MS);
    await s.w.tick();
    expect(await s.w.status()).toMatchObject({ verdict: 'partial', checkedIn: 4 });
    s.night.count = null;
    s.night.kids = [kid(1)];
    s.tick(WATCH_INTERVAL_MS);
    await s.w.tick();
    const st = await s.w.status();
    expect(st).toMatchObject({ verdict: 'mass-undo', checkedIn: 4 });
    expect(st.tonight).toMatchObject({ partial: 1, massUndoRefused: 1, undoneOnTwoTimTwo: 0 });
  });

  it('a new night starts from a fresh baseline', async () => {
    const s = setup({ kids: [kid(1), kid(2)] });
    await s.w.tick();
    s.tick(7 * 24 * 60 * 60 * 1000);
    s.night.kids = [kid(5)];
    await s.w.tick();
    const st = await s.w.status();
    expect(st).toMatchObject({ date: '2026-10-21', verdict: 'baseline', checkedIn: 1 });
    expect(st.tonight.undoneOnTwoTimTwo).toBe(0);
  });

  it('keeps no name and no clubber id anywhere a person or a log can read', async () => {
    const s = setup({ kids: [kid(662, 'Sparks', 'Zed Uniquename'), kid(663, 'Cubbies', 'Yan Uniquename')] });
    await s.w.tick();
    s.night.kids.push(kid(664, 'Sparks', 'Xia Uniquename'));
    s.tick(WATCH_INTERVAL_MS);
    await s.w.tick();
    const everything = JSON.stringify([...s.storage.map.values()]) + JSON.stringify(await s.w.status()) + s.lines.join('\n');
    expect(everything).not.toMatch(/Uniquename|66[234]|right-pass|PHPSESSID|checkin@example\.org/);
  });

  it('a wrong password is reported and waits out its back-off', async () => {
    const s = setup({ env: { ...ENV, TWOTIMTWO_PASSWORD: 'wrong-pass' } });
    await s.w.tick();
    const st = await s.w.status();
    expect(st.lastError).toBe('login-refused');
    expect(st.loginBlockedForSec).toBe(300);
    expect(s.alarm.at - s.now()).toBe(5 * 60 * 1000);
  });

  it('arms its alarm once it has a user, and the cron does too', async () => {
    const s = setup();
    expect(await s.w.arm()).toBe(true);
    expect(s.alarm.at).toBe(s.now() + 1000);
    const alarm = { at: null };
    const core = new SyncCore({ storage: memoryStore(), env: { ...ENV, INITIAL_PASSPHRASE: 'kennebec' }, now: () => WED_6PM,
      fetchFn: async () => new Response('', { status: 500 }), alarms: { set: (at) => { alarm.at = at; }, get: () => alarm.at } });
    await core.cron();
    expect(alarm.at).toBe(WED_6PM + 1000);
  });
});

describe('the status routes', () => {
  it('need a signed-in screen, and show counts only', async () => {
    const s = setup({ kids: [kid(1)] });
    const core = new SyncCore({ storage: memoryStore(), env: { ...ENV, INITIAL_PASSPHRASE: 'kennebec' }, fetchFn: s.tt.fetchFn, now: s.now, sleep: async (ms) => { s.tick(ms); } });
    const call = (method, path, token) => core.handle(new Request(`https://sync.test${path}`, {
      method, headers: token ? { Authorization: `Bearer ${token}` } : {},
    }));
    expect((await call('GET', '/v1/cloud/status')).status).toBe(401);
    expect((await call('POST', '/v1/cloud/read-now')).status).toBe(401);
    const login = await core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify({ passphrase: 'kennebec' }) }));
    const { session } = await login.json();
    const read = await (await call('POST', '/v1/cloud/read-now', session)).json();
    expect(read).toMatchObject({ ok: true, verdict: 'baseline', status: { checkedIn: 1, host: 'kvbchurch.twotimtwo.com' } });
    const status = await (await call('GET', '/v1/cloud/status', session)).json();
    expect(status.checkedIn).toBe(1);
    expect(JSON.stringify(status)).not.toMatch(/Tester|checkin@example|right-pass/);
  });
});

describe('the Settings test read', () => {
  const SUNDAY = Date.parse('2026-10-11T18:45:00Z');
  /** The time a read waited for its slot on the one clock (a sign-in takes slots too). */
  const slept = { ms: 0 };

  it('reads the most recent club night: today on a Wednesday, else the last one', () => {
    expect(lastClubNight(SUNDAY)).toBe('2026-10-07');
    expect(lastClubNight(WED_6PM)).toBe('2026-10-14');
    expect(lastClubNight(Date.parse('2026-10-15T03:30:00Z'))).toBe('2026-10-14'); // 11:30 pm Wednesday EDT
    expect(lastClubNight(Date.parse('2026-11-03T15:00:00Z'))).toBe('2026-10-28'); // across the clock change
  });

  it('on a Sunday it reads last Wednesday\'s report and gives its counts', async () => {
    const s = setup({ start: SUNDAY, kids: [kid(1), kid(2, 'Cubbies'), kid(3)] });
    const r = await s.w.testRead();
    expect(r.ok).toBe(true);
    expect(r.test).toMatchObject({ ok: true, date: '2026-10-07', checkedIn: 3, byClub: { Sparks: 2, Cubbies: 1 }, partial: false });
    expect(r.test.checkinPage).toMatchObject({ ok: true, calendarId: '368' });
    expect(s.tt.calls.find((c) => c.path.startsWith('/clubber/checkin_report')).path).toBe('/clubber/checkin_report?date=2026-10-07');
    // The watcher's own night is untouched: no snapshot, no count.
    expect(s.storage.map.has('cloud:snap')).toBe(false);
    expect((await s.w.status()).checkedIn).toBeNull();
  });

  it('shares the 5 second clock with the watcher', async () => {
    const s = setup({ start: SUNDAY, kids: [kid(1)] });
    await s.w.testRead();
    s.tick(3000);
    const again = await s.w.testRead();
    expect(again).toMatchObject({ ok: true, throttled: true, test: { date: '2026-10-07', checkedIn: 1 } });
    expect(reportReads(s)).toBe(1);
  });

  it('an unreadable page is described by its shape, never its text', async () => {
    const tt = fakeTwoTimTwo({ report: () => '<html><head><title>KVBC - Checkin Report</title></head><body><table><tr><td>Zed Uniquename</td></tr></table></body></html>' });
    const alarm = { at: null };
    const w = new Watcher({ storage: memoryStore(), env: ENV, fetchFn: tt.fetchFn, now: () => SUNDAY + slept.ms, sleep: async (ms) => { slept.ms += ms; }, alarms: { set: (a) => { alarm.at = a; }, get: () => alarm.at }, log: () => {} });
    const r = await w.testRead();
    expect(r.test).toMatchObject({ ok: false, error: 'report-unreadable', shape: { title: 'KVBC - Checkin Report', tables: 1, clubTables: 0, loginForm: false } });
    expect(JSON.stringify(r)).not.toContain('Uniquename');
  });
});

describe('checking one child in (owner-only)', () => {
  const SUNDAY = Date.parse('2026-10-11T18:45:00Z');
  /** The time a read waited for its slot on the one clock (a sign-in takes slots too). */
  const slept = { ms: 0 };
  const make = (opts) => setup({ start: SUNDAY, ...opts });

  it('previews first: who, their club and the meeting, and posts nothing', async () => {
    const s = make();
    const r = await s.w.checkIn({ name: '  kit   TESTER ' });
    expect(r).toEqual({ ok: true, preview: true, child: { name: 'Kit Tester', club: 'Sparks', clubberId: '662' },
      meeting: { calendarId: '368', date: '2026-10-14' }, events: 1 });
    expect(s.tt.checkins).toHaveLength(0);
  });

  it('with confirm, posts TwoTimTwo\'s own form: the child, the meeting, the automatic items for the club', async () => {
    const s = make();
    const r = await s.w.checkIn({ clubberId: '662', confirm: true });
    expect(r).toMatchObject({ ok: true, checkedIn: true, child: { name: 'Kit Tester' } });
    expect(s.tt.checkins).toHaveLength(1);
    const form = s.tt.checkins[0];
    expect(form.get('clubber_id')).toBe('662');
    expect(form.get('calendar_id')).toBe('368');
    expect(form.getAll('events[]')).toEqual(['40']);
    const stored = JSON.stringify([...s.storage.map.values()]);
    expect(stored).toContain('cloud-check-in');
    expect(stored).not.toMatch(/Kit|Tester|662/);
  });

  it('a reply that does not name the child is a refusal', async () => {
    const s = make();
    s.tt.checkinReply = '<html><body>Something went wrong</body></html>';
    expect(await s.w.checkIn({ clubberId: '662', confirm: true })).toMatchObject({ ok: false, error: 'checkin-refused' });
  });

  it('never guesses: not found, two of the same name, or already in', async () => {
    const s = make();
    expect(await s.w.checkIn({ name: 'Nobody Here', confirm: true })).toEqual({ ok: false, error: 'not-found' });
    expect(await s.w.checkIn({ name: 'Lu Tester', confirm: true })).toMatchObject({ ok: false, error: 'already-checked-in' });
    expect(await s.w.checkIn({})).toEqual({ ok: false, error: 'no-child' });
    const twins = setup({ start: SUNDAY });
    twins.tt.fetchFn = fakeTwoTimTwo({ checkin: () => CHECKIN_PAGE.replace('recid="663"', 'recid="664"').replace('Lu Tester', 'Kit Tester') }).fetchFn;
    const w2 = new Watcher({ storage: memoryStore(), env: ENV, fetchFn: twins.tt.fetchFn, now: () => SUNDAY + slept.ms, sleep: async (ms) => { slept.ms += ms; }, log: () => {} });
    expect(await w2.checkIn({ name: 'Kit Tester', confirm: true })).toEqual({ ok: false, error: 'ambiguous', matches: 2 });
    expect(s.tt.checkins).toHaveLength(0);
  });

  it('off or without a TwoTimTwo user it does nothing', async () => {
    for (const env of [{ ...ENV, CLOUD_CHECKIN: 'off' }, { CLOUD_CHECKIN: 'shadow' }]) {
      const s = make({ env });
      expect((await s.w.checkIn({ clubberId: '662', confirm: true })).ok).toBe(false);
      expect(s.tt.calls).toHaveLength(0);
    }
  });
});
