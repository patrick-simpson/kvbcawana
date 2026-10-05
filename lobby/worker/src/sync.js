// The sync service's whole behaviour, independent of Cloudflare: one class
// over a tiny async key-value store (a Durable Object's storage in
// production, a Map in the tests), the Worker's env, and an injected fetch and
// clock. src/index.js only routes requests into it.
//
// WHAT IT HOLDS (owner, 2026-10-01: "type kennebec and have it sync
// everything up", with the laptop off):
//   auth       the passphrase's salted hash and its epoch (a change bumps it,
//              which signs every screen out)
//   secret     the session-signing secret, made on first use
//   displayKey the church's sealing key; handed to a screen at login. The
//              check-in laptop logs in like any screen and seals with it.
//   settings   the shared settings, {rev, publishedAt, settings} (contract v6)
//   slides     the published deck, {deckRev, publishedAt, slides} (contract v5)
//   template   the "new screen" template, {savedAt, config}
//   journey    the Journey kiosk's room settings, {savedAt, settings}
//   calendar   the church calendar, {version, generatedAt, checkedAt, sourceUrl, events}
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
import { fromBase64, hmac, kidFor, newDisplayKey, randomBytes, safeEqual, seal, toBase64, toBase64Url } from './crypto.js';
import { trigger as pusherTrigger } from './pusher.js';
import { DEFAULT_CALENDAR_URL, scrapeCalendar } from './calendar.js';
import { DOORBELL_EVENT, REPLAYED, checkPublish, frameText, replayKey } from './live.js';
import { Relay } from './relay.js';

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
export const BODY_MAX = 128 * 1024;   // bytes; the entry point refuses a longer Content-Length before reading

/** The channel the screens already listen on for check-ins. */
export const DISPLAY_CHANNEL = 'awana-channel';
/** A plaintext doorbell: "something you fetch from me changed". No content. */
export const SYNC_CHANNEL = 'awana-sync';
export const SYNC_EVENT = 'changed';

/**
 * @typedef {{ get(key: string): Promise<any>, put(key: string, value: any): Promise<void>, delete(key: string): Promise<any> }} Store
 */

/** @param {unknown} body @param {number} [status] @param {Record<string, string>} [headers] */
export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** @param {string} message @param {number} status @param {Record<string, unknown>} [extra] */
function fail(message, status, extra = {}) {
  return json({ error: message, ...extra }, status);
}

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
   *   publish?: (channel: string, event: string, payload: unknown) => Promise<{ok: boolean, error?: string}>,
   *   broadcast?: (text: string) => number, closeAll?: (code: number, reason: string) => void }} deps
   */
  constructor({ storage, env, fetchFn, now, publish, broadcast, closeAll }) {
    this.storage = storage;
    this.env = env || {};
    this.fetchFn = fetchFn || ((...args) => fetch(...args));
    this.now = now || (() => Date.now());
    this.publish = publish || ((channel, event, payload) =>
      pusherTrigger(this.env, channel, event, payload, { fetchFn: this.fetchFn }));
    // The live channel: every screen's socket (index.js). While the Pusher
    // secrets are set, everything also goes to Pusher, so screens on either
    // transport agree; with them removed (Pusher retired, 2026-10-03) the
    // live channel alone carries it.
    this.broadcast = broadcast || (() => 0);
    this.closeAll = closeAll || (() => {});
    this.relayQueue = new Relay(this.storage, this.now);
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
   * Is this the passphrase? The first ever check adopts INITIAL_PASSPHRASE
   * (a Worker secret, set once at deploy) into storage; after that only the
   * stored hash counts, so a later change survives redeploys.
   * @param {unknown} raw
   * @returns {Promise<'ok'|'wrong'|'not-configured'>}
   */
  async checkPassphrase(raw) {
    const typed = normalizeSyncPassphrase(raw);
    let auth = await this.storage.get('auth');
    if (!auth) {
      const initial = normalizeSyncPassphrase(this.env.INITIAL_PASSPHRASE);
      if (!initial) return 'not-configured';
      const salt = toBase64(randomBytes(16));
      auth = { salt, hash: await this.hashPassphrase(initial, salt), epoch: 1, changedAt: new Date(this.now()).toISOString() };
      await this.storage.put('auth', auth);
    }
    if (!typed) return 'wrong';
    return safeEqual(await this.hashPassphrase(typed, auth.salt), auth.hash) ? 'ok' : 'wrong';
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

  /** @param {string} event @param {unknown} payload */
  async publishSealed(event, payload) {
    const envelope = await seal(await this.displayKey(), event, payload);
    if (!envelope) return { ok: false, error: 'cannot-seal' };
    await this.relay(event, envelope);
    const sent = await this.publish(DISPLAY_CHANNEL, event, envelope);
    // No Pusher at all is not a failed broadcast: the live channel carried it.
    return sent.error === 'pusher-not-configured' ? { ok: true } : sent;
  }

  /** @param {'calendar'|'journey'|'template'} what @param {string} at */
  async ring(what, at) {
    this.broadcast(frameText(DOORBELL_EVENT, { what, at }));
    return this.publish(SYNC_CHANNEL, SYNC_EVENT, { what, at });
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
        case 'GET /v1/calendar':
          return await this.getCalendar();
        default:
          break;
      }
      const known = new Set([
        'GET /v1/state', 'PUT /v1/settings', 'PUT /v1/slides', 'PUT /v1/template',
        'PUT /v1/journey', 'POST /v1/calendar/refresh', 'POST /v1/passphrase', 'POST /v1/publish',
        'POST /v1/relay', 'GET /v1/relay/next', 'POST /v1/relay/answer', 'GET /v1/relay/result',
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
          const r = await this.relayQueue.enqueue(await this.body(request));
          return r.ok ? json({ id: r.id, laptopOnline: r.laptopOnline }) : fail(r.error, r.status);
        }
        case 'GET /v1/relay/next': return json(await this.relayQueue.take());
        case 'POST /v1/relay/answer': {
          const r = await this.relayQueue.answer(await this.body(request));
          return r.ok ? json({ ok: true }) : fail(r.error, r.status);
        }
        case 'GET /v1/relay/result': return json(await this.relayQueue.result(url.searchParams.get('id')));
        default: return fail('Not found.', 404);
      }
    } catch (err) {
      if (err instanceof BadRequest) return fail(err.message, 400);
      console.error('[sync] unexpected error', err);
      return fail('Something went wrong on the sync service.', 500);
    }
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

  /** @param {Request} request @param {string} ip */
  async login(request, ip) {
    const locked = await this.lockout(ip);
    if (locked) return locked;
    const body = await this.body(request);
    const verdict = await this.checkPassphrase(body.passphrase);
    if (verdict === 'not-configured') return fail('The sync service has no passphrase yet. Finish its setup first.', 503);
    if (verdict === 'wrong') {
      const triesLeft = await this.noteFailure(ip);
      return fail('That is not the passphrase.', 401, { reason: 'wrong', triesLeft });
    }
    await this.storage.delete(`fails:${ip}`);
    // The check-in laptop signs in FIRST with the key it already seals with,
    // so screens set up before this service keep reading names. Only ever
    // into an empty slot: once a key exists, every login adopts it.
    if (!(await this.storage.get('displayKey')) && typeof body.seedKey === 'string') {
      const bytes = fromBase64(body.seedKey.trim());
      if (bytes && bytes.length === 32) await this.storage.put('displayKey', body.seedKey.trim());
    }
    const auth = await this.storage.get('auth');
    return json({
      session: await this.mintSession(auth.epoch),
      displayKey: await this.displayKey(),
      pusher: { key: this.env.PUSHER_KEY || '', cluster: this.env.PUSHER_CLUSTER || '' },
      state: await this.state(),
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
   * @param {Request} request @param {string} ip
   */
  async changePassphrase(request, ip) {
    const locked = await this.lockout(ip);
    if (locked) return locked;
    const body = await this.body(request);
    const verdict = await this.checkPassphrase(body.current);
    if (verdict !== 'ok') {
      const triesLeft = await this.noteFailure(ip);
      return fail('The current passphrase is not right.', 401, { reason: 'wrong', triesLeft });
    }
    const next = normalizeSyncPassphrase(body.next);
    if (next.length < PASSPHRASE_MIN || next.length > PASSPHRASE_MAX) {
      return fail(`The new passphrase needs at least ${PASSPHRASE_MIN} characters.`, 400);
    }
    const prev = await this.storage.get('auth');
    const salt = toBase64(randomBytes(16));
    const auth = { salt, hash: await this.hashPassphrase(next, salt), epoch: prev.epoch + 1, changedAt: new Date(this.now()).toISOString() };
    await this.storage.put('auth', auth);
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

  /**
   * The check-in laptop's events (and anything else a signed-in device sends),
   * relayed to every live screen exactly as given: sealed frames stay sealed.
   * @param {Request} request
   */
  async livePublish(request) {
    const res = checkPublish(await this.body(request));
    if (!res.ok) return fail(res.error, res.status);
    const screens = await this.relay(res.event, res.payload);
    return json({ ok: true, screens });
  }

  /** The scheduled run: keep the calendar fresh without anyone pressing a button. */
  async cron() {
    await this.relayQueue.purge();
    const res = await this.refreshCalendar();
    return res.status;
  }
}

class BadRequest extends Error {}
