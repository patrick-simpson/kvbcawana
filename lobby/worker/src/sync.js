// The sync service's whole behaviour, independent of Cloudflare: one class
// over a tiny async key-value store (a Durable Object's storage in
// production, a Map in the tests), the Worker's env, and an injected fetch and
// clock. src/index.js only routes requests into it.
//
// WHAT IT HOLDS (owner, 2026-10-01: "type kennebec and have it sync
// everything up", with the laptop off):
//   auth       {epoch, changedAt, v2?: {salt, iter, verifier}, salt?, hash?}: the
//              epoch (a change bumps it, which signs every screen out); the v2
//              verifier SHA-256(authKey) a client derives from the passphrase
//              (routes.md "Sign-in, passphrase v2"); and, until the owner's
//              switch or the first v2 passphrase change deletes them, the old
//              salted HMAC of the passphrase (`salt`, `hash`) so old clients
//              keep working through the migration
//   auth:legacyLastAt  when an old-protocol client last signed in
//   secret     the session-signing secret, made on first use
//   displayKey the church's sealing key; handed to a screen at login. The
//              check-in laptop logs in like any screen and seals with it.
//   settings   the shared settings, {rev, publishedAt, settings} (contract v6)
//   slides     the published deck, {deckRev, publishedAt, slides} (contract v5)
//   template   the "new screen" template, {savedAt, config}
//   journey    the Journey kiosk's room settings, {savedAt, settings}
//   calendar   the church calendar, {version, generatedAt, checkedAt, sourceUrl, events}
//   screens    the screen registry and each screen's own settings (screens.js)
//
// WHO MAY DO WHAT (owner's choice B): anyone holding the passphrase can read
// and change everything. So the passphrase is the one lock, and guessing it
// is ONLINE only, against limits: IP_MAX_FAILS wrong tries from one address
// lock that address out for IP_LOCK_MS, and GLOBAL_MAX_FAILS across all
// addresses in an hour lock logins for everyone for GLOBAL_LOCK_MS. A screen
// already signed in never needs to log in again, so a lock only ever delays
// setting up a new one. (The old design sealed the keys under the passphrase
// on a public channel, where a short word could be guessed offline in
// seconds; that is the hole this closes.)

import { sanitizeSharedValues } from '../../src/lib/sharedSettings.js';
import { isVideoSlide, sanitizeSlides } from '../../src/lib/slides.js';
import { sanitizeEvents } from '../../src/lib/calendarParse.js';
import {
  PASSPHRASE_MAX,
  PASSPHRASE_MIN,
  normalizeSyncPassphrase,
  sanitizeJourney,
  sanitizeTemplate,
} from '../../src/lib/syncSpecs.js';
import { PBKDF2_ITER, PBKDF2_ITER_MAX, PBKDF2_ITER_MIN, authVerifier } from '../../shared/cloud-crypto.js';
import { fromBase64, hmac, kidFor, newDisplayKey, randomBytes, safeEqual, seal, toBase64, toBase64Url } from './crypto.js';
import { DEFAULT_CALENDAR_URL, scrapeCalendar } from './calendar.js';
import { DOORBELL_EVENT, REPLAYED, checkPublish, frameText, replayKey } from './live.js';
import { Relay } from './relay.js';
import { Watcher } from './watcher.js';
import { CloudPhone } from './phone.js';
import { Friends } from './friends.js';
import { Screens } from './screens.js';
import { BadRequest, fail, json } from './http.js';
import { Registry } from './registry.js';
import { Ledger, Tags } from './ledger.js';
import { PrintQueue } from './printq.js';
import { Stations } from './stations.js';
import { Adopter } from './adopt.js';
import { Desk } from './desk.js';
import { mountCheckin } from './checkinRoutes.js';
import { History, mountHistory } from './history.js';

export { json };

export const IP_MAX_FAILS = 5;
export const IP_LOCK_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_FAILS = 30;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
export const GLOBAL_LOCK_MS = 60 * 60 * 1000;
/** Same cap the print server keeps: every settings frame seals into 4096. */
export const SETTINGS_JSON_MAX = 3800;
/** The slide chunker's budget and count (print-server/events.js). */
export const SLIDES_CHUNK_JSON_BUDGET = 3900;
export const SLIDES_TOTAL_MAX = 12;
/** The events the laptop may not publish while the Worker is the one publisher (live.js names them). */
export const SINGLE_PUBLISHER_DROPS = Object.freeze(['tally', 'checkout', 'checkin']);
export const BODY_MAX = 128 * 1024;   // bytes; the entry point refuses a longer Content-Length before reading


/**
 * @typedef {{ get(key: string): Promise<any>, put(key: string, value: any): Promise<void>, delete(key: string): Promise<any> }} Store
 */

/**
 * The published deck: text slides only, in the wire's shape (what the print
 * server's buildSlidesDeck produces, and what sanitizeSlidesChunk accepts).
 * @param {unknown} raw
 */
export function buildDeck(raw) {
  return sanitizeSlides(raw)
    .filter((s) => !isVideoSlide(s))
    .map((s) => {
      /** @type {Record<string, unknown>} */
      const out = {
        eyebrow: String(s.eyebrow || '').replace(/\n/g, ' '),
        text: s.text,
        theme: s.theme,
        textSize: s.textSize,
        durationSec: s.durationSec,
      };
      if (s.showFrom) out.showFrom = s.showFrom;
      if (s.showUntil) out.showUntil = s.showUntil;
      if (s.holdCheckIns === true) out.holdCheckIns = true;
      if (typeof s.id === 'string' && s.id.length <= 64) out.id = s.id;
      return out;
    });
}

const byteLength = (/** @type {unknown} */ v) => new TextEncoder().encode(JSON.stringify(v)).length;

/**
 * Greedy chunking, byte for byte the print server's buildSlidesChunks. null
 * when the deck needs more than SLIDES_TOTAL_MAX chunks.
 * @param {object[]} deck @param {number} deckRev @param {string} publishedAt
 */
export function buildSlidesChunks(deck, deckRev, publishedAt) {
  /** @type {object[][]} */
  const groups = [[]];
  let groupBytes = 0;
  for (const slide of deck) {
    const bytes = byteLength(slide) + 1;
    if (groups[groups.length - 1].length > 0 && groupBytes + bytes > SLIDES_CHUNK_JSON_BUDGET) {
      groups.push([]);
      groupBytes = 0;
    }
    groups[groups.length - 1].push(slide);
    groupBytes += bytes;
  }
  if (groups.length > SLIDES_TOTAL_MAX) return null;
  return groups.map((slides, seq) => ({ deckRev, publishedAt, seq, total: groups.length, slides }));
}

export class SyncCore {
  /**
   * @param {{ storage: Store, env: Record<string, any>, fetchFn?: typeof fetch, now?: () => number,
   *   broadcast?: (text: string) => number, closeAll?: (code: number, reason: string) => void,
   *   alarms?: { set(atMs: number): Promise<void>|void, get(): Promise<number|null>|number|null },
   *   liveScreens?: () => Set<string>, sleep?: (ms: number) => Promise<void> }} deps
   */
  constructor({ storage, env, fetchFn, now, broadcast, closeAll, alarms, liveScreens, sleep }) {
    this.storage = storage;
    this.env = env || {};
    this.fetchFn = fetchFn || ((...args) => fetch(...args));
    this.now = now || (() => Date.now());
    // The live channel: every screen's socket (index.js) carries everything.
    this.broadcast = broadcast || (() => 0);
    this.closeAll = closeAll || (() => {});
    this.relayQueue = new Relay(this.storage, this.now);
    // Cloud check-in (ROADMAP.md#cloud-check-in), phase 1: the read-only report watcher.
    this.watcher = new Watcher({ storage: this.storage, env: this.env, fetchFn: this.fetchFn, now: this.now, alarms, sleep });
    // ...and the phone page's check-ins, answered here instead of by the laptop.
    // ...and who brought a friend tonight (BARF Night's email; friends.js).
    this.friends = new Friends({ storage: this.storage, watcher: this.watcher, now: this.now });
    this.phone = new CloudPhone({ watcher: this.watcher, relay: this.relayQueue, storage: this.storage, now: this.now, friends: this.friends });
    // Online check-in (ROADMAP.md#online-check-in): the night's claims, the print
    // lease queue, the registered stations, what the watcher does with the
    // report (P4) and the desk's check-in claim logic. Every module that owns
    // routes adds them to the registry with ONE line below.
    this.registry = new Registry();
    this.tags = new Tags(() => this.watcher.creds()?.password);
    this.ledger = new Ledger({ storage: this.storage, now: this.now });
    this.printq = new PrintQueue({ storage: this.storage, now: this.now });
    this.stations = new Stations({ storage: this.storage, now: this.now });
    this.adopt = new Adopter({
      ledger: this.ledger, printq: this.printq, stations: this.stations, tags: this.tags,
      secret: () => this.watcher.creds()?.password, env: this.env, now: this.now, storage: this.storage,
      greet: (g) => this.greet(g),
    });
    this.watcher.adopt = this.adopt;
    this.desk = new Desk({ watcher: this.watcher, ledger: this.ledger, printq: this.printq, stations: this.stations, tags: this.tags, now: this.now });
    mountCheckin(this.registry, this);   // stations, print lease, desk (routes.md 4, 5, 6)
    this.history = new History({ storage: this.storage, env: this.env, now: this.now });
    // A greeting for a desk check-in, from the Worker, once SINGLE_PUBLISHER is on.
    this.desk.hooks.afterCheckin.push((e) => this.greet({ name: e.name, club: e.club, id: e.jobId || e.historyRow?.id }));
    mountHistory(this.registry, this);   // history routes, the desk's row check and hooks (routes.md 2, 3)
    // The screen registry (ROADMAP.md#settings-page, phase 2): its doorbells ride the live
    // channel only, for the one screen they name.
    this.screens = new Screens({
      storage: this.storage,
      now: this.now,
      liveScreens,
      ring: (payload) => { this.broadcast(frameText(DOORBELL_EVENT, payload)); },
    });
  }

  /** The Durable Object's alarm: the watcher's 5 s read (it sets the next one). */
  async alarm() {
    // An outbox waiting for D1 drains with nobody asking (cheap: nothing without HISTORY_DB).
    await this.history.flush().catch((err) => console.error('[history] flush failed', err));
    return this.watcher.tick();
  }

  /** Send a frame to every live screen, and keep it for late joiners. */
  async relay(event, payload) {
    const text = frameText(event, payload);
    if (REPLAYED.includes(event)) await this.storage.put(replayKey(event), text);
    if (event === 'slides') {
      // The newest chunks (sealed, so their deck is unreadable here): enough
      // for the largest deck. A joiner's assembler keeps only the newest
      // complete deck, by its own strictly-newer rule, so stale chunks in
      // the buffer are harmless.
      const prev = (await this.storage.get('live:slides')) || { chunks: [] };
      await this.storage.put('live:slides', { chunks: [...prev.chunks, text].slice(-SLIDES_TOTAL_MAX) });
    }
    return this.broadcast(text);
  }

  /** What a screen is handed the moment it connects. */
  async replayFrames() {
    const out = [];
    for (const event of REPLAYED) {
      const text = await this.storage.get(replayKey(event));
      if (typeof text === 'string') out.push(text);
    }
    const slides = await this.storage.get('live:slides');
    if (slides?.chunks) out.push(...slides.chunks);
    return out;
  }

  /** Is this token a current session? (The socket upgrade cannot send headers.) @param {string} token */
  async sessionValid(token) {
    return this.authorized(new Request('https://sync.internal/', { headers: { Authorization: `Bearer ${token}` } }));
  }

  // ── storage helpers ────────────────────────────────────────────────────────

  async secret() {
    let s = await this.storage.get('secret');
    if (!s) {
      s = toBase64(randomBytes(32));
      await this.storage.put('secret', s);
    }
    return s;
  }

  async displayKey() {
    let k = await this.storage.get('displayKey');
    if (!k) {
      k = newDisplayKey();
      await this.storage.put('displayKey', k);
    }
    return k;
  }

  /** A stamp strictly after `prev`, so two quick changes still order. @param {string|undefined} prev */
  stampAfter(prev) {
    const p = prev ? Date.parse(prev) : 0;
    return new Date(Math.max(this.now(), (Number.isFinite(p) ? p : 0) + 1)).toISOString();
  }

  // ── passphrase + sessions ──────────────────────────────────────────────────

  /** @param {string} normalized @param {string} saltB64 */
  async hashPassphrase(normalized, saltB64) {
    return toBase64(await hmac(fromBase64(saltB64) || new Uint8Array(0), normalized));
  }

  /**
   * The stored auth, made from INITIAL_PASSPHRASE (a Worker secret, set once at
   * deploy) the first time anything asks; after that only storage counts, so a
   * later change survives redeploys. Null when there is neither.
   * @returns {Promise<any|null>}
   */
  async ensureAuth() {
    let auth = await this.storage.get('auth');
    if (!auth) {
      const initial = normalizeSyncPassphrase(this.env.INITIAL_PASSPHRASE);
      if (!initial) return null;
      const salt = toBase64(randomBytes(16));
      auth = { salt, hash: await this.hashPassphrase(initial, salt), epoch: 1, changedAt: new Date(this.now()).toISOString() };
      await this.storage.put('auth', auth);
    }
    return auth;
  }

  /** AUTH_LEGACY = "off" in wrangler.toml: old-protocol `{passphrase}` logins stop (the upgrade login and the stored hash are untouched). */
  get legacyOn() {
    return String(this.env.AUTH_LEGACY || 'on').trim().toLowerCase() !== 'off';
  }

  /**
   * Is this the passphrase, by the OLD verifier (HMAC(salt, passphrase))? Used
   * by old-protocol logins and by the one upgrade login of the first v2 client.
   * @param {unknown} raw
   * @returns {Promise<'ok'|'wrong'|'not-configured'>}
   */
  async checkPassphrase(raw) {
    const typed = normalizeSyncPassphrase(raw);
    const auth = await this.ensureAuth();
    if (!auth) return 'not-configured';
    if (!typed || !auth.hash || !auth.salt) return 'wrong';
    return safeEqual(await this.hashPassphrase(typed, auth.salt), auth.hash) ? 'ok' : 'wrong';
  }

  /** For the owner (GET /v1/cloud/status): is the old hash still kept, and when did an old client last sign in. */
  async authStatus() {
    const auth = await this.storage.get('auth');
    return { v2: !!(auth && auth.v2 && auth.v2.verifier), legacy: !!(auth && auth.hash), legacyOn: this.legacyOn, legacyLastAt: (await this.storage.get('auth:legacyLastAt')) || null };
  }

  /** An authKey field: 32 bytes of standard base64, or null. @param {unknown} v */
  cleanAuthKey(v) {
    if (typeof v !== 'string') return null;
    const bytes = fromBase64(v.trim());
    return bytes && bytes.length === 32 ? v.trim() : null;
  }

  /**
   * GET /v1/auth/params: the PBKDF2 salt and count a client derives `authKey`
   * from. The salt is made (and stored) on the first ask, before any verifier
   * exists. `upgrade` is true while no v2 verifier is stored: the first client
   * to sign in then sends {passphrase, authKey} once. `legacy` is true while the
   * old hash is still kept.
   */
  async authParams() {
    const auth = await this.ensureAuth();
    if (!auth) return fail('The sync service has no passphrase yet. Finish its setup first.', 503);
    if (!auth.v2) {
      auth.v2 = { salt: toBase64(randomBytes(16)), iter: PBKDF2_ITER, verifier: null };
      await this.storage.put('auth', auth);
    }
    return json({ v: 2, salt: auth.v2.salt, iter: auth.v2.iter, legacy: !!auth.hash, upgrade: !auth.v2.verifier });
  }

  /** @param {number} epoch */
  async mintSession(epoch) {
    const body = `v1.${epoch}.${this.now()}`;
    return `${body}.${toBase64Url(await hmac(fromBase64(await this.secret()) || new Uint8Array(0), body))}`;
  }

  /** @param {Request} request @returns {Promise<boolean>} */
  async authorized(request) {
    const header = request.headers.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const m = /^v1\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token);
    if (!m) return false;
    const auth = await this.storage.get('auth');
    if (!auth || Number(m[1]) !== auth.epoch) return false;
    const expect = toBase64Url(await hmac(fromBase64(await this.secret()) || new Uint8Array(0), `v1.${m[1]}.${m[2]}`));
    return safeEqual(expect, m[3]);
  }

  /** @param {string} ip @returns {Promise<number>} ms until this address may try again, 0 if now */
  async lockedFor(ip) {
    const t = this.now();
    const all = await this.storage.get('fails:all');
    if (all && all.until > t) return all.until - t;
    const mine = await this.storage.get(`fails:${ip}`);
    if (mine && mine.until > t) return mine.until - t;
    return 0;
  }

  /** @param {string} ip @returns {Promise<number>} tries this address has left */
  async noteFailure(ip) {
    const t = this.now();
    const key = `fails:${ip}`;
    const prev = await this.storage.get(key);
    const fresh = !prev || (prev.until && prev.until <= t) || t - prev.first > IP_LOCK_MS;
    const mine = fresh ? { count: 1, first: t, until: 0 } : { ...prev, count: prev.count + 1 };
    if (mine.count >= IP_MAX_FAILS) mine.until = t + IP_LOCK_MS;
    await this.storage.put(key, mine);

    const prevAll = await this.storage.get('fails:all');
    const allFresh = !prevAll || t - prevAll.first > GLOBAL_WINDOW_MS || (prevAll.until && prevAll.until <= t);
    const all = allFresh ? { count: 1, first: t, until: 0 } : { ...prevAll, count: prevAll.count + 1 };
    if (all.count >= GLOBAL_MAX_FAILS) all.until = t + GLOBAL_LOCK_MS;
    await this.storage.put('fails:all', all);
    return Math.max(0, IP_MAX_FAILS - mine.count);
  }

  /** @param {string} ip */
  async lockout(ip) {
    const ms = await this.lockedFor(ip);
    if (!ms) return null;
    return fail('Too many wrong tries. Wait a little, then try again.', 429, { retryAfterSec: Math.ceil(ms / 1000) });
  }

  // ── the state screens fetch ────────────────────────────────────────────────

  async state() {
    const [settings, slides, template, journey, calendar, key] = await Promise.all([
      this.storage.get('settings'), this.storage.get('slides'), this.storage.get('template'),
      this.storage.get('journey'), this.storage.get('calendar'), this.storage.get('displayKey'),
    ]);
    return {
      settings: settings || null,
      slides: slides || null,
      template: template || null,
      journey: journey || null,
      calendar: calendar || null,
      kid: key ? await kidFor(fromBase64(key) || new Uint8Array(0)) : null,
    };
  }

  /**
   * ONE greeting for a cloud check-in (a desk check-in, or a child the watcher
   * found on TwoTimTwo's page), sealed with the display key like the laptop's.
   * Only while the Worker is the one publisher (`singlePublisher`): until then the
   * print server's own greeting (with birthdays and milestones) is the one. The
   * name is in memory for this call only.
   * @param {{ name: string, club?: string, id?: string }} g
   */
  async greet(g) {
    if (!this.singlePublisher) return false;
    const firstName = String(g.name || '').trim().split(/\s+/)[0];
    if (!firstName) return false;
    const res = await this.publishSealed('checkin', {
      firstName, club: String(g.club || ''), isBirthday: false, isFirstTimer: false,
      ...(g.id ? { id: g.id } : {}), at: new Date(this.now()).toISOString(),
    });
    return res.ok;
  }

  /** @param {string} event @param {unknown} payload */
  async publishSealed(event, payload) {
    const envelope = await seal(await this.displayKey(), event, payload);
    if (!envelope) return { ok: false, error: 'cannot-seal' };
    await this.relay(event, envelope);
    return { ok: true };
  }

  /** @param {'calendar'|'journey'|'template'} what @param {string} at */
  async ring(what, at) {
    this.broadcast(frameText(DOORBELL_EVENT, { what, at }));
  }

  // ── routes ─────────────────────────────────────────────────────────────────

  /**
   * @param {Request} request
   * @param {string} [ip] the caller's address (CF-Connecting-IP)
   * @returns {Promise<Response>}
   */
  async handle(request, ip = 'unknown') {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /v1/health':
          return json({ ok: true });
        case 'POST /v1/login':
          return await this.login(request, ip);
        case 'GET /v1/auth/params':
          return await this.authParams();
        case 'GET /v1/calendar':
          return await this.getCalendar();
        // The scheduled email's read-only link: one night's report, no session.
        case 'GET /v1/cloud/friends-report': {
          const report = await this.friends.reportByLink(url.searchParams.get('token'));
          return report ? json(report) : fail('That link has expired or is not right.', 404);
        }
        default:
          break;
      }
      if (url.pathname === '/v1/screens' || url.pathname.startsWith('/v1/screens/')) return await this.screenRoute(request, url);
      const hit = this.registry.match(request.method, url.pathname);
      if (hit) return await this.runRoute(hit, request, url, ip);
      const known = new Set([
        'GET /v1/state', 'PUT /v1/settings', 'PUT /v1/slides', 'PUT /v1/template',
        'PUT /v1/journey', 'POST /v1/calendar/refresh', 'POST /v1/passphrase', 'POST /v1/publish',
        'POST /v1/relay', 'GET /v1/relay/next', 'POST /v1/relay/answer', 'GET /v1/relay/result',
        'GET /v1/cloud/status', 'POST /v1/cloud/read-now', 'POST /v1/cloud/checkin',
        'POST /v1/cloud/friend', 'GET /v1/cloud/friends', 'POST /v1/cloud/friends-link', 'POST /v1/cloud/barf-bags',
      ]);
      if (!known.has(route)) return fail('Not found.', 404);
      if (!(await this.authorized(request))) {
        return fail('This screen is signed out. Type the passphrase again.', 401, { reason: 'signed-out' });
      }
      switch (route) {
        case 'GET /v1/state': return json(await this.state());
        case 'PUT /v1/settings': return await this.putSettings(request);
        case 'PUT /v1/slides': return await this.putSlides(request);
        case 'PUT /v1/template': return await this.putTemplate(request);
        case 'PUT /v1/journey': return await this.putJourney(request);
        case 'POST /v1/calendar/refresh': return await this.refreshCalendar();
        case 'POST /v1/passphrase': return await this.changePassphrase(request, ip);
        case 'POST /v1/publish': return await this.livePublish(request);
        // The phone check-in relay (relay.js): the page asks, the laptop answers.
        case 'POST /v1/relay': {
          const req = await this.body(request);
          // Cloud check-in: the calls the Worker answers itself (phone.js);
          // the page collects the answer from /v1/relay/result as ever.
          const laptopOnline = await this.relayQueue.laptopOnline();
          const own = await this.phone.answer(req, laptopOnline);
          if (own) return json({ id: await this.relayQueue.store(own.status, own.body), laptopOnline });
          const r = await this.relayQueue.enqueue(req);
          return r.ok ? json({ id: r.id, laptopOnline: r.laptopOnline }) : fail(r.error, r.status);
        }
        case 'GET /v1/relay/next': return json(await this.relayQueue.take());
        case 'POST /v1/relay/answer': {
          const ans = await this.body(request);
          // The laptop's roster, with families filled in from TwoTimTwo when it
          // has none yet (phone.js fillRoster).
          const asked = typeof ans.id === 'string' ? (await this.relayQueue.queue()).find((x) => x.id === ans.id) : null;
          if (asked && asked.path === '/phone/roster' && ans.status === 200) ans.body = await this.phone.fillRoster(ans.body);
          const r = await this.relayQueue.answer(ans);
          return r.ok ? json({ ok: true }) : fail(r.error, r.status);
        }
        case 'GET /v1/relay/result': return json(await this.relayQueue.result(url.searchParams.get('id')));
        // Cloud check-in, phase 1: counts and codes only, never a name or an id.
        case 'GET /v1/cloud/status':
          await this.watcher.arm();
          return json({ ...(await this.watcher.status()), auth: await this.authStatus() });
        // Who brought a friend (friends.js): recorded by the laptop, read by a
        // signed-in screen, and one read-only link for the scheduled email.
        case 'POST /v1/cloud/friend': {
          const r = await this.friends.record(await this.body(request));
          return r.ok ? json({ ok: true }) : fail(r.error, r.status);
        }
        case 'GET /v1/cloud/friends': return json(await this.friends.report(url.searchParams.get('date')));
        case 'POST /v1/cloud/friends-link': return json(await this.friends.makeLink((await this.body(request)).date));
        // BARF Bag labels: tonight's names to the laptop, printed as one job
        // (printer 8.2.0's /print-barf-bags, a job no page can send itself).
        case 'POST /v1/cloud/barf-bags': {
          const bags = await this.friends.bagNames((await this.body(request)).date);
          if (!bags.names.length) return json({ ok: false, reason: 'none', ...bags, names: undefined });
          if (!(await this.relayQueue.laptopOnline())) return json({ ok: false, reason: 'laptop-off', ...bags, names: undefined });
          const job = await this.relayQueue.enqueueJob('/print-barf-bags', { names: bags.names });
          return json({ ok: job.ok, reason: job.ok ? undefined : 'busy', labels: bags.names.length, kids: bags.kids, friends: bags.friends, unnamed: bags.unnamed, date: bags.date });
        }
        // Check one child in on TwoTimTwo; a preview unless {confirm: true}.
        case 'POST /v1/cloud/checkin': return json(await this.watcher.checkIn(await this.body(request)));
        case 'POST /v1/cloud/read-now': {
          // {test: true} is the Settings button: the most recent club night.
          const body = await this.body(request);
          return json(body.test === true ? await this.watcher.testRead() : await this.watcher.readNow());
        }
        default: return fail('Not found.', 404);
      }
    } catch (err) {
      if (err instanceof BadRequest) return fail(err.message, 400);
      console.error('[sync] unexpected error', err);
      return fail('Something went wrong on the sync service.', 500);
    }
  }

  /**
   * A registry route (registry.js): check its auth level, then run it.
   * `station` is a session plus X-Station naming a registered station (no
   * pairing step: any computer with the passphrase may register one).
   * @param {{ route: import('./registry.js').Registry['routes'][number], params: Record<string, string> }} hit
   * @param {Request} request @param {URL} url @param {string} ip
   */
  async runRoute(hit, request, url, ip) {
    const { route, params } = hit;
    if (route.auth !== 'public' && !(await this.authorized(request))) {
      return fail('This screen is signed out. Type the passphrase again.', 401, { reason: 'signed-out' });
    }
    let stationId = null;
    if (route.auth === 'station') {
      stationId = request.headers.get('X-Station') || '';
      await this.stations.load();
      if (!this.stations.get(stationId)) return fail('That station is not registered.', 403, { reason: 'unknown-station' });
      await this.stations.touch(stationId);
    }
    return route.handler({ core: this, request, url, params, ip, stationId, body: () => this.body(request) });
  }

  /**
   * The screen registry's routes (screens.js), all behind a session:
   *   GET    /v1/screens                  every screen
   *   POST   /v1/screens/hello            {id, kind, name?}
   *   GET    /v1/screens/<id>/settings    {screen, settings}
   *   PUT    /v1/screens/<id>/settings    {settings}
   *   PUT    /v1/screens/<id>/name        {name}
   *   POST   /v1/screens/<id>/action      {action, data?}
   *   DELETE /v1/screens/<id>
   * @param {Request} request @param {URL} url
   */
  async screenRoute(request, url) {
    const m = /^\/v1\/screens(?:\/([^/]+)(?:\/(settings|name|action))?)?$/.exec(url.pathname);
    if (!m) return fail('Not found.', 404);
    const [, id = '', part = ''] = m;
    // 'hello' is never an id (an id is 16 to 64 characters).
    const route = !id ? `${request.method} list` : id === 'hello' && !part ? `${request.method} hello` : `${request.method} ${part}`;
    const known = ['GET list', 'POST hello', 'GET settings', 'PUT settings', 'PUT name', 'POST action', 'DELETE '];
    if (!known.includes(route)) return fail('Not found.', 404);
    if (!(await this.authorized(request))) {
      return fail('This screen is signed out. Type the passphrase again.', 401, { reason: 'signed-out' });
    }
    let res;
    switch (route) {
      case 'GET list': res = await this.screens.list(); break;
      case 'POST hello': res = await this.screens.hello(await this.body(request)); break;
      case 'GET settings': res = await this.screens.get(id); break;
      case 'PUT settings': res = await this.screens.putSettings(id, await this.body(request)); break;
      case 'PUT name': res = await this.screens.rename(id, await this.body(request)); break;
      case 'POST action': res = await this.screens.act(id, await this.body(request)); break;
      default: res = await this.screens.forget(id);
    }
    return res.ok ? json(res.body) : fail(res.error, res.status);
  }

  /** @param {Request} request */
  async body(request) {
    // Bytes, not UTF-16 units: a body of CJK or emoji was measured at half
    // its size. The Content-Length check in index.js stops a long body from
    // being buffered at all; this is the backstop for one that lied.
    const declared = Number(request.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > BODY_MAX) throw new BadRequest('That is too big to save.');
    const text = await request.text();
    if (new TextEncoder().encode(text).length > BODY_MAX) throw new BadRequest('That is too big to save.');
    try {
      const parsed = JSON.parse(text || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
      return parsed;
    } catch {
      throw new BadRequest('The request was not readable.');
    }
  }

  /**
   * Sign in. Three shapes (routes.md section 1): `{authKey}` (v2), `{passphrase,
   * authKey}` (the one upgrade, while no v2 verifier is stored) and the old
   * `{passphrase}` (while the legacy hash is kept and AUTH_LEGACY is not "off").
   * @param {Request} request @param {string} ip
   */
  async login(request, ip) {
    const locked = await this.lockout(ip);
    if (locked) return locked;
    const body = await this.body(request);
    const auth = await this.ensureAuth();
    if (!auth) return fail('The sync service has no passphrase yet. Finish its setup first.', 503);
    const wrong = async () => {
      const triesLeft = await this.noteFailure(ip);
      return fail('That is not the passphrase.', 401, { reason: 'wrong', triesLeft });
    };
    /** @type {Record<string, any>} */
    const extra = {};
    const wantsV2 = body.authKey !== undefined;
    if (wantsV2) {
      const authKey = this.cleanAuthKey(body.authKey);
      if (!authKey) return fail('That sign-in key is not the right shape.', 400, { reason: 'bad-authkey' });
      if (!auth.v2) return fail('Ask GET /v1/auth/params first.', 409, { reason: 'no-params' });
      const verifier = await authVerifier(authKey);
      if (auth.v2.verifier) {
        if (!safeEqual(verifier, auth.v2.verifier)) return wrong();
        // The owner's switch is off and a v2 login proves the store is current: the old hash goes now.
        if (!this.legacyOn && auth.hash) {
          const { salt: _salt, hash: _hash, ...rest } = auth;
          await this.storage.put('auth', rest);
        }
      } else {
        // The upgrade: the passphrase once, against the old hash, with its authKey.
        if (typeof body.passphrase !== 'string') return fail('Send the passphrase once with the sign-in key.', 401, { reason: 'upgrade-needed' });
        if ((await this.checkPassphrase(body.passphrase)) !== 'ok') return wrong();
        await this.storage.put('auth', { ...auth, v2: { ...auth.v2, verifier } });
        extra.upgraded = true;
      }
    } else {
      if (!this.legacyOn || !auth.hash) return fail('This service now needs the updated app or page. Reload it.', 401, { reason: 'legacy-off' });
      if ((await this.checkPassphrase(body.passphrase)) !== 'ok') return wrong();
      await this.storage.put('auth:legacyLastAt', new Date(this.now()).toISOString());
      extra.legacy = true;
    }
    await this.storage.delete(`fails:${ip}`);
    // The check-in laptop signs in FIRST with the key it already seals with,
    // so screens set up before this service keep reading names. Only ever
    // into an empty slot: once a key exists, every login adopts it.
    if (!(await this.storage.get('displayKey')) && typeof body.seedKey === 'string') {
      const bytes = fromBase64(body.seedKey.trim());
      if (bytes && bytes.length === 32) await this.storage.put('displayKey', body.seedKey.trim());
    }
    const now = await this.storage.get('auth');
    return json({
      session: await this.mintSession(now.epoch),
      displayKey: await this.displayKey(),
      state: await this.state(),
      ...(wantsV2 ? { history: await this.history.keyForLogin() } : {}),
      ...extra,
    });
  }

  async getCalendar() {
    const calendar = await this.storage.get('calendar');
    return calendar ? json(calendar) : fail('No calendar has been read yet.', 404);
  }

  /** @param {Request} request */
  async putSettings(request) {
    const body = await this.body(request);
    const settings = sanitizeSharedValues(body.settings);
    if (byteLength(settings) > SETTINGS_JSON_MAX) return fail('Those settings are too long to share. Shorten the club lines or the welcome text.', 413);
    const prev = await this.storage.get('settings');
    const next = { rev: (prev?.rev || 0) + 1, publishedAt: this.stampAfter(prev?.publishedAt), settings };
    await this.storage.put('settings', next);
    const sent = await this.publishSealed('settings', next);
    return json({ rev: next.rev, publishedAt: next.publishedAt, keyCount: Object.keys(settings).length, broadcast: sent.ok });
  }

  /** @param {Request} request */
  async putSlides(request) {
    const body = await this.body(request);
    const raw = Array.isArray(body.slides) ? body.slides : [];
    const deck = buildDeck(raw);
    const prev = await this.storage.get('slides');
    const deckRev = (prev?.deckRev || 0) + 1;
    const publishedAt = this.stampAfter(prev?.publishedAt);
    const chunks = buildSlidesChunks(deck, deckRev, publishedAt);
    if (!chunks) return fail('That deck is too big to publish. Remove a few slides or shorten them.', 413);
    await this.storage.put('slides', { deckRev, publishedAt, slides: deck });
    let broadcast = true;
    for (const chunk of chunks) broadcast = (await this.publishSealed('slides', chunk)).ok && broadcast;
    return json({ deckRev, publishedAt, slideCount: deck.length, droppedCount: raw.length - deck.length, broadcast });
  }

  /** @param {Request} request */
  async putTemplate(request) {
    const body = await this.body(request);
    const next = { savedAt: new Date(this.now()).toISOString(), config: sanitizeTemplate(body.config) };
    await this.storage.put('template', next);
    await this.ring('template', next.savedAt);
    return json(next);
  }

  /** @param {Request} request */
  async putJourney(request) {
    const body = await this.body(request);
    const prev = await this.storage.get('journey');
    const next = { savedAt: this.stampAfter(prev?.savedAt), settings: sanitizeJourney(body.settings) };
    await this.storage.put('journey', next);
    await this.ring('journey', next.savedAt);
    return json(next);
  }

  /**
   * Read the church calendar now. Keeps the last good copy on any failure.
   * The URL is the shared settings' calendarUrl when set (https only, already
   * enforced by the settings allowlist), else the church's page.
   */
  async refreshCalendar() {
    const settings = await this.storage.get('settings');
    const url = settings?.settings?.calendarUrl || DEFAULT_CALENDAR_URL;
    const prev = await this.storage.get('calendar');
    const checkedAt = new Date(this.now()).toISOString();
    const res = await scrapeCalendar(url, { fetchFn: this.fetchFn, now: this.now });
    if (!res.ok) {
      if (prev) await this.storage.put('calendar', { ...prev, checkedAt, lastError: res.error });
      return fail(res.error, 502, { checkedAt, generatedAt: prev?.generatedAt || null });
    }
    const events = sanitizeEvents(res.feed.events);
    const changed = !prev || JSON.stringify(prev.events) !== JSON.stringify(events);
    const next = {
      ...res.feed,
      events,
      // generatedAt moves only when the events did, so it reads "last changed".
      generatedAt: changed ? checkedAt : prev.generatedAt,
      checkedAt,
    };
    await this.storage.put('calendar', next);
    if (changed) await this.ring('calendar', next.generatedAt);
    return json({ changed, generatedAt: next.generatedAt, checkedAt, clubCount: res.clubCount, eventCount: events.length });
  }

  /**
   * A new passphrase. Needs the current one too (and counts against the same
   * limits), so a signed-in screen left unattended cannot lock the church out.
   * It signs EVERY screen out and, unless told otherwise, replaces the display
   * key, because whoever learned the old word also learned the old key.
   *
   * v2 (`{currentAuthKey, next: {salt, iter, verifier}, wrapped}`): the client
   * derived everything, the Worker never sees a passphrase, and the legacy hash
   * is deleted in the same atomic put. The old shape (`{current, next: string}`)
   * still works while old clients exist: it makes a new legacy hash and clears
   * the v2 verifier, so the next v2 client signs in with the upgrade login.
   * @param {Request} request @param {string} ip
   */
  async changePassphrase(request, ip) {
    const locked = await this.lockout(ip);
    if (locked) return locked;
    const body = await this.body(request);
    const v2 = !!body.next && typeof body.next === 'object';
    const auth0 = await this.ensureAuth();
    if (!auth0) return fail('The sync service has no passphrase yet. Finish its setup first.', 503);
    const refuse = async () => {
      const triesLeft = await this.noteFailure(ip);
      return fail('The current passphrase is not right.', 401, { reason: 'wrong', triesLeft });
    };
    // Who is asking: the current authKey when a verifier exists, else the passphrase (the old check).
    let proven = false;
    const curKey = this.cleanAuthKey(body.currentAuthKey);
    if (auth0.v2 && auth0.v2.verifier && curKey) proven = safeEqual(await authVerifier(curKey), auth0.v2.verifier);
    else if (body.current !== undefined) proven = (await this.checkPassphrase(body.current)) === 'ok';
    if (!proven) return refuse();

    const prev = auth0;
    const changedAt = new Date(this.now()).toISOString();
    /** @type {any} */
    let auth;
    if (v2) {
      const n = body.next;
      const saltBytes = typeof n.salt === 'string' ? fromBase64(n.salt) : null;
      const vBytes = typeof n.verifier === 'string' ? fromBase64(n.verifier) : null;
      if (!saltBytes || saltBytes.length < 16 || saltBytes.length > 64 || !vBytes || vBytes.length !== 32
        || !Number.isInteger(n.iter) || n.iter < PBKDF2_ITER_MIN || n.iter > PBKDF2_ITER_MAX) {
        return fail('The new sign-in values are not the right shape.', 400, { reason: 'bad-next' });
      }
      auth = { epoch: prev.epoch + 1, changedAt, v2: { salt: n.salt, iter: n.iter, verifier: n.verifier } };
    } else {
      const next = normalizeSyncPassphrase(body.next);
      if (next.length < PASSPHRASE_MIN || next.length > PASSPHRASE_MAX) {
        return fail(`The new passphrase needs at least ${PASSPHRASE_MIN} characters.`, 400);
      }
      const salt = toBase64(randomBytes(16));
      auth = { salt, hash: await this.hashPassphrase(next, salt), epoch: prev.epoch + 1, changedAt };
      if (prev.v2) auth.v2 = { ...prev.v2, verifier: null };
    }
    // The history key's wrap changes in the SAME atomic put as the passphrase, or
    // the passphrase does not change (history.js rewrapWrites).
    const h = await this.history.rewrapWrites(body.wrapped);
    if (h.error) return h.error;
    await this.storage.put({ auth, ...h.writes });
    const rotateKey = body.rotateKey !== false;
    if (rotateKey) await this.storage.put('displayKey', newDisplayKey());
    // Every open socket was opened with the old word: close them all, so each
    // screen finds out now (its reconnect is refused and it asks again).
    this.closeAll(4001, 'passphrase changed');
    for (const event of REPLAYED) await this.storage.delete(replayKey(event));
    await this.storage.delete('live:slides');
    return json({
      session: await this.mintSession(auth.epoch),
      displayKey: await this.displayKey(),
      rotatedKey: rotateKey,
    });
  }

  /** SINGLE_PUBLISHER = "on" and cloud check-in is running: the Worker is the only publisher of the tally and the pickup list. */
  get singlePublisher() {
    return String(this.env.SINGLE_PUBLISHER || '').trim().toLowerCase() === 'on' && this.watcher.mode !== 'off' && !!this.watcher.creds();
  }

  /**
   * The check-in laptop's events (and anything else a signed-in device sends),
   * relayed to every live screen exactly as given: sealed frames stay sealed.
   * @param {Request} request
   */
  async livePublish(request) {
    const res = checkPublish(await this.body(request));
    if (!res.ok) return fail(res.error, res.status);
    // ONE publisher (ROADMAP.md#online-check-in): in cloud mode the Worker
    // publishes the tally and the still-here list itself, so the laptop's are
    // dropped, answered 200 so the print server does not owe a resend.
    if (this.singlePublisher && SINGLE_PUBLISHER_DROPS.includes(res.event)) {
      return json({ ok: true, screens: 0, dropped: true, reason: 'single-publisher' });
    }
    const screens = await this.relay(res.event, res.payload);
    return json({ ok: true, screens });
  }

  /** The scheduled run: keep the calendar fresh without anyone pressing a button. */
  async cron() {
    await this.relayQueue.purge();
    // Keeps the watcher's alarm set (it sets its own after each run; this is
    // the safety net if one was ever lost).
    await this.watcher.arm();
    // Who brought a friend is kept a few nights, then deleted (friends.js).
    await this.friends.purge();
    await this.history.flush().catch((err) => console.error('[history] flush failed', err));
    const res = await this.refreshCalendar();
    return res.status;
  }
}

