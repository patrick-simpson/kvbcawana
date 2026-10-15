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
// TEST DAYS (owner 2026-10-15: "I still want to be able to check people in when
// it's not Wednesday ... I want to test and then just hit the undo button. I want
// it to be a real test", "Auto-undo overnight"). On a day with no club the
// roster READS TwoTimTwo's check-in page (slow is fine) and answers `testDay`
// {today, next, meeting} instead of `noClub`; check-in and undo are real
// (TwoTimTwo, the label, the claim), posted into the meeting TwoTimTwo shows
// (its next one, the owner says) with `testDay` on the write so the client's
// no-club guard lets them through. They fire NO hooks (no history row, no
// count, no book): a Thursday is not a club night in the trends. Each test
// check-in is remembered, sealed under the state key (`desk:testday`: night,
// clubber id, meeting id), and the cron after that night (sweepTestDay, the
// 6-hourly run, so about 2 am) undoes every one still there on TwoTimTwo. A
// hand undo takes it off the list. Check-out and the BARF tools stay refused
// `no-club` (TwoTimTwo's check-out has no undo).
//
// EARLY LABELS (owner 2026-10-15: "labels print sooner ... before TwoTimTwo
// processes", "only print sooner when safe", "last 3 went fine"). While the last
// EARLY_AFTER posts all went through first time in under EARLY_FAST_MS (memory
// only: a restarted object waits for three again), the job is stored `early`
// and may be leased while the claim is still `checking`. If TwoTimTwo then
// fails: a job no station took yet is dropped as before; one that was leased
// (its label may be out) stays, and the claim stays live marked `recheck`
// {early: true} (ledger.keepForRecheck), answered with `printed: true` so the
// page retries. The next check-in of that child is the post alone (no second
// label) and fires the hooks the first attempt never did.
//
// READS (owner 2026-10-12: a check-in is "instantaneous as much as possible,
// never a wait"). What a check-in, undo or check-out needs from the check-in
// page (the meeting's calendar_id, the items and their clubs, each child's
// club) does not change within a meeting: the page is kept for the whole club
// night, warmed by the watcher when the watch window opens (`warm`) and
// refreshed by the roster's reads (at most every CHECKIN_PAGE_TTL_MS, on the
// ONE read clock, readbudget.js). A desk action uses it and reads nothing; only
// with nothing held for tonight (a restart before the watcher warmed it), or a
// child the held page does not list, does it read, and then URGENT: the head
// of the read queue. Its writes sign in again once when the session lapsed.
//
// KEPT ACROSS A RESTART (owner 2026-10-12, after /checkin sat on "Reading the
// roster..." past a deploy): the page held is also written to Durable Object
// storage as `desk:page`, ONE blob sealed under the Worker's state key
// (watcher.js sealState, the same as `tonight:book` and `cloud:snap`): the
// meeting's id, the check-in items, and per child the clubber id, full name,
// club and checked-in mark. Written only while the watch window is open, at
// most once a minute unless the list or who is checked in moved, never past
// DESK_PAGE_MAX_BYTES; deleted when the window closes (`endOfNight`, from the
// watcher's alarm). A new object reads it back once (`restore`) when it is
// tonight's, opens, and is under DESK_PAGE_MAX_AGE_MS old; anything else is
// deleted, never trusted. The roster answers a restored page at once
// (`restored: true`) and the watcher's alarm reads a fresh one in its next
// free slot.
//
// NO CLUB TONIGHT (owner 2026-10-13, after /checkin sat on "Reading the
// roster..." on a Monday evening): on a day that is not a club day
// (clubday.js: the shared club-night rule, the schedule and the Worker's
// calendar, the whole local day) the roster answers AT ONCE `{noClub: true,
// today, next, kids: [], items}` and TwoTimTwo is not touched: what its
// check-in page shows on such a day is some other meeting, whose list a tap
// would check a child into. A check-in, undo, check-out or late BARF friend is
// refused 409 `no-club` before any read, claim or post. The print station's
// rehearsal mode (publisher.js `rehearsing`) lets a rehearsal through as before.

import { churchNight } from '../../shared/cloud-crypto.js';
import { json } from './http.js';
import { INTERACTIVE_WAIT_MS, READ_INTERVAL_MS } from './readbudget.js';
import { itemsToSend } from './twotimtwo.js';
import { Families } from './families.js';
import { PRINT_JOB_KIND } from './adopt.js';
import { itemClubs } from './phone.js';
import { openState, sealState, watchWindow } from './watcher.js';
import { friendClubOf } from './friends.js';

/** The roster's check-in page is re-read at most this often (pages poll every 15 s; 2 of the 4 reads a minute). */
export const CHECKIN_PAGE_TTL_MS = 30 * 1000;
/** TwoTimTwo's club ids (printer/docs/TWOTIMTWO.md 2.1), when the page names no child of that club. */
const KNOWN_CLUB_IDS = /** @type {Record<string, string>} */ ({ cubbies: '1', sparks: '2', 't&t': '3', puggles: '4', trek: '6', journey: '7' });
/** Where the held page is kept, sealed under the state key. */
export const DESK_PAGE_KEY = 'desk:page';
/** A held page whose children and checked-in marks did not move is written at most this often. */
export const DESK_PAGE_PERSIST_MS = 60 * 1000;
/** A stored page older than this is never restored (a club night's window is 4.5 hours). */
export const DESK_PAGE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** The stored blob's limit (a Durable Object value holds 128 KiB): a bigger one is not written. */
export const DESK_PAGE_MAX_BYTES = 120 * 1024;
/** A restore that could not run yet (cloud check-in off, no secret, storage failed) is tried again at most this often. */
export const DESK_RESTORE_RETRY_MS = 60 * 1000;
export { FAMILIES_TTL_MS, FAMILIES_RETRY_MS } from './families.js';
/** Pages asked for the roster this recently: the watcher reads it ahead in a free slot. */
export const ROSTER_ACTIVE_MS = 45 * 1000;
const ID_RE = /^\d{1,12}$/;
const AMBIGUOUS = new Set(['timeout', 'network']);
/** Where the test days' check-ins wait for the overnight undo (sealed). */
const TEST_DAY_KEY = 'desk:testday';
/** Undo tries per test check-in before it is given up on (and logged). */
const TEST_UNDO_TRIES = 3;
/** Test check-ins undone in one sweep (the rest wait for the next run). */
const TEST_SWEEP_MAX = 60;
/** Early labels: this many posts in a row went through first time ... */
export const EARLY_AFTER = 3;
/** ... each in under this long (ms). */
export const EARLY_FAST_MS = 10 * 1000;

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
/** Is item `k` ticked? Items come as ['Bible', 'Friend'] or {Bible: true}. @param {any} items @param {string} k */
const itemOn = (items, k) => (Array.isArray(items) ? items.map(String).includes(k) : !!(items && typeof items === 'object' && items[k] === true));

/** @param {any} v */
const clean = (v, max = 40) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What the desk reads of a check-in page and nothing more (the stored form):
 * the meeting's id (every post), the items with their clubs and labels
 * (itemsToSend, itemClubs, the attendance check) and per child the clubber id,
 * club id, name, club and checked-in mark (the roster answer, find, the
 * check-in's name and club). Pure. @param {any} page
 */
export function compactPage(page) {
  return {
    calendarId: String(page?.calendarId ?? ''),
    events: (Array.isArray(page?.events) ? page.events : []).map((/** @type {any} */ e) => ({
      id: String(e.id ?? ''), clubs: (Array.isArray(e.clubs) ? e.clubs : []).map(String), automatic: !!e.automatic, label: String(e.label ?? '').slice(0, 60),
    })),
    roster: (Array.isArray(page?.roster) ? page.roster : []).map((/** @type {any} */ k) => ({
      clubberId: String(k.clubberId ?? ''), clubId: String(k.clubId ?? ''), name: String(k.name ?? '').slice(0, 80), club: String(k.club ?? '').slice(0, 40), checkedIn: !!k.checkedIn,
    })),
  };
}

/** Did the list or who is checked in move? (memory only, never stored) @param {any} page */
const pageSig = (page) => `${page.calendarId}|${(page.roster || []).map((/** @type {any} */ k) => `${k.clubberId}${k.checkedIn ? '+' : '-'}`).join(',')}`;

export class Desk {
  /**
   * @param {{ watcher: import('./watcher.js').Watcher, ledger: import('./ledger.js').Ledger,
   *   printq: import('./printq.js').PrintQueue, stations: import('./stations.js').Stations,
   *   tags: import('./ledger.js').Tags, now: () => number, log?: (line: string) => void,
   *   adopt?: import('./adopt.js').Adopter,
   *   storage?: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   secret?: () => string|null|undefined }} deps
   */
  constructor({ watcher, ledger, printq, stations, tags, now, log, adopt, storage, secret }) {
    this.watcher = watcher;
    /** Where the held page is kept sealed (the watcher's storage, the one Durable Object's). */
    this.storage = storage || watcher.storage || null;
    /** The state key's secret, as every sealed blob of the Worker has it (the TwoTimTwo password secret). */
    this.secret = secret || (() => watcher.creds()?.password);
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
    /** barf.js sets it: a tap on a child waiting to be checked in again after a late BARF friend. @type {((night: string, clubberId: string, wait: { bible: boolean }) => Promise<Response>)|null} */
    this.barfRecheck = null;
    /**
     * The check-in page, kept for the club night it was read on. `restored`: read
     * back from storage after a restart (not read by this object); `refreshFailed`:
     * a read since then failed, so the roster goes back to reading (and `stale`).
     * @type {{ at: number, page: any, night: string, restored?: boolean, refreshFailed?: boolean }|null}
     */
    this.cache = null;
    /** Tonight's checked-in children from the watcher's latest applied report (memory only; ids, names, clubs). @type {{ night: string, kids: { clubberId: string, name: string, club: string }[] }} */
    this.reportKids = { night: '', kids: [] };
    /** Children this desk checked in tonight (memory only): a page read that began before a check-in landed must not un-check them. @type {{ night: string, ids: Set<string> }} */
    this.deskChecked = { night: '', ids: new Set() };
    /** Tonight's checked-out clubber ids (set by SyncCore from the publisher's book). @type {null | (() => Promise<Set<string>>)} */
    this.checkedOutIds = null;
    /** The one restore of a new object (single flight; kept once it ran to its end). @type {Promise<void>|null} */
    this.restoring = null;
    /** A restore that could not run yet is not tried again before this (ms). */
    this.restoreRetryAt = 0;
    /** What was last written (memory only): the list's signature and when. */
    this.savedSig = /** @type {string|null} */ (null);
    this.savedAt = 0;
    /** Storage may hold `desk:page` (unknown after a restart): the end of the night deletes it once. */
    this.mayHoldStored = true;
    /** @type {Promise<any>|null} */
    this.inflight = null;
    /** A desk action's own (urgent) read, never queued behind the roster's. @type {Promise<any>|null} */
    this.inflightUrgent = null;
    /** When a page last asked for the roster (ms). */
    this.rosterAskedAt = 0;
    /** TwoTimTwo's households (families.js); the watcher's alarm catches it up. */
    this.familiesSource = new Families({ watcher, now });
    /** SyncCore's wake-up call (rings the stations when a label is ready). @type {() => Promise<unknown>} */
    this.wake = async () => 0;
    /** The last EARLY_AFTER posts: true = through first time and fast (memory only). @type {boolean[]} */
    this.postsLately = [];
  }

  /** May a label print before TwoTimTwo answers? The last EARLY_AFTER posts all went fine. */
  healthy() {
    return this.postsLately.length >= EARLY_AFTER && this.postsLately.every(Boolean);
  }
  /** @param {boolean} fine */
  notePost(fine) {
    this.postsLately.push(fine);
    if (this.postsLately.length > EARLY_AFTER) this.postsLately.shift();
  }

  /**
   * TwoTimTwo did not take it, but an early label may be out: the refusal the
   * page would have had, marked `printed: true`. @param {Response} response
   */
  async printedRefusal(response) {
    const body = await response.clone().json().catch(() => ({}));
    return refuse(response.status, { ...body, printed: true });
  }

  /** The schedule the club-day rule reads: the watcher's (one rule, one place; tests swap it). */
  get schedule() { return this.watcher.schedule; }

  set schedule(v) { this.watcher.schedule = v; }

  /**
   * Is a roster refresh worth a free slot of the watcher's alarm: a page asked
   * for the roster lately (they poll every 15 s) and the page held is a slot
   * old? Then the alarm reads it ahead (`refreshRoster`) and the next poll is
   * answered at once. @returns {number|null} ms until due, or null
   */
  rosterRefreshInMs() {
    if (!this.rosterAskedAt || this.now() - this.rosterAskedAt > ROSTER_ACTIVE_MS || this.inflight) return null;
    const c = this.cache;
    if (!c || c.night !== churchNight(this.now())) return 0;
    // A page read back after a restart: the very next free slot reads a fresh one.
    if (c.restored) return 0;
    return Math.max(0, c.at + READ_INTERVAL_MS - this.now());
  }

  /** The watcher's read ahead of the roster (waitMs 0). true when it read. */
  async refreshRoster() {
    const client = this.watcher.clientFor();
    if (!client || this.inflight) return false;
    const r = await client.checkinPage({ waitMs: 0, kind: 'roster-ahead' });
    if (!r.ok) {
      if (r.error === 'read-busy') return false;
      // A restored page no read could replace: the roster reads (and says `stale`) as before.
      if (this.cache && this.cache.restored) this.cache.refreshFailed = true;
      return true;
    }
    await this.warm(r.page, this.now());
    return true;
  }

  /**
   * The watcher's applied report (watcher.js): who TwoTimTwo has checked in.
   * TwoTimTwo's check-in page REMOVES a checked-in child's row (printer/docs/
   * TWOTIMTWO.md 2.1), so the page alone never lists them; the roster adds them
   * from here, checked in (owner 2026-10-14: the BARF list showed nobody).
   * @param {string} night @param {any[]} entries
   */
  onReport(night, entries) {
    const kids = [];
    for (const e of Array.isArray(entries) ? entries : []) {
      const clubberId = String(e?.clubberId ?? '').trim();
      if (!/^\d{1,20}$/.test(clubberId)) continue;
      kids.push({ clubberId, name: String(e.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), club: String(e.club ?? '').trim().slice(0, 40) });
    }
    this.reportKids = { night, kids };
  }

  /**
   * TwoTimTwo's club id for a club name: from the page's own rows first, else
   * the ids TWOTIMTWO.md 2.1 lists. '' when unknown. @param {string} club @param {any} page
   */
  clubIdFor(club, page) {
    const want = String(club || '').trim().toLowerCase();
    if (!want) return '';
    for (const k of page?.roster || []) if (String(k.club || '').trim().toLowerCase() === want && k.clubId) return String(k.clubId);
    return KNOWN_CLUB_IDS[want] || '';
  }

  /** Tonight's report children (empty for another night). */
  reportedTonight() {
    return this.reportKids.night === churchNight(this.now()) ? this.reportKids.kids : [];
  }

  /** Remember (or forget) a child this desk checked in tonight. @param {string} clubberId @param {boolean} on */
  noteDeskChecked(clubberId, on) {
    const night = churchNight(this.now());
    if (this.deskChecked.night !== night) this.deskChecked = { night, ids: new Set() };
    if (on) this.deskChecked.ids.add(clubberId); else this.deskChecked.ids.delete(clubberId);
  }

  /** @param {string} clubberId */
  deskChecked_(clubberId) {
    return this.deskChecked.night === churchNight(this.now()) && this.deskChecked.ids.has(clubberId);
  }

  /** Is tonight's check-in page held (what every desk action needs)? */
  hasNightPage() {
    return !!this.cache && this.cache.night === churchNight(this.now());
  }

  /**
   * A check-in page someone else read (the watcher at the window's opening):
   * held for the night like the desk's own. @param {any} page @param {number} at
   */
  async warm(page, at) {
    if (!page || (this.cache && this.cache.at >= at)) return;
    this.cache = { at, page, night: churchNight(at) };
    this.noteRoster(page);
    await this.savePage(page, at);
  }

  // ── the held page in storage (sealed; see the top of this file) ──────────────

  /**
   * Write the page just read, sealed: only in the watch window, at most once per
   * DESK_PAGE_PERSIST_MS unless the list or a checked-in mark moved, never past
   * DESK_PAGE_MAX_BYTES. Never throws (a read never fails for it).
   * @param {any} page @param {number} at
   * @returns {Promise<'saved'|'skipped'|'throttled'|'too-big'|'failed'>}
   */
  async savePage(page, at) {
    try {
      const secret = this.secret();
      if (!this.storage || !secret || !page || !Array.isArray(page.roster) || !watchWindow(at).open) return 'skipped';
      const compact = compactPage(page);
      const sig = pageSig(compact);
      if (sig === this.savedSig && this.now() - this.savedAt < DESK_PAGE_PERSIST_MS) return 'throttled';
      const sealed = await sealState(secret, { at, night: churchNight(at), page: compact });
      if (JSON.stringify(sealed).length > DESK_PAGE_MAX_BYTES) {
        // Never a cut-down list (a child missing from it would vanish from the page): none at all.
        if (this.mayHoldStored) await this.storage.delete(DESK_PAGE_KEY);
        this.mayHoldStored = false;
        this.savedSig = null;
        this.log('[desk] the check-in page is too big to keep across a restart; it is held in memory only');
        return 'too-big';
      }
      await this.storage.put(DESK_PAGE_KEY, sealed);
      this.mayHoldStored = true;
      this.savedSig = sig;
      this.savedAt = this.now();
      return 'saved';
    } catch (err) {
      console.error('[desk] keeping the check-in page failed', err);
      return 'failed';
    }
  }

  /**
   * A new object's one look at the stored page (single flight; every later call
   * shares it). Held as `restored` only when nothing is held yet and it is
   * tonight's, opens, and is under DESK_PAGE_MAX_AGE_MS old; anything else is
   * deleted. Only a look that ran to its end is kept for the object's life: one
   * that could not run yet (cloud check-in off, no secret, a storage error) is
   * tried again, at most once per DESK_RESTORE_RETRY_MS, so a mode turned back
   * on mid-evening still finds the page. Never throws.
   */
  restore() {
    if (this.restoring) return this.restoring;
    if (this.now() < this.restoreRetryAt) return Promise.resolve();
    const notYet = () => { this.restoring = null; this.restoreRetryAt = this.now() + DESK_RESTORE_RETRY_MS; };
    const run = this.restoreOnce().then(
      (done) => { if (!done) notYet(); },
      (err) => { console.error('[desk] reading back the check-in page failed', err); notYet(); },
    );
    this.restoring = run;
    return run;
  }

  /** @returns {Promise<boolean>} true when it ran to its end (restored, nothing stored, or deleted), false when it could not run yet */
  async restoreOnce() {
    if (this.cache || !this.storage) return true;   // a page is held (newer), or nowhere to look: nothing to do, ever
    if (this.watcher.mode === 'off') return false;
    const secret = this.secret();
    if (!secret) return false;
    const sealed = await this.storage.get(DESK_PAGE_KEY);
    if (!sealed) { this.mayHoldStored = false; return true; }
    const opened = await openState(secret, sealed);
    const t = this.now();
    const good = !!opened && typeof opened.at === 'number' && opened.night === churchNight(t)
      && opened.at <= t + 60 * 1000 && t - opened.at <= DESK_PAGE_MAX_AGE_MS
      && !!opened.page && Array.isArray(opened.page.roster) && Array.isArray(opened.page.events) && typeof opened.page.calendarId === 'string';
    if (!good) {
      // Another night's, too old, or sealed under another secret: gone, never trusted.
      await this.storage.delete(DESK_PAGE_KEY);
      this.mayHoldStored = false;
      return true;
    }
    if (this.cache) return true;   // a read landed meanwhile: it is newer
    const page = compactPage(opened.page);
    this.cache = { at: opened.at, page, night: opened.night, restored: true };
    this.savedSig = pageSig(page);
    this.savedAt = t;
    return true;
  }

  /** The watch window has closed: the stored page goes (the memory copy ends with the night). */
  async endOfNight() {
    this.savedSig = null;
    this.savedAt = 0;
    if (!this.storage || !this.mayHoldStored) return false;
    await this.storage.delete(DESK_PAGE_KEY);
    this.mayHoldStored = false;
    return true;
  }

  /** Children the page lists, for the families' catch-up (families.js). @param {any} page */
  noteRoster(page) {
    this.familiesSource.noteChildren(churchNight(this.now()), (page.roster || []).map((/** @type {any} */ k) => k.name));
  }

  /** @param {'afterCheckin'|'afterUndo'|'afterCheckout'} name @param {Record<string, any>} event */
  async fire(name, event) {
    for (const fn of this.hooks[name]) {
      try { await fn(event); } catch (err) { console.error(`[desk] ${name} hook failed`, err); }
    }
  }

  // ── the check-in page ──────────────────────────────────────────────────────

  /**
   * The check-in page, from this object's last read when it is young enough
   * (`maxAgeMs`; Infinity: any read from tonight), else read through the
   * shared clock. A failed read with an older copy in hand gives that copy
   * (`stale`), never nothing. `urgent`: a desk action's read, the head of the
   * read queue (readbudget.js), never queued behind the roster's.
   * @param {number} maxAgeMs @param {boolean} [force] @param {boolean} [urgent]
   * A page read back from storage after a restart counts as held (`restored`).
   * @returns {Promise<{ ok: true, page: any, readAt: number, stale?: boolean, restored?: boolean } | { ok: false, error: string, retryAfterMs?: number }>}
   */
  async page(maxAgeMs, force = false, urgent = false) {
    await this.restore();
    const c = this.cache;
    if (!force && c && c.night === churchNight(this.now()) && this.now() - c.at <= maxAgeMs) {
      return { ok: true, page: c.page, readAt: c.at, ...(c.restored ? { restored: true } : {}) };
    }
    const slot = urgent ? 'inflightUrgent' : 'inflight';
    if (this[slot]) return this[slot];
    this[slot] = (async () => {
      const client = this.watcher.clientFor();
      if (!client || this.watcher.mode === 'off') return { ok: /** @type {const} */ (false), error: 'not-configured' };
      const r = await client.checkinPage({ waitMs: INTERACTIVE_WAIT_MS, kind: urgent ? 'desk-action' : 'desk', urgent });
      if (r.ok) {
        const at = this.now();
        const newest = !this.cache || this.cache.at <= at;
        if (newest) this.cache = { at, page: r.page, night: churchNight(at) };
        this.noteRoster(r.page);
        if (newest) await this.savePage(r.page, at);
        return { ok: /** @type {const} */ (true), page: r.page, readAt: at };
      }
      // A restored page no read could replace: from now on the roster reads, as for any page.
      if (this.cache && this.cache.restored) this.cache.refreshFailed = true;
      if (this.cache) return { ok: /** @type {const} */ (true), page: this.cache.page, readAt: this.cache.at, stale: true };
      return { ok: /** @type {const} */ (false), error: r.error, ...('retryAfterMs' in r ? { retryAfterMs: r.retryAfterMs } : {}) };
    })().finally(() => { this[slot] = null; });
    return this[slot];
  }

  // ── no club tonight (see the top of this file) ─────────────────────────────

  /**
   * Is today a club day (the whole local day), or is the station rehearsing?
   * The watcher's rule (watcher.js clubToday), the one every TwoTimTwo write asks.
   * @returns {Promise<{ club: boolean, today: string, next: string|null, rehearsal?: true }>}
   */
  clubToday() {
    return this.watcher.clubToday();
  }

  /**
   * A desk write on a day with no club: 409 `no-club` (with today and the next
   * club day), before any read, claim or post; null on a club day.
   * @returns {Promise<Response|null>}
   */
  async noClubRefusal() {
    const day = await this.clubToday();
    return day.club ? null : refuse(409, { reason: 'no-club', today: day.today, next: day.next });
  }

  /** @param {{ ok: false, error: string, retryAfterMs?: number }} r */
  pageFailure(r) {
    if (r.error === 'read-busy') return refuse(429, { reason: 'read-busy', retryAfterMs: r.retryAfterMs ?? READ_INTERVAL_MS });
    if (r.error === 'not-configured') return refuse(503, { reason: 'not-configured' });
    return refuse(502, { reason: 'twotimtwo-unreadable', error: r.error });
  }

  /**
   * GET /v1/desk/roster: tonight's check-in page (at most CHECKIN_PAGE_TTL_MS
   * old), no medical data. After a restart, a page read back from storage is
   * the answer AT ONCE (`restored: true`, never a wait for the read clock)
   * while the watch window is open: asking marks the roster wanted, so the
   * watcher's alarm reads a fresh page in its next free slot and the next poll
   * gets it. (No read is started from here: the alarm is what runs reliably.)
   * On a day with no club (and no rehearsal): `{noClub: true, today, next}` at
   * once with no children, no read, and the roster not marked wanted.
   */
  async roster() {
    const t = this.now();
    const day = await this.clubToday();
    // A day with no club is a test day (TEST DAYS above): the page is read like any other.
    const testDay = !day.club;
    this.rosterAskedAt = t;
    await this.restore();
    const c = this.cache;
    const fromRestored = !!c && !!c.restored && !c.refreshFailed && c.night === churchNight(t)
      && watchWindow(t).open && this.watcher.mode !== 'off';
    const r = fromRestored && c
      ? { ok: /** @type {const} */ (true), page: c.page, readAt: c.at, restored: true }
      : await this.page(CHECKIN_PAGE_TTL_MS);
    if (!r.ok) return this.pageFailure(r);
    const kids = r.page.roster.map((/** @type {any} */ k) => {
      const parts = String(k.name || '').trim().split(/\s+/);
      // A child a late BARF friend's undo and redo holds (barf.js) stays checked in here too.
      const held = typeof this.watcher.held === 'function' && this.watcher.held(k.clubberId);
      return { clubberId: k.clubberId, first: parts[0] || '', last: parts.slice(1).join(' '), club: k.club, clubId: k.clubId, checkedIn: !!k.checkedIn || held || this.deskChecked_(k.clubberId) };
    });
    // Checked in on TwoTimTwo: the page dropped their row, the report lists them.
    const listed = new Map(kids.map((/** @type {any} */ k) => [k.clubberId, k]));
    for (const e of this.reportedTonight()) {
      const k = listed.get(e.clubberId);
      if (k) { k.checkedIn = true; continue; }
      const parts = e.name.split(' ');
      kids.push({ clubberId: e.clubberId, first: parts[0] || '', last: parts.slice(1).join(' '), club: e.club, clubId: this.clubIdFor(e.club, r.page), checkedIn: true });
    }
    // Checked out tonight (any phone, the youth sweep): from tonight's book, ids only
    // (owner 2026-10-15: a family checked out on one phone stayed on another's grid).
    const out = typeof this.checkedOutIds === 'function' ? await this.checkedOutIds() : null;
    if (out && out.size) for (const k of kids) if (out.has(String(k.clubberId))) k.checkedOut = true;
    // Which clubs offer Bible / Brought a friend: from the page already read, no extra read.
    // familiesAt: when the households held were read, so a page sees a catch-up re-read and asks again.
    const familiesAt = this.familiesSource.readAt();
    // `restored` is not `stale`: the page's "TwoTimTwo is not answering" note is for a failed read only.
    const flag = 'stale' in r && r.stale ? { stale: true } : 'restored' in r && r.restored ? { restored: true } : {};
    const test = testDay ? { testDay: { today: day.today, next: day.next, meeting: r.page.meetingDate || null } } : {};
    return json({ readAt: new Date(r.readAt).toISOString(), ...flag, ...test, kids, items: itemClubs(r.page.events || []), ...(familiesAt ? { familiesAt } : {}) });
  }

  /**
   * GET /v1/desk/families: TwoTimTwo's households (names only, two or more
   * active children each), for the page's families-first search and its
   * brothers and sisters (families.js: one read of the export per half hour,
   * caught up when a child it does not list appears; memory only). A failed
   * read is an empty list with a fixed `familiesError` code (the page then
   * shows children one by one); one only turned away by the clock answers 429.
   */
  async families() {
    const f = await this.familiesSource.get();
    if ('notConfigured' in f) return refuse(503, { reason: 'not-configured' });
    if ('busy' in f) return this.pageFailure({ ok: false, error: 'read-busy', retryAfterMs: f.busy });
    return json({ households: f.households, ...(f.at ? { familiesAt: new Date(f.at).toISOString() } : {}), ...(f.error ? { familiesError: f.error } : {}) });
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
   * POST /v1/desk/checkin {night, clubberId | visitor, items, friendName?, historyRow, job}.
   * @param {any} body
   */
  async checkIn(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const testDay = !(await this.clubToday()).club;   // TEST DAYS: real, remembered, undone overnight
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

    // A late BARF friend's redo never took (barf.js): the child's name tag printed and
    // they wait to be checked in again on TwoTimTwo. A tap is that re-check-in alone:
    // no claim, no job, no row, no greeting (never a second name tag).
    const waiting = 'clubberId' in who ? this.ledger.recheckOf(night, tag) : null;
    // An early label printed and TwoTimTwo did not take it then: the post alone, now.
    if (waiting && waiting.early && 'clubberId' in who) return this.recheckEarly(night, tag, who.clubberId, body);
    if (waiting && 'clubberId' in who && this.barfRecheck) return this.barfRecheck(night, who.clubberId, waiting);

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
    // 3. The job rides the claim: not leasable until it is queued, unless TwoTimTwo
    // has been healthy (EARLY LABELS above): then it prints while the post is out.
    const early = !!job && 'clubberId' in who && this.healthy();
    if (job) {
      const queued = await this.printq.enqueue({ jobId: /** @type {string} */ (jobId), night, tag, gen: claim.gen, bundle: job, ...(early ? { early: true } : {}) });
      if (!queued.ok) {
        await this.ledger.release(night, tag, claim.gen);
        return refuse(409, { reason: queued.reason });
      }
      // An early label prints while TwoTimTwo is asked: ring the stations now, not after the post.
      if (early) await this.wake();
    }
    // 4. TwoTimTwo. (Awaits the network: nothing is checked-and-set across it.)
    let club = 'visitor' in who ? who.visitor.club : '';
    let name = 'visitor' in who ? `${who.visitor.first} ${who.visitor.last}`.trim() : '';
    if ('clubberId' in who) {
      const posted = await this.post(who.clubberId, body.items, testDay);
      if (!posted.ok) {
        // An early label a station already took stays: the claim waits for the post alone.
        if (early && jobId && !(await this.printq.dropUnlessLeased(jobId))) {
          const items = { bible: itemOn(body.items, 'Bible'), friend: itemOn(body.items, 'Friend') };
          if (await this.ledger.keepForRecheck(night, tag, claim.gen, items, jobId)) return this.printedRefusal(posted.response);
        }
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
        if (testDay) await this.noteTest(night, who.clubberId, posted.calendarId, true);
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
    if (testDay) return json({ ok: true, already: false, jobId, gen: claim.gen, history: 'off', testDay: true });
    await this.afterCheckin(body, { night, tag, who, gen: claim.gen, jobId, club, name });
    return json({ ok: true, already: false, jobId, gen: claim.gen, history: this.hooks.afterCheckin.length ? 'hooked' : 'off' });
  }

  /**
   * The hooks of a check-in TwoTimTwo took.
   * @param {any} body @param {{ night: string, tag: string, who: any, gen: number, jobId: string|null, club: string, name: string }} c
   */
  async afterCheckin(body, { night, tag, who, gen, jobId, club, name }) {
    const friend = itemOn(body.items, 'Friend');
    // The friend's first name, only with Brought a friend: for the 6:30 BARF email and the
    // BARF bags (friends.js, sealed under the Worker's key, as the phone path always sent it).
    const friendName = friend ? clean(body.friendName, 24) : '';
    const friendClub = friend && friendName ? friendClubOf(body.friendClub) : '';
    await this.fire('afterCheckin', { friend, friendName, friendClub, night, tag, clubberId: 'clubberId' in who ? who.clubberId : undefined, gen, jobId, club, name, visitor: 'visitor' in who, historyRow: body.historyRow, source: 'desk' });
  }

  /**
   * The re-check-in of a child whose early label is out (ledger `recheck` {early}):
   * the post alone, never a second label. TwoTimTwo taking it (or already having
   * it) clears the mark and fires the hooks the first attempt never did; another
   * failure keeps it, answered `printed: true` again.
   * @param {string} night @param {string} tag @param {string} clubberId @param {any} body
   */
  async recheckEarly(night, tag, clubberId, body) {
    const testDay = !(await this.clubToday()).club;
    const posted = await this.post(clubberId, body.items, testDay);
    if (!posted.ok) return this.printedRefusal(posted.response);
    await this.ledger.clearRecheck(night, tag);
    if (testDay) {
      await this.noteTest(night, clubberId, posted.calendarId, true);
      const c0 = this.ledger.peek(night, tag);
      return json({ ok: true, already: false, recheck: true, jobId: c0 && c0.jobId ? c0.jobId : null, gen: c0 ? c0.gen : 0, history: 'off', testDay: true });
    }
    const c = this.ledger.peek(night, tag);
    const gen = c ? c.gen : 0;
    const jobId = c && c.jobId ? c.jobId : null;
    await this.afterCheckin(body, { night, tag, who: { clubberId }, gen, jobId, club: posted.club, name: posted.name });
    return json({ ok: true, already: false, recheck: true, jobId, gen, history: this.hooks.afterCheckin.length ? 'hooked' : 'off' });
  }

  /**
   * The post to TwoTimTwo for one child.
   * @param {string} clubberId @param {any} items {Bible, Friend} or ['Bible', 'Friend']
   * @returns {Promise<{ ok: true, club: string, name: string } | { ok: false, response: Response }>}
   */
  async post(clubberId, items, testDay = false) {
    const started = this.now();
    const r = await this.postOnce(clubberId, items, testDay);
    // Fine = TwoTimTwo took it (or had it) and answered in time; anything else (busy,
    // a lapsed sign-in, slow, refused) prints the next labels after TwoTimTwo again.
    this.notePost(r.ok && this.now() - started < EARLY_FAST_MS);
    return r;
  }

  /** @param {string} clubberId @param {any} items @param {boolean} [testDay] @returns {Promise<{ ok: true, club: string, name: string, calendarId?: string } | { ok: false, response: Response }>} */
  async postOnce(clubberId, items, testDay = false) {
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
    if (child.checkedIn) return { ok: true, club: child.club, name: child.name, calendarId: page.calendarId };
    const events = itemsToSend(page.events, child.clubId, { Bible: flag('Bible'), Friend: flag('Friend') });
    const hasAttendance = page.events.some((/** @type {any} */ e) => e.automatic && (!e.clubs.length || e.clubs.includes(child.clubId)));
    if (!hasAttendance) return { ok: false, response: refuse(409, { reason: 'no-attendance-item' }) };
    const res = await client.checkIn({ clubberId, calendarId: page.calendarId, events, name: child.name }, { desk: true, ...(testDay ? { testDay: true } : {}) });
    if (res.ok) {
      child.checkedIn = true;
      this.noteDeskChecked(clubberId, true);
      return { ok: true, club: child.club, name: child.name, calendarId: page.calendarId };
    }
    if (AMBIGUOUS.has(res.error)) {
      this.log('[desk] a check-in post timed out; the claim was released');
      return { ok: false, response: refuse(504, { reason: 'unsure', retry: true }) };
    }
    return { ok: false, response: refuse(409, { reason: res.error }) };
  }

  /**
   * The child on tonight's check-in page: the page held for the night (no
   * read), else an urgent read. @param {string} clubberId @param {boolean} force
   */
  async find(clubberId, force) {
    const r = await this.page(Infinity, force, true);
    if (!r.ok) return r;
    const child = r.page.roster.find((/** @type {any} */ k) => k.clubberId === clubberId);
    return child ? { ok: /** @type {const} */ (true), child, page: r.page } : { ok: /** @type {const} */ (false), error: 'not-found' };
  }

  // ── test days (see the top of this file) ───────────────────────────────────

  /** The test check-ins waiting for the overnight undo. @returns {Promise<{ id: string, cal: string, night: string, tries?: number }[]>} */
  async testList() {
    const secret = this.secret();
    const sealed = await this.storage?.get(TEST_DAY_KEY);
    if (!sealed || !secret) return [];
    const opened = await openState(secret, sealed).catch(() => null);
    return opened && Array.isArray(opened.entries) ? opened.entries : [];
  }
  /** @param {{ id: string, cal: string, night: string, tries?: number }[]} entries */
  async saveTestList(entries) {
    if (!this.storage) return;
    if (!entries.length) { await this.storage.delete(TEST_DAY_KEY); return; }
    const secret = this.secret();
    if (!secret) return;
    await this.storage.put(TEST_DAY_KEY, await sealState(secret, { entries }));
  }
  /**
   * A test check-in to undo overnight (add), or one undone by hand (remove).
   * @param {string} night @param {string} id @param {string|undefined} cal the meeting it went into @param {boolean} add
   */
  async noteTest(night, id, cal, add) {
    const list = (await this.testList()).filter((e) => !(e.id === id && e.night === night));
    if (add) list.push({ id, cal: String(cal || ''), night });
    await this.saveTestList(list);
  }
  /**
   * The overnight undo (SyncCore.cron): every test check-in from an EARLIER night
   * is undone on TwoTimTwo, in the meeting it went into. A failure is tried again
   * at the next run, TEST_UNDO_TRIES times, then given up on (logged). Never throws.
   * @returns {Promise<{ undone: number, failed: number, left: number }>}
   */
  async sweepTestDay() {
    const out = { undone: 0, failed: 0, left: 0 };
    try {
      const list = await this.testList();
      if (!list.length) return out;
      const today = churchNight(this.now());
      const client = this.watcher.clientFor();
      const keep = [];
      let done = 0;
      for (const e of list) {
        if (e.night >= today || !client || !e.cal || done >= TEST_SWEEP_MAX) { if (e.cal || e.night >= today) keep.push(e); continue; }
        done += 1;
        const r = await client.undoCheckIn({ clubberId: e.id, calendarId: e.cal }, { desk: true, testDay: true });
        if (r.ok) { out.undone += 1; continue; }
        const tries = (e.tries || 0) + 1;
        out.failed += 1;
        if (tries < TEST_UNDO_TRIES) keep.push({ ...e, tries });
        else this.log(`[desk] a test check-in could not be undone after ${tries} tries (${r.error}); undo it on TwoTimTwo`);
      }
      out.left = keep.length;
      await this.saveTestList(keep);
      if (out.undone || out.failed) this.log(`[desk] test day: ${out.undone} undone, ${out.failed} not yet`);
    } catch (err) { console.error('[desk] the test-day undo failed', err); }
    return out;
  }

  // ── undo and check out ─────────────────────────────────────────────────────

  /** POST /v1/desk/undo {night, clubberId | visitor, historyRow}. @param {any} body */
  async undo(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const testDay = !(await this.clubToday()).club;   // TEST DAYS: the undo is real too
    const who = this.who(body);
    if (!who) return refuse(400, { reason: 'no-child' });
    if (!(await this.checkRow(body.historyRow, night))) return refuse(400, { reason: 'unsealed', what: 'historyRow' });
    if ('clubberId' in who) {
      const sent = await this.postMeeting(who.clubberId, 'undo', testDay);
      if (!sent.ok) return sent.response;
      if (testDay) await this.noteTest(night, who.clubberId, '', false);
      for (const k of this.cache?.page.roster || []) if (k.clubberId === who.clubberId) k.checkedIn = false;
      this.noteDeskChecked(who.clubberId, false);
    }
    const tag = await this.tagFor(who, night);
    if (!tag) return refuse(503, { reason: 'not-configured' });
    await Promise.all([this.ledger.load(), this.printq.load()]);
    // The claim goes, and so does a job that has not printed (the child is not here),
    // and so does a TwoTimTwo-page check-in of theirs still waiting to be adopted.
    await this.ledger.undo(night, tag);
    const dropped = await this.printq.dropForTag(tag);
    if (this.adopt) await this.adopt.forget(night, tag);
    if (testDay) return json({ ok: true, droppedJobs: dropped, testDay: true });
    await this.fire('afterUndo', { night, tag, clubberId: 'clubberId' in who ? who.clubberId : undefined, club: clean(body.club, 24), historyRow: body.historyRow, source: 'desk', visitor: 'visitor' in who });
    return json({ ok: true, droppedJobs: dropped });
  }

  /** POST /v1/desk/checkout {night, clubberId, historyRow}. @param {any} body */
  async checkout(body) {
    const night = churchNight(this.now());
    if (body.night !== night) return refuse(400, { reason: 'wrong-night', night });
    const noClub = await this.noClubRefusal();
    if (noClub) return noClub;
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
  async postMeeting(clubberId, what, testDay = false) {
    const client = this.watcher.clientFor();
    if (!client || this.watcher.mode === 'off') return { ok: false, response: refuse(503, { reason: 'not-configured' }) };
    const r = await this.page(Infinity, false, true);
    if (!r.ok) return { ok: false, response: this.pageFailure(r) };
    const res = what === 'undo'
      ? await client.undoCheckIn({ clubberId, calendarId: r.page.calendarId }, { desk: true, ...(testDay ? { testDay: true } : {}) })
      : await client.checkOut({ clubberId, calendarId: r.page.calendarId }, { desk: true });
    if (res.ok) return { ok: true };
    if (AMBIGUOUS.has(res.error)) return { ok: false, response: refuse(504, { reason: 'unsure', retry: true }) };
    return { ok: false, response: refuse(409, { reason: res.error }) };
  }
}
