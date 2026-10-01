// @ts-check
// Display login — one church passphrase provisions this screen.
//
// The print server derives a wrapping key from the passphrase (PBKDF2-SHA256)
// and publishes the display key + the slides publish token sealed under it as
// a `provision` frame on a Pusher CACHE channel, so a screen that has just been
// switched on receives the latest frame immediately. This module owns the
// screen's half: deriving the same key from what the volunteer types, opening
// the frame with the ONE openEnvelope() this app already trusts, and writing
// the two secrets into their own storage slots (src/lib/displayKey.js,
// src/lib/publishToken.js) — never into `awanaConfig.v1`.
//
// The bundle also carries a NON-secret `configUrl` (#394): where this screen
// fetches its display-settings JSON from, so one passphrase sets a replacement
// screen up completely instead of leaving weather/calendar/widgets to be typed
// in by hand. It lands in its own slot too (src/lib/fleetConfigUrl.js) and is
// applied through the exact remote-config path `?config=` already uses — it
// must never enter `VALIDATORS`, because that table backs both the Settings
// export and `?config=`, so a remote config could otherwise repoint the screen
// at another remote config with no operator in the loop.
//
// THE DERIVED LOGIN KEY IS STORED APART FROM EVERY OTHER SETTING, for exactly
// the three documented reasons displayKey.js enumerates: `?config=<url>`,
// Settings → Export and the URL flags all operate on the config object, and a
// credential must ride none of them. displayLogin.test.js pins all three shut.
// Keeping the derived key (not the passphrase) means a later frame — a rotated
// display key or token — is opened and applied automatically, so screens follow
// rotations without anyone re-typing anything; rotating the PASSPHRASE changes
// the frame's kid, which this module surfaces as "log in again".
//
// `provision` is NOT one of the sanitized display-contract events: nothing in a
// frame is ever rendered, and it never reaches dispatchEvent. See CONTRACT.md.

import { fromBase64, importDisplayKey, isEnvelope, isPlausibleKey, openEnvelope, toBase64 } from './envelope.js';
import { saveDisplayKey } from './displayKey.js';
import { savePublishToken } from './publishToken.js';
import { isValidFleetConfigUrl, saveFleetConfigUrl } from './fleetConfigUrl.js';

/** localStorage keys — exported so tests can assert neither is `awanaConfig.v1`. */
export const LOGIN_KEY_STORAGE = 'awanaLoginKey.v1';
export const LOGIN_ISSUED_STORAGE = 'awanaLoginIssuedAt.v1';
/** Name of the event fired when the login key changes in THIS tab. */
export const LOGIN_KEY_CHANGE_EVENT = 'awana-login-key-change';

/** The cache channel + event the print server publishes on (CONTRACT.md). */
export const PROVISION_CHANNEL = 'cache-awana-channel-provision';
export const PROVISION_EVENT = 'provision';

const KDF_NAME = 'PBKDF2-SHA256';
const ITERATIONS_MIN = 100000;
const ITERATIONS_MAX = 2000000;
const SALT_MIN = 16;
const SALT_MAX = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

/** @returns {string} the stored login key (base64), or '' */
export function loadLoginKey() {
  try {
    return String(localStorage.getItem(LOGIN_KEY_STORAGE) || '').trim();
  } catch {
    return '';
  }
}

/**
 * @param {string} value base64 32-byte derived key; '' clears it
 * @returns {boolean} false when storage is unavailable
 */
export function saveLoginKey(value) {
  const next = String(value == null ? '' : value).trim();
  try {
    if (next) localStorage.setItem(LOGIN_KEY_STORAGE, next);
    else localStorage.removeItem(LOGIN_KEY_STORAGE);
    window.dispatchEvent(new Event(LOGIN_KEY_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** @returns {number|null} epoch ms of the last applied bundle, or null */
function loadIssuedAt() {
  try {
    const n = Number(localStorage.getItem(LOGIN_ISSUED_STORAGE));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** @param {number|null} ms */
function saveIssuedAt(ms) {
  try {
    if (ms) localStorage.setItem(LOGIN_ISSUED_STORAGE, String(ms));
    else localStorage.removeItem(LOGIN_ISSUED_STORAGE);
  } catch {
    /* storage blocked — the replay guard degrades to "accept", which is what a
       screen with no memory of a previous bundle would do anyway */
  }
}

/**
 * Both sides apply exactly this before UTF-8 encoding — pinned in the fixture.
 * @param {unknown} p
 */
export function normalizePassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC');
}

/**
 * Strict shape check for a wire frame. Anything else is ignored silently: this
 * channel is public, so junk on it is expected, never an error a screen shows.
 * @param {unknown} x
 * @returns {x is {v: 1, kdf: {name: string, iterations: number, salt: string}, envelope: object}}
 */
export function isProvisionFrame(x) {
  if (!x || typeof x !== 'object') return false;
  const f = /** @type {any} */ (x);
  if (f.v !== 1 || !f.kdf || typeof f.kdf !== 'object') return false;
  if (f.kdf.name !== KDF_NAME) return false;
  const it = f.kdf.iterations;
  if (!Number.isInteger(it) || it < ITERATIONS_MIN || it > ITERATIONS_MAX) return false;
  if (typeof f.kdf.salt !== 'string') return false;
  const salt = fromBase64(f.kdf.salt);
  if (!salt || salt.length < SALT_MIN || salt.length > SALT_MAX) return false;
  return isEnvelope(f.envelope);
}

/**
 * Strict shape check for the opened bundle. A bundle that fails this is
 * rejected whole — nothing is written — because a half-applied bundle (key but
 * junk token, or vice versa) is worse than none.
 * @param {unknown} x
 * `configUrl` is OPTIONAL for deploy-order safety: a publisher that predates
 * it simply omits the field, and that means "no news", not "clear it". Present,
 * it must be a string — '' (the operator cleared it) or a URL that passes the
 * same https/length rule the publisher applied before sealing.
 * @returns {x is {v: 1, displayKey: string, slidesPublishToken: string, issuedAt: string, configUrl?: string}}
 */
export function isProvisionBundle(x) {
  if (!x || typeof x !== 'object') return false;
  const b = /** @type {any} */ (x);
  if (b.v !== 1) return false;
  if (typeof b.displayKey !== 'string' || !isPlausibleKey(b.displayKey)) return false;
  if (typeof b.slidesPublishToken !== 'string') return false;
  if (b.slidesPublishToken !== '' && !TOKEN_RE.test(b.slidesPublishToken)) return false;
  if (typeof b.issuedAt !== 'string' || !Number.isFinite(Date.parse(b.issuedAt))) return false;
  if (b.configUrl !== undefined) {
    if (typeof b.configUrl !== 'string') return false;
    if (b.configUrl !== '' && !isValidFleetConfigUrl(b.configUrl)) return false;
  }
  return true;
}

/**
 * PBKDF2-SHA256 → 32 bytes, base64. Resolves null when WebCrypto is missing
 * (an insecure-context embed) or the salt is unusable.
 * @param {string} passphrase
 * @param {string} saltB64
 * @param {number} iterations
 * @returns {Promise<string|null>}
 */
export async function deriveLoginKey(passphrase, saltB64, iterations) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) return null;
  const salt = fromBase64(saltB64);
  if (!salt) return null;
  try {
    const material = await subtle.importKey(
      'raw', new TextEncoder().encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveBits']);
    const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, 256);
    return toBase64(new Uint8Array(bits));
  } catch {
    return null;
  }
}

/**
 * Open a frame with a stored/derived login key. Never throws.
 * @param {unknown} frame
 * @param {string} loginKeyB64
 * @param {{ignoreReplay?: boolean}} [opts]
 * @returns {Promise<{ok: true, bundle: {v: 1, displayKey: string, slidesPublishToken: string, issuedAt: string}} | {ok: false, reason: 'no-key'|'kid-mismatch'|'auth-failed'|'malformed'|'stale'}>}
 */
export async function openProvisionFrame(frame, loginKeyB64, opts = {}) {
  if (!loginKeyB64) return { ok: false, reason: 'no-key' };
  if (!isProvisionFrame(frame)) return { ok: false, reason: 'malformed' };
  const imported = await importDisplayKey(loginKeyB64);
  if (!imported) return { ok: false, reason: 'no-key' };
  const opened = await openEnvelope(imported, PROVISION_EVENT, frame.envelope);
  if (!opened.ok) return { ok: false, reason: opened.reason };
  if (!isProvisionBundle(opened.payload)) return { ok: false, reason: 'malformed' };
  const bundle = opened.payload;
  // Replay guard: someone holding the Pusher SECRET could re-send a captured
  // frame to roll screens back to a rotated display key. Every real publish
  // carries a fresh issuedAt, so "older than what I last applied" is never
  // legitimate on the automatic path.
  if (!opts.ignoreReplay) {
    const last = loadIssuedAt();
    if (last && Date.parse(bundle.issuedAt) < last) return { ok: false, reason: 'stale' };
  }
  return { ok: true, bundle };
}

/**
 * Write a bundle into the two secret slots (and, when the publisher sent one,
 * the non-secret fleet-config slot). Returns false if either SECRET write
 * failed (storage blocked) — the caller reports, nothing else is retried.
 *
 * NOTHING here is ever written into the config object, dispatched through
 * dispatchEvent, or rendered: a provision frame is transport, not a display
 * event, and it never touches the event sanitizers.
 * @param {{displayKey: string, slidesPublishToken: string, issuedAt: string, configUrl?: string}} bundle
 */
export function applyProvisionBundle(bundle) {
  const okKey = saveDisplayKey(bundle.displayKey);
  const okTok = savePublishToken(bundle.slidesPublishToken);
  // ABSENT means "this publisher does not know about the field" — keep what
  // this screen already has. '' means the operator cleared it, which must
  // reach screens that already applied one. Its own slot, never config.
  if (typeof bundle.configUrl === 'string') saveFleetConfigUrl(bundle.configUrl);
  if (okKey && okTok) saveIssuedAt(Date.parse(bundle.issuedAt));
  return okKey && okTok;
}

// ── A tiny external store for the UI (useSyncExternalStore) ──────────────────
//
//   frameStatus  'waiting'    nothing heard from the provision channel yet
//                'received'   a well-formed frame is held in memory
//                'miss'       Pusher answered cache_miss — the server has not
//                             published in ~30 min (it is probably not running)
//   loginStatus  'logged-out' no login key on this screen
//                'logged-in'  a login key is stored (and the last frame opened)
//                'stale'      a frame arrived that the stored key cannot open —
//                             the passphrase was changed; log in again
//                'wrong'      the passphrase just typed did not open the frame
//                'busy'       deriving (the one-time PBKDF2 cost)
//                'unsupported' no WebCrypto here (the page is not a secure
//                             context) — nothing on this page can decrypt
//   pendingLogin true while a passphrase typed BEFORE any frame arrived is
//                parked in memory; it is tried automatically the moment a
//                frame lands. Memory only — never stored, never exported.

/** @typedef {'waiting'|'received'|'miss'} FrameStatus */
/** @typedef {'logged-out'|'logged-in'|'stale'|'wrong'|'busy'|'unsupported'} LoginStatus */
/** @typedef {{frameStatus: FrameStatus, loginStatus: LoginStatus, kid: string|null, lastAppliedAt: number|null, pendingLogin: boolean}} LoginSnapshot */

/** @type {LoginSnapshot} */
let snapshot = {
  frameStatus: 'waiting',
  loginStatus: loadLoginKey() ? 'logged-in' : 'logged-out',
  kid: null,
  lastAppliedAt: loadIssuedAt(),
  pendingLogin: false,
};
/** @type {unknown} */
let lastFrame = null;
/** A passphrase typed before any frame arrived — tried when one lands. Memory only. */
/** @type {string|null} */
let pendingPassphrase = null;
/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {Promise<unknown>} */
let chain = Promise.resolve();

/** @param {Partial<LoginSnapshot>} patch */
function update(patch) {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((fn) => fn());
}

/** @param {() => void} fn */
export function subscribe(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getSnapshot() {
  return snapshot;
}

/** Resolve the stored key's kid for the UI (asynchronously, once). */
async function refreshKid() {
  const key = loadLoginKey();
  if (!key) { update({ kid: null }); return; }
  const imported = await importDisplayKey(key);
  update({ kid: imported ? imported.kid : null });
}
if (typeof window !== 'undefined') refreshKid().catch(() => {});

/**
 * A frame arrived on the provision channel (called from useSocket). If this
 * screen holds a login key, open and apply it — that is how a rotated display
 * key or token reaches every logged-in screen with nobody touching it.
 * Serialized through one promise chain so two frames cannot race.
 * @param {unknown} frame
 */
export function receiveProvisionFrame(frame) {
  if (!isProvisionFrame(frame)) return;
  lastFrame = frame;
  update({ frameStatus: 'received' });
  // A volunteer who typed the passphrase while the print server was still
  // starting up should not have to type it again: try it now, on the same
  // serializer the automatic path uses.
  if (pendingPassphrase !== null) {
    const p = pendingPassphrase;
    pendingPassphrase = null;
    chain = chain.then(() => loginWithPassphrase(p)).catch(() => {});
    return;
  }
  const key = loadLoginKey();
  if (!key) return;
  chain = chain.then(async () => {
    const res = await openProvisionFrame(frame, key);
    if (res.ok) {
      if (applyProvisionBundle(res.bundle)) {
        update({ loginStatus: 'logged-in', lastAppliedAt: Date.parse(res.bundle.issuedAt) });
      }
      return;
    }
    if (res.reason === 'kid-mismatch' || res.reason === 'auth-failed') {
      // The passphrase was rotated on the print server. The keys this screen
      // already holds keep working until someone logs in again.
      update({ loginStatus: 'stale' });
    }
    // 'stale' (replay) and 'malformed' are ignored on purpose.
  }).catch(() => {});
}

/** Pusher told us nothing is cached: the print server has not published lately. */
export function noteCacheMiss() {
  if (snapshot.frameStatus !== 'received') update({ frameStatus: 'miss' });
}

/**
 * The volunteer typed the passphrase. Without a received frame the passphrase
 * is parked (pendingLogin) and tried automatically when one arrives.
 * @param {string} passphrase
 * @returns {Promise<'logged-in'|'wrong'|'no-frame'|'unsupported'|'storage'>}
 */
export async function loginWithPassphrase(passphrase) {
  const frame = lastFrame;
  if (!isProvisionFrame(frame)) {
    pendingPassphrase = passphrase;
    update({ pendingLogin: true });
    return 'no-frame';
  }
  pendingPassphrase = null;
  update({ loginStatus: 'busy', pendingLogin: false });
  const derived = await deriveLoginKey(passphrase, frame.kdf.salt, frame.kdf.iterations);
  if (!derived) {
    update({ loginStatus: 'unsupported' });
    return 'unsupported';
  }
  // A deliberate login always applies the current frame, even if this screen
  // once held a newer bundle: the person in front of the TV outranks the
  // replay guard, which exists for the unattended path.
  const res = await openProvisionFrame(frame, derived, { ignoreReplay: true });
  if (!res.ok) {
    update({ loginStatus: 'wrong' });
    return 'wrong';
  }
  if (!saveLoginKey(derived) || !applyProvisionBundle(res.bundle)) {
    update({ loginStatus: loadLoginKey() ? 'logged-in' : 'logged-out' });
    return 'storage';
  }
  const imported = await importDisplayKey(derived);
  update({ loginStatus: 'logged-in', kid: imported ? imported.kid : null, lastAppliedAt: Date.parse(res.bundle.issuedAt) });
  return 'logged-in';
}

/** Forget the login key AND everything it provisioned on this screen. */
export function logout() {
  saveLoginKey('');
  saveIssuedAt(null);
  saveDisplayKey('');
  savePublishToken('');
  // The fleet-config URL came from the same login, so it goes with it: a
  // screen being un-provisioned must not keep following a fleet it has just
  // been removed from.
  saveFleetConfigUrl('');
  pendingPassphrase = null;
  update({ loginStatus: 'logged-out', kid: null, lastAppliedAt: null, pendingLogin: false });
}

/** Test seam. */
export function _resetForTest() {
  lastFrame = null;
  pendingPassphrase = null;
  chain = Promise.resolve();
  snapshot = {
    frameStatus: 'waiting',
    loginStatus: loadLoginKey() ? 'logged-in' : 'logged-out',
    kid: null,
    lastAppliedAt: loadIssuedAt(),
    pendingLogin: false,
  };
  listeners.forEach((fn) => fn());
}

/** Test seam: wait for any in-flight automatic open/apply to settle. */
export function _settleForTest() {
  return chain;
}
