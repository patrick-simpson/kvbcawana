import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSync, useSyncDriver, ringSyncDoorbell, signIn, syncNow, _resetSyncForTest } from './useSync.js';
import { dispatchEvent } from './useSocket.js';
import { _resetForTest as resetConfig, receiveSharedSettings, useConfig } from './useConfig.js';
import { loadSyncSession, saveSyncSession } from '../lib/syncService.js';
import { SyncSignInField } from '../components/settings/fields.jsx';
import { useCalendar } from './useCalendar.js';

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const STATE = {
  settings: { rev: 7, publishedAt: '2026-10-01T18:00:00.000Z', settings: { checkoutBoardMode: 'pickup' } },
  slides: { deckRev: 3, publishedAt: '2026-10-01T18:00:00.000Z', slides: [{ text: 'Store next week', eyebrow: '', theme: 'auto', textSize: 'auto', durationSec: 0 }] },
  template: { savedAt: '2026-10-01T17:00:00.000Z', config: { audioMuted: true } },
  journey: null,
  calendar: null,
  kid: 'abcd1234',
};

/** A fake sync service: routes by path, records calls. */
function fakeService(overrides = {}) {
  const calls = [];
  const routes = {
    'shared/sync.json': () => [200, { url: BASE }],
    '/v1/login': (init) => (JSON.parse(init.body).passphrase === 'kennebec'
      ? [200, { session: SESSION, displayKey: KEY, pusher: { key: 'pk', cluster: 'us2' }, state: STATE }]
      : [401, { reason: 'wrong', triesLeft: 4 }]),
    '/v1/state': () => [200, STATE],
    ...overrides,
  };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const route = Object.keys(routes).find((r) => String(url).endsWith(r));
    if (!route) return new Response('{}', { status: 404 });
    const [status, body] = routes[route](init);
    return new Response(JSON.stringify(body), { status });
  });
  return calls;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  resetConfig();
  _resetSyncForTest();
});
afterEach(() => { globalThis.fetch = realFetch; });

function Driver({ onSlides }) {
  const handlers = { onSettings: receiveSharedSettings, onSlides };
  useSyncDriver({ handlers, dispatch: dispatchEvent });
  return null;
}

describe('signing in with the passphrase', () => {
  it('"kennebec" applies the Pusher keys, the template and the shared settings', async () => {
    fakeService();
    const onSlides = vi.fn();
    render(<Driver onSlides={onSlides} />);
    const { result } = renderHook(() => useConfig());
    let res;
    await act(async () => {
      res = await signIn('kennebec', { config: result.current.config, overrides: result.current.overrides, updateConfig: result.current.updateConfig });
    });
    expect(res).toMatchObject({ ok: true });
    expect(loadSyncSession()).toBe(SESSION);
    expect(result.current.config.pusherAppKey).toBe('pk');
    expect(result.current.config.audioMuted).toBe(true);
    // Through the same sanitizers a Pusher frame takes.
    expect(result.current.shared).toMatchObject({ rev: 7, settings: { checkoutBoardMode: 'pickup' } });
    expect(result.current.config.checkoutBoardMode).toBe('pickup');
    expect(onSlides).toHaveBeenCalledWith(expect.objectContaining({ deckRev: 3, slides: [expect.objectContaining({ text: 'Store next week' })] }), undefined);
  });

  it('the template never overrides what this screen already chose', async () => {
    fakeService();
    render(<Driver onSlides={vi.fn()} />);
    const { result } = renderHook(() => useConfig());
    act(() => { result.current.updateConfig({ audioMuted: false }); });
    await act(async () => {
      await signIn('kennebec', { config: result.current.config, overrides: result.current.overrides, updateConfig: result.current.updateConfig });
    });
    expect(result.current.config.audioMuted).toBe(false);
  });
});

describe('staying in sync', () => {
  it('a signed-in screen fetches the state when it starts', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService();
    render(<Driver onSlides={vi.fn()} />);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(result.current.shared?.rev).toBe(7));
    const state = calls.find((c) => c.url.endsWith('/v1/state'));
    expect(state.init.headers.Authorization).toBe(`Bearer ${SESSION}`);
  });

  it('a 401 means the passphrase changed: the session goes and the screen says so', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({ '/v1/state': () => [401, { reason: 'signed-out' }] });
    const { result } = renderHook(() => useSync());
    render(<Driver onSlides={vi.fn()} />);
    await waitFor(() => expect(result.current.phase).toBe('expired'));
    expect(result.current.signedIn).toBe(false);
    expect(loadSyncSession()).toBe('');
  });

  it('the template doorbell refetches; an unknown one does nothing', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService();
    render(<Driver onSlides={vi.fn()} />);
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/v1/state'))).toHaveLength(1));
    await act(async () => { ringSyncDoorbell({ what: 'nonsense' }); ringSyncDoorbell('junk'); });
    expect(calls.filter((c) => c.url.endsWith('/v1/state'))).toHaveLength(1);
    await act(async () => { ringSyncDoorbell({ what: 'template' }); await syncNow(); });
    expect(calls.filter((c) => c.url.endsWith('/v1/state')).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the passphrase box', () => {
  it('signs in, and says how many tries are left after a wrong word', async () => {
    fakeService();
    render(<><Driver onSlides={vi.fn()} /><SyncSignInField secure /></>);
    const box = screen.getByLabelText('Passphrase');
    fireEvent.change(box, { target: { value: 'kenebec' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(await screen.findByText(/4 tries left/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'Kennebec' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in' })); });
    expect(await screen.findByText(/signed in · key abcd1234/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});

describe('the calendar from the sync service', () => {
  const FEED = {
    version: 1,
    generatedAt: new Date().toISOString(),
    checkedAt: new Date().toISOString(),
    events: [{ date: '2026-10-07', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false }],
  };

  it('comes first, and Refresh signed in asks the service to read the church page', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    const calls = fakeService({
      '/v1/calendar': () => [200, FEED],
      '/v1/calendar/refresh': () => [200, { changed: true, generatedAt: FEED.generatedAt, checkedAt: FEED.checkedAt }],
    });
    const { result } = renderHook(() => useCalendar({ calendarEnabled: true, calendarUrl: '' }));
    await waitFor(() => expect(result.current.source).toBe('sync'));
    expect(result.current.events).toHaveLength(1);
    let out;
    await act(async () => { out = await result.current.refresh(); });
    expect(out).toMatchObject({ ok: true, changed: true, viaSync: true, source: 'sync' });
    expect(calls.some((c) => c.url.endsWith('/v1/calendar/refresh') && c.init.method === 'POST')).toBe(true);
  });

  it('Refresh says what went wrong instead of doing nothing', async () => {
    saveSyncSession(SESSION);
    _resetSyncForTest();
    fakeService({
      '/v1/calendar': () => [200, FEED],
      '/v1/calendar/refresh': () => [502, { error: 'Only 2 club nights were found.' }],
    });
    const { result } = renderHook(() => useCalendar({ calendarEnabled: true, calendarUrl: '' }));
    await waitFor(() => expect(result.current.source).toBe('sync'));
    let out;
    await act(async () => { out = await result.current.refresh(); });
    expect(out).toMatchObject({ ok: false, message: 'Only 2 club nights were found.' });
  });
});
