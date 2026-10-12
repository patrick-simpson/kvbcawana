// This computer's keys as an online check-in STATION (ROADMAP.md#online-check-in,
// P2; the constructions are lobby/shared/cloud-crypto.js, loaded here as the
// generated CommonJS copy ./cloud-crypto.js).
//
//   * the STATION key: an ECDH P-256 pair made once on this computer. The
//     private half is kept only with Electron safeStorage (DPAPI, bound to this
//     Windows user) in `station-key.bin`; the public half is registered with
//     the Worker (POST /v1/station/register). No pairing step (owner): any
//     computer signed in with the passphrase may register one. FAIL CLOSED: where
//     safeStorage cannot encrypt, nothing is made or written and the station
//     role is refused, never a plain file.
//   * the HISTORY key: the print role also opens the history private key (the
//     passphrase unwraps it, once, at setup) to read the attendance behind
//     milestone, first-time, twin and "Go to" fields. Its JWK is kept the same
//     way (`history-key.bin`, safeStorage only); a passphrase change re-wraps
//     the SAME key, so the kept copy stays right.
//
// Electron-free: `safeStorage` is injected ({isEncryptionAvailable,
// encryptString, decryptString}), so scripts/test-station-keys.cjs runs it with
// a stand-in. Never logs or returns a private key.
'use strict';

const fs = require('fs');
const path = require('path');
const cc = require('./cloud-crypto');

const STATION_FILE = 'station-key.bin';
const HISTORY_FILE = 'history-key.bin';
const NAME_MAX = 60;

const REFUSED = Object.freeze({
  ok: false,
  reason: 'safe-storage-unavailable',
  error: 'This computer cannot keep a secret key safely (Windows data protection is not available to this user), so it cannot be a print station.',
});

/**
 * @param {{ dir: string, safeStorage: any, request: Function, log?: Function }} deps
 */
function createStationKeys({ dir, safeStorage, request, log = () => {} }) {
  const stationFile = path.join(dir, STATION_FILE);
  const historyFile = path.join(dir, HISTORY_FILE);
  /** @type {any} */ let stationCache = null;   // { publicKey, kid, privateJwk }
  /** @type {any} */ let ringCache = null;
  /** @type {any} */ let historyCache = null;   // { pub, kid, jwk }
  /** @type {any} */ let historyRingCache = null;

  const canEncrypt = () => {
    try { return !!safeStorage && safeStorage.isEncryptionAvailable() === true; } catch { return false; }
  };

  function readSecret(file) {
    if (!canEncrypt()) return null;
    try {
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(file)));
    } catch { return null; }   // none, damaged, or another Windows user's
  }

  function writeSecret(file, value) {
    if (!canEncrypt()) throw new Error('safeStorage is unavailable');
    const tmp = `${file}.tmp`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(value)));
    fs.renameSync(tmp, file);
  }

  /** A stored pair is only good when its private half is its public half's. */
  function pairIsConsistent(s) {
    try {
      if (!s || typeof s.publicKey !== 'string' || typeof s.kid !== 'string' || !s.privateJwk) return false;
      const raw = cc.base64ToBytes(s.publicKey);
      if (!raw) return false;
      const jwkPub = cc.rawFromJwk(cc.canonicalJwk(s.privateJwk));
      return jwkPub.length === raw.length && jwkPub.every((b, i) => b === raw[i]);
    } catch { return false; }
  }

  /** @returns {Promise<{ ok: true, publicKey: string, kid: string, created: boolean } | typeof REFUSED | { ok: false, reason: string, error: string }>} */
  async function ensure() {
    if (!canEncrypt()) return REFUSED;
    if (stationCache) return { ok: true, publicKey: stationCache.publicKey, kid: stationCache.kid, created: false };
    const stored = readSecret(stationFile);
    if (pairIsConsistent(stored) && stored.kid === await cc.kidOf(stored.publicKey)) {
      stationCache = stored;
      return { ok: true, publicKey: stored.publicKey, kid: stored.kid, created: false };
    }
    const pair = await cc.generateKeyPair();
    const value = { v: 1, publicKey: pair.publicKey, kid: pair.kid, privateJwk: pair.privateJwk };
    try { writeSecret(stationFile, value); } catch (e) {
      return { ok: false, reason: 'cannot-keep-key', error: `The station key could not be kept: ${e.message}` };
    }
    stationCache = value;
    ringCache = null;
    return { ok: true, publicKey: pair.publicKey, kid: pair.kid, created: true };
  }

  /** The key ring openAsStation takes (private key non-extractable), or null. */
  async function ring() {
    if (ringCache) return ringCache;
    const k = await ensure();
    if (!k.ok) return null;
    ringCache = await cc.keyRing(await cc.importPrivateKey(stationCache.privateJwk), stationCache.publicKey);
    return ringCache;
  }

  /**
   * POST /v1/station/register. The same stationId replaces its own key, so
   * this is safe to repeat.
   * @param {{ base: string, session: string, stationId: string, name?: string }} o
   */
  async function register({ base, session, stationId, name }) {
    const k = await ensure();
    if (!k.ok) return k;
    const res = await request(base, '/v1/station/register', {
      method: 'POST', session, station: stationId,
      body: { stationId, name: String(name || '').slice(0, NAME_MAX) || 'KVBC Awana', pub: k.publicKey, kid: k.kid },
    });
    if (!res.ok) return { ok: false, reason: res.status === 401 ? 'signed-out' : (res.status === 0 ? 'unreachable' : 'refused'), status: res.status };
    log(`[station] registered ${stationId} (${k.kid})`);
    return { ok: true, kid: k.kid, stations: res.body && res.body.stations };
  }

  // ── the history key ──────────────────────────────────────────────────────

  /**
   * The wrapped history key's JWK, opened with the passphrase and proved to
   * belong to `pub` (cloud-crypto's own unwrap only hands back a non-extractable
   * key, and this one has to be kept; same construction, same checks).
   */
  async function openWrappedJwk(wrapped, passphrase, pub) {
    if (!wrapped || wrapped.v !== cc.CLOUD_CRYPTO_VERSION) return null;
    const raw = cc.base64ToBytes(pub);
    const salt = cc.base64ToBytes(wrapped.salt);
    const iv = cc.base64ToBytes(wrapped.iv);
    const ct = cc.base64ToBytes(wrapped.ct);
    if (!raw || raw.length !== 65 || !salt || !iv || iv.length !== 12 || !ct) return null;
    try {
      const { wrapKey } = await cc.deriveKeys(passphrase, salt, wrapped.iter);
      const pt = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: cc.utf8(cc.AAD_WRAP + await cc.kidOf(raw)) }, wrapKey, ct);
      const jwk = cc.canonicalJwk(JSON.parse(new TextDecoder().decode(pt)));
      const point = cc.rawFromJwk(jwk);
      if (point.length !== raw.length || !point.every((b, i) => b === raw[i])) return null;
      if (!(await cc.keyMatches(await cc.importPrivateKey(jwk), raw))) return null;
      return jwk;
    } catch { return null; }
  }

  /**
   * Fetch the history key (GET /v1/history/key), open it with the passphrase
   * and keep it. The passphrase is used here and not kept.
   * @param {{ base: string, session: string, stationId?: string, passphrase: string }} o
   */
  async function unlockHistory({ base, session, stationId, passphrase }) {
    if (!canEncrypt()) return REFUSED;
    const res = await request(base, '/v1/history/key', { session, station: stationId });
    if (res.status === 404) return { ok: false, reason: 'no-history-key', error: 'The church has no history key yet.' };
    if (!res.ok || !res.body) return { ok: false, reason: res.status === 0 ? 'unreachable' : 'refused', status: res.status };
    const { pub, kid, wrapped } = res.body;
    let derivedKid;
    try { derivedKid = await cc.kidOf(pub); } catch { derivedKid = null; }
    if (!derivedKid || derivedKid !== kid) return { ok: false, reason: 'bad-history-key', error: 'The history key the service sent is not consistent.' };
    const jwk = await openWrappedJwk(wrapped, passphrase, pub);
    if (!jwk) return { ok: false, reason: 'wrong-passphrase', error: 'That passphrase does not open the history key.' };
    try { writeSecret(historyFile, { v: 1, pub, kid, jwk }); } catch (e) {
      return { ok: false, reason: 'cannot-keep-key', error: `The history key could not be kept: ${e.message}` };
    }
    historyCache = { pub, kid, jwk };
    historyRingCache = null;
    return { ok: true, kid };
  }

  function loadHistory() {
    if (historyCache) return historyCache;
    const s = readSecret(historyFile);
    if (s && s.pub && s.jwk && typeof s.kid === 'string') historyCache = s;
    return historyCache;
  }

  /** The history key ring (openRow), or null when this computer was never unlocked. */
  async function historyRing() {
    if (historyRingCache) return historyRingCache;
    const h = loadHistory();
    if (!h) return null;
    try {
      historyRingCache = await cc.keyRing(await cc.importPrivateKey(h.jwk), h.pub);
    } catch { return null; }
    return historyRingCache;
  }

  /** history:pub (what rows are sealed to), or null. */
  function historyPub() {
    const h = loadHistory();
    return h ? h.pub : null;
  }

  function forgetHistory() {
    historyCache = null; historyRingCache = null;
    try { fs.unlinkSync(historyFile); } catch { /* none */ }
  }

  function status() {
    const safe = canEncrypt();
    const h = safe ? loadHistory() : null;
    return {
      safeStorage: safe,
      station: safe ? (stationCache || readSecret(stationFile) ? 'ready' : 'none') : 'refused',
      history: h ? 'ready' : 'locked',
    };
  }

  return { ensure, ring, register, unlockHistory, historyRing, historyPub, forgetHistory, status, available: canEncrypt };
}

module.exports = { createStationKeys, STATION_FILE, HISTORY_FILE, REFUSED };
