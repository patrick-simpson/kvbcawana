import { act, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changePassphrase, signIn, useSyncDriver, _resetSyncForTest } from './useSync.js';
import { dispatchEvent } from './useSocket.js';
import { _resetForTest as resetConfig, receiveSharedSettings, useConfig } from './useConfig.js';
import { loadSyncSession, saveSyncSession } from '../lib/syncService.js';

// Passphrase v2 on the screen (routes.md section 1): the passphrase is turned
// into an authKey in the browser and only that is sent; the same path serves a
// typed word and an OBS / ProPresenter ?passphrase= link (both call signIn).

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const STATE = { settings: null, slides: null, template: null, journey: null, calendar: null, kid: 'abcd1234' };
const PARAMS = { v: 2, salt: 'AAECAwQFBgcICQoLDA0ODw==', iter: 600000, legacy: true, upgrade: false };

function fakeService(overrides = {}) {
  const calls = [];
  const routes = { 'shared/sync.json': () => [200, { url: BASE }], '/v1/state': () => [200, STATE], ...overrides };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = Object.keys(routes).find((r) => String(url).endsWith(r));
    if (!route) return new Response('{}', { status: 404 });
    const [status, body] = routes[route](init);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

function Driver() {
  useSyncDriver({ handlers: { onSettings: receiveSharedSettings, onSlides: vi.fn() }, dispatch: dispatchEvent });
  return null;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  resetConfig();
  _resetSyncForTest();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('passphrase v2 on the screen', () => {
  it('signs in with the derived authKey only: the word never leaves the browser', async () => {
    const calls = fakeService({
      '/v1/auth/params': () => [200, PARAMS],
      '/v1/login': (init) => {
        const b = JSON.parse(init.body);
        return b.authKey && !b.passphrase ? [200, { session: SESSION, displayKey: KEY, state: STATE }] : [401, { reason: 'wrong' }];
      },
    });
    render(<Driver />);
    const { result } = renderHook(() => useConfig());
    let res;
    await act(async () => {
      res = await signIn('kennebec', { config: result.current.config, overrides: result.current.overrides, updateConfig: result.current.updateConfig });
    });
    expect(res).toMatchObject({ ok: true });
    const login = calls.find((c) => c.url.endsWith('/v1/login'));
    expect(JSON.parse(login.init.body)).toEqual({ authKey: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/) });
    expect(JSON.stringify(calls)).not.toContain('kennebec');
    expect(loadSyncSession()).toBe(SESSION);
  }, 30000);

  it('changing the passphrase sends the derived keys, never either word', async () => {
    let sent = null;
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService({
      '/v1/auth/params': () => [200, PARAMS],
      '/v1/history/key': () => [404, { reason: 'no-key' }],
      '/v1/passphrase': (init) => { sent = JSON.parse(init.body); return [200, { session: SESSION, displayKey: KEY, rotatedKey: true }]; },
    });
    const res = await changePassphrase('kennebec', 'moosehead lake');
    expect(res).toMatchObject({ ok: true });
    expect(sent.currentAuthKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(sent.current).toBeUndefined();
    expect(sent.next).toMatchObject({ iter: 600000 });
    expect(Buffer.from(sent.next.salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(sent.next.verifier, 'base64')).toHaveLength(32);
    expect(JSON.stringify(calls)).not.toMatch(/kennebec|moosehead/);
    expect(loadSyncSession()).toBe(SESSION);
  }, 30000);

  it('while the service has no verifier yet the change proves itself with the passphrase, once', async () => {
    let sent = null;
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({
      '/v1/auth/params': () => [200, { ...PARAMS, upgrade: true }],
      '/v1/history/key': () => [404, {}],
      '/v1/passphrase': (init) => { sent = JSON.parse(init.body); return [200, { session: SESSION, displayKey: KEY }]; },
    });
    expect(await changePassphrase('Kennebec', 'moosehead lake')).toMatchObject({ ok: true });
    expect(sent.current).toBe('kennebec');
    expect(sent.currentAuthKey).toBeUndefined();
  }, 30000);

  it('an old service (no params route) gets the old change request', async () => {
    let sent = null;
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({
      '/v1/history/key': () => [404, {}],
      '/v1/passphrase': (init) => { sent = JSON.parse(init.body); return [200, { session: SESSION, displayKey: KEY }]; },
    });
    expect(await changePassphrase('kennebec', 'moosehead lake')).toMatchObject({ ok: true });
    expect(sent).toEqual({ current: 'kennebec', next: 'moosehead lake' });
  });
});
