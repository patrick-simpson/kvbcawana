// The print queue (ROADMAP.md#online-check-in, P1/P4): LEASES, in Durable
// Object storage. A station leases a job for LEASE_MS, prints it, and says
// done; a lease that is not renewed (heartbeat) or finished goes back to the
// queue. Every job is sealed to the stations' keys (a bundle: the Worker
// never reads one), so the queue holds ciphertext, a random job id, the
// claim's tag and gen, and times. No clubber id, no name.
//
// WHICH JOBS MAY BE LEASED. A check-in job names its claim (tag + gen), and is
// leased only while that claim is `queued` at that very gen (ledger.js):
//   claim checking          not yet (the post to TwoTimTwo is still out)
//   claim undone, or gen
//   not the job's           the job is dead: dropped, never leased
//   claim printed           already done: dropped (never a second label)
// A reprint job (`reprint:<uuid>`) names no claim and bypasses all of that.
//
// IDEMPOTENT. done(jobId) twice is the same answer; done for a job that was
// dropped or purged is ok too (the label may already be out). failed() frees
// the job for another lease, up to MAX_FAILS, then it is `dead` and shows on
// the status. `already-spooled` (the station journalled the job and will not
// print it again) completes it and raises "check the printer".
//
// ATOMICITY. As in ledger.js: the queue lives in memory while the object runs
// and every check-and-set (lease, done, drop) is one synchronous step.
//
// A TwoTimTwo-page check-in has a `raw` body (sealState, the Worker's own key)
// until the stations' bundle is made (adopt.js seals one per tick, to stay
// inside the free plan's 10 ms of CPU); a job with no bundle is never leased.

import { Doc } from './doc.js';

export const LEASE_MS = 90 * 1000;
export const MAX_FAILS = 5;
/** A job older than this is not worth printing any more (the child went home). */
export const JOB_TTL_MS = 2 * 60 * 60 * 1000;
export const JOBS_MAX = 600;
export const LEASE_MAX = 10;
const JOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const REPRINT_ID_RE = /^reprint:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE_RE = /^[a-z0-9-]{1,32}$/;

/** Is this a job id the queue takes? A check-in job's id is its bundle's 22 characters. @param {unknown} id */
export function validJobId(id) {
  return typeof id === 'string' && (JOB_ID_RE.test(id) || REPRINT_ID_RE.test(id));
}

/**
 * @typedef {{ jobId: string, kind: 'checkin'|'reprint', night: string, tag: string|null, gen: number|null,
 *   bundle: any|null, raw: any|null, state: 'queued'|'leased'|'done'|'dead', leaseUntil: number,
 *   station: string|null, leases: number, fails: number, createdAt: number, doneAt?: number,
 *   result?: string, lastError?: string, checkPrinter?: boolean, greeted?: boolean }} Job
 */

/** @typedef {(night: string, tag: string) => { state: string, gen: number }|undefined} ClaimLookup */

export class PrintQueue {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   now: () => number }} deps
   */
  constructor({ storage, now }) {
    this.now = now;
    this.doc = new Doc(storage, 'printq', () => ({ jobs: {} }));
    /** What was dropped or expired since this object started: counts only. */
    this.dropped = { stale: 0, expired: 0 };
  }

  load() {
    return this.doc.load();
  }

  /** @returns {Record<string, Job>} (after load) */
  jobs() {
    return this.doc.data.jobs;
  }

  /**
   * Add a job. Idempotent by jobId: a retried POST finds the one already there.
   * @param {{ jobId: string, kind?: 'checkin'|'reprint', night: string, tag?: string|null, gen?: number|null,
   *   bundle?: any, raw?: any }} j
   * @returns {Promise<{ ok: true, existing: boolean } | { ok: false, reason: string }>}
   */
  async enqueue(j) {
    await this.load();
    const jobs = this.jobs();
    if (!validJobId(j.jobId)) return { ok: false, reason: 'bad-job-id' };
    const kind = j.kind === 'reprint' ? 'reprint' : 'checkin';
    if ((kind === 'reprint') !== REPRINT_ID_RE.test(j.jobId)) return { ok: false, reason: 'bad-job-id' };
    if (kind === 'checkin' && (!j.tag || !Number.isInteger(j.gen))) return { ok: false, reason: 'no-claim' };
    if (!j.bundle && !j.raw) return { ok: false, reason: 'unsealed' };
    if (jobs[j.jobId]) return { ok: true, existing: true };
    if (Object.keys(jobs).length >= JOBS_MAX) return { ok: false, reason: 'full' };
    jobs[j.jobId] = {
      jobId: j.jobId, kind, night: j.night, tag: kind === 'checkin' ? j.tag ?? null : null, gen: kind === 'checkin' ? j.gen ?? null : null,
      bundle: j.bundle || null, raw: j.bundle ? null : j.raw || null, state: 'queued', leaseUntil: 0, station: null,
      leases: 0, fails: 0, createdAt: this.now(),
    };
    await this.doc.save();
    return { ok: true, existing: false };
  }

  /**
   * May this job still print? 'wait' (its claim is still checking), 'dead'
   * (undone, another gen, already printed, too old) or 'ok'.
   * @param {Job} job @param {ClaimLookup} claim
   * @returns {'ok'|'wait'|'stale'|'expired'}
   */
  verdict(job, claim) {
    if (this.now() - job.createdAt > JOB_TTL_MS) return 'expired';
    if (job.kind === 'reprint') return 'ok';
    const c = job.tag ? claim(job.night, job.tag) : undefined;
    if (!c || c.gen !== job.gen || c.state === 'undone' || c.state === 'printed') return 'stale';
    return c.state === 'checking' ? 'wait' : 'ok';
  }

  /**
   * Lease up to `max` jobs to a station: sweeps expired leases back into the
   * queue, drops dead jobs, then leases oldest first. One synchronous step.
   * @param {string} station @param {number} max @param {ClaimLookup} claim
   * @returns {Promise<Job[]>}
   */
  async lease(station, max, claim) {
    await this.load();
    const out = this.leaseNow(station, max, claim);
    if (out.changed) await this.doc.save();
    return out.jobs;
  }

  /** The synchronous half of lease(). @param {string} station @param {number} max @param {ClaimLookup} claim */
  leaseNow(station, max, claim) {
    const t = this.now();
    const limit = Math.max(1, Math.min(LEASE_MAX, Math.floor(Number(max) || 1)));
    /** @type {Job[]} */
    const jobs = [];
    let changed = false;
    const ordered = Object.values(this.jobs()).sort((a, b) => a.createdAt - b.createdAt);
    for (const job of ordered) {
      if (job.state === 'done' || job.state === 'dead') continue;
      if (job.state === 'leased' && job.leaseUntil <= t) {
        job.state = 'queued';
        job.station = null;
        changed = true;
      }
      const v = this.verdict(job, claim);
      if (v === 'stale' || v === 'expired') {
        delete this.jobs()[job.jobId];
        this.dropped[v === 'stale' ? 'stale' : 'expired'] += 1;
        changed = true;
        continue;
      }
      if (job.state !== 'queued' || v === 'wait' || !job.bundle || jobs.length >= limit) continue;
      job.state = 'leased';
      job.station = station;
      job.leaseUntil = t + LEASE_MS;
      job.leases += 1;
      changed = true;
      jobs.push(job);
    }
    return { jobs: jobs.map(publicJob), changed };
  }

  /**
   * Keep a lease alive. ok with the new deadline; otherwise the reason the
   * station should stop: unknown (dropped, undone or purged), done, stale,
   * other (leased to a different station).
   * @param {string} jobId @param {string} station @param {ClaimLookup} claim
   * @returns {Promise<{ ok: true, leaseUntil: number } | { ok: false, reason: 'unknown'|'done'|'stale'|'other' }>}
   */
  async heartbeat(jobId, station, claim) {
    await this.load();
    const job = this.jobs()[jobId];
    if (!job) return { ok: false, reason: 'unknown' };
    if (job.state === 'done') return { ok: false, reason: 'done' };
    if (job.state === 'dead') return { ok: false, reason: 'stale' };
    const v = this.verdict(job, claim);
    if (v === 'stale' || v === 'expired') {
      delete this.jobs()[jobId];
      this.dropped[v === 'stale' ? 'stale' : 'expired'] += 1;
      await this.doc.save();
      return { ok: false, reason: 'unknown' };
    }
    const t = this.now();
    // Another station holds a live lease: this one lost it.
    if (job.state === 'leased' && job.station !== station && job.leaseUntil > t) return { ok: false, reason: 'other' };
    job.state = 'leased';
    job.station = station;
    job.leaseUntil = t + LEASE_MS;
    await this.doc.save();
    return { ok: true, leaseUntil: job.leaseUntil };
  }

  /**
   * The label is out. Idempotent: a job already done, or one that is gone
   * (undone, purged), answers ok. `already-spooled` raises "check the printer".
   * Returns the job's claim (tag, gen) so the caller can mark it printed.
   * @param {string} jobId @param {'printed'|'already-spooled'} [result]
   * @returns {Promise<{ ok: true, already: boolean, known: boolean, tag?: string|null, gen?: number|null, night?: string }>}
   */
  async done(jobId, result = 'printed') {
    await this.load();
    const job = this.jobs()[jobId];
    if (!job) return { ok: true, already: true, known: false };
    if (job.state === 'done') return { ok: true, already: true, known: true };
    job.state = 'done';
    job.doneAt = this.now();
    job.result = result === 'already-spooled' ? 'already-spooled' : 'printed';
    if (job.result === 'already-spooled') job.checkPrinter = true;
    job.bundle = null;
    job.raw = null;
    await this.doc.save();
    return { ok: true, already: false, known: true, tag: job.tag, gen: job.gen, night: job.night };
  }

  /**
   * The station could not print it: free it for another lease (the same
   * station may take it again), and after MAX_FAILS call it dead.
   * @param {string} jobId @param {unknown} [error] a short code
   */
  async failed(jobId, error) {
    await this.load();
    const job = this.jobs()[jobId];
    if (!job) return { ok: true, known: false };
    if (job.state === 'done' || job.state === 'dead') return { ok: true, known: true, state: job.state };
    job.fails += 1;
    job.lastError = typeof error === 'string' && CODE_RE.test(error) ? error : 'failed';
    job.station = null;
    job.leaseUntil = 0;
    job.state = job.fails >= MAX_FAILS ? 'dead' : 'queued';
    await this.doc.save();
    return { ok: true, known: true, state: job.state };
  }

  /**
   * ONE greeting per check-in job (P5, publisher.js gate): the station that
   * printed it may greet the child once. One synchronous step; a job that is
   * gone (undone, purged), another night's, a reprint's or already greeted
   * is refused with its reason.
   * `takeChild(tag)` (the publisher's once-per-child-per-night check) runs in the
   * same synchronous step: false means this child was already greeted tonight.
   * @param {string} jobId @param {string} night @param {(tag: string|null) => boolean} [takeChild]
   * @returns {Promise<{ ok: true } | { ok: false, reason: 'unknown-job'|'already-greeted'|'not-a-checkin' }>}
   */
  async greet(jobId, night, takeChild) {
    await this.load();
    const job = validJobId(jobId) ? this.jobs()[jobId] : undefined;
    if (!job || job.night !== night || job.state === 'dead') return { ok: false, reason: 'unknown-job' };
    if (job.kind !== 'checkin') return { ok: false, reason: 'not-a-checkin' };
    if (job.greeted) return { ok: false, reason: 'already-greeted' };
    if (takeChild && !takeChild(job.tag)) return { ok: false, reason: 'already-greeted' };
    job.greeted = true;
    await this.doc.save();
    return { ok: true };
  }

  /** Drop one job that was never leased to anyone useful (its check-in failed). @param {string} jobId */
  async dropJob(jobId) {
    await this.load();
    const job = this.jobs()[jobId];
    if (!job || job.state === 'done') return false;
    delete this.jobs()[jobId];
    await this.doc.save();
    return true;
  }

  /** An undo: drop every job of this claim that has not been printed. @param {string} tag */
  async dropForTag(tag) {
    await this.load();
    let n = 0;
    for (const job of Object.values(this.jobs())) {
      if (job.tag === tag && job.state !== 'done') { delete this.jobs()[job.jobId]; n += 1; }
    }
    if (n) await this.doc.save();
    return n;
  }

  /**
   * The stations' bundle for a job that was waiting for one (its raw body goes).
   * @param {string} jobId @param {any} bundle
   */
  async attach(jobId, bundle) {
    await this.load();
    const job = this.jobs()[jobId];
    if (!job || job.bundle || !bundle) return false;
    job.bundle = bundle;
    job.raw = null;
    await this.doc.save();
    return true;
  }

  /** Jobs still waiting for their stations' bundle (adopt.js seals them). */
  rawJobs() {
    return Object.values(this.jobs()).filter((j) => j.state === 'queued' && !j.bundle && j.raw).sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Counts for the status: never a tag, never a name. */
  async status() {
    await this.load();
    const c = { queued: 0, leased: 0, done: 0, dead: 0, waitingToSeal: 0 };
    /** @type {string[]} */
    const checkThePrinter = [];
    for (const j of Object.values(this.jobs())) {
      c[j.state] += 1;
      if (j.state === 'queued' && !j.bundle) c.waitingToSeal += 1;
      if (j.checkPrinter) checkThePrinter.push(j.jobId);
    }
    return { ...c, checkThePrinter, dropped: { ...this.dropped } };
  }

  /** The end of the night. */
  async purge() {
    await this.load();
    const n = Object.keys(this.jobs()).length;
    if (n) await this.doc.drop();
    return n;
  }
}

/** What a station is handed: the job without the Worker's own bookkeeping. @param {Job} j */
function publicJob(j) {
  return { jobId: j.jobId, kind: j.kind, night: j.night, gen: j.gen, bundle: j.bundle, leaseUntil: j.leaseUntil, attempt: j.leases };
}
