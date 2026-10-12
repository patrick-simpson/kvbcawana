// What the watcher does with the report (ROADMAP.md#online-check-in, P4):
// children newly on TwoTimTwo's report get a claim and a print job; children
// gone from it are undone. The watcher calls onReport() after each APPLIED
// read (never a partial or refused one) and drain() on its spare ticks.
//
// THE RULES
//   newly on the report, claim `checking`   the desk's post went through and
//                                           its answer was lost: promoted to
//                                           `queued` (its job was stored with
//                                           the claim, so it prints)
//   newly on the report, no claim (or an    a check-in made on TwoTimTwo's
//   undone one)                             own page: claim source `ttt`
//                                           (gen + 1 over an undone one), and
//                                           a print job sealed in the Worker
//   gone from the report, claim queued or   undone on TwoTimTwo: claim undone
//   printed                                 with a gen bump, its unprinted job
//                                           dropped
//
// THE FREE PLAN'S 10 ms OF CPU. Sealing a job to the stations is one ECDH per
// station (measured ~4.2 ms for 3 stations under Node), so onReport() only
// does the cheap part (an HMAC per child, a lookup) and puts each child to
// adopt on a BACKLOG, sealed under the Worker's state key because it holds
// the name; drain() adopts at most SEAL_PER_TICK of them per alarm tick (or
// per request) and the watcher asks for another tick SPILL_MS later while
// any remain. A burst of ten check-ins on TwoTimTwo's page is ten seconds of
// ticks, not one 40 ms invocation. test/adopt.test.js measures the seal.
//
// NO STATION YET: the job is kept with its record under the same state key
// (`raw`) and is never leased; drain() seals it once a station registers.
// The Worker holds the names only in memory and under that key; storage holds
// no plaintext clubber id or name.
//
// Switched by the CLOUD_PRINT variable (wrangler.toml, "off" until the shadow
// night): while it is off no job is made on a report. The promotion and the
// undo rules above need no switch (they only touch claims the desk made).

import { newRowId, sealForStations } from '../../shared/cloud-crypto.js';
import { Doc } from './doc.js';
import { openState, sealState, SEAL_PER_TICK } from './watcher.js';

/**
 * The record a TwoTimTwo-page job carries, exactly what the print role runs
 * (printer/print-server/job-puller.js, routes.md section 6): the print route and
 * its own JSON body, the child, the claim's generation and where it came from.
 * @param {{ id: string, name: string, club: string }} e @param {number} gen
 */
export function printRecord(e, gen) {
  return {
    route: '/print',
    body: { name: e.name, ...(e.club ? { clubName: e.club } : {}), clubberId: e.id },
    clubberId: e.id,
    gen,
    source: 'ttt',
  };
}

/** The most children one read may add to the backlog (a runaway report cannot fill storage). */
export const BACKLOG_MAX = 200;
export const PRINT_JOB_KIND = 'print-job';

export class Adopter {
  /**
   * @param {{ ledger: import('./ledger.js').Ledger, printq: import('./printq.js').PrintQueue,
   *   stations: import('./stations.js').Stations, tags: import('./ledger.js').Tags,
   *   secret: () => string|null|undefined, env: Record<string, any>, now: () => number,
   *   storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   log?: (line: string) => void }} deps
   */
  constructor({ ledger, printq, stations, tags, secret, env, now, storage, log }) {
    this.ledger = ledger;
    this.printq = printq;
    this.stations = stations;
    this.tags = tags;
    this.secret = secret;
    this.env = env;
    this.now = now;
    this.log = log || ((line) => console.warn(line));
    /** The children waiting to be adopted: {sealed} is the stored form. */
    this.backlogDoc = new Doc(storage, 'adopt:backlog', () => ({ sealed: null }));
    /** In memory, authoritative while the object runs. @type {{ tag: string, id: string, name: string, club: string, night: string }[]|null} */
    this.entries = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
  }

  /** CLOUD_PRINT=on makes jobs for TwoTimTwo-page check-ins. */
  get on() {
    return String(this.env.CLOUD_PRINT || '').trim().toLowerCase() === 'on';
  }

  load() {
    if (!this.loading) {
      this.loading = (async () => {
        await Promise.all([this.ledger.load(), this.printq.load(), this.stations.load(), this.backlogDoc.load()]);
        const secret = this.secret();
        const stored = secret ? await openState(secret, this.backlogDoc.data.sealed) : null;
        if (this.entries === null) this.entries = Array.isArray(stored) ? stored : [];
      })();
    }
    return this.loading;
  }

  /** Children waiting to be adopted plus jobs waiting for a station's bundle (after load). */
  pending() {
    if (!this.on || this.entries === null) return 0;
    return this.entries.length + (this.stations.all().length ? this.printq.rawJobs().length : 0);
  }

  async saveBacklog() {
    const secret = this.secret();
    if (!secret || this.entries === null) return;
    this.backlogDoc.data.sealed = this.entries.length ? await sealState(secret, this.entries) : null;
    await this.backlogDoc.save();
  }

  /**
   * An applied read. Cheap: an HMAC per child, no sealing.
   * @param {{ night: string, added: { clubberId: string, name: string, club: string }[], gone: string[] }} r
   */
  async onReport({ night, added, gone }) {
    await this.load();
    let backlogChanged = false;
    for (const e of added.slice(0, BACKLOG_MAX)) {
      const tag = await this.tags.identity(night, e.clubberId);
      if (!tag) continue;
      const c = this.ledger.peek(night, tag);
      if (c && c.state === 'checking') { await this.ledger.promote(night, tag); continue; }
      if (c && c.state !== 'undone') continue;       // queued or printed: already ours
      if (!this.on) continue;
      if (this.entries?.some((x) => x.tag === tag && x.night === night)) continue;
      // A name no print server could print is not worth a label (the report's own rule).
      if (!e.name) continue;
      this.entries?.push({ tag, id: e.clubberId, name: e.name, club: e.club, night });
      backlogChanged = true;
    }
    for (const id of gone) {
      const tag = await this.tags.identity(night, id);
      if (!tag) continue;
      const c = this.ledger.peek(night, tag);
      if (!c || (c.state !== 'queued' && c.state !== 'printed')) continue;
      await this.ledger.undo(night, tag);
      await this.printq.dropForTag(tag);
      // ...and it must not be adopted from the backlog either.
      if (this.entries) {
        const before = this.entries.length;
        this.entries = this.entries.filter((x) => !(x.tag === tag && x.night === night));
        backlogChanged = backlogChanged || this.entries.length !== before;
      }
    }
    if (backlogChanged) await this.saveBacklog();
  }

  /**
   * Adopt at most SEAL_PER_TICK waiting children / jobs: the work one alarm
   * tick (or one request) may do. @param {number} [max]
   * @returns {Promise<number>} how many it did
   */
  async drain(max = SEAL_PER_TICK) {
    if (!this.on) return 0;
    await this.load();
    const limit = Math.max(1, Math.min(Math.floor(max) || 1, SEAL_PER_TICK));
    let done = 0;
    while (done < limit) {
      const raw = this.stations.all().length ? this.printq.rawJobs()[0] : null;
      if (raw) {
        await this.sealRaw(raw);
        done += 1;
        continue;
      }
      const e = this.entries?.shift();
      if (!e) break;
      await this.saveBacklog();
      await this.adopt(e);
      done += 1;
    }
    return done;
  }

  /** One child: claim, then a job (sealed to the stations, or kept raw until one exists). @param {{ tag: string, id: string, name: string, club: string, night: string }} e */
  async adopt(e) {
    const jobId = newRowId();
    const c = await this.ledger.claim(e.night, e.tag, { source: 'ttt', initial: 'queued', jobId });
    if (!c.ok) return 'already';
    const record = printRecord(e, c.gen);
    const targets = this.stations.sealTargets();
    if (targets.length) {
      const bundle = await sealForStations(targets, { id: jobId, night: e.night, kind: PRINT_JOB_KIND, record });
      if (!bundle) {
        // Fail closed: nothing is queued that a station could not read.
        await this.ledger.undo(e.night, e.tag);
        this.log('[cloud] could not seal a print job to the stations; the claim was released');
        return 'seal-failed';
      }
      await this.printq.enqueue({ jobId, night: e.night, tag: e.tag, gen: c.gen, bundle });
      return 'queued';
    }
    const secret = this.secret();
    if (!secret) return 'no-secret';
    await this.printq.enqueue({ jobId, night: e.night, tag: e.tag, gen: c.gen, raw: await sealState(secret, { record }) });
    return 'waiting';
  }

  /** A job made before any station existed: open its record and seal it now. @param {import('./printq.js').Job} job */
  async sealRaw(job) {
    const secret = this.secret();
    const opened = secret ? await openState(secret, job.raw) : null;
    if (!opened || !opened.record) {
      // Unreadable (the secret changed): it cannot be sealed, so it cannot print.
      await this.printq.failed(job.jobId, 'unreadable');
      return false;
    }
    const bundle = await sealForStations(this.stations.sealTargets(), { id: job.jobId, night: job.night, kind: PRINT_JOB_KIND, record: opened.record });
    if (!bundle) return false;
    return this.printq.attach(job.jobId, bundle);
  }

  /** The window has closed: every claim, job and waiting child of the night is forgotten. */
  async endOfNight() {
    await this.load();
    const had = this.printq.rawJobs().length + (this.entries?.length || 0);
    const purged = (await this.ledger.purge(null)) + (await this.printq.purge()) + had;
    if (this.entries?.length) {
      this.entries = [];
      await this.saveBacklog();
    }
    return purged;
  }
}
