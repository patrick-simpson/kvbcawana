// @ts-check
// Store night: top every checked-in child up to 10 shares IN TWOTIMTWO (owner
// 2026-11-21: "every kid should have a minimum of 10 ... go in and give them
// enough shares to have 10"; 2026-11-23: "build it that way").
//
// HOW: TwoTimTwo's own one-child form, Clubber → Special Share Awards
// (/clubber/special_shekel/<clubber id>: Meeting, Shares, Why), the page the
// owner pointed at. For each child the applied check-in report lists, on a
// store night only, in a read slot nothing else wanted:
//   1. read the child's form page: the LIVE Share Balance (tonight's attendance
//      share already in it), tonight's meeting in its select, the form's token;
//   2. balance 10 or more: nothing to give (marked `full`);
//   3. else post 10 - balance under tonight's meeting, Why "Store night top-up to 10".
// A child whose before balance (shares.js) + 1 already reaches 10 is never read.
//
// NEVER TWICE: the child is marked `posting` (sealed, written through) BEFORE the
// post. Only a DEFINITE answer moves it on: the page coming back with the new
// balance (`given`), or the form's own error / a refusal (`refused`, nothing
// given). Anything else (no answer, a timeout, an odd page, TwoTimTwo down after
// the post) is `unknown` and is NEVER posted again: a doubled gift is worse than
// a missed one, and /settings counts the unknowns so they can be checked by hand.
// An unknown is LOOKED AT once in a later slot (a read, never a post): a balance
// at 10 by then proves it went in (`given`).
// A Worker restarted mid-post finds `posting` and makes it `unknown`.
//
// KEPT: tonight's marks only, sealed under the state key (`topup:night`, clubber
// ids and numbers, never a name), gone the next night. Store night Off (the
// /settings switch) stops it at once.

import { localTime, openState, sealState, watchWindow } from './watcher.js';
import { documentOf, isLoginPage } from './twotimtwo.js';
import { STORE_MIN } from './shares.js';

export const TOPUP_KEY = 'topup:night';
export const TOPUP_WHY = 'Store night top-up to 10';
/** No single top-up is believed past this (a parse gone wrong must never give 500 shares). */
export const TOPUP_MAX = STORE_MIN;
/** A child whose page could not be read is tried again this many times, then left. */
export const READ_TRIES = 3;

/**
 * The Special Share Awards page of one child: the form's parts and the live balance, or null.
 * @param {string} html
 * @returns {{ token: string, clubberId: string, profileId: string, meetings: { id: string, date: string }[], balance: number|null, errors: boolean }|null}
 */
export function parseSpecialSharePage(html) {
  if (!html || isLoginPage(html)) return null;
  const doc = documentOf(html);
  const form = doc.querySelector('form#clubber-special-shekel-form') || doc.querySelector('form[action*="special_shekel"]');
  const val = (/** @type {string} */ name) => {
    const el = (form || doc).querySelector(`[name="${name}"]`);
    return el ? String(el.getAttribute('value') || '').trim() : '';
  };
  const text = String(doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
  const m = /Share Balance:\s*(-?\d+)/i.exec(text);
  const balance = m ? Number(m[1]) : null;
  if (!form) return { token: '', clubberId: '', profileId: '', meetings: [], balance, errors: false };
  const sel = form.querySelector('select[name="ClubberSpecialShekel[calendar_id]"]');
  const meetings = sel ? [...sel.querySelectorAll('option')].map((o) => ({
    id: String(o.getAttribute('value') || '').trim(),
    date: String(o.textContent || '').trim().slice(0, 10),
  })).filter((o) => /^\d{1,12}$/.test(o.id) && /^\d{4}-\d{2}-\d{2}$/.test(o.date)) : [];
  return {
    token: val('YII_CSRF_TOKEN'),
    clubberId: val('ClubberSpecialShekel[clubber_id]'),
    profileId: val('ClubberSpecialShekel[profile_id]'),
    meetings,
    balance,
    errors: !!(form.querySelector('.errorSummary, .has-error, .error') && /cannot|required|invalid|must/i.test(String(form.textContent || ''))),
  };
}

export class TopUp {
  /**
   * @param {{ storage: any, watcher: any, shares: import('./shares.js').Shares, now: () => number,
   *   secret: () => string|null|undefined }} deps
   */
  constructor({ storage, watcher, shares, now, secret }) {
    this.storage = storage;
    this.watcher = watcher;
    this.shares = shares;
    this.now = now;
    this.secret = secret;
    /** Who the last applied report lists (memory). @type {{ date: string, ids: string[] }|null} */
    this.report = null;
    /** Tonight's marks (opened once). @type {{ date: string, done: Record<string, { s: string, n?: number, tries?: number, v?: boolean }> }|null} */
    this.night = null;
    /** @type {Promise<void>|null} */
    this.opening = null;
    /** A night the Worker's TwoTimTwo user may not open the form: stop asking (memory). */
    this.blockedNight = '';
    /** @type {string|null} */
    this.error = null;
  }

  /** The watcher's applied report: who is checked in. @param {{ date: string, kids: Record<string, string> }} r */
  onReport({ date, kids }) {
    this.report = { date, ids: Object.keys(kids || {}).filter((id) => /^\d{1,20}$/.test(id)) };
  }

  today() { return localTime(this.now()).date; }

  /** Open tonight's marks once; a `posting` left by a restart becomes `unknown`. */
  load() {
    const date = this.today();
    if (this.night && this.night.date === date) return Promise.resolve();
    if (!this.opening) {
      this.opening = (async () => {
        let opened;
        const secret = this.secret();
        try {
          const sealed = await this.storage.get(TOPUP_KEY);
          opened = secret && sealed ? await openState(secret, sealed) : null;
        } catch { opened = null; }
        this.night = opened && opened.date === date && opened.done && typeof opened.done === 'object'
          ? { date, done: opened.done } : { date, done: {} };
        let moved = false;
        for (const v of Object.values(this.night.done)) if (v.s === 'posting') { v.s = 'unknown'; moved = true; }
        if (moved) await this.save();
      })().finally(() => { this.opening = null; });
    }
    return this.opening;
  }

  async save() {
    const secret = this.secret();
    if (!secret || !this.night) throw new Error('no-secret');
    await this.storage.put(TOPUP_KEY, await sealState(secret, this.night));
  }

  /** The next child to look at, or null (sync; after load() and shares.prepare()). */
  next() {
    const date = this.today();
    if (!this.night || this.night.date !== date || this.blockedNight === date) return null;
    if (!watchWindow(this.now()).open || !this.shares.active()) return null;
    const before = this.shares.tonight();
    if (!before || !this.report || this.report.date !== date) return null;
    for (const id of this.report.ids) {
      const d = this.night.done[id];
      if (d && d.s === 'unknown' && !d.v) return id;   // one look, never a second post
      if (d && (d.s !== 'read-failed' || (d.tries || 0) >= READ_TRIES)) continue;
      const b = before[id];
      if (b !== undefined && b + 1 >= STORE_MIN) continue;   // already at 10 with tonight's share
      return id;
    }
    return null;
  }

  /** ms until a child waits (0) or null. */
  wakeInMs() { return this.next() === null ? null : 0; }

  /** @param {string} id @param {{ s: string, n?: number, tries?: number, v?: boolean }} mark */
  async mark(id, mark) {
    if (!this.night) return;
    this.night.done[id] = mark;
    await this.save();
  }

  /**
   * One child, in a free slot (the alarm's turn; waitMs 0). true when it did something.
   */
  async step() {
    await this.load();
    const id = this.next();
    if (id === null) return false;
    const client = this.watcher.clientFor();
    if (!client) return false;
    if (this.watcher.budget.peek(false) !== 0) return false;
    const date = this.today();
    const had = this.night?.done[id];
    const tries = (had && had.s === 'read-failed' ? had.tries || 0 : 0) + 1;

    const page = await client.page(`/clubber/special_shekel/${id}`, { waitMs: 0, kind: 'topup' });
    if (!page.ok) {
      if (had && had.s === 'unknown') { await this.mark(id, { s: 'unknown', n: had.n, v: true }); return true; }
      if (page.error === 'read-busy' || page.error === 'login-backoff' || page.error === 'twotimtwo-down') return false;
      if (/^http-40[13]$/.test(page.error)) {
        this.blockedNight = date;
        this.error = 'no-permission';
        console.warn('[topup] the Worker\'s TwoTimTwo user may not open Special Share Awards');
        return true;
      }
      await this.mark(id, { s: 'read-failed', tries });
      return true;
    }
    const f = parseSpecialSharePage(page.html);
    // An unclear answer is looked at ONCE: a balance at 10 now proves it went in. Otherwise it stays
    // unknown (an attendance share could have moved the number): never posted again.
    if (had && had.s === 'unknown') {
      await this.mark(id, f && f.balance !== null && f.balance >= STORE_MIN ? { s: 'given', n: had.n } : { s: 'unknown', n: had.n, v: true });
      return true;
    }
    if (!f || f.balance === null) { await this.mark(id, { s: 'read-failed', tries }); this.error = 'page-unreadable'; return true; }
    if (f.balance >= STORE_MIN) { await this.mark(id, { s: 'full' }); return true; }
    const meeting = f.meetings.find((mm) => mm.date === date);
    if (f.clubberId !== id || !f.token || !f.profileId || !meeting) {
      await this.mark(id, { s: 'read-failed', tries });
      this.error = meeting ? 'form-unreadable' : 'no-meeting-tonight';
      return true;
    }
    const give = STORE_MIN - Math.max(0, f.balance);
    if (give < 1 || give > TOPUP_MAX) { await this.mark(id, { s: 'full' }); return true; }

    // Marked BEFORE the post: a crash, a timeout or an odd answer never posts again.
    await this.mark(id, { s: 'posting', n: give });
    const r = await client.giveSpecialShares({
      clubberId: id, calendarId: meeting.id, profileId: f.profileId, token: f.token, shares: give, why: TOPUP_WHY, expect: f.balance + give,
    });
    await this.mark(id, { s: r.outcome, n: give });
    if (r.outcome === 'given') this.error = null;
    else console.warn(`[topup] a top-up came back ${r.outcome}${r.error ? ` (${r.error})` : ''}`);
    return true;
  }

  /** For /settings: counts only, never an id, a name or a balance. */
  view() {
    const date = this.today();
    /** @type {Record<string, number>} */
    const counts = { given: 0, shares: 0, full: 0, unknown: 0, refused: 0, waiting: 0 };
    if (this.night && this.night.date === date) {
      for (const v of Object.values(this.night.done)) {
        if (v.s === 'given') { counts.given += 1; counts.shares += v.n || 0; }
        else if (v.s === 'full') counts.full += 1;
        else if (v.s === 'unknown' || v.s === 'posting') counts.unknown += 1;
        else if (v.s === 'refused' || (v.s === 'read-failed' && (v.tries || 0) >= READ_TRIES)) counts.refused += 1;
      }
    }
    const before = this.shares.tonight();
    if (this.night && this.report && this.report.date === date && before && this.shares.active()) {
      for (const id of this.report.ids) {
        const d = this.night.done[id];
        if (d && !(d.s === 'read-failed' && (d.tries || 0) < READ_TRIES)) continue;
        const b = before[id];
        if (b === undefined || b + 1 < STORE_MIN) counts.waiting += 1;
      }
    }
    return { ...counts, error: this.blockedNight === date ? 'no-permission' : this.error };
  }
}
