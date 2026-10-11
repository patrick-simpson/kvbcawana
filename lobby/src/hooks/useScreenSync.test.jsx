import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetThisScreenForTest, useScreenSync, useThisScreen, renameThisScreen } from './useScreenSync.js';
import { _resetSyncForTest, ringSyncDoorbell } from './useSync.js';
import { _resetForTest as resetConfig, useConfig } from './useConfig.js';
import { saveSyncSession } from '../lib/syncService.js';
import { liveScreenId, loadScreenSlot } from '../lib/screenSync.js';

// A lobby TV managed from /settings: it registers, follows its own settings
// in the Worker as its device layer, sends a change made on it up, and does
// what /settings asks, all for its own id only.

const BASE = 'https://awana-sync.example.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

/** A stand-in Worker holding one screen's settings. */
function fakeWorker({ registry = true } = {}) {
  const calls = [];
  const state = { settings: null, name: 'Lobby TV', n: 0 };
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: u, method: init.method || 'GET', body });
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (u.endsWith('shared/sync.json')) return ok({ url: BASE });
    if (!registry) return new Response('{}', { status: 404 });
    if (u.endsWith('/v1/screens/hello')) return ok({ screen: { id: body.id, name: state.name }, settings: state.settings });
    const m = /\/v1\/screens\/([^/]+)\/(settings|name)$/.exec(u);
    if (m && m[2] === 'settings' && init.method === 'PUT') {
      state.n += 1;
      state.settings = { savedAt: `2026-10-11T18:00:0${state.n}.000Z`, settings: body.settings };
      return ok({ ...state.settings, dropped: [] });
    }
    if (m && m[2] === 'settings') return ok({ screen: { id: m[1], name: state.name }, settings: state.settings });
    if (m && m[2] === 'name') { state.name = body.name; return ok({ screen: { id: m[1], name: body.name } }); }
    return new Response('{}', { status: 404 });
  });
  return { calls, state };
}

function Tv({ enabled = true, onAction }) {
  const { overrides, replaceConfig } = useConfig();
  useScreenSync({ kind: 'lobby', enabled, overrides, replaceConfig, onAction, defaultName: 'Lobby TV' });
  return null;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('awanaConfig.v1', JSON.stringify({ audioMuted: true, panicMode: true }));
  saveSyncSession(SESSION);
  resetConfig();
  _resetSyncForTest();
  _resetThisScreenForTest();
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const helloOf = (calls) => calls.filter((c) => c.url.endsWith('/v1/screens/hello'));
const putsOf = (calls) => calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/settings'));

describe('a lobby TV managed from /settings', () => {
  it('says hello with a kept id and sends its own part up the first time', async () => {
    const w = fakeWorker();
    render(<Tv />);
    await waitFor(() => expect(putsOf(w.calls)).toHaveLength(1));
    const [hello] = helloOf(w.calls);
    expect(hello.body).toEqual({ id: loadScreenSlot('lobby').id, kind: 'lobby', name: 'Lobby TV' });
    // Panic mode never leaves the TV.
    expect(putsOf(w.calls)[0].body).toEqual({ settings: { audioMuted: true } });
    expect(liveScreenId()).toBe(hello.body.id);
    await waitFor(() => expect(loadScreenSlot('lobby').synced).toMatchObject({ settings: { audioMuted: true } }));
  });

  it('a change on /settings reaches the device layer on the doorbell, leaving the rest alone', async () => {
    const w = fakeWorker();
    render(<Tv />);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(loadScreenSlot('lobby')?.synced).toBeTruthy());
    const id = loadScreenSlot('lobby').id;
    w.state.settings = { savedAt: '2026-10-11T19:00:00.000Z', settings: { audioMuted: false, confettiLevel: 'off', pusherAppKey: 'evil' } };
    await act(async () => { ringSyncDoorbell({ what: 'screen', id: 'someone-else-0000000' }); });
    expect(result.current.overrides.audioMuted).toBe(true);
    await act(async () => { ringSyncDoorbell({ what: 'screen', id }); });
    await waitFor(() => expect(result.current.overrides).toEqual({ panicMode: true, audioMuted: false, confettiLevel: 'off' }));
    // Applying it is not a change to send back.
    await new Promise((r) => { setTimeout(r, 1700); });
    expect(putsOf(w.calls)).toHaveLength(1);
  });

  it('a change made on the TV goes up a moment later', async () => {
    const w = fakeWorker();
    render(<Tv />);
    const { result } = renderHook(() => useConfig());
    await waitFor(() => expect(loadScreenSlot('lobby')?.synced).toBeTruthy());
    act(() => { result.current.updateConfig({ reduceMotion: true }); });
    await waitFor(() => expect(putsOf(w.calls)).toHaveLength(2), { timeout: 3000 });
    expect(putsOf(w.calls)[1].body.settings).toEqual({ audioMuted: true, reduceMotion: true });
  });

  it('does what /settings asks, for its own id and its allowlist only', async () => {
    fakeWorker();
    const onAction = vi.fn();
    render(<Tv onAction={onAction} />);
    await waitFor(() => expect(loadScreenSlot('lobby')?.synced).toBeTruthy());
    const id = loadScreenSlot('lobby').id;
    act(() => {
      ringSyncDoorbell({ what: 'screen-action', id: 'someone-else-0000000', action: 'reset-tally' });
      ringSyncDoorbell({ what: 'screen-action', id, action: 'media-changed' });
      ringSyncDoorbell({ what: 'screen-action', id, action: 'preview-checkin', data: { firstName: 'Smuggled' } });
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('preview-checkin', undefined);
  });

  it('is renamed from Settings → Setup, and keeps the name', async () => {
    const w = fakeWorker();
    render(<Tv />);
    const { result } = renderHook(() => useThisScreen());
    await waitFor(() => expect(result.current.registered).toBe(true));
    let res;
    await act(async () => { res = await renameThisScreen('  Front door  '); });
    expect(res).toEqual({ ok: true, name: 'Front door' });
    expect(result.current.name).toBe('Front door');
    expect(w.state.name).toBe('Front door');
    expect(loadScreenSlot('lobby').name).toBe('Front door');
  });

  it('nothing at all when not enabled (configure mode, embedded) or not signed in', async () => {
    const w = fakeWorker();
    render(<Tv enabled={false} />);
    await new Promise((r) => { setTimeout(r, 50); });
    expect(helloOf(w.calls)).toHaveLength(0);
    expect(loadScreenSlot('lobby')).toBeNull();
  });

  it('a Worker without the registry is asked once, then left alone', async () => {
    const w = fakeWorker({ registry: false });
    render(<Tv />);
    await waitFor(() => expect(helloOf(w.calls)).toHaveLength(1));
    await new Promise((r) => { setTimeout(r, 50); });
    expect(putsOf(w.calls)).toHaveLength(0);
  });
});
