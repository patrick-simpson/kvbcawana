// The watcher's P4 rules (adopt.js): children newly on TwoTimTwo's report get a
// claim and a print job sealed in the Worker; children gone are undone; the
// work per alarm tick stays inside the free plan's 10 ms of CPU.
import { describe, expect, it } from 'vitest';
import { generateKeyPair, openAsStation, sealForStations } from '../../shared/cloud-crypto.js';
import { SEAL_PER_TICK, SPILL_MS, WATCH_INTERVAL_MS } from '../src/watcher.js';
import { everything } from './helpers.js';
import { NIGHT, kid, rig } from './rig.js';

/** Move the clock, then let the alarm run once. */
const step = async (t, ms) => { t.clock.tick(ms); await t.core.watcher.tick(); };
/** The report is read: the watcher's next read is due. */
const readReport = (t) => step(t, WATCH_INTERVAL_MS);
const leased = async (st) => (await st.call('GET', '/v1/print/next?max=10')).body.jobs;

async function night({ env, kids = [kid(1)], stations = 1 } = {}) {
  const t = await rig({ env, kids });
  const sts = [];
  for (let i = 0; i < stations; i++) sts.push(await t.station(`station-${'abcdefgh'[i].repeat(8)}`, `Laptop ${i + 1}`));
  await t.core.watcher.tick();                 // the baseline: kid 1 is already here
  return { t, sts };
}

describe('a check-in made on TwoTimTwo\'s own page', () => {
  it('is claimed (source ttt) and its job sealed to the stations in the Worker, then leased and opened', async () => {
    const { t, sts } = await night({ stations: 2 });
    t.night.kids.push(kid(2, 'Cubbies', 'Ada Uniquename'));
    await readReport(t);
    expect(await t.core.adopt.pending()).toBe(1);
    await step(t, SPILL_MS);                   // the next tick seals it
    expect(t.core.adopt.pending()).toBe(0);
    const jobs = await leased(sts[0]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: 'checkin', gen: 1 });
    // sealed to BOTH stations, each opens it
    for (const st of sts) {
      expect(await openAsStation(st.ring, jobs[0].bundle)).toEqual({ clubberId: '2', name: 'Ada Uniquename', club: 'Cubbies', source: 'ttt' });
    }
    expect((await t.call('GET', '/v1/print/status')).body.claims).toMatchObject({ queued: 1 });
    await sts[0].call('POST', '/v1/print/done', { jobId: jobs[0].jobId });
    expect((await t.call('GET', '/v1/print/status')).body.claims).toMatchObject({ printed: 1, queued: 0 });
  });

  it('the children already there when the watcher starts (the baseline) are never printed', async () => {
    const { t, sts } = await night({ kids: [kid(1), kid(2), kid(3)] });
    await step(t, SPILL_MS);
    expect(await leased(sts[0])).toEqual([]);
    expect(t.core.adopt.pending()).toBe(0);
  });

  it('a burst is spilled: ONE job sealed per tick, the next tick a second later, never a pile in one invocation', async () => {
    const { t, sts } = await night({ stations: 3 });
    expect(SEAL_PER_TICK).toBe(1);
    for (let i = 2; i <= 6; i++) t.night.kids.push(kid(i));
    await readReport(t);
    expect(t.core.adopt.pending()).toBe(5);
    expect(t.alarm.at - t.clock.t).toBeLessThanOrEqual(SPILL_MS);        // the alarm comes back at once, not in 10 s
    let queued = 0;
    for (let ticks = 0; ticks < 8 && queued < 5; ticks++) {
      await step(t, SPILL_MS);        // (one tick may be the once-a-night check-in page read instead)
      const now = (await t.call('GET', '/v1/print/status')).body.queued;
      expect(now - queued).toBeLessThanOrEqual(1);                              // never more than one more per tick
      queued = now;
    }
    expect(queued).toBe(5);
    expect(t.core.adopt.pending()).toBe(0);
    expect((await leased(sts[0]))).toHaveLength(5);
  });

  it('a request that leases seals at most one waiting job first (the same cap)', async () => {
    const { t, sts } = await night();
    for (let i = 2; i <= 4; i++) t.night.kids.push(kid(i));
    await readReport(t);
    expect(t.core.adopt.pending()).toBe(3);
    const first = await leased(sts[0]);                                   // seals one, then leases what is ready
    expect(first).toHaveLength(1);
    expect(t.core.adopt.pending()).toBe(2);
  });

  it('with no station registered the job waits sealed under the Worker\'s key, and is sealed when one registers', async () => {
    const { t } = await night({ stations: 0 });
    t.night.kids.push(kid(2, 'Sparks', 'Zed Uniquename'));
    await readReport(t);
    await step(t, SPILL_MS);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 1, waitingToSeal: 1 });
    expect(everything(t.storage)).not.toMatch(/Uniquename/);
    const st = await t.station();
    expect(await leased(st)).toHaveLength(1);                             // the request seals it (one per request)
    const jobs = (await st.call('GET', '/v1/print/status')).body;
    expect(jobs.waitingToSeal).toBe(0);
  });

  it('a child the desk is still checking in (claim checking) is promoted, not printed twice', async () => {
    const { t, sts } = await night();
    // the desk's post went through but its answer is lost: the claim is `checking`, its job stored
    const body = await t.deskBody(sts, { clubberId: '2' });
    const tag = await t.core.tags.identity(NIGHT, '2');
    const c = await t.core.ledger.claim(NIGHT, tag);
    await t.core.printq.enqueue({ jobId: body.job.id, night: NIGHT, tag, gen: c.gen, bundle: body.job });
    expect(await leased(sts[0])).toEqual([]);                            // checking: not leasable
    t.night.kids.push(kid(2));
    await readReport(t);                                                  // it is on the report
    expect(t.core.adopt.pending()).toBe(0);                               // promoted, not adopted again
    expect((await leased(sts[0])).map((j) => j.jobId)).toEqual([body.job.id]);
  });

  it('a child already queued or printed by the desk is not adopted again', async () => {
    const { t, sts } = await night();
    await t.call('POST', '/v1/desk/checkin', await t.deskBody(sts, { clubberId: '662' }));
    t.night.kids.push(kid(662));
    await readReport(t);
    await step(t, SPILL_MS);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 1 });
    expect((await leased(sts[0]))).toHaveLength(1);
  });

  it('a child gone from the report is undone: gen + 1, the unprinted job dropped, never leased', async () => {
    const { t, sts } = await night();
    t.night.kids.push(kid(2));
    await readReport(t);
    await step(t, SPILL_MS);
    expect((await t.call('GET', '/v1/print/status')).body.claims).toMatchObject({ queued: 1 });
    t.night.kids = t.night.kids.filter((k) => k.id !== 2);
    await readReport(t);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 0, claims: { queued: 0, undone: 1 } });
    expect(await leased(sts[0])).toEqual([]);
    // and when they come back (checked in again on TwoTimTwo), a new gen prints again
    t.night.kids.push(kid(2));
    await readReport(t);
    await step(t, SPILL_MS);
    const again = await leased(sts[0]);
    expect(again).toHaveLength(1);
    expect(again[0].gen).toBe(3);                                         // 1, undone -> 2, re-check-in -> 3
  });

  it('is switched by CLOUD_PRINT: off makes no job from a report (claims still follow the desk)', async () => {
    const { t, sts } = await night({ env: { CLOUD_PRINT: 'off' } });
    t.night.kids.push(kid(2));
    await readReport(t);
    await step(t, SPILL_MS);
    expect(t.core.adopt.pending()).toBe(0);
    expect((await t.call('GET', '/v1/print/status')).body).toMatchObject({ queued: 0, cloudPrint: false });
    expect(await leased(sts[0])).toEqual([]);
  });

  it('a partial or refused report adopts and undoes nothing', async () => {
    const { t, sts } = await night({ kids: [kid(1), kid(2), kid(3), kid(4)] });
    t.night.kids = [kid(1)];                                              // would drop more than half: refused
    await readReport(t);
    t.night.kids = [kid(1), kid(2), kid(3), kid(4), kid(5)];
    t.night.count = 9;
    await readReport(t);
    expect(t.core.adopt.pending()).toBe(0);
    expect(await leased(sts[0])).toEqual([]);
  });
});

describe('the night ends', () => {
  it('claims, jobs and the waiting children are forgotten once the window has closed', async () => {
    const { t, sts } = await night();
    t.night.kids.push(kid(2), kid(3));
    await readReport(t);
    await step(t, SPILL_MS);
    expect((await t.call('GET', '/v1/print/status')).body.claims.queued).toBe(1);
    expect(t.core.adopt.pending()).toBe(1);
    t.clock.tick(4 * 60 * 60 * 1000);                                      // past 9 pm
    await t.core.watcher.tick();
    const status = (await t.call('GET', '/v1/print/status')).body;
    expect(status).toMatchObject({ queued: 0, done: 0, pendingToSeal: 0, claims: { queued: 0 } });
    expect(JSON.stringify([...t.storage.map.keys()].filter((k) => k === 'ledger' || k === 'printq').map((k) => t.storage.map.get(k)))).not.toMatch(/"state"/);
    expect(await leased(sts[0])).toEqual([]);
  });
});

describe('a restart in the middle of a burst', () => {
  it('keeps the waiting children (sealed) and the claims; the next tick carries on', async () => {
    const { t, sts } = await night();
    t.night.kids.push(kid(2, 'Sparks', 'Zed Uniquename'), kid(3, 'Sparks', 'Yan Uniquename'));
    await readReport(t);
    await step(t, SPILL_MS);                                               // one of two sealed
    expect(everything(t.storage)).not.toMatch(/Uniquename|"2"|"3"/);
    t.restart();
    expect(await (async () => { await t.core.adopt.load(); return t.core.adopt.pending(); })()).toBe(1);
    await step(t, SPILL_MS);
    const jobs = await leased(sts[0]);
    expect(jobs).toHaveLength(2);
    const names = [];
    for (const j of jobs) names.push((await openAsStation(sts[0].ring, j.bundle)).name);
    expect(names.sort()).toEqual(['Yan Uniquename', 'Zed Uniquename']);
  });
});

describe('the free plan\'s 10 ms of CPU', () => {
  it('sealing one print job to 3 stations stays under it (Node: an upper bound on the Worker)', async () => {
    const stations = [];
    for (let i = 0; i < 3; i++) stations.push({ publicKey: (await generateKeyPair()).publicKey });
    const record = { clubberId: '662', name: 'Maximiliana Wolfeschlegel-Uniquename', club: 'Trek', source: 'ttt' };
    await sealForStations(stations, { id: 'A'.repeat(22), night: NIGHT, kind: 'print-job', record });   // warm up
    const runs = [];
    for (let i = 0; i < 15; i++) {
      const t0 = performance.now();
      await sealForStations(stations, { id: 'A'.repeat(22), night: NIGHT, kind: 'print-job', record });
      runs.push(performance.now() - t0);
    }
    runs.sort((a, b) => a - b);
    const median = runs[7];
    console.warn(`sealing one job to 3 stations: median ${median.toFixed(2)} ms over 15 runs (limit 10 ms CPU per invocation)`);
    expect(median).toBeLessThan(10);
    // ...and the code never seals more than SEAL_PER_TICK in one invocation
    expect(SEAL_PER_TICK).toBeLessThanOrEqual(1);
  });

  it('drain() never does more than SEAL_PER_TICK however many it is asked for', async () => {
    const { t } = await night({ stations: 3 });
    for (let i = 2; i <= 8; i++) t.night.kids.push(kid(i));
    await readReport(t);
    await t.core.adopt.load();
    expect(await t.core.adopt.drain(50)).toBe(SEAL_PER_TICK);
    expect(t.core.adopt.pending()).toBe(6);
  });
});
