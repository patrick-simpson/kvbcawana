// Shared test helpers for the online check-in modules.
import {
  PBKDF2_ITER_MIN, authVerifier, deriveAuthKey, generateKeyPair, importPrivateKey, keyRing, newRowId, openAsStation, sealForStations,
} from '../../shared/cloud-crypto.js';

// ── Signing in by passphrase v2 (routes.md section 1) ───────────────────────
// The only sign-in a client has: GET /v1/auth/params, derive authKey on the
// client (cloud-crypto.js deriveAuthKey), POST /v1/login {authKey}. A fresh
// Durable Object holds only the bootstrap HMAC of INITIAL_PASSPHRASE, so the
// first sign-in is the one upgrade {passphrase, authKey}, which stores the v2
// verifier. A test Worker's v2 salt is set to TEST_SALT before that upgrade, so
// the 600000-round derivation (PBKDF2_ITER_MIN: the least any client may use)
// runs once per passphrase per test file instead of once per Worker.

/** The v2 salt every test Worker gets before its first sign-in (16 bytes, standard base64). */
export const TEST_SALT = 'dGVzdC1zYWx0LTE2Ynl0ZQ==';
const derived = new Map();

/** The authKey for a passphrase under a salt and count, derived once. @param {string} passphrase @param {string} [salt] @param {number} [iter] */
export async function testAuthKey(passphrase = 'kennebec', salt = TEST_SALT, iter = PBKDF2_ITER_MIN) {
  const k = `${passphrase}\u0000${salt}\u0000${iter}`;
  if (!derived.has(k)) derived.set(k, deriveAuthKey(passphrase, salt, iter));
  return derived.get(k);
}

/** The `next` of a v2 passphrase change (POST /v1/passphrase): {salt, iter, verifier} for a new word. @param {string} passphrase @param {string} [salt] */
export async function v2Next(passphrase, salt = TEST_SALT, iter = PBKDF2_ITER_MIN) {
  return { salt, iter, verifier: await authVerifier(await testAuthKey(passphrase, salt, iter)) };
}

/**
 * Sign in to a SyncCore by v2, as a client does (the upgrade first on a fresh
 * store). Answers `{status, body, authKey}`; extra login fields (seedKey) ride along.
 * @param {{ handle: (r: Request, ip?: string) => Promise<Response>, storage: any }} core
 * @param {{ passphrase?: string, ip?: string, extra?: Record<string, unknown> }} [opts]
 */
export async function signInV2(core, { passphrase = 'kennebec', ip = '10.0.0.1', extra = {} } = {}) {
  const pres = await core.handle(new Request('https://sync.test/v1/auth/params'), ip);
  const params = await pres.json();
  if (pres.status !== 200) return { status: pres.status, body: params, authKey: null };
  let { salt, iter } = params;
  if (params.upgrade) {
    const auth = await core.storage.get('auth');
    if (auth && auth.v2 && !auth.v2.verifier && auth.v2.salt !== TEST_SALT) {
      await core.storage.put('auth', { ...auth, v2: { ...auth.v2, salt: TEST_SALT, iter: PBKDF2_ITER_MIN } });
    }
    ({ salt, iter } = (await core.storage.get('auth')).v2);
  }
  const authKey = await testAuthKey(passphrase, salt, iter);
  const fields = params.upgrade ? { passphrase, authKey, ...extra } : { authKey, ...extra };
  const res = await core.handle(new Request('https://sync.test/v1/login', { method: 'POST', body: JSON.stringify(fields) }), ip);
  return { status: res.status, body: await res.json(), authKey };
}

/** A Durable Object's storage as a Map (copies in and out, like the real one). */
export function memoryStore(map = new Map()) {
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => {
      if (k && typeof k === 'object') for (const [a, b] of Object.entries(k)) map.set(a, structuredClone(b));
      else map.set(k, structuredClone(v));
    },
    delete: async (k) => map.delete(k),
    list: async ({ prefix = '', limit = Infinity } = {}) => new Map([...map].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1)).slice(0, limit).map(([k, v]) => [k, structuredClone(v)])),
  };
}

/** A clock the test moves, and a sleep that moves it. */
export function fakeClock(start = Date.parse('2026-10-14T22:00:00Z')) {
  const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms; }, sleep: async (ms) => { c.t += ms; } };
  return c;
}

const RANDOM_LOOKING = /^[A-Za-z0-9+/_=-]{60,}$/;
/**
 * Storage as plain data: a long base64-looking string (a sealed blob, 60+ characters; tags and ids stay visible) is
 * replaced by `~`, and JSON kept inside a string (a replayed frame) is opened. What is
 * left is what a reader of the storage could read, and a test's "no name here" check
 * cannot be fooled by a name that happens to occur in random ciphertext.
 * @param {any} v
 */
function readable(v) {
  if (typeof v === 'string') {
    if (v.startsWith('{')) { try { return readable(JSON.parse(v)); } catch { /* not JSON */ } }
    return RANDOM_LOOKING.test(v) ? '~' : v;
  }
  if (Array.isArray(v)) return v.map(readable);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [RANDOM_LOOKING.test(k) ? '~' : k, readable(x)]));
  return v;
}

/**
 * A pattern for "this word appears in plain text": the word, not inside a
 * run of base64 characters (a random salt, hash or iv can spell "ZED" by
 * chance, which once failed a "no name stored" check).
 * @param {string[]} words
 */
export function plainWords(words) {
  const edge = '[A-Za-z0-9+/=_-]';
  return new RegExp(`(?<!${edge})(?:${words.join('|')})(?!${edge})`, 'i');
}

/** Every key a storage holds, as one string: for "no plaintext id or name" checks. */
export function everything(store) {
  return JSON.stringify(readable([...store.map.entries()]));
}

/** A station with a real key pair: {body} to register, and a ring to open bundles with. */
export async function makeStation(stationId = 'station-aaaaaaaa', name = 'Desk laptop') {
  const kp = await generateKeyPair();
  const ring = await keyRing(await importPrivateKey(kp.privateJwk), kp.publicKey);
  return { body: { stationId, name, pub: kp.publicKey, kid: kp.kid }, ring, pub: kp.publicKey, kid: kp.kid };
}

/** A client-sealed print job bundle for these stations (what the desk page posts). */
export async function sealJob(stations, record, { night = '2026-10-14', id = newRowId(), kind = 'print-job' } = {}) {
  const bundle = await sealForStations(stations.map((s) => ({ publicKey: s.pub })), { id, night, kind, record });
  return { id, bundle };
}

export { openAsStation };
