// A late BARF friend (owner, 2026-10-12; routes.md 5.1): a child already checked
// in tonight turns out to have brought a friend. ONE desk operation does all of
// it, so nothing is printed, greeted or counted twice:
//
//   1. fail closed and refuse early: tonight is a BARF night (the church settings'
//      `barfNights`, the rule the station uses), the friend's first name is typed,
//      the history row is sealed (kind `barf-friend`), the BARF tag's job is sealed
//      to every station, the child has no friend recorded yet (friends.js, or YES
//      under the report's Brought a friend column), and no other operation or
//      desk check-in of theirs is under way (one synchronous check-and-set)
//   2. ONE report read through the shared read clock (readbudget.js: one read
//      every 15 s), URGENT like every desk action's read (the head of the queue,
//      never behind the roster's or the watcher's background reads): the child
//      must be on it, and the items they had (YES under Bible) are what the redo
//      sends again. The check-in page (the meeting's id, the child's club, the
//      items offered) is the one desk.js holds for the night: no read for it
//      unless nothing is held (then urgent too)
//   3. HOLD the child on the report (watcher.hold): every read until the hold ends
//      lists them, so the watcher never sees the gap between the undo and the redo:
//      no claim undone, no job dropped, no new TwoTimTwo-page check-in adopted (no
//      second name tag, no second greeting), the count never moves
//   4. TwoTimTwo's undo, then its check-in with the same items plus Brought a
//      friend, the check-in tried up to REDO_TRIES times (writes: no read slot;
//      desk writes, so a lapsed session signs in again at the head of the queue)
//   5. whatever the redo did: the BARF tag's job is queued (a `reprint:` job, so
//      it bypasses the claims and the station journals it: printed at most once),
//      the friend goes on the friends list (the 6:30 email and the BARF bags), and
//      the sealed `barf-friend` history row is kept. A redo that never took lets
//      the hold go at once (the truth: TwoTimTwo does not have the child) and
//      answers `checkedIn: false` with the items, so the page can offer
//      `{recheck: true}`: TwoTimTwo's check-in alone, no label, no list, and the
//      claim made live again so the watcher does not adopt the child as new.
//
// The Worker never seals or opens anything here (free plan CPU): the page sealed
// the job and the row. Names stay in this call's memory and in the hold (memory
// only), except the friends list, the owner-approved exception.

import { churchNight } from '../../shared/cloud-crypto.js';
import { json } from './http.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { WATCH_INTERVAL_MS } from './watcher.js';
import { BIBLE_RE, FRIEND_RE, itemsToSend } from './twotimtwo.js';
import { PRINT_JOB_KIND } from './adopt.js';
import { CALENDAR_TTL_MS } from './desk.js';
import { validJobId } from './printq.js';
import { cleanFriendName } from './friends.js';

/** The station's BARF tag route (printer 9.3.1+), and what an older station already runs. */
export const BARF_TAG_ROUTE = '/print-barf-tag';
export const BARF_TAG_FALLBACK = '/print-custom';
export const BARF_TAG_MIN_VERSION = '9.3.1';
/** The redo: tries, and the pause before the next (times the try number). */
export const REDO_TRIES = 3;
export const REDO_GAP_MS = 2000;
/** How long the hold lasts at most while the posts are out. */
export const HOLD_MAX_MS = 2 * 60 * 1000;
/**
 * How long it lasts after a redo that took: the longest the watcher's next report
 * can be away (every WATCH_INTERVAL_MS, pushed back one read slot at most when a
 * waiting desk request took its turn: readbudget.js), so at least one report read
 * after the redo is read while the child is still held.
 */
export const HOLD_AFTER_MS = WATCH_INTERVAL_MS + READ_INTERVAL_MS;
export const HISTORY_KIND = 'barf-friend';

const ID_RE = /^\d{1,12}$/;
const REPRINT_RE = /^reprint:/;
const AMBIGUOUS = new Set(['timeout', 'network']);

/** @param {unknown} v @returns {number[]|null} */
const parts = (v) => (typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : null);
/** Is version `v` at least `min`? Unknown is not. @param {unknown} v @param {string} min */
export function versionAtLeast(v, min) {
  const a = parts(v);
  const b = /** @type {number[]} */ (parts(min));
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/**
 * The route the page seals the BARF tag to: the tag's own route when EVERY
 * registered station runs it (any one may lease the job), else a custom label a
 * 9.3.0 station already runs ("BARFED! <first name>"), never a job a station would
 * refuse as route-not-allowed. @param {{ version?: string }[]} stations
 */
export function barfTagRoute(stations) {
  return stations.length && stations.every((s) => versionAtLeast(s.version, BARF_TAG_MIN_VERSION)) ? BARF_TAG_ROUTE : BARF_TAG_FALLBACK;
}

/** @param {number} status @param {Record<string, unknown>} body */
const refuse = (status, body) => json({ ok: false, ...body }, status);

export class BarfLate {
  /** @param {any} core the SyncCore (its modules are read when a request comes) */
  constructor(core) {
    this.core = core;
    /** Children with an operation under way: one synchronous check-and-set. @type {Set<string>} */
    this.busy = new Set();
  }

  /**
   * Is tonight a BARF night? null when nobody can say (no church settings yet, or
   * paused: the station then decides from its own config).
   * @param {string} night
   */
  async barfNight(night) {
    const { church, switches } = this.core;
    await church.load();
    const settings = church.doc.data && church.doc.data.settings;
    if (!settings || switches.value('CHURCH_SETTINGS') === 'off') return null;
    return Array.isArray(settings.barfNights) && settings.barfNights.includes(night);
  }

  /** Clubber ids that already brought a friend tonight: the friends list and the report's YES. @param {string} night */
  async friendIds(night) {
    const { friends, book } = this.core;
    const ids = new Set((await friends.rows(night)).map((/** @type {any} */ r) => r.clubberId).filter(Boolean));
    try {
      await book.load();
      for (const id of book.friendIds()) ids.add(id);
    } catch { /* the friends list alone */ }
    return [...ids];
  }

  /** GET /v1/desk/barf: what the page needs to show the BARF button. No TwoTimTwo read. */
  async info() {
    const night = churchNight(this.core.now());
    const barfNight = await this.barfNight(night);
    const stations = await this.core.stations.list();
    return json({ night, barfNight, friends: barfNight ? await this.friendIds(night) : [], tagRoute: barfTagRoute(stations), stations: stations.length });
  }

  /** POST /v1/desk/barf-late. @param {any} body */
  async handle(body) {
    const core = this.core;
    const night = churchNight(core.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const clubberId = ID_RE.test(String(body.clubberId ?? '')) ? String(body.clubberId) : '';
    if (!clubberId) return refuse(400, { reason: 'no-child' });
    if (body.recheck === true) return this.guard(clubberId, () => this.recheck(night, clubberId, body));
    const friendName = cleanFriendName(body.friendName);
    if (!friendName) return refuse(400, { reason: 'no-friend-name' });
    if ((await this.barfNight(night)) !== true) return refuse(409, { reason: 'not-barf-night' });
    if (!body.historyRow || body.historyRow.kind !== HISTORY_KIND || !(await core.desk.checkRow(body.historyRow, night))) {
      return refuse(400, { reason: 'unsealed', what: 'historyRow' });
    }
    await Promise.all([core.ledger.load(), core.printq.load(), core.stations.load()]);
    /** @type {{ jobId: string, bundle: any }|null} */
    let tagJob = null;
    if (core.stations.all().length) {
      const j = body.tagJob;
      if (!j || !REPRINT_RE.test(String(j.jobId)) || !validJobId(j.jobId)) return refuse(400, { reason: 'unsealed', what: 'tagJob' });
      const ok = core.stations.checkBundle(j.bundle, { night, kind: PRINT_JOB_KIND });
      if (!ok.ok) return refuse(ok.status, { reason: ok.reason, what: 'tagJob', ...(ok.reason === 'stations-changed' ? { stations: await core.stations.list() } : {}) });
      tagJob = { jobId: j.jobId, bundle: j.bundle };
    }
    return this.guard(clubberId, () => this.lateFriend(night, clubberId, friendName, body.historyRow, tagJob));
  }

  /**
   * One operation per child at a time, and never while a desk check-in of theirs
   * is being posted: the check and the mark are one synchronous step.
   * @param {string} clubberId @param {() => Promise<Response>} run
   */
  async guard(clubberId, run) {
    const core = this.core;
    const night = churchNight(core.now());
    const tag = await core.tags.identity(night, clubberId);
    if (!tag) return refuse(503, { reason: 'not-configured' });
    await core.ledger.load();
    const c = core.ledger.peek(night, tag);
    if (this.busy.has(clubberId) || (c && c.state === 'checking')) return refuse(409, { reason: 'busy' });
    this.busy.add(clubberId);
    try {
      return await run();
    } finally {
      this.busy.delete(clubberId);
    }
  }

  /** The check-in page's child (cached for the meeting's id), read afresh once when not found. @param {string} clubberId */
  async child(clubberId) {
    let found = await this.core.desk.find(clubberId, false);
    if (!found.ok && found.error === 'not-found') found = await this.core.desk.find(clubberId, true);
    return found;
  }

  /**
   * @param {string} night @param {string} clubberId @param {string} friendName
   * @param {any} historyRow @param {{ jobId: string, bundle: any }|null} tagJob
   */
  async lateFriend(night, clubberId, friendName, historyRow, tagJob) {
    const core = this.core;
    const desk = core.desk;
    const watcher = core.watcher;
    const client = watcher.clientFor();
    if (!client || watcher.mode === 'off') return refuse(503, { reason: 'not-configured' });
    if ((await this.friendIds(night)).includes(clubberId)) return refuse(409, { reason: 'already-friend' });
    // The report: on it (checked in), not marked yet, and which items the child had.
    const rep = await client.report(night, { waitMs: INTERACTIVE_WAIT_MS, kind: 'desk-barf', urgent: true });
    if (!rep.ok) return desk.pageFailure({ ok: false, error: rep.error, ...('retryAfterMs' in rep ? { retryAfterMs: rep.retryAfterMs } : {}) });
    const entry = rep.report.entries.find((/** @type {any} */ e) => e.clubberId === clubberId);
    if (!entry) return refuse(409, { reason: 'not-on-report' });
    if (entry.friend) return refuse(409, { reason: 'already-friend' });
    const found = await this.child(clubberId);
    if (!found.ok) return found.error === 'not-found' ? refuse(409, { reason: 'not-found' }) : desk.pageFailure(found);
    const { child, page } = found;
    const applies = (/** @type {any} */ e) => !e.clubs.length || e.clubs.includes(String(child.clubId));
    if (!page.events.some((/** @type {any} */ e) => e.automatic && applies(e))) return refuse(409, { reason: 'no-attendance-item' });
    if (!page.events.some((/** @type {any} */ e) => !e.automatic && FRIEND_RE.test(e.label || '') && !BIBLE_RE.test(e.label || '') && applies(e))) {
      return refuse(409, { reason: 'no-friend-item' });
    }
    const items = { Bible: !!entry.bible, Friend: true };
    const events = itemsToSend(page.events, child.clubId, items);
    const name = child.name || entry.name;

    // The hold: from before the undo to well after the redo, the watcher reads them as here.
    watcher.hold({ clubberId, name: entry.name || name, club: entry.club, friend: true, ...(entry.bible ? { bible: true } : {}) }, core.now() + HOLD_MAX_MS);
    const undone = await client.undoCheckIn({ clubberId, calendarId: page.calendarId }, { desk: true });
    if (!undone.ok) {
      let stillIn = true;
      if (AMBIGUOUS.has(undone.error)) {
        // Did it go through? The check-in page says (one urgent read; unknown counts as "went through").
        const again = await desk.page(0, true, true);
        const k = again.ok ? again.page.roster.find((/** @type {any} */ r) => r.clubberId === clubberId) : null;
        stillIn = !!(again.ok && !again.stale && k && k.checkedIn);
      }
      if (stillIn) {
        watcher.unhold(clubberId);
        return refuse(AMBIGUOUS.has(undone.error) ? 504 : 409, { reason: AMBIGUOUS.has(undone.error) ? 'unsure' : undone.error });
      }
    }
    child.checkedIn = false;
    let redo = /** @type {{ ok: boolean, error?: string }} */ ({ ok: false, error: 'not-tried' });
    let tries = 0;
    while (tries < REDO_TRIES) {
      tries += 1;
      redo = await client.checkIn({ clubberId, calendarId: page.calendarId, events, name }, { desk: true });
      if (redo.ok) break;
      if (tries < REDO_TRIES) await core.sleep(REDO_GAP_MS * tries);
    }
    if (redo.ok) {
      child.checkedIn = true;
      watcher.unhold(clubberId, core.now() + HOLD_AFTER_MS);
    } else {
      watcher.unhold(clubberId);
      console.warn('[desk] a late BARF friend: the redo did not take; the page offers a re-check-in');
    }

    // Whatever the redo did: the tag, the lists, the row.
    let printed = null;
    if (tagJob) {
      const q = await core.printq.enqueue({ jobId: tagJob.jobId, kind: 'reprint', night, bundle: tagJob.bundle });
      if (q.ok) printed = tagJob.jobId;
    }
    try { await core.friends.record({ name, club: entry.club || child.club, clubberId, friendName }); } catch (err) { console.error('[desk] recording a late friend failed', err); }
    const history = await core.history.storeSealed(historyRow);
    return json({
      ok: true, checkedIn: redo.ok, items, jobId: printed, history: history.ok ? 'kept' : 'failed',
      ...(redo.ok ? {} : { reason: redo.error || 'refused', tries }),
    });
  }

  /**
   * {recheck: true}: the redo alone, after one that never took. No label, no list,
   * no row. The claim is made live (queued, no job) and the child held BEFORE the
   * post, so whatever the watcher reads meanwhile, the child is never adopted as a
   * new check-in; a post that fails lets both go (the claim undone at gen + 1).
   * @param {string} night @param {string} clubberId @param {any} body
   */
  async recheck(night, clubberId, body) {
    const core = this.core;
    const watcher = core.watcher;
    const client = watcher.clientFor();
    if (!client || watcher.mode === 'off') return refuse(503, { reason: 'not-configured' });
    const tag = /** @type {string} */ (await core.tags.identity(night, clubberId));
    const items = { Bible: !!(body.items && body.items.Bible === true), Friend: true };
    // The page held for the night when it is one slot young, else one urgent read:
    // whether TwoTimTwo has the child already (a redo that timed out may have taken).
    const fresh = await core.desk.page(READ_INTERVAL_MS, false, true);
    if (!fresh.ok) return core.desk.pageFailure(fresh);
    const found = await this.child(clubberId);
    if (!found.ok) return found.error === 'not-found' ? refuse(409, { reason: 'not-found' }) : core.desk.pageFailure(found);
    const { child, page } = found;
    // One synchronous step: a live claim (made here only when there is none), then the hold.
    const c = core.ledger.peek(night, tag);
    const made = !c || c.state === 'undone' ? core.ledger.claimNow(night, tag, { source: 'barf', initial: 'queued' }) : null;
    watcher.hold({ clubberId, name: child.name, club: child.club, friend: true, ...(items.Bible ? { bible: true } : {}) }, core.now() + HOLD_MAX_MS);
    if (made) await core.ledger.doc.save();
    let ok = !!child.checkedIn && !fresh.stale;
    let error = '';
    if (!ok) {
      const events = itemsToSend(page.events, child.clubId, items);
      const r = await client.checkIn({ clubberId, calendarId: page.calendarId, events, name: child.name }, { desk: true });
      ok = r.ok;
      error = r.ok ? '' : r.error;
    }
    if (!ok) {
      watcher.unhold(clubberId);
      if (made && made.ok) await core.ledger.undo(night, tag);
      return json({ ok: true, checkedIn: false, items, reason: error || 'refused' });
    }
    child.checkedIn = true;
    watcher.unhold(clubberId, core.now() + HOLD_AFTER_MS);
    if (core.adopt) await core.adopt.forget(night, tag);
    return json({ ok: true, checkedIn: true, items });
  }
}

/** @param {import('./registry.js').Registry} registry @param {any} core */
export function mountBarf(registry, core) {
  core.barf = new BarfLate(core);
  registry.add('GET', '/v1/desk/barf', 'session', () => core.barf.info());
  registry.add('POST', '/v1/desk/barf-late', 'session', async ({ body }) => core.barf.handle(await body()));
}
