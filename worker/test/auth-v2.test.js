import { describe, expect, it } from 'vitest';
import { SyncCore } from '../src/sync.js';
import {
  PBKDF2_ITER, authVerifier, bytesToBase64, createHistoryKey, deriveKeys, rewrapPrivateKey, unwrapPrivateKey,
} from '../../shared/cloud-crypto.js';

// Passphrase v2 (routes.md section 1): GET /v1/auth/params, login with authKey,
// and the BOOTSTRAP: a fresh store holds only the HMAC of INITIAL_PASSPHRASE,
// and the one upgrade login {passphrase, authKey} stores the first verifier.
// The old {passphrase} login and the old-shape passphrase change are gone
// (owner 2026-10-16). The real 600000-round PBKDF2 runs here (about 0.3 s in
// Node), as a client's does.

const PASS = 'kennebec';
const NEXT = 'moosehead lake';

function memoryStore() {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? structuredClone(map.get(k)) : undefined),
    put: async (k, v) => {
      if (k && typeof k === 'object') for (const [a, b] of Object.entries(k)) map.set(a, structuredClone(b));
      else map.set(k, structuredClone(v));
    },
    delete: async (k) => map.delete(k),
  };
}

function setup(env = {}) {
  let t = Date.parse('2026-10-14T22:00:00Z');
  const storage = memoryStore();
  const core = new SyncCore({
    storage, env: { INITIAL_PASSPHRASE: PASS, ...env }, now: () => t,
    broadcast: () => 1, fetchFn: async () => new Response('', { status: 404 }),
  });
  const call = async (method, path, body, token, ip = '10.0.0.1') => {
    const res = await core.handle(new Request(`https://sync.test${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    }), ip);
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const params = async () => (await call('GET', '/v1/auth/params')).body;
  const keyFor = async (pass, p) => bytesToBase64((await deriveKeys(pass, p.salt, p.iter)).authKey);
  return { core, storage, call, params, keyFor, tick: (ms) => { t += ms; } };
}

describe('GET /v1/auth/params', () => {
  it('is public, makes the salt once on the first ask and says an upgrade is due', async () => {
    const s = setup();
    const a = await s.call('GET', '/v1/auth/params');
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ v: 2, iter: PBKDF2_ITER, legacy: true, upgrade: true });
    expect(Buffer.from(a.body.salt, 'base64')).toHaveLength(16);
    expect((await s.params()).salt).toBe(a.body.salt);
  });

  it('is 503 when the Worker has no passphrase at all', async () => {
    const s = setup({ INITIAL_PASSPHRASE: '' });
    expect((await s.call('GET', '/v1/auth/params')).status).toBe(503);
  });
});

describe('migration: the first v2 client upgrades the old verifier', () => {
  it('an authKey alone is refused (no counted failure) until the passphrase upgrades the store', async () => {
    const s = setup();
    const p = await s.params();
    const authKey = await s.keyFor(PASS, p);
    const bare = await s.call('POST', '/v1/login', { authKey });
    expect(bare.status).toBe(401);
    expect(bare.body.reason).toBe('upgrade-needed');
    expect(bare.body.triesLeft).toBeUndefined();   // not a wrong guess

    const up = await s.call('POST', '/v1/login', { passphrase: PASS, authKey });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ upgraded: true, history: null });
    expect(up.body.session).toMatch(/^v1\./);
    const auth = await s.storage.get('auth');
    expect(auth.v2.verifier).toBe(await authVerifier(authKey));
    expect(auth.hash).toBeTruthy();   // the legacy hash stays during the transition
    expect((await s.params()).upgrade).toBe(false);

    // from now on the authKey alone signs in, and the passphrase is never sent
    const again = await s.call('POST', '/v1/login', { authKey });
    expect(again.status).toBe(200);
    expect(again.body.upgraded).toBeUndefined();
    // ...and that first v2 login after the upgrade deletes the bootstrap hash
    const after = await s.storage.get('auth');
    expect(after.hash).toBeUndefined();
    expect(after.salt).toBeUndefined();
    expect(after.v2.verifier).toBe(await authVerifier(authKey));
    expect((await s.params()).legacy).toBe(false);
    expect((await s.call('POST', '/v1/login', { authKey })).status).toBe(200);
  }, 30000);

  it('a wrong passphrase on the upgrade is a counted failure and stores nothing', async () => {
    const s = setup();
    const p = await s.params();
    const res = await s.call('POST', '/v1/login', { passphrase: 'nope nope', authKey: await s.keyFor('nope nope', p) });
    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('wrong');
    expect((await s.storage.get('auth')).v2.verifier).toBe(null);
  }, 30000);

  it('a wrong authKey after the upgrade is refused', async () => {
    const s = setup();
    const p = await s.params();
    await s.call('POST', '/v1/login', { passphrase: PASS, authKey: await s.keyFor(PASS, p) });
    const bad = await s.call('POST', '/v1/login', { authKey: await s.keyFor('something else', p) });
    expect(bad.status).toBe(401);
    expect(bad.body.reason).toBe('wrong');
    expect((await s.call('POST', '/v1/login', { authKey: 'short' })).status).toBe(400);
  }, 30000);

  it('the old {passphrase} login is refused before and after the upgrade: 401 legacy-off, not a counted guess, nothing stored', async () => {
    const s = setup();
    const before = await s.call('POST', '/v1/login', { passphrase: PASS });
    expect(before.status).toBe(401);
    expect(before.body.reason).toBe('legacy-off');
    expect(before.body.triesLeft).toBeUndefined();
    expect(before.body.session).toBeUndefined();
    const p = await s.params();
    await s.call('POST', '/v1/login', { passphrase: PASS, authKey: await s.keyFor(PASS, p) });
    for (let i = 0; i < 6; i++) expect((await s.call('POST', '/v1/login', { passphrase: PASS })).body.reason).toBe('legacy-off');
    expect(await s.storage.get('fails:10.0.0.1')).toBeUndefined();   // never a counted failure: no lockout
    expect(await s.storage.get('auth:legacyLastAt')).toBeUndefined();
    expect((await s.call('POST', '/v1/login', { authKey: await s.keyFor(PASS, p) })).status).toBe(200);
  }, 30000);

  it('a v2 login hands back the history key, and the lockout counts v2 failures like the old ones', async () => {
    const s = setup();
    const p = await s.params();
    const key = await createHistoryKey(PASS);
    const authKey = await s.keyFor(PASS, p);
    const { session } = (await s.call('POST', '/v1/login', { passphrase: PASS, authKey })).body;
    expect((await s.call('PUT', '/v1/history/key', key, session)).status).toBe(201);
    const login = await s.call('POST', '/v1/login', { authKey });
    expect(login.body.history).toEqual({ pub: key.pub, kid: key.kid, wrapped: key.wrapped });
    const bad = await s.keyFor('guess', p);
    for (let i = 0; i < 5; i++) await s.call('POST', '/v1/login', { authKey: bad });
    expect((await s.call('POST', '/v1/login', { authKey })).status).toBe(429);
  }, 60000);
});

describe('changing the passphrase', () => {
  it('v2: derives everything client-side, re-wraps the history key, deletes the legacy hash, signs everyone out', async () => {
    const s = setup();
    const p = await s.params();
    const authKey = await s.keyFor(PASS, p);
    const first = (await s.call('POST', '/v1/login', { passphrase: PASS, authKey })).body;
    const key = await createHistoryKey(PASS);
    await s.call('PUT', '/v1/history/key', key, first.session);

    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const derived = await deriveKeys(NEXT, salt, PBKDF2_ITER);
    const next = { salt, iter: PBKDF2_ITER, verifier: await authVerifier(derived.authKey) };
    const wrapped = await rewrapPrivateKey(key.wrapped, PASS, NEXT, key.pub);
    // a bad current key is refused and changes nothing
    const refused = await s.call('POST', '/v1/passphrase', { currentAuthKey: await s.keyFor('nope', p), next, wrapped }, first.session);
    expect(refused.status).toBe(401);
    // a malformed next is refused
    expect((await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next: { ...next, iter: 1000 }, wrapped }, first.session)).status).toBe(400);
    // the history key must be re-wrapped
    expect((await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next }, first.session)).body.reason).toBe('wrap-missing');

    const done = await s.call('POST', '/v1/passphrase', { currentAuthKey: authKey, next, wrapped }, first.session);
    expect(done.status).toBe(200);
    expect(done.body.session).toMatch(/^v1\./);
    const auth = await s.storage.get('auth');
    expect(auth).toMatchObject({ epoch: 2, v2: next });
    expect(auth.hash).toBeUndefined();
    expect((await s.storage.get('history:wrapped'))).toEqual(wrapped);
    expect(await unwrapPrivateKey(wrapped, NEXT, key.pub)).toBeTruthy();
    expect((await s.call('GET', '/v1/state', undefined, first.session)).status).toBe(401);   // the old session is signed out

    const p2 = await s.params();
    expect(p2).toMatchObject({ salt, iter: PBKDF2_ITER, legacy: false, upgrade: false });
    expect((await s.call('POST', '/v1/login', { authKey: bytesToBase64(derived.authKey) })).status).toBe(200);
    expect((await s.call('POST', '/v1/login', { passphrase: NEXT })).status).toBe(401);   // old protocol is gone
  }, 60000);

  it('the old-shape change (the new word itself) is refused and changes nothing', async () => {
    const s = setup();
    const p = await s.params();
    const authKey = await s.keyFor(PASS, p);
    const first = (await s.call('POST', '/v1/login', { passphrase: PASS, authKey })).body;
    const before = await s.storage.get('auth');
    const old = await s.call('POST', '/v1/passphrase', { current: PASS, next: NEXT }, first.session);
    expect(old.status).toBe(400);
    expect(old.body.reason).toBe('legacy-off');
    expect(await s.storage.get('auth')).toEqual(before);
    expect((await s.call('GET', '/v1/state', undefined, first.session)).status).toBe(200);   // nobody signed out
  }, 30000);

  it('once a verifier is stored the passphrase is no proof for a change (only the current authKey is)', async () => {
    const s = setup();
    const p = await s.params();
    const first = (await s.call('POST', '/v1/login', { passphrase: PASS, authKey: await s.keyFor(PASS, p) })).body;
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const derived = await deriveKeys(NEXT, salt, PBKDF2_ITER);
    const res = await s.call('POST', '/v1/passphrase', {
      current: PASS, next: { salt, iter: PBKDF2_ITER, verifier: await authVerifier(derived.authKey) },
    }, first.session);
    expect(res.status).toBe(401);
    expect((await s.storage.get('auth')).epoch).toBe(1);
  }, 60000);

  it('a v2 change from a store that has no verifier yet may prove itself with the passphrase', async () => {
    const s = setup();
    // A session made before the switch, while no verifier was stored (the store as a fresh deploy leaves it).
    const epoch = (await s.core.ensureAuth()).epoch;
    const first = { session: await s.core.mintSession(epoch) };
    expect((await s.call('GET', '/v1/state', undefined, first.session)).status).toBe(200);
    const salt = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const derived = await deriveKeys(NEXT, salt, PBKDF2_ITER);
    const done = await s.call('POST', '/v1/passphrase', {
      current: PASS, next: { salt, iter: PBKDF2_ITER, verifier: await authVerifier(derived.authKey) },
    }, first.session);
    expect(done.status).toBe(200);
    expect((await s.storage.get('auth')).hash).toBeUndefined();
  }, 30000);
});
