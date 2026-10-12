// The desk's check-in, undo and check-out (ROADMAP.md#online-check-in; routes.md
// §5): the claim logic the desk page (P3) calls. The page seals a history row
// and the print job in the browser, then posts here; the Worker never opens
// either. What this module owns is the ORDER, so nothing is posted or printed
// twice and nothing is half done:
//
//   1. fail closed: no sealed history row, or (stations registered) no print
//      bundle sealed to every one of them -> 400, NOTHING written
//   2. claim the child (ledger.js): one synchronous check-and-set. A child who
//      is already claimed answers {already: true, jobId}: nothing is posted
//      twice, from the desk or from a second desk
//   3. the print job is stored WITH the claim (it cannot be leased while the
//      claim is `checking`)
//   4. the post to TwoTimTwo (no claim state is held across it but `checking`,
//      and no check-and-set spans the fetch)
//        success, or TwoTimTwo says "already checked in"  -> settle: queued
//        a definite refusal                                -> release, drop the job
//        a timeout or network error (AMBIGUOUS: TwoTimTwo may have it)
//                                                          -> release, drop the
//                                                             job, answer 504; if
//                                                             it did record it, the
//                                                             watcher sees the child
//                                                             on the report and
//                                                             claims + prints it
//   5. hooks: history (P6) and the tally (P5) register functions in
//      `desk.hooks`; a hook that throws never fails the check-in.
//
// A visitor with no clubber id is not on TwoTimTwo: claim, job, hooks, no post.
//
// READS. The check-in page behind a check-in (who, which items, the meeting)
// is read through the ONE 5 s clock (readbudget.js) and kept for
// CHECKIN_PAGE_TTL_MS, so a rush of check-ins is not a read each.

import { churchNight } from '../../shared/cloud-crypto.js';
import { json } from './http.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { itemsToSend } from './twotimtwo.js';
import { PRINT_JOB_KIND } from './adopt.js';
import { itemClubs } from './phone.js';

/** How long a read of the check-in page serves check-ins (who, items, meeting). */
export const CHECKIN_PAGE_TTL_MS = 2 * 60 * 1000;
/** The households (families) change rarely: one read of the export serves the desk this long (a failure, FAMILIES_RETRY_MS). */
export const FAMILIES_TTL_MS = 30 * 60 * 1000;
export const FAMILIES_RETRY_MS = 5 * 60 * 1000;
/** The meeting's id does not change in a night: undo and check-out reuse it this long. */
export const CALENDAR_TTL_MS = 10 * 60 * 1000;
const ID_RE = /^\d{1,12}$/;
const AMBIGUOUS = new Set(['timeout', 'network']);

/**
 * The default shape check of a sealed history row (routes.md "Wire shapes").
 * The history module (P6) may replace `desk.checkRow` with its own, which
 * also knows the current kid. @param {any} row @param {string} night
 */
export function defaultRowCheck(row, night) {
  return !!row && typeof row === 'object' && row.v === 1 && row.night === night
    && typeof row.id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(row.id)
    && typeof row.kind === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(row.kind)
    && typeof row.kid === 'string' && /^[0-9a-f]{16}$/.test(row.kid)
    && typeof row.epk === 'string' && typeof row.iv === 'string'
    && typeof row.ct === 'string' && row.ct.length === 1388;
}

/** @param {number} status @param {Record<string, unknown>} body */
const refuse = (status, body) => json({ ok: false, ...body }, status);

/** @param {any} v */
const clean = (v, max = 40) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export class Desk {
  /**
   * @param {{ watcher: import('./watcher.js').Watcher, ledger: import('./ledger.js').Ledger,
   *   printq: import('./printq.js').PrintQueue, stations: import('./stations.js').Stations,
   *   tags: import('./ledger.js').Tags, now: () => number, log?: (line: string) => void,
   *   adopt?: import('./adopt.js').Adopter }} deps
   */
  constructor({ watcher, ledger, printq, stations, tags, now, log, adopt }) {
    this.watcher = watcher;
    /** The watcher's backlog of TwoTimTwo-page check-ins: an undo takes the child off it. */
    this.adopt = adopt || null;
    this.ledger = ledger;
    this.printq = printq;
    this.stations = stations;
    this.tags = tags;
    this.now = now;
    this.log = log || ((line) => console.warn(line));
    /** The extension points: each function gets one event object. */
    this.hooks = {
      /** @type {((e: Record<string, any>) => Promise<void>|void)[]} */ afterCheckin: [],
      /** @type {((e: Record<string, any>) => Promise<void>|void)[]} */ afterUndo: [],
      /** @type {((e: Record<string, any>) => Promise<void>|void)[]} */ afterCheckout: [],
    };
    /** May be async: history.js replaces it with a check that knows the current kid. @type {(row: any, night: string) => boolean|Promise<boolean>} */
    this.checkRow = defaultRowCheck;
    /** @type {{ at: number, page: any }|null} */
    this.cache = null;
    /** @type {Promise<any>|null} */
    this.inflight = null;
    /** @type {{ at: number, households: string[][], error?: string }|null} */
    this.familiesCache = null;
  }

  /** @param {'afterCheckin'|'afterUndo'|'afterCheckout'} name @param {Record<string, any>} event */
  async fire(name, event) {
    for (const fn of this.hooks[name]) {
      try { await fn(event); } catch (err) { console.error(`[desk] ${name} hook failed`, err); }
    }
  }

  // ── the check-in page ──────────────────────────────────────────────────────

  /**
   * The check-in page, from this object's last read when it is young enough,
   * else read through the shared clock. A failed read with an older copy in
   * hand gives that copy (`stale`), never nothing.
   * @param {number} maxAgeMs @param {boolean} [force]
   * @returns {Promise<{ ok: true, page: any, readAt: number, stale?: boolean } | { ok: false, error: string, retryAfterMs?: number }>}
   */
  async page(maxAgeMs, force = false) {
    const c = this.cache;
    if (!force && c && this.now() - c.at < maxAgeMs) return { ok: true, page: c.page, readAt: c.at };
    if (this.inflight) return this.inflight;
    this.inflight = (async () => {
      const client = this.watcher.clientFor();
      if (!client || this.watcher.mode === 'off') return { ok: /** @type {const} */ (false), error: 'not-configured' };
      const r = await client.checkinPage({ waitMs: INTERACTIVE_WAIT_MS, kind: 'desk' });
      if (r.ok) {
        this.cache = { at: this.now(), page: r.page };
        return { ok: /** @type {const} */ (true), page: r.page, readAt: this.cache.at };
      }
      if (this.cache) return { ok: /** @type {const} */ (true), page: this.cache.page, readAt: this.cache.at, stale: true };
      return { ok: /** @type {const} */ (false), error: r.error, ...('retryAfterMs' in r ? { retryAfterMs: r.retryAfterMs } : {}) };
    })().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** @param {{ ok: false, error: string, retryAfterMs?: number }} r */
  pageFailure(r) {
    if (r.error === 'read-busy') return refuse(429, { reason: 'read-busy', retryAfterMs: r.retryAfterMs ?? READ_INTERVAL_MS });
    if (r.error === 'not-configured') return refuse(503, { reason: 'not-configured' });
    return refuse(502, { reason: 'twotimtwo-unreadable', error: r.error });
  }

  /** GET /v1/desk/roster: tonight's check-in page, no medical data. */
  async roster() {
    const r = await this.page(READ_INTERVAL_MS);
    if (!r.ok) return this.pageFailure(r);
    const kids = r.page.roster.map((/** @type {any} */ k) => {
      const parts = String(k.name || '').trim().split(/\s+/);
      return { clubberId: k.clubberId, first: parts[0] || '', last: parts.slice(1).join(' '), club: k.club, clubId: k.clubId, checkedIn: !!k.checkedIn };
    });
    // Which clubs offer Bible / Brought a friend: from the page already read, no extra read.
    return json({ readAt: new Date(r.readAt).toISOString(), ...(r.stale ? { stale: true } : {}), kids, items: itemClubs(r.page.events || []) });
  }

  /**
   * GET /v1/desk/families: TwoTimTwo's households (names only, two or more
   * active children each), for the page's families-first search and its
   * brothers and sisters. One read of the export per FAMILIES_TTL_MS through
   * the shared clock, held in memory, never stored. A failed read is an empty
   * list with a fixed `familiesError` code (the page then shows children one
   * by one), kept FAMILIES_RETRY_MS; one only turned away by the clock is not
   * kept and answers 429.
   */
  async families() {
    const c = this.familiesCache;
    if (c && this.now() - c.at < (c.error ? FAMILIES_RETRY_MS : FAMILIES_TTL_MS)) {
      return json({ households: c.households, ...(c.error ? { familiesError: c.error } : {}) });
    }
    const client = this.watcher.clientFor();
    if (!client || this.watcher.mode === 'off') return refuse(503, { reason: 'not-configured' });
    const r = await client.households({ waitMs: INTERACTIVE_WAIT_MS, kind: 'desk-families' });
    if (!r.ok && r.error === 'read-busy') return this.pageFailure({ ok: false, error: 'read-busy', retryAfterMs: r.retryAfterMs });
    this.familiesCache = r.ok ? { at: this.now(), households: r.households } : { at: this.now(), households: [], error: r.error };
    return json({ households: this.familiesCache.households, ...(this.familiesCache.error ? { familiesError: this.familiesCache.error } : {}) });
  }

  // ── check in ───────────────────────────────────────────────────────────────

  /**
   * Who a request names: {clubberId} or {visitor}. @param {any} body
   * @returns {{ clubberId: string }|{ visitor: { first: string, last: string, club: string } }|null}
   */
  who(body) {
    if (body.clubberId !== undefined && body.clubberId !== null && body.clubberId !== '') {
      return ID_RE.test(String(body.clubberId)) ? { clubberId: String(body.clubberId) } : null;
    }
    const v = body.visitor;
    if (v && typeof v === 'object' && clean(v.first)) return { visitor: { first: clean(v.first), last: clean(v.last), club: clean(v.club) } };
    return null;
  }

  /** @param {{ clubberId: string }|{ visitor: { first: string, last: string, club: string } }} who @param {string} night */
  tagFor(who, night) {
    return 'clubberId' in who
      ? this.tags.identity(night, who.clubberId)
      : this.tags.visitor(night, `${who.visitor.first} ${who.visitor.last}`.trim(), who.visitor.club);
  }

  /**
   * POST /v1/desk/checkin {night, clubberId | visitor, items, historyRow, job}.
   * @param {any} body
   */
  async checkIn(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const who = this.who(body);
    if (!who) return refuse(400, { reason: 'no-child' });
    if (!(await this.checkRow(body.historyRow, night))) return refuse(400, { reason: 'unsealed', what: 'historyRow' });
    await Promise.all([this.ledger.load(), this.printq.load(), this.stations.load()]);
    /** @type {any} */
    let job = body.job ?? null;
    if (this.stations.all().length) {
      const ok = this.stations.checkBundle(job, { night, kind: PRINT_JOB_KIND });
      if (!ok.ok) {
        return refuse(ok.status, { reason: ok.reason, what: 'job', ...(ok.reason === 'stations-changed' ? { stations: await this.stations.list() } : {}) });
      }
    } else {
      job = null;   // nobody could open it: no station is registered, so nothing to print
    }
    const tag = await this.tagFor(who, night);
    if (!tag) return refuse(503, { reason: 'not-configured' });

    // 2. The claim: from here to the settle, no other desk can take this child.
    const claim = await this.ledger.claim(night, tag, { source: 'desk' });
    if (!claim.ok) return json({ ok: true, already: true, state: claim.state, jobId: claim.jobId ?? null });
    const jobId = job ? String(job.id) : null;
    // The watcher may have promoted our claim (checking -> queued) while the post
    // was out: TwoTimTwo has the child after all, and the job stored with the claim
    // is the one that prints. Then neither give up nor settle may touch it.
    const ours = () => {
      const c = this.ledger.peek(night, tag);
      return !!c && c.gen === claim.gen && (c.state === 'queued' || c.state === 'printed');
    };
    /** @returns {Promise<boolean>} true when the claim was promoted meanwhile (keep the job, carry on) */
    const giveUp = async () => {
      const released = await this.ledger.release(night, tag, claim.gen);
      if (!released.ok && ours()) return true;
      if (jobId) await this.printq.dropJob(jobId);
      return false;
    };
    // 3. The job rides the claim: not leasable until it is queued.
    if (job) {
      const queued = await this.printq.enqueue({ jobId: /** @type {string} */ (jobId), night, tag, gen: claim.gen, bundle: job });
      if (!queued.ok) {
        await this.ledger.release(night, tag, claim.gen);
        return refuse(409, { reason: queued.reason });
      }
    }
    // 4. TwoTimTwo. (Awaits the network: nothing is checked-and-set across it.)
    let club = 'visitor' in who ? who.visitor.club : '';
    let name = 'visitor' in who ? `${who.visitor.first} ${who.visitor.last}`.trim() : '';
    if ('clubberId' in who) {
      const posted = await this.post(who.clubberId, body.items);
      if (!posted.ok) {
        if (!(await giveUp())) return posted.response;
        // Promoted while the post was slow, failed or refused: the report shows the
        // child checked in, so this is a check-in like any other (the same as the
        // settle below), named from the check-in page already read.
        const kid = (this.cache?.page.roster || []).find((/** @type {any} */ k) => k.clubberId === who.clubberId);
        club = kid?.club || '';
        name = kid?.name || '';
      } else {
        club = posted.club;
        name = posted.name;
      }
    }
    const settled = await this.ledger.settle(night, tag, claim.gen, jobId ?? undefined);
    if (!settled.ok) {
      // The report may have promoted it first (our answer was slow): fine.
      if (!ours()) {
        if (jobId) await this.printq.dropJob(jobId);
        return refuse(409, { reason: 'superseded' });
      }
    }
    await this.fire('afterCheckin', { friend: Array.isArray(body.items) ? body.items.map(String).includes('Friend') : !!(body.items && body.items.Friend === true), night, tag, clubberId: 'clubberId' in who ? who.clubberId : undefined, gen: claim.gen, jobId, club, name, visitor: 'visitor' in who, historyRow: body.historyRow, source: 'desk' });
    return json({ ok: true, already: false, jobId, gen: claim.gen, history: this.hooks.afterCheckin.length ? 'hooked' : 'off' });
  }

  /**
   * The post to TwoTimTwo for one child.
   * @param {string} clubberId @param {any} items {Bible, Friend} or ['Bible', 'Friend']
   * @returns {Promise<{ ok: true, club: string, name: string } | { ok: false, response: Response }>}
   */
  async post(clubberId, items) {
    const client = this.watcher.clientFor();
    if (!client || this.watcher.mode === 'off') return { ok: false, response: refuse(503, { reason: 'not-configured' }) };
    const want = Array.isArray(items) ? new Set(items.map(String)) : null;
    const flag = (/** @type {string} */ k) => (want ? want.has(k) : !!(items && typeof items === 'object' && items[k] === true));
    let found = await this.find(clubberId, false);
    if (!found.ok && found.error === 'not-found') found = await this.find(clubberId, true);   // the roster may have changed
    if (!found.ok) {
      return { ok: false, response: found.error === 'not-found' ? refuse(409, { reason: 'not-found' }) : this.pageFailure(found) };
    }
    const { child, page } = found;
    // TwoTimTwo already has them (checked in on its own page a moment ago): that is success.
    if (child.checkedIn) return { ok: true, club: child.club, name: child.name };
    const events = itemsToSend(page.events, child.clubId, { Bible: flag('Bible'), Friend: flag('Friend') });
    const hasAttendance = page.events.some((/** @type {any} */ e) => e.automatic && (!e.clubs.length || e.clubs.includes(child.clubId)));
    if (!hasAttendance) return { ok: false, response: refuse(409, { reason: 'no-attendance-item' }) };
    const res = await client.checkIn({ clubberId, calendarId: page.calendarId, events, name: child.name });
    if (res.ok) {
      child.checkedIn = true;
      return { ok: true, club: child.club, name: child.name };
    }
    if (AMBIGUOUS.has(res.error)) {
      this.log('[desk] a check-in post timed out; the claim was released');
      return { ok: false, response: refuse(504, { reason: 'unsure', retry: true }) };
    }
    return { ok: false, response: refuse(409, { reason: res.error }) };
  }

  /** @param {string} clubberId @param {boolean} force */
  async find(clubberId, force) {
    const r = await this.page(CHECKIN_PAGE_TTL_MS, force);
    if (!r.ok) return r;
    const child = r.page.roster.find((/** @type {any} */ k) => k.clubberId === clubberId);
    return child ? { ok: /** @type {const} */ (true), child, page: r.page } : { ok: /** @type {const} */ (false), error: 'not-found' };
  }

  // ── undo and check out ─────────────────────────────────────────────────────

  /** POST /v1/desk/undo {night, clubberId | visitor, historyRow}. @param {any} body */
  async undo(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const who = this.who(body);
    if (!who) return refuse(400, { reason: 'no-child' });
    if (!(await this.checkRow(body.historyRow, night))) return refuse(400, { reason: 'unsealed', what: 'historyRow' });
    if ('clubberId' in who) {
      const sent = await this.postMeeting(who.clubberId, 'undo');
      if (!sent.ok) return sent.response;
      for (const k of this.cache?.page.roster || []) if (k.clubberId === who.clubberId) k.checkedIn = false;
    }
    const tag = await this.tagFor(who, night);
    if (!tag) return refuse(503, { reason: 'not-configured' });
    await Promise.all([this.ledger.load(), this.printq.load()]);
    // The claim goes, and so does a job that has not printed (the child is not here),
    // and so does a TwoTimTwo-page check-in of theirs still waiting to be adopted.
    await this.ledger.undo(night, tag);
    const dropped = await this.printq.dropForTag(tag);
    if (this.adopt) await this.adopt.forget(night, tag);
    await this.fire('afterUndo', { night, tag, clubberId: 'clubberId' in who ? who.clubberId : undefined, club: clean(body.club, 24), historyRow: body.historyRow, source: 'desk', visitor: 'visitor' in who });
    return json({ ok: true, droppedJobs: dropped });
  }

  /** POST /v1/desk/checkout {night, clubberId, historyRow}. @param {any} body */
  async checkout(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const who = this.who(body);
    if (!who) return refuse(400, { reason: 'no-child' });
    if (!(await this.checkRow(body.historyRow, night))) return refuse(400, { reason: 'unsealed', what: 'historyRow' });
    if ('clubberId' in who) {
      const sent = await this.postMeeting(who.clubberId, 'checkout');
      if (!sent.ok) return sent.response;
    }
    const tag = await this.tagFor(who, night);
    await this.fire('afterCheckout', { night, tag, clubberId: 'clubberId' in who ? who.clubberId : undefined, club: clean(body.club, 24), historyRow: body.historyRow, source: 'desk', visitor: 'visitor' in who });
    return json({ ok: true });
  }

  /**
   * TwoTimTwo's undo or check-out post for one child: the meeting's id from
   * the (cached) check-in page, then the POST. A timeout is `unsure`: nothing
   * is changed here, and the report (the watcher) settles what TwoTimTwo has.
   * @param {string} clubberId @param {'undo'|'checkout'} what
   * @returns {Promise<{ ok: true } | { ok: false, response: Response }>}
   */
  async postMeeting(clubberId, what) {
    const client = this.watcher.clientFor();
    if (!client || this.watcher.mode === 'off') return { ok: false, response: refuse(503, { reason: 'not-configured' }) };
    const r = await this.page(CALENDAR_TTL_MS);
    if (!r.ok) return { ok: false, response: this.pageFailure(r) };
    const res = what === 'undo'
      ? await client.undoCheckIn({ clubberId, calendarId: r.page.calendarId })
      : await client.checkOut({ clubberId, calendarId: r.page.calendarId });
    if (res.ok) return { ok: true };
    if (AMBIGUOUS.has(res.error)) return { ok: false, response: refuse(504, { reason: 'unsure', retry: true }) };
    return { ok: false, response: refuse(409, { reason: res.error }) };
  }
}
