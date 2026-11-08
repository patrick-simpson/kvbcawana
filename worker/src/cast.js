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
const TOKEN_RE = /^t[a-z0-9]{24,40}$/;

/** SHA-256 of a token, hex. @param {string} token */
async function hashOf(token) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A fresh six-digit code (never starting with 0, so it reads as six digits). */
export function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 900000;
  return String(100000 + n);
}

export class Cast {
  /**
   * @param {{ storage: any, now: () => number, ring: (payload: Record<string, unknown>) => void, fetchFn?: typeof fetch }} deps
   */
  constructor({ storage, now, ring, fetchFn }) {
    this.storage = storage;
    this.now = now;
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
    const token = newId('t', 28);
    const tokens = [...room.tokens.filter((x) => t - x.at <= TOKEN_TTL_MS), { hash: await hashOf(token), at: t }].slice(-TOKENS_MAX);
    await this.storage.put(ROOM_KEY, { ...room, tokens });
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
    return hit ? hash : null;
  }

  /** GET /v1/cast/screen (the Cast screen): its code and the stage. */
  async screen() {
    const room = await this.roomDoc();
    const res = await this.engine.readStage(true);
    const body = await res.json();
    return json({ ...body, code: room.code });
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
  // A presenter (the code's token).
  registry.add('POST', '/v1/cast/join', 'public', async ({ body }) => c().join(await body()));
  registry.add('GET', '/v1/cast/state', 'public', presenter(async () => c().engine.remoteState()));
  registry.add('POST', '/v1/cast/press', 'public', presenter(async ({ body }, who) => c().engine.press(who, await body())));
  registry.add('POST', '/v1/cast/files', 'public', presenter(async ({ body }) => c().engine.startFile(await body())));
  registry.add('PUT', '/v1/cast/files/:id/:n', 'public', presenter(async ({ params, request }) => c().engine.putPart(params.id, params.n, request)));
  registry.add('POST', '/v1/cast/files/:id/done', 'public', presenter(async ({ params }) => c().engine.finishFile(params.id)));
  registry.add('POST', '/v1/cast/signal', 'public', presenter(async ({ body }) => c().engine.putSignal(await body())));
  registry.add('GET', '/v1/cast/signal', 'public', presenter(async ({ url }) => c().engine.readSignal('answer', url.searchParams.get('id'))));
}
