import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { timedFetch } from './timedFetch.js';
import { FETCH_TIMEOUT_MS } from './constants.js';

describe('timedFetch', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('passes the request through, with a signal added', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchImpl);
    const res = await timedFetch('https://x.test/a.json', { cache: 'no-store' });
    expect(await res.text()).toBe('ok');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://x.test/a.json');
    expect(fetchImpl.mock.calls[0][1].cache).toBe('no-store');
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts a request that hangs past the deadline', async () => {
    vi.stubGlobal('fetch', vi.fn((_, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    })));
    const p = timedFetch('https://x.test/hang', {}, 1000);
    const settled = p.then(() => 'resolved', (e) => e);
    vi.advanceTimersByTime(999);
    vi.advanceTimersByTime(2);
    const err = await settled;
    expect(err).not.toBe('resolved');
    expect(err.name).toBe('TimeoutError');
  });

  it('the default deadline is FETCH_TIMEOUT_MS, and a caller\'s own signal is left alone', async () => {
    expect(FETCH_TIMEOUT_MS).toBe(15_000);
    const own = new AbortController();
    const fetchImpl = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchImpl);
    await timedFetch('https://x.test/b', { signal: own.signal });
    expect(fetchImpl.mock.calls[0][1].signal).toBe(own.signal);
  });
});
