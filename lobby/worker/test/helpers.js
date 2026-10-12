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

/** Every key a storage holds, as one string: for "no plaintext id or name" checks. */
export function everything(store) {
  return JSON.stringify([...store.map.entries()]);
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
