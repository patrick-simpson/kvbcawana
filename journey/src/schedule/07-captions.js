/* ── Captions ─────────────────────────────────────────────────────────
   Every lesson video has a same-origin WebVTT transcript in
   public/transcripts/ (see CLAUDE.md). Before playback starts, the operator
   is asked once — Yes/No, with Y/N keys — and that answer is REMEMBERED for
   this device, so the question never interrupts a service again. Because the
   prompt doesn't come back, the CC button in the playback control bar is the
   deliberate way back to the setting; keep it visible and obvious.

   Unlike `audioUnlocked` (which deliberately isn't persisted, because the
   browser's own gesture permission dies with the page), a caption choice IS a
   genuine operator preference with no browser-side counterpart, so persisting
   it across reloads/reboots is correct rather than a lie. */
const CAPTION_PREF_KEY = 'journey.captions';

// Every localStorage access is wrapped: Chromium in kiosk/private modes, or
// with site data blocked, throws on access rather than returning null.
function storedCaptionPref() {
  try {
    const v = localStorage.getItem(CAPTION_PREF_KEY);
    return v === 'on' ? true : v === 'off' ? false : null;
  } catch {
    return null;
  }
}

function storeCaptionPref(on) {
  try {
    localStorage.setItem(CAPTION_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Preference just won't survive a reload — the prompt asks again. Fine.
  }
}

let captionsEnabled = storedCaptionPref() ?? false;
// The VTT for whatever is on screen right now, or null when the current video
// has no transcript (nothing to show, so the CC button stays hidden).
let activeCaptionUrl = null;
let pendingPlay = null;
const captionProbeCache = new Map();
// URL -> bool, built from lessons.json's `captions` field once it loads.
// Null until then; captionsAvailable() falls back to cache/probe checks.
let captionManifest = null;

function buildCaptionManifest(lessons) {
  const map = new Map();
  let sawAny = false;
  for (const lesson of lessons) {
    if (!lesson || typeof lesson.week !== 'number' || !lesson.captions) continue;
    sawAny = true;
    map.set(captionUrlFor(lesson.week, 'student'), !!lesson.captions.student);
    map.set(captionUrlFor(lesson.week, 'leader'), !!lesson.captions.leader);
  }
  // An old cached lessons.json from before the manifest existed carries no
  // captions fields — keep falling back to probes rather than treating
  // "unknown" as "none".
  if (sawAny) captionManifest = map;
}

function captionUrlFor(week, variant) {
  return `transcripts/week-${String(week).padStart(2, '0')}-${variant}.vtt`;
}

/* A transcript may legitimately be missing (week 27 has no Leader Video at
   all, and a future lesson revision could outpace the transcripts), so
   playback needs to know before offering captions rather than attaching a
   track that 404s and silently does nothing. Which transcripts exist is
   answered in this order, cheapest first:
   1. lessons.json's shipped `captions` manifest (kept in sync by
      scripts/update-captions-manifest.mjs) — no network at all. This is the
      normal path; the rest is fallback for when lessons.json never loaded.
   2. An already-cached copy of the VTT (the current week's are prefetched).
   3. A HEAD probe with a short timeout — the original mechanism, now bounded.
      An earlier version awaited this probe unbounded and BEFORE any visual
      feedback, which on flaky WiFi made Begin Video/the picker look dead.
   Only positive answers are memoized: a probe that failed because the network
   was down must not disable captions until the next reload on a 24/7 kiosk. */
async function captionsAvailable(url) {
  if (!url) return false;
  if (captionProbeCache.get(url)) return true;
  if (captionManifest && captionManifest.has(url)) {
    const ok = captionManifest.get(url);
    if (ok) captionProbeCache.set(url, true);
    return ok;
  }
  if ('caches' in window) {
    try {
      if (await caches.match(url)) {
        captionProbeCache.set(url, true);
        return true;
      }
    } catch {
      // fall through to the probe
    }
  }
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD' }, 2500);
    if (res.ok) {
      captionProbeCache.set(url, true);
      return true;
    }
  } catch {
    // Unreachable right now — treat as "no captions" for this playback only.
  }
  return false;
}

/* Serve a prefetched transcript from the cache as a blob URL, so turning
   captions on never depends on the network at play time. Returns null on a
   cache miss (the caller falls back to the plain URL, which the <track>
   element fetches). Deliberately PURE — it touches no shared state, so a
   stale caller can simply discard (revoke) the result; requestPlayback()
   commits the blob URL to captionObjectUrl only after confirming it is still
   the current request. VTTs are ~10-20KB, so none of this holds meaningful
   memory on the Pi. */
let captionObjectUrl = null;
async function cachedCaptionBlobUrl(url) {
  if (!('caches' in window)) return null;
  try {
    const hit = await caches.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

function removeCaptionTracks() {
  if (activeTextTrack) {
    activeTextTrack.removeEventListener('cuechange', renderActiveCues);
    activeTextTrack = null;
  }
  clearCaptionText();
  for (const track of Array.from(journeyVideo.querySelectorAll('track'))) {
    track.remove();
  }
  // Detaching the element doesn't always drop the TextTrack from
  // video.textTracks in Chromium, so explicitly stop any that linger.
  for (const tt of Array.from(journeyVideo.textTracks || [])) {
    tt.mode = 'disabled';
  }
}

/* Captions are painted by us, not by the browser (see #caption-overlay in
   style.css for why). The track therefore runs in 'hidden' mode: cues are
   still parsed and 'cuechange' still fires, but nothing is drawn natively. */
let activeTextTrack = null;

function clearCaptionText() {
  captionText.textContent = '';
  captionOverlay.classList.add('hidden');
}

function renderActiveCues() {
  if (!activeTextTrack || !captionsEnabled) {
    clearCaptionText();
    return;
  }
  const cues = Array.from(activeTextTrack.activeCues || []);
  captionText.textContent = '';
  for (const cue of cues) {
    if (captionText.childNodes.length) captionText.appendChild(document.createElement('br'));
    // getCueAsHTML() rather than .text: it returns a parsed, sanitized
    // fragment, so any WebVTT markup renders as markup instead of literal
    // angle brackets.
    captionText.appendChild(cue.getCueAsHTML());
  }
  captionOverlay.classList.toggle('hidden', captionText.childNodes.length === 0);
}

/* Vertical placement has to satisfy two different screens at once:
   - On a 16:9 TV the video fills the element, so captions just need to clear
     the playback control bar.
   - On a phone (especially portrait) the video is letterboxed into a band in
     the middle, and captions pinned near the element's bottom would float in
     the black area, disconnected from the picture. So they instead sit just
     inside the video frame's lower edge, the way subtitles normally do.
   Whichever of those two constraints is lower wins. */
function positionCaptions() {
  let bottom = 96;
  const barStyle = getComputedStyle(videoControls);
  const barBottom = parseFloat(barStyle.bottom) || 0;
  const barClearance = videoControls.offsetHeight + barBottom + 12;
  bottom = barClearance;
  const vw = journeyVideo.videoWidth;
  const vh = journeyVideo.videoHeight;
  const ew = journeyVideo.clientWidth;
  const eh = journeyVideo.clientHeight;
  if (vw && vh && ew && eh) {
    // object-fit: contain -> the frame is scaled by the tighter axis.
    const scale = Math.min(ew / vw, eh / vh);
    const letterbox = Math.max(0, (eh - vh * scale) / 2);
    bottom = Math.max(barClearance, letterbox + 8);
  }
  captionOverlay.style.bottom = `${Math.round(bottom)}px`;
}

journeyVideo.addEventListener('loadedmetadata', positionCaptions);
window.addEventListener('resize', positionCaptions);
window.addEventListener('orientationchange', positionCaptions);

