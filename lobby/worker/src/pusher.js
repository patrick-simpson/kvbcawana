// Publish one event through Pusher's REST API (the HTTP half of what the
// print server's pusher library does). Needs the app SECRET, which is why this
// lives in the Worker and never in a page.
//
//   POST https://api-<cluster>.pusher.com/apps/<id>/events
//   ?auth_key&auth_timestamp&auth_version=1.0&body_md5&auth_signature
//   signature = hex HMAC-SHA256(secret, "POST\n<path>\n<sorted query>")

import { createHash } from 'node:crypto';
import { hmac, toHex } from './crypto.js';

/** Pusher refuses a message over 10 KB. */
export const PUSHER_MAX_BYTES = 10240;

/**
 * @param {{PUSHER_APP_ID?: string, PUSHER_KEY?: string, PUSHER_SECRET?: string, PUSHER_CLUSTER?: string}} env
 */
export function pusherConfigured(env) {
  return Boolean(env.PUSHER_APP_ID && env.PUSHER_KEY && env.PUSHER_SECRET && env.PUSHER_CLUSTER);
}

/**
 * The signed events URL for one request body.
 * @param {{PUSHER_APP_ID: string, PUSHER_KEY: string, PUSHER_SECRET: string, PUSHER_CLUSTER: string}} env
 * @param {string} body
 * @param {number} nowSec
 */
export async function signedEventsUrl(env, body, nowSec) {
  const path = `/apps/${env.PUSHER_APP_ID}/events`;
  const params = {
    auth_key: env.PUSHER_KEY,
    auth_timestamp: String(nowSec),
    auth_version: '1.0',
    body_md5: createHash('md5').update(body).digest('hex'),
  };
  const query = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&');
  const signature = toHex(await hmac(env.PUSHER_SECRET, `POST\n${path}\n${query}`));
  return `https://api-${env.PUSHER_CLUSTER}.pusher.com${path}?${query}&auth_signature=${signature}`;
}

/**
 * @param {object} env  the Worker's env (PUSHER_* secrets)
 * @param {string} channel
 * @param {string} event
 * @param {unknown} payload  JSON-serializable
 * @param {{fetchFn?: typeof fetch, nowSec?: number}} [opts]
 * @returns {Promise<{ok: boolean, status?: number, error?: string}>} never throws
 */
export async function trigger(env, channel, event, payload, opts = {}) {
  if (!pusherConfigured(env)) return { ok: false, error: 'pusher-not-configured' };
  const data = JSON.stringify(payload);
  if (data.length > PUSHER_MAX_BYTES) return { ok: false, error: 'too-large' };
  const body = JSON.stringify({ name: event, channel, data });
  const url = await signedEventsUrl(env, body, opts.nowSec ?? Math.floor(Date.now() / 1000));
  try {
    const res = await (opts.fetchFn || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    return res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status, error: `pusher-${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
