/* ── Lesson video: fetched once while online, played from the Cache
      API afterward so a flaky evening connection can't interrupt
      playback. See CLAUDE.md for the nightly feed that produces
      current-lesson.json (including why its downloadUrl is a CORS-enabled
      CDN URL rather than the awana.org one lessons.json itself
      lists). ────────────────────────────────────────────────────────── */

const LAST_LESSON_KEY = 'journey.lastLesson';
async function loadCurrentLesson() {
  try {
    const res = await fetchWithTimeout('current-lesson.json', { cache: 'no-store' }, 15000);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.week !== 'number' || typeof data.downloadUrl !== 'string') {
      return null;
    }
    // The last lesson this kiosk saw, for a boot the network fails: the
    // bundle for it is most likely already in the Cache API.
    try { localStorage.setItem(LAST_LESSON_KEY, JSON.stringify(data)); } catch { /* storage off */ }
    return data;
  } catch {
    return null;
  }
}
function lastKnownLesson() {
  try {
    const data = JSON.parse(localStorage.getItem(LAST_LESSON_KEY) || 'null');
    return data && typeof data.week === 'number' && typeof data.downloadUrl === 'string' ? data : null;
  } catch {
    return null;
  }
}

function sameLesson(a, b) {
  return !!a && !!b && a.week === b.week && a.downloadUrl === b.downloadUrl;
}

/* Awana's own full-size file for this lesson, which is what the kiosk
   plays. current-lesson.json's sourceUrl is the CORS-friendly CDN URL
   the nightly script already resolved (see CLAUDE.md), so it is both
   playable and fetchable into the Cache API; lessons.json's downloadUrl for
   the same week is the fallback when a lesson file predates that field.
   Returns null when neither is known, which every caller treats as "there is
   no original to play or store". */
function originalVideoUrl(lesson) {
  if (!lesson) return null;
  if (typeof lesson.sourceUrl === 'string' && lesson.sourceUrl) return lesson.sourceUrl;
  const entry = Array.isArray(allLessons)
    ? allLessons.find((l) => l && l.week === lesson.week)
    : null;
  if (entry && typeof entry.downloadUrl === 'string' && entry.downloadUrl) return entry.downloadUrl;
  return typeof lesson.downloadUrl === 'string' ? lesson.downloadUrl : null;
}

/* The cached original is stored under its URL plus a quality marker, so
   it can never be mistaken for a 480p copy stored under the bare URL by an
   older version of this page (store-before-evict drops that one on the next
   full round).

   The marker is a query parameter rather than a '#1080' fragment because the
   Cache API ignores fragments when it matches a request, so a fragment would
   silently be the same key as the plain URL. */
function videoCacheKey(lesson) {
  const url = originalVideoUrl(lesson);
  if (!url) return null;
  return `${url}${url.includes('?') ? '&' : '?'}q=1080`;
}

/* Pre-download everything the current week's show and picker can need — the
   video, BOTH transcripts, and the leader handout — not just the video, so a
   dead connection at 6:30 PM (or during a same-week preview) costs nothing.
   Missing files (week 27 has no leader transcript/handout) 404 and are simply
   skipped. Eviction of the previous week's bundle only happens once every
   piece of the new one is safely stored — a mid-download failure can never
   leave the cache emptier than it started (the invariant the old
   cacheLessonVideo() kept for the video alone, extended to the bundle). */
/* The video file the bundle pre-downloads: Awana's original, under the
   quality-marked key. Marked optional: the original is a cross-origin fetch,
   and if it is ever served without CORS headers there is nothing this page
   can do about it. That must cost the lesson's video and nothing else, not
   hold up the eviction of last week's bundle. */
function lessonVideoCandidates(lesson) {
  const url = originalVideoUrl(lesson);
  const cacheKey = videoCacheKey(lesson);
  return url && cacheKey ? [{ fetchUrl: url, cacheKey, optional: true }] : [];
}

let bundleInFlight = false;
let bundleInFlightSince = 0;
// A file of the bundle (the video is the big one) must finish within this, headers AND body, or it is given up
// for this round and tried again on the next refresh.
const BUNDLE_FILE_MS = 3 * 60 * 1000;
// The latch itself is never trusted past this: a round that somehow never
// settles must not stop every later refresh from caching for the life of
// the page (weeks, on the kiosk).
const BUNDLE_LATCH_MAX_MS = 15 * 60 * 1000;
async function cacheLessonBundle(lesson) {
  if (!('caches' in window)) return;
  // Startup, the hourly timer, and the 'online' listener can all fire close
  // together — without this, each would re-download the same multi-MB video
  // in parallel. Whatever a skipped call would have
  // stored, the next refresh's call picks up (skip-if-cached is per item).
  if (bundleInFlight && Date.now() - bundleInFlightSince < BUNDLE_LATCH_MAX_MS) return;
  if (bundleInFlight) console.warn('Journey: a lesson bundle download has been stuck for 15 minutes; starting over');
  bundleInFlight = true;
  bundleInFlightSince = Date.now();
  try {
    const cache = await caches.open(VIDEO_CACHE_NAME);
    const candidates = [
      ...lessonVideoCandidates(lesson),
      { fetchUrl: captionUrlFor(lesson.week, 'student') },
      { fetchUrl: captionUrlFor(lesson.week, 'leader') },
      { fetchUrl: handoutUrl(lesson.week) },
      // Read Prep's transcripts, one file per role (see prepTranscriptUrl).
      // Week 27 has no Leader Video, so its leader file 404s and is skipped
      // exactly like its VTT and handout.
      { fetchUrl: prepTranscriptUrl(lesson.week, 'leader') },
      { fetchUrl: prepTranscriptUrl(lesson.week, 'student') },
      // The teaching slides shown after the video (see startTeachingSlides).
      ...Array.from({ length: deckSlideCount(lesson.week) }, (_, i) => ({
        fetchUrl: slideImageUrl(lesson.week, i + 1),
      })),
      { fetchUrl: slideTemplateUrl(lesson.week) },
    ];
    for (const c of candidates) c.cacheKey = c.cacheKey || c.fetchUrl;
    const bundleUrls = new Set(candidates.map((c) => new URL(c.cacheKey, location.href).href));
    let allStored = true;
    for (const { fetchUrl, cacheKey, optional } of candidates) {
      // One controller covers the whole file: a body that stalls after the
      // headers arrived (the flaky-WiFi case) used to hang cache.put, and
      // with it this loop and the latch, until the page reloaded.
      const controller = typeof AbortController === 'undefined' ? null : new AbortController();
      const deadline = controller ? setTimeout(() => controller.abort(), BUNDLE_FILE_MS) : null;
      try {
        if (await cache.match(cacheKey)) continue; // already stored
        const response = await fetch(fetchUrl, controller ? { signal: controller.signal } : {});
        if (response.status === 404) continue; // legitimately doesn't exist — skip, not a failure
        if (!response.ok) {
          if (!optional) allStored = false;
          continue;
        }
        await cache.put(cacheKey, response);
      } catch (err) {
        if (optional) {
          // The full-quality original, which this page cannot make fetchable
          // if the CDN answers without CORS headers. Log it and keep the rest
          // of the bundle: playback falls back to streaming the same file.
          console.warn('Journey: could not cache', fetchUrl, err);
          continue;
        }
        // Offline, or the host unreachable right now — keep whatever's
        // already cached and try again on the next refresh. Logged (not just
        // swallowed) so a permanently-failing cache attempt is discoverable
        // in devtools rather than invisible until the network is down at
        // showtime.
        allStored = false;
        console.warn('Journey: could not cache', fetchUrl, '—', err);
      } finally {
        if (deadline) clearTimeout(deadline);
      }
    }
    if (!allStored) return;
    const keys = await cache.keys();
    await Promise.all(
      keys.filter((req) => !bundleUrls.has(req.url)).map((req) => cache.delete(req))
    );
  } catch (err) {
    console.warn('Journey: could not cache lesson bundle —', err);
  } finally {
    bundleInFlight = false;
  }
}

