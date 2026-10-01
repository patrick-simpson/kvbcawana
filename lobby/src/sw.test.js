// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

// The service worker never runs under jsdom or Playwright, so its one
// judgement call — what may become the offline shell — is exercised here in a
// bare VM with fake caches/fetch. The build plugin's two placeholders are
// substituted the same way vite.config.js does.

function boot({ fetchImpl }) {
  const listeners = {};
  const put = [];
  const cache = {
    put: async (req, res) => { put.push({ req, res }); },
    match: async () => undefined,
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
