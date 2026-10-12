import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import {
  SYNC_URL_MAX,
  UNREACHABLE,
  buildLoginBody,
  buildRequest,
  isPlausibleDisplayKey,
  isValidSession,
  isValidSyncUrl,
  normalizeSyncPassphrase,
  parseLoginResponse,
  parseSessionCheck,
  parseSyncIndex,
  publishRequest,
  readResponse,
  screenNamePath,
  screenSettingsPath,
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
