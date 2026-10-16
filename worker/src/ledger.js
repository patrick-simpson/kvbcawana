// The night's claims (ROADMAP.md#online-check-in, P1): who has been checked in
// tonight, so a child is never checked in or printed twice, whichever door
// they came through (our desk page, a phone, TwoTimTwo's own page seen by the
// watcher).
//
// A claim is keyed by the child's identifier TAG, never the clubber id:
// identityTag(stateKey, night, clubberId) for a child on TwoTimTwo,
// visitorTag(stateKey, night, name, club) for a visitor with no id (both are
// HMACs from shared/cloud-crypto.js; the key is derived from the TwoTimTwo
// password secret, which never reaches storage). So a copy of the Durable
// Object's storage holds no clubber id and no name. A claim body that needs
// one (a TwoTimTwo-page check-in waiting to be sealed to the stations) is
// sealState()'d in the print queue, not here.
//
//   checking  a check-in is being posted to TwoTimTwo. Lasts CHECKING_TTL_MS;
//             when the child shows up on the report meanwhile (our response
//             was lost), promote() makes it queued. After the TTL the next
//             claim takes over (gen + 1), so the old attempt can never settle.
//   queued    TwoTimTwo has the check-in; its print job may be leased.
//   printed   a station reported the label done.
//   undone    undone at the desk, or gone from TwoTimTwo's report, or a
//             check-in that failed or timed out and was released.
//
// `gen` counts check-ins of one child in one night. It only goes up: undoing
// (or the child vanishing from the report) bumps it, and so does checking the
// child in again. A print job carries the gen it was made for; a job whose gen
// is not the claim's, or whose claim is undone, is never leased (printq.js).
//
// ATOMICITY. The Durable Object is one instance, so the claims live in memory
// while it runs and every check-and-set below is ONE SYNCHRONOUS STEP: there
// is no await (and so no fetch) between the check and the write. Callers do the
// slow thing (the TwoTimTwo post) after `claim` and settle or release after
// it, naming the gen they got. Storage is written through after each change
// and loaded once on first use, so a restarted object carries on.
//
// A night is the church's LOCAL date (churchNight). Claims are purged at the
// end of the night (the watcher, once the window has closed).

import { identityTag, visitorTag } from '../../shared/cloud-crypto.js';
import { Doc } from './doc.js';

export const CHECKING_TTL_MS = 60 * 1000;
export const STATES = Object.freeze(['checking', 'queued', 'printed', 'undone']);
/** A night is a few hundred children; more claims than this is a bug, not a Wednesday. */
export const CLAIMS_MAX = 2000;

const enc = new TextEncoder();
/** @type {Map<string, Uint8Array>} */
const keyCache = new Map();

/**
 * The tag key: HKDF-SHA256 of the TwoTimTwo password secret, 32 bytes. Held
 * in memory, never stored. @param {string} secret
 */
export async function tagKey(secret) {
  const hit = keyCache.get(secret);
  if (hit) return hit;
  const base = await crypto.subtle.importKey('raw', enc.encode(secret), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('kvbc-awana-cloud-checkin'), info: enc.encode('claim-tag-v1') },
    base, 256,
  );
  const key = new Uint8Array(bits);
  if (keyCache.size > 4) keyCache.clear();
  keyCache.set(secret, key);
  return key;
}

/** Makes the tags. `secret` is a function so a changed secret is picked up. */
export class Tags {
  /** @param {() => string|null|undefined} secret */
  constructor(secret) {
    this.secret = secret;
  }

  /** @param {string} night @param {string|number} clubberId @returns {Promise<string|null>} */
  async identity(night, clubberId) {
    const s = this.secret();
    return s ? identityTag(await tagKey(s), night, clubberId) : null;
  }

  /** @param {string} night @param {string} name @param {string} club @returns {Promise<string|null>} */
  async visitor(night, name, club) {
    const s = this.secret();
    return s ? visitorTag(await tagKey(s), night, name, club) : null;
  }
}

/**
 * @typedef {{ state: 'checking'|'queued'|'printed'|'undone', gen: number, source: string,
 *   at: number, until?: number, jobId?: string, printedEarly?: boolean,
 *   recheck?: { bible: boolean, friend?: boolean, early?: boolean } }} Claim
 */

export class Ledger {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   now: () => number }} deps
   */
  constructor({ storage, now }) {
    this.now = now;
    this.doc = new Doc(storage, 'ledger', () => ({ night: null, claims: {} }));
  }

  /** Load the stored copy (once). Every public call below does it first. */
  load() {
    return this.doc.load();
  }

  /**
   * The claims of this night, in memory. Switching to another night forgets the
   * last one's (the end-of-night purge, in case the watcher never ran it).
   * @param {string} night
   */
  claims(night) {
    const d = this.doc.data;
    if (d.night !== night) {
      d.night = night;
      d.claims = {};
    }
    return /** @type {Record<string, Claim>} */ (d.claims);
  }

  /** @param {string} night @param {string} tag @returns {Claim|undefined} (call after load) */
  peek(night, tag) {
    return this.doc.data.night === night ? this.doc.data.claims[tag] : undefined;
  }

  /**
   * Take a child for this night. One synchronous check-and-set.
   *   ok        a fresh claim in `checking` (or `queued` when `initial` says
   *             TwoTimTwo already has it), with the `gen` to settle or release by
   *   already   someone holds it: its state (and job id) to answer with
   * @param {string} night @param {string} tag
   * @param {{ source?: string, initial?: 'checking'|'queued', jobId?: string }} [opts]
   * @returns {Promise<{ ok: true, gen: number, regen: boolean } | { ok: false, already: true, state: string, gen: number, jobId?: string }>}
   */
  async claim(night, tag, opts = {}) {
    await this.load();
    const r = this.claimNow(night, tag, opts);
    if (r.ok) await this.doc.save();
    return r;
  }

  /** The synchronous half of claim(): no await anywhere in it. @param {string} night @param {string} tag @param {{ source?: string, initial?: 'checking'|'queued', jobId?: string }} opts */
  claimNow(night, tag, opts = {}) {
    const claims = this.claims(night);
    const t = this.now();
    const c = claims[tag];
    const initial = opts.initial === 'queued' ? 'queued' : 'checking';
    const fresh = (/** @type {number} */ gen) => ({
      state: initial, gen, source: opts.source || 'desk', at: t,
      ...(initial === 'checking' ? { until: t + CHECKING_TTL_MS } : {}), ...(opts.jobId ? { jobId: opts.jobId } : {}),
    });
    if (!c) {
      if (Object.keys(claims).length >= CLAIMS_MAX) return /** @type {const} */ ({ ok: false, already: true, state: 'full', gen: 0 });
      claims[tag] = fresh(1);
      return { ok: /** @type {const} */ (true), gen: 1, regen: false };
    }
    const expired = c.state === 'checking' && (c.until || 0) <= t;
    if (c.state === 'undone' || expired) {
      claims[tag] = fresh(c.gen + 1);
      return { ok: /** @type {const} */ (true), gen: c.gen + 1, regen: true };
    }
    return /** @type {const} */ ({ ok: false, already: true, state: c.state, gen: c.gen, ...(c.jobId ? { jobId: c.jobId } : {}) });
  }

  /**
   * TwoTimTwo took the check-in: checking -> queued. Only the attempt that
   * holds `gen` can settle. @param {string} night @param {string} tag @param {number} gen @param {string} [jobId]
   */
  async settle(night, tag, gen, jobId) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.state !== 'checking' || c.gen !== gen) return { ok: false, reason: c ? c.state : 'none' };
    // An early label (printq `early`) may already be out: then it is printed, not queued.
    c.state = c.printedEarly ? 'printed' : 'queued';
    delete c.until;
    delete c.printedEarly;
    if (jobId) c.jobId = jobId;
    await this.doc.save();
    return { ok: true };
  }

  /**
   * The post failed or its outcome is unknown: let go. The claim goes to
   * `undone` at the same gen (never deleted, so the gen never repeats and any
   * job made for it is dead), and the next attempt takes gen + 1.
   * @param {string} night @param {string} tag @param {number} gen
   */
  async release(night, tag, gen) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.state !== 'checking' || c.gen !== gen) return { ok: false };
    c.state = 'undone';
    delete c.until;
    delete c.printedEarly;
    await this.doc.save();
    return { ok: true };
  }

  /**
   * The child is on TwoTimTwo's report while a claim is still `checking`
   * (the post went through and the answer was lost): it is queued after all.
   * @param {string} night @param {string} tag
   */
  async promote(night, tag) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.state !== 'checking') return false;
    c.state = c.printedEarly ? 'printed' : 'queued';
    delete c.until;
    delete c.printedEarly;
    await this.doc.save();
    return true;
  }

  /** A station printed it: queued -> printed, if the job's gen is still the claim's. @param {string} night @param {string} tag @param {number} gen */
  async markPrinted(night, tag, gen) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.gen !== gen) return false;
    // An early label printed while the post to TwoTimTwo is still out: remembered,
    // so the settle (or the keep for a re-check-in) makes it printed.
    if (c.state === 'checking') { c.printedEarly = true; await this.doc.save(); return false; }
    if (c.state !== 'queued') return false;
    c.state = 'printed';
    await this.doc.save();
    return true;
  }

  /**
   * An early label is (or may be) out but TwoTimTwo did not take the check-in
   * (desk.js, owner 2026-10-15): the claim stays LIVE (queued, or printed when
   * the label is known out) and carries `recheck` with the child's items, so
   * nothing prints a second label, nothing adopts or undoes them, and the
   * desk's next tap on them is the post alone. Only the attempt holding `gen`.
   * @param {string} night @param {string} tag @param {number} gen
   * @param {{ bible: boolean, friend: boolean }} items @param {string} [jobId]
   */
  async keepForRecheck(night, tag, gen, items, jobId) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.state !== 'checking' || c.gen !== gen) return false;
    c.state = c.printedEarly ? 'printed' : 'queued';
    delete c.until;
    delete c.printedEarly;
    if (jobId) c.jobId = jobId;
    c.recheck = { bible: !!items.bible, friend: !!items.friend, early: true };
    await this.doc.save();
    return true;
  }

  /**
   * Undone (at the desk, or gone from the report): any live claim -> undone,
   * gen + 1, so every job made before it is dead. A claim that is already
   * undone is left alone (no churn). @param {string} night @param {string} tag
   * @returns {Promise<{ ok: boolean, was?: string, gen?: number }>}
   */
  async undo(night, tag) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || c.state === 'undone') return { ok: false, ...(c ? { was: c.state, gen: c.gen } : {}) };
    const was = c.state;
    c.state = 'undone';
    c.gen += 1;
    delete c.until;
    delete c.jobId;
    delete c.recheck;
    delete c.printedEarly;
    await this.doc.save();
    return { ok: true, was, gen: c.gen };
  }

  /**
   * A late BARF friend's redo never took (barf.js): TwoTimTwo does not have the
   * child, but their name tag printed. The claim stays live (made live, queued
   * with no job, when there is none) and carries `recheck` (the child's Bible,
   * nothing named), so the report's gap never undoes it, nothing adopts them as
   * new, and the desk's next tap on them is the re-check-in alone (no name tag).
   * The synchronous half: no await. @param {string} night @param {string} tag @param {boolean} bible
   */
  markRecheckNow(night, tag, bible) {
    const claims = this.claims(night);
    if (!claims[tag] || claims[tag].state === 'undone') {
      const r = this.claimNow(night, tag, { source: 'barf', initial: 'queued' });
      if (!r.ok) return false;
    }
    claims[tag].recheck = { bible: !!bible };
    return true;
  }

  /** The re-check-in a live claim waits for, or null (`early`: an early label's, desk.js; else a late BARF friend's). @param {string} night @param {string} tag (call after load) */
  recheckOf(night, tag) {
    const c = this.peek(night, tag);
    return c && c.state !== 'undone' && c.recheck ? c.recheck : null;
  }

  /** The re-check-in went through: the claim is an ordinary live one again. @param {string} night @param {string} tag */
  async clearRecheck(night, tag) {
    await this.load();
    const c = this.peek(night, tag);
    if (!c || !c.recheck) return false;
    delete c.recheck;
    await this.doc.save();
    return true;
  }

  /** Counts by state, for the status: never a tag. @param {string} night */
  async counts(night) {
    await this.load();
    /** @type {Record<string, number>} */
    const out = { checking: 0, queued: 0, printed: 0, undone: 0 };
    if (this.doc.data.night !== night) return out;
    for (const c of Object.values(/** @type {Record<string, Claim>} */ (this.doc.data.claims))) out[c.state] += 1;
    return out;
  }

  /** The end of the night: forget every claim that is not `keepNight`'s. @param {string} keepNight */
  async purge(keepNight) {
    await this.load();
    if (this.doc.data.night === keepNight) return 0;
    const n = Object.keys(this.doc.data.claims).length;
    await this.doc.drop();
    return n;
  }
}
