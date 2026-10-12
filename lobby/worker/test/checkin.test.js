// Online check-in, Worker core: stations, the print lease, the desk's claim
// API and the read clock, end to end through SyncCore.handle().
import { describe, expect, it } from 'vitest';
import { openAsStation } from '../../shared/cloud-crypto.js';
import { Registry } from '../src/registry.js';
import { LEASE_MS } from '../src/printq.js';
import { everything } from './helpers.js';
import { HOUSEHOLD_CSV } from './fixtures.js';
import { NIGHT, kid, rig, row } from './rig.js';

const minGap = (reads) => reads.slice(1).reduce((m, r, i) => Math.min(m, r.at - reads[i].at), Infinity);

describe('the route registry', () => {
  it('takes a route once, checks its auth level and its path', async () => {
    const r = new Registry();
    r.add('GET', '/v1/x/:id', 'session', async () => new Response('ok'));
    expect(() => r.add('GET', '/v1/x/:id', 'session', async () => new Response('again'))).toThrow(/already registered/);
    expect(() => r.add('GET', '/v1/y', 'nobody', async () => new Response(''))).toThrow(/auth/);
    expect(() => r.add('GET', '/elsewhere', 'public', async () => new Response(''))).toThrow(/under \/v1/);
    expect(r.match('GET', '/v1/x/a%20b').params).toEqual({ id: 'a b' });
    expect(r.match('POST', '/v1/x/1')).toBeNull();
    expect(r.match('GET', '/v1/x/%E0%A4%A')).toBeNull();
    expect(r.match('GET', '/v1/x/1/2')).toBeNull();
  });

  it('SyncCore registers the check-in routes, none twice', async () => {
    const t = await rig();
    expect(t.core.registry.list()).toEqual(expect.arrayContaining([
      'POST /v1/station/register session', 'GET /v1/stations session', 'DELETE /v1/stations/:id session',
      'GET /v1/print/next station', 'POST /v1/print/done station', 'POST /v1/print/failed station', 'POST /v1/print/heartbeat station',
      'GET /v1/print/status session', 'POST /v1/desk/checkin session', 'POST /v1/desk/undo session', 'POST /v1/desk/checkout session',
    ]));
  });
});

describe('stations over HTTP', () => {
  it('register and list need a session; a station route needs a registered station', async () => {
    const t = await rig();
    const anon = await t.core.handle(new Request('https://sync.test/v1/stations'));
    expect(anon.status).toBe(401);
    const st = await t.station();
    const list = await t.call('GET', '/v1/stations');
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ stationId: st.body.stationId, pub: st.pub, kid: st.kid });
    expect((await t.call('GET', '/v1/print/next')).status).toBe(403);
    expect((await t.call('GET', '/v1/print/next', undefined, { 'X-Station': 'station-nope0000' })).status).toBe(403);
    expect((await st.call('GET', '/v1/print/next')).status).toBe(200);
    // the same station may replace its own key
    const again = await t.call('POST', '/v1/station/register', { ...st.body, name: 'Renamed' });
    expect(again.body.stations).toHaveLength(1);
  });

  it('revoke removes a dead computer, and its calls stop', async () => {
    const t = await rig();
    const a = await t.station('station-aaaaaaaa');
    await t.station('station-bbbbbbbb');
    expect((await t.call('DELETE', '/v1/stations/station-aaaaaaaa')).body).toEqual({ ok: true, stations: 1 });
    expect((await a.call('GET', '/v1/print/next')).status).toBe(403);
    expect((await t.call('DELETE', '/v1/stations/station-aaaaaaaa')).status).toBe(404);
  });

  it('a heartbeat records the printer for the status', async () => {
    const t = await rig();
    const st = await t.station();
    await st.call('POST', '/v1/print/heartbeat', { printer: { state: 'paper', detail: 'Out of labels' } });
    const status = (await t.call('GET', '/v1/print/status')).body;
    expect(status.stations[0]).toMatchObject({ stationId: st.body.stationId, printer: { state: 'paper', detail: 'Out of labels' } });
    expect(status.stations[0].lastSeenAt).toBeTruthy();
  });
});

describe('the desk check-in', () => {
  it('claims, posts to TwoTimTwo, queues a job a station leases, opens, prints and completes', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    const res = await t.call('POST', '/v1/desk/checkin', body);
    expect(res.body).toMatchObject({ ok: true, already: false, jobId: body.job.id, gen: 1 });
    expect(t.tt.checkins).toHaveLength(1);
    expect(t.tt.checkins[0].get('clubber_id')).toBe('662');
    expect(t.tt.checkins[0].getAll('events[]')).toEqual(['40']);

    const leased = (await st.call('GET', '/v1/print/next')).body;
    expect(leased.jobs).toHaveLength(1);
    expect(leased.jobs[0]).toMatchObject({ jobId: body.job.id, kind: 'checkin', gen: 1, leaseUntil: t.clock.t + LEASE_MS });
    expect(await openAsStation(st.ring, leased.jobs[0].bundle)).toEqual({ name: 'sealed' });
    // nobody else gets it while it is leased
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);

    expect((await st.call('POST', '/v1/print/done', { jobId: body.job.id })).body).toMatchObject({ ok: true, already: false });
    expect((await st.call('POST', '/v1/print/done', { jobId: body.job.id })).body).toMatchObject({ ok: true, already: true });
    const status = (await t.call('GET', '/v1/print/status')).body;
    expect(status).toMatchObject({ done: 1, queued: 0, leased: 0, claims: { printed: 1 } });
    // a second check-in of the same child: nothing is posted twice
    const again = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(again.body).toMatchObject({ ok: true, already: true, state: 'printed' });
    expect(t.tt.checkins).toHaveLength(1);
  });

  it('Bible and Brought a friend go only when ticked (items as an object or a list)', async () => {
    const t = await rig();
    const st = await t.station();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { items: { Bible: true } }));
    expect(t.tt.checkins[0].getAll('events[]')).toEqual(expect.arrayContaining(['40', '707']));
  });

  it('fails closed: no sealed history row writes nothing at all', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    const before = everything(t.storage);
    for (const bad of [{ historyRow: undefined }, { historyRow: { ...row(), ct: 'AAAA' } }, { historyRow: row('checkin', '2026-10-21') }]) {
      const res = await t.call('POST', '/v1/desk/checkin', { ...body, ...bad });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('unsealed');
    }
    expect(t.tt.checkins).toHaveLength(0);
    expect(t.tt.calls.filter((c) => c.path === '/clubber/checkin')).toHaveLength(0);
    expect(everything(t.storage)).toBe(before);
  });

  it('fails closed: stations registered and no job, or a job missing a station, writes nothing', async () => {
    const t = await rig();
    const a = await t.station('station-aaaaaaaa');
    const b = await t.station('station-bbbbbbbb');
    const noJob = await t.call('POST', '/v1/desk/checkin', { ...(await t.deskBody([a, b])), job: null });
    expect(noJob).toMatchObject({ status: 400, body: { reason: 'unsealed' } });
    const stale = await t.call('POST', '/v1/desk/checkin', await t.deskBody([a]));
    expect(stale.status).toBe(409);
    expect(stale.body.reason).toBe('stations-changed');
    expect(stale.body.stations).toHaveLength(2);
    expect(t.tt.checkins).toHaveLength(0);
    expect((await t.call('GET', '/v1/print/status')).body.claims).toEqual({ checking: 0, queued: 0, printed: 0, undone: 0 });
  });

  it('with no station registered it still checks in (nothing to print yet)', async () => {
    const t = await rig();
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([]));
    expect(res.body).toMatchObject({ ok: true, jobId: null });
    expect(t.tt.checkins).toHaveLength(1);
  });

  it('a child TwoTimTwo already has is a success, and posts nothing', async () => {
    const t = await rig();
    const st = await t.station();
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: '663' }));
    expect(res.body).toMatchObject({ ok: true, already: false });
    expect(t.tt.checkins).toHaveLength(0);
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
  });

  it('a timeout is ambiguous: the claim is released and the job dropped; a retry works (gen 2)', async () => {
    const t = await rig();
    const st = await t.station();
    t.faults.checkin = 'timeout';
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(res).toMatchObject({ status: 504, body: { ok: false, reason: 'unsure', retry: true } });
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 0, claims: { undone: 1 } });
    t.faults.checkin = null;
    const retry = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(retry.body).toMatchObject({ ok: true, gen: 2 });
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
  });

  it('a refusal from TwoTimTwo releases the claim and answers why', async () => {
    const t = await rig();
    const st = await t.station();
    t.faults.checkin = 'refuse';
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(res).toMatchObject({ status: 409, body: { ok: false, reason: 'checkin-refused' } });
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 0, claims: { undone: 1 } });
  });

  it('an unknown child is not found, and a night that is not tonight is refused', async () => {
    const t = await rig();
    const st = await t.station();
    expect(await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: '99999' }))).toMatchObject({ status: 409, body: { reason: 'not-found' } });
    expect(await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { night: '2026-10-21' }))).toMatchObject({ status: 400, body: { reason: 'wrong-night' } });
    expect(await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: undefined }))).toMatchObject({ status: 400, body: { reason: 'no-child' } });
  });

  it('two desks checking the same child in at once: one post, one claim', async () => {
    const t = await rig();
    const st = await t.station();
    const [a, b] = await Promise.all([
      t.call('POST', '/v1/desk/checkin', await t.deskBody([st])),
      t.call('POST', '/v1/desk/checkin', await t.deskBody([st])),
    ]);
    const wins = [a, b].filter((r) => r.body.already === false);
    expect(wins).toHaveLength(1);
    expect([a, b].filter((r) => r.body.already === true)).toHaveLength(1);
    expect(t.tt.checkins).toHaveLength(1);
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
  });

  it('a visitor with no clubber id is claimed and printed, never posted to TwoTimTwo', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st], { clubberId: undefined, visitor: { first: 'Zed', last: 'Visitor', club: 'Sparks' } });
    expect((await t.call('POST', '/v1/desk/checkin', body)).body).toMatchObject({ ok: true });
    expect(t.tt.checkins).toHaveLength(0);
    // the same visitor, spelled differently, is the same claim
    const again = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: undefined, visitor: { first: 'zed', last: ' VISITOR ', club: 'sparks' } }));
    expect(again.body).toMatchObject({ already: true });
    expect(everything(t.storage)).not.toMatch(/zed|visitor/i);
  });

  it('hooks (history, tally) hear every check-in, undo and check-out; a failing hook fails nothing', async () => {
    const t = await rig();
    const st = await t.station();
    const heard = [];
    t.core.desk.hooks.afterCheckin.push((e) => { heard.push(['in', e.club, e.gen]); });
    t.core.desk.hooks.afterCheckin.push(() => { throw new Error('d1 down'); });
    t.core.desk.hooks.afterUndo.push(() => { heard.push(['undo']); });
    t.core.desk.hooks.afterCheckout.push(() => { heard.push(['out']); });
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(res.body).toMatchObject({ ok: true, history: 'hooked' });
    await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') });
    await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '662', historyRow: row('checkout') });
    expect(heard).toEqual([['in', 'Sparks', 1], ['undo'], ['out']]);
  });
});

describe('undo and check-out', () => {
  it('undo posts to TwoTimTwo, drops the claim and an unprinted job; checking in again is a new gen with a new job', async () => {
    const t = await rig();
    const st = await t.station();
    const first = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', first);
    const undo = await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') });
    expect(undo.body).toEqual({ ok: true, droppedJobs: 1 });
    expect(t.posts.undo).toHaveLength(1);
    expect(t.posts.undo[0].get('clubber_id')).toBe('662');
    expect(t.posts.undo[0].get('calendar_id')).toBe('368');
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
    const second = await t.deskBody([st]);
    const again = await t.call('POST', '/v1/desk/checkin', second);
    expect(again.body).toMatchObject({ ok: true, already: false, gen: 3 });   // undo bumped to 2, the re-check-in to 3
    const jobs = (await st.call('GET', '/v1/print/next')).body.jobs;
    expect(jobs.map((j) => j.jobId)).toEqual([second.job.id]);
  });

  it('a job already leased when the child is undone is dropped: its heartbeat says stop', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', body);
    await st.call('GET', '/v1/print/next');
    await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') });
    expect((await st.call('POST', '/v1/print/heartbeat', { jobId: body.job.id })).body).toEqual({ ok: false, reason: 'unknown' });
    // the label may already be out: a late done is still fine, and marks nothing printed
    expect((await st.call('POST', '/v1/print/done', { jobId: body.job.id })).body).toMatchObject({ ok: true });
    expect((await t.call('GET', '/v1/print/status')).body.claims).toMatchObject({ printed: 0, undone: 1 });
  });

  it('an undo TwoTimTwo refuses changes nothing here; a timeout is unsure and changes nothing', async () => {
    const t = await rig();
    const st = await t.station();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    t.faults.undo = 'refuse';
    expect((await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).status).toBe(409);
    t.faults.undo = 'timeout';
    expect((await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') })).status).toBe(504);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 1, claims: { queued: 1 } });
  });

  it('check-out posts to TwoTimTwo and leaves the claim', async () => {
    const t = await rig();
    const st = await t.station();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    const res = await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '662', historyRow: row('checkout') });
    expect(res.body).toEqual({ ok: true });
    expect(t.posts.checkout[0].get('clubber_id')).toBe('662');
    expect((await t.call('GET', '/v1/print/status')).body.claims.queued).toBe(1);
    expect((await t.call('POST', '/v1/desk/checkout', { night: NIGHT, clubberId: '662' })).status).toBe(400);
  });
});

describe('the print lease over HTTP', () => {
  it('a lease runs out after 90 s and another station may take the job; failed frees it at once', async () => {
    const t = await rig();
    const a = await t.station('station-aaaaaaaa');
    const b = await t.station('station-bbbbbbbb');
    const body = await t.deskBody([a, b]);
    await t.call('POST', '/v1/desk/checkin', body);
    expect((await a.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
    expect((await b.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
    t.clock.tick(LEASE_MS);
    expect((await b.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
    expect((await b.call('POST', '/v1/print/failed', { jobId: body.job.id, error: 'printer-offline' })).body).toMatchObject({ ok: true, state: 'queued' });
    expect((await a.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
  });

  it('a heartbeat with the job id keeps the lease', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', body);
    await st.call('GET', '/v1/print/next');
    t.clock.tick(60000);
    const hb = await st.call('POST', '/v1/print/heartbeat', { jobId: body.job.id });
    expect(hb.body).toEqual({ ok: true, leaseUntil: t.clock.t + LEASE_MS });
    t.clock.tick(LEASE_MS - 1);
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
  });

  it('already-spooled completes the job and raises check the printer', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', body);
    await st.call('GET', '/v1/print/next');
    const res = await st.call('POST', '/v1/print/done', { jobId: body.job.id, result: 'already-spooled' });
    expect(res.body).toMatchObject({ ok: true, checkThePrinter: true });
    expect((await t.call('GET', '/v1/print/status')).body.checkThePrinter).toEqual([body.job.id]);
    expect((await st.call('POST', '/v1/print/done', { jobId: body.job.id, result: 'who-knows' })).status).toBe(400);
  });

  it('the first-draft names (lease, ack, hello) are gone: one set of routes', async () => {
    const t = await rig();
    const st = await t.station();
    for (const p of ['/v1/print/lease', '/v1/print/ack', '/v1/print/hello']) {
      expect((await st.call('POST', p, { max: 1 })).status).toBe(404);
    }
  });

  it('a heartbeat with the jobId extends the 90 s lease, and the lease is 90 s', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', body);
    const next = await st.call('GET', '/v1/print/next');
    expect(next.body.leaseMs).toBe(90000);
    const until = next.body.jobs[0].leaseUntil;
    t.clock.tick(60000);
    const beat = await st.call('POST', '/v1/print/heartbeat', { jobId: body.job.id, printer: { state: 'busy', detail: 'printing' } });
    expect(beat.body.ok).toBe(true);
    expect(beat.body.leaseUntil).toBe(until + 60000);
    t.clock.tick(60000);   // 120 s after the lease began: alive only because of the heartbeat
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
    t.clock.tick(91000);   // never renewed again: back in the queue
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toHaveLength(1);
  });

  it('a reprint bypasses the claims, and needs a bundle sealed to every station', async () => {
    const t = await rig();
    const st = await t.station();
    const { job: bundle } = await t.deskBody([st]);
    const jobId = 'reprint:123e4567-e89b-42d3-a456-426614174000';
    expect((await t.call('POST', '/v1/print/reprint', { jobId: 'nope', bundle })).status).toBe(400);
    expect((await t.call('POST', '/v1/print/reprint', { jobId, bundle: { ...bundle, to: [] } })).status).toBe(400);
    expect((await t.call('POST', '/v1/print/reprint', { jobId, bundle })).body).toMatchObject({ ok: true, existing: false });
    const jobs = (await st.call('GET', '/v1/print/next')).body.jobs;
    expect(jobs).toMatchObject([{ jobId, kind: 'reprint' }]);
    // no claim exists for it, and finishing it touches none
    expect((await st.call('POST', '/v1/print/done', { jobId })).body).toMatchObject({ ok: true });
  });
});

describe('what storage holds', () => {
  it('no plaintext clubber id, no name, no password: tags, ciphertext and times', async () => {
    const t = await rig();
    const st = await t.station();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    await t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: undefined, visitor: { first: 'Zed', last: 'Uniquename', club: 'Sparks' } }));
    const all = everything(t.storage);
    expect(all).not.toMatch(/Uniquename|Kit Tester|Kit|right-pass|checkin@example/);
    expect(all).not.toMatch(/"clubberId"|"662"/);
    expect(all).toContain('"ledger"');
  });
});

describe('a restart (a new object over the same storage)', () => {
  it('keeps the claims, the leases and the read clock', async () => {
    const t = await rig();
    const st = await t.station();
    const body = await t.deskBody([st]);
    await t.call('POST', '/v1/desk/checkin', body);
    await st.call('GET', '/v1/print/next');                       // leased
    t.restart();
    // the claim survives: no second post, the same job
    const again = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(again.body).toMatchObject({ already: true, state: 'queued', jobId: body.job.id });
    expect(t.tt.checkins).toHaveLength(1);
    // the lease survives: not leased twice
    expect((await st.call('GET', '/v1/print/next')).body.jobs).toEqual([]);
    expect((await st.call('POST', '/v1/print/heartbeat', { jobId: body.job.id })).body).toMatchObject({ ok: true });
    // and the read clock: the first check-in read the page; a read right after the
    // restart (a fresh object has no cached page) waits out the rest of the 5 s
    const before = t.reads.at(-1).at;
    await t.call('GET', '/v1/desk/roster');
    expect(t.reads.at(-1).at - before).toBeGreaterThanOrEqual(5000);
    expect(minGap(t.reads)).toBeGreaterThanOrEqual(5000);
  });
});

describe('every TwoTimTwo read, of every kind, keeps the 5 s clock', () => {
  it('desk check-ins, the roster, undo, the watcher and a phone roster interleaved', async () => {
    const t = await rig({ kids: [kid(1), kid(2)] });
    const st = await t.station();
    await t.core.watcher.tick();
    await Promise.all([
      t.call('POST', '/v1/desk/checkin', await t.deskBody([st])),
      t.call('GET', '/v1/desk/roster'),
      t.call('POST', '/v1/relay', { method: 'POST', path: '/phone/tonight' }),
    ]);
    t.clock.tick(10000);
    await t.core.watcher.tick();
    await t.call('POST', '/v1/desk/undo', { night: NIGHT, clubberId: '662', historyRow: row('undo') });
    await t.call('GET', '/v1/desk/roster');
    t.clock.tick(10000);
    await t.core.watcher.tick();
    expect(t.reads.length).toBeGreaterThanOrEqual(4);
    expect(minGap(t.reads)).toBeGreaterThanOrEqual(5000);
    expect(t.core.watcher.budget.stats().taken).toMatchObject({ watcher: expect.any(Number), desk: expect.any(Number) });
  });

  it('the desk roster answers from its last read when the clock is not ready, or 429 with nothing', async () => {
    const t = await rig();
    const first = await t.call('GET', '/v1/desk/roster');
    expect(first.body.kids).toEqual([
      { clubberId: '662', first: 'Kit', last: 'Tester', club: 'Sparks', clubId: '2', checkedIn: false },
      { clubberId: '663', first: 'Lu', last: 'Tester', club: '', clubId: '3', checkedIn: true },
    ]);
    expect(first.body.readAt).toBe(new Date(t.clock.t).toISOString());
    const second = await t.call('GET', '/v1/desk/roster');   // within 5 s: the same read, no new page
    expect(second.body.readAt).toBe(first.body.readAt);
    expect(t.reads.filter((r) => r.path === '/clubber/checkin')).toHaveLength(1);
    // the clock booked solid (a long queue): 429 with when to ask again
    const t2 = await rig();
    for (let i = 0; i < 4; i++) t2.core.watcher.budget.claim(60000);
    const busy = await t2.call('GET', '/v1/desk/roster');
    expect(busy.status).toBe(429);
    expect(busy.body.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('the desk page\'s items and families', () => {
  it('the roster says which clubs offer Bible and Brought a friend, from the page it already read', async () => {
    const t = await rig();
    const got = await t.call('GET', '/v1/desk/roster');
    expect(got.body.items).toEqual({ bible: expect.arrayContaining(['Sparks', 'T&T', 'Trek']), friend: [] });
    expect(t.reads.filter((r) => r.path === '/household/csv')).toHaveLength(0);
  });

  it('families are the household export, names only, read once per half hour through the clock', async () => {
    const t = await rig({ households: () => HOUSEHOLD_CSV });
    const a = await t.call('GET', '/v1/desk/families');
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ households: [['Sophie Tester', 'Cal Tester'], ['Ann Smith', 'Ben Smith', 'Cy Smith']] });
    expect(JSON.stringify(a.body)).not.toMatch(/Elm St|555-/);
    await t.call('GET', '/v1/desk/families');
    expect(t.reads.filter((r) => r.path === '/household/csv')).toHaveLength(1);
    t.clock.tick(31 * 60 * 1000);
    await t.call('GET', '/v1/desk/families');
    expect(t.reads.filter((r) => r.path === '/household/csv')).toHaveLength(2);
    expect(minGap(t.reads)).toBeGreaterThanOrEqual(5000);
  });

  it('an unreadable export is an empty list with a fixed code, kept five minutes; a busy clock is a 429 and not kept', async () => {
    const t = await rig();   // the stand-in has no household export
    const a = await t.call('GET', '/v1/desk/families');
    expect(a.status).toBe(200);
    expect(a.body.households).toEqual([]);
    expect(a.body.familiesError).toEqual(expect.any(String));
    const before = t.reads.length;
    await t.call('GET', '/v1/desk/families');
    expect(t.reads.length).toBe(before);
    const t2 = await rig({ households: () => HOUSEHOLD_CSV });
    for (let i = 0; i < 4; i++) t2.core.watcher.budget.claim(60000);
    const busy = await t2.call('GET', '/v1/desk/families');
    expect(busy.status).toBe(429);
    expect(busy.body.reason).toBe('read-busy');
  });

  it('families need a session', async () => {
    const t = await rig();
    expect((await t.core.handle(new Request('https://sync.test/v1/desk/families'))).status).toBe(401);
  });
});
