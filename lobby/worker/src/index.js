/* global WebSocketPair, WebSocketRequestResponsePair -- Cloudflare Workers runtime globals */
// The Cloudflare Worker: CORS at the edge, then every request goes to ONE
// Durable Object, so all state lives in one place and every change is applied
// in order. The behaviour is SyncCore (./sync.js); this file is only wiring.

import { SyncCore, json } from './sync.js';

/** The pages that may call this service from a browser. */
const ALLOWED_ORIGINS = [
  'https://patrick-simpson.github.io',
  // The one site (same origin through its /api, but a page served from a
  // preview deploy or the bare Worker address still calls in cross-origin).
  'https://awana.kvbchurch.org',
  'https://kvbcawana.pages.dev',
];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** @param {string|null} origin */
export function allowedOrigin(origin) {
  if (!origin) return null;
  return ALLOWED_ORIGINS.includes(origin) || LOCAL_ORIGIN.test(origin) ? origin : null;
}

/** @param {Response} res @param {string|null} origin */
function withCors(res, origin) {
  const out = new Response(res.body, res);
  if (origin) {
    out.headers.set('Access-Control-Allow-Origin', origin);
    out.headers.set('Vary', 'Origin');
  }
  return out;
}

export class SyncStore {
  /** @param {DurableObjectState} state @param {Record<string, any>} env */
  constructor(state, env) {
    this.state = state;
    this.core = new SyncCore({
      storage: state.storage,
      env,
      broadcast: (text) => {
        let sent = 0;
        for (const ws of state.getWebSockets()) {
          try { ws.send(text); sent += 1; } catch { /* a dying socket; its close handler tidies up */ }
        }
        return sent;
      },
      closeAll: (code, reason) => {
        for (const ws of state.getWebSockets()) {
          try { ws.close(code, reason); } catch { /* already gone */ }
        }
      },
    });
    // A screen's keep-alive "ping" is answered without waking this object, so
    // a room of idle TVs costs nothing between frames.
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/internal/cron') return json({ status: await this.core.cron() });
    if (url.pathname === '/v1/live') return this.live(request, url);
    return this.core.handle(request, request.headers.get('x-client-ip') || 'unknown');
  }

  /**
   * The live channel. A browser cannot put a header on a socket upgrade, so
   * the session rides the query string (?session=). Wrong or old session:
   * a plain 401 before any socket exists, so the screen knows to ask for the
   * passphrase again.
   * @param {Request} request @param {URL} url
   */
  async live(request, url) {
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Expected a WebSocket.' }, 426);
    const token = url.searchParams.get('session') || '';
    if (!(await this.core.sessionValid(token))) {
      return json({ error: 'This screen is signed out. Type the passphrase again.', reason: 'signed-out' }, 401);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    // Catch it up: the last tally, recap, birthdays and the rest, and the
    // newest deck's chunks, as the printer's rebroadcasts would within minutes.
    for (const text of await this.core.replayFrames()) {
      try { server.send(text); } catch { break; }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Screens only listen; anything they send but "ping" is ignored. */
  webSocketMessage() {}

  /** @param {WebSocket} ws @param {number} code */
  webSocketClose(ws, code) {
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch { /* already closed */ }
  }

  webSocketError() {}
}

/** @param {Record<string, any>} env */
function store(env) {
  return env.SYNC.get(env.SYNC.idFromName('main'));
}

export default {
  /** @param {Request} request @param {Record<string, any>} env */
  async fetch(request, env) {
    const origin = allowedOrigin(request.headers.get('Origin'));
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: origin ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        } : {},
      });
    }
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/v1/')) return withCors(json({ error: 'Not found.' }, 404), origin);
    // A socket upgrade goes straight through: its 101 cannot be re-wrapped,
    // and it carries no CORS (the session in its query string is the lock).
    if (url.pathname === '/v1/live') return store(env).fetch(request);
    const headers = new Headers(request.headers);
    headers.set('x-client-ip', request.headers.get('CF-Connecting-IP') || 'unknown');
    const forwarded = new Request(request.url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer(),
    });
    return withCors(await store(env).fetch(forwarded), origin);
  },

  /** @param {unknown} _event @param {Record<string, any>} env */
  async scheduled(_event, env) {
    await store(env).fetch('https://sync.internal/internal/cron');
  },
};
