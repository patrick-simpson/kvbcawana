// The Worker as the ONE publisher (ROADMAP.md#online-check-in, P5; routes.md
// "Single publisher"). With `SINGLE_PUBLISHER = "on"` and cloud check-in running
// it publishes, from its own state, what the check-in laptop's print server used
// to:
//
//   tally     per-club counts of children here now (plaintext numbers)
//   tonight   the lobby ticker's four counters (plaintext numbers)
//   checkout  the still-here list (first name + club, SEALED, padded)
//
// in the printer's frame shapes (frames.js), from the printer's rules
// (lobby/shared/tonight.js: authoritativeTonight / tonightHereNow, and
// lobby/shared/pickup.js: the pickup clubs), applied to the Worker's own state
// (tonight.js: the applied report, the desk's marks), with the printer's timing:
//
//   * on every change (an applied report, a desk check-in, undo or check-out),
//     and every minute while the watch window is open (TALLY_LEAD_MIN = 60
//     before the club window to TALLY_GRACE_MIN = 60 after: `watchWindow` pins
//     the same numbers as the printer's church-config clubNights);
//   * the still-here list ONLY inside that window, coalesced (at least
//     STILL_GAP_MS between two), never at 2 pm on a Tuesday;
//   * the list is filtered by `pickupClubs` (default every club but Trek and
//     Journey), a setting the print server keeps; the station tells the Worker
//     (POST /v1/station/extras), as it does the Screen season and rehearsal
//     flag that ride the tally.
//
// And the gate (`gate()`, called by POST /v1/publish): while the Worker is the
// publisher the laptop's `tally`, `tonight` and `checkout` frames are DROPPED
// (200 {dropped: true}, so the print server owes no resend), and a `checkin`
// greeting goes through only from a registered station (`X-Station`) and only
// ONCE PER CHILD PER NIGHT: the greeting only the station can make (birthday,
// first-timer, milestone: it holds the roster and the history key), named
// either by the job it printed (`X-Job`, printq.greet) or, for a label it printed
// with no job (the phone page's relay job, the extension, a phone visitor), by
// the child in the body (`greet: {clubberId}` or `greet: {name, club}`), which the
// Worker turns into the claim's own tag in memory (never stored). So whichever
// door a child came through, and whichever path then printed (a TwoTimTwo-page
// job that met a label already printed greets LATE, `late: true`, with its job),
// the screens hear them once. A late greeting is dropped while the laptop is
// still the publisher (it greeted the first time). The greeted tags are kept for
// the night only (`publisher:greeted`), purged with the claims. A dropped `tally`
// or `tonight` frame is plaintext numbers, so its season / rehearsal flag and the
// books and awards counts are remembered for the frames the Worker makes.
//
// Free plan: a publish is a few microseconds of counting plus at most one AES
// seal (the still-here list), and the book is written only when it changes.

import { buildStillHere, normalizePickupClubs, pickupClubsOf } from '../../shared/pickup.js';
import { Doc } from './doc.js';
import { buildCheckout, buildTally, buildTonight, CHECKOUT_MAX } from './frames.js';
import { json } from './http.js';
import { localTime, watchWindow } from './watcher.js';

export const MINUTE_MS = 60 * 1000;
/** At least this long between two still-here lists (the printer's debounce). */
export const STILL_GAP_MS = 2000;
/**
 * Rehearsal mode counts only while the station keeps saying so: it posts its
 * extras on a change and at least every minute or two (POST /v1/station/extras),
 * so a laptop that went away armed never leaves the Worker rehearsing.
 */
export const REHEARSAL_FRESH_MS = 5 * 60 * 1000;
/** What the gate drops while the Worker is the publisher. `checkin` has its own rule. */
export const SINGLE_PUBLISHER_DROPS = Object.freeze(['tally', 'checkout', 'tonight']);
const COUNT_MAX = 9999;

/** @param {unknown} v @returns {number|undefined} */
const count = (v) => (Number.isInteger(v) && /** @type {number} */ (v) >= 0 && /** @type {number} */ (v) <= COUNT_MAX ? /** @type {number} */ (v) : undefined);

export class Publisher {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   book: import('./tonight.js').TonightBook, stations: import('./stations.js').Stations,
   *   printq: import('./printq.js').PrintQueue, ledger: import('./ledger.js').Ledger,
   *   tags?: import('./ledger.js').Tags, now: () => number, enabled: () => boolean,
   *   publish: (event: string, payload: unknown, sealed: boolean) => Promise<unknown>,
   *   log?: (line: string) => void }} deps
   */
  constructor({ storage, book, stations, printq, ledger, tags, now, enabled, publish, log }) {
    this.book = book;
    this.tags = tags || null;
    /** Who has been greeted tonight: claim tags (HMACs), never an id or a name. */
    this.greetedDoc = new Doc(storage, 'publisher:greeted', () => ({ night: null, tags: {} }));
    this.stations = stations;
    this.printq = printq;
    this.ledger = ledger;
    this.now = now;
    this.enabled = enabled;
    this.publishFrame = publish;
    this.log = log || ((line) => console.warn(line));
    /** The plaintext, non-PII settings the station (and a dropped frame) hand over. */
    this.extrasDoc = new Doc(storage, 'publisher:extras', () => ({ season: '', rehearsal: false, pickupClubs: null, counters: { night: null, booksCompleted: 0, awardsEarned: 0 } }));
    /** @type {Record<'tally'|'tonight'|'checkout', { sig: string|null, at: number }>} */
    this.last = { tally: { sig: null, at: 0 }, tonight: { sig: null, at: 0 }, checkout: { sig: null, at: 0 } };
    /** What was published since this object started: counts, for the status. */
    this.published = { tally: 0, tonight: 0, checkout: 0, greetings: 0, dropped: 0 };
    this.busy = /** @type {Promise<any>|null} */ (null);
    /** When the station (or a dropped tally) last said rehearsal mode is ON (ms; memory only, 0 = not lately). */
    this.rehearsalHeardAt = 0;
  }

  /**
   * Is the print station's rehearsal mode on right now (armed on the laptop, from
   * /settings Printing → At the laptop; it disarms itself after 2 hours)? Heard
   * within REHEARSAL_FRESH_MS, in this object's memory: after a restart it is off
   * until the station's next post. The desk's club-day guard lets a rehearsal
   * through on a day with no club (desk.js `clubToday`).
   */
  rehearsing() {
    return this.rehearsalHeardAt > 0 && this.now() - this.rehearsalHeardAt <= REHEARSAL_FRESH_MS;
  }

  // ── extras ─────────────────────────────────────────────────────────────────

  /**
   * Take what the station (or a dropped plaintext frame) says. Anything off its
   * shape is ignored, never stored. @param {Record<string, any>} b
   * @returns {Promise<boolean>} whether anything changed
   */
  async setExtras(b) {
    await this.extrasDoc.load();
    const d = this.extrasDoc.data;
    let changed = false;
    if (typeof b.season === 'string' && (b.season === '' || /^[a-z][a-z-]{1,19}$/.test(b.season)) && d.season !== b.season) { d.season = b.season; changed = true; }
    if (typeof b.rehearsal === 'boolean' && d.rehearsal !== b.rehearsal) { d.rehearsal = b.rehearsal; changed = true; }
    if (typeof b.rehearsal === 'boolean') this.rehearsalHeardAt = b.rehearsal ? this.now() : 0;
    if (Array.isArray(b.pickupClubs)) {
      const n = normalizePickupClubs(b.pickupClubs);
      if (n.ok && JSON.stringify(n.value) !== JSON.stringify(d.pickupClubs)) { d.pickupClubs = n.value; changed = true; }
    }
    const books = count(b.booksCompleted);
    const awards = count(b.awardsEarned);
    if (books !== undefined || awards !== undefined) {
      const night = localTime(this.now()).date;
      if (d.counters.night !== night) d.counters = { night, booksCompleted: 0, awardsEarned: 0 };
      if (books !== undefined && d.counters.booksCompleted !== books) { d.counters.booksCompleted = books; changed = true; }
      if (awards !== undefined && d.counters.awardsEarned !== awards) { d.counters.awardsEarned = awards; changed = true; }
    }
    if (changed) await this.extrasDoc.save();
    return changed;
  }

  // ── publishing ─────────────────────────────────────────────────────────────

  /**
   * Publish whatever is due. Never throws; one at a time (a second call while
   * one runs waits for it and then looks again).
   * @param {string} [reason] only for the log
   * @returns {Promise<string[]>} the events published
   */
  async publishDue(reason = 'tick') {
    if (!this.enabled()) return [];
    while (this.busy) await this.busy.catch(() => {});
    this.busy = this.publishNow().finally(() => { this.busy = null; });
    try { return await this.busy; } catch (err) {
      console.error(`[publisher] ${reason} failed`, err);
      return [];
    }
  }

  async publishNow() {
    await Promise.all([this.book.load(), this.extrasDoc.load()]);
    const now = this.now();
    const w = watchWindow(now);
    const x = this.extrasDoc.data;
    /** @type {string[]} */
    const out = [];
    const due = (/** @type {'tally'|'tonight'|'checkout'} */ kind, /** @type {string} */ sig, /** @type {number} */ gap) => {
      const l = this.last[kind];
      return (sig !== l.sig && now - l.at >= gap) || (w.open && now - l.at >= MINUTE_MS);
    };
    const mark = (/** @type {'tally'|'tonight'|'checkout'} */ kind, /** @type {string} */ sig) => { this.last[kind] = { sig, at: now }; this.published[kind] += 1; out.push(kind); };

    const counts = this.book.counts(now);
    const tally = buildTally(counts.byClub, counts.checkedIn, { season: x.season, rehearsal: x.rehearsal }, now);
    const tallySig = JSON.stringify([tally.counts, tally.total, tally.season, tally.rehearsal]);
    if (due('tally', tallySig, 0)) {
      await this.publishFrame('tally', tally, false);
      mark('tally', tallySig);
    }

    const night = localTime(now).date;
    const c = x.counters.night === night ? x.counters : { booksCompleted: 0, awardsEarned: 0 };
    const tonight = buildTonight({ checkedIn: counts.checkedIn, booksCompleted: c.booksCompleted, awardsEarned: c.awardsEarned, friendsBrought: this.book.friends(now) }, now);
    const tonightSig = JSON.stringify([tonight.checkedIn, tonight.booksCompleted, tonight.awardsEarned, tonight.friendsBrought]);
    if (due('tonight', tonightSig, 0)) {
      await this.publishFrame('tonight', tonight, false);
      mark('tonight', tonightSig);
    }

    // The still-here list: names, so never outside the window.
    if (w.open) {
      const entries = buildStillHere(this.book.here(now).children, pickupClubsOf({ pickupClubs: x.pickupClubs }), CHECKOUT_MAX);
      const sig = JSON.stringify(buildCheckout(entries, 0, now).entries);
      if (due('checkout', sig, STILL_GAP_MS)) {
        await this.ledger.load();
        const printed = (await this.ledger.counts(night)).printed;
        await this.publishFrame('checkout', buildCheckout(entries, printed, now), true);
        mark('checkout', sig);
      }
    }
    return out;
  }

  /** The watcher's tick (about every 10 s while the window is open). */
  tick() {
    return this.publishDue('tick');
  }

  /** An applied report (the watcher). @param {Parameters<import('./tonight.js').TonightBook['onReport']>[0]} r */
  async onReport(r) {
    await this.book.onReport(r);
    await this.publishDue('report');
  }

  /** @param {Record<string, any>} e a desk hook event */
  async deskCheckin(e) {
    await this.book.checkin({ night: e.night, clubberId: e.clubberId, tag: e.tag, name: e.name, club: e.club, visitor: e.visitor });
    await this.publishDue('desk-checkin');
  }

  /** @param {Record<string, any>} e */
  async deskUndo(e) {
    await this.book.undo({ night: e.night, clubberId: e.clubberId, tag: e.tag, club: e.club });
    await this.publishDue('desk-undo');
  }

  /** @param {Record<string, any>} e */
  async deskCheckout(e) {
    await this.book.checkout({ night: e.night, clubberId: e.clubberId, tag: e.tag });
    await this.publishDue('desk-checkout');
  }

  /** The window has closed: names and the night's counters go; the next night starts clean. */
  async endOfNight() {
    const n = await this.book.endOfNight();
    await this.greetedDoc.load();
    await this.greetedDoc.drop();
    this.last = { tally: { sig: null, at: 0 }, tonight: { sig: null, at: 0 }, checkout: { sig: null, at: 0 } };
    return n;
  }

  // ── the gate (POST /v1/publish) ────────────────────────────────────────────

  /**
   * What to do with a frame a client posts to /v1/publish. null = relay it as
   * given; otherwise the answer to send instead (the frame is dropped).
   * @param {Request} request @param {string} event @param {any} payload
   * @param {{ greet?: any, late?: boolean }} [meta] what a station's greeting says about itself
   * @returns {Promise<Record<string, any>|null>}
   */
  async gate(request, event, payload, meta = {}) {
    if (!this.enabled()) {
      // The laptop is the publisher and greeted the child when it printed the first
      // label: a late greeting (a TwoTimTwo-page job that met that label) would be a second.
      if (event === 'checkin' && meta.late === true) { this.published.dropped += 1; return { ok: true, screens: 0, dropped: true, reason: 'late' }; }
      return null;
    }
    if (event === 'checkin') return this.gateGreeting(request, meta);
    if (!SINGLE_PUBLISHER_DROPS.includes(event)) return null;
    // Plaintext numbers the Worker's own frames need: remember, then drop.
    if (event === 'tally' && payload && typeof payload === 'object') {
      await this.setExtras({ season: typeof payload.season === 'string' ? payload.season : '', rehearsal: payload.rehearsal === true });
    } else if (event === 'tonight' && payload && typeof payload === 'object') {
      await this.setExtras({ booksCompleted: payload.booksCompleted, awardsEarned: payload.awardsEarned });
    }
    this.published.dropped += 1;
    return { ok: true, screens: 0, dropped: true, reason: 'single-publisher' };
  }

  /**
   * One greeting per child per night, and only a registered station's: named by
   * its print job, or by the child it printed with no job.
   * @param {Request} request @param {{ greet?: any, late?: boolean }} meta
   */
  async gateGreeting(request, meta = {}) {
    const drop = (/** @type {string} */ why) => { this.published.dropped += 1; return { ok: true, screens: 0, dropped: true, reason: why }; };
    const stationId = request.headers.get('X-Station') || '';
    const jobId = request.headers.get('X-Job') || '';
    if (!stationId || (!jobId && !meta.greet)) return drop('single-publisher');
    await this.stations.load();
    if (!this.stations.get(stationId)) return drop('unknown-station');
    const night = localTime(this.now()).date;
    await this.greetedDoc.load();
    if (jobId) {
      const r = await this.printq.greet(jobId, night, (tag) => this.takeChild(night, tag));
      if (!r.ok) return drop(r.reason);
    } else {
      const tag = await this.childTag(night, meta.greet);
      if (!tag) return drop('no-child');
      if (!this.takeChild(night, tag)) return drop('already-greeted');
    }
    await this.greetedDoc.save();
    this.published.greetings += 1;
    return null;
  }

  /**
   * Mark a child greeted tonight. One synchronous step (after greetedDoc.load()):
   * false when they already were. A job with no tag (none) is its own child.
   * @param {string} night @param {string|null} tag
   */
  takeChild(night, tag) {
    const d = this.greetedDoc.data;
    if (d.night !== night) { d.night = night; d.tags = {}; }
    if (!tag) return true;
    if (d.tags[tag]) return false;
    d.tags[tag] = 1;
    return true;
  }

  /**
   * The claim tag of the child a job-less greeting names: `{clubberId}` or a
   * visitor's `{name, club}`. In memory only; null when it names nobody.
   * @param {string} night @param {any} g
   */
  async childTag(night, g) {
    if (!this.tags || !g || typeof g !== 'object') return null;
    const id = typeof g.clubberId === 'string' || typeof g.clubberId === 'number' ? String(g.clubberId).trim() : '';
    if (id) return /^\d{1,12}$/.test(id) ? this.tags.identity(night, id) : null;
    const name = typeof g.name === 'string' ? g.name.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    const club = typeof g.club === 'string' ? g.club.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    return name ? this.tags.visitor(night, name, club) : null;
  }

  // ── status ─────────────────────────────────────────────────────────────────

  /** Counts and times only: never a name. */
  async status() {
    await Promise.all([this.book.load(), this.extrasDoc.load()]);
    const now = this.now();
    const x = this.extrasDoc.data;
    const c = this.book.counts(now);
    return {
      enabled: this.enabled(),
      night: localTime(now).date,
      windowOpen: watchWindow(now).open,
      source: c.source,
      checkedIn: c.checkedIn,
      checkedOut: c.checkedOut,
      byClub: c.byClub,
      reportAgeMs: c.ageMs,
      season: x.season || null,
      rehearsal: x.rehearsal,
      pickupClubs: pickupClubsOf({ pickupClubs: x.pickupClubs }),
      lastPublishedAt: Object.fromEntries(Object.entries(this.last).map(([k, v]) => [k, v.at ? new Date(v.at).toISOString() : null])),
      published: { ...this.published },
    };
  }
}

/** The routes this module owns (routes.md section 8). @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountPublisher(registry, core) {
  // The shared count, for the desk page and the shadow-night comparison.
  registry.add('GET', '/v1/desk/tonight', 'session', async () => {
    const s = await core.publisher.status();
    return json({
      night: s.night, source: s.source, checkedIn: s.checkedIn, checkedOut: s.checkedOut, byClub: s.byClub,
      reportAgeMs: s.reportAgeMs, enabled: s.enabled,
    });
  });
  // The print server's own settings the Worker cannot know: the Screen season,
  // the rehearsal flag and the pickup list's clubs.
  registry.add('POST', '/v1/station/extras', 'station', async ({ body }) => {
    const b = await body();
    const changed = await core.publisher.setExtras(b);
    if (changed) await core.publisher.publishDue('extras');
    return json({ ok: true, changed });
  });
  registry.add('GET', '/v1/publisher/status', 'session', async () => json(await core.publisher.status()));
}
