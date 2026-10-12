import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';

// The sync Worker's live channel, useSocket's only transport (Pusher is retired).
// Signed in, a screen listens there, and every frame goes through the same
// per-event handler: decryption in front of dispatchEvent, the anti-downgrade
// refusal, the allowlist sanitizers. Not signed in, it listens to nothing.

/** @type {FakeSocket[]} */
let sockets = [];
class FakeSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    sockets.push(this);
  }
  send(data) { this.sent.push(data); }
  close(code = 1000) { this.closed = code; this.onclose?.({ code }); }
  /** test helpers */
  openNow() { this.onopen?.(); }
  frame(e, d) { this.onmessage?.({ data: JSON.stringify({ e, d }) }); }
}

const { useSocket } = await import('./useSocket.js');
const cfg = await import('./useConfig.js');
const sync = await import('./useSync.js');
const { saveSyncSession } = await import('../lib/syncService.js');
const { saveDisplayKey } = await import('../lib/displayKey.js');
const { sealForTest, fromBase64 } = await import('../lib/envelope.js');

const BASE = 'https://awana.kvbchurch.org/api';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
const KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';
const realFetch = globalThis.fetch;

function signedIn() {
  saveSyncSession(SESSION);
  sync._resetSyncForTest();
}

beforeEach(() => {
  sockets = [];
  localStorage.clear();
  cfg._resetForTest();
  globalThis.WebSocket = /** @type {any} */ (FakeSocket);
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).endsWith('shared/sync.json')) return new Response(JSON.stringify({ url: BASE }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the live channel is the only transport', () => {
  it('opens one socket to the service with the session once a screen is signed in', async () => {
    signedIn();
    const { result } = renderHook(() => useSocket({}));
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(sockets[0].url).toBe(`wss://awana.kvbchurch.org/api/v1/live?session=${encodeURIComponent(SESSION)}`);
    expect(result.current.status).toBe('connecting');
    act(() => sockets[0].openNow());
    expect(result.current.status).toBe('connected');
    expect(result.current.transport).toBe('live');
  });

  it('a screen that is not signed in listens to nothing, even with the old Pusher settings and flags', async () => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: 'testkey', pusherCluster: 'us2' }));
    window.history.replaceState({}, '', '/?key=abc&cluster=eu');
    cfg._resetForTest();
    sync._resetSyncForTest();
    try {
      const { result } = renderHook(() => useSocket({}));
      await new Promise((r) => setTimeout(r, 20));
      expect(sockets).toHaveLength(0);
      expect(result.current.status).toBe('off');
      expect(result.current.transport).toBe('off');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('frames reach the same sanitized handlers, sealed ones opened first', async () => {
    signedIn();
    saveDisplayKey(KEY);
    const onTally = vi.fn();
    const onCheckin = vi.fn();
    renderHook(() => useSocket({ onTally, onCheckin }));
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].openNow());
    act(() => sockets[0].frame('tally', { total: 12, counts: { Sparks: 12 }, at: '2026-10-07T23:30:00.000Z', allergyNotes: 'nope' }));
    expect(onTally).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onTally.mock.calls[0][0])).not.toContain('allergy');

    const sealed = await sealForTest(fromBase64(KEY), 'checkin', { id: 'c1', firstName: 'Noah', lastName: 'Secret', club: 'Sparks', at: '2026-10-07T23:31:00.000Z' });
    await act(async () => { sockets[0].frame('checkin', sealed); await new Promise((r) => setTimeout(r, 30)); });
    await waitFor(() => expect(onCheckin).toHaveBeenCalledTimes(1));
    expect(onCheckin.mock.calls[0][0].firstName).toBe('Noah');
    expect(JSON.stringify(onCheckin.mock.calls[0][0])).not.toContain('Secret');
  });

  it('a plaintext name on the live channel is refused once the screen holds a key', async () => {
    signedIn();
    saveDisplayKey(KEY);
    const onCheckin = vi.fn();
    const { result } = renderHook(() => useSocket({ onCheckin }));
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].openNow());
    act(() => sockets[0].frame('checkin', { id: 'c1', firstName: 'Noah', club: 'Sparks' }));
    expect(onCheckin).not.toHaveBeenCalled();
    expect(result.current.nameStatus).toBe('downgraded');
  });

  it('unknown events and junk are ignored; the doorbell goes to the sync store', async () => {
    signedIn();
    const rang = vi.fn();
    const off = sync.onSyncDoorbell(rang);
    renderHook(() => useSocket({}));
    await waitFor(() => expect(sockets).toHaveLength(1));
    act(() => sockets[0].openNow());
    act(() => {
      sockets[0].onmessage({ data: 'pong' });
      sockets[0].onmessage({ data: 'not json' });
      sockets[0].frame('provision', {});
      sockets[0].frame('__proto__', {});
      sockets[0].frame('changed', { what: 'calendar' });
    });
    expect(rang).toHaveBeenCalledWith('calendar', { what: 'calendar' });
    off();
  });

  it('keeps the line alive, and reconnects with a backoff it announces', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    try {
      signedIn();
      const { result } = renderHook(() => useSocket({}));
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].openNow());
      act(() => { vi.advanceTimersByTime(25000); });
      expect(sockets[0].sent).toContain('ping');
      act(() => sockets[0].close(1006));
      expect(result.current.status).toBe('disconnected');
      expect(result.current.retry).toEqual({ attempts: 1, delaySec: 1 });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sockets).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a socket that falls silent, even one the browser still calls open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
    try {
      signedIn();
      const { result } = renderHook(() => useSocket({}));
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      act(() => sockets[0].openNow());
      // Pongs keep it alive for as long as they come.
      act(() => { vi.advanceTimersByTime(25000); sockets[0].onmessage({ data: 'pong' }); });
      act(() => { vi.advanceTimersByTime(25000); sockets[0].onmessage({ data: 'pong' }); });
      act(() => { vi.advanceTimersByTime(25000); });
      expect(sockets[0].sent.filter((s) => s === 'pong' || s === 'ping')).toHaveLength(3);
      expect(sockets).toHaveLength(1);
      expect(result.current.status).toBe('connected');
      // Then the Wi-Fi roams: nothing comes back. Two ping periods and a margin later it is dropped.
      act(() => { vi.advanceTimersByTime(25000); });
      act(() => { vi.advanceTimersByTime(25000); });
      expect(sockets[0].closed).toBe(4000);
      expect(result.current.status).toBe('disconnected');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sockets).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops a socket that never opens, instead of waiting on the browser', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
    try {
      signedIn();
      const { result } = renderHook(() => useSocket({}));
      await vi.waitFor(() => expect(sockets).toHaveLength(1));
      expect(result.current.status).toBe('connecting');
      act(() => { vi.advanceTimersByTime(10000); });
      expect(sockets[0].closed).toBe(4000);
      expect(result.current.status).toBe('disconnected');
      act(() => { vi.advanceTimersByTime(1000); });
      expect(sockets).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
