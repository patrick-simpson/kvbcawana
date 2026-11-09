// @ts-check
// Cast, the lobby computer's AirServer-like screen (owner 2026-11-08: "set it up kind
// of like an air server ... present from their laptop but through a webpage that is
// controlling that computer"; "TV code only"; src/routes.md 10.18). KVBC Awana's tray
// turns the Cast screen on (cast.kvbchurch.org/screen/, site/cast/screen/, signed in like
// every screen); it opens a room here and shows a six-digit CODE. A presenter on
// cast.kvbchurch.org (Cast's own site since 2026-11-09; awana.kvbchurch.org/cast 301s) types
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
// in memory only). The job reads the ciphertext with the machine token (CAST_CONVERT_TOKEN when set, else HANDBOOK_TOKEN),
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
// SAME code), or its "Disconnect the presenter" lets them go and leaves the TV as it is
// (POST /v1/cast/kick). When a token was last used is memory only (a write every poll would
// spend the free plan's storage writes); after a restart it counts from the join.
//
// YouTube search (owner 2026-11-08): GET /v1/cast/youtube?q= asks the YouTube Data
// API with the Worker secret YOUTUBE_API_KEY (free: 100 units a search, 10,000 a day),
// safe search strict, embeddable videos only; answers kept 10 minutes; at most
// YOUTUBE_PER_HOUR searches an hour. Without the secret: 503 `not-configured`.
//
// A wrong code is refused (security review 2026-11-09). Wrong codes are counted in
// storage (`cast:fails`, so a deploy does not reset them): JOIN_NET_FAILS_MAX from one
// network (sync.js netOf) within JOIN_WINDOW_MS refuse THAT network for the rest of
// the window; JOIN_FAILS_MAX from anywhere ROTATE the code (the TV reads the new one on
// the doorbell; whoever is presenting stays connected), so guessing has to start over
// and nobody can lock joining for everyone. A wrong code and a right code while someone
// else presents get the SAME answer (403 `refused`), so a busy room never confirms a
// guess. Tokens are stored hashed (SHA-256), at most TOKENS_MAX, each good for TOKEN_TTL_MS.
//
// The DESK (owner 2026-11-09): a back-of-house window on the lobby computer
// (cast.kvbchurch.org/desk/, KVBC Awana's "Cast control" window on a second monitor)
// that can do everything a presenter can, always alongside the one phone presenter.
// It is NOT a presenter: it holds no token and never takes the presenter's slot, so it
// never blocks a join, is never refused `busy`, and no join, leave, kick or reset
// touches it; last press wins between them. Its credential is the computer's own sync
// session (Authorization: Bearer, the same sign-in the app already uses for open, close,
// kick and reset): the /v1/cast/desk/* routes are `session` routes, the registry checks
// the session before anything runs. They run the presenter's own code with the caller
// named DESK, so the room caps (CAST_FILES_MAX, CAST_BYTES_MAX), the room's bytes an
// hour, and the per-caller rates (files, PowerPoints, presses) apply to it exactly as to
// a presenter, with an allowance of its own.

import { Classroom, newId } from './classroom.js';
import { netOf } from './netof.js';
import { fail, json } from './http.js';
import { CLASSROOM_CLIP_MAX_BYTES, CLASSROOM_FILE_MAX_BYTES, CLASSROOM_FILE_TYPES, fileLimits, isClipType } from '../../shared/classroomRemote.js';

const ROOM_KEY = 'cast:room';

// What a guest may keep in the room (a guest needs no passphrase, so this bounds
// what one code can cost the free plan's storage and writes). A talk needs a few
// pictures, a PDF or two and perhaps one video: at most CAST_FILES_MAX files and
// CAST_BYTES_MAX bytes (one 200 MB clip plus two 20 MB PDFs or pictures). A new
// upload that would pass either makes room by deleting the room's OLDEST finished
// files that are not on the TV; one that still cannot fit is refused 413 `room-full`.
export const CAST_FILES_MAX = 12;
export const CAST_BYTES_MAX = CLASSROOM_CLIP_MAX_BYTES + 2 * CLASSROOM_FILE_MAX_BYTES;
// Rates (memory only; a restart forgets them, the room caps above stay): a presenter
// token may start CAST_FILES_PER_HOUR uploads or link copies and CAST_CONVERTS_PER_HOUR
// PowerPoints an hour; the room takes CAST_UPLOAD_BYTES_PER_HOUR an hour whoever
// sends them (leaving and joining again gets a new token, not a new allowance). 300 MB
// is about 3,200 stored parts an hour, well inside the free plan's daily writes for a
// normal evening, and more than a real talk sends.
export const CAST_FILES_PER_HOUR = 30;
export const CAST_CONVERTS_PER_HOUR = 6;
export const CAST_UPLOAD_BYTES_PER_HOUR = 300 * 1024 * 1024;
const HOUR_MS = 60 * 60 * 1000;
/** A presenter's token is good this long (a long service or class). */
export const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
export const TOKENS_MAX = 20;
export const JOIN_FAILS_MAX = 20;
export const JOIN_NET_FAILS_MAX = 10;
export const JOIN_WINDOW_MS = 10 * 60 * 1000;
const FAILS_KEY = 'cast:fails';
/** Networks remembered in one window's count (a scan from more is still counted overall). */
const FAILS_NETS_MAX = 200;
export const CODE_DIGITS = 6;
/** A presenter quiet this long no longer holds the room (the next one may join). */
export const PRESENTER_IDLE_MS = 30 * 60 * 1000;
export const YOUTUBE_PER_HOUR = 60;
export const YOUTUBE_RESULTS = 8;
const YOUTUBE_CACHE_MS = 10 * 60 * 1000;
const TOKEN_RE = /^t[a-z0-9]{24,40}$/;
/** The desk's name in the rates and press buckets (a token's is its 64-hex hash: never equal). */
export const DESK = 'desk';

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
    this.ring = ring;
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
    /** Per presenter token this hour (hash -> counts), memory only. @type {Map<string, { since: number, files: number, converts: number }>} */
    this.rates = new Map();
    /** Bytes the room took this hour, whoever sent them. */
    this.roomBytes = { n: 0, since: 0 };
  }

  /** This token's counts for the hour. @param {string} who */
  rateOf(who) {
    const t = this.now();
    let r = this.rates.get(who);
    if (!r || t - r.since > HOUR_MS) {
      r = { since: t, files: 0, converts: 0 };
      this.rates.set(who, r);
      while (this.rates.size > 64) this.rates.delete(/** @type {string} */ (this.rates.keys().next().value));
    }
    return r;
  }

  /** Bytes the room may still take this hour. */
  roomBytesLeft() {
    const t = this.now();
    if (t - this.roomBytes.since > HOUR_MS) this.roomBytes = { n: 0, since: t };
    return CAST_UPLOAD_BYTES_PER_HOUR - this.roomBytes.n;
  }

  /**
   * Room for `bytes` more in the room: the oldest finished files not on the TV go
   * until it fits. False when it cannot (what is up, or still uploading, fills it).
   * @param {number} bytes
   */
  async makeRoom(bytes) {
    const metas = [...(await this.storage.list({ prefix: 'castmeta:' })).values()].filter((m) => m?.id);
    const shown = (await this.engine.stage()).show?.button?.file || null;
    let count = metas.length;
    let used = metas.reduce((n, m) => n + (Number(m.bytes) || 0), 0);
    const fits = () => count + 1 <= CAST_FILES_MAX && used + bytes <= CAST_BYTES_MAX;
    if (fits()) return true;
    const old = metas.filter((m) => m.done && m.id !== shown).sort((a, b) => (a.at || 0) - (b.at || 0));
    for (const m of old) {
      if (fits()) break;
      await this.engine.deleteFile(m);
      count -= 1;
      used -= Number(m.bytes) || 0;
    }
    return fits();
  }

  /** POST /v1/cast/files (the presenter): an upload or a link copy, within the room's caps and rates. @param {string} who @param {any} body */
  async fileStart(who, body) {
    const r = this.rateOf(who);
    if (r.files >= CAST_FILES_PER_HOUR) return fail('That is a lot of files this hour. Wait a while, or share your screen instead.', 429, { reason: 'too-many' });
    const isLink = typeof body?.url === 'string';
    const bytes = isLink ? CLASSROOM_FILE_MAX_BYTES : Number(body?.bytes);
    // Anything the engine would refuse anyway (type, empty, too big) gets its own answer.
    const typeOk = CLASSROOM_FILE_TYPES.includes(body?.type) || isClipType(body?.type);
    if (!isLink && (!typeOk || !Number.isInteger(bytes) || bytes < 1 || bytes > fileLimits(body.type).max)) return this.engine.startFile(body);
    const left = this.roomBytesLeft();
    if ((isLink ? 1 : bytes) > left) return fail('That is a lot sent to the TV this hour. Wait a while, or share your screen instead.', 429, { reason: 'too-many' });
    if (!(await this.makeRoom(Math.min(bytes, left)))) return fail('The TV is holding as much as it can. Take down what is up, then try again.', 413, { reason: 'room-full' });
    r.files += 1;
    const res = isLink
      ? await this.engine.importFile(body.url, body.name, { maxBytes: Math.min(CLASSROOM_FILE_MAX_BYTES, left) })
      : await this.engine.startFile(body);
    if (res.ok) {
      const got = isLink ? Number((await res.clone().json())?.bytes) || 0 : bytes;
      this.roomBytes.n += got;
    }
    return res;
  }

  /** @returns {Promise<{ code: string | null, at: number, tokens: { hash: string, at: number }[] }>} */
  async roomDoc() {
    const d = await this.storage.get(ROOM_KEY);
    return { code: typeof d?.code === 'string' ? d.code : null, at: Number(d?.at) || 0, tokens: Array.isArray(d?.tokens) ? d.tokens : [], revealAt: Number(d?.revealAt) || 0 };
  }

  /** The stage back to nothing, every file of the room gone. */
  async clear() {
    this.engine.rtc = null;
    const metas = await this.storage.list({ prefix: 'castmeta:' });
    for (const [, meta] of metas) if (meta?.id) await this.engine.deleteFile(meta);
    const convs = await this.storage.list({ prefix: CONV_PREFIX });
    for (const [, conv] of convs) if (conv?.id) await this.dropConvert(conv, true);
    this.converts = { n: 0, since: 0 };
    this.roomBytes = { n: 0, since: 0 };
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

  /** This window's wrong codes (stored). @returns {Promise<{ since: number, n: number, nets: Record<string, number> }>} */
  async failsDoc() {
    const d = await this.storage.get(FAILS_KEY);
    const t = this.now();
    if (!d || t - (Number(d.since) || 0) > JOIN_WINDOW_MS) return { since: t, n: 0, nets: {} };
    return { since: Number(d.since), n: Number(d.n) || 0, nets: d.nets && typeof d.nets === 'object' ? d.nets : {} };
  }

  /**
   * POST /v1/cast/join {code} (a presenter, no sign-in): a token, or refused.
   * @param {any} body @param {string} [ip]
   */
  async join(body, ip = 'unknown') {
    const t = this.now();
    const net = netOf(ip);
    const fails = await this.failsDoc();
    if ((fails.nets[net] || 0) >= JOIN_NET_FAILS_MAX) return fail('Too many wrong codes. Wait a few minutes, then try again.', 429, { reason: 'locked', retryAfterMs: JOIN_WINDOW_MS - (t - fails.since) });
    const code = typeof body?.code === 'string' ? body.code.replace(/\D/g, '') : '';
    const room = await this.roomDoc();
    if (!room.code) return fail('Cast is not turned on. Turn it on from the lobby computer, then use the code it shows.', 403, { reason: 'off' });
    const refused = () => fail('That code did not connect. Check the code on the TV and try again. If someone else is presenting, wait until they tap Disconnect.', 403, { reason: 'refused' });
    if (code.length !== CODE_DIGITS || code !== room.code) {
      const nets = { ...fails.nets };
      if (net in nets || Object.keys(nets).length < FAILS_NETS_MAX) nets[net] = (nets[net] || 0) + 1;
      const n = fails.n + 1;
      if (n >= JOIN_FAILS_MAX) {
        // Enough guesses at this code: a new one (the TV reads it on the doorbell).
        await this.storage.put(ROOM_KEY, { ...room, code: newCode(), at: t });
        await this.storage.put(FAILS_KEY, { since: fails.since, n: 0, nets });
        this.ring({ what: 'cast', code: true });
      } else {
        await this.storage.put(FAILS_KEY, { since: fails.since, n, nets });
      }
      return refused();
    }
    // One presenter at a time: someone live and not idle holds the room (the same answer as a wrong code).
    const busy = room.tokens.some((x) => t - x.at <= TOKEN_TTL_MS && t - (this.seen.get(x.hash) ?? x.at) <= PRESENTER_IDLE_MS);
    if (busy) return refused();
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
    // Their screen share's relay goes with them (turn.js revokes it); the TV keeps what is up.
    if (this.engine.rtc?.by === who) this.engine.onShareEnd(this.engine.rtc.id);
    const room = await this.roomDoc();
    // "Display code": the TV shows its code (hidden until asked, owner 2026-11-08).
    await this.storage.put(ROOM_KEY, { ...room, tokens: room.tokens.filter((x) => x.hash !== who), ...(body?.takeDown === true ? { revealAt: this.now() } : {}) });
    this.seen.delete(who);
    return json({ ok: true });
  }

  /** POST /v1/cast/reset (the lobby computer's tray "Show Cast code"): everything down, nobody connected, the same code. */
  async reset() {
    await this.clear();
    const room = await this.roomDoc();
    await this.storage.put(ROOM_KEY, { ...room, tokens: [], revealAt: this.now() });
    this.seen.clear();
    return json({ ok: true, code: room.code });
  }

  /**
   * POST /v1/cast/kick (the lobby computer's tray "Disconnect the presenter", owner
   * 2026-11-08: "an option that you can click on the desktop that lets you disconnect a
   * device"): whoever is connected is let go; what is on the TV stays.
   */
  async kick() {
    const room = await this.roomDoc();
    const had = room.tokens.length;
    await this.storage.put(ROOM_KEY, { ...room, tokens: [] });
    if (this.engine.rtc) this.engine.onShareEnd(this.engine.rtc.id);
    this.seen.clear();
    return json({ ok: true, disconnected: had > 0 });
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

  /**
   * GET /v1/cast/desk/state (the desk, signed in): what a presenter's state says, plus the
   * code (always: the TV's "hidden until asked" does not apply to the desk) and whether a
   * presenter is connected now.
   */
  async deskState() {
    const room = await this.roomDoc();
    const body = await (await this.engine.remoteState()).json();
    const t = this.now();
    const presenter = room.tokens.some((x) => t - x.at <= TOKEN_TTL_MS && t - (this.seen.get(x.hash) ?? x.at) <= PRESENTER_IDLE_MS);
    return json({ ...body, code: room.code, presenter });
  }

  /** POST /v1/cast/desk/reveal (the desk's "Show the code on the TV"): the TV shows its code; nobody is let go. */
  async deskReveal() {
    const room = await this.roomDoc();
    await this.storage.put(ROOM_KEY, { ...room, revealAt: this.now() });
    this.ring({ what: 'cast', rev: (await this.engine.stage()).rev });
    return json({ ok: true });
  }

  /** GET /v1/cast/screen (the Cast screen): its code and the stage. */
  async screen() {
    const room = await this.roomDoc();
    const res = await this.engine.readStage(true);
    const body = await res.json();
    return json({ ...body, code: room.code, revealAt: room.revealAt });
  }

  /* ── PowerPoint into slides ── */

  /** Ready to convert: the print tool's dispatch token and the job's machine token are set. */
  convertReady() {
    const p = this.prints();
    return Boolean(p && p.configured() && p.machineToken('cast'));
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

  /** POST /v1/cast/convert {bytes, name}: start sending a scrambled PowerPoint. @param {any} body @param {string} [who] */
  async convertStart(body, who = '') {
    if (!this.convertReady()) return fail('PowerPoint is not set up here yet. Save it as a PDF and send that instead.', 503, { reason: 'not-configured' });
    const bytes = Number(body?.bytes);
    if (!Number.isInteger(bytes) || bytes < 29) return fail('That file is empty.', 400, { reason: 'empty' });
    if (bytes > CONVERT_MAX_CT) return fail('That PowerPoint is too big (40 MB at most). Save it as a PDF, or share your screen.', 413, { reason: 'too-big' });
    const rate = this.rateOf(who);
    if (rate.converts >= CAST_CONVERTS_PER_HOUR) return fail('That is a lot of PowerPoints this hour. Save it as a PDF and send that instead.', 429, { reason: 'too-many' });
    if (bytes > this.roomBytesLeft()) return fail('That is a lot sent to the TV this hour. Wait a while, or share your screen instead.', 429, { reason: 'too-many' });
    // The slides come back as a file of the room (20 MB at most): room for it first.
    if (!(await this.makeRoom(CLASSROOM_FILE_MAX_BYTES))) return fail('The TV is holding as much as it can. Take down what is up, then try again.', 413, { reason: 'room-full' });
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
    rate.converts += 1;
    this.roomBytes.n += bytes;
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
  registry.add('POST', '/v1/cast/kick', 'session', async () => c().kick());
  registry.add('POST', '/v1/cast/join', 'public', async ({ body, ip }) => c().join(await body(), ip));
  registry.add('POST', '/v1/cast/leave', 'public', presenter(async ({ body }, who) => c().leave(who, await body())));
  registry.add('GET', '/v1/cast/youtube', 'public', presenter(async ({ url }) => c().youtube(url.searchParams.get('q'))));
  registry.add('GET', '/v1/cast/state', 'public', presenter(async () => c().engine.remoteState()));
  registry.add('POST', '/v1/cast/press', 'public', presenter(async ({ body }, who) => c().engine.press(who, await body())));
  registry.add('POST', '/v1/cast/files', 'public', presenter(async ({ body }, who) => c().fileStart(who, await body())));
  registry.add('PUT', '/v1/cast/files/:id/:n', 'public', presenter(async ({ params, request }) => c().engine.putPart(params.id, params.n, request)));
  registry.add('POST', '/v1/cast/files/:id/done', 'public', presenter(async ({ params }) => c().engine.finishFile(params.id)));
  registry.add('POST', '/v1/cast/signal', 'public', presenter(async ({ body }) => c().engine.putSignal(await body())));
  registry.add('GET', '/v1/cast/signal', 'public', presenter(async ({ url }) => c().engine.readSignal('answer', url.searchParams.get('id'))));
  // The phone's preview of the slides on the TV: the room's own file.
  registry.add('GET', '/v1/cast/files/:id', 'public', presenter(async ({ params }) => c().engine.readFile(params.id)));
  // PowerPoint into slides: the GitHub job's routes (the machine token: CAST_CONVERT_TOKEN
  // when set, else HANDBOOK_TOKEN),
  // registered first so `/:id/result` is never taken for a part number...
  const machine = (/** @type {(ctx: any) => Promise<Response>} */ fn) => async (/** @type {any} */ ctx) => {
    const p = core.prints;
    if (!p || !p.machineOk(ctx.request, 'cast')) return fail('Not signed in.', 401, { reason: 'signed-out' });
    return fn(ctx);
  };
  registry.add('GET', '/v1/cast/convert/:id/job', 'public', machine(async ({ params }) => c().convertJob(params.id)));
  registry.add('PUT', '/v1/cast/convert/:id/result', 'public', machine(async ({ params, request }) => c().convertResult(params.id, request)));
  registry.add('POST', '/v1/cast/convert/:id/failed', 'public', machine(async ({ params, body }) => c().convertFailed(params.id, await body())));
  // ...then the presenter's upload and status.
  registry.add('POST', '/v1/cast/convert', 'public', presenter(async ({ body }, who) => c().convertStart(await body(), who)));
  registry.add('PUT', '/v1/cast/convert/:id/:n', 'public', presenter(async ({ params, request }) => c().convertPart(params.id, params.n, request)));
  registry.add('POST', '/v1/cast/convert/:id/start', 'public', presenter(async ({ params, body }) => c().convertGo(params.id, await body())));
  registry.add('GET', '/v1/cast/convert/:id', 'public', presenter(async ({ params }) => c().convertStatus(params.id)));
  // The desk (the lobby computer's own sign-in, owner 2026-11-09): the presenter's routes
  // under /v1/cast/desk/, as the caller DESK. Never a token: join, leave, kick and reset
  // never touch it, and it never holds the presenter's slot. No screen-share signal
  // routes (it is the same computer as the TV).
  registry.add('GET', '/v1/cast/desk/state', 'session', async () => c().deskState());
  registry.add('POST', '/v1/cast/desk/reveal', 'session', async () => c().deskReveal());
  registry.add('GET', '/v1/cast/desk/youtube', 'session', async ({ url }) => c().youtube(url.searchParams.get('q')));
  registry.add('POST', '/v1/cast/desk/press', 'session', async ({ body }) => c().engine.press(DESK, await body()));
  registry.add('POST', '/v1/cast/desk/files', 'session', async ({ body }) => c().fileStart(DESK, await body()));
  registry.add('PUT', '/v1/cast/desk/files/:id/:n', 'session', async ({ params, request }) => c().engine.putPart(params.id, params.n, request));
  registry.add('POST', '/v1/cast/desk/files/:id/done', 'session', async ({ params }) => c().engine.finishFile(params.id));
  registry.add('GET', '/v1/cast/desk/files/:id', 'session', async ({ params }) => c().engine.readFile(params.id));
  registry.add('POST', '/v1/cast/desk/convert', 'session', async ({ body }) => c().convertStart(await body(), DESK));
  registry.add('PUT', '/v1/cast/desk/convert/:id/:n', 'session', async ({ params, request }) => c().convertPart(params.id, params.n, request));
  registry.add('POST', '/v1/cast/desk/convert/:id/start', 'session', async ({ params, body }) => c().convertGo(params.id, await body()));
  registry.add('GET', '/v1/cast/desk/convert/:id', 'session', async ({ params }) => c().convertStatus(params.id));
}
