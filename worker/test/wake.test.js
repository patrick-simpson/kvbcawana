// The wake-up call (owner 2026-10-15): when a station could lease a label now, the
// Worker rings the print stations' sockets. printq.js readyCount, sync.js wakeStations
// and the places that call it (desk, reprint, alarm), over the online check-in rig.
import { describe, expect, it } from 'vitest';
import { PrintQueue } from '../src/printq.js';
import { Ledger, Tags } from '../src/ledger.js';
import { CHECKIN_PAGE } from './fixtures.js';
import { fakeClock, memoryStore } from './helpers.js';
import { NIGHT, rig } from './rig.js';

const FRAME = '{"e":"changed","d":{"what":"print"}}';
const idOf = (n) => `job${String(n).padStart(19, 'A')}`;
const REPRINT = 'reprint:123e4567-e89b-42d3-a456-426614174000';
const BUNDLE = { v: 1, id: 'x', night: NIGHT, kind: 'print-job', to: [{ kid: 'k', epk: 'e', iv: 'i', ct: 'c' }] };

describe('PrintQueue.readyCount', () => {
  function setup() {
    const clock = fakeClock();
    const storage = memoryStore();
    const ledger = new Ledger({ storage, now: clock.now });
    const q = new PrintQueue({ storage, now: clock.now });
    const tags = new Tags(() => 'right-pass');
    const lookup = (night, tag) => ledger.peek(night, tag);
    const job = async (clubberId, n, { settle = true, early = false } = {}) => {
      const tag = await tags.identity(NIGHT, clubberId);
      const c = await ledger.claim(NIGHT, tag);
      await q.enqueue({ jobId: idOf(n), night: NIGHT, tag, gen: c.gen, bundle: BUNDLE, early });
      if (settle) await ledger.settle(NIGHT, tag, c.gen, idOf(n));
      return { tag, gen: c.gen };
    };
    return { q, ledger, lookup, job };
  }

  it('is 0 for an empty queue', async () => {
    const { q, lookup } = setup();
    await q.load();
    expect(q.readyCount(lookup)).toBe(0);
  });

  it('counts a queued sealed job whose claim is queued', async () => {
    const { q, lookup, job } = setup();
    await job('1', 1);
    expect(q.readyCount(lookup)).toBe(1);
    await job('2', 2);
    expect(q.readyCount(lookup)).toBe(2);
  });

  it('does not count a non-early job whose claim is still checking', async () => {
    const { q, lookup, job } = setup();
    await job('1', 1, { settle: false });
    expect(q.readyCount(lookup)).toBe(0);
  });

  it('counts an early job while its claim is checking', async () => {
    const { q, lookup, job } = setup();
    await job('1', 1, { settle: false, early: true });
    expect(q.readyCount(lookup)).toBe(1);
  });

  it('does not count a dead (undone) job or a leased one', async () => {
    const { q, ledger, lookup, job } = setup();
    const a = await job('1', 1);
    await ledger.undo(NIGHT, a.tag);
    expect(q.readyCount(lookup)).toBe(0);
    await job('2', 2);
    expect(q.readyCount(lookup)).toBe(1);
    await q.lease('station-a', 5, lookup);
    expect(q.readyCount(lookup)).toBe(0);
  });

  it('counts a reprint with a bundle, not one with no bundle', async () => {
    const { q, lookup } = setup();
    await q.enqueue({ jobId: REPRINT, kind: 'reprint', night: NIGHT, raw: { some: 'thing' } });
    expect(q.readyCount(lookup)).toBe(0);
    await q.enqueue({ jobId: 'reprint:223e4567-e89b-42d3-a456-426614174000', kind: 'reprint', night: NIGHT, bundle: BUNDLE });
    expect(q.readyCount(lookup)).toBe(1);
  });
});

/** The rig with a spy where the stations' sockets would be. */
async function setup(opts) {
  const t = await rig(opts);
  const st = await t.station();
  const rings = [];
  t.core.ringStations = (text) => { rings.push(text); return 2; };
  const post = async (id, extra = {}) => t.call('POST', '/v1/desk/checkin', await t.deskBody([st], { clubberId: String(id), ...extra }));
  return { t, st, rings, post };
}

describe('the wake-up call', () => {
  it('a normal desk check-in rings the stations once, with the print frame', async () => {
    const { rings, post } = await setup();
    expect((await post(662)).body).toMatchObject({ ok: true });
    expect(rings).toEqual([FRAME]);
  });

  it('a check-in TwoTimTwo refuses (job dropped) does not ring', async () => {
    const { t, rings, post } = await setup();
    t.faults.checkin = 'refuse';
    expect((await post(662)).status).toBe(409);
    expect(rings).toEqual([]);
  });

  it('a reprint rings', async () => {
    const { t, rings, st } = await setup();
    const { job: bundle } = await t.deskBody([st]);
    const res = await t.call('POST', '/v1/print/reprint', { jobId: REPRINT, bundle });
    expect(res.body).toMatchObject({ ok: true });
    expect(rings).toEqual([FRAME]);
  });

  it('a refused reprint (400) does not ring', async () => {
    const { t, rings } = await setup();
    expect((await t.call('POST', '/v1/print/reprint', { jobId: 'nope', bundle: {} })).status).toBe(400);
    expect(rings).toEqual([]);
  });

  it('GET requests never ring, even with a label ready', async () => {
    const { t, st, rings, post } = await setup();
    await post(662);
    rings.length = 0;
    await t.call('GET', '/v1/print/status');
    expect((await st.call('GET', '/v1/print/next?max=10')).body.jobs).toHaveLength(1);
    expect(rings).toEqual([]);
  });

  it('wakeStations with nothing ready returns 0 and does not ring', async () => {
    const { t, rings } = await setup();
    expect(await t.core.wakeStations()).toBe(0);
    expect(rings).toEqual([]);
  });

  it('wakeStations with a label ready returns what ringStations sent', async () => {
    const { t, rings, post } = await setup();
    await post(662);
    rings.length = 0;
    expect(await t.core.wakeStations()).toBe(2);
    expect(rings).toEqual([FRAME]);
  });

  it('a throwing ringStations does not make wakeStations throw', async () => {
    const { t, post } = await setup();
    await post(662);
    t.core.ringStations = () => { throw new Error('socket gone'); };
    await expect(t.core.wakeStations()).resolves.toBe(0);
  });

  it('a throwing ringStations does not fail the desk request', async () => {
    const { t, st } = await setup();
    t.core.ringStations = () => { throw new Error('socket gone'); };
    const res = await t.call('POST', '/v1/desk/checkin', await t.deskBody([st]));
    expect(res.status).toBe(200);
  });

  it('the watcher alarm rings when a label is ready', async () => {
    const { t, rings, post } = await setup();
    await post(662);
    rings.length = 0;
    await t.core.alarm();
    expect(rings).toEqual([FRAME]);
  });
});

describe('the wake-up call for an early label', () => {
  const CHILDREN = Array.from({ length: 9 }, (_, i) => i + 1);
  const PAGE = CHECKIN_PAGE.replace(
    /<div class="clubber checkin-box boy" recid="662"[\s\S]*?<div class="clubber checkin-box girl checked-in" recid="663"[^>]*>.*?<\/div><\/div>/,
    CHILDREN.map((id) => `<div class="clubber checkin-box boy" recid="${id}" club_id="2"><div class="name">Kit Tester</div>` +
      '<div class="club"><img class="club-icon-16" alt="Sparks "></div></div>').join(''),
  );

  it('rings before the held TwoTimTwo post is released', async () => {
    const { t, st, rings, post } = await setup({ checkinPage: () => PAGE });
    // Warm up: three fine posts after a slow first one make the desk healthy (early.test.js).
    await post(9);
    for (let i = 1; i <= 3; i++) expect((await post(i)).body).toMatchObject({ ok: true });
    expect(t.core.desk.healthy()).toBe(true);
    rings.length = 0;

    let release;
    let reached;
    const gate = new Promise((r) => { release = r; });
    const out = new Promise((r) => { reached = r; });
    t.on.checkin = async () => { t.on.checkin = null; reached(); await gate; };
    const pending = post(4);
    await out;   // the post is out and still pending
    expect(rings).toEqual([FRAME]);
    release();
    expect((await pending).body).toMatchObject({ ok: true });
    // the handler's own wake-up call comes after (a label is still ready: not yet leased)
    expect(rings.every((r) => r === FRAME)).toBe(true);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    expect(st).toBeTruthy();
  });
});
