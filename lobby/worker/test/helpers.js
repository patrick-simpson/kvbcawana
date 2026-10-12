// Shared test helpers for the online check-in modules.
import { generateKeyPair, importPrivateKey, keyRing, newRowId, openAsStation, sealForStations } from '../../shared/cloud-crypto.js';

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
