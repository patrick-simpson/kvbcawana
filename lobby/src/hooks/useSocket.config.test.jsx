import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';

// The socket must follow the SIGN-IN, not a private copy of it: signing out in
// Settings has to close the live socket in the same tab, without a reload. Pusher's key and cluster settings are retired; a screen
// that still carries them, or a link that still has ?key= and ?cluster=, just
// ignores them.

import { fakeLive } from '../lib/__fixtures__/fakeLive.js';

const live = fakeLive();
const { useSocket } = await import('./useSocket.js');
const cfg = await import('./useConfig.js');
const sync = await import('./useSync.js');

const atUrl = (search) => window.history.replaceState({}, '', `/${search}`);

beforeEach(() => {
  live.reset();
  localStorage.clear();
  atUrl('');
  cfg._resetForTest();
  sync._resetSyncForTest();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { cleanup(); /* no global RTL cleanup in this repo — hooks share one config store */ atUrl(''); cfg._resetForTest(); vi.restoreAllMocks(); });

describe('useSocket follows the sign-in', () => {
  it('a signed-in screen opens the socket, and signing out closes it in the same tab', async () => {
    live.signIn();
    const socket = renderHook(() => useSocket({}));
    await waitFor(() => expect(live.sockets).toHaveLength(1));
    await waitFor(() => expect(socket.result.current.status).toBe('connected'));

    act(() => sync.signOut());
    await waitFor(() => expect(live.sockets[0].closed).toBe(1000));
    expect(socket.result.current.status).toBe('off');
  });

  it('a saved Pusher key, ?key= and ?cluster= open nothing', async () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'stored', pusherCluster: 'us2' }));
    atUrl('?key=abc&cluster=eu');
    cfg._resetForTest();
    const socket = renderHook(() => useSocket({}));
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(live.sockets).toHaveLength(0);
    expect(socket.result.current.status).toBe('off');
  });

  it('a config change that is not the sign-in does not reconnect', async () => {
    live.signIn();
    renderHook(() => useSocket({}));
    await waitFor(() => expect(live.sockets).toHaveLength(1));
    act(() => cfg.updateConfig({ audioMuted: true }));
    act(() => cfg.setRemoteDefaults({ showClock: false }));
    expect(live.sockets).toHaveLength(1);
    expect(live.sockets[0].closed).toBeNull();
  });
});
