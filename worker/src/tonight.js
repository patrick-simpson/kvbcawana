// The Worker's own "who is here tonight" (ROADMAP.md#online-check-in, P5): the
// state that the SHARED rules (lobby/shared/tonight.js, the very code the print
// server runs) are applied to when the Worker is the one publisher.
//
//   the applied report   what the watcher read (never a partial or a refused one):
//                        per child the clubber id, the FIRST name and the club
//   desk rows            a desk check-in, undo or check-out: the child's first
//                        name and club, the person's removal (`undoneBy:'desk'`
//                        beats the report) and the check-out marks
//
// PRIVACY, the one place the Worker keeps names (owner's rule: names are sealed;
// this is the second exception after friends.js): the book holds FIRST NAMES +
// CLUBS (and a clubber id) of tonight's children, in memory and in Durable Object
// storage ONLY as one AES-GCM blob sealed under the Worker's state key (HKDF from
// the TwoTimTwo password secret, watcher.js sealState): a copy of the storage
// alone opens nothing. NEVER a last name (a visitor with no id is keyed by its
// HMAC visitorTag), never a birthday, allergy or note. It exists to name the
// still-here list (the pickup board shows first names), which the Worker can
// only do from what it has seen tonight; it is purged with the claims when the
// watch window closes (`endOfNight`). Why not the station? A station is a
// laptop that may restart or be off mid-night, and the pickup list must not go
// quiet or stale with it: the Worker already holds these names in memory for
// every check-in it greets or prints (adopt.js), so keeping them sealed for
// the night adds an at-rest copy, not a new reader. Free plan: one AES-GCM
// seal of a few KB per change (about a millisecond), written only on a change.

import { REPORT_FRESH_MS, authoritativeTonight, tonightHereNow, tonightRows, normalizedName, splitFullName } from '../../lobby/shared/tonight.js';
import { Doc } from './doc.js';
import { localTime, openState, sealState } from './watcher.js';

/** More children than this in one night is a bug, not a Wednesday. */
export const ROWS_MAX = 1000;
/** A report that only moved in time is persisted at most this often. */
export const PERSIST_EVERY_MS = 60 * 1000;

/**
 * @typedef {{ firstName: string, lastName: string, clubName: string, clubberId?: string, visitor?: boolean,
 *   timestamp: string, undone?: boolean, undoneBy?: string }} Row
 * @typedef {{ clubberId: string, firstName: string, club: string, friend?: boolean }} ReportKid
 * @typedef {{ night: string, rows: Record<string, Row>, report: { at: number, entries: ReportKid[] }|null,
 *   out: { ids: string[], names: string[] } }} Book
 */

/** @param {string} night @returns {Book} */
const freshBook = (night) => ({ night, rows: {}, report: null, out: { ids: [], names: [] } });

/** @param {string} id */
const idKey = (id) => `id:${String(id).trim()}`;

/** A visitor's row key and its (opaque) last name: the HMAC tag stands in for the surname. @param {string} first @param {string} tag */
const visitorKey = (first, tag) => `name:${normalizedName(`${first} ${tag}`)}`;

export class TonightBook {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   secret: () => string|null|undefined, now: () => number, names?: () => boolean }} deps
   */
  constructor({ storage, secret, now, names }) {
    this.secret = secret;
    /** First names are kept only while the Worker publishes the still-here list (SINGLE_PUBLISHER on): shadow counts need none. */
    this.keepNames = names || (() => true);
    this.now = now;
    this.doc = new Doc(storage, 'tonight:book', () => ({ sealed: null }));
    /** In memory, authoritative while the object runs. @type {Book|null} */
    this.mem = null;
    this.loading = /** @type {Promise<void>|null} */ (null);
    this.dirty = false;
    this.persistedAt = 0;
  }

  load() {
    if (!this.loading) {
      this.loading = (async () => {
        await this.doc.load();
        const secret = this.secret();
        const stored = secret && this.doc.data.sealed ? await openState(secret, this.doc.data.sealed) : null;
        if (this.mem === null && stored && stored.night && stored.rows) this.mem = stored;
      })();
    }
    return this.loading;
  }

  /** The book of `night` (a new one when the night has turned). @param {string} night @returns {Book} */
  book(night) {
    if (!this.mem || this.mem.night !== night) {
      this.mem = freshBook(night);
      this.dirty = true;
    }
    return this.mem;
  }

  /** Write the book sealed, when it changed (or has only aged for a while). @param {boolean} [force] */
  async save(force = false) {
    const secret = this.secret();
    if (!secret || !this.mem) return;
    if (!force && !this.dirty && this.now() - this.persistedAt < PERSIST_EVERY_MS) return;
    this.doc.data.sealed = await sealState(secret, this.mem);
    await this.doc.save();
    this.dirty = false;
    this.persistedAt = this.now();
  }

  // ── what the report says ───────────────────────────────────────────────────

  /**
   * An APPLIED report (never a partial or a refused one). Children newly on it
   * are alive again (a desk undo is lifted when TwoTimTwo lists the child
   * afresh), children gone from it were undone on TwoTimTwo. Entries keep only
   * the clubber id, the FIRST name and the club.
   * @param {{ night: string, at: number, entries: { clubberId: string, name?: string, club?: string, friend?: boolean }[] }} r
   */
  async onReport({ night, at, entries }) {
    await this.load();
    const b = this.book(night);
    const prev = new Set((b.report?.entries || []).map((e) => e.clubberId));
    /** @type {ReportKid[]} */
    const kids = [];
    const seen = new Set();
    for (const e of entries) {
      if (seen.has(e.clubberId)) continue;
      seen.add(e.clubberId);
      kids.push({
        clubberId: e.clubberId, firstName: this.keepNames() ? splitFullName(e.name).firstName : '', club: String(e.club || ''),
        ...(e.friend ? { friend: true } : {}),
      });
    }
    let changed = JSON.stringify(b.report?.entries || null) !== JSON.stringify(kids);
    for (const kid of kids) {
      const row = b.rows[idKey(kid.clubberId)];
      if (!row || !row.undone) continue;
      // A removal made at the desk holds until TwoTimTwo lists the child anew; a
      // removal the report itself made (no undoneBy) ends when it lists them again.
      if (!row.undoneBy || !prev.has(kid.clubberId)) { delete b.rows[idKey(kid.clubberId)]; changed = true; }
    }
    // Gone from the report: undone on TwoTimTwo's own page (the shared mass-undo
    // guard already refused a read that dropped more than half the room).
    if (b.report) {
      for (const id of prev) {
        if (seen.has(id)) continue;
        const row = b.rows[idKey(id)];
        if (row && !row.undone) { row.undone = true; changed = true; }
      }
    }
    b.report = { at, entries: kids };
    if (changed) this.dirty = true;
    await this.save();
    return changed;
  }

  // ── what the desk did ──────────────────────────────────────────────────────

  /**
   * A desk check-in: the child's first name and club, newest at `at`.
   * @param {{ night: string, clubberId?: string, tag?: string, name: string, club?: string, visitor?: boolean, at?: number }} c
   */
  async checkin({ night, clubberId, tag, name, club, visitor, at }) {
    await this.load();
    const b = this.book(night);
    const first = splitFullName(name).firstName;
    if (!first) return false;
    const key = clubberId ? idKey(clubberId) : visitorKey(first, tag || '');
    if (!clubberId && !tag) return false;
    if (!b.rows[key] && Object.keys(b.rows).length >= ROWS_MAX) return false;
    b.rows[key] = {
      firstName: this.keepNames() ? first : '', lastName: clubberId ? `#${clubberId}` : String(tag), clubName: String(club || ''),
      ...(clubberId ? { clubberId: String(clubberId) } : {}), ...(visitor ? { visitor: true } : {}),
      timestamp: new Date(at ?? this.now()).toISOString(),
    };
    this.dirty = true;
    await this.save();
    return true;
  }

  /**
   * A desk undo: a person's removal beats the report until TwoTimTwo lists the
   * child anew. The child's first name comes from the row or the report.
   * @param {{ night: string, clubberId?: string, tag?: string, club?: string }} u
   */
  async undo({ night, clubberId, tag, club }) {
    await this.load();
    const b = this.book(night);
    if (clubberId) {
      const key = idKey(clubberId);
      const fromReport = b.report?.entries.find((e) => e.clubberId === String(clubberId));
      const row = b.rows[key] || {
        firstName: this.keepNames() ? fromReport?.firstName || 'child' : '', lastName: `#${clubberId}`, clubName: fromReport?.club || String(club || ''),
        clubberId: String(clubberId), timestamp: new Date(this.now()).toISOString(),
      };
      row.undone = true;
      row.undoneBy = 'desk';
      b.rows[key] = row;
    } else if (tag) {
      const key = Object.keys(b.rows).find((k) => b.rows[k].visitor && b.rows[k].lastName === tag);
      if (!key) return false;
      b.rows[key].undone = true;
      b.rows[key].undoneBy = 'desk';
    } else return false;
    this.dirty = true;
    await this.save();
    return true;
  }

  /** A desk check-out: off every count. @param {{ night: string, clubberId?: string, tag?: string }} o */
  async checkout({ night, clubberId, tag }) {
    await this.load();
    const b = this.book(night);
    if (clubberId) {
      if (!b.out.ids.includes(String(clubberId))) b.out.ids.push(String(clubberId));
    } else if (tag) {
      const row = Object.values(b.rows).find((r) => r.visitor && r.lastName === tag);
      if (!row) return false;
      const n = normalizedName(`${row.firstName} ${row.lastName}`);
      if (!b.out.names.includes(n)) b.out.names.push(n);
    } else return false;
    this.dirty = true;
    await this.save();
    return true;
  }

  // ── what the shared rules read ─────────────────────────────────────────────

  /**
   * The state the shared module counts: tonight's rows newest first, the
   * applied report, the check-outs, and the church's local day.
   * @param {number} now
   */
  state(now = this.now()) {
    const night = localTime(now).date;
    const b = this.mem && this.mem.night === night ? this.mem : freshBook(night);
    const history = Object.values(b.rows).sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp));
    return {
      night,
      tonight: tonightRows(history, night, { onDay: () => true }),
      report: b.report ? { at: b.report.at, entries: b.report.entries } : null,
      checkedOut: { date: b.night, ids: new Set(b.out.ids), names: new Set(b.out.names) },
      dayOf: (/** @type {number} */ ms) => localTime(ms).date,
    };
  }

  /** The counts, by the shared rules. @param {number} [now] */
  counts(now = this.now()) {
    return authoritativeTonight(this.state(now), now);
  }

  /** Who is here, by the shared rules. @param {number} [now] */
  here(now = this.now()) {
    return tonightHereNow(this.state(now), now);
  }

  /** How many children the applied report marks Brought a friend (a fresh report only). @param {number} [now] */
  friends(now = this.now()) {
    const s = this.state(now);
    const r = s.report;
    return r && now - r.at >= 0 && now - r.at <= REPORT_FRESH_MS ? r.entries.filter((e) => e.friend).length : 0;
  }

  /** The clubber ids the applied report marks Brought a friend tonight (barf.js: who may not bring a second). (after load) @param {number} [now] */
  friendIds(now = this.now()) {
    const r = this.state(now).report;
    return r ? r.entries.filter((e) => e.friend).map((e) => e.clubberId) : [];
  }

  /** The end of the night: every name goes. */
  async endOfNight() {
    await this.load();
    const had = this.mem ? Object.keys(this.mem.rows).length + (this.mem.report?.entries.length || 0) : 0;
    this.mem = null;
    this.dirty = false;
    await this.doc.drop();
    return had;
  }
}
