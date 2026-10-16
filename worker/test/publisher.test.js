// The Worker as the ONE publisher (P5): the gate on POST /v1/publish, the tally /
// tonight / still-here frames made from the Worker's own state by the SHARED
// rules, the station's settings (season, rehearsal, pickup clubs), and what is
// (and is not) kept at rest.
import { describe, expect, it } from 'vitest';
import { importDisplayKey, openEnvelope, paddedSize } from '../../lobby/src/lib/envelope.js';
import { REPORT_FRESH_MS } from '../../shared/tonight.js';
import { seal } from '../src/crypto.js';
import { MINUTE_MS, STILL_GAP_MS } from '../src/publisher.js';
import { SyncCore } from '../src/sync.js';
import { SPILL_MS, WATCH_INTERVAL_MS } from '../src/watcher.js';
import { fakeClock, everything, memoryStore, sealJob, signInV2 } from './helpers.js';
import { ENV, NIGHT, kid, rig, row } from './rig.js';
import { leaks } from './noleak.js';

const ON = { SINGLE_PUBLISHER: 'on' };

async function core(env) {
  const clock = fakeClock();
  const sent = [];
  const c = new SyncCore({ storage: memoryStore(), env, now: clock.now, fetchFn: async () => new Response('', { status: 500 }), broadcast: (text) => { sent.push(JSON.parse(text).e); return 1; } });
  const { session } = (await signInV2(c)).body;
  const publish = async (event, payload, headers = {}) => (await c.handle(new Request('https://sync.test/v1/publish', {
    method: 'POST', headers: { Authorization: `Bearer ${session}`, ...headers }, body: JSON.stringify({ event, payload }),
  }))).json();
  return { c, sent, publish };
}

/** The frames of one event the Worker broadcast, newest last; `checkout` opened with the display key. */
async function frames(t, event) {
  const key = await importDisplayKey(await t.core.displayKey());
  const out = [];
  for (const f of t.sent.filter((x) => x.e === event)) {
    out.push(event === 'checkout' ? (await openEnvelope(key, 'checkout', f.d)).payload : f.d);
  }
  return out;
}

describe('the single publisher gate', () => {
  it('drops the laptop\'s tally, ticker and still-here list when SINGLE_PUBLISHER is on and cloud check-in runs', async () => {
    const { c, sent, publish } = await core({ ...ENV, ...ON });
    const checkout = await seal(await c.displayKey(), 'checkout', { names: [] });
    expect(await publish('tally', { counts: {}, total: 3, at: '2026-10-14T22:00:00.000Z' })).toEqual({ ok: true, screens: 0, dropped: true, reason: 'single-publisher' });
    expect(await publish('checkout', checkout)).toMatchObject({ dropped: true });
    expect(await publish('tonight', { checkedIn: 3, booksCompleted: 1, awardsEarned: 0, friendsBrought: 0 })).toMatchObject({ dropped: true });
    // every other event still flows
    expect(await publish('notice', { text: 'Hello', level: 'info' })).toMatchObject({ ok: true });
    expect(await publish('recap', await seal(await c.displayKey(), 'recap', { entries: [] }))).toMatchObject({ ok: true });
    expect(sent).toEqual(['notice', 'recap']);
  });

  it('is off by default, and off without cloud check-in: nothing is dropped', async () => {
    for (const env of [ENV, { ...ENV, SINGLE_PUBLISHER: 'off' }, { INITIAL_PASSPHRASE: 'kennebec', SINGLE_PUBLISHER: 'on' }, { ...ENV, ...ON, CLOUD_CHECKIN: 'off' }]) {
      const { sent, publish } = await core(env);
      const r = await publish('tally', { counts: {}, total: 3, at: '2026-10-14T22:00:00.000Z' });
      expect(r.dropped).toBeUndefined();
      expect(await publish('tonight', { checkedIn: 3, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0 })).toMatchObject({ ok: true });
      expect(sent).toEqual(['tally', 'tonight']);
    }
  });

  it('lets exactly ONE greeting per print job through, and only a registered station\'s', async () => {
    const t = await rig({ env: ON, kids: [kid('662', 'Sparks', 'Kit Tester')] });
    const st = await t.station();
    const sealed = async (headers) => (await t.call('POST', '/v1/publish', { event: 'checkin', payload: await seal(await t.core.displayKey(), 'checkin', { firstName: 'Kit', club: 'Sparks', isBirthday: true }) }, headers));
    const body = await t.deskBody([st]);
    const jobId = (await t.call('POST', '/v1/desk/checkin', body)).body.jobId;
    expect(t.sent.filter((f) => f.e === 'checkin')).toEqual([]);   // the Worker greets nobody itself any more
    // the laptop's own greeting (no job), a made-up job, a job with no registered station: dropped
    expect((await sealed({})).body).toMatchObject({ dropped: true });
    expect((await sealed({ 'X-Station': st.body.stationId, 'X-Job': 'A'.repeat(22) })).body).toMatchObject({ dropped: true, reason: 'unknown-job' });
    expect((await sealed({ 'X-Station': 'station-unknown1', 'X-Job': jobId })).body).toMatchObject({ dropped: true, reason: 'unknown-station' });
    // the station's, with the job it printed: once
    expect((await sealed({ 'X-Station': st.body.stationId, 'X-Job': jobId })).body).toEqual({ ok: true, screens: 1 });
    expect((await sealed({ 'X-Station': st.body.stationId, 'X-Job': jobId })).body).toMatchObject({ dropped: true, reason: 'already-greeted' });
    const greetings = t.sent.filter((f) => f.e === 'checkin');
    expect(greetings).toHaveLength(1);
    expect(Object.keys(greetings[0].d).sort()).toEqual(['ct', 'iv', 'kid', 'v']);   // sealed
    // a reprint is not a check-in: no greeting
    const rp = await sealJob([st], { route: '/reprint', body: {} }, { id: 'A'.repeat(22) });
    const reprintId = 'reprint:11111111-2222-3333-4444-555555555555';
    expect((await t.call('POST', '/v1/print/reprint', { jobId: reprintId, bundle: rp.bundle })).body.ok).toBe(true);
    expect((await sealed({ 'X-Station': st.body.stationId, 'X-Job': reprintId })).body).toMatchObject({ dropped: true });
  });

  it('greets each child ONCE a night whichever path printed them: a job-less station greeting names the child, a late job greeting fills in a dropped one', async () => {
    const t = await rig({ env: ON, kids: [] });
    await t.core.watcher.tick();   // the baseline read: nobody is here
    const st = await t.station();
    const S = { 'X-Station': st.body.stationId };
    const greeting = async (extra = {}, headers = {}) => (await t.call('POST', '/v1/publish', {
      event: 'checkin', payload: await seal(await t.core.displayKey(), 'checkin', { firstName: 'Kit', club: 'Sparks' }), ...extra,
    }, headers)).body;
    const count = () => t.sent.filter((f) => f.e === 'checkin').length;

    // the phone page's relay job (or the extension) printed on the station: it names the child
    expect(await greeting({ greet: { clubberId: '662' } })).toMatchObject({ dropped: true, reason: 'single-publisher' });   // no station: dropped
    expect(await greeting({ greet: { clubberId: '662' } }, S)).toEqual({ ok: true, screens: 1 });
    expect(await greeting({ greet: { clubberId: '662' } }, S)).toMatchObject({ dropped: true, reason: 'already-greeted' });
    expect(await greeting({ greet: { clubberId: 'not-an-id' } }, S)).toMatchObject({ dropped: true, reason: 'no-child' });
    // then the watcher saw them on the report (CLOUD_PRINT): a job, which met the label already printed
    t.night.kids.push(kid('662', 'Sparks', 'Kit Tester'));
    t.clock.tick(WATCH_INTERVAL_MS); await t.core.watcher.tick();
    t.clock.tick(SPILL_MS); await t.core.watcher.tick();
    const jobs = (await st.call('GET', '/v1/print/next')).body.jobs;
    expect(jobs).toHaveLength(1);
    expect(await greeting({ late: true }, { ...S, 'X-Job': jobs[0].jobId })).toMatchObject({ dropped: true, reason: 'already-greeted' });
    expect(count()).toBe(1);

    // a child whose first greeting the gate dropped (the laptop's relay, no station): the late one greets them, once
    t.night.kids.push(kid('663', 'Cubbies', 'Ottoline Tester'));
    expect(await greeting()).toMatchObject({ dropped: true });
    t.clock.tick(WATCH_INTERVAL_MS); await t.core.watcher.tick();
    t.clock.tick(SPILL_MS); await t.core.watcher.tick();
    const late = (await st.call('GET', '/v1/print/next')).body.jobs;
    expect(late).toHaveLength(1);
    expect(await greeting({ late: true }, { ...S, 'X-Job': late[0].jobId })).toEqual({ ok: true, screens: 1 });
    expect(await greeting({ greet: { clubberId: '663' } }, S)).toMatchObject({ dropped: true, reason: 'already-greeted' });
    expect(count()).toBe(2);

    // a phone visitor (no clubber id) is named by name and club; the desk's spelling is the same child
    expect(await greeting({ greet: { name: 'Zed Visitor', club: 'Sparks' } }, S)).toEqual({ ok: true, screens: 1 });
    expect(await greeting({ greet: { name: ' zed  VISITOR', club: 'sparks' } }, S)).toMatchObject({ dropped: true, reason: 'already-greeted' });
    expect(count()).toBe(3);
    // storage holds keyed hashes only, never the id or the name it was given
    expect(leaks(everything(t.storage), ['662', '663', 'Zed', 'Visitor'], { ignoreCase: true })).toEqual([]);
    // the next night starts clean
    await t.core.publisher.endOfNight();
    expect((await t.storage.get('publisher:greeted'))).toBeUndefined();
  });

  it('with SINGLE_PUBLISHER off a late greeting is dropped (the laptop greeted already) and every other greeting flows as before', async () => {
    const t = await rig({ kids: [kid('662', 'Sparks', 'Kit Tester')] });
    const st = await t.station();
    const body = async (extra) => ({ event: 'checkin', payload: await seal(await t.core.displayKey(), 'checkin', { firstName: 'Kit', club: 'Sparks' }), ...extra });
    const S = { 'X-Station': st.body.stationId };
    expect((await t.call('POST', '/v1/publish', await body({}))).body).toEqual({ ok: true, screens: 1 });
    expect((await t.call('POST', '/v1/publish', await body({ greet: { clubberId: '662' } }), S)).body).toEqual({ ok: true, screens: 1 });
    expect((await t.call('POST', '/v1/publish', await body({ late: true }), { ...S, 'X-Job': 'A'.repeat(22) })).body).toMatchObject({ dropped: true, reason: 'late' });
    expect(t.sent.filter((f) => f.e === 'checkin')).toHaveLength(2);
  });

  it('while the laptop is still the publisher (SINGLE_PUBLISHER off) the Worker publishes nothing and drops nothing', async () => {
    const t = await rig({ kids: [kid('662', 'Sparks', 'Kit Tester')] });
    const st = await t.station();
    await t.core.watcher.tick();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(t.sent.filter((f) => ['checkin', 'tally', 'tonight', 'checkout'].includes(f.e))).toEqual([]);
    const r = await t.call('POST', '/v1/publish', { event: 'tally', payload: { counts: {}, total: 1, at: '2026-10-14T22:00:00.000Z' } });
    expect(r.body.dropped).toBeUndefined();
  });
});

describe('the Worker publishes the tally, the ticker and the still-here list', () => {
  const people = [kid('1', 'Sparks', 'Ada Tester'), kid('2', 'Sparks', 'Bo Tester'), kid('3', 'Trek', 'Cy Tester'), kid('4', 'T&amp;T', 'Dee Tester')];

  it('from an applied report, in the printer\'s frame shapes', async () => {
    const t = await rig({ env: ON, kids: people });
    await t.core.watcher.tick();
    const [tally] = await frames(t, 'tally');
    expect(tally).toEqual({ counts: { Sparks: 2, Trek: 1, 'T&T': 1 }, total: 4, at: new Date(t.clock.t).toISOString() });
    const [tonight] = await frames(t, 'tonight');
    expect(tonight).toMatchObject({ checkedIn: 4, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0 });
    // the pickup list: first name + club, every club but Trek and Journey (the printer's default), sorted
    const [checkout] = await frames(t, 'checkout');
    expect(checkout.entries).toEqual([{ firstName: 'Ada', club: 'Sparks' }, { firstName: 'Bo', club: 'Sparks' }, { firstName: 'Dee', club: 'T&T' }]);
    expect(checkout.printed).toBe(0);
    expect(Object.keys(checkout.entries[0]).sort()).toEqual(['club', 'firstName']);
    // the still-here list is SEALED, the others are plaintext numbers
    const raw = t.sent.find((f) => f.e === 'checkout').d;
    expect(Object.keys(raw).sort()).toEqual(['ct', 'iv', 'kid', 'v']);   // an envelope: no `entries`, no names (not a regexp over ciphertext, which could hold "Ada" by chance)
    expect(raw).toMatchObject({ v: 1 });
    expect(JSON.stringify(t.sent.filter((f) => f.e === 'tally' || f.e === 'tonight'))).not.toMatch(/Ada|Bo|Cy|Dee/);
  });

  it('on a change, and every minute while the window is open, not on every read', async () => {
    const t = await rig({ env: ON, kids: people });
    await t.core.watcher.tick();
    const count = (e) => t.sent.filter((f) => f.e === e).length;
    expect([count('tally'), count('tonight'), count('checkout')]).toEqual([1, 1, 1]);
    // another read of the same report inside the minute: nothing new
    t.clock.tick(WATCH_INTERVAL_MS); await t.core.watcher.tick();
    expect([count('tally'), count('tonight'), count('checkout')]).toEqual([1, 1, 1]);
    // a minute on: the heartbeat
    t.clock.tick(MINUTE_MS);
    await t.core.watcher.tick();
    expect([count('tally'), count('tonight'), count('checkout')]).toEqual([2, 2, 2]);
    // a child checked in on TwoTimTwo's own page: a change, at once
    t.night.kids.push(kid('5', 'Cubbies', 'Eve Tester'));
    t.clock.tick(WATCH_INTERVAL_MS);
    await t.core.watcher.tick();
    expect((await frames(t, 'tally')).at(-1)).toMatchObject({ total: 5, counts: { Cubbies: 1 } });
    expect((await frames(t, 'checkout')).at(-1).entries.map((e) => e.firstName)).toEqual(['Ada', 'Bo', 'Dee', 'Eve']);
  });

  it('a desk check-in ticks the count at once, before the report catches up; undo and check-out take the child off', async () => {
    const t = await rig({ env: ON, kids: people });
    const st = await t.station();
    await t.core.watcher.tick();
    const tallies = async () => (await frames(t, 'tally')).at(-1);
    expect((await tallies()).total).toBe(4);
    t.clock.tick(STILL_GAP_MS + 1);
    // 662 (Kit, Sparks) at the desk: TwoTimTwo has them, our last read has not
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(res.body.ok).toBe(true);
    expect((await tallies())).toMatchObject({ total: 5, counts: { Sparks: 3 } });
    expect((await frames(t, 'checkout')).at(-1).entries.map((e) => e.firstName)).toContain('Kit');
    // undone at the desk: a person's removal beats the report (which may still list them)
    t.clock.tick(STILL_GAP_MS + 1);
    await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') });
    expect((await tallies()).total).toBe(4);
    // checked out at the desk: off the count and the list
    t.clock.tick(STILL_GAP_MS + 1);
    await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '1', historyRow: row('checkout') });
    expect((await tallies()).total).toBe(3);
    expect((await frames(t, 'checkout')).at(-1).entries.map((e) => e.firstName)).toEqual(['Bo', 'Dee']);
  });

  it('a partial report and a report that drops more than half the room change nothing (the shared guards)', async () => {
    const t = await rig({ env: ON, kids: people });
    await t.core.watcher.tick();
    t.night.count = 9;   // its own Count: footers say nine, the parse found four
    t.night.kids = [];
    t.clock.tick(10000);
    await t.core.watcher.tick();
    expect((await frames(t, 'tally')).at(-1).total).toBe(4);
    t.night.count = null;
    t.night.kids = [people[0]];   // 3 of 4 gone in one read: refused
    t.clock.tick(10000);
    await t.core.watcher.tick();
    expect((await frames(t, 'tally')).at(-1).total).toBe(4);
  });

  it('the pickup list follows the station\'s pickupClubs and the tally carries its season and rehearsal flag', async () => {
    const t = await rig({ env: ON, kids: people });
    const st = await t.station();
    await t.core.watcher.tick();
    expect((await t.call('POST', '/v1/station/extras', { season: 'christmas', rehearsal: true, pickupClubs: ['Trek'] }, {})).status).toBe(403);   // a session alone is not a station
    t.clock.tick(STILL_GAP_MS + 1);   // (two still-here lists are never closer than this)
    const ok = await st.call('POST', '/v1/station/extras', { season: 'christmas', rehearsal: true, pickupClubs: ['Trek'], bogus: 1 });
    expect(ok.body).toEqual({ ok: true, changed: true });
    expect((await frames(t, 'tally')).at(-1)).toMatchObject({ season: 'christmas', rehearsal: true });
    expect((await frames(t, 'checkout')).at(-1).entries).toEqual([{ firstName: 'Cy', club: 'Trek' }]);
    // nonsense is ignored, never stored
    expect((await st.call('POST', '/v1/station/extras', { season: 'Not A Slug!', pickupClubs: ['Nope'], booksCompleted: -3 })).body.changed).toBe(false);
    // the dropped laptop frames hand over the ticker's books and awards
    await t.call('POST', '/v1/publish', { event: 'tonight', payload: { checkedIn: 99, booksCompleted: 7, awardsEarned: 2, friendsBrought: 0 } });
    t.clock.tick(MINUTE_MS);
    await t.core.watcher.tick();
    expect((await frames(t, 'tonight')).at(-1)).toMatchObject({ checkedIn: 4, booksCompleted: 7, awardsEarned: 2 });
  });

  it('never publishes the still-here list outside the watch window, nor anything before the report', async () => {
    const t = await rig({ env: ON, kids: people, start: Date.parse('2026-10-14T14:00:00Z') });   // 10 am Wednesday
    await t.core.watcher.tick();
    await t.core.publisher.publishDue('test');
    expect(t.sent.filter((f) => f.e === 'checkout')).toEqual([]);
  });

  it('the report goes stale: the count falls back to the desk\'s own rows (history mode), as on the laptop', async () => {
    const t = await rig({ env: ON, kids: people });
    const st = await t.station();
    await t.core.watcher.tick();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    t.clock.tick(REPORT_FRESH_MS + MINUTE_MS);
    await t.core.publisher.publishDue('test');
    expect((await frames(t, 'tally')).at(-1)).toMatchObject({ total: 1 });
    expect((await t.call('GET', '/v1/desk/tonight')).body).toMatchObject({ source: 'history', checkedIn: 1 });
  });

  it('GET /v1/desk/tonight is the shared count, in shadow mode too (no names kept)', async () => {
    const t = await rig({ kids: people });   // SINGLE_PUBLISHER off
    await t.core.watcher.tick();
    expect((await t.call('GET', '/v1/desk/tonight')).body).toMatchObject({ night: NIGHT, source: 'report', checkedIn: 4, byClub: { Sparks: 2, Trek: 1, 'T&T': 1 }, enabled: false });
    expect(t.sent.filter((f) => ['tally', 'tonight', 'checkout'].includes(f.e))).toEqual([]);
    expect(everything(t.storage)).not.toMatch(/"(Ada|Bo|Cy|Dee)"|Bo Tester|Cy Tester/);   // quoted: a name as a JSON value, never a run of random base64
    // the sealed book holds ids and clubs but, while the laptop publishes, no first names: open it and see
    const { openState } = await import('../src/watcher.js');
    const book = await openState(ENV.TWOTIMTWO_PASSWORD, t.storage.map.get('tonight:book').sealed);
    expect(JSON.stringify(book)).not.toMatch(/Ada|Bo|Cy|Dee/);
    expect(book.report.entries).toHaveLength(4);
  });
});

describe('what the Worker keeps of tonight\'s children', () => {
  it('first names and clubs only, sealed under the state key, gone at the end of the night', async () => {
    const t = await rig({ env: ON, kids: [kid('1', 'Sparks', 'Ada Lovelace-Tester'), kid('2', 'Cubbies', 'Bo Tester')] });
    const st = await t.station();
    await t.core.watcher.tick();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    const stored = everything(t.storage);
    // no plaintext name or id anywhere in storage
    for (const needle of ['"Ada"', '"Bo"', '"Kit"', 'Lovelace', 'Bo Tester', 'Kit Tester', '"662"', 'clubberId']) expect(stored, needle).not.toContain(needle);
    // opened with the state key: a first name, a club, an id; never a last name
    const { openState } = await import('../src/watcher.js');
    const book = await openState(ENV.TWOTIMTWO_PASSWORD, t.storage.map.get('tonight:book').sealed);
    expect(JSON.stringify(book)).toMatch(/Ada/);
    for (const needle of ['Lovelace', 'Tester']) expect(JSON.stringify(book), needle).not.toContain(needle);
    // the window closes: the names go, and the next night starts clean
    t.clock.t = Date.parse('2026-10-15T05:00:00Z');   // 1 am Thursday
    await t.core.watcher.tick();
    expect(t.storage.map.has('tonight:book')).toBe(false);
  });

  it('survives a Durable Object restart (loaded and opened once)', async () => {
    const t = await rig({ env: ON, kids: [kid('1', 'Sparks', 'Ada Tester')] });
    await t.core.watcher.tick();
    t.restart();
    expect((await t.call('GET', '/v1/desk/tonight')).body).toMatchObject({ source: 'report', checkedIn: 1 });
    t.clock.tick(MINUTE_MS);
    await t.core.watcher.tick();
    expect((await frames(t, 'checkout')).at(-1).entries).toEqual([{ firstName: 'Ada', club: 'Sparks' }]);
  });

  it('the frames the Worker makes are as long as the printer\'s (sealed padding by rung, plaintext numbers)', async () => {
    const t = await rig({ env: ON, kids: [kid('1', 'Sparks', 'Ada Tester')] });
    await t.core.watcher.tick();
    const small = t.sent.find((f) => f.e === 'checkout').d;
    const t2 = await rig({ env: ON, kids: Array.from({ length: 40 }, (_, i) => kid(String(100 + i), 'Cubbies', `Longer Namesake${i} Tester`)) });
    await t2.core.watcher.tick();
    const big = t2.sent.find((f) => f.e === 'checkout').d;
    expect(small.ct.length).toBe(Math.ceil((paddedSize('checkout', 40) + 16) / 3) * 4);   // the first rung, whatever the list
    expect(big.ct.length).toBeGreaterThanOrEqual(small.ct.length);
  });
});
