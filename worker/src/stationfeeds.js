// What the print stations need from TwoTimTwo besides the check-ins (owner
// 2026-10-16: the Chrome extension goes; the Worker takes over the four things
// only it still did). Three of them live here, all run from the watcher's alarm
// on the ONE read clock (readbudget.js, 5 s; routes.md section 7 says how the
// slots are shared); the fourth, the Checkout page's hand-made check-outs, is
// ymcheckout.js's (it already reads that page).
//
//   the roster        TwoTimTwo's roster export (/clubber/csv), what every label is
//                     enriched from: allergies (in Notes), birthday, group, photo
//                     consent. Read about hourly in the watch window, once a day
//                     outside it, and at once when a station asks with a stale or
//                     missing copy. The household's addresses, phones, emails and
//                     payments are left out (twotimtwo.js trimRosterCsv). SEALED to
//                     every registered station (cloud-crypto sealForStations,
//                     kind 'roster', record {csv}), served by GET /v1/station/roster.
//   completed books   /report/completed_books per club (the extension's runCompletedBooks:
//                     clubs 2-6, the last 21 days, every 10 min in the club window),
//                     merged into ONE sealed bundle (kind 'books', record
//                     {entries: [{name, book, date}]}), GET /v1/station/books: the
//                     handbook trophy band on a child's next label.
//   the meeting report /meeting/report?output=csv (the extension's runTonight): tonight's
//                     books and awards counts go into the Worker's own `tonight`
//                     frame (publisher.setExtras), every 5 min in the club window;
//                     each award slip becomes ONE sealed `/print-award` job (a
//                     reprint-kind job, routes.md section 6), at most once per child
//                     per award per night (an HMAC of the night, name and award;
//                     never a stored name), and only once EVERY registered station
//                     runs KVBC Awana 10.0.0 or newer (SLIPS_FROM_VERSION): an older
//                     laptop still has the extension, which prints its own slips.
//
// THE FREE PLAN'S 10 ms OF CPU. A read is one invocation (the alarm's), its seal
// another: sealing a roster to a station is AES of the padded record plus one ECDH
// (test/stationfeeds.test.js measures it), so the read keeps the trimmed roster
// in MEMORY only and each following alarm tick seals it to ONE station (`sealOne`),
// SPILL_MS apart, until every station has its copy; then the bundle is stored and
// the plaintext dropped. The ECIES entries of one item are independent, so one
// bundle's `to` list is built a station at a time. An award slip is sealed (to every
// station: a small record, as adopt.js seals a job) one per tick the same way. A
// restarted object loses a seal under way and reads again: the plaintext never
// rests in storage.
//
// WHAT RESTS. `station:roster` / `station:books`: the bundle (ciphertext sealed to
// station keys only: the medical notes are never sealed to the history key or the
// state key), when it was read, how many rows, and a keyed digest of the plaintext
// (so an unchanged roster is not sealed again). `feeds:status`: counts, times and
// fixed error codes. `awards:slipped`: tonight's HMAC tags. `feeds:slips`: award slips
// waiting for their seal, sealed under the state key (sealState, as the youth
// check-out and the adopter's backlog), for the night only. A partial or failed read
// keeps the last good copy.

import { newRowId, sealForStations } from '../../lobby/shared/cloud-crypto.js';
import { PRINT_JOB_KIND } from './adopt.js';
import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { trimRosterCsv } from './twotimtwo.js';
import { CLUB_NIGHTS, localTime, openState, sealState, watchWindow } from './watcher.js';

/** In the watch window, a roster older than this is read again. */
export const ROSTER_FRESH_MS = 60 * 60 * 1000;
/** After a failed roster read, the next try waits this long. */
export const ROSTER_RETRY_MS = 10 * 60 * 1000;
/** Completed books: a pass (one read per club) this often in the club window (the extension's 10 min). */
export const BOOKS_MS = 10 * 60 * 1000;
/** The meeting report this often in the club window. */
export const MEETING_MS = 5 * 60 * 1000;
/** The clubs whose completed books are read: the printer's church-config.json `sharesClubIds` (the extension's list). */
export const BOOK_CLUB_IDS = Object.freeze([2, 3, 4, 5, 6]);
/** The extension's look-back for the completed-books report, and its per-club cap. */
export const BOOKS_LOOKBACK_DAYS = 21;
export const BOOKS_PER_CLUB_MAX = 300;
/** The print server keeps at most this many entries a post (feeds.js COMPLETED_BOOKS_MAX). */
export const BOOKS_MAX = 500;
/** New award slips taken from one read (the extension's AWARD_SLIP_CAP); the rest wait for the next. */
export const SLIP_CAP = 10;
/**
 * The first KVBC Awana with no Chrome extension: the roster and books are served to
 * a station on it, and award slips and the meeting report are the Worker's once no
 * station runs anything older (`modern` / `slipsOpen` below).
 */
export const FEEDS_FROM_VERSION = '10.0.0';
export const SLIPS_FROM_VERSION = FEEDS_FROM_VERSION;
/**
 * A station not heard from (no heartbeat, else since it registered) for this long
 * is a computer that has gone: it no longer holds the hand-over back (owner review
 * 2026-10-16: one dead laptop on 9.x kept award slips from ever printing).
 */
export const STALE_STATION_MS = 7 * 24 * 60 * 60 * 1000;
/** Between two seal ticks. */
export const SEAL_SPILL_MS = 1000;
/** A roster that drops below half of the last good one is taken only when a second read agrees. */
const SHRINK_MIN = 20;
const SLIPS_MAX = 200;
/**
 * Award slips HMAC-tagged in one read (each tag is one HMAC; with the parse, the
 * seal of the status and the publish it must stay well inside the free plan's
 * 10 ms of CPU). A report with more rows is walked in turns: each read starts where
 * the last stopped (`slipCursor`, memory only), so every slip is reached.
 */
export const SLIPS_PER_READ_MAX = 40;

/** @param {string} hm */
const minutesOf = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/** Inside a club night's own hours (the extension's isInClubWindow: CLUB_NIGHTS start to end, local). @param {number} ms */
export function inClubHours(ms) {
  const t = localTime(ms);
  return CLUB_NIGHTS.some((n) => n.dow === t.dow && t.minutes >= minutesOf(n.start) && t.minutes < minutesOf(n.end));
}

/** 'X.Y.Z' at least `min`? @param {unknown} v @param {string} min */
export function versionAtLeast(v, min) {
  const a = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || ''));
  const b = /^(\d+)\.(\d+)\.(\d+)$/.exec(min);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return true;
}

/** YYYY-MM-DD, `days` before the church's date of `ms`. @param {number} ms @param {number} days */
function daysBefore(ms, days) {
  const [y, m, d] = localTime(ms).date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/** SHA-256 of a text, hex (cheap: native). @param {string} text */
async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const freshStatus = () => ({
  roster: { readAt: 0, tries: 0, reads: 0, rows: 0, columns: 0, error: /** @type {string|null} */ (null), errorAt: 0, shrunkTo: 0, sealedAt: 0 },
  books: { at: 0, readAt: 0, passes: 0, entries: 0, clubsRead: 0, error: /** @type {string|null} */ (null), sealedAt: 0 },
  meeting: { at: 0, readAt: 0, night: /** @type {string|null} */ (null), booksCompleted: 0, awardsEarned: 0, slipsQueued: 0, slipsHeld: 0, error: /** @type {string|null} */ (null) },
});

export class StationFeeds {
  /**
   * @param {{ storage: { get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> },
   *   watcher: import('./watcher.js').Watcher, stations: import('./stations.js').Stations,
   *   printq: import('./printq.js').PrintQueue, tags: import('./ledger.js').Tags,
   *   publisher?: import('./publisher.js').Publisher|null, now: () => number, log?: (line: string) => void }} deps
   */
  constructor({ storage, watcher, stations, printq, tags, publisher, now, log }) {
    this.storage = storage;
    this.watcher = watcher;
    this.stations = stations;
    this.printq = printq;
    this.tags = tags;
    this.publisher = publisher || null;
    this.now = now;
    this.log = log || ((line) => console.warn(line));
    this.statusDoc = new Doc(storage, 'feeds:status', freshStatus);
    this.rosterDoc = new Doc(storage, 'station:roster', () => ({ bundle: null, night: null, readAt: 0, rows: 0, digest: null }));
    this.booksDoc = new Doc(storage, 'station:books', () => ({ bundle: null, night: null, readAt: 0, rows: 0, digest: null }));
    this.slippedDoc = new Doc(storage, 'awards:slipped', () => ({ night: null, tags: {} }));
    this.slipsDoc = new Doc(storage, 'feeds:slips', () => ({ sealed: null }));
    /** A seal under way (memory only): the plaintext record and the stations still to seal it to. @type {{ kind: 'roster'|'books', id: string, night: string, record: any, rows: number, digest: string, at: number, targets: {publicKey: string, kid: string}[], to: any[] }|null} */
    this.pending = null;
    /** The completed-books pass under way (memory only: it holds names). @type {{ night: string, idx: number, entries: any[], read: number }|null} */
    this.pass = null;
    /** A station asked with a stale or missing roster / books copy. */
    this.wanted = { roster: false, books: false };
    /** Award slips waiting for their seal (opened from feeds:slips). @type {{ night: string, list: { name: string, clubName: string, award: string }[] }|null} */
    this.slips = null;
    /** Where the next read's award-slip pass starts (memory only; a restart starts at 0). */
    this.slipCursor = { night: '', at: 0 };
    /** @type {Promise<void>|null} */
    this.loading = null;
  }

  secret() { return this.watcher.creds()?.password || null; }

  load() {
    if (!this.loading) {
      this.loading = (async () => {
        await Promise.all([this.statusDoc.load(), this.rosterDoc.load(), this.booksDoc.load(), this.slippedDoc.load(), this.slipsDoc.load(), this.stations.load(), this.printq.load()]);
        this.statusDoc.data = { ...freshStatus(), ...this.statusDoc.data };
        const secret = this.secret();
        const opened = secret ? await openState(secret, this.slipsDoc.data.sealed) : null;
        if (this.slips === null) this.slips = opened && Array.isArray(opened.list) ? opened : { night: '', list: [] };
      })().catch((err) => { this.loading = null; throw err; });
    }
    return this.loading;
  }

  get st() { return this.statusDoc.data; }

  /** Is the Worker reading TwoTimTwo at all (cloud check-in on, a TwoTimTwo user), and is this loaded? */
  get on() { return this.statusDoc.data !== null && this.rosterDoc.data !== null && this.watcher.mode !== 'off' && !!this.watcher.creds(); }

  /** Does this bundle hold a copy for every registered station, and nobody else? @param {any} bundle */
  covers(bundle) {
    const want = this.stations.all().map((s) => s.kid);
    if (!bundle || !Array.isArray(bundle.to) || !want.length) return false;
    const have = new Set(bundle.to.map((/** @type {any} */ w) => w && w.kid));
    return have.size === want.length && want.every((k) => have.has(k));
  }

  /**
   * THE HAND-OVER (owner 2026-10-16: the 9.4.9 laptop keeps working unchanged until
   * KVBC Awana 10.0.0 installs). A station's app version comes with its heartbeat
   * (stations.js `version`). While a station runs anything older it still has the
   * Chrome extension, which syncs the roster and books and prints award slips itself:
   *   modern()  at least one station on FEEDS_FROM_VERSION: the roster and the books
   *             are read for it (and served only to such a station: an older one is
   *             answered 404, as before these routes existed)
   *   slipsOpen() at least one station and none older: award slips print from here.
   *             The meeting report is read either way (its counts are the TVs'), and
   *             while an older station prints its own slips each one is only MARKED,
   *             so a laptop updated in the middle of a club night never gets a second
   *             slip for an award its extension already printed
   */
  modern() {
    return this.stations.all().some((s) => versionAtLeast(s.version, FEEDS_FROM_VERSION));
  }

  /** The stations heard from (heartbeat, else registration) within STALE_STATION_MS. */
  live() {
    const now = this.now();
    return this.stations.all().filter((s) => {
      const at = Date.parse(s.lastSeenAt || s.registeredAt || '');
      return Number.isFinite(at) && now - at < STALE_STATION_MS;
    });
  }

  /** The live stations still on an app older than FEEDS_FROM_VERSION (id, name, version: no key). */
  oldStations() {
    return this.live().filter((s) => !versionAtLeast(s.version, FEEDS_FROM_VERSION))
      .map((s) => ({ stationId: s.stationId, name: s.name, version: s.version || null }));
  }

  /** No LIVE station runs anything older (a station gone a week does not count). */
  noOld() {
    return this.oldStations().length === 0;
  }

  slipsOpen() {
    return this.live().length > 0 && this.noOld();
  }

  /** Tonight's slips only marked because an old station prints its own (0 on another night). */
  slipsHeldTonight() {
    const m = this.st.meeting;
    return m.night === localTime(this.now()).date ? m.slipsHeld : 0;
  }

  // ── what is due ────────────────────────────────────────────────────────────

  /** The roster wants a read now (after load). */
  rosterDue() {
    if (!this.on || !this.modern() || (this.pending && this.pending.kind === 'roster')) return false;
    const now = this.now();
    const r = this.st.roster;
    if (r.errorAt && now - r.errorAt < ROSTER_RETRY_MS) return false;
    const doc = this.rosterDoc.data;
    if (this.wanted.roster || !doc.bundle || !this.covers(doc.bundle)) return true;
    if (watchWindow(now).open) return now - doc.readAt >= ROSTER_FRESH_MS;
    return localTime(doc.readAt).date !== localTime(now).date;
  }

  /** The completed books want a read (a pass under way, or one due). @param {boolean} urgent only when overdue */
  booksDue(urgent = false) {
    if (!this.on || !this.modern() || (this.pending && this.pending.kind === 'books')) return false;
    const now = this.now();
    if (!inClubHours(now)) return false;
    if (this.pass && this.pass.night === localTime(now).date) return true;
    const age = now - this.st.books.at;
    return age >= (urgent ? 2 * BOOKS_MS : BOOKS_MS) || (!urgent && this.wanted.books);
  }

  /** The meeting report wants a read. @param {boolean} urgent only when overdue */
  meetingDue(urgent = false) {
    if (!this.on) return false;
    const now = this.now();
    if (!inClubHours(now)) return false;
    return now - this.st.meeting.at >= (urgent ? 2 * MEETING_MS : MEETING_MS);
  }

  /** A seal is waiting (CPU work, no read). */
  sealDue() {
    if (this.pending) return true;
    if (this.stations.doc.data === null) return false;
    return !!(this.slips && this.slips.list.length && this.stations.all().length);
  }

  /**
   * The read the alarm should make, or null. `urgent`: only what may go ahead of
   * the desk roster's read-ahead: the roster (child safety, about once an hour)
   * and a completed-books pass or meeting report that has waited two of its turns.
   * @param {boolean} urgent
   * @returns {'roster'|'books'|'meeting'|null}
   */
  readDue(urgent) {
    if (this.rosterDue()) return 'roster';
    if (this.meetingDue(urgent)) return 'meeting';
    if (this.booksDue(urgent)) return 'books';
    return null;
  }

  /** How long until something here wants the alarm (ms), or null. */
  wakeInMs() {
    if (!this.on) return null;
    if (this.sealDue()) return 0;
    const now = this.now();
    if (this.readDue(false)) return 0;
    /** @type {number[]} */
    const waits = [];
    if (this.modern()) {
      const r = this.st.roster;
      if (r.errorAt && now - r.errorAt < ROSTER_RETRY_MS) waits.push(r.errorAt + ROSTER_RETRY_MS - now);
      else if (watchWindow(now).open && this.rosterDoc.data.readAt) waits.push(this.rosterDoc.data.readAt + ROSTER_FRESH_MS - now);
    }
    if (inClubHours(now)) {
      waits.push(this.st.meeting.at + MEETING_MS - now);
      if (this.modern()) waits.push(this.st.books.at + BOOKS_MS - now);
    }
    const pos = waits.filter((w) => Number.isFinite(w));
    return pos.length ? Math.max(0, Math.min(...pos)) : null;
  }

  // ── the alarm's turns ──────────────────────────────────────────────────────

  /**
   * One read, if one is due and the clock has a free slot (waitMs 0: the alarm
   * never queues). true when it made (or tried) one.
   * @param {boolean} urgent
   */
  async step(urgent) {
    await this.load();
    if (this.watcher.budget.peek(false) !== 0) return false;
    const which = this.readDue(urgent);
    if (which === 'roster') return this.readRoster();
    if (which === 'meeting') return this.readMeeting();
    if (which === 'books') return this.readBooksClub();
    return false;
  }

  /** The closed window's turn (no report then): a seal, else a once-a-day roster read. @param {number} next @returns {Promise<{ did: boolean, next: number }>} */
  async onClosedAlarm(next) {
    try {
      await this.load();
      let did = false;
      if (this.sealDue()) did = await this.sealOne();
      else if (this.rosterDue() && this.watcher.budget.peek(false) === 0) did = await this.readRoster();
      const wake = this.sealDue() ? SEAL_SPILL_MS : this.rosterDue() ? Math.max(this.watcher.budget.peek(false), 1000) : null;
      return { did, next: wake === null ? next : Math.min(next, Math.max(wake, 1000)) };
    } catch (err) {
      console.error('[feeds] closed-window step failed', err);
      return { did: false, next };
    }
  }

  /** A station asked for a copy it does not have (or an old one): read soon, even with the window closed. @param {'roster'|'books'} kind */
  async want(kind) {
    this.wanted[kind] = true;
    if (!this.on) return;
    try {
      const at = await this.watcher.alarms.get();
      const soon = this.now() + 1000;
      if (!(typeof at === 'number' && at > this.now() && at <= soon + SEAL_SPILL_MS)) await this.watcher.alarms.set(soon);
    } catch (err) { console.error('[feeds] could not set the alarm', err); }
  }

  // ── the roster ─────────────────────────────────────────────────────────────

  async readRoster() {
    const client = this.watcher.clientFor();
    if (!client) return false;
    const res = await client.rosterCsv({ waitMs: 0, kind: 'roster-csv' });
    if (!res.ok && res.error === 'read-busy') return false;
    const now = this.now();
    const r = this.st.roster;
    r.tries += 1;
    if (!res.ok) {
      r.error = res.error;
      r.errorAt = now;
      this.log(`[feeds] the roster export was not read (${res.error}); the stations keep their last copy`);
      await this.statusDoc.save();
      return true;
    }
    const rows = res.roster.rows.length;
    const prev = this.rosterDoc.data.rows || 0;
    // A roster that suddenly lost more than half its children (a filter, a changed
    // export) is not taken on one read: the next read must agree.
    if (prev >= SHRINK_MIN && rows < prev / 2 && r.shrunkTo !== rows) {
      r.shrunkTo = rows;
      r.error = 'roster-shrunk';
      r.errorAt = now;
      await this.statusDoc.save();
      return true;
    }
    if (!rows) {
      r.error = 'roster-empty';
      r.errorAt = now;
      await this.statusDoc.save();
      return true;
    }
    const { csv, columns } = trimRosterCsv(res.roster);
    r.reads += 1;
    r.rows = rows;
    r.columns = columns;
    r.error = null;
    r.errorAt = 0;
    r.shrunkTo = 0;
    r.readAt = now;
    this.wanted.roster = false;
    await this.queueSeal('roster', { csv }, rows, now, this.rosterDoc);
    await this.statusDoc.save();
    return true;
  }

  /**
   * Hold a record for sealing (memory only), or, when the stored bundle already
   * holds this very plaintext for every station, just note the fresh read.
   * @param {'roster'|'books'} kind @param {any} record @param {number} rows @param {number} at @param {Doc} doc
   */
  async queueSeal(kind, record, rows, at, doc) {
    const secret = this.secret();
    const digest = secret ? (await this.tags.visitor('1970-01-01', await sha256Hex(JSON.stringify(record)), `digest|${kind}`)) || '' : '';
    if (digest && doc.data.digest === digest && this.covers(doc.data.bundle)) {
      doc.data.readAt = at;
      await doc.save();
      return;
    }
    const night = localTime(at).date;
    this.pending = {
      kind, id: newRowId(), night, record, rows, digest, at,
      targets: this.stations.all().map((s) => ({ publicKey: s.pub, kid: s.kid })), to: [],
    };
  }

  /** One seal: one station's copy of the bundle under way, else one award slip's job. true when it sealed. */
  async sealOne() {
    await this.load();
    const p = this.pending;
    if (p) {
      const target = p.targets[p.to.length];
      if (target) {
        const one = await sealForStations([{ publicKey: target.publicKey }], { id: p.id, night: p.night, kind: p.kind, record: p.record });
        if (!one) {
          // Fail closed: nothing is stored that a station could not read.
          this.pending = null;
          this.log(`[feeds] the ${p.kind} could not be sealed to a station; the last copy stays`);
          return false;
        }
        p.to.push(one.to[0]);
      }
      if (p.to.length >= p.targets.length) {
        const doc = p.kind === 'roster' ? this.rosterDoc : this.booksDoc;
        doc.data = { bundle: { v: 1, id: p.id, night: p.night, kind: p.kind, to: p.to }, night: p.night, readAt: p.at, rows: p.rows, digest: p.digest };
        await doc.save();
        this.st[p.kind].sealedAt = this.now();
        await this.statusDoc.save();
        this.pending = null;   // the plaintext goes with it
        this.wanted[p.kind] = false;
      }
      return true;
    }
    return this.sealSlip();
  }

  // ── completed books ────────────────────────────────────────────────────────

  async readBooksClub() {
    const client = this.watcher.clientFor();
    if (!client) return false;
    const now = this.now();
    const night = localTime(now).date;
    if (!this.pass || this.pass.night !== night) this.pass = { night, idx: 0, entries: [], read: 0 };
    const clubId = BOOK_CLUB_IDS[this.pass.idx];
    const res = await client.completedBooks(clubId, daysBefore(now, BOOKS_LOOKBACK_DAYS), night, { waitMs: 0, kind: 'completed-books' });
    if (!res.ok && res.error === 'read-busy') return false;
    const b = this.st.books;
    // One club that cannot be read is skipped, as the extension did (a club with
    // no report); the stations merge every entry they get.
    if (res.ok) {
      this.pass.entries.push(...res.entries.slice(0, BOOKS_PER_CLUB_MAX));
      this.pass.read += 1;
    } else b.error = res.error;
    this.pass.idx += 1;
    if (this.pass.idx >= BOOK_CLUB_IDS.length) {
      const pass = this.pass;
      this.pass = null;
      b.at = now;
      b.passes += 1;
      b.clubsRead = pass.read;
      if (pass.read) {
        b.readAt = now;
        b.entries = Math.min(pass.entries.length, BOOKS_MAX);
        if (pass.read === BOOK_CLUB_IDS.length) b.error = null;
        this.wanted.books = false;
        await this.queueSeal('books', { entries: pass.entries.slice(-BOOKS_MAX) }, b.entries, now, this.booksDoc);
      }
    }
    await this.statusDoc.save();
    return true;
  }

  // ── the meeting report and the award slips ─────────────────────────────────

  async readMeeting() {
    const client = this.watcher.clientFor();
    if (!client) return false;
    const status = await this.watcher.loadStatus();
    const night = localTime(this.now()).date;
    const cal = status && status.date === night && status.checkinPage && status.checkinPage.ok ? String(status.checkinPage.calendarId || '') : '';
    const res = await client.meetingReport(cal, { waitMs: 0, kind: 'meeting-report' });
    if (!res.ok && res.error === 'read-busy') return false;
    const m = this.st.meeting;
    m.at = this.now();
    if (!res.ok) {
      // The last good counts stay (the extension's zeros on a failed read told the lobby nobody read a book).
      m.error = res.error;
      await this.statusDoc.save();
      return true;
    }
    m.error = null;
    m.readAt = m.at;
    if (m.night !== night) { m.slipsQueued = 0; m.slipsHeld = 0; }   // the counts are a night's
    m.night = night;
    m.booksCompleted = res.report.booksCompleted;
    m.awardsEarned = res.report.awardsEarned;
    await this.statusDoc.save();
    if (this.publisher) {
      try {
        if (await this.publisher.setExtras({ booksCompleted: res.report.booksCompleted, awardsEarned: res.report.awardsEarned })) await this.publisher.publishDue('meeting-report');
      } catch (err) { console.error('[feeds] the meeting counts could not be published', err); }
    }
    await this.takeSlips(night, res.report.slips);
    return true;
  }

  /**
   * The report's award slips: each child and award once a night (an HMAC tag in
   * `awards:slipped`). While a station still runs an app older than
   * SLIPS_FROM_VERSION (the extension prints its own slips) they are only marked,
   * so the hand-over never prints one twice. @param {string} night @param {{ name: string, clubName: string, award: string }[]} slips
   */
  async takeSlips(night, slips) {
    const secret = this.secret();
    if (!secret || !Array.isArray(slips) || !slips.length) return;
    const d = this.slippedDoc.data;
    if (d.night !== night) { d.night = night; d.tags = {}; }
    if (!this.slips || this.slips.night !== night) this.slips = { night, list: [] };
    const open = this.slipsOpen();
    let taken = 0;
    let changed = false;
    // An HMAC per slip: at most SLIPS_PER_READ_MAX a read (the free plan's CPU), taken
    // in turns from where the last read stopped, so a longer report is still walked whole.
    if (this.slipCursor.night !== night) this.slipCursor = { night, at: 0 };
    const n = Math.min(slips.length, SLIPS_PER_READ_MAX);
    const start = this.slipCursor.at % slips.length;
    const turn = Array.from({ length: n }, (_, i) => slips[(start + i) % slips.length]);
    this.slipCursor.at = slips.length > SLIPS_PER_READ_MAX ? start + n : 0;
    for (const s of turn) {
      if (!s || !s.name || !s.award) continue;
      const tag = await this.tags.visitor(night, s.name, `award|${s.award}`);
      if (!tag || d.tags[tag]) continue;
      if (open) {
        if (taken >= SLIP_CAP || this.slips.list.length >= SLIPS_MAX) continue;
        this.slips.list.push({ name: String(s.name).slice(0, 80), clubName: String(s.clubName || '').slice(0, 40), award: String(s.award).slice(0, 80) });
        taken += 1;
        this.st.meeting.slipsQueued += 1;
      } else {
        this.st.meeting.slipsHeld += 1;
      }
      d.tags[tag] = 1;
      changed = true;
    }
    if (!changed) return;
    await this.saveSlips();
    await this.slippedDoc.save();
    await this.statusDoc.save();
  }

  async saveSlips() {
    const secret = this.secret();
    if (!secret || !this.slips) return;
    this.slipsDoc.data.sealed = this.slips.list.length ? await sealState(secret, this.slips) : null;
    await this.slipsDoc.save();
  }

  /** One award slip sealed to every station and queued as a `/print-award` job. */
  async sealSlip() {
    if (!this.slips || !this.slips.list.length || !this.stations.all().length) return false;
    const night = localTime(this.now()).date;
    if (this.slips.night !== night) {
      this.slips = { night, list: [] };
      await this.saveSlips();
      return false;
    }
    const s = /** @type {{ name: string, clubName: string, award: string }} */ (this.slips.list.shift());
    await this.saveSlips();
    const record = { route: '/print-award', body: { name: s.name, clubName: s.clubName, award: s.award } };
    const bundle = await sealForStations(this.stations.sealTargets(), { id: newRowId(), night, kind: PRINT_JOB_KIND, record });
    if (!bundle) { this.log('[feeds] an award slip could not be sealed to the stations; it was not queued'); return false; }
    const r = await this.printq.enqueue({ jobId: `reprint:${crypto.randomUUID()}`, kind: 'reprint', night, bundle });
    if (!r.ok) this.log(`[feeds] the print queue refused an award slip (${r.reason})`);
    return true;
  }

  /** The window has closed: tonight's slips waiting for a seal go (the tags roll at the next night). */
  async endOfNight() {
    await this.load();
    this.pass = null;
    if (this.slips && this.slips.list.length) {
      this.slips = { night: '', list: [] };
      await this.saveSlips();
    }
  }

  // ── the routes' halves ─────────────────────────────────────────────────────

  /**
   * GET /v1/station/roster | books: the newest bundle, whatever night it was read
   * (a roster does not change with the night), and a read asked for when this
   * station has no copy in it or it is stale. @param {'roster'|'books'} kind @param {string} stationId
   */
  async serve(kind, stationId) {
    await this.load();
    const doc = kind === 'roster' ? this.rosterDoc.data : this.booksDoc.data;
    const me = this.stations.get(stationId);
    // An app older than 10.0.0 still syncs its own (its extension): answered as before these routes existed.
    if (!me || !versionAtLeast(me.version, FEEDS_FROM_VERSION)) return fail('Not found.', 404, { reason: 'old-app', from: FEEDS_FROM_VERSION });
    const mine = !!(doc.bundle && doc.bundle.to.some((/** @type {any} */ w) => w && w.kid === me.kid));
    const sealing = !!(this.pending && this.pending.kind === kind);
    if (!sealing && (kind === 'roster' ? this.rosterDue() || !mine : !mine && inClubHours(this.now()))) await this.want(kind);
    if (!mine) return fail(doc.bundle ? 'Not sealed to this station yet: it is being read again.' : 'Nothing read yet.', 404, { reason: doc.bundle ? 'resealing' : 'none' });
    return json({ bundle: doc.bundle, night: doc.night, readAt: new Date(doc.readAt).toISOString(), rows: doc.rows });
  }

  /** For GET /v1/cloud/status: counts and times only, never a name. */
  async statusView() {
    await this.load().catch(() => {});
    const iso = (/** @type {number} */ t) => (t ? new Date(t).toISOString() : null);
    const s = this.st;
    return {
      roster: { readAt: iso(this.rosterDoc.data.readAt), rows: this.rosterDoc.data.rows, columns: s.roster.columns, stations: this.rosterDoc.data.bundle ? this.rosterDoc.data.bundle.to.length : 0, error: s.roster.error, reads: s.roster.reads, freshMin: ROSTER_FRESH_MS / 60000 },
      books: { readAt: iso(this.booksDoc.data.readAt), entries: this.booksDoc.data.rows, clubsRead: s.books.clubsRead, clubs: BOOK_CLUB_IDS.length, error: s.books.error, everyMin: BOOKS_MS / 60000 },
      meeting: { readAt: iso(s.meeting.readAt), booksCompleted: s.meeting.booksCompleted, awardsEarned: s.meeting.awardsEarned, slipsQueued: s.meeting.slipsQueued, slipsHeld: s.meeting.slipsHeld, slipsOpen: this.slipsOpen(), slipsFrom: SLIPS_FROM_VERSION, error: s.meeting.error, everyMin: MEETING_MS / 60000 },
      // While tonight's slips are held, which live stations hold them (owner review 2026-10-16).
      handOver: { from: FEEDS_FROM_VERSION, modern: this.modern(), noOld: this.noOld(), staleDays: STALE_STATION_MS / 86400000, slipsHeld: this.slipsHeldTonight(), oldStations: this.slipsHeldTonight() > 0 ? this.oldStations() : [] },
      sealing: this.pending ? { kind: this.pending.kind, done: this.pending.to.length, of: this.pending.targets.length } : null,
      slipsWaiting: this.slips ? this.slips.list.length : 0,
    };
  }
}

/**
 * The routes this module owns (routes.md section 4): GET only. There is no way to
 * hand the Worker a roster or to take TwoTimTwo's raw export out of it (owner
 * review 2026-10-16: the raw export holds addresses, phones and medical notes, and a
 * PUT could replace the roster with one whose Notes are blank); the Worker reads,
 * trims and seals the roster itself. @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountStationFeeds(registry, core) {
  registry.add('GET', '/v1/station/roster', 'station', ({ stationId }) => core.feeds.serve('roster', /** @type {string} */ (stationId)));
  registry.add('GET', '/v1/station/books', 'station', ({ stationId }) => core.feeds.serve('books', /** @type {string} */ (stationId)));
}
