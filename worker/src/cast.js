// @ts-check
// Cast, the lobby computer's AirServer-like screen (owner 2026-11-08: "set it up kind
// of like an air server ... present from their laptop but through a webpage that is
// controlling that computer"; "TV code only"; src/routes.md 10.18). KVBC Awana's tray
// turns the Cast screen on (site/cast/screen/, signed in like every screen); it opens
// a room here and shows a six-digit CODE. A presenter on awana.kvbchurch.org/cast types
// that code (no passphrase: a guest speaker has none) and gets a short-lived TOKEN;
// with it they put things on the TV: their shared screen, a YouTube video, text,
// pictures, a PDF (PowerPoint saved as PDF), a Google Slides link (copied as its PDF).
//
// The engine is the Sparks remote's (classroom.js, rules shared/classroomRemote.js),
// a second copy under its own keys and doorbell ('cast'):
//   cast:stage                  what the Cast screen shows
//   castmeta:<id> / castpart:   the room's uploaded files
//   cast:room                   {code, at, tokens: [{hash, at}]}
// Opening (a new code) or closing the room clears the stage, every file and every
// token: nothing a guest put up outlives their session.
//
// PowerPoint (owner 2026-11-08: "Support pptx upload and show a preview on the phone
// screen", the exact copy): the presenter's browser scrambles the .pptx (AES-256-GCM,
// a fresh key) and uploads the ciphertext here in parts (castconv:<id>,
// castconvpart:<id>:<n>); "start" hands the GitHub job cast-convert.yml the id and the
// key as ONE dispatch input (the print tool's way, prints.js: the key passes through
// in memory only). The job reads the ciphertext with the machine token (HANDBOOK_TOKEN),
// turns it into a PDF with LibreOffice, and sends the PDF back: it becomes an ordinary
// file of the room, and the presenter's page (polling the status) puts it up. The
// ciphertext is deleted once the job answers, whatever happened; anything left over
// goes with the room (a new code, Cast off) or after CONVERT_TTL_MS.
//
// ONE presenter at a time (owner 2026-11-08: "only one phone should connect at a
// time"; picked: refuse the second): a join while another presenter's token is live
// and was used within PRESENTER_IDLE_MS is refused 409 `busy`. The slot frees when
// the presenter leaves (POST /v1/cast/leave, the page's Disconnect and "Display
// code"), goes quiet for PRESENTER_IDLE_MS, or the lobby computer's tray "Show Cast
// code" resets the room (POST /v1/cast/reset: everything down, nobody connected, the
// SAME code). When a token was last used is memory only (a write every poll would
// spend the free plan's storage writes); after a restart it counts from the join.
//
// YouTube search (owner 2026-11-08): GET /v1/cast/youtube?q= asks the YouTube Data
// API with the Worker secret YOUTUBE_API_KEY (free: 100 units a search, 10,000 a day),
// safe search strict, embeddable videos only; answers kept 10 minutes; at most
// YOUTUBE_PER_HOUR searches an hour. Without the secret: 503 `not-configured`.
//
// A wrong code is refused; more than JOIN_FAILS_MAX wrong codes within
// JOIN_WINDOW_MS refuses every join for the rest of that window (a million codes
// cannot be walked). Tokens are stored hashed (SHA-256), at most TOKENS_MAX, each
// good for TOKEN_TTL_MS.

import { Classroom, newId } from './classroom.js';
import { fail, json } from './http.js';

const ROOM_KEY = 'cast:room';
/** A presenter's token is good this long (a long service or class). */
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
export const TOKENS_MAX = 20;
export const JOIN_FAILS_MAX = 20;
export const JOIN_WINDOW_MS = 10 * 60 * 1000;
export const CODE_DIGITS = 6;
/** A presenter quiet this long no longer holds the room (the next one may join). */
export const PRESENTER_IDLE_MS = 30 * 60 * 1000;
export const YOUTUBE_PER_HOUR = 60;
export const YOUTUBE_RESULTS = 8;
const YOUTUBE_CACHE_MS = 10 * 60 * 1000;
const TOKEN_RE = /^t[a-z0-9]{24,40}$/;

/** The largest PowerPoint (bytes) the presenter may send to be turned into slides. */
export const CONVERT_MAX_BYTES = 40 * 1024 * 1024;
export const CONVERT_PART_BYTES = 96 * 1024;
/** An unfinished or finished conversion's record is deleted after this. */
export const CONVERT_TTL_MS = 60 * 60 * 1000;
/** Conversions waiting at once, and started per room per hour (each one is a GitHub job). */
export const CONVERT_PENDING_MAX = 3;
export const CONVERT_PER_HOUR = 10;
export const CONVERT_WORKFLOW = 'cast-convert.yml';
/** Why a conversion failed: the job names one, the page words it. */
export const CONVERT_FAILS = Object.freeze(['type', 'too-big', 'convert', 'key']);
const CONV_PREFIX = 'castconv:';
const CONV_PART_PREFIX = 'castconvpart:';
const CONV_ID_RE = /^c[a-z0-9]{16}$/;
const KEY_RE = /^[A-Za-z0-9_-]{43}$/;
// Ciphertext = 12-byte IV + the file + 16-byte tag.
const CONVERT_MAX_CT = CONVERT_MAX_BYTES + 28;

/** SHA-256 of a token, hex. @param {string} token */
async function hashOf(token) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ISO 8601 duration (PT1H2M3S) in seconds, 0 when not one. @param {unknown} v */
export function isoSeconds(v) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(v || ''));
  if (!m) return 0;
  return (Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + (Number(m[3] || 0) * 60) + Number(m[4] || 0);
}

/** The few HTML entities YouTube's titles carry, as text. @param {string} s */
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|#x27|apos);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", '#x27': "'", apos: "'" })[e]);
}

/** A fresh six-digit code (never starting with 0, so it reads as six digits). */
export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

export class Cast {
  /**
   * @param {{ storage: any, now: () => number, ring: (payload: Record<string, unknown>) => void, fetchFn?: typeof fetch, prints?: () => any, env?: () => Record<string, any> }} deps
   */
  constructor({ storage, now, ring, fetchFn, prints, env }) {
    this.storage = storage;
    this.now = now;
    this.env = env || (() => ({}));
    this.fetchFn = fetchFn || ((u, i) => fetch(u, i));
    /** When each presenter token was last used (hash -> ms), memory only. @type {Map<string, number>} */
    this.seen = new Map();
    /** YouTube searches this hour, and answers kept a while. */
    this.searches = { n: 0, since: 0 };
    /** @type {Map<string, { at: number, body: any }>} */
    this.searchCache = new Map();
    /** The print tool's GitHub dispatch and machine token (prints.js). */
    this.prints = prints || (() => null);
    /** Conversions started this hour: { n, since }. */
    this.converts = { n: 0, since: 0 };
    this.engine = new Classroom({
      storage, now, ring, fetchFn,
      room: { what: 'cast', buttonsKey: 'cast:buttons', stageKey: 'cast:stage', filePrefix: 'castmeta:', partPrefix: 'castpart:' },
    });
    /** @type {{ n: number, since: number }} */
    this.fails = { n: 0, since: 0 };
  }

  /** @returns {Promise<{ code: string | null, at: number, tokens: { hash: string, at: number }[] }>} */
  async roomDoc() {
    const d = await this.storage.get(ROOM_KEY);
    return { code: typeof d?.code === 'string' ? d.code : null, at: Number(d?.at) || 0, tokens: Array.isArray(d?.tokens) ? d.tokens : [] };
  }

  /** The stage back to nothing, every file of the room gone. */
  async clear() {
    this.engine.rtc = null;
    const metas = await this.storage.list({ prefix: 'castmeta:' });
    for (const [, meta] of metas) if (meta?.id) await this.engine.deleteFile(meta);
    const convs = await this.storage.list({ prefix: CONV_PREFIX });
    for (const [, conv] of convs) if (conv?.id) await this.dropConvert(conv, true);
    this.converts = { n: 0, since: 0 };
    const stage = await this.engine.stage();
    if (stage.show || stage.preview) await this.engine.saveStage({ ...stage, show: null, preview: null, cmds: [] });
  }

  /** POST /v1/cast/open (the Cast screen): a fresh code; whatever was up and every token goes. */
  async open() {
    await this.clear();
    const room = { code: newCode(), at: this.now(), tokens: [] };
    await this.storage.put(ROOM_KEY, room);
    return json({ ok: true, code: room.code });
  }

  /** POST /v1/cast/close (the Cast screen, KVBC Awana turning Cast off): no code, nothing kept. */
  async close() {
    await this.clear();
    await this.storage.put(ROOM_KEY, { code: null, at: this.now(), tokens: [] });
    return json({ ok: true });
  }

  /** POST /v1/cast/join {code} (a presenter, no sign-in): a token, or refused. @param {any} body */
  async join(body) {
    const t = this.now();
    if (t - this.fails.since > JOIN_WINDOW_MS) this.fails = { n: 0, since: t };
    if (this.fails.n >= JOIN_FAILS_MAX) return fail('Too many wrong codes. Wait a few minutes, then try again.', 429, { reason: 'locked', retryAfterMs: JOIN_WINDOW_MS - (t - this.fails.since) });
    const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : '';
    const room = await this.roomDoc();
    if (!room.code || code.length !== CODE_DIGITS || code !== room.code) {
      this.fails.n += 1;
      return fail(room.code ? 'That code is not the one on the TV. Check it and try again.' : 'Cast is not turned on. Turn it on from the lobby computer, then use the code it shows.', 403, { reason: room.code ? 'wrong-code' : 'off' });
    }
    // One presenter at a time: someone live and not idle holds the room.
    const busy = room.tokens.some((x) => t - x.at <= TOKEN_TTL_MS && t - (this.seen.get(x.hash) ?? x.at) <= PRESENTER_IDLE_MS);
    if (busy) return fail('Someone else is presenting right now. When they tap Disconnect or Display code, try again.', 409, { reason: 'busy' });
    const token = newId('t', 28);
    const hash = await hashOf(token);
    this.seen.clear();
    this.seen.set(hash, t);
    await this.storage.put(ROOM_KEY, { ...room, tokens: [{ hash, at: t }] });
    return json({ ok: true, token, ttlMs: TOKEN_TTL_MS });
  }

  /** The presenter's token from the request, when it is a live one of this room. @param {Request} request */
  async tokenOf(request) {
    const raw = (request.headers.get('X-Cast-Token') || '').trim();
    if (!TOKEN_RE.test(raw)) return null;
    const room = await this.roomDoc();
    if (!room.code) return null;
    const hash = await hashOf(raw);
    const hit = room.tokens.find((x) => x.hash === hash && this.now() - x.at <= TOKEN_TTL_MS);
    if (hit) this.seen.set(hash, this.now());
    return hit ? hash : null;
  }

  /** POST /v1/cast/leave {takeDown?} (the presenter): free the room; with takeDown, the TV back to its code. @param {string} who @param {any} body */
  async leave(who, body) {
    if (body?.takeDown === true) await this.engine.press('cast-presenter', { action: 'back' });
    const room = await this.roomDoc();
    await this.storage.put(ROOM_KEY, { ...room, tokens: room.tokens.filter((x) => x.hash !== who) });
    this.seen.delete(who);
    return json({ ok: true });
  }

  /** POST /v1/cast/reset (the lobby computer's tray "Show Cast code"): everything down, nobody connected, the same code. */
  async reset() {
    await this.clear();
    const room = await this.roomDoc();
    await this.storage.put(ROOM_KEY, { ...room, tokens: [] });
    this.seen.clear();
    return json({ ok: true, code: room.code });
  }

  /** GET /v1/cast/youtube?q= (the presenter): YouTube's videos for the words. @param {string | null} q */
  async youtube(q) {
    const key = String(this.env()?.YOUTUBE_API_KEY || '');
    if (!key) return fail('YouTube search is not set up yet. Paste a link instead.', 503, { reason: 'not-configured' });
    const words = String(q || '').replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!words) return fail('Type something to search for.', 400, { reason: 'empty' });
    const t = this.now();
    const cacheKey = words.toLowerCase();
    const hit = this.searchCache.get(cacheKey);
    if (hit && t - hit.at <= YOUTUBE_CACHE_MS) return json(hit.body);
    if (t - this.searches.since > 60 * 60 * 1000) this.searches = { n: 0, since: t };
    if (this.searches.n >= YOUTUBE_PER_HOUR) return fail('That is a lot of searches this hour. Paste a link instead.', 429, { reason: 'too-many' });
    this.searches.n += 1;
    const api = 'https://www.googleapis.com/youtube/v3';
    const get = async (/** @type {string} */ url) => {
      const res = await this.fetchFn(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
      return res.ok ? res.json() : Promise.reject(res.status);
    };
    let found;
    try {
      found = await get(`${api}/search?part=snippet&type=video&videoEmbeddable=true&safeSearch=strict&maxResults=${YOUTUBE_RESULTS}&q=${encodeURIComponent(words)}&key=${encodeURIComponent(key)}`);
    } catch (status) {
      return fail(status === 403 ? 'YouTube search is resting for today (its free daily limit). Paste a link instead.' : 'YouTube did not answer. Try again, or paste a link.', 502, { reason: 'youtube', status: Number(status) || 0 });
    }
    const items = (Array.isArray(found?.items) ? found.items : [])
      .map((/** @type {any} */ i) => ({ id: String(i?.id?.videoId || ''), title: String(i?.snippet?.title || ''), channel: String(i?.snippet?.channelTitle || '') }))
      .filter((v) => /^[A-Za-z0-9_-]{11}$/.test(v.id));
    // Lengths (1 unit for all of them); a failure here just leaves them out.
    let lengths = new Map();
    if (items.length) {
      try {
        const d = await get(`${api}/videos?part=contentDetails&id=${items.map((v) => v.id).join(',')}&key=${encodeURIComponent(key)}`);
        lengths = new Map((d?.items || []).map((/** @type {any} */ v) => [v.id, isoSeconds(v?.contentDetails?.duration)]));
      } catch { /* no lengths */ }
    }
    const results = items.map((v) => ({
      youtube: v.id,
      title: decodeEntities(v.title).slice(0, 120),
      channel: decodeEntities(v.channel).slice(0, 80),
      seconds: lengths.get(v.id) || 0,
    }));
    const body = { ok: true, results };
    this.searchCache.set(cacheKey, { at: t, body });
    if (this.searchCache.size > 100) this.searchCache.delete(this.searchCache.keys().next().value);
    return json(body);
  }

  /** GET /v1/cast/screen (the Cast screen): its code and the stage. */
  async screen() {
    const room = await this.roomDoc();
    const res = await this.engine.readStage(true);
    const body = await res.json();
    return json({ ...body, code: room.code });
  }

  /* ── PowerPoint into slides ── */

  /** Ready to convert: the print tool's dispatch token and the job's machine token are set. */
  convertReady() {
    const p = this.prints();
    return Boolean(p && p.configured() && p.env()?.HANDBOOK_TOKEN);
  }

  /** A conversion's record (deleted when past its time). @param {string} id */
  async convertDoc(id) {
    if (!CONV_ID_RE.test(id || '')) return null;
    const conv = await this.storage.get(CONV_PREFIX + id);
    if (conv && this.now() - (conv.at || 0) > CONVERT_TTL_MS) { await this.dropConvert(conv, true); return null; }
    return conv || null;
  }

  /** Delete a conversion's ciphertext (and, with all, its record). @param {any} conv @param {boolean} [all] */
  async dropConvert(conv, all) {
    for (let n = 0; n < (conv.parts || 0); n += 1) await this.storage.delete(`${CONV_PART_PREFIX}${conv.id}:${n}`);
    if (all) await this.storage.delete(CONV_PREFIX + conv.id);
    else await this.storage.put(CONV_PREFIX + conv.id, { ...conv, parts: 0 });
  }

  /** POST /v1/cast/convert {bytes, name}: start sending a scrambled PowerPoint. @param {any} body */
  async convertStart(body) {
    if (!this.convertReady()) return fail('PowerPoint is not set up here yet. Save it as a PDF and send that instead.', 503, { reason: 'not-configured' });
    const bytes = Number(body?.bytes);
    if (!Number.isInteger(bytes) || bytes < 29) return fail('That file is empty.', 400, { reason: 'empty' });
    if (bytes > CONVERT_MAX_CT) return fail('That PowerPoint is too big (40 MB at most). Save it as a PDF, or share your screen.', 413, { reason: 'too-big' });
    const t = this.now();
    let pending = 0;
    for (const [, c] of await this.storage.list({ prefix: CONV_PREFIX })) {
      if (!c?.id) continue;
      if (t - (c.at || 0) > CONVERT_TTL_MS) { await this.dropConvert(c, true); continue; }
      if (c.status === 'uploading' || c.status === 'converting') pending += 1;
    }
    if (pending >= CONVERT_PENDING_MAX) return fail('Other slides are being made right now. Try again in a minute.', 429, { reason: 'busy' });
    const id = newId('c', 16);
    const parts = Math.ceil(bytes / CONVERT_PART_BYTES);
    const name = String(body?.name || '').replace(/\.(pptx?|odp)$/i, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    await this.storage.put(CONV_PREFIX + id, { id, parts, bytes, next: 0, name, status: 'uploading', at: t });
    return json({ ok: true, id, parts, partBytes: CONVERT_PART_BYTES });
  }

  /** PUT /v1/cast/convert/:id/:n, one part of the ciphertext. @param {string} id @param {string} n @param {Request} request */
  async convertPart(id, n, request) {
    const conv = await this.convertDoc(id);
    const i = Number(n);
    if (!conv || conv.status !== 'uploading') return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (!Number.isInteger(i) || i < 0 || i >= conv.parts || i > conv.next || i < conv.next - 1) return fail('That part is out of order.', 409, { reason: 'order', next: conv.next });
    const buf = new Uint8Array(await request.arrayBuffer());
    const want = i === conv.parts - 1 ? conv.bytes - i * CONVERT_PART_BYTES : CONVERT_PART_BYTES;
    if (buf.length !== want) return fail('That part is the wrong size.', 400, { reason: 'size' });
    await this.storage.put(`${CONV_PART_PREFIX}${id}:${i}`, buf);
    if (i === conv.next) await this.storage.put(CONV_PREFIX + id, { ...conv, next: i + 1 });
    return json({ ok: true, next: Math.max(conv.next, i + 1) });
  }

  /** POST /v1/cast/convert/:id/start {key}: every part is here; start the GitHub job. @param {string} id @param {any} body */
  async convertGo(id, body) {
    const conv = await this.convertDoc(id);
    if (!conv) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    if (conv.status !== 'uploading') return json({ ok: true, status: conv.status });
    if (conv.next !== conv.parts) return fail('Part of the file did not arrive. Try again.', 400, { reason: 'parts', next: conv.next });
    const key = String(body?.key || '');
    if (!KEY_RE.test(key)) return fail('That is not a key.', 400, { reason: 'bad-key' });
    const t = this.now();
    if (t - this.converts.since > 60 * 60 * 1000) this.converts = { n: 0, since: t };
    if (this.converts.n >= CONVERT_PER_HOUR) return fail('That is a lot of PowerPoints this hour. Save it as a PDF and send that instead.', 429, { reason: 'too-many' });
    const p = this.prints();
    if (!this.convertReady()) return fail('PowerPoint is not set up here yet. Save it as a PDF and send that instead.', 503, { reason: 'not-configured' });
    // Marked BEFORE the dispatch: a second tap never starts a second job.
    await this.storage.put(CONV_PREFIX + id, { ...conv, status: 'converting', startedAt: t });
    const r = await p.dispatch(CONVERT_WORKFLOW, { job: `${id}.${key}` });
    if (!r.ok) {
      await this.storage.put(CONV_PREFIX + id, { ...conv });
      return fail('GitHub did not start making the slides. Try again in a minute, or save it as a PDF.', 502, { reason: 'dispatch', status: r.status });
    }
    this.converts.n += 1;
    return json({ ok: true, status: 'converting' });
  }

  /** GET /v1/cast/convert/:id (the presenter): where it is. @param {string} id */
  async convertStatus(id) {
    const conv = await this.convertDoc(id);
    if (!conv) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    return json({ ok: true, status: conv.status, ...(conv.file ? { file: conv.file } : {}), ...(conv.error ? { error: conv.error } : {}) });
  }

  /** GET /v1/cast/convert/:id/job (the job, machine token): the ciphertext's bytes. @param {string} id */
  async convertJob(id) {
    const conv = await this.convertDoc(id);
    if (!conv || conv.status !== 'converting' || !conv.parts) return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    const storage = this.storage;
    let n = 0;
    const body = new ReadableStream({
      async pull(controller) {
        if (n >= conv.parts) { controller.close(); return; }
        const part = await storage.get(`${CONV_PART_PREFIX}${conv.id}:${n}`);
        n += 1;
        if (!part) { controller.error(new Error('missing part')); return; }
        controller.enqueue(new Uint8Array(part));
      },
    });
    return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(conv.bytes), 'Cache-Control': 'no-store' } });
  }

  /** PUT /v1/cast/convert/:id/result (the job): the PDF, kept as a file of the room. @param {string} id @param {Request} request */
  async convertResult(id, request) {
    const conv = await this.convertDoc(id);
    if (!conv || conv.status !== 'converting') return fail('There is no upload by that name.', 404, { reason: 'no-upload' });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const file = await this.engine.storeBytes(bytes, conv.name || 'Slides');
    if (!file || file.kind !== 'pdf') {
      await this.dropConvert({ ...conv, status: 'failed', error: bytes.length > 20 * 1024 * 1024 ? 'too-big' : 'convert' });
      return fail('That is not a PDF of 20 MB at most.', 400, { reason: 'type' });
    }
    await this.dropConvert({ ...conv, status: 'done', file });
    return json({ ok: true, id: file.id });
  }

  /** POST /v1/cast/convert/:id/failed {reason} (the job). @param {string} id @param {any} body */
  async convertFailed(id, body) {
    const conv = await this.convertDoc(id);
    if (!conv) return json({ ok: true });
    const error = CONVERT_FAILS.includes(body?.reason) ? body.reason : 'convert';
    if (conv.status !== 'done') await this.dropConvert({ ...conv, status: 'failed', error });
    return json({ ok: true });
  }
}

/**
 * The routes (src/routes.md 10.18). The Cast screen signs in like every screen
 * (session); a presenter carries the token from /v1/cast/join (X-Cast-Token) on
 * public routes, checked here before anything runs.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountCast(registry, core) {
  const c = () => /** @type {Cast} */ (core.cast);
  /** A presenter route: refused without a live token. @param {(ctx: any, who: string) => Promise<Response>} fn */
  const presenter = (fn) => async (ctx) => {
    const who = await c().tokenOf(ctx.request);
    if (!who) return fail('This page is no longer connected to the TV. Type the code on the TV again.', 401, { reason: 'token' });
    return fn(ctx, who);
  };
  // The Cast screen (signed in).
  registry.add('POST', '/v1/cast/open', 'session', async () => c().open());
  registry.add('POST', '/v1/cast/close', 'session', async () => c().close());
  registry.add('GET', '/v1/cast/screen', 'session', async () => c().screen());
  registry.add('GET', '/v1/cast/screen/files/:id', 'session', async ({ params }) => c().engine.readFile(params.id));
  registry.add('POST', '/v1/cast/screen/now', 'session', async ({ body }) => c().engine.putNow(await body()));
  registry.add('GET', '/v1/cast/screen/signal', 'session', async () => c().engine.readSignal('offer', null));
  registry.add('POST', '/v1/cast/screen/signal', 'session', async ({ body }) => c().engine.putSignal(await body()));
  // A video that ended: the screen takes it down itself (only Back: never another press).
  registry.add('POST', '/v1/cast/screen/back', 'session', async () => c().engine.press('cast-screen', { action: 'back' }));
  // A presenter (the code's token).
  registry.add('POST', '/v1/cast/reset', 'session', async () => c().reset());
  registry.add('POST', '/v1/cast/join', 'public', async ({ body }) => c().join(await body()));
  registry.add('POST', '/v1/cast/leave', 'public', presenter(async ({ body }, who) => c().leave(who, await body())));
  registry.add('GET', '/v1/cast/youtube', 'public', presenter(async ({ url }) => c().youtube(url.searchParams.get('q'))));
  registry.add('GET', '/v1/cast/state', 'public', presenter(async () => c().engine.remoteState()));
  registry.add('POST', '/v1/cast/press', 'public', presenter(async ({ body }, who) => c().engine.press(who, await body())));
  registry.add('POST', '/v1/cast/files', 'public', presenter(async ({ body }) => c().engine.startFile(await body())));
  registry.add('PUT', '/v1/cast/files/:id/:n', 'public', presenter(async ({ params, request }) => c().engine.putPart(params.id, params.n, request)));
  registry.add('POST', '/v1/cast/files/:id/done', 'public', presenter(async ({ params }) => c().engine.finishFile(params.id)));
  registry.add('POST', '/v1/cast/signal', 'public', presenter(async ({ body }) => c().engine.putSignal(await body())));
  registry.add('GET', '/v1/cast/signal', 'public', presenter(async ({ url }) => c().engine.readSignal('answer', url.searchParams.get('id'))));
  // The phone's preview of the slides on the TV: the room's own file.
  registry.add('GET', '/v1/cast/files/:id', 'public', presenter(async ({ params }) => c().engine.readFile(params.id)));
  // PowerPoint into slides: the GitHub job's routes (the machine token, HANDBOOK_TOKEN),
  // registered first so `/:id/result` is never taken for a part number...
  const machine = (/** @type {(ctx: any) => Promise<Response>} */ fn) => async (/** @type {any} */ ctx) => {
    const p = core.prints;
    if (!p || !p.machineOk(ctx.request)) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return fn(ctx);
  };
  registry.add('GET', '/v1/cast/convert/:id/job', 'public', machine(async ({ params }) => c().convertJob(params.id)));
  registry.add('PUT', '/v1/cast/convert/:id/result', 'public', machine(async ({ params, request }) => c().convertResult(params.id, request)));
  registry.add('POST', '/v1/cast/convert/:id/failed', 'public', machine(async ({ params, body }) => c().convertFailed(params.id, await body())));
  // ...then the presenter's upload and status.
  registry.add('POST', '/v1/cast/convert', 'public', presenter(async ({ body }) => c().convertStart(await body())));
  registry.add('PUT', '/v1/cast/convert/:id/:n', 'public', presenter(async ({ params, request }) => c().convertPart(params.id, params.n, request)));
  registry.add('POST', '/v1/cast/convert/:id/start', 'public', presenter(async ({ params, body }) => c().convertGo(params.id, await body())));
  registry.add('GET', '/v1/cast/convert/:id', 'public', presenter(async ({ params }) => c().convertStatus(params.id)));
}
