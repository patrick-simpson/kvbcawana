// @ts-check
// Sealed envelopes — the read side of the encrypted realtime pipe.
//
// WHY THIS EXISTS
//
// The Pusher channel is PUBLIC. Subscription is granted by possession of the
// app key, and the app key must ship in this bundle for the screen to connect
// at all, so anyone who views source can subscribe to `awana-channel` from
// anywhere in the world and read every event forever. Pusher public channels
// have no server-side authorization primitive to turn on — that is not a
// setting we failed to enable, it is absent from the product. Until now the
// mitigation was entirely upstream: only first names ever ride the wire. That
// is still true and still the primary defence, but "a stranger can read every
// child's first name and club, live, from anywhere" was never acceptable.
//
// So the events that carry a child's name — `checkin`, `recap`, `birthdays` and
// `checkout` — are sealed with AES-256-GCM under a key that only the print
// server and the church's own screens hold. `slides` (contract v5) is sealed
// too: the synced slide deck is free-typed operator copy that will eventually
// name people, and it has no business being world-readable forever. The other
// events stay in the clear ON PURPOSE: they are counts and short public copy,
// and their readability is what lets a screen tell "the pipe is down" apart
// from "I can't read the names" apart from "quiet night". A screen that goes
// blank with no explanation is worse than one that says which half is broken.
//
// WHAT THIS DOES NOT BUY
//
// Channel and event names must stay plaintext for Pusher to route, so a
// stranger with the app key still learns arrival timing and headcount to the
// millisecond — when doors opened, the shape of the arrival curve, how many
// children came, whether club happened at all. They cannot learn WHO. No
// hosted message bus can fix that, including Pusher's own end-to-end product.
// See SECURITY.md for the full list of what remains exposed.
//
// FRAMING — must stay byte-compatible with print-server/events.js
//
//   envelope  = { v: 1, kid, iv, ct }         // all base64 except v
//   aad       = utf8("1:" + eventName)        // binds a frame to its event
//   plaintext = u32be(jsonByteLength) || json || filler
//
// The length prefix, not a delimiter, so the filler can be any bytes and
// unpadding can never be ambiguous.
//
// PADDING IS NOT OPTIONAL. GCM is CTR-based and adds no padding of its own, so
// an unpadded envelope reveals len(firstName) + len(club) exactly. Club is
// inferable by correlating the plaintext `tally` event, and first names run
// 3-9 characters, so against a known church roster over a season that is a
// real re-identification channel — it would degrade the whole claim from
// "cannot read the names" to "can often guess the names". Every sealed
// `checkin` is therefore padded to the same fixed size — every frame, always,
// regardless of the name in it — and the bulk events land on a coarse ladder.
// A CI test asserts every valid `checkin` vector seals to an identical
// ciphertext length; a length-varying checkin envelope fails the build.

/** Envelope format version. Bumping it changes the AAD, so old frames fail. */
export const ENVELOPE_VERSION = 1;

/** Events that must arrive sealed: the name-bearing four plus the synced
 * slide deck and the shared settings (operator-authored free text). */
export const ENCRYPTED_EVENTS = ['checkin', 'recap', 'birthdays', 'checkout', 'slides', 'settings'];

/**
 * Fixed padded plaintext size for `checkin` — every frame is exactly this big.
 * This is the frame that matters: one child per event, so its length must
 * reveal nothing at all. 512 covers the true worst case — the builders cap
 * names at 40 CHARACTERS and a character can be 4 bytes in UTF-8, so the worst
 * case is ~380 bytes rather than the ~220 that ASCII suggests.
 */
export const CHECKIN_PAD = 512;

/**
 * Coarse size ladder for the bulk events (`recap`, `birthdays`). They cannot
 * use a fixed pad: they carry many entries, and their worst case padded to one
 * size would exceed Pusher's 10 KB per-event ceiling outright.
 *
 * The ladder hides the exact byte size, so entries with long names and entries
 * with short names are indistinguishable inside a rung. It does leak a rough
 * bucket of the entry count — which is deliberately acceptable, because the
 * PLAINTEXT `tally` event already publishes exact per-club counts by design.
 * The count of recent check-ins is public either way; WHO they are is not.
 */
export const PAD_LADDER = [2048, 4096, 8192];

/**
 * `slides` pads on its own SHORTER ladder with no round-up past the top rung:
 * an 8192-padded plaintext base64-inflates past Pusher's 10 KB per-event
 * ceiling, so a rung the transport cannot deliver must not exist for this
 * event. The publisher chunks decks so every chunk fits 4096; anything bigger
 * fails closed on the sealing side and is unopenable here by construction.
 */
export const SLIDES_PAD_LADDER = [2048, 4096];

const LEN_PREFIX = 4;

/**
 * Target padded size for an event's plaintext.
 * @param {string} event
 * @param {number} jsonByteLength
 * @returns {number|null} null when it cannot be padded without leaking.
 */
export function paddedSize(event, jsonByteLength) {
  const needed = LEN_PREFIX + jsonByteLength;
  if (event === 'checkin') {
    // A checkin that somehow exceeds the fixed size must NOT silently fall
    // back to a bigger rung — that would reintroduce the length channel for
    // exactly the frames that matter most. The sanitizer caps name and club
    // length upstream, so this is unreachable; if it ever fires, the publisher
    // fails closed rather than leaking.
    return needed <= CHECKIN_PAD ? CHECKIN_PAD : null;
  }
  // `settings` (contract v6) is one frame capped under 4096: the same ladder.
  if (event === 'slides' || event === 'settings') {
    for (const rung of SLIDES_PAD_LADDER) if (needed <= rung) return rung;
    return null;   // fail closed — see SLIDES_PAD_LADDER above
  }
  for (const rung of PAD_LADDER) if (needed <= rung) return rung;
  // Above the ladder, round up to whole rungs of the largest step.
  const step = PAD_LADDER[PAD_LADDER.length - 1];
  return Math.ceil(needed / step) * step;
}

// ── base64 <-> bytes ─────────────────────────────────────────────────────────
// Hand-rolled rather than via a library: this file must have zero dependencies
// so it can be reviewed in one sitting.

/**
 * TS models `Uint8Array` as generic over `ArrayBufferLike`, while WebCrypto's
 * signatures demand `ArrayBufferView<ArrayBuffer>`. Every array here is
 * allocated locally and so is never shared-backed; this keeps the one cast that
 * says so in a single place rather than at five call sites.
 * @param {Uint8Array} a
 * @returns {Uint8Array<ArrayBuffer>}
 */
const buf = (a) => /** @type {Uint8Array<ArrayBuffer>} */ (a);

/** @param {string} b64 @returns {Uint8Array<ArrayBuffer>|null} */
export function fromBase64(b64) {
  if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** @param {Uint8Array} bytes @returns {string} */
export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * A display key is exactly 32 bytes, base64-encoded (44 chars with padding).
 * @param {unknown} value
 */
export function isPlausibleKey(value) {
  const bytes = fromBase64(String(value == null ? '' : value).trim());
  return Boolean(bytes && bytes.length === 32);
}

// ── Key import + fingerprint ─────────────────────────────────────────────────
// Cached per key string: importKey is async and useSocket would otherwise
// re-import on every single frame.

/** @type {Map<string, Promise<{key: CryptoKey, kid: string}|null>>} */
const keyCache = new Map();

/**
 * Import a base64 key and compute its `kid` fingerprint.
 *
 * `kid` is the first 8 hex chars of SHA-256(keyBytes). It is a public
 * identifier, not a secret: 32 bits of a hash over a 256-bit key reveals
 * nothing usable, and it lets a screen say "this frame was sealed with a
 * different key" (someone rotated it) instead of the far less actionable
 * "decryption failed". GCM authentication remains the real check — a matching
 * kid never implies a valid frame.
 *
 * @param {string} base64Key
 * @returns {Promise<{key: CryptoKey, kid: string}|null>} null if unusable.
 */
export function importDisplayKey(base64Key) {
  const raw = String(base64Key == null ? '' : base64Key).trim();
  if (!raw) return Promise.resolve(null);
  const cached = keyCache.get(raw);
  if (cached) return cached;

  const promise = (async () => {
    const bytes = fromBase64(raw);
    if (!bytes || bytes.length !== 32) return null;
    const subtle = globalThis.crypto?.subtle;
    // crypto.subtle only exists in a secure context. On GitHub Pages HTTPS
    // this is always present; the guard keeps a file:// or plain-http preview
    // from throwing where it would otherwise just lose banners.
    if (!subtle) {
      console.error('[envelope] crypto.subtle unavailable — a secure context (https) is required to read names');
      return null;
    }
    try {
      const digest = new Uint8Array(await subtle.digest('SHA-256', buf(bytes)));
      let kid = '';
      for (let i = 0; i < 4; i++) kid += digest[i].toString(16).padStart(2, '0');
      const key = await subtle.importKey('raw', buf(bytes), { name: 'AES-GCM' }, false, ['decrypt']);
      return { key, kid };
    } catch (err) {
      console.error('[envelope] Could not import the display key', err);
      return null;
    }
  })();

  keyCache.set(raw, promise);
  return promise;
}

/** Test seam — drops the memoised keys. */
export function _resetKeyCache() { keyCache.clear(); }

// ── Envelope detection + opening ─────────────────────────────────────────────

/**
 * Is this payload a sealed envelope rather than a plaintext event body?
 *
 * Used for the anti-downgrade check in useSocket: once a screen holds a key, a
 * PLAINTEXT payload on an encrypted event is dropped. Without that, an
 * attacker with the public app key could simply publish unsealed frames and
 * the screen would render them — the encryption would be decorative.
 *
 * @param {unknown} payload
 */
export function isEnvelope(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const e = /** @type {Record<string, unknown>} */ (payload);
  return e.v === ENVELOPE_VERSION
    && typeof e.kid === 'string'
    && typeof e.iv === 'string'
    && typeof e.ct === 'string';
}

/**
 * Additional authenticated data — binds a ciphertext to one event name.
 * @param {string} event
 */
export function aadFor(event) {
  return new TextEncoder().encode(`${ENVELOPE_VERSION}:${event}`);
}

/**
 * Open a sealed envelope. NEVER throws and never returns partial plaintext.
 *
 * @param {{key: CryptoKey, kid: string}|null} imported From importDisplayKey.
 * @param {string} event Wire event name — must match what was sealed (AAD).
 * @param {unknown} envelope
 * @returns {Promise<{ok: true, payload: any} | {ok: false, reason: 'no-key'|'kid-mismatch'|'auth-failed'|'malformed'}>}
 */
export async function openEnvelope(imported, event, envelope) {
  if (!imported) return { ok: false, reason: 'no-key' };
  if (!isEnvelope(envelope)) return { ok: false, reason: 'malformed' };
  const e = /** @type {{kid: string, iv: string, ct: string}} */ (envelope);

  // A kid mismatch is a DIFFERENT failure from a bad key: it means the
  // publisher rotated and this screen was not re-pasted. Worth its own message
  // because the fix is different (re-paste, not regenerate).
  if (e.kid !== imported.kid) return { ok: false, reason: 'kid-mismatch' };

  const iv = fromBase64(e.iv);
  const ct = fromBase64(e.ct);
  if (!iv || iv.length !== 12 || !ct || ct.length <= 16) return { ok: false, reason: 'malformed' };

  let plain;
  try {
    plain = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: aadFor(event) },
      imported.key,
      ct,
    ));
  } catch {
    // Wrong key, tampered ciphertext, or a frame sealed for a different event
    // name. All three are indistinguishable by design and all three mean the
    // same thing: do not render this.
    return { ok: false, reason: 'auth-failed' };
  }

  // Unpad: u32be length prefix, then that many bytes of JSON, then filler.
  if (plain.length < LEN_PREFIX) return { ok: false, reason: 'malformed' };
  const len = (plain[0] << 24) | (plain[1] << 16) | (plain[2] << 8) | plain[3];
  if (len < 0 || LEN_PREFIX + len > plain.length) return { ok: false, reason: 'malformed' };
  try {
    const json = new TextDecoder().decode(plain.subarray(LEN_PREFIX, LEN_PREFIX + len));
    return { ok: true, payload: JSON.parse(json) };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

/**
 * Seal a payload. Present here only so tests can round-trip against the
 * publisher's framing without a running print server — the display never
 * publishes, and the key is imported `decrypt`-only in normal use.
 *
 * @param {Uint8Array} keyBytes 32 bytes.
 * @param {string} event
 * @param {any} payload
 * @returns {Promise<{v: number, kid: string, iv: string, ct: string}|null>}
 */
export async function sealForTest(keyBytes, event, payload) {
  const subtle = globalThis.crypto.subtle;
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const size = paddedSize(event, json.length);
  if (size == null) return null;
  const plain = new Uint8Array(size);
  plain[0] = (json.length >>> 24) & 0xff;
  plain[1] = (json.length >>> 16) & 0xff;
  plain[2] = (json.length >>> 8) & 0xff;
  plain[3] = json.length & 0xff;
  plain.set(json, LEN_PREFIX);
  // Filler stays zero — it is inside the ciphertext, so it reveals nothing,
  // and deterministic filler makes the length assertions in CI readable.
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle.importKey('raw', buf(keyBytes), { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: aadFor(event) }, key, plain,
  ));
  const digest = new Uint8Array(await subtle.digest('SHA-256', buf(keyBytes)));
  let kid = '';
  for (let i = 0; i < 4; i++) kid += digest[i].toString(16).padStart(2, '0');
  return { v: ENVELOPE_VERSION, kid, iv: toBase64(iv), ct: toBase64(ct) };
}
