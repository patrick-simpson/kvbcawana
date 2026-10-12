import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  AUTH_PARAMS_PATH,
  SYNC_URL_MAX,
  UNREACHABLE,
  buildLoginBody,
  buildRequest,
  isPlausibleDisplayKey,
  isValidSession,
  isValidSyncUrl,
  normalizeSyncPassphrase,
  parseAuthParams,
  parseLoginResponse,
  parseSessionCheck,
  parseSyncIndex,
  publishRequest,
  readResponse,
  screenNamePath,
  screenSettingsPath,
  signInWithPassphrase,
  SCREEN_HELLO_PATH,
} from '../../shared/sync-protocol.js';

// The protocol is dependency-free and shared by every sync client
// (lobby/shared/sync-protocol.js; the print server and the Electron app run a
// generated CommonJS copy, which scripts/check-mirrors.mjs keeps current).
// These are the rules every client now gets from the one place.

const SESSION = 'v1.1760000000.1.abcdefghijklmnopqrstuvwxyz012345';
const KEY = `${'k'.repeat(43)}=`;

describe('the service address', () => {
  it('is https only, with no query, fragment or credentials', () => {
    expect(isValidSyncUrl('https://awana.kvbchurch.org/api')).toBe(true);
    for (const bad of ['http://a.b', 'https://a.b/?x=1', 'https://a.b/#x', 'https://u:p@a.b', 'ftp://a.b', 'nope', '', null, 42]) {
      expect(isValidSyncUrl(bad)).toBe(false);
    }
  });

  it('has ONE explicit maximum, and a real address is nowhere near it', () => {
    expect(SYNC_URL_MAX).toBe(200);
    expect(isValidSyncUrl(`https://a.b/${'x'.repeat(SYNC_URL_MAX - 12)}`)).toBe(true);   // exactly 200
    expect(isValidSyncUrl(`https://a.b/${'x'.repeat(SYNC_URL_MAX - 11)}`)).toBe(false);  // 201
    expect(isValidSyncUrl('https://awana-sync.kvbc-awana.workers.dev')).toBe(true);
  });

  it('reads shared/sync.json: an address, "" for none, null when unusable', () => {
    expect(parseSyncIndex({ url: ' https://awana.kvbchurch.org/api/ ' })).toBe('https://awana.kvbchurch.org/api');
    expect(parseSyncIndex({ url: '' })).toBe('');
    expect(parseSyncIndex({})).toBe('');
    expect(parseSyncIndex({ url: 'http://insecure.example' })).toBeNull();
    expect(parseSyncIndex(null)).toBe('');
  });
});

describe('sessions, keys and the passphrase', () => {
  it('knows a session token and a display key', () => {
    expect(isValidSession(SESSION)).toBe(true);
    expect(isValidSession('v1.1.1.short')).toBe(false);
    expect(isValidSession(undefined)).toBe(false);
    expect(isPlausibleDisplayKey(KEY)).toBe(true);
    expect(isPlausibleDisplayKey(`  ${KEY}\n`)).toBe(true);
    expect(isPlausibleDisplayKey('k'.repeat(43))).toBe(false);
    expect(isPlausibleDisplayKey(null)).toBe(false);
  });

  it('normalizes the passphrase the way the Worker does: trim, NFKC, lowercase', () => {
    expect(normalizeSyncPassphrase('  Ｋennebec \n')).toBe('kennebec');
    expect(normalizeSyncPassphrase(undefined)).toBe('');
  });
});

describe('building requests', () => {
  it('joins the base and path, and sets the content type and bearer only when needed', () => {
    expect(buildRequest('https://x.test', '/v1/state', { session: SESSION })).toEqual({
      url: 'https://x.test/v1/state',
      init: { method: 'GET', headers: { Authorization: `Bearer ${SESSION}` }, body: undefined },
    });
    const post = buildRequest('https://x.test', '/v1/login', { method: 'POST', body: { a: 1 } });
    expect(post.init).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
  });

  it('builds the login body, seeding a key only when one is given', () => {
    expect(buildLoginBody(' Kennebec ')).toEqual({ passphrase: 'kennebec' });
    expect(buildLoginBody('kennebec', ` ${KEY} `)).toEqual({ passphrase: 'kennebec', seedKey: KEY });
  });

  it('knows the publish and registry routes', () => {
    expect(publishRequest('settings', { a: 1 })).toEqual({ path: '/v1/settings', method: 'PUT', body: { settings: { a: 1 } } });
    expect(publishRequest('slides', [1])).toEqual({ path: '/v1/slides', method: 'PUT', body: { slides: [1] } });
    expect(SCREEN_HELLO_PATH).toBe('/v1/screens/hello');
    expect(screenSettingsPath('abc')).toBe('/v1/screens/abc/settings');
    expect(screenNamePath('abc')).toBe('/v1/screens/abc/name');
  });
});

describe('reading answers', () => {
  it('reads a Response without throwing, JSON or not', async () => {
    expect(await readResponse({ ok: true, status: 200, json: async () => ({ x: 1 }) })).toEqual({ ok: true, status: 200, body: { x: 1 } });
    expect(await readResponse({ ok: false, status: 502, json: async () => { throw new Error('html'); } })).toEqual({ ok: false, status: 502, body: null });
    expect(UNREACHABLE).toEqual({ ok: false, status: 0, body: null });
  });

  it('turns every login answer into one shape', () => {
    const ok = parseLoginResponse({ ok: true, status: 200, body: { session: SESSION, displayKey: ` ${KEY} `, state: { settings: null } } });
    expect(ok).toEqual({ ok: true, session: SESSION, displayKey: KEY, state: { settings: null } });
    expect(parseLoginResponse(UNREACHABLE, { who: 'computer' })).toMatchObject({ ok: false, reason: 'unreachable', message: expect.stringContaining('this computer') });
    expect(parseLoginResponse({ ok: false, status: 401, body: { triesLeft: 3 } })).toMatchObject({ reason: 'wrong', triesLeft: 3 });
    expect(parseLoginResponse({ ok: false, status: 401, body: {} })).not.toHaveProperty('triesLeft');
    expect(parseLoginResponse({ ok: false, status: 429, body: { retryAfterSec: 60 } })).toMatchObject({ reason: 'locked', retryAfterSec: 60 });
    expect(parseLoginResponse({ ok: false, status: 429, body: null })).toMatchObject({ retryAfterSec: 900 });
    expect(parseLoginResponse({ ok: false, status: 503, body: {} })).toMatchObject({ reason: 'not-set-up' });
    expect(parseLoginResponse({ ok: false, status: 500, body: { error: 'boom' } })).toMatchObject({ reason: 'rejected', message: 'boom' });
  });

  it('refuses a 200 whose session or key is unusable', () => {
    expect(parseLoginResponse({ ok: true, status: 200, body: { session: 'nope', displayKey: KEY } })).toMatchObject({ ok: false, reason: 'rejected' });
    expect(parseLoginResponse({ ok: true, status: 200, body: { session: SESSION, displayKey: 'short' } })).toMatchObject({ ok: false, reason: 'rejected' });
    expect(parseLoginResponse({ ok: true, status: 200, body: null })).toMatchObject({ ok: false, reason: 'rejected' });
  });

  it('reads a session check', () => {
    expect(parseSessionCheck({ ok: true, status: 200 })).toBe('ok');
    expect(parseSessionCheck({ ok: false, status: 401 })).toBe('signed-out');
    expect(parseSessionCheck({ ok: false, status: 0 })).toBe('unreachable');
  });
});

describe('the CommonJS copy the print server and the Electron app load', () => {
  it('exports the same functions, and they agree', () => {
    const cjs = createRequire(import.meta.url)('../../../printer/print-server/sync-protocol.js');
    expect(Object.keys(cjs).sort()).toEqual(Object.keys({
      AUTH_PARAMS_PATH, parseAuthParams, signInWithPassphrase,
      SYNC_URL_MAX, UNREACHABLE, buildLoginBody, buildRequest, isPlausibleDisplayKey, isValidSession, isValidSyncUrl,
      normalizeSyncPassphrase, parseLoginResponse, parseSessionCheck, parseSyncIndex, publishRequest, readResponse,
      screenNamePath, screenSettingsPath, SCREEN_HELLO_PATH,
      SESSION_RE: 0, DISPLAY_KEY_RE: 0, SYNC_TIMEOUT_MS: 0,
    }).sort());
    expect(cjs.SYNC_URL_MAX).toBe(SYNC_URL_MAX);
    expect(cjs.isValidSyncUrl('https://awana.kvbchurch.org/api')).toBe(true);
    expect(cjs.parseLoginResponse({ ok: false, status: 401, body: { triesLeft: 2 } })).toEqual(parseLoginResponse({ ok: false, status: 401, body: { triesLeft: 2 } }));
  });
});

describe('passphrase v2 sign-in (one driver for every client)', () => {
  const P = { v: 2, salt: 'c2FsdHNhbHRzYWx0c2FsdA==', iter: 600000, legacy: true, upgrade: false };
  const ok = (body) => ({ ok: true, status: 200, body });
  const derive = async (pass, salt, iter) => `key:${pass}:${salt}:${iter}`;
  /** A request stub that answers by route and records the calls. */
  const rig = (routes) => {
    const calls = [];
    const request = async (path, o = {}) => { calls.push({ path, body: o.body }); return routes[path](o.body); };
    return { calls, request };
  };

  it('reads the params, and only a well-formed v2 answer', () => {
    expect(AUTH_PARAMS_PATH).toBe('/v1/auth/params');
    expect(parseAuthParams(ok(P))).toEqual({ salt: P.salt, iter: 600000, legacy: true, upgrade: false });
    expect(parseAuthParams(ok({ ...P, upgrade: true })).upgrade).toBe(true);
    for (const bad of [ok({ ...P, v: 1 }), ok({ ...P, salt: '' }), ok({ ...P, iter: 'x' }), { ok: false, status: 404, body: null }, ok(null)]) {
      expect(parseAuthParams(bad)).toBeNull();
    }
  });

  it('sends the authKey alone, normalizing the passphrase before it derives', async () => {
    const r = rig({ '/v1/auth/params': () => ok(P), '/v1/login': () => ok({ session: SESSION }) });
    const out = await signInWithPassphrase({ request: r.request, derive, passphrase: '  KenneBec ' });
    expect(r.calls[1].body).toEqual({ authKey: `key:kennebec:${P.salt}:600000` });
    expect(out.derived).toEqual({ salt: P.salt, iter: 600000, authKey: `key:kennebec:${P.salt}:600000` });
  });

  it('the seed key rides along on every shape of login', async () => {
    const r = rig({ '/v1/auth/params': () => ok({ ...P, upgrade: true }), '/v1/login': () => ok({}) });
    await signInWithPassphrase({ request: r.request, derive, passphrase: 'kennebec', seedKey: ` ${KEY} ` });
    expect(r.calls[1].body).toEqual({ passphrase: 'kennebec', authKey: `key:kennebec:${P.salt}:600000`, seedKey: KEY });
  });

  it('upgrade-needed (the store was upgraded by nobody yet) is answered with the passphrase once', async () => {
    const r = rig({
      '/v1/auth/params': () => ok(P),
      '/v1/login': (b) => (b.passphrase ? ok({ session: SESSION, upgraded: true }) : { ok: false, status: 401, body: { reason: 'upgrade-needed' } }),
    });
    const out = await signInWithPassphrase({ request: r.request, derive, passphrase: 'kennebec' });
    expect(out.res.ok).toBe(true);
    expect(r.calls.map((c) => Object.keys(c.body || {}).join('+'))).toEqual(['', 'authKey', 'passphrase+authKey']);
  });

  it('falls back to today\'s login only for a service with no v2 (404); other failures are reported as they are', async () => {
    const old = rig({ '/v1/auth/params': () => ({ ok: false, status: 404, body: null }), '/v1/login': () => ok({ session: SESSION }) });
    const a = await signInWithPassphrase({ request: old.request, derive, passphrase: 'Kennebec' });
    expect(old.calls[1].body).toEqual({ passphrase: 'kennebec' });
    expect(a.derived).toBeNull();
    for (const status of [0, 503, 500]) {
      const r = rig({ '/v1/auth/params': () => ({ ok: false, status, body: null }), '/v1/login': () => ok({}) });
      const out = await signInWithPassphrase({ request: r.request, derive, passphrase: 'kennebec' });
      expect(out.res.status).toBe(status);
      expect(r.calls).toHaveLength(1);
    }
  });

  it('a held derived key signs in again with ONE request and no derivation; a stale one starts over', async () => {
    const held = { salt: P.salt, iter: 600000, authKey: 'held-key' };
    const spy = vi.fn(derive);
    const good = rig({ '/v1/login': () => ok({ session: SESSION }) });
    const again = await signInWithPassphrase({ request: good.request, derive: spy, derived: held });
    expect(again.derived).toBe(held);
    expect(good.calls).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();

    const stale = rig({
      '/v1/login': (b) => (b.authKey === 'held-key' ? { ok: false, status: 401, body: { reason: 'wrong' } } : ok({ session: SESSION })),
      '/v1/auth/params': () => ok(P),
    });
    const fresh = await signInWithPassphrase({ request: stale.request, derive: spy, derived: held, passphrase: 'new word' });
    expect(fresh.res.ok).toBe(true);
    expect(fresh.derived.authKey).toBe(`key:new word:${P.salt}:600000`);
    // with no passphrase to start over with, the 401 is the answer and the key is dropped
    const none = await signInWithPassphrase({ request: stale.request, derive: spy, derived: held });
    expect(none.res.status).toBe(401);
    expect(none.derived).toBeNull();
  });

  it('a derivation that throws is a refusal, not a crash', async () => {
    const r = rig({ '/v1/auth/params': () => ok(P), '/v1/login': () => ok({}) });
    const out = await signInWithPassphrase({ request: r.request, derive: async () => { throw new RangeError('x'); }, passphrase: 'kennebec' });
    expect(out.res.ok).toBe(false);
    expect(r.calls).toHaveLength(1);
  });

  it('parseLoginResponse passes the history key through', () => {
    const res = parseLoginResponse({ ok: true, status: 200, body: { session: SESSION, displayKey: KEY, history: { pub: 'p', kid: 'k', wrapped: {} } } });
    expect(res).toMatchObject({ ok: true, history: { pub: 'p' } });
    expect(parseLoginResponse({ ok: true, status: 200, body: { session: SESSION, displayKey: KEY } })).not.toHaveProperty('history');
  });
});
