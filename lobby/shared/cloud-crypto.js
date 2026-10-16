// @ts-check
// Online check-in's client-side cryptography (ROADMAP.md#online-check-in, P0).
//
// DEPENDENCY-FREE WebCrypto only (no imports, no DOM, no Node, no storage):
// it runs in the browser (the desk page, /settings, the screens), in Node 22
// (the print server, the KVBC Awana app) and, for the cheap pieces (the
// verifier hash and the identifier tags), in the Worker.
//
// THE RULE: everything free forever. The Worker runs on Cloudflare's free plan
// (10 ms of CPU per request), so every key derivation, every ECDH, every seal
// and every open happens in a CLIENT. The Worker only routes and stores
// ciphertext and keyed-hash identifiers. It never receives the passphrase
// once a client is on this protocol, and it never holds a private key.
//
// CANONICAL COPY. The print server and the Electron app load a GENERATED
// CommonJS copy, printer/print-server/cloud-crypto.js
// (`node scripts/gen-cloud-crypto.mjs`; scripts/check-mirrors.mjs fails CI
// when it is stale), because the packaged Windows app ships print-server/*.js
// and has no lobby/ folder. Keep this file to top-level `export function`,
// `export async function` and `export const` declarations and plain
// JavaScript: the generator is a text transform and refuses anything else.
//
// Test vectors: lobby/shared/cloud-vectors.json (every construction, fixed
// keys, salts, IVs and ephemeral keys), reproduced by
// lobby/src/lib/cloudCrypto.test.js and printer/scripts/test-cloud-crypto.cjs.
// Regenerate with `node scripts/gen-cloud-vectors.mjs` ONLY on a deliberate
// format change (bump the version that change touches).
//
// THE CONSTRUCTIONS
//
//   passphrase  K        = PBKDF2-SHA256(normalize(passphrase), salt, iter)
//                          iter in [600000, 2000000]; new wraps use 600000
//               authKey  = HKDF-SHA256(K, salt = "", info "kvbc-auth-v1"), 32 bytes
//               wrapKey  = HKDF-SHA256(K, salt = "", info "kvbc-history-wrap-v1"),
//                          AES-256-GCM, non-extractable
//               The client sends authKey; the Worker stores
//               authVerifier = SHA-256(authKey) and compares.
//
//   history key ECDH P-256. history:pub (raw, uncompressed, base64) lives in
//               the Durable Object. The private key travels only wrapped:
//               history:wrapped = {v, salt, iter, iv, ct}, ct = AES-GCM(wrapKey
//               derived with THIS wrap's own fresh 16-byte salt, canonical JWK
//               JSON, AAD "wrap1:" + kid(history:pub)). A client unwraps it
//               into a NON-extractable CryptoKey and checks it belongs to
//               history:pub before it trusts either.
//
//   a row       ECIES to history:pub: a fresh ephemeral P-256 key per row;
//               shared = ECDH x-coordinate; key = HKDF-SHA256(shared,
//               salt = epk || fp(recipientPub), info "kvbc-hist-v1");
//               AES-256-GCM, random 96-bit IV;
//               AAD = "hist1:" || rowId || night || kind || epk || kid.
//               Wire {v, kid, epk, iv, ct}. The plaintext (JSON, ts inside)
//               is padded to ROW_PAD bytes, so every row is the same size.
//
//   stations    the same ECIES to each registered station key, info
//               "kvbc-station-v1", AAD prefix "stn1:", padded on
//               STATION_PAD_LADDER. Medical notes go ONLY here.
//
//   identifiers HMAC-SHA256(stateKey, night|clubberId), or for a visitor with
//               no id HMAC-SHA256(stateKey, night|normalizedName|club):
//               what the Durable Object keys claims and jobs by.
//
// AAD framing: every field but `kind` has a fixed length (rowId 22 base64url
// characters, night 10, epk 65 raw bytes, kid 16 hex), so the plain
// concatenation the design names is unambiguous; each is validated first.
//
// FAIL CLOSED: a seal that cannot be made (bad field, too big, a medical key
// in a history row) returns null, and the caller writes NOTHING.

/** The wire version of every sealed form this module makes. */
export const CLOUD_CRYPTO_VERSION = 1;

export const PBKDF2_ITER = 600000;
export const PBKDF2_ITER_MIN = 600000;
export const PBKDF2_ITER_MAX = 2000000;
export const SALT_BYTES = 16;

export const INFO_AUTH = 'kvbc-auth-v1';
export const INFO_WRAP = 'kvbc-history-wrap-v1';
export const INFO_HIST = 'kvbc-hist-v1';
export const INFO_STATION = 'kvbc-station-v1';

export const AAD_WRAP = 'wrap1:';
export const AAD_HIST = 'hist1:';
export const AAD_STATION = 'stn1:';

/** Every history row's padded plaintext is exactly this many bytes. */
export const ROW_PAD = 1024;
/** Station bundles (rosters, books, print jobs) pad up to the next rung. */
export const STATION_PAD_LADDER = [1024, 4096, 16384, 65536, 262144, 1048576];

/** Keys a history row may never carry (anywhere in it): medical notes are station-only. */
export const MEDICAL_KEY = /allerg|medic|health|condition|notes?$/i;

export const CHURCH_TIME_ZONE = 'America/New_York';

const ID_RE = /^[A-Za-z0-9_-]{22}$/;
const NIGHT_RE = /^\d{4}-\d{2}-\d{2}$/;
const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
const KID_RE = /^[0-9a-f]{16}$/;
const LEN_PREFIX = 4;

// ── bytes ───────────────────────────────────────────────────────────────────

/** @param {string} s @returns {Uint8Array<ArrayBuffer>} */
export function utf8(s) {
  return /** @type {Uint8Array<ArrayBuffer>} */ (new TextEncoder().encode(s));
}

/** @param {...Uint8Array} parts @returns {Uint8Array<ArrayBuffer>} */
export function concatBytes(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** null for anything that is not base64. @param {unknown} b64 @returns {Uint8Array<ArrayBuffer>|null} */
export function base64ToBytes(b64) {
  if (typeof b64 !== 'string') return null;
  try {
    const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** @param {Uint8Array} bytes */
export function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @param {Uint8Array} bytes */
export function bytesToHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** @param {number} n @returns {Uint8Array<ArrayBuffer>} */
export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** @param {Uint8Array|string|null|undefined} v @returns {Uint8Array<ArrayBuffer>|null} */
function asBytes(v) {
  if (v instanceof Uint8Array) return /** @type {Uint8Array<ArrayBuffer>} */ (new Uint8Array(v));
  return base64ToBytes(v);
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── ids, nights, identifiers ────────────────────────────────────────────────

/** A random row / job id: 16 bytes, base64url, 22 characters. */
export function newRowId() {
  return bytesToBase64Url(randomBytes(16));
}

/**
 * The church's LOCAL date for an instant (America/New_York), never UTC: the
 * night key of every row, claim and job (watcher.js localTime().date agrees).
 * @param {number} ms
 */
export function churchNight(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: CHURCH_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * The sync passphrase's normalization (byte for byte syncSpecs.js'
 * normalizeSyncPassphrase; a test pins them equal).
 * @param {unknown} p
 */
export function normalizePassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
}

/** A visitor's name as the identifier tag reads it. @param {unknown} name */
export function normalizeName(name) {
  return String(name == null ? '' : name).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The imported HMAC key for a key's bytes, imported ONCE per Uint8Array (the
 * Worker's free plan gives an invocation 10 ms of CPU, and a meeting report tags
 * every award slip: an importKey per tag was most of it). Keyed by the array
 * object, so callers keep their key bytes unchanged once used (the Worker's
 * tagKey() caches one array per secret). Non-extractable, memory only.
 * @type {WeakMap<Uint8Array, Promise<CryptoKey>>}
 */
const hmacKeys = new WeakMap();

/** @param {Uint8Array} key @param {string} message */
async function hmacB64Url(key, message) {
  let k = hmacKeys.get(key);
  if (!k) {
    k = crypto.subtle.importKey('raw', /** @type {Uint8Array<ArrayBuffer>} */ (key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(key, k);
    k.catch(() => hmacKeys.delete(key));
  }
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', await k, utf8(message))));
}

/**
 * The Durable Object's key for a child on a night: HMAC(stateKey,
 * night|clubberId), base64url. null for a bad night or id.
 * @param {Uint8Array} stateKey @param {string} night @param {string|number} clubberId
 */
export async function identityTag(stateKey, night, clubberId) {
  const id = String(clubberId);
  if (!NIGHT_RE.test(night) || !/^\d{1,12}$/.test(id) || !(stateKey instanceof Uint8Array) || stateKey.length < 16) return null;
  return hmacB64Url(stateKey, `${night}|${id}`);
}

/**
 * A visitor with no clubber id: HMAC(stateKey, night|normalizedName|club).
 * @param {Uint8Array} stateKey @param {string} night @param {string} name @param {string} club
 */
export async function visitorTag(stateKey, night, name, club) {
  const n = normalizeName(name);
  const c = normalizeName(club);
  if (!NIGHT_RE.test(night) || !n || !(stateKey instanceof Uint8Array) || stateKey.length < 16) return null;
  return hmacB64Url(stateKey, `${night}|${n}|${c}`);
}

// ── padding ─────────────────────────────────────────────────────────────────

/** ROW_PAD when `jsonLength` bytes fit with the length prefix, else null. @param {number} jsonLength */
export function rowPadSize(jsonLength) {
  return jsonLength + LEN_PREFIX <= ROW_PAD ? ROW_PAD : null;
}

/** The smallest STATION_PAD_LADDER rung that holds it, else null. @param {number} jsonLength */
export function stationPadSize(jsonLength) {
  for (const rung of STATION_PAD_LADDER) if (jsonLength + LEN_PREFIX <= rung) return rung;
  return null;
}

/** u32be(length) || bytes || zero filler, `size` bytes in all. @param {Uint8Array} bytes @param {number} size */
export function pad(bytes, size) {
  if (bytes.length + LEN_PREFIX > size) throw new RangeError('too long to pad');
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, LEN_PREFIX);
  return out;
}

/** The inverse of pad; null when the prefix does not fit. @param {Uint8Array} padded */
export function unpad(padded) {
  if (padded.length < LEN_PREFIX) return null;
  const n = new DataView(padded.buffer, padded.byteOffset, padded.byteLength).getUint32(0);
  if (n > padded.length - LEN_PREFIX) return null;
  return padded.slice(LEN_PREFIX, LEN_PREFIX + n);
}

// ── keys, fingerprints ──────────────────────────────────────────────────────

/** SHA-256 of a raw public key (65 bytes). @param {Uint8Array|string} pub */
export async function fingerprint(pub) {
  const raw = asBytes(pub);
  if (!raw || raw.length !== 65 || raw[0] !== 4) throw new TypeError('not a raw P-256 public key');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', raw));
}

/** The first 8 bytes of the fingerprint, hex (16 characters). @param {Uint8Array|string} pub */
export async function kidOf(pub) {
  return bytesToHex((await fingerprint(pub)).slice(0, 8));
}

/** @param {JsonWebKey} jwk @returns {Uint8Array<ArrayBuffer>} raw uncompressed public point */
export function rawFromJwk(jwk) {
  const x = base64ToBytes(jwk.x);
  const y = base64ToBytes(jwk.y);
  if (!x || !y || x.length !== 32 || y.length !== 32) throw new TypeError('not a P-256 JWK');
  return concatBytes(new Uint8Array([4]), x, y);
}

/** @param {Uint8Array} raw */
async function importPublic(raw) {
  return crypto.subtle.importKey('raw', /** @type {Uint8Array<ArrayBuffer>} */ (raw), { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

/** A P-256 private JWK reduced to its five fields in a fixed order (what is wrapped). @param {JsonWebKey} jwk */
export function canonicalJwk(jwk) {
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') throw new TypeError('not a P-256 private JWK');
  rawFromJwk(jwk);
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
}

/**
 * Import a private JWK as a NON-extractable ECDH key.
 * @param {JsonWebKey} jwk
 */
export async function importPrivateKey(jwk) {
  return crypto.subtle.importKey('jwk', canonicalJwk(jwk), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

/**
 * A fresh ECDH P-256 key pair whose private half can be exported ONCE, to be
 * wrapped (the history key) or put in Electron safeStorage (a station key).
 * @returns {Promise<{ publicKey: string, kid: string, privateJwk: JsonWebKey }>}
 */
export async function generateKeyPair() {
  const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateJwk = canonicalJwk(await crypto.subtle.exportKey('jwk', pair.privateKey));
  return { publicKey: bytesToBase64(raw), kid: await kidOf(raw), privateJwk };
}

/**
 * Does this private key belong to this public key? A probe ECDH both ways
 * with a throwaway key (WebCrypto cannot derive a public key from a
 * non-extractable private one).
 * @param {CryptoKey} privateKey @param {Uint8Array|string} pub
 */
export async function keyMatches(privateKey, pub) {
  try {
    const raw = asBytes(pub);
    if (!raw) return false;
    const probe = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']));
    const a = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: probe.publicKey }, privateKey, 256));
    const b = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(raw) }, probe.privateKey, 256));
    return sameBytes(a, b);
  } catch {
    return false;
  }
}

/**
 * A key ring: what openRow / openAsStation need. The private key stays
 * non-extractable; the public half names it.
 * @param {CryptoKey} privateKey @param {Uint8Array|string} pub
 * @returns {Promise<{ privateKey: CryptoKey, publicKey: string, kid: string }>}
 */
export async function keyRing(privateKey, pub) {
  const raw = asBytes(pub);
  if (!raw) throw new TypeError('not a public key');
  return { privateKey, publicKey: bytesToBase64(raw), kid: await kidOf(raw) };
}

// ── the passphrase ──────────────────────────────────────────────────────────

/** @param {unknown} iter */
function validIter(iter) {
  return Number.isInteger(iter) && /** @type {number} */ (iter) >= PBKDF2_ITER_MIN && /** @type {number} */ (iter) <= PBKDF2_ITER_MAX;
}

/**
 * K = PBKDF2-SHA256(normalized passphrase, salt, iter), split by HKDF into
 * authKey (32 bytes, what a client sends to sign in) and wrapKey (AES-256-GCM,
 * non-extractable, what wraps the history private key). Throws RangeError on an
 * iteration count outside [PBKDF2_ITER_MIN, PBKDF2_ITER_MAX] (a Worker cannot
 * talk a client down to a cheap derivation) or a salt shorter than 16 bytes.
 * @param {string} passphrase @param {Uint8Array|string} salt @param {number} iter
 * @returns {Promise<{ authKey: Uint8Array, wrapKey: CryptoKey }>}
 */
export async function deriveKeys(passphrase, salt, iter) {
  const saltBytes = asBytes(salt);
  if (!saltBytes || saltBytes.length < SALT_BYTES) throw new RangeError('salt must be at least 16 bytes');
  if (!validIter(iter)) throw new RangeError(`iterations must be ${PBKDF2_ITER_MIN} to ${PBKDF2_ITER_MAX}`);
  const normalized = normalizePassphrase(passphrase);
  if (!normalized) throw new RangeError('empty passphrase');
  const base = await crypto.subtle.importKey('raw', utf8(normalized), 'PBKDF2', false, ['deriveBits']);
  const k = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: iter }, base, 256);
  const hk = await crypto.subtle.importKey('raw', k, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const none = new Uint8Array(0);
  const authKey = new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: none, info: utf8(INFO_AUTH) }, hk, 256));
  const wrapKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: none, info: utf8(INFO_WRAP) }, hk,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
  return { authKey, wrapKey };
}

/**
 * The sign-in key a client sends (standard base64, 32 bytes) for a passphrase,
 * the salt and count from GET /v1/auth/params. About 0.3 s on a PC, 1 s on a
 * phone and several on a Pi Zero (600000 rounds): derive once, keep it in memory.
 * @param {string} passphrase @param {Uint8Array|string} salt @param {number} iter
 * @returns {Promise<string>}
 */
export async function deriveAuthKey(passphrase, salt, iter) {
  return bytesToBase64((await deriveKeys(passphrase, salt, iter)).authKey);
}

/** What the Worker stores and compares: SHA-256(authKey), base64. @param {Uint8Array|string} authKey */
export async function authVerifier(authKey) {
  const bytes = asBytes(authKey);
  if (!bytes || bytes.length !== 32) throw new TypeError('authKey must be 32 bytes');
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

// ── wrapping the history private key ────────────────────────────────────────

/**
 * Wrap a private key (its JWK) under the passphrase, with a FRESH 16-byte
 * PBKDF2 salt and IV (opts.salt / opts.iv only for test vectors).
 * @param {JsonWebKey} privateJwk @param {string} passphrase
 * @param {{ iter?: number, salt?: Uint8Array, iv?: Uint8Array }} [opts]
 * @returns {Promise<{ v: number, salt: string, iter: number, iv: string, ct: string }>}
 */
export async function wrapPrivateKey(privateJwk, passphrase, opts = {}) {
  const jwk = canonicalJwk(privateJwk);
  const kid = await kidOf(rawFromJwk(jwk));
  const iter = opts.iter ?? PBKDF2_ITER;
  const salt = opts.salt ? asBytes(opts.salt) : randomBytes(SALT_BYTES);
  const iv = opts.iv ? asBytes(opts.iv) : randomBytes(12);
  if (!salt || salt.length !== SALT_BYTES || !iv || iv.length !== 12) throw new RangeError('bad salt or iv');
  const { wrapKey } = await deriveKeys(passphrase, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(AAD_WRAP + kid) }, wrapKey, utf8(JSON.stringify(jwk))));
  return { v: CLOUD_CRYPTO_VERSION, salt: bytesToBase64(salt), iter, iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
}

/**
 * The wrapped JWK, opened and checked against `pub`. Internal: callers get a
 * CryptoKey (unwrapPrivateKey) or a new wrap (rewrapPrivateKey), never this.
 * @param {any} wrapped @param {string} passphrase @param {Uint8Array|string} pub
 */
async function openWrapped(wrapped, passphrase, pub) {
  if (!wrapped || wrapped.v !== CLOUD_CRYPTO_VERSION || !validIter(wrapped.iter)) return null;
  const raw = asBytes(pub);
  const salt = asBytes(wrapped.salt);
  const iv = asBytes(wrapped.iv);
  const ct = asBytes(wrapped.ct);
  if (!raw || raw.length !== 65 || !salt || !iv || iv.length !== 12 || !ct) return null;
  try {
    const { wrapKey } = await deriveKeys(passphrase, salt, wrapped.iter);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: utf8(AAD_WRAP + await kidOf(raw)) }, wrapKey, ct);
    const jwk = canonicalJwk(JSON.parse(new TextDecoder().decode(pt)));
    if (!sameBytes(rawFromJwk(jwk), raw)) return null;
    const privateKey = await importPrivateKey(jwk);
    if (!(await keyMatches(privateKey, raw))) return null;
    return { jwk, privateKey };
  } catch {
    return null;
  }
}

/**
 * history:wrapped → a NON-extractable private key, verified to belong to
 * history:pub (its JWK's point equals it, and a probe ECDH agrees). null for a
 * wrong passphrase, a damaged wrap or a key that is not history:pub's.
 * @param {any} wrapped @param {string} passphrase @param {Uint8Array|string} pub
 * @returns {Promise<CryptoKey|null>}
 */
export async function unwrapPrivateKey(wrapped, passphrase, pub) {
  const opened = await openWrapped(wrapped, passphrase, pub);
  return opened ? opened.privateKey : null;
}

/**
 * A passphrase change: open the wrap with the old passphrase, wrap again
 * under the new one (fresh salt and IV), and open THAT to prove it before
 * anything is sent. null when any step fails (send nothing).
 * @param {any} wrapped @param {string} oldPassphrase @param {string} newPassphrase @param {Uint8Array|string} pub
 * @param {{ iter?: number, salt?: Uint8Array, iv?: Uint8Array }} [opts]
 */
export async function rewrapPrivateKey(wrapped, oldPassphrase, newPassphrase, pub, opts = {}) {
  const opened = await openWrapped(wrapped, oldPassphrase, pub);
  if (!opened) return null;
  const next = await wrapPrivateKey(opened.jwk, newPassphrase, opts);
  return (await unwrapPrivateKey(next, newPassphrase, pub)) ? next : null;
}

/**
 * A new history key: generate, wrap, prove the wrap opens, and forget the
 * private half. The client submits {pub, wrapped} (first writer wins).
 * @param {string} passphrase @param {{ iter?: number }} [opts]
 * @returns {Promise<{ pub: string, kid: string, wrapped: { v: number, salt: string, iter: number, iv: string, ct: string } }>}
 */
export async function createHistoryKey(passphrase, opts = {}) {
  const pair = await generateKeyPair();
  const wrapped = await wrapPrivateKey(pair.privateJwk, passphrase, { iter: opts.iter });
  if (!(await unwrapPrivateKey(wrapped, passphrase, pair.publicKey))) throw new Error('the new history key did not unwrap');
  return { pub: pair.publicKey, kid: pair.kid, wrapped };
}

// ── ECIES (rows and stations) ───────────────────────────────────────────────

/**
 * The AAD: prefix || id || night || kind || epk || kid. null on a bad field.
 * @param {string} prefix @param {string} id @param {string} night @param {string} kind @param {Uint8Array} epk @param {string} kid
 */
export function eciesAad(prefix, id, night, kind, epk, kid) {
  if (!ID_RE.test(id) || !NIGHT_RE.test(night) || !KIND_RE.test(kind) || !KID_RE.test(kid)) return null;
  if (!(epk instanceof Uint8Array) || epk.length !== 65 || epk[0] !== 4) return null;
  return concatBytes(utf8(prefix), utf8(id), utf8(night), utf8(kind), epk, utf8(kid));
}

/** @param {string} id @param {string} night @param {string} kind @param {Uint8Array} epk @param {string} kid */
export function rowAad(id, night, kind, epk, kid) {
  return eciesAad(AAD_HIST, id, night, kind, epk, kid);
}

/** @param {string} id @param {string} night @param {string} kind @param {Uint8Array} epk @param {string} kid */
export function stationAad(id, night, kind, epk, kid) {
  return eciesAad(AAD_STATION, id, night, kind, epk, kid);
}

/** @param {ArrayBuffer} shared @param {Uint8Array} epk @param {Uint8Array} fp @param {string} info @param {KeyUsage} use */
async function eciesKey(shared, epk, fp, info, use) {
  const hk = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: concatBytes(epk, fp), info: utf8(info) }, hk,
    { name: 'AES-GCM', length: 256 }, false, [use],
  );
}

/**
 * One ECIES seal. opts.ephemeralJwk / opts.iv only for test vectors.
 * @param {{ prefix: string, info: string, padTo: (n: number) => number|null, sizes: number[] }} suite
 * @param {Uint8Array|string} recipientPub @param {string} id @param {string} night @param {string} kind
 * @param {unknown} record @param {{ ephemeralJwk?: JsonWebKey, iv?: Uint8Array }} opts
 */
async function eciesSeal(suite, recipientPub, id, night, kind, record, opts) {
  try {
    const raw = asBytes(recipientPub);
    if (!raw || raw.length !== 65) return null;
    const json = utf8(JSON.stringify(record));
    const size = suite.padTo(json.length);
    if (size == null) return null;
    const kid = await kidOf(raw);
    const fp = await fingerprint(raw);
    /** @type {CryptoKey} */ let eph;
    /** @type {Uint8Array} */ let epk;
    if (opts.ephemeralJwk) {
      eph = await importPrivateKey(opts.ephemeralJwk);
      epk = rawFromJwk(opts.ephemeralJwk);
    } else {
      const pair = /** @type {CryptoKeyPair} */ (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']));
      eph = pair.privateKey;
      epk = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    }
    const aad = eciesAad(suite.prefix, id, night, kind, epk, kid);
    const iv = opts.iv ? asBytes(opts.iv) : randomBytes(12);
    if (!aad || !iv || iv.length !== 12) return null;
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(raw) }, eph, 256);
    const key = await eciesKey(shared, epk, fp, suite.info, 'encrypt');
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, pad(json, size)));
    return { v: CLOUD_CRYPTO_VERSION, kid, epk: bytesToBase64(epk), iv: bytesToBase64(iv), ct: bytesToBase64(ct) };
  } catch {
    return null;
  }
}

/**
 * One ECIES open; null for anything that does not open (wrong key, a field
 * changed, damaged).
 * @param {{ prefix: string, info: string, padTo: (n: number) => number|null, sizes: number[] }} suite
 * @param {{ privateKey: CryptoKey, publicKey: string, kid: string }} ring
 * @param {string} id @param {string} night @param {string} kind @param {any} wire
 */
async function eciesOpen(suite, ring, id, night, kind, wire) {
  try {
    if (!wire || wire.v !== CLOUD_CRYPTO_VERSION || wire.kid !== ring.kid) return null;
    const epk = asBytes(wire.epk);
    const iv = asBytes(wire.iv);
    const ct = asBytes(wire.ct);
    if (!epk || !iv || iv.length !== 12 || !ct) return null;
    const aad = eciesAad(suite.prefix, id, night, kind, epk, ring.kid);
    if (!aad) return null;
    const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(epk) }, ring.privateKey, 256);
    const key = await eciesKey(shared, epk, await fingerprint(ring.publicKey), suite.info, 'decrypt');
    const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, ct));
    if (!suite.sizes.includes(padded.length)) return null;
    const json = unpad(padded);
    return json ? JSON.parse(new TextDecoder().decode(json)) : null;
  } catch {
    return null;
  }
}

const ROW_SUITE = { prefix: AAD_HIST, info: INFO_HIST, padTo: rowPadSize, sizes: [ROW_PAD] };
const STATION_SUITE = { prefix: AAD_STATION, info: INFO_STATION, padTo: stationPadSize, sizes: STATION_PAD_LADDER };

/** Does this value carry a medical key anywhere? @param {unknown} value @returns {boolean} */
export function hasMedicalKey(value) {
  if (Array.isArray(value)) return value.some(hasMedicalKey);
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => MEDICAL_KEY.test(k) || hasMedicalKey(v));
  }
  return false;
}

/**
 * Seal one history row to history:pub. `record` is the row's JSON (its `ts`
 * inside); padded to ROW_PAD. null (write NOTHING) when it cannot be sealed:
 * a bad id / night / kind, too big, or a medical key anywhere in it.
 * @param {Uint8Array|string} historyPub
 * @param {{ id: string, night: string, kind: string, record: unknown }} row
 * @param {{ ephemeralJwk?: JsonWebKey, iv?: Uint8Array }} [opts]
 * @returns {Promise<{ v: number, kid: string, epk: string, iv: string, ct: string }|null>}
 */
export async function sealRow(historyPub, row, opts = {}) {
  if (!row || hasMedicalKey(row.record)) return null;
  return eciesSeal(ROW_SUITE, historyPub, row.id, row.night, row.kind, row.record, opts);
}

/**
 * Open a stored row ({id, night, kind, v, kid, epk, iv, ct}, a D1 history_rows
 * line) with the unwrapped history key ring. null when it will not open.
 * @param {{ privateKey: CryptoKey, publicKey: string, kid: string }} ring @param {any} row
 */
export async function openRow(ring, row) {
  if (!row) return null;
  return eciesOpen(ROW_SUITE, ring, row.id, row.night, row.kind, row);
}

/**
 * Seal one roster / completed-books / print-job record to EVERY registered
 * station (one ECIES each, on the station pad ladder). null when it cannot be
 * sealed to every one of them, or there are none: never a partial bundle.
 * @param {{ publicKey: string }[]} stations
 * @param {{ id: string, night: string, kind: string, record: unknown }} item
 * @param {{ ephemeralJwks?: JsonWebKey[], ivs?: Uint8Array[] }} [opts]
 * @returns {Promise<{ v: number, id: string, night: string, kind: string, to: { v: number, kid: string, epk: string, iv: string, ct: string }[] }|null>}
 */
export async function sealForStations(stations, item, opts = {}) {
  if (!Array.isArray(stations) || !stations.length || !item) return null;
  const to = [];
  for (let i = 0; i < stations.length; i++) {
    const one = await eciesSeal(STATION_SUITE, stations[i] && stations[i].publicKey, item.id, item.night, item.kind, item.record, {
      ephemeralJwk: opts.ephemeralJwks && opts.ephemeralJwks[i], iv: opts.ivs && opts.ivs[i],
    });
    if (!one) return null;
    to.push(one);
  }
  return { v: CLOUD_CRYPTO_VERSION, id: item.id, night: item.night, kind: item.kind, to };
}

/**
 * Open a station bundle with this station's key ring. null when it is not
 * sealed to this station or will not open.
 * @param {{ privateKey: CryptoKey, publicKey: string, kid: string }} ring @param {any} bundle
 */
export async function openAsStation(ring, bundle) {
  if (!bundle || bundle.v !== CLOUD_CRYPTO_VERSION || !Array.isArray(bundle.to)) return null;
  const mine = bundle.to.find((/** @type {any} */ w) => w && w.kid === ring.kid);
  return mine ? eciesOpen(STATION_SUITE, ring, bundle.id, bundle.night, bundle.kind, mine) : null;
}
