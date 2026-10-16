// A simulated club night on the ONE read clock (TwoTimTwo's limit, back at 5 s since
// the extension was retired; 15 s from 2026-10-12): the Worker makes at most ONE read
// every 5 s, all of them combined, and a desk check-in never waits for one.
// Real concurrency: every sleep is a timer on a simulated clock, and the alarm,
// three phones polling the roster, the desk and the youth check-out run side by side.
import { describe, expect, it } from 'vitest';
import { READ_INTERVAL_MS } from '../src/readbudget.js';
import { WATCH_INTERVAL_MS } from '../src/watcher.js';
import { YM_CHECKOUT_GAP_MS } from '../src/ymcheckout.js';
import { CHECKIN_PAGE_TTL_MS } from '../src/desk.js';
import { memoryStore } from './helpers.js';
import { NIGHT, kid, rig, row } from './rig.js';

// Wednesday 2026-10-14 in the church's zone (EDT, UTC-4).
const AT = (hm) => {
  const [h, m, s = 0] = hm.split(':').map(Number);
  return Date.parse('2026-10-14T00:00:00Z') + ((h + 4) * 3600 + m * 60 + s) * 1000;
};

/** A clock whose sleeps are timers the simulation fires in order. */
function simClock(start) {
  const timers = [];
  const c = {
    t: start,
    now: () => c.t,
    tick: (ms) => { c.t += ms; },
    sleep: (ms) => new Promise((resolve) => { timers.push({ at: c.t + ms, resolve }); }),
    timers,
  };
  return c;
}

/** Anything the Worker did: a storage call, a fetch, a timer set. */
const progress = { n: 0 };
/** Storage that counts its calls (so `settle` can tell the Worker is still busy). */
function countingStore() {
  const m = memoryStore();
  for (const k of ['get', 'put', 'delete', 'list']) {
    const f = m[k];
    m[k] = async (...args) => { progress.n += 1; const r = await f(...args); progress.n += 1; return r; };
  }
  return m;
}

/**
 * Let every ready promise run, WebCrypto included (it answers on another
 * thread): real time passes until nothing has moved for a few rounds, and for
 * many more while some operation is neither finished nor sleeping on the
 * simulated clock (it is still computing, or waiting on another that is).
 */
async function settle(extra = () => 0, idle = () => true) {
  let last = -1;
  let still = 0;
  for (let i = 0; i < 2000 && still < (idle() ? 4 : 40); i++) {
    await new Promise((r) => setTimeout(r, i < 4 ? 0 : 3));
    const now = progress.n + extra();
    still = now === last ? still + 1 : 0;
    last = now;
  }
}

const KIDS = [
  kid('101', 'Sparks', 'Ada Sparks'), kid('102', 'Cubbies', 'Bo Cubs'), kid('103', 'T&T', 'Cy Tnt'),
  kid('7001', 'Trek', 'Ann Trekker'), kid('7002', 'Journey', 'Bo Journeyer'), kid('7003', 'Trek', 'Cy Trekker'),
];
/** The household export: everyone the check-in page and the report name, but the new family. */
const csv = (extra = '') => '"Household ID","Parent/Guardian#1","Active Clubbers"\r\n'
  + '"11","P","Kit Tester, Lu Tester"\r\n"12","P","Ada Sparks, Bo Cubs"\r\n"13","P","Cy Tnt"\r\n'
  + '"14","P","Ann Trekker, Cy Trekker"\r\n"15","P","Bo Journeyer"\r\n' + extra;

/**
 * Run a night: the alarm as the Durable Object runs it (one at a time), three
 * phones polling GET /v1/desk/roster every 15 s after each answer (and the
 * families when their stamp moves, as the page does), and `script` events.
 */
async function night({ start, minutes, env = {}, script = [], households }) {
  const clock = simClock(start);
  let hh = csv();
  const t = await rig({ env: { YM_CHECKOUT: 'on', ...env }, kids: KIDS, start, clock, storage: countingStore(), households: households || (() => hh) });
  const done = { n: 0 };
  /** Operations under way (the alarm, a phone's poll, a desk call). */
  let running = 0;
  t.track = (p) => { running += 1; const end = () => { running -= 1; }; p.then(end, end); return p; };
  t.setHouseholds = (extra) => { hh = csv(extra); };
  const end = start + minutes * 60 * 1000;
  const log = { roster: [], families: [], checkins: [] };
  const moved = () => clock.timers.length + t.tt.calls.length + t.slots.length + log.roster.length + log.checkins.length + done.n;
  const step = () => settle(moved, () => running <= clock.timers.length);
  let alarmRunning = false;
  const phones = [0, 5000, 10000].map((offset) => ({ next: start + offset, busy: false, familiesAt: null }));
  const queue = [...script].sort((a, b) => a.at - b.at);
  t.alarm.at = start;
  for (;;) {
    await step();
    // what is due now
    if (!alarmRunning && t.alarm.at !== null && t.alarm.at <= clock.t) {
      alarmRunning = true;
      t.alarm.at = null;
      t.track(t.core.alarm()).finally(() => { alarmRunning = false; done.n += 1; });
      continue;
    }
    const phone = phones.find((p) => !p.busy && p.next <= clock.t);
    if (phone) {
      phone.busy = true;
      const asked = clock.t;
      t.track((async () => {
        const r = await t.call('GET', '/v1/desk/roster');
        log.roster.push({ at: asked, waited: clock.t - asked, status: r.status, stale: !!r.body.stale });
        if (r.status === 200 && r.body.familiesAt !== phone.familiesAt) {
          const f = await t.call('GET', '/v1/desk/families');
          if (f.status === 200) { phone.familiesAt = f.body.familiesAt; log.families.push({ at: clock.t, households: f.body.households }); }
        }
        phone.busy = false;
        phone.next = clock.t + 15000;   // a phone's own poll cadence, not the read clock
        done.n += 1;
      })());
      continue;
    }
    if (queue.length && queue[0].at <= clock.t) {
      const ev = queue.shift();
      await ev.run(t, log);
      continue;
    }
    // nothing due: move the clock to the next timer, alarm, poll or event
    clock.timers.sort((a, b) => a.at - b.at);
    const candidates = [
      clock.timers[0]?.at,
      !alarmRunning && t.alarm.at !== null ? t.alarm.at : undefined,
      ...phones.filter((p) => !p.busy).map((p) => p.next),
      queue[0]?.at,
    ].filter((v) => v !== undefined);
    const next = Math.min(...candidates);
    if (!Number.isFinite(next) || next > end) break;
    clock.t = Math.max(clock.t, next);
    while (clock.timers.length && clock.timers[0].at <= clock.t) clock.timers.shift().resolve();
  }
  // let what is under way finish
  clock.t = end;
  while (clock.timers.length) { clock.timers.sort((a, b) => a.at - b.at); const x = clock.timers.shift(); clock.t = Math.max(clock.t, x.at); x.resolve(); await step(); }
  await step();
  return { t, log, clock };
}

const gaps = (ats) => ats.slice(1).map((a, i) => a - ats[i]);
const perMinute = (slots, from, to) => {
  const by = {};
  for (const s of slots) if (s.at >= from && s.at < to) by[s.path] = (by[s.path] || 0) + 1;
  const min = (to - from) / 60000;
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, Math.round((v / min) * 100) / 100]));
};

/** A desk check-in, timed: how long the desk waited, and whether it read anything. */
const deskCheckin = (at, clubberId = '662') => ({
  at,
  run: async (t, log) => {
    const reads = t.slots.length;
    const asked = t.clock.t;
    const p = t.track(t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId, items: {}, historyRow: row(), job: null }));
    const busyMs = t.core.watcher.budget.peek();
    p.then((r) => log.checkins.push({ at: asked, ms: t.clock.t - asked, busyMs, status: r.status, body: r.body, readsDuring: t.slots.length - reads }));
  },
});

// Real time passes while the simulation settles: these take a few seconds each.
describe('a club night on the one 5 s read clock', { timeout: 60000 }, () => {
  it('6 pm: report every 30 s, the roster 30 s fresh for three phones, no two reads within 5 s, a check-in never waits', async () => {
    const { t, log } = await night({
      start: AT('18:00'), minutes: 8,
      // a check-in while the clock is booked (a read started, the next not yet allowed)
      script: [deskCheckin(AT('18:04:02'))],
    });
    const all = t.slots.map((s) => s.at);
    expect(Math.min(...gaps(all))).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
    const reports = t.reads.filter((r) => r.path === '/clubber/checkin_report').map((r) => r.at);
    expect(Math.max(...gaps(reports))).toBeLessThanOrEqual(WATCH_INTERVAL_MS + READ_INTERVAL_MS);
    expect(reports.length).toBeGreaterThanOrEqual(13);
    // the roster: every phone got an answer, none was refused
    // once signed in (the first report), no phone was refused: they wait their turn
    const signedIn = t.reads.find((x) => x.path === '/clubber/checkin_report').at;
    expect(log.roster.filter((r) => r.at >= signedIn && (r.status !== 200 || r.waited > 20000))).toEqual([]);
    const rosterPages = t.reads.filter((r) => r.path === '/clubber/checkin').map((r) => r.at);
    // (the first gap aside: the watcher's one start-up probe of the night's page may follow a phone's first read by a few slots)
    expect(Math.min(...gaps(rosterPages.slice(1)))).toBeGreaterThanOrEqual(CHECKIN_PAGE_TTL_MS);
    // the desk check-in: answered at once, no read, TwoTimTwo's post made
    expect(log.checkins).toHaveLength(1);
    expect(log.checkins[0]).toMatchObject({ status: 200, ms: 0, readsDuring: 0 });
    expect(log.checkins[0].busyMs).toBeGreaterThan(0);
    expect(log.checkins[0].body).toMatchObject({ ok: true, already: false });
    expect(t.tt.checkins).toHaveLength(1);
    // the schedule (reads a minute by kind, minutes 2 to 8 once signed in)
    const rate = perMinute(t.slots, AT('18:02'), AT('18:08'));
    console.warn('[schedule 6:00 pm]', JSON.stringify(rate));
    expect(rate['/clubber/checkin_report']).toBe(2);
    expect(rate['/clubber/checkout']).toBeLessThanOrEqual(1);   // the Checkout page all club night (hand check-outs), YM_CHECKOUT off
    expect(Object.values(rate).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6);   // report 2 + roster page 2 + Checkout page 1 + a stations' feed read now and then: 5 to 6 of the 12 slots a minute
  });

  it('7:30 pm: the youth check-out joins (Checkout page once a minute, one post per 15 s), the report still every 30-45 s', async () => {
    const { t, log } = await night({ start: AT('19:12'), minutes: 20 });
    const all = t.slots.map((s) => s.at);
    expect(Math.min(...gaps(all))).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
    const reports = t.reads.filter((r) => r.path === '/clubber/checkin_report').map((r) => r.at);
    expect(Math.max(...gaps(reports))).toBeLessThanOrEqual(WATCH_INTERVAL_MS + READ_INTERVAL_MS);
    // Trek and Journey checked out, posts 15 s apart (posts are writes: no slot)
    expect(t.posts.checkout.map((p) => p.get('clubber_id')).sort()).toEqual(['7001', '7002', '7003']);
    expect(Math.min(...gaps(t.posts.checkoutAt))).toBeGreaterThanOrEqual(YM_CHECKOUT_GAP_MS);
    const pages = t.reads.filter((r) => r.path === '/clubber/checkout').map((r) => r.at);
    expect(pages.length).toBeGreaterThan(0);
    expect(Math.min(...gaps(pages))).toBeGreaterThanOrEqual(60000);
    // once signed in (the first report), no phone was refused: they wait their turn
    const signedIn = t.reads.find((x) => x.path === '/clubber/checkin_report').at;
    expect(log.roster.filter((r) => r.at >= signedIn && (r.status !== 200 || r.waited > 20000))).toEqual([]);
    const rate = perMinute(t.slots, AT('19:25'), AT('19:32'));
    console.warn('[schedule 7:30 pm]', JSON.stringify(rate));
    expect(rate['/clubber/checkin_report']).toBeGreaterThanOrEqual(1.4);
    // report 2 + roster page 2 + Checkout page 1 (+ the odd meeting report): 5 of the 12 slots a minute
    expect(Object.values(rate).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(6);
  });

  it('a child the household export does not list: ONE catch-up read, and the phones regroup', async () => {
    const newKid = kid('9001', 'Sparks', 'Nell Newfamily');
    const { t, log } = await night({
      start: AT('18:00'), minutes: 6,
      script: [{ at: AT('18:02'), run: async (tt) => { tt.night.kids.push(newKid); tt.setHouseholds('"16","P","Nell Newfamily, Ned Newfamily"\r\n'); } }],
    });
    const hh = t.reads.filter((r) => r.path === '/household/csv').map((r) => r.at);
    // the phones' first read, then one catch-up once the report listed the new child
    expect(hh).toHaveLength(2);
    expect(hh[1]).toBeGreaterThan(AT('18:02'));
    expect(hh[1] - AT('18:02')).toBeLessThanOrEqual(WATCH_INTERVAL_MS + 2 * READ_INTERVAL_MS);
    expect(log.families.at(-1).households).toContainEqual(['Nell Newfamily', 'Ned Newfamily']);
    expect(Math.min(...gaps(t.slots.map((s) => s.at)))).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('a child the export never lists is looked for once a night, not on every read', async () => {
    const { t } = await night({
      start: AT('18:00'), minutes: 6,
      script: [{ at: AT('18:02'), run: async (tt) => { tt.night.kids.push(kid('9002', 'Sparks', 'Solo Unlisted')); } }],
    });
    expect(t.reads.filter((r) => r.path === '/household/csv')).toHaveLength(2);
    expect((await t.call('GET', '/v1/cloud/status')).body.families).toMatchObject({ waiting: 0, lookedFor: 1, catchUps: 1 });
  });
});

describe('a desk action never waits for a read', () => {
  it('with the night\'s page held, a check-in, undo and check-out read nothing, even with the clock booked', async () => {
    const t = await rig({ kids: KIDS });
    await t.call('GET', '/v1/desk/roster');               // the page, held for the night
    t.clock.tick(5 * 60 * 1000);                          // long past the roster's 30 s
    for (let i = 0; i < 2; i++) t.core.watcher.budget.claim(60000, 'desk');   // the clock booked solid
    const before = t.slots.length;
    const at = t.clock.t;
    const res = await t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: null });
    expect(res.body).toMatchObject({ ok: true, already: false });
    expect(await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).toMatchObject({ status: 200 });
    expect(await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '663', historyRow: row('checkout') })).toMatchObject({ status: 200 });
    expect(t.clock.t).toBe(at);
    expect(t.slots.length).toBe(before);
  });

  it('the watcher warms the page when the window opens, so the first check-in reads nothing', async () => {
    const t = await rig({ kids: KIDS });
    for (let i = 0; i < 6 && !t.core.desk.hasNightPage(); i++) { await t.core.alarm(); t.clock.t = t.alarm.at; }
    expect(t.core.desk.hasNightPage()).toBe(true);
    const before = t.reads.length;
    const res = await t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: null });
    expect(res.body).toMatchObject({ ok: true });
    expect(t.reads.length).toBe(before);
  });

  it('nothing held (a restart): the check-in\'s read jumps the queue ahead of a waiting roster read, spacing kept', async () => {
    const clock = simClock(AT('18:00'));
    const t = await rig({ kids: KIDS, clock });
    // a read just started (the watcher's report), and a phone's roster queued behind it
    const pump = async () => { for (let i = 0; i < 40; i++) { await settle(); clock.timers.sort((a, b) => a.at - b.at); const x = clock.timers.shift(); if (!x) return; clock.t = Math.max(clock.t, x.at); x.resolve(); } };
    t.core.watcher.budget.claim(0, 'watcher', true);
    t.slots.push({ at: clock.t, path: '/clubber/checkin_report', method: 'GET' });
    const roster = t.call('GET', '/v1/desk/roster');
    await settle();
    const checkin = t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: null });
    await pump();
    const [r, c] = await Promise.all([roster, checkin]);
    expect(c.body).toMatchObject({ ok: true });
    expect(r.status).toBe(200);
    // the sign-in and the page the check-in needed went first; the roster's read came after
    const kinds = t.core.watcher.budget.stats();
    expect(kinds.displaced).toBeGreaterThanOrEqual(1);
    expect(t.tt.checkins).toHaveLength(1);
    const gapsAll = gaps(t.slots.map((s) => s.at).sort((a, b) => a - b));
    expect(Math.min(...gapsAll)).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('a lapsed session: the check-in post signs in again at the head of the queue and is made once more', async () => {
    const t = await rig({ kids: KIDS });
    await t.call('GET', '/v1/desk/roster');
    t.clock.tick(60 * 1000);
    t.tt.expire();                                         // TwoTimTwo dropped the session
    const res = await t.call('POST', '/v1/desk/checkin', { night: NIGHT, clubberId: '662', items: {}, historyRow: row(), job: null });
    expect(res.body).toMatchObject({ ok: true, already: false });
    expect(t.tt.checkins).toHaveLength(1);                 // the second post, after the sign-in
    expect(t.core.watcher.clientFor().relogins).toBe(1);
    expect(Math.min(...gaps(t.slots.map((s) => s.at))) ).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });
});
