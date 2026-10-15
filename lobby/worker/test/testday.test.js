// TEST DAYS (owner 2026-10-15): a day with no club lets the desk check people in
// and undo them for real (TwoTimTwo, the label, the claim), fires no hooks, keeps
// each test check-in sealed in `desk:testday`, and the cron undoes the ones from
// an earlier night (desk.js sweepTestDay). Check-out stays refused no-club.
import { describe, expect, it } from 'vitest';
import { sealJob } from './helpers.js';
import { kid, rig, row } from './rig.js';

const MON_836PM = Date.parse('2026-10-13T00:36:00Z');   // Monday 2026-10-12, 8:36 pm EDT
const MON = '2026-10-12';
const DAY = 24 * 3600 * 1000;
const KEY = 'desk:testday';

async function monday() {
  const t = await rig({ kids: [kid('662')], start: MON_836PM });
  t.checkinPosts = 0;
  t.on.checkin = async () => { t.checkinPosts += 1; return 'ok'; };
  t.heard = [];
  t.core.desk.hooks.afterCheckin.push((e) => { t.heard.push(['in', e]); });
  t.core.desk.hooks.afterUndo.push((e) => { t.heard.push(['undo', e]); });
  return t;
}
async function checkIn(t, st) {
  const { bundle } = await sealJob([st], { name: 'sealed' }, { night: MON });
  return t.call('POST', '/v1/desk/checkin', { night: MON, clubberId: '662', items: { Bible: true }, historyRow: row('checkin', MON), job: bundle });
}
const undo = (t) => t.call('POST', '/v1/desk/undo', { night: MON, clubberId: '662', historyRow: row('undo', MON) });
/** Put entries straight into the sealed list. */
const seed = (t, entries) => t.core.desk.saveTestList(entries);

describe('a desk check-in on a test day', () => {
  it('is real: claim, job, a post into TwoTimTwo, answered testDay with history off', async () => {
    const t = await monday();
    const st = await t.station();
    const res = await checkIn(t, st);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, already: false, history: 'off', testDay: true });
    expect(res.body.jobId).toEqual(expect.any(String));
    expect(t.checkinPosts).toBe(1);
    expect(t.tt.checkins).toHaveLength(1);
    expect((await st.call('GET', '/v1/print/next?max=10')).body.jobs).toHaveLength(1);
  });

  it('fires no afterCheckin hook (no history row, no count, no book)', async () => {
    const t = await monday();
    const st = await t.station();
    await checkIn(t, st);
    expect(t.heard).toEqual([]);
  });

  it('is remembered sealed: the list holds the child, the page\'s calendar and the night, and the storage value shows no clubber id', async () => {
    const t = await monday();
    const st = await t.station();
    await checkIn(t, st);
    expect(await t.core.desk.testList()).toEqual([{ id: '662', cal: '368', night: MON }]);
    const raw = JSON.stringify(t.storage.map.get(KEY));
    expect(Object.keys(t.storage.map.get(KEY)).sort()).toEqual(['ct', 'iv', 'v']);
    expect(raw).not.toContain('662');
    expect(raw).not.toContain('368');
    expect(raw).not.toContain(MON);
  });

  it('is refused by the client without testDay (the guard is unchanged), and a club day has no testDay flag and runs the hooks', async () => {
    const t = await monday();
    const client = t.core.watcher.clientFor();
    expect(await client.checkIn({ clubberId: '662', calendarId: '368', events: ['40'], name: 'Kit Tester' }, { desk: true })).toEqual({ ok: false, error: 'no-club' });
    expect(await client.checkIn({ clubberId: '662', calendarId: '368', events: ['40'], name: 'Kit Tester' }, { desk: true, testDay: true })).toMatchObject({ ok: true });
    const w = await rig({ kids: [kid('662')] });
    const heard = [];
    w.core.desk.hooks.afterCheckin.push(() => { heard.push('in'); });
    const res = await w.call('POST', '/v1/desk/checkin', await w.deskBody([]));
    expect(res.body.testDay).toBeUndefined();
    expect(heard).toEqual(['in']);
    expect(await w.core.desk.testList()).toEqual([]);
  });
});

describe('an undo on a test day', () => {
  it('is real: TwoTimTwo undo posted, claim undone, answered testDay, no afterUndo hook, off the list', async () => {
    const t = await monday();
    const st = await t.station();
    await checkIn(t, st);
    expect(await t.core.desk.testList()).toHaveLength(1);
    const res = await undo(t);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, droppedJobs: expect.any(Number), testDay: true });
    expect(t.posts.undo).toHaveLength(1);
    expect(t.heard).toEqual([]);
    expect(await t.core.desk.testList()).toEqual([]);
    expect(t.storage.map.has(KEY)).toBe(false);
    await t.core.ledger.load();
    expect(t.core.ledger.peek(MON, await t.core.tags.identity(MON, '662'))).toMatchObject({ state: 'undone' });
  });
});

describe('check-out on a test day', () => {
  it('stays refused no-club: no read, no post', async () => {
    const t = await monday();
    const res = await t.call('POST', '/v1/desk/checkout', { night: MON, clubberId: '662', historyRow: row('checkout', MON) });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, reason: 'no-club' });
    expect(t.posts.checkout).toHaveLength(0);
    expect(t.reads).toHaveLength(0);
  });
});

describe('sweepTestDay (the overnight undo)', () => {
  it('the next day undoes the entry on TwoTimTwo in its stored meeting and empties the list', async () => {
    const t = await monday();
    const st = await t.station();
    await checkIn(t, st);
    t.clock.t += DAY;   // Tuesday 8:36 pm: past local midnight
    await seed(t, [...await t.core.desk.testList(), { id: '700', cal: 'cal-777', night: MON }]);
    const out = await t.core.desk.sweepTestDay();
    expect(out).toEqual({ undone: 2, failed: 0, left: 0 });
    expect(t.posts.undo.map((p) => [p.get('clubber_id'), p.get('calendar_id')])).toEqual([['662', '368'], ['700', 'cal-777']]);
    expect(await t.core.desk.testList()).toEqual([]);
    expect(t.storage.map.has(KEY)).toBe(false);
  });

  it('the same day does nothing, and keeps the entry', async () => {
    const t = await monday();
    const st = await t.station();
    await checkIn(t, st);
    t.clock.t += 2 * 3600 * 1000;   // still Monday (10:36 pm)
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 0, left: 1 });
    expect(t.posts.undo).toHaveLength(0);
    expect(await t.core.desk.testList()).toHaveLength(1);
  });

  it('undoes an earlier night\'s entries and keeps today\'s', async () => {
    const t = await monday();
    await seed(t, [{ id: '1', cal: 'c1', night: '2026-10-11' }, { id: '2', cal: 'c2', night: MON }]);
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 1, failed: 0, left: 1 });
    expect(t.posts.undo.map((p) => p.get('clubber_id'))).toEqual(['1']);
    expect(await t.core.desk.testList()).toEqual([{ id: '2', cal: 'c2', night: MON }]);
  });

  it('a failed undo is kept and tried again, then given up on after 3 tries (logged)', async () => {
    const t = await monday();
    const logs = [];
    t.core.desk.log = (m) => { logs.push(String(m)); };
    await seed(t, [{ id: '9', cal: 'c9', night: '2026-10-11' }]);
    t.faults.undo = 'refuse';
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 1, left: 1 });
    expect(await t.core.desk.testList()).toEqual([{ id: '9', cal: 'c9', night: '2026-10-11', tries: 1 }]);
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 1, left: 1 });
    expect((await t.core.desk.testList())[0].tries).toBe(2);
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 1, left: 0 });
    expect(await t.core.desk.testList()).toEqual([]);
    expect(t.posts.undo).toHaveLength(3);
    expect(logs.some((l) => /could not be undone after 3 tries/.test(l))).toBe(true);
    // nothing left: a fourth run posts nothing
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 0, left: 0 });
    expect(t.posts.undo).toHaveLength(3);
  });

  it('a failure then a success: the retry undoes it and the list empties', async () => {
    const t = await monday();
    await seed(t, [{ id: '9', cal: 'c9', night: '2026-10-11' }]);
    t.faults.undo = 'refuse';
    await t.core.desk.sweepTestDay();
    t.faults.undo = null;
    expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 1, failed: 0, left: 0 });
    expect(await t.core.desk.testList()).toEqual([]);
  });

  it('never throws, even when storage fails', async () => {
    const t = await monday();
    await seed(t, [{ id: '9', cal: 'c9', night: '2026-10-11' }]);
    t.storage.get = async () => { throw new Error('storage down'); };
    const quiet = console.error;
    console.error = () => {};
    try { expect(await t.core.desk.sweepTestDay()).toEqual({ undone: 0, failed: 0, left: 0 }); } finally { console.error = quiet; }
  });

  it('SyncCore.cron() runs the sweep', async () => {
    const t = await monday();
    await seed(t, [{ id: '5', cal: 'c5', night: '2026-10-11' }]);
    await t.core.cron();
    expect(t.posts.undo.map((p) => [p.get('clubber_id'), p.get('calendar_id')])).toEqual([['5', 'c5']]);
    expect(await t.core.desk.testList()).toEqual([]);
  });
});

describe('rehearsal mode on a non-club day', () => {
  it('counts as a club day: no testDay flag, hooks run, nothing is remembered', async () => {
    const t = await monday();
    const st = await t.station();
    await st.call('POST', '/v1/station/extras', { rehearsal: true });
    const res = await checkIn(t, st);
    expect(res.body.testDay).toBeUndefined();
    expect(t.heard.map((h) => h[0])).toEqual(['in']);
    expect(await t.core.desk.testList()).toEqual([]);
  });
});

