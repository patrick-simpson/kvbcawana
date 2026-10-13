// The print lease queue (printq.js), with the claims it answers to (ledger.js).
import { describe, expect, it } from 'vitest';
import { JOB_TTL_MS, LEASE_MS, MAX_FAILS, PrintQueue, validJobId } from '../src/printq.js';
import { Ledger, Tags } from '../src/ledger.js';
import { fakeClock, memoryStore, everything } from './helpers.js';
import { leaks } from './noleak.js';

const NIGHT = '2026-10-14';
const idOf = (n) => `job${String(n).padStart(19, 'A')}`;           // 22 characters
const REPRINT = 'reprint:123e4567-e89b-42d3-a456-426614174000';
const BUNDLE = { v: 1, id: 'x', night: NIGHT, kind: 'print-job', to: [{ kid: 'k', epk: 'e', iv: 'i', ct: 'c' }] };

function setup() {
  const clock = fakeClock();
  const storage = memoryStore();
  const ledger = new Ledger({ storage, now: clock.now });
  const q = new PrintQueue({ storage, now: clock.now });
  const tags = new Tags(() => 'right-pass');
  const lookup = (night, tag) => ledger.peek(night, tag);
  /** A desk check-in's whole path: claim, job, settle. */
  const checkIn = async (clubberId, n = Number(clubberId)) => {
    const tag = await tags.identity(NIGHT, clubberId);
    const c = await ledger.claim(NIGHT, tag);
    await q.enqueue({ jobId: idOf(n), night: NIGHT, tag, gen: c.gen, bundle: BUNDLE });
    await ledger.settle(NIGHT, tag, c.gen, idOf(n));
    return { tag, gen: c.gen, jobId: idOf(n) };
  };
  return { clock, storage, ledger, q, tags, lookup, checkIn };
}

describe('job ids', () => {
  it('are 22 base64url characters, or reprint:<uuid>', () => {
    expect(validJobId(idOf(1))).toBe(true);
    expect(validJobId(REPRINT)).toBe(true);
    expect(validJobId('reprint:nope')).toBe(false);
    expect(validJobId('short')).toBe(false);
    expect(validJobId(7)).toBe(false);
  });
});

describe('leasing', () => {
  it('leases a queued claim\'s job, 90 s, and not twice', async () => {
    const { q, lookup, checkIn, clock } = setup();
    const j = await checkIn('662');
    const got = await q.lease('station-a', 5, lookup);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ jobId: j.jobId, kind: 'checkin', gen: 1, leaseUntil: clock.t + LEASE_MS, attempt: 1 });
    expect(got[0].bundle).toEqual(BUNDLE);
    expect(await q.lease('station-b', 5, lookup)).toEqual([]);
  });

  it('waits while the claim is still checking, then leases it once settled', async () => {
    const { q, ledger, tags, lookup } = setup();
    const tag = await tags.identity(NIGHT, '662');
    const c = await ledger.claim(NIGHT, tag);
    await q.enqueue({ jobId: idOf(1), night: NIGHT, tag, gen: c.gen, bundle: BUNDLE });
    expect(await q.lease('a', 1, lookup)).toEqual([]);
    expect((await q.status()).queued).toBe(1);
    await ledger.settle(NIGHT, tag, c.gen, idOf(1));
    expect(await q.lease('a', 1, lookup)).toHaveLength(1);
  });

  it('drops a job whose claim was undone, or released, or is on another gen, or already printed', async () => {
    const { q, ledger, lookup, checkIn, tags } = setup();
    const undone = await checkIn('1');
    await ledger.undo(NIGHT, undone.tag);
    const stale = await checkIn('2');
    await ledger.undo(NIGHT, stale.tag);
    await ledger.claim(NIGHT, stale.tag, { initial: 'queued' });   // gen 3 now; the job is gen 1
    const printed = await checkIn('3');
    await ledger.markPrinted(NIGHT, printed.tag, 1);
    const tag4 = await tags.identity(NIGHT, '4');
    const c4 = await ledger.claim(NIGHT, tag4);
    await q.enqueue({ jobId: idOf(4), night: NIGHT, tag: tag4, gen: c4.gen, bundle: BUNDLE });
    await ledger.release(NIGHT, tag4, c4.gen);
    expect(await q.lease('a', 10, lookup)).toEqual([]);
    expect(await q.status()).toMatchObject({ queued: 0, leased: 0, dropped: { stale: 4 } });
  });

  it('leases oldest first, at most max, never more than 10', async () => {
    const { q, lookup, checkIn, clock } = setup();
    for (let i = 1; i <= 12; i++) { await checkIn(String(i)); clock.tick(1); }
    const first = await q.lease('a', 3, lookup);
    expect(first.map((j) => j.jobId)).toEqual([idOf(1), idOf(2), idOf(3)]);
    expect(await q.lease('a', 99, lookup)).toHaveLength(9);
  });

  it('never leases a job that has no bundle yet (raw, waiting to be sealed)', async () => {
    const { q, ledger, tags, lookup } = setup();
    const tag = await tags.identity(NIGHT, '662');
    await ledger.claim(NIGHT, tag, { source: 'ttt', initial: 'queued' });
    await q.enqueue({ jobId: idOf(1), night: NIGHT, tag, gen: 1, raw: { v: 1, iv: 'a', ct: 'b' } });
    expect(await q.lease('a', 1, lookup)).toEqual([]);
    expect(await q.status()).toMatchObject({ queued: 1, waitingToSeal: 1 });
    expect(q.rawJobs()).toHaveLength(1);
  });

  it('a reprint job bypasses the claims entirely', async () => {
    const { q, lookup } = setup();
    expect(await q.enqueue({ jobId: REPRINT, kind: 'reprint', night: NIGHT, bundle: BUNDLE })).toEqual({ ok: true, existing: false });
    expect(await q.lease('a', 1, lookup)).toHaveLength(1);
  });

  it('refuses a malformed job and keeps enqueue idempotent', async () => {
    const { q, ledger, tags } = setup();
    const tag = await tags.identity(NIGHT, '1');
    const c = await ledger.claim(NIGHT, tag);
    expect((await q.enqueue({ jobId: 'nope', night: NIGHT, tag, gen: 1, bundle: BUNDLE })).ok).toBe(false);
    expect((await q.enqueue({ jobId: idOf(1), night: NIGHT, tag, gen: c.gen })).reason).toBe('unsealed');
    expect((await q.enqueue({ jobId: idOf(1), night: NIGHT, bundle: BUNDLE })).reason).toBe('no-claim');
    expect((await q.enqueue({ jobId: REPRINT, night: NIGHT, bundle: BUNDLE })).reason).toBe('bad-job-id');
    expect(await q.enqueue({ jobId: idOf(1), night: NIGHT, tag, gen: c.gen, bundle: BUNDLE })).toEqual({ ok: true, existing: false });
    expect(await q.enqueue({ jobId: idOf(1), night: NIGHT, tag, gen: c.gen, bundle: BUNDLE })).toEqual({ ok: true, existing: true });
  });

  it('two stations asking at once: each job goes to exactly one (interleaving)', async () => {
    const { q, lookup, checkIn } = setup();
    for (let i = 1; i <= 6; i++) await checkIn(String(i));
    const [a, b, c] = await Promise.all([q.lease('a', 4, lookup), q.lease('b', 4, lookup), q.lease('c', 4, lookup)]);
    const ids = [...a, ...b, ...c].map((j) => j.jobId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});

describe('lease life', () => {
  it('goes back to the queue when the lease runs out, and another station may take it', async () => {
    const { q, lookup, checkIn, clock } = setup();
    await checkIn('662');
    await q.lease('a', 1, lookup);
    clock.tick(LEASE_MS - 1);
    expect(await q.lease('b', 1, lookup)).toEqual([]);
    clock.tick(1);
    const again = await q.lease('b', 1, lookup);
    expect(again).toHaveLength(1);
    expect(again[0].attempt).toBe(2);
  });

  it('a heartbeat renews it; another station cannot renew it', async () => {
    const { q, lookup, checkIn, clock } = setup();
    const j = await checkIn('662');
    await q.lease('a', 1, lookup);
    clock.tick(60000);
    expect(await q.heartbeat(j.jobId, 'a', lookup)).toEqual({ ok: true, leaseUntil: clock.t + LEASE_MS });
    expect(await q.heartbeat(j.jobId, 'b', lookup)).toEqual({ ok: false, reason: 'other' });
    clock.tick(LEASE_MS - 1);
    expect(await q.lease('b', 1, lookup)).toEqual([]);
    expect(await q.heartbeat('nope0000000000000000AA', 'a', lookup)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('a heartbeat for a job whose claim was undone says stop (unknown) and drops it', async () => {
    const { q, ledger, lookup, checkIn } = setup();
    const j = await checkIn('662');
    await q.lease('a', 1, lookup);
    await ledger.undo(NIGHT, j.tag);
    expect(await q.heartbeat(j.jobId, 'a', lookup)).toEqual({ ok: false, reason: 'unknown' });
    expect((await q.status()).leased).toBe(0);
  });

  it('a job older than two hours is dropped, not printed', async () => {
    const { q, lookup, checkIn, clock } = setup();
    await checkIn('662');
    clock.tick(JOB_TTL_MS + 1);
    expect(await q.lease('a', 1, lookup)).toEqual([]);
    expect((await q.status()).dropped.expired).toBe(1);
  });
});

describe('done and failed', () => {
  it('done is idempotent, and gives back the claim to mark printed', async () => {
    const { q, lookup, checkIn } = setup();
    const j = await checkIn('662');
    await q.lease('a', 1, lookup);
    expect(await q.done(j.jobId)).toEqual({ ok: true, already: false, known: true, tag: j.tag, gen: 1, night: NIGHT });
    expect(await q.done(j.jobId)).toEqual({ ok: true, already: true, known: true });
    expect(await q.heartbeat(j.jobId, 'a', lookup)).toEqual({ ok: false, reason: 'done' });
    expect(await q.lease('b', 1, lookup)).toEqual([]);
    expect((await q.status()).done).toBe(1);
  });

  it('done for a job that is gone (undone, purged) is still ok', async () => {
    const { q } = setup();
    expect(await q.done(idOf(9))).toEqual({ ok: true, already: true, known: false });
  });

  it('already-spooled completes it and raises check the printer', async () => {
    const { q, lookup, checkIn } = setup();
    const j = await checkIn('662');
    await q.lease('a', 1, lookup);
    await q.done(j.jobId, 'already-spooled');
    expect((await q.status()).checkThePrinter).toEqual([j.jobId]);
  });

  it('failed frees the job for another lease; after five it is dead', async () => {
    const { q, lookup, checkIn } = setup();
    const j = await checkIn('662');
    for (let i = 1; i < MAX_FAILS; i++) {
      expect(await q.lease('a', 1, lookup)).toHaveLength(1);
      expect(await q.failed(j.jobId, 'printer-offline')).toMatchObject({ ok: true, state: 'queued' });
    }
    await q.lease('a', 1, lookup);
    expect(await q.failed(j.jobId, 'Printer says: "boom" (name Ava)')).toMatchObject({ state: 'dead' });
    expect(await q.lease('a', 1, lookup)).toEqual([]);
    expect(await q.status()).toMatchObject({ dead: 1 });
    expect(leaks(everythingIn(q), ['Ava'])).toEqual([]);
  });

  it('an undo drops an unprinted job but leaves a done one', async () => {
    const { q, lookup, checkIn } = setup();
    const a = await checkIn('1');
    const b = await checkIn('2');
    await q.lease('x', 1, lookup);
    await q.done(a.jobId);
    expect(await q.dropForTag(a.tag)).toBe(0);
    expect(await q.dropForTag(b.tag)).toBe(1);
  });
});

const everythingIn = (q) => JSON.stringify(q.doc.data);

describe('storage and restarts', () => {
  it('holds ciphertext, ids and times only', async () => {
    const { storage, checkIn } = setup();
    await checkIn('662', 1);
    expect(leaks(everything(storage), ['662'])).toEqual([]);
    expect(leaks(everything(storage), ['name', 'ava', 'right-pass'], { ignoreCase: true })).toEqual([]);
  });

  it('a restarted object (new instance over the same storage) keeps a lease and a done', async () => {
    const { storage, clock, q, lookup, checkIn, ledger } = setup();
    const a = await checkIn('1');
    const b = await checkIn('2');
    await q.lease('s', 1, lookup);                 // a is leased
    await q.done(b.jobId);                         // (b done out of order)
    const q2 = new PrintQueue({ storage, now: clock.now });
    const ledger2 = new Ledger({ storage, now: clock.now });
    await ledger2.load();
    const lookup2 = (night, tag) => ledger2.peek(night, tag);
    expect(await q2.lease('other', 5, lookup2)).toEqual([]);          // a's lease survives, b is done
    expect(await q2.done(b.jobId)).toMatchObject({ already: true });
    expect(await q2.heartbeat(a.jobId, 's', lookup2)).toMatchObject({ ok: true });
    void ledger;
  });

  it('is purged at the end of the night', async () => {
    const { q, checkIn, storage } = setup();
    await checkIn('1');
    expect(await q.purge()).toBe(1);
    expect((await q.status()).queued).toBe(0);
    expect(storage.map.has('printq')).toBe(false);
  });
});
