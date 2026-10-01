// The Cloudflare Worker: CORS at the edge, then every request goes to ONE
// Durable Object, so all state lives in one place and every change is applied
// in order. The behaviour is SyncCore (./sync.js); this file is only wiring.

import { SyncCore, json } from './sync.js';

/** The pages that may call this service from a browser. */
const ALLOWED_ORIGINS = [
  'https://patrick-simpson.github.io',
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
    this.core = new SyncCore({ storage: state.storage, env });
  }

  /** @param {Request} request */
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/internal/cron') return json({ status: await this.core.cron() });
    return this.core.handle(request, request.headers.get('x-client-ip') || 'unknown');
  }
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
