// Small WebCrypto helpers for the Worker: the sealed envelope (byte-compatible
// with print-server/events.js and src/lib/envelope.js, whose framing this
// imports rather than repeats), HMAC, hashing and base64url.

import { ENVELOPE_VERSION, aadFor, fromBase64, paddedSize, toBase64 } from '../../src/lib/envelope.js';

const enc = new TextEncoder();
const LEN_PREFIX = 4;

/** @param {Uint8Array} bytes */
export function toBase64Url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {number} n */
export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** A fresh 32-byte display key, base64 (what every screen stores). */
export function newDisplayKey() {
  return toBase64(randomBytes(32));
}

/** @param {Uint8Array} keyBytes */
export async function kidFor(keyBytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', keyBytes));
  let kid = '';
  for (let i = 0; i < 4; i++) kid += digest[i].toString(16).padStart(2, '0');
  return kid;
}

/**
 * HMAC-SHA256.
 * @param {Uint8Array|string} key
 * @param {string} message
 * @returns {Promise<Uint8Array>}
 */
export async function hmac(key, message) {
  const raw = typeof key === 'string' ? enc.encode(key) : key;
  const k = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

/** @param {Uint8Array} bytes */
export function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Length-independent-time comparison of two strings.
 * @param {string} a
 * @param {string} b
 */
export function safeEqual(a, b) {
  const x = enc.encode(String(a));
  const y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/**
 * Seal one payload under the display key, exactly as the print server does:
 * a u32be length prefix, the JSON, zero filler up to the event's pad rung,
 * AES-256-GCM with a fresh IV and the event-bound AAD. null when the payload
 * cannot be padded (fail closed: never publish it in the clear).
 * @param {string} keyB64
 * @param {string} event
 * @param {unknown} payload
 */
export async function seal(keyB64, event, payload) {
  const keyBytes = fromBase64(keyB64);
  if (!keyBytes || keyBytes.length !== 32) return null;
  const json = enc.encode(JSON.stringify(payload));
  const size = paddedSize(event, json.length);
  if (size == null) return null;
  const plain = new Uint8Array(size);
  new DataView(plain.buffer).setUint32(0, json.length);
  plain.set(json, LEN_PREFIX);
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: aadFor(event) }, key, plain));
  return { v: ENVELOPE_VERSION, kid: await kidFor(keyBytes), iv: toBase64(iv), ct: toBase64(ct) };
}

export { fromBase64, toBase64 };
