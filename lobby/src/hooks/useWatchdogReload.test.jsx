import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWatchdogReload } from './useWatchdogReload.js';

// The kiosk self-heal: a screen whose realtime pipe has not been connected
// for the configured minutes reloads once (capped per hour). It judges "not
// connected", not "disconnected": both transports pass through 'connecting'
// on every retry, and a screen that could never connect used to reset its
// stamp on each attempt and never reload.

let reloads = 0;
beforeEach(() => {
  reloads = 0;
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] });
  Object.defineProperty(window, 'location', { value: { reload: () => { reloads += 1; } }, writable: true, configurable: true });
});
afterEach(() => { vi.useRealTimers(); });

const minutes = (n) => vi.advanceTimersByTime(n * 60 * 1000);

describe('useWatchdogReload', () => {
  it('reloads once the pipe has been down for the configured minutes', () => {
    const { rerender } = renderHook(({ status }) => useWatchdogReload(status, 30), { initialProps: { status: 'connected' } });
    rerender({ status: 'disconnected' });
    minutes(29);
    expect(reloads).toBe(0);
    minutes(2);
    expect(reloads).toBe(1);
  });

  it('a pipe that keeps retrying (connecting, disconnected, connecting…) still counts as down the whole time', () => {
    const { rerender } = renderHook(({ status }) => useWatchdogReload(status, 30), { initialProps: { status: 'connecting' } });
    for (let i = 0; i < 15; i++) {
      rerender({ status: 'disconnected' });
      minutes(1);
      rerender({ status: 'connecting' });
      minutes(1);
    }
    minutes(2);
    expect(reloads).toBe(1);
  });

  it('a connection clears the clock', () => {
    const { rerender } = renderHook(({ status }) => useWatchdogReload(status, 30), { initialProps: { status: 'disconnected' } });
    minutes(20);
    rerender({ status: 'connected' });
    minutes(20);
    expect(reloads).toBe(0);
    rerender({ status: 'disconnected' });
    minutes(31);
    expect(reloads).toBe(1);
  });

  it('a screen with nothing configured (off) is never reloaded, and 0 minutes disables it', () => {
    renderHook(() => useWatchdogReload('off', 30));
    minutes(90);
    expect(reloads).toBe(0);
    renderHook(() => useWatchdogReload('disconnected', 0));
    minutes(90);
    expect(reloads).toBe(0);
  });

  it('never more than the hourly cap', () => {
    renderHook(() => useWatchdogReload('disconnected', 1));
    minutes(60);
    expect(reloads).toBe(2);
  });
});
