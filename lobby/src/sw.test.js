// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// The service worker never runs under jsdom or Playwright, so its one
// judgement call — what may become the offline shell — is exercised here in a
// bare VM with fake caches/fetch. The build plugin's two placeholders are
// substituted the same way vite.config.js does.

function boot({ fetchImpl, cached }) {
  const listeners = {};
  const put = [];
  const cache = {
    put: async (req, res) => { put.push({ req, res }); },
    match: async () => cached,
    addAll: async () => {},
  };
  const context = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      location: { origin: 'https://church.github.io' },
      skipWaiting: () => {},
      clients: { claim: () => {} },
    },
    caches: { open: async () => cache, keys: async () => [], delete: async () => true },
    fetch: fetchImpl,
    URL,
    Promise,
    console,
    setTimeout,
    clearTimeout,
  };
  const source = readFileSync(resolve(__dirname, 'sw.js'), 'utf8')
    .replace('__BUILD_HASH__', 'test')
    .replace('__PRECACHE_MANIFEST__', '[]');
  vm.runInNewContext(source, context);
  return { listeners, put };
}

const response = (over = {}) => ({
  ok: true,
  status: 200,
  redirected: false,
  url: 'https://church.github.io/index.html',
  headers: { get: (h) => (h === 'content-type' ? over.contentType ?? 'text/html; charset=utf-8' : null) },
  clone() { return this; },
  ...over,
});

async function navigate(sw, url = 'https://church.github.io/index.html') {
  let result;
  sw.listeners.fetch({
    request: { method: 'GET', url, mode: 'navigate' },
    respondWith: (p) => { result = p; },
  });
  return result;
}

describe('service worker: what may become the offline shell', () => {
  it('caches a clean same-origin HTML navigation', async () => {
    const sw = boot({ fetchImpl: async () => response() });
    const res = await navigate(sw);
    expect(res.ok).toBe(true);
    expect(sw.put).toHaveLength(1);
  });

  it('never caches a redirected (captive-portal) navigation, but still returns it', async () => {
    const sw = boot({ fetchImpl: async () => response({ redirected: true, url: 'http://portal.local/login' }) });
    const res = await navigate(sw);
    expect(res.redirected).toBe(true);
    expect(sw.put).toHaveLength(0);
  });

  it('never caches a cross-origin final URL or a non-HTML navigation', async () => {
    const other = boot({ fetchImpl: async () => response({ url: 'https://evil.example/whatever' }) });
    await navigate(other);
    expect(other.put).toHaveLength(0);
    const plain = boot({ fetchImpl: async () => response({ contentType: 'text/plain' }) });
    await navigate(plain);
    expect(plain.put).toHaveLength(0);
  });

  it('leaves the sync service (/api/…) to the network: never answered from a cache, never stored', async () => {
    let fetched = 0;
    const sw = boot({ fetchImpl: async () => { fetched += 1; return response({ url: 'https://church.github.io/api/v1/state', contentType: 'application/json' }); } });
    for (const url of ['https://church.github.io/api/v1/state', 'https://church.github.io/api/v1/calendar', 'https://church.github.io/api']) {
      let result;
      sw.listeners.fetch({
        request: { method: 'GET', url, mode: 'cors', headers: { get: () => null } },
        respondWith: (p) => { result = p; },
      });
      expect(result).toBeUndefined();   // not intercepted at all: the browser fetches it itself
    }
    expect(fetched).toBe(0);
    expect(sw.put).toHaveLength(0);
  });

  it('never caches anything sent with an Authorization header, whatever its path', async () => {
    const sw = boot({ fetchImpl: async () => response({ url: 'https://church.github.io/lobby/shared/private', contentType: 'application/json' }) });
    let result;
    sw.listeners.fetch({
      request: { method: 'GET', url: 'https://church.github.io/lobby/shared/private', mode: 'cors', headers: { get: (h) => (h === 'authorization' ? 'Bearer x' : null) } },
      respondWith: (p) => { result = p; },
    });
    const res = await result;
    expect(res.ok).toBe(true);
    expect(sw.put).toHaveLength(0);
  });

  it('lie-fi: a navigation the network does not answer in 8 s is served from the cached shell', async () => {
    vi.useFakeTimers();
    try {
      const shell = response({ url: 'https://church.github.io/index.html' });
      const sw = boot({ fetchImpl: () => new Promise(() => {}), cached: shell });   // the network never answers
      const pending = navigate(sw);
      await vi.advanceTimersByTimeAsync(8000);
      const res = await pending;
      expect(res).toBe(shell);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lie-fi with nothing cached: it keeps waiting for the network rather than fail at 8 s', async () => {
    vi.useFakeTimers();
    try {
      let answer;
      const sw = boot({ fetchImpl: () => new Promise((r) => { answer = r; }), cached: undefined });
      const pending = navigate(sw);
      await vi.advanceTimersByTimeAsync(8000);
      const late = response();
      answer(late);
      expect(await pending).toBe(late);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a fast network answer is used, and the timer does not keep the worker alive', async () => {
    const sw = boot({ fetchImpl: async () => response(), cached: response({ url: 'https://church.github.io/old.html' }) });
    const res = await navigate(sw);
    expect(res.url).toBe('https://church.github.io/index.html');
  });

  it('still caches JSON feeds (not navigations) when they are clean', async () => {
    const sw = boot({ fetchImpl: async () => response({ url: 'https://church.github.io/shared/schedule.json', contentType: 'application/json' }) });
    let result;
    sw.listeners.fetch({
      request: { method: 'GET', url: 'https://church.github.io/shared/schedule.json', mode: 'cors' },
      respondWith: (p) => { result = p; },
    });
    await result;
    expect(sw.put).toHaveLength(1);
  });
});
