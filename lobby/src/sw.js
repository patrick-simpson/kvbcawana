// Offline shell for both display pages. Emitted at build time by the
// serviceWorker() plugin in vite.config.js, which replaces the two
// placeholder tokens below with the real build hash + precache list —
// the cache name is versioned by build content, so a deploy invalidates
// every old cache on activate and stale JS can never outlive a reload.
//
// Routing rules (same-origin GET only; Pusher/Open-Meteo/etc. pass
// through untouched):
//   · JSON (schedule/theme/calendar feeds)  → network-first, cache
//     fallback — fresh data when online, last-known-good in a blip.
//     Checked BEFORE the generic asset rule so the schedule can never
//     freeze inside a cache.
//   · HTML navigations                      → network-first, cache
//     fallback — fresh HTML always references the new hashed assets.
//   · Everything else (hashed assets, fonts,
//     shared/art/*)                         → cache-first, backfilled
//     from the network on first touch.
//   · Nothing is cached unless it is a clean same-origin answer — and for
//     a navigation, an HTML one (see cacheable): a captive portal that
//     answers the watchdog's reload with a redirected 200 must never
//     become the offline shell.
//   · The self-update poller's own probes (version.json, and the
//     freshness check on the page's own HTML, both marked with the
//     query below) are passed straight through to the network: a cached
//     answer would pin the screen to the build it already has, forever.
//     See src/lib/buildReload.js, whose BUILD_PROBE_PARAM this mirrors.

const VERSION = '__BUILD_HASH__';
const PRECACHE = __PRECACHE_MANIFEST__;

const CACHE_NAME = `awana-v${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Only a clean, same-origin answer may be cached — and for a navigation only
// an HTML one. A captive portal answers the watchdog's reload with a 200
// (usually via redirect); cached under the app's own URL it would BECOME the
// offline shell on every later boot until someone cleared site data.
function cacheable(request, response) {
  if (!response.ok || response.redirected) return false;
  if (response.url && new URL(response.url).origin !== self.location.origin) return false;
  if (request.mode === 'navigate') return (response.headers.get('content-type') || '').includes('text/html');
  return true;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request);
    if (cacheable(request, fresh)) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (cacheable(request, fresh)) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Network-only, not even network-first: the deploy heartbeat and the HTML
  // freshness probe are the two questions a cache must never answer.
  if (url.searchParams.has('awanaBuild') || url.pathname.endsWith('/version.json')) return;

  if (request.mode === 'navigate' || url.pathname.endsWith('.json')) {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});
