import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

// The socket must follow the CONFIG STORE, not a private copy of it: saving
// the Pusher key in Settings, a ?key= URL flag, or a ?config= remote file all
// have to reach `new Pusher(...)` in the same tab, without a reload. Both of
// the setup-blocking bugs this pins shipped with every other test green.

let constructed = [];
const disconnect = vi.fn();

vi.mock('pusher-js', () => ({
  default: class FakePusher {
    constructor(key, opts) {
      constructed.push({ key, cluster: opts?.cluster });
      this.connection = { state: 'connected', bind: () => {}, unbind: () => {} };
    }
    subscribe() { return { bind: () => {}, unbind_all: () => {} }; }
    unsubscribe() {}
    disconnect() { disconnect(); }
    connect() {}
  },
}));

const { useSocket } = await import('./useSocket.js');
const cfg = await import('./useConfig.js');
const login = await import('../lib/displayLogin.js');

const atUrl = (search) => window.history.replaceState({}, '', `/${search}`);

beforeEach(() => {
  constructed = [];
  disconnect.mockReset();
  localStorage.clear();
  atUrl('');
  cfg._resetForTest();
  login._resetForTest();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); /* no global RTL cleanup in this repo — hooks share one config store */ atUrl(''); cfg._resetForTest(); vi.restoreAllMocks(); });

describe('useSocket follows the config store', () => {
  it('a key saved in Settings re-keys the socket in the same tab, no reload', () => {
    const socket = renderHook(() => useSocket({}));
    expect(constructed).toEqual([]);
    expect(socket.result.current.status).toBe('off');

    const settings = renderHook(() => cfg.useConfig());
    act(() => settings.result.current.updateConfig({ pusherAppKey: 'k1', pusherCluster: 'us2' }));
    expect(constructed).toEqual([{ key: 'k1', cluster: 'us2' }]);
    expect(socket.result.current.status).not.toBe('off');
  });

  it('the ?key= flag wins over the saved key', () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'stored', pusherCluster: 'us2' }));
    atUrl('?key=abc&cluster=eu');
    cfg._resetForTest();
    renderHook(() => useSocket({}));
    expect(constructed).toEqual([{ key: 'abc', cluster: 'eu' }]);
  });

  it('?key= without ?cluster= keeps the saved cluster', () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'stored', pusherCluster: 'ap1' }));
    atUrl('?key=abc');
    cfg._resetForTest();
    renderHook(() => useSocket({}));
    expect(constructed).toEqual([{ key: 'abc', cluster: 'ap1' }]);
  });

  it('a ?config= remote key reaches the socket, and a saved key still wins over it', () => {
    renderHook(() => useSocket({}));
    expect(constructed).toEqual([]);
    act(() => cfg.setRemoteDefaults({ pusherAppKey: 'remote', pusherCluster: 'us2' }));
    expect(constructed.map((c) => c.key)).toEqual(['remote']);
    act(() => cfg.updateConfig({ pusherAppKey: 'device' }));
    expect(constructed.map((c) => c.key)).toEqual(['remote', 'device']);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('resetConfig turns the socket back off', () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'stored', pusherCluster: 'us2' }));
    const socket = renderHook(() => useSocket({}));
    expect(constructed).toHaveLength(1);
    act(() => cfg.resetConfig());
    expect(socket.result.current.status).toBe('off');
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('a config change that does not touch the key does not reconnect', () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'stored', pusherCluster: 'us2' }));
    renderHook(() => useSocket({}));
    act(() => cfg.updateConfig({ audioMuted: true }));
    expect(constructed).toHaveLength(1);
    expect(disconnect).not.toHaveBeenCalled();
  });
});
