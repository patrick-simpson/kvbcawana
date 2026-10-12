/* ── Stream first, play the cached copy only when streaming cannot ────
   The Pi plays a picker video streamed over plain HTTP smoothly, and
   stutters badly on the SAME encode served to the <video> element as a blob
   URL out of the Cache API (owner report, 2026-09-16, from the live kiosk;
   both files verified as identical encodes, 854x480 Baseline 3.1, 23.976
   fps, same frame count). The blob path is the only variable, so a device
   with a working connection now streams, exactly the way the picker always
   has, and the cache goes back to being what it is good at: the safety net
   for an evening with no internet.

   Nothing about cacheLessonBundle() changes. The bundle is still
   pre-downloaded, still store-before-evict, and is still what plays when
   the probe below says the network cannot answer. */
const STREAM_PROBE_MS = 2500;
const STREAM_STALL_SWAP_MS = 8000;

/* Set by resolveVideoSrc when it chose to stream a file that IS also in the
   cache: { key, src }. That is everything the stall swap needs, and matching
   on the src the element actually carries means a swap can never land on a
   video the operator has since replaced. Cleared on teardown and by the swap
   itself, so it happens at most once per playback. */
let streamSwapCandidate = null;
let streamStallTimer = null;

/* Is the live file fetchable right now? One bounded HEAD, whose answer picks
   between streaming (smooth) and the cached blob (the safety net). This does
   not break acknowledge-first: the Journey view, the splash teardown and the
   loading overlay are all already on screen before any caller awaits it. */
async function videoUrlReachable(url) {
  if (!url) return false;
  if (navigator.onLine === false) return false;
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, STREAM_PROBE_MS);
    return !!res && res.ok;
  } catch {
    return false;
  }
}

/* The cache hit as a playable blob URL, with the object-URL lifetime rules
   this page has always kept: the token is re-checked after the (slow, ~17MB)
   read, and the previous object URL is revoked only once its replacement is
   in hand. Returns null when a newer request has taken over. */
async function blobUrlFromCacheHit(cached, token) {
  const blob = await cached.blob();
  if (token !== undefined && token !== journeyRequestToken) return null;
  const blobUrl = URL.createObjectURL(blob);
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = blobUrl;
  return blobUrl;
}

/* Resolves what the <video> element should play: the live URL when the
   network can serve it, the cached copy as a blob URL otherwise. `token` is
   the caller's journeyRequestToken snapshot. If a teardown or newer request
   has bumped the token while the probe or the cache read was in flight, this
   returns null WITHOUT committing anything, so a stale resolve can neither
   clobber currentObjectUrl nor strand a multi-megabyte blob URL that nothing
   will ever revoke (on a 512MB Pi that leak would sit resident until the
   next show). Callers must bail on null. */
async function resolveVideoSrc(lesson, token) {
  // Which quality this device plays, decided once here so the cache lookup
  // and the live URL can never disagree about it.
  const profile = effectiveProfile();
  const liveUrl = profile === 'full' ? originalVideoUrl(lesson) : lesson.downloadUrl;
  const cacheKey = videoCacheKey(lesson, profile);
  streamSwapCandidate = null;
  if ('caches' in window) {
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      // Migration fallback: kiosks that cached this week's video before the
      // key was versioned hold it under the bare downloadUrl. That copy can
      // only be a same-URL fetch (at worst exactly the staleness the old code
      // always had), so it is strictly better than falling through to the
      // network on a dead evening connection. The bundle prefetch stores
      // under the versioned key and then evicts the legacy entry, so this
      // heals itself after one online refresh. Low profile only: on full that
      // bare key holds the 480p copy, which is the other quality's bytes.
      let key = cacheKey;
      let cached = cacheKey ? await cache.match(cacheKey) : null;
      if (!cached && profile === 'low') {
        key = lesson.downloadUrl;
        cached = await cache.match(key);
      }
      if (cached) {
        // There are bytes on disk, so this is the one decision worth a probe:
        // stream them from the server if it can answer, and keep the disk
        // copy in reserve for the stall swap below.
        if (await videoUrlReachable(liveUrl)) {
          if (token !== undefined && token !== journeyRequestToken) return null;
          streamSwapCandidate = { key, src: liveUrl };
          return liveUrl;
        }
        const blobUrl = await blobUrlFromCacheHit(cached, token);
        if (!blobUrl) return null;
        return blobUrl;
      }
    } catch {
      // fall through to the live URL
    }
  }
  if (token !== undefined && token !== journeyRequestToken) return null;
  return liveUrl;
}

/* The safety net, armed: a streamed video that has been stalled for
   STREAM_STALL_SWAP_MS with the same bytes sitting in the cache swaps to
   them once and carries on from where the room got to. Not near the end,
   where the existing end-of-lesson handoff owns the stall; not at all when
   there is no cached copy, which is every picker video and any evening the
   bundle never landed. */
function clearStreamStallSwap() {
  clearTimeout(streamStallTimer);
  streamStallTimer = null;
}

function armStreamStallSwap() {
  if (!streamSwapCandidate || streamStallTimer) return;
  streamStallTimer = setTimeout(swapToCachedCopy, STREAM_STALL_SWAP_MS);
}

async function swapToCachedCopy() {
  streamStallTimer = null;
  const candidate = streamSwapCandidate;
  if (!candidate || !('caches' in window)) return;
  if (journeyVideo.classList.contains('hidden')) return;
  if (journeyVideo.getAttribute('src') !== candidate.src) return;
  if (videoNearEnd()) return; // the end-of-lesson handoff answers this one
  const token = journeyRequestToken;
  const at = journeyVideo.currentTime;
  let cached = null;
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    cached = await cache.match(candidate.key);
  } catch {
    return;
  }
  if (!cached || token !== journeyRequestToken) return;
  if (journeyVideo.getAttribute('src') !== candidate.src) return;
  const blobUrl = await blobUrlFromCacheHit(cached, token);
  if (!blobUrl) return;
  if (journeyVideo.getAttribute('src') !== candidate.src) return;
  streamSwapCandidate = null; // at most once per playback
  console.log('Journey: the streamed video stalled, switching to the cached copy');
  // Armed before the src lands, and applied by the ONE permanent
  // loadedmetadata listener, which re-checks this token: a superseded
  // request can never drop its position onto a newer video.
  pendingSeek = at > 0 ? { token, t: at } : null;
  journeyVideo.src = blobUrl;
  journeyVideo.play().catch(() => {});
}

