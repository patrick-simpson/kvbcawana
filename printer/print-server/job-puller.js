// The print role's half of online check-in (ROADMAP.md#online-check-in, P2):
// this computer, a registered STATION, takes ALL its print jobs from the sync
// Worker instead of the Chrome extension or the phone relay's job route. The
// Worker's side is lobby/worker/src/routes.md section 6 (the one truth); the
// loop is modelled on phone-relay.js.
//
//   next       GET  /v1/print/next?max=1   -> {jobs: [{jobId, kind, night, gen, bundle, leaseUntil, attempt}], leaseMs,
//                                              church?: {rev, switchesRev}}   (handed to onChurch, never awaited)
//   done       POST /v1/print/done {jobId, result: printed | already-spooled}
//   failed     POST /v1/print/failed {jobId, error?}   (frees the job for another lease)
//   heartbeat  POST /v1/print/heartbeat {printer: {state, detail?}, jobId?, version?, churchRev?}   every 30 s, and
//              every HEARTBEAT_MS while a job prints: with a jobId it EXTENDS the
//              90 s lease (a long print keeps it); {ok: false, reason} says stop
//
// A job's `bundle` is sealed to the stations' keys (cloud-crypto openAsStation);
// its record is {route, body, clubberId?, gen?, source?}: the route is one of
// JOB_PULL_ROUTES (the print routes this computer already has), the body is
// that route's own JSON. A check-in job's `jobId` is its bundle's id; a reprint's
// is `reprint:<uuid>` and its bundle keeps its own 22-character id. The Worker
// seals a TwoTimTwo-page check-in itself with source 'ttt'. `gen` comes from the
// LEASE (the Worker's own claim generation, plaintext); a record's own gen is
// only the fallback.
// The route runs on THIS print server, from loopback, so every existing rule
// (dedup, enrichment, history, attendance, the label itself) applies unchanged.
//
// AT MOST ONCE (owner). A label that came out twice is worse than one that did
// not come out. Every jobId is journalled locally (print-journal.json) as
// `spooling` BEFORE the route is called and `printed` once it answers:
//   * a job the journal already holds is never printed again: it is acked
//     (`printed` when the journal says it came out, `already-spooled` when it
//     was mid-print or its outcome is unknown) and, for the unknown ones, the
//     status raises CHECK THE PRINTER until someone clears it;
//   * a second jobId for the same night:child:generation is the same tag: not
//     printed either (and printedTonightFor() in server.js still backstops it);
//   * a print that gets NO answer (the server died, the request timed out) is
//     `unknown`: acked already-spooled at once, never retried;
//   * only a DEFINITE refusal (an HTTP error answer from the route) frees the
//     job for another lease (`failed`).
// The ack comes AFTER the print returns; an ack that did not get through is
// retried every round (the journal remembers it), and a Worker that no longer
// has the job (404 / 409 / 410: an undo dropped it) ends it quietly.
'use strict';

const fs = require('fs');
const path = require('path');
const cc = require('./cloud-crypto');

// Every print route a job may run: check-in tags, a reprint, BARF bags and tags, custom
// and one-off labels, leader tags, award slips. Nothing that changes settings.
const JOB_PULL_ROUTES = Object.freeze([
  ['POST', /^\/print$/],
  ['POST', /^\/reprint$/],
  ['POST', /^\/print-barf-bags$/],
  ['POST', /^\/print-barf-tag$/],   // 9.3.1: a late BARF friend's tag (routes.md 5.1)
  ['POST', /^\/print-custom$/],
  ['POST', /^\/print-oneoff$/],
  ['POST', /^\/print-leader$/],
  ['POST', /^\/print-award$/],
  ['POST', /^\/print-welcome$/],   // 9.4.8: the youth page's check-in, the TV's welcome without a label
]);
/** A child's check-in job: the label, or (youth page) the welcome alone. */
const CHECKIN_ROUTES = new Set(['/print', '/print-welcome']);

const jobPullAllowed = (method, p) => typeof method === 'string' && typeof p === 'string'
  && JOB_PULL_ROUTES.some(([m, re]) => m === method && re.test(p));

const JOB_ID_RE = /^(?:[A-Za-z0-9_-]{22}|reprint:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const IDLE_MS = 5 * 1000;
const BUSY_MS = 1000;
const SIGNED_OUT_MS = 60 * 1000;
const ROUTE_MISSING_MS = 60 * 1000;
const FAIL_PAUSE_MS = 10 * 1000;
/** Failure codes of a job that can never print, on any station: the Worker marks it dead at once. */
const MALFORMED = new Set(['no-payload', 'bundle-id-mismatch', 'route-not-allowed', 'stale-night']);
const HELLO_MS = 30 * 1000;
const HEARTBEAT_MS = 20 * 1000;
const LOCAL_TIMEOUT_MS = 60 * 1000;
const JOURNAL_KEEP_MS = 4 * 24 * 60 * 60 * 1000;
const ACK_TRIES_MAX = 30;
const BUNDLE_MS = 60 * 1000;

/** The Worker keeps an error as a short code (a-z, 0-9, hyphen, 32 at most), else just 'failed'. */
const shortCode = (e) => String(e).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'failed';

// ── the journal ─────────────────────────────────────────────────────────────

/**
 * print-journal.json: { v, jobs: { [jobId]: entry }, keys: { [night:child:gen]: jobId } }.
 * Written synchronously (tmp + rename) on every change: the `spooling` line
 * must be on disk before the printer is touched.
 * @param {string|null} file null keeps it in memory (tests)
 * @param {() => number} [now]
 */
function createJournal(file, now = Date.now) {
  /** @type {{ v: number, jobs: Record<string, any>, keys: Record<string, string> }} */
  let data = { v: 1, jobs: {}, keys: {} };
  if (file) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw && raw.jobs && typeof raw.jobs === 'object') data = { v: 1, jobs: raw.jobs, keys: raw.keys && typeof raw.keys === 'object' ? raw.keys : {} };
    } catch { /* none yet, or damaged: start empty (a damaged journal cannot be trusted either way) */ }
  }
  // A job that was `spooling` when this process stopped may or may not have
  // come out: it is unknown now, whatever the old process meant to do next.
  for (const e of Object.values(data.jobs)) if (e && e.state === 'spooling') e.state = 'unknown';
  prune();

  function prune() {
    const cutoff = now() - JOURNAL_KEEP_MS;
    for (const [id, e] of Object.entries(data.jobs)) {
      if (!e || typeof e.at !== 'number' || e.at < cutoff) delete data.jobs[id];
    }
    for (const [k, id] of Object.entries(data.keys)) if (!data.jobs[id]) delete data.keys[k];
  }

  function save() {
    if (!file) return;
    const tmp = `${file}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);
  }

  return {
    get: (id) => data.jobs[id] || null,
    byKey: (key) => (data.keys[key] ? { jobId: data.keys[key], entry: data.jobs[data.keys[key]] || null } : null),
    /** Before the printer is touched. */
    begin(id, entry) {
      data.jobs[id] = { state: 'spooling', at: now(), acked: false, ackTries: 0, ...entry };
      if (entry && entry.key) data.keys[entry.key] = id;
      save();
    },
    set(id, patch) {
      const e = data.jobs[id];
      if (!e) return;
      Object.assign(e, patch);
      save();
    },
    /** A definite failure: nothing was spooled, so the job (and its key) may run again. */
    remove(id) {
      const e = data.jobs[id];
      if (e && e.key && data.keys[e.key] === id) delete data.keys[e.key];
      delete data.jobs[id];
      save();
    },
    /** Entries whose ack has not got through. */
    unacked: () => Object.entries(data.jobs).filter(([, e]) => e && !e.acked && (e.state === 'printed' || e.state === 'unknown')).map(([id, e]) => ({ id, ...e })),
    /** Spooled with an unknown outcome and not yet looked at: CHECK THE PRINTER. */
    unchecked: () => Object.entries(data.jobs).filter(([, e]) => e && e.state === 'unknown' && !e.checked).map(([id]) => id),
    clearChecks() {
      for (const e of Object.values(data.jobs)) if (e && e.state === 'unknown') e.checked = true;
      save();
    },
    size: () => Object.keys(data.jobs).length,
  };
}

// ── jobs ────────────────────────────────────────────────────────────────────

/**
 * @param {{
 *   signedIn: () => ({ base: string, session: string } | null),
 *   stationId: () => string,
 *   ring: () => Promise<any>,
 *   localBase: string,
 *   request: (base: string, path: string, opts?: any) => Promise<{ ok: boolean, status: number, body: any }>,
 *   journal: ReturnType<typeof createJournal>,
 *   fetchFn?: typeof fetch,
 *   log?: Function,
 *   now?: () => number,
 *   heartbeatMs?: number,
 *   setIntervalFn?: typeof setInterval,
 *   onPrinted?: (info: { jobId: string, record: any, night: string, result: any }) => any,
 *   onChurch?: (rev: number, switchesRev: number) => any,
 *   heartbeatExtras?: () => ({ version?: string, churchRev?: number }),
 * }} o
 */
function createJobPuller(o) {
  const log = o.log || (() => {});
  const now = o.now || Date.now;
  const fetchFn = o.fetchFn || globalThis.fetch;
  const setIntervalFn = o.setIntervalFn || setInterval;
  const heartbeatMs = o.heartbeatMs || HEARTBEAT_MS;
  const journal = o.journal;
  const inFlight = new Set();
  let pausedUntil = 0;
  let lastHelloAt = 0;
  const stats = { lastLeaseAt: 0, printed: 0, failed: 0, dropped: 0, duplicates: 0, signedOut: false, routeMissing: false, lastError: '' };

  // What every heartbeat adds (routes.md 10.3): this app's version and the church
  // settings rev it has applied, so /settings can tell a station that cannot follow
  // a runtime switch, or one that has not applied the newest church settings.
  const extras = () => {
    if (typeof o.heartbeatExtras !== 'function') return {};
    try {
      const x = o.heartbeatExtras() || {};
      const out = {};
      if (typeof x.version === 'string' && /^\d{1,4}\.\d{1,5}\.\d{1,6}$/.test(x.version)) out.version = x.version;
      if (Number.isInteger(x.churchRev) && x.churchRev >= 0) out.churchRev = x.churchRev;
      return out;
    } catch { return {}; }
  };

  const call = (p, opts = {}) => {
    const s = o.signedIn();
    if (!s) return Promise.resolve({ ok: false, status: 0, body: null });
    return o.request(s.base, p, { ...opts, session: s.session, station: o.stationId() });
  };

  async function ack(jobId, result, error) {
    const failed = result === 'failed';
    const r = failed
      ? await call('/v1/print/failed', { method: 'POST', body: { jobId, ...(error ? { error: shortCode(error) } : {}) } })
      : await call('/v1/print/done', { method: 'POST', body: { jobId, result } });
    if (r.ok) { journal.set(jobId, { acked: true }); return true; }
    if (r.status === 404 || r.status === 409 || r.status === 410) {
      // The Worker no longer has the job (an undo dropped it, or another
      // station finished it): there is nothing to retry.
      journal.set(jobId, { acked: true, dropped: true });
      stats.dropped++;
      log(`[jobs] ${jobId}: the service no longer has it (${r.status}); not retrying the ack`);
      return true;
    }
    return false;
  }

  /** Acks that did not get through, oldest first. A journalled job is never printed again, whatever happens here. */
  async function flushAcks() {
    for (const e of journal.unacked()) {
      const tries = (e.ackTries || 0) + 1;
      if (tries > ACK_TRIES_MAX) { journal.set(e.id, { acked: true, gaveUp: true }); continue; }
      journal.set(e.id, { ackTries: tries });
      await ack(e.id, e.state === 'printed' ? 'printed' : 'already-spooled');
    }
  }

  async function openJob(job) {
    if (!job.bundle) return { ok: false, error: 'no-payload' };
    // A check-in job's id IS its bundle's id; a reprint's bundle keeps its own.
    if (!job.jobId.startsWith('reprint:') && job.bundle.id !== job.jobId) return { ok: false, error: 'bundle-id-mismatch' };
    const ring = await o.ring();
    if (!ring) return { ok: false, error: 'no-station-key' };
    const rec = await cc.openAsStation(ring, job.bundle);
    if (!rec || typeof rec !== 'object') return { ok: false, error: 'cannot-open' };
    // The Worker's own claim generation wins over anything the sealing client wrote.
    const gen = Number.isInteger(job.gen) ? job.gen : rec.gen;
    return { ok: true, record: { ...rec, gen, night: job.bundle.night, source: rec.source || 'desk' } };
  }

  async function localPost(route, body) {
    try {
      const res = await fetchFn(`${o.localBase}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}), signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
      });
      let parsed = null;
      try { parsed = await res.json(); } catch { /* not JSON */ }
      return { answered: true, status: res.status, body: parsed };
    } catch (e) {
      return { answered: false, error: e && e.message };
    }
  }

  async function failJob(id, error) {
    stats.failed++;
    stats.lastError = String(error);
    // A job no station could ever run (malformed) is not the printer's fault: no pause,
    // so the queue behind it moves on at once (and the Worker calls it dead at once).
    if (!MALFORMED.has(error)) pausedUntil = now() + FAIL_PAUSE_MS;
    await ack(id, 'failed', error);
    return 'failed';
  }

  /** A job this journal already holds: never printed again. */
  async function priorJob(id, prior) {
    stats.duplicates++;
    if (prior.state === 'printed') {
      await ack(id, 'printed');
      return 'already-printed';
    }
    if (prior.state === 'spooling') journal.set(id, { state: 'unknown' });
    log(`[jobs] ${id} was already sent to the printer: not printing it again (check the printer)`);
    await ack(id, 'already-spooled');
    return 'already-spooled';
  }

  async function handleOne(job) {
    const id = job.jobId;
    const prior = journal.get(id);
    if (prior) return priorJob(id, prior);
    if (job.undone === true || job.dropped === true) {
      stats.dropped++;
      await ack(id, 'failed', 'undone');
      return 'dropped';
    }
    const opened = await openJob(job);
    if (!opened.ok) return failJob(id, opened.error);
    const rec = opened.record;
    if (!rec.body || typeof rec.body !== 'object' || Array.isArray(rec.body) || !jobPullAllowed('POST', rec.route)) {
      return failJob(id, 'route-not-allowed');
    }
    const night = typeof rec.night === 'string' ? rec.night : cc.churchNight(now());
    if (CHECKIN_ROUTES.has(rec.route) && night !== cc.churchNight(now())) return failJob(id, 'stale-night');
    // Every /print this station pulls is a cloud check-in (the print server's own
    // duplicate rule), and a second generation (an undo, then a new check-in)
    // is a NEW tag: the Worker's gen and the journal below are what stop a
    // second label of one generation, so the server's own rule steps aside.
    if (CHECKIN_ROUTES.has(rec.route)) {
      // `cloudJob` names this job to the print route, so the greeting it makes goes to the
      // Worker with the job (the one greeting per check-in the single publisher lets through).
      rec.body = { ...rec.body, cloud: true, cloudJob: id };
      if (Number.isInteger(rec.gen) && rec.gen > 1) rec.body.regen = true;
    }

    // The backstop: the same child, the same night, the same generation (an
    // undo and a new check-in is the next one) is one tag, whatever the jobId.
    const childId = rec.clubberId != null ? rec.clubberId : rec.body.clubberId;
    const key = CHECKIN_ROUTES.has(rec.route) && childId != null && String(childId).trim()
      ? `${night}:${String(childId).trim()}:${Number.isInteger(rec.gen) ? rec.gen : 0}` : '';
    if (key) {
      const same = journal.byKey(key);
      if (same && same.jobId !== id && same.entry) {
        stats.duplicates++;
        journal.begin(id, { state: same.entry.state === 'printed' ? 'printed' : 'unknown', route: rec.route, night, dupOf: same.jobId });
        log(`[jobs] ${id}: ${key} already has a tag (job ${same.jobId}); not printing a second`);
        await ack(id, same.entry.state === 'printed' ? 'printed' : 'already-spooled');
        return 'duplicate-key';
      }
    }

    journal.begin(id, { route: rec.route, night, key });   // on disk BEFORE the printer is touched
    const beat = setIntervalFn(() => {
      // Extends the lease (90 s) while the printer works; {ok: false} cannot stop a print already sent.
      call('/v1/print/heartbeat', { method: 'POST', body: { printer: { state: 'busy', detail: 'printing' }, jobId: id, ...extras() } })
        .then((r) => { if (r && r.body && r.body.ok === false) log(`[jobs] ${id}: the lease is gone (${r.body.reason}); the print carries on`); })
        .catch(() => {});
    }, heartbeatMs);
    if (beat && beat.unref) beat.unref();
    let res;
    try { res = await localPost(rec.route, rec.body); } finally { clearInterval(beat); }

    if (!res.answered) {
      // No answer: it may be in the spooler. Never retried.
      journal.set(id, { state: 'unknown' });
      log(`[jobs] ${id}: no answer from the print route (${res.error}); it may have printed: check the printer`);
      await ack(id, 'already-spooled');
      return 'unknown';
    }
    const body = res.body;
    if (res.status >= 200 && res.status < 300 && !(body && body.success === false)) {
      journal.set(id, { state: 'printed' });
      stats.printed++;
      if (typeof o.onPrinted === 'function') {
        try { await o.onPrinted({ jobId: id, record: rec, night, result: body }); } catch (e) { log(`[jobs] after-print hook: ${e && e.message}`); }
      }
      await ack(id, 'printed');
      return body && body.duplicate ? 'printed-duplicate' : 'printed';
    }
    // A definite refusal: nothing went to the printer, so the job may run again.
    journal.remove(id);
    return failJob(id, (body && body.error) || `HTTP ${res.status}`);
  }

  /** One job. Never throws. @returns {Promise<string>} what became of it */
  async function handle(job) {
    const id = job && job.jobId;
    if (typeof id !== 'string' || !JOB_ID_RE.test(id)) return 'invalid';
    if (inFlight.has(id)) { stats.duplicates++; return 'duplicate-in-flight'; }
    inFlight.add(id);
    try { return await handleOne(job); } catch (e) {
      stats.lastError = e && e.message;
      log(`[jobs] ${id}: ${e && e.message}`);
      return 'error';
    } finally { inFlight.delete(id); }
  }

  async function hello(force) {
    if (!force && now() - lastHelloAt < HELLO_MS) return;
    lastHelloAt = now();
    const check = journal.unchecked().length > 0;
    await call('/v1/print/heartbeat', { method: 'POST', body: { printer: check ? { state: 'error', detail: 'A label may not have come out' } : { state: 'ok' }, ...extras() } });
  }

  /** One round: acks owed, hello, lease, run. Never throws. */
  async function tick() {
    try {
      if (!o.signedIn()) { stats.signedOut = true; return { wait: SIGNED_OUT_MS, handled: 0 }; }
      stats.signedOut = false;
      await flushAcks();
      await hello(false);
      if (now() < pausedUntil) return { wait: Math.min(IDLE_MS, pausedUntil - now()) || BUSY_MS, handled: 0 };
      const r = await call('/v1/print/next?max=1', { method: 'GET' });
      stats.lastLeaseAt = now();
      if (r.status === 401) { stats.signedOut = true; return { wait: SIGNED_OUT_MS, handled: 0 }; }
      if (r.status === 404 || r.status === 405 || r.status === 501) { stats.routeMissing = true; return { wait: ROUTE_MISSING_MS, handled: 0 }; }
      stats.routeMissing = false;
      if (!r.ok || !r.body) return { wait: IDLE_MS, handled: 0 };
      // routes.md 10.3: the lease also says which church settings and switches are current.
      // Handed on, never awaited: printing never waits on the church settings.
      const ch = r.body.church;
      if (ch && typeof ch === 'object' && typeof o.onChurch === 'function') {
        try { Promise.resolve(o.onChurch(Number(ch.rev) || 0, Number(ch.switchesRev) || 0)).catch(() => {}); } catch (e) { log(`[jobs] church hook: ${e && e.message}`); }
      }
      const jobs = Array.isArray(r.body.jobs) ? r.body.jobs : [];
      let handled = 0;
      for (const job of jobs) { await handle(job); handled++; }
      return { wait: handled ? BUSY_MS : IDLE_MS, handled };
    } catch (e) {
      log(`[jobs] ${e && e.message}`);
      return { wait: IDLE_MS, handled: 0 };
    }
  }

  function status() {
    return {
      lastLeaseAt: stats.lastLeaseAt || null,
      printed: stats.printed, failed: stats.failed, dropped: stats.dropped, duplicates: stats.duplicates,
      inFlight: inFlight.size,
      signedOut: stats.signedOut, routeMissing: stats.routeMissing, lastError: stats.lastError || null,
      // Jobs that went to the printer and may not have come out.
      checkThePrinter: journal.unchecked(),
    };
  }

  return { tick, handle, flushAcks, status, clearChecks: () => journal.clearChecks() };
}

// ── the roster and the completed books (sealed to stations) ────────────────

/**
 * Pull `roster` and `books` bundles (GET /v1/station/roster?night=, .../books?night=),
 * open them with this station's key and feed THIS print server's own loopback
 * paths: /update-csv {csv} and /feed/completed-books {entries}. A bundle is
 * applied once (its id is remembered); a missing one (404) is simply not there yet.
 *
 * Record shapes (sealed by the station that read them from TwoTimTwo):
 *   roster {csv: "<the roster CSV>"}      books {entries: [{name, book, date}]}
 */
function createBundleSync(o) {
  const log = o.log || (() => {});
  const fetchFn = o.fetchFn || globalThis.fetch;
  const now = o.now || Date.now;
  const applied = { roster: '', books: '' };
  const state = { roster: null, books: null };

  const local = async (route, body) => {
    try {
      const res = await fetchFn(`${o.localBase}${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
      });
      return res.status;
    } catch { return 0; }
  };

  async function one(kind, route, feed) {
    const s = o.signedIn();
    if (!s) return 'signed-out';
    const night = cc.churchNight(now());
    const r = await o.request(s.base, `/v1/station/${route}?night=${night}`, { session: s.session, station: o.stationId() });
    if (r.status === 404 || r.status === 405 || r.status === 501) return 'none';
    if (!r.ok || !r.body || !r.body.bundle) return r.ok ? 'none' : 'error';
    const bundle = r.body.bundle;
    const marker = `${night}:${bundle.id}`;
    if (applied[kind] === marker) return 'unchanged';
    const ring = await o.ring();
    if (!ring) return 'no-key';
    const rec = await cc.openAsStation(ring, bundle);
    if (!rec || typeof rec !== 'object') { log(`[station] the ${kind} bundle does not open for this station`); return 'cannot-open'; }
    const status = await feed(rec);
    if (status >= 200 && status < 300) { applied[kind] = marker; state[kind] = { at: now(), night }; return 'applied'; }
    return 'refused';
  }

  async function syncOnce() {
    const out = {};
    out.roster = await one('roster', 'roster', (rec) => (typeof rec.csv === 'string' && rec.csv.trim() ? local('/update-csv', { csv: rec.csv }) : 0));
    out.books = await one('books', 'books', (rec) => (Array.isArray(rec.entries) ? local('/feed/completed-books', { entries: rec.entries }) : 0));
    return out;
  }

  return { syncOnce, status: () => ({ roster: state.roster, books: state.books }) };
}

// ── the loop ────────────────────────────────────────────────────────────────

/**
 * Both loops, like startPhoneRelay. Returns a stop function.
 * @param {{ puller: ReturnType<typeof createJobPuller>, bundles?: ReturnType<typeof createBundleSync>, log?: Function, setTimeoutFn?: typeof setTimeout }} o
 */
function startJobPuller({ puller, bundles, log, setTimeoutFn = setTimeout }) {
  let stopped = false;
  let timer = null;
  let bundleTimer = null;
  const tick = async () => {
    if (stopped) return;
    let wait = IDLE_MS;
    try { wait = (await puller.tick()).wait; } catch (e) { if (log) log(`[jobs] ${e && e.message}`); }
    if (!stopped) timer = setTimeoutFn(tick, wait);
  };
  const bundleTick = async () => {
    if (stopped) return;
    try { await bundles.syncOnce(); } catch (e) { if (log) log(`[station] ${e && e.message}`); }
    if (!stopped) bundleTimer = setTimeoutFn(bundleTick, BUNDLE_MS);
  };
  timer = setTimeoutFn(tick, 3000);
  if (bundles) bundleTimer = setTimeoutFn(bundleTick, 5000);
  return () => { stopped = true; if (timer) clearTimeout(timer); if (bundleTimer) clearTimeout(bundleTimer); };
}

module.exports = {
  JOB_PULL_ROUTES, jobPullAllowed, JOB_ID_RE,
  createJournal, createJobPuller, createBundleSync, startJobPuller,
  IDLE_MS, BUSY_MS, HELLO_MS, HEARTBEAT_MS, FAIL_PAUSE_MS, MALFORMED,
};
