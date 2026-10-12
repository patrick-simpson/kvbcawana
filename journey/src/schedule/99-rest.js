/* ── Keep the kiosk screen awake ─────────────────────────────────────
   Raspberry Pi OS ships with screen blanking enabled by default; with no
   keyboard/mouse activity for hours, the display can go to sleep long
   before 6:30 PM arrives. The Wake Lock API only prevents the screen from
   blanking — it doesn't dismiss a blank that already happened — so this
   also re-acquires on visibilitychange (e.g. after the tab/monitor was
   backgrounded and the lock was released) rather than only once on load.
   Requires HTTPS, which GitHub Pages provides. Not fatal if unsupported
   (older Chromium builds) — disabling blanking at the OS level (see
   PI_SETUP.md) is the belt-and-braces fallback either way. */
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    // The OS can release the lock on its own (a power event, a modal, a
    // monitor sleeping), and a kiosk never fires visibilitychange, so the
    // release itself is the cue to ask again, a moment later.
    if (wakeLock && typeof wakeLock.addEventListener === 'function') {
      wakeLock.addEventListener('release', () => { setTimeout(requestWakeLock, 2000); }, { once: true });
    }
  } catch {
    // e.g. the tab isn't visible yet — visibilitychange below retries.
  }
}
// The configure page is on the operator's own monitor: it has no business
// holding that screen awake.
if (!CONFIGURE_MODE) {
  requestWakeLock();
  // And a slow heartbeat for a lock that was never granted or whose release
  // event was missed: ask again every five minutes while there is none.
  setInterval(() => { if (!wakeLock || wakeLock.released) requestWakeLock(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
      requestWakeLock();
    }
  });
}

// Once the lesson finishes, there's nothing left to show for the rest of
// the window — fall back to the Check-in Display right away rather than
// holding on a blank/frozen frame until 7:15. Deliberately does NOT touch
// lastPhase (see the comment above it) — doing so would make the very next
// poll tick see a manufactured "flip" back to 'journey' and restart the
// lesson from frame zero, which is exactly the bug this comment is here to
// prevent regressing.
/* The single way out of a lesson video, whatever ended it: Awana's teaching
   slides for that lesson come next, and only once they finish does the old
   end-of-video behavior run (Check-in Display for the scheduled show,
   endPreview() for a preview). Reached four ways — the video's own 'ended'
   event, the near-end stall watchdog, a manual skip with →, and a fatal
   video error. It used to hang off 'ended' alone, which stranded a leader
   mid-club: the lesson stalled on its last chunk over flaky WiFi, 'ended'
   never fired, and there was no way to reach the slides at all. */
function endOfLessonHandoff() {
  const finish = () => {
    if (previewMode) {
      endPreview();
      return;
    }
    setView('checkin');
  };
  const week = previewMode ? previewWeek : currentLesson && currentLesson.week;
  if (startTeachingSlides(week, finish)) return true;
  finish();
  return false;
}

// The lesson played out — there is nothing left to resume. (Cleared here
// rather than in endOfLessonHandoff(), which also runs for a → skip and for
// a stall/error, where the mark is still the best guess at where the room
// got to.)
journeyVideo.addEventListener('ended', () => {
  if (!previewMode) clearResumePoint();
});
journeyVideo.addEventListener('ended', endOfLessonHandoff);

/* A video that stalls within a few seconds of its end has, for the room's
   purposes, finished — the last frames are never worth waiting on. Judged
   only when the stall has already lasted LOADING_STALL_MS, so an ordinary
   buffering hiccup near the end still gets a chance to recover and play out. */
const END_STALL_TOLERANCE_S = 3;
function videoNearEnd() {
  const d = journeyVideo.duration;
  const t = journeyVideo.currentTime;
  return Number.isFinite(d) && d > 0 && d - t <= END_STALL_TOLERANCE_S;
}

// A failed/unsupported video load, or a stall that never recovers, should
// fall back to the placeholder rather than leaving a silent black frame
// that's indistinguishable from a dead display.
journeyVideo.addEventListener('error', () => {
  console.warn('Journey: video failed to load/play', journeyVideo.error);
  hideVideoLoading();
  if (previewMode) {
    // A preview tries the transcoded release asset first; if that errored
    // (asset missing, release renamed), retry once with the lesson's
    // original URL before giving up. Cleared immediately so a failure of
    // the fallback itself lands in endPreview() below, not a loop.
    if (previewFallbackUrl) {
      const fallback = previewFallbackUrl;
      previewFallbackUrl = null;
      console.warn('Journey: transcoded preview failed, retrying with the original —', fallback);
      showVideoLoading();
      journeyVideo.src = fallback;
      applyCaptions(); // keep captions across the one-time fallback swap
      journeyVideo.play().catch(() => {});
      return;
    }
    endPreview();
    return;
  }
  if (!journeyView.classList.contains('hidden')) {
    // The lesson can't play, but this week's teaching slides are already on
    // this device — far better on the wall than a dead placeholder. Only a
    // week with no slides falls through to it.
    if (startTeachingSlides(currentLesson && currentLesson.week, () => setView('checkin'))) return;
    journeyVideo.classList.add('hidden');
    videoControls.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
  }
});

/* ── Lesson refresh: pulled well ahead of the evening window so the
      video is already cached locally by 6:30, regardless of how the
      network is behaving right then. ──────────────────────────────── */

// Until the first lesson has been read, a failed read is tried again soon
// (15 s, 30 s, 1 min, then every 5 min), not an hour later: a kiosk booted at
// 6:20 with one DNS hiccup used to show the placeholder all night, its next
// try landing after the 7:15 window had closed. The teaching slides, read
// once at startup, are read again on the same retries while still missing.
const LESSON_RETRY_MS = [15000, 30000, 60000];
const LESSON_RETRY_MAX_MS = 5 * 60 * 1000;
let lessonRetryTimer = null;
let lessonRetries = 0;
/** How long to wait before the n-th retry (0-based). */
function lessonRetryWait(n) {
  return n < LESSON_RETRY_MS.length ? LESSON_RETRY_MS[n] : LESSON_RETRY_MAX_MS;
}
function scheduleLessonRetry() {
  clearTimeout(lessonRetryTimer);
  lessonRetryTimer = setTimeout(refreshLesson, lessonRetryWait(lessonRetries));
  lessonRetries += 1;
}

async function refreshLesson() {
  const lesson = await loadCurrentLesson();
  if (!teachingSlides) loadTeachingSlides();
  if (!lesson) {
    // A failed fetch (the exact flaky-network case this refresh exists to be
    // resilient against) must never blank out a lesson we already have —
    // only a genuinely resolved lesson can update or clear currentLesson.
    if (!currentLesson) {
      // Nothing yet: the last lesson this kiosk saw, whose bundle is most
      // likely cached, is better than the placeholder while the retries run.
      const last = lastKnownLesson();
      if (last) { currentLesson = last; cacheLessonBundle(last); }
      scheduleLessonRetry();
    }
    return;
  }
  clearTimeout(lessonRetryTimer);
  lessonRetries = 0;
  const changed = !sameLesson(currentLesson, lesson);
  currentLesson = lesson;
  cacheLessonBundle(lesson);
  if (changed && lastPhase === 'journey' && !previewMode) showJourneyContent();
}

if (CONFIGURE_MODE) {
  // The panel only needs to know which week is tonight's (the bullet editor
  // and the list's highlight). One read, no bundle: the videos are the live
  // kiosk's business, not this window's.
  loadCurrentLesson().then((lesson) => {
    currentLesson = lesson || lastKnownLesson();
    if (!currentLesson) return;
    updateNotesEditedBadge();
    if (allLessons) renderLessonList(allLessons);
  });
} else {
  refreshLesson();
  setInterval(refreshLesson, LESSON_REFRESH_MS);
  // The browser noticing the connection coming back is a better moment to
  // retry than waiting out the hourly timer — flaky church WiFi is the normal
  // operating condition here. ('online' can fire in bursts on a flapping
  // connection; the bundleInFlight guard in cacheLessonBundle() is what keeps
  // that from stacking duplicate multi-MB downloads on the single-core Pi.)
  window.addEventListener('online', () => refreshLesson());
}

/* ── Manual video preview (Settings panel) ────────────────────────────
   Lets an operator browse every lesson in public/lessons.json and play
   any one of them right now — always a one-off: it never changes what
   the schedule above will automatically show at the next 6:30 PM, and
   never touches current-lesson.json. Plays the lesson's pre-transcoded
   480p copy from videos/ on this site (see transcodedPreviewUrl above),
   falling back to the original URL only if that asset is missing — an
   earlier version played the originals directly, which the Pi Zero
   cannot decode at a watchable frame rate, so "only the current week
   plays properly" was reported broken from the live kiosk. Still skips
   the Cache API: an occasional manual action doesn't need the nightly
   lesson's pre-caching machinery, it just needs a decodable file. Picking
   a lesson ALWAYS asks Leader or Student Video first (lessons with no
   Leader Video — week 27 — have that choice disabled); see the comment in
   onLessonPicked() for why this is deliberately unconditional. */

let pendingPreviewLesson = null;
// Set alongside each preview: the lesson's original URL, tried once if the
// transcoded release asset errors (missing, or the release was renamed).
let previewFallbackUrl = null;
// The week of the lesson being previewed — the teaching slides shown after
// a preview video are that lesson's, not the scheduled one's.
let previewWeek = null;

// Every lesson (Student and Leader) has a Pi-playable 480p re-encode
// uploaded as a GitHub Release asset by scripts/transcode-all-lessons.mjs —
// the Pi Zero can't decode Awana's 1080p originals at a watchable frame
// rate, so previews play these first and only fall back to the original if
// the asset is missing. (Release asset URLs 302-redirect, which <video>
// follows fine; no crossorigin attribute means CORS never applies.)
// Since 2026-10-03 they are served from this site itself, under videos/ (the
// kvbcawana `journey-videos-v2` release, every file under 25 MiB, streamed by
// site/functions/journey with Range, so a video can seek), so they are
// same-origin like everything else here.
const TRANSCODED_VIDEO_BASE = 'videos/';

function transcodedPreviewUrl(week, variant) {
  return `${TRANSCODED_VIDEO_BASE}week-${String(week).padStart(2, '0')}-${variant}.mp4`;
}

/* lessons.json is a static file that changes ~never, yet an earlier version
   fetched it with {cache:'no-store'} at the moment the Settings gear was
   pressed — a forced network round-trip standing between the click and the
   panel's contents. Now it's cache-first: a good copy is kept in the Cache
   API (stored by fetchLessonsJson below, refreshed in the background), so
   after the first successful load ever, the lesson list works with the
   network fully dead. GitHub Pages' own max-age=600 means a plain fetch is
   at most 10 minutes stale, same as every other asset on the site. */
function adoptLessonsData(data) {
  if (!data || !Array.isArray(data.lessons)) return false;
  allLessons = data.lessons;
  buildCaptionManifest(allLessons);
  return true;
}

async function fetchLessonsJson() {
  const res = await fetchWithTimeout('lessons.json', {}, 5000);
  if (!res.ok) throw new Error(`lessons.json ${res.status}`);
  // Parse and shape-check BEFORE caching: a 200 carrying garbage (a truncated
  // deploy, a hand-edit typo) must never replace the known-good offline copy.
  const text = await res.text();
  const data = JSON.parse(text); // throws on invalid JSON
  if (!data || !Array.isArray(data.lessons)) throw new Error('lessons.json: unexpected shape');
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(
        'lessons.json',
        new Response(text, { headers: { 'content-type': 'application/json' } })
      );
    } catch {
      // Not storable right now (quota, private mode) — still usable live.
    }
  }
  return data;
}

async function cachedLessonsJson() {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    const hit = await cache.match('lessons.json');
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function loadAllLessons() {
  if (allLessons) return allLessons;
  const cached = await cachedLessonsJson();
  if (cached && adoptLessonsData(cached)) {
    // Serve the cached copy instantly; revalidate quietly for next time.
    fetchLessonsJson().then(adoptLessonsData, () => {});
    return allLessons;
  }
  try {
    if (adoptLessonsData(await fetchLessonsJson())) return allLessons;
  } catch {
    // Offline with nothing cached yet — the caller shows the error state.
  }
  return null;
}

function renderLessonList(lessons) {
  settingsLessonList.textContent = '';
  for (const lesson of lessons.slice().sort((a, b) => a.week - b.week)) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'settings-lesson-row';
    row.setAttribute('role', 'option');
    if (currentLesson && currentLesson.week === lesson.week) {
      row.classList.add('settings-lesson-current');
    }
    const week = document.createElement('span');
    week.className = 'settings-lesson-week';
    week.textContent = `Week ${lesson.week}`;
    const title = document.createElement('span');
    title.textContent = lesson.title;
    row.append(week, title);
    row.addEventListener('click', () => onLessonPicked(lesson));
    settingsLessonList.appendChild(row);
  }
}

function onLessonPicked(lesson) {
  // Always ask Leader or Student — an earlier version skipped the question
  // inside the 6:30-7:15 window (playing the Student Video directly, like
  // the scheduled show), but the two behaviors read as the picker being
  // flaky rather than as a deliberate rule ("it's not asking me
  // consistently" — reported from the live kiosk 2026-08-22). One
  // consistent extra click beats a clever inconsistency.
  pendingPreviewLesson = lesson;
  settingsVariantPrompt.textContent = `"${lesson.title}" — which video?`;
  // The deck is generated for every week, including 27, which has no Leader
  // Video, so this choice is never disabled.
  settingsVariantSlidesBtn.disabled = false;
  settingsVariantLeaderBtn.disabled = !lesson.leaderDownloadUrl;
  settingsLessonList.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
}

function resetSettingsPanelToList() {
  pendingPreviewLesson = null;
  settingsVariantPicker.classList.add('hidden');
  settingsStudentPicker.classList.add('hidden');
  settingsLeaderPicker.classList.add('hidden');
  settingsLessonList.classList.remove('hidden');
}

/* ── Leader handout viewer ────────────────────────────────────────────
   Each Leader Video has a one-page summary PDF (public/handouts/,
   generated from its transcript in public/transcripts/ — see CLAUDE.md).
   Shown full-screen in an iframe via Chromium's built-in PDF viewer, so
   the kiosk never leaves the page or opens a tab. */
function handoutUrl(week) {
  return `handouts/week-${String(week).padStart(2, '0')}-leader-handout.pdf`;
}

let handoutObjectUrl = null;

// The current week's handout is prefetched into the Cache API by
// cacheLessonBundle(); serving it as a blob URL means opening it needs no
// network. Other weeks fall back to the live URL (Chromium's PDF viewer
// streams it), and the ~55KB PDF is small enough that this stays a
// degraded-not-dead path: the overlay and its Close button appear instantly
// and never wait on the fetch. PURE, like cachedCaptionBlobUrl(): returns a
// fresh blob URL or null, and openHandout() commits it to handoutObjectUrl
// only after confirming the open it belongs to is still the current one.
async function cachedHandoutBlobUrl(url) {
  if (!('caches' in window)) return null;
  try {
    const hit = await caches.match(url);
    if (!hit) return null;
    return URL.createObjectURL(await hit.blob());
  } catch {
    return null;
  }
}

// Identity of the latest open — a slow cache read for handout A must not
// land its PDF into an overlay that has since been closed and reopened
// showing handout B's title.
let handoutRequestId = 0;

function openHandout(lesson) {
  const requestId = ++handoutRequestId;
  handoutTitle.textContent = `Week ${lesson.week} — ${lesson.title} (Leader Handout)`;
  handoutView.classList.remove('hidden');
  handoutCloseBtn.focus();
  const url = handoutUrl(lesson.week);
  cachedHandoutBlobUrl(url).then((blobUrl) => {
    if (requestId !== handoutRequestId) {
      // Closed or replaced while the cache read was in flight — discard our
      // blob rather than clobbering (and revoking) the newer open's.
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      return;
    }
    if (blobUrl) {
      if (handoutObjectUrl) URL.revokeObjectURL(handoutObjectUrl);
      handoutObjectUrl = blobUrl;
      handoutFrame.src = blobUrl;
    } else {
      handoutFrame.src = url;
    }
  });
}

function closeHandout() {
  ++handoutRequestId; // abandon any still-resolving open
  handoutView.classList.add('hidden');
  // Drop the PDF viewer's memory the moment it's closed — same 512MB-Pi
  // hygiene as detaching the <video> element's src.
  handoutFrame.removeAttribute('src');
  if (handoutObjectUrl) {
    URL.revokeObjectURL(handoutObjectUrl);
    handoutObjectUrl = null;
  }
}

handoutCloseBtn.addEventListener('click', closeHandout);

/* ── Leader prep: the handout's summary as text, not a PDF ────────────
   "View Handout" is the right thing on the TV and the wrong thing on a
   phone — a Letter-sized PDF page in Chromium's viewer, pinch-zoomed, is
   the worst reading experience a leader preparing on the way to church
   could be handed. "Read Prep" renders the same page-1 content (Big Idea,
   Key Points, Scripture, Discussion Questions) as plain text this page
   lays out itself, so it reflows on any screen.

   public/leader-prep.json is GENERATED from data/leader-handout-summaries
   .json by scripts/build-leader-prep.mjs (which render-leader-handouts.mjs
   also runs) — that data file stays the single hand-edited source and stays
   a build input. Only the summaries travel: they are this church's own
   writing about each video, not Awana's material, and the spoken transcript
   is already published as the caption .vtt.

   Loaded cache-first out of ASSET_CACHE_NAME exactly like lessons.json and
   teaching-slides.json, and warmed at startup, so after one successful load
   the prep opens with the network dead. */
const LEADER_PREP_URL = 'leader-prep.json';
let leaderPrep = null;
// Set once a load has been tried and produced nothing usable, so the panel
// can tell "not fetched yet" from "we tried and there is no data".
let leaderPrepFailed = false;

function adoptLeaderPrep(data) {
  if (!data || typeof data !== 'object' || !data.weeks || typeof data.weeks !== 'object') return false;
  leaderPrep = data;
  return true;
}

async function fetchLeaderPrepJson() {
  const res = await fetchWithTimeout(LEADER_PREP_URL, {}, 5000);
  if (!res.ok) throw new Error(`${LEADER_PREP_URL} ${res.status}`);
  // Parse and shape-check BEFORE caching: a 200 carrying a truncated deploy
  // must never replace a known-good offline copy.
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.weeks) throw new Error(`${LEADER_PREP_URL}: unexpected shape`);
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(LEADER_PREP_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch {
      // Not storable right now — still usable live.
    }
  }
  return data;
}

async function loadLeaderPrep() {
  if (leaderPrep) return leaderPrep;
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const hit = await cache.match(LEADER_PREP_URL);
      if (hit && adoptLeaderPrep(await hit.json())) {
        fetchLeaderPrepJson().then(adoptLeaderPrep, () => {});
        return leaderPrep;
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    adoptLeaderPrep(await fetchLeaderPrepJson());
  } catch (err) {
    console.warn('Journey: leader-prep.json unavailable —', err);
  }
  if (!leaderPrep) leaderPrepFailed = true;
  return leaderPrep;
}

function leaderPrepFor(week) {
  const weeks = leaderPrep && leaderPrep.weeks;
  const entry = weeks && weeks[String(week)];
  return entry && typeof entry === 'object' ? entry : null;
}

// Identity of the latest open, same reason as handoutRequestId: a slow load
// for week A must not paint into an overlay showing week B.
let prepRequestId = 0;

/* ── The transcript inside Read Prep ──────────────────────────────────
   Below the summary, collapsed behind one button, every Read Prep carries
   that video's whole transcript in two versions:

     Edited       the readable prose the Leader Handout prints, and
     Exact words  the verbatim cue text from the caption .vtt.

   Both come from public/prep-transcripts/week-NN-<role>.json, built by
   scripts/build-prep-transcripts.mjs from data/<role>-transcript-prose.json
   and that week's VTT. One file per week per role, because leader-prep.json
   is warmed at startup for all 31 weeks and a transcript is tens of KB: it
   is fetched only when a leader actually expands one.

   Which version the leader last chose is a per-device preference, read with
   the same try/catch shape as the caption prefs (kiosk Chromium can throw on
   localStorage rather than returning null).

   Every paragraph carries the start time of its first cue, shown as a
   tappable timestamp: pressing it closes the overlay and starts THAT video
   at that moment, through the same preview path the picker uses. */
const PREP_TRANSCRIPT_MODE_KEY = 'journey.prep.transcriptMode';

function prepTranscriptUrl(week, role) {
  return `prep-transcripts/week-${String(week).padStart(2, '0')}-${role}.json`;
}

function storedPrepTranscriptMode() {
  try {
    return localStorage.getItem(PREP_TRANSCRIPT_MODE_KEY) === 'exact' ? 'exact' : 'edited';
  } catch {
    return 'edited';
  }
}

function storePrepTranscriptMode(mode) {
  try {
    localStorage.setItem(PREP_TRANSCRIPT_MODE_KEY, mode);
  } catch {
    // The choice just won't survive a reload. Nothing else depends on it.
  }
}

let prepTranscriptMode = storedPrepTranscriptMode();

// url -> parsed transcript. Only successes are remembered: memoizing a
// failure would leave a 24/7 kiosk unable to ever load that transcript again
// after one bad evening, the same reason captionsAvailable() only caches
// positive probes.
const prepTranscripts = new Map();

function validPrepTranscript(data) {
  return !!data && typeof data === 'object' && Array.isArray(data.paragraphs);
}

async function loadPrepTranscript(url) {
  const known = prepTranscripts.get(url);
  if (known) return known;
  // caches.match() searches every bucket, so the current week's copy is found
  // whether it arrived with the prefetched bundle (journey-videos-v1) or was
  // stored below after an on-demand fetch for some other week.
  if ('caches' in window) {
    try {
      const hit = await caches.match(url);
      if (hit) {
        const cached = await hit.json();
        if (validPrepTranscript(cached)) {
          prepTranscripts.set(url, cached);
          return cached;
        }
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    const res = await fetchWithTimeout(url, {}, 5000);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    // Parse and shape-check BEFORE caching, like lessons.json: a 200 carrying
    // a truncated deploy must never become this device's offline copy.
    const text = await res.text();
    const data = JSON.parse(text);
    if (!validPrepTranscript(data)) throw new Error(`${url}: unexpected shape`);
    prepTranscripts.set(url, data);
    if ('caches' in window) {
      try {
        const cache = await caches.open(ASSET_CACHE_NAME);
        await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
      } catch {
        // Not storable right now, still usable live.
      }
    }
    return data;
  } catch (err) {
    console.warn('Journey: transcript unavailable', url, err);
    return null;
  }
}

/* Start the video this transcript belongs to, at this paragraph.
   Acknowledge-first: closePrep() and requestPlayback()'s reveal both happen
   synchronously, so the screen has changed before anything is fetched. */
function startPrepAt(lesson, role, seconds) {
  audioUnlocked = true; // a real press, so the video may start with sound
  closePrep();
  if (role === 'leader') {
    if (!lesson.leaderDownloadUrl) return;
    requestPlayback(captionUrlFor(lesson.week, 'leader'), () => playLeaderPreview(lesson, seconds));
    return;
  }
  requestPlayback(captionUrlFor(lesson.week, 'student'), () => playStudentPreview(lesson, seconds));
}

function renderPrepParagraphs(container, data, lesson, role) {
  container.textContent = '';
  for (const para of data.paragraphs) {
    if (para.heading) {
      const h = document.createElement('h4');
      h.className = 'prep-para-heading';
      h.textContent = para.heading;
      container.appendChild(h);
    }
    const p = document.createElement('p');
    p.className = 'prep-para';
    const stamp = document.createElement('button');
    stamp.type = 'button';
    stamp.className = 'prep-time';
    stamp.textContent = formatTime(para.t);
    stamp.setAttribute('aria-label', `Play this video from ${formatTime(para.t)}`);
    stamp.addEventListener('click', () => startPrepAt(lesson, role, para.t));
    const text = document.createElement('span');
    text.className = 'prep-para-text';
    text.textContent = prepTranscriptMode === 'exact' ? para.exact : para.edited;
    p.append(stamp, text);
    container.appendChild(p);
  }
}

/* Edited / Exact words. Both versions of every paragraph are already in the
   one JSON, so switching repaints from memory and never fetches. */
function buildPrepModeRow(lesson, role, container) {
  const row = document.createElement('div');
  row.className = 'prep-transcript-modes';
  const label = document.createElement('span');
  label.className = 'prep-modes-label';
  label.textContent = 'Version';
  row.appendChild(label);
  const buttons = [];
  for (const [mode, text] of [
    ['edited', 'Edited'],
    ['exact', 'Exact words'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'prep-mode-btn';
    button.textContent = text;
    button.setAttribute('aria-pressed', String(prepTranscriptMode === mode));
    button.addEventListener('click', () => {
      prepTranscriptMode = mode;
      storePrepTranscriptMode(mode);
      for (const other of buttons) other.el.setAttribute('aria-pressed', String(other.mode === mode));
      const data = prepTranscripts.get(prepTranscriptUrl(lesson.week, role));
      if (data) renderPrepParagraphs(container, data, lesson, role);
    });
    buttons.push({ mode, el: button });
    row.appendChild(button);
  }
  return row;
}

/* `reveal` is false when the transcript is open from the start (the Student
   Prep), where scrolling would hide the top of the overlay nobody asked to
   leave. It is true when a leader pressed the button. */
function expandPrepTranscript(lesson, role, toggle, panel, scrolls = true) {
  const requestId = prepRequestId; // the overlay open this expansion belongs to
  toggle.setAttribute('aria-expanded', 'true');
  toggle.textContent = 'Hide the full transcript';
  panel.classList.remove('hidden');
  panel.textContent = '';
  // The header row and the mode toggle are built now, with nothing awaited:
  // pressing the button has to change the screen this frame.
  const paragraphs = document.createElement('div');
  paragraphs.className = 'prep-paras';
  panel.append(buildPrepModeRow(lesson, role, paragraphs), paragraphs);
  // Put the section the leader just opened at the top of the overlay: the
  // button sits under a screen of summary, so without this the paragraphs
  // appear entirely below the fold. Run once now (the press is acknowledged
  // whether or not a transcript arrives) and again once the paragraphs are
  // in, because until then there is nothing below to scroll up against.
  // Guarded: it is the one call here a non-browser DOM may not implement.
  const reveal = () => {
    if (scrolls && typeof toggle.scrollIntoView === 'function') toggle.scrollIntoView(true);
  };
  reveal();
  const url = prepTranscriptUrl(lesson.week, role);
  const inMemory = prepTranscripts.get(url);
  if (inMemory) {
    renderPrepParagraphs(paragraphs, inMemory, lesson, role);
    reveal();
    return;
  }
  const loading = document.createElement('p');
  loading.className = 'prep-note';
  loading.textContent = 'Loading transcript…';
  paragraphs.appendChild(loading);
  loadPrepTranscript(url).then((data) => {
    // Closed, reopened on another week, or collapsed while the fetch was in
    // flight: paint nothing rather than into a panel nobody is looking at.
    if (requestId !== prepRequestId || !paragraphs.isConnected) return;
    if (!data) {
      paragraphs.textContent = '';
      const failed = document.createElement('p');
      failed.className = 'prep-note';
      failed.textContent =
        'The transcript hasn’t downloaded to this device yet. Check the kiosk’s internet connection, then try again.';
      paragraphs.appendChild(failed);
      return;
    }
    renderPrepParagraphs(paragraphs, data, lesson, role);
    reveal();
  });
}

function appendPrepTranscript(lesson, role, startExpanded) {
  // Week 27 has no Leader Video, so there is no leader transcript to offer.
  if (role === 'leader' && !lesson.leaderDownloadUrl) return;
  const section = document.createElement('section');
  section.className = 'prep-transcript';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'prep-transcript-toggle';
  toggle.textContent = 'Read the full transcript';
  toggle.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'prep-transcript-body hidden';
  section.append(toggle, panel);
  prepBody.appendChild(section);
  toggle.addEventListener('click', () => {
    if (toggle.getAttribute('aria-expanded') === 'true') {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Read the full transcript';
      panel.classList.add('hidden');
      panel.textContent = ''; // a screen of paragraphs has no reason to stay in the DOM
      return;
    }
    expandPrepTranscript(lesson, role, toggle, panel);
  });
  if (startExpanded) expandPrepTranscript(lesson, role, toggle, panel, false);
}


function prepNote(message) {
  prepBody.textContent = '';
  const p = document.createElement('p');
  p.className = 'prep-note';
  p.textContent = message;
  prepBody.appendChild(p);
}

function prepSection(heading, build) {
  const section = document.createElement('section');
  const h = document.createElement('h3');
  h.textContent = heading;
  section.appendChild(h);
  section.appendChild(build());
  prepBody.appendChild(section);
}

function renderPrep(lesson, role = 'leader') {
  // The Student Prep has no summary to show: the Big Idea / Key Points /
  // Scripture / Questions are written from the LEADER Video, so putting them
  // here would credit the wrong video. It is the transcript, open already.
  if (role === 'student') {
    prepNote('The Student Video, written out. Summaries live under the Leader Video’s prep.');
    appendPrepTranscript(lesson, role, true);
    return;
  }
  const entry = leaderPrepFor(lesson.week);
  if (!entry) {
    prepNote(
      leaderPrepFailed
        ? 'The leader prep hasn’t downloaded to this device yet — check the kiosk’s internet connection, then try again.'
        : `There’s no leader prep for week ${lesson.week}. (Week 27 has no Leader Video, so it has no summary.)`
    );
    appendPrepTranscript(lesson, role, false);
    return;
  }
  prepBody.textContent = '';
  if (entry.bigIdea) {
    prepSection('Big Idea', () => {
      const p = document.createElement('p');
      p.textContent = entry.bigIdea;
      return p;
    });
  }
  if (Array.isArray(entry.keyPoints) && entry.keyPoints.length) {
    prepSection('Key Points from the Leader Video', () => {
      const ul = document.createElement('ul');
      for (const point of entry.keyPoints) {
        const li = document.createElement('li');
        li.textContent = point;
        ul.appendChild(li);
      }
      return ul;
    });
  }
  if (Array.isArray(entry.scriptures) && entry.scriptures.length) {
    prepSection('Scripture', () => {
      const p = document.createElement('p');
      p.className = 'prep-scripture';
      p.textContent = entry.scriptures.join(' • ');
      return p;
    });
  }
  if (Array.isArray(entry.questions) && entry.questions.length) {
    prepSection('Discussion Questions', () => {
      const ol = document.createElement('ol');
      for (const question of entry.questions) {
        const li = document.createElement('li');
        li.textContent = question;
        ol.appendChild(li);
      }
      return ol;
    });
  }
  appendPrepTranscript(lesson, role, false);
  const footer = document.createElement('p');
  footer.className = 'prep-footer';
  footer.textContent =
    'Summary of this week’s Leader Video, for this church’s Awana® leaders — internal ministry use only.';
  prepBody.appendChild(footer);
}

function openPrep(lesson, role = 'leader') {
  const requestId = ++prepRequestId;
  // Everything visible happens now; the JSON (if it isn't in memory yet) is
  // waited on behind an on-screen note, never in front of the overlay.
  const label = role === 'student' ? 'Student Prep' : 'Leader Prep';
  prepTitle.textContent = `Week ${lesson.week} — ${lesson.title} (${label})`;
  prepView.classList.remove('hidden');
  prepCloseBtn.focus();
  // A Student Prep never reads leader-prep.json, so it never waits on it.
  if (role === 'student' || leaderPrep) {
    renderPrep(lesson, role);
    return;
  }
  prepNote('Loading the leader prep…');
  loadLeaderPrep().then(() => {
    if (requestId !== prepRequestId) return; // closed, or reopened on another week
    renderPrep(lesson, role);
  });
}

function closePrep() {
  ++prepRequestId; // abandon any still-resolving open
  prepView.classList.add('hidden');
  prepBody.textContent = ''; // don't keep a screen of DOM around for the other 23 hours
  prepBody.scrollTop = 0;
}

prepCloseBtn.addEventListener('click', closePrep);

// Both full-screen reading overlays sit above everything else, so the
// playback and settings shortcuts must stay inert while either is up.
function readerOverlayOpen() {
  return !handoutView.classList.contains('hidden') || !prepView.classList.contains('hidden');
}

function openSettingsPanel() {
  audioUnlocked = true;
  resetSettingsPanelToList();
  // The panel appears the instant the gear is pressed — an earlier version
  // awaited lessons.json first, so on a hung request the gear looked broken
  // (nothing on screen, ever). The list fills in when the data arrives, from
  // the Cache API when the network can't answer.
  // The bullet editor starts collapsed on every open (it is a rarely-used
  // detour, not the panel's main job), but its badge is refreshed so an
  // override on this device is visible without opening anything.
  notesEditBody.classList.add('hidden');
  notesEditToggle.setAttribute('aria-expanded', 'false');
  updateNotesEditedBadge();
  // Both read only memory and localStorage, so the panel still opens in the
  // same frame the gear was pressed.
  syncQualityButtons();
  qualityStatus.textContent = '';
  settingsPanel.classList.remove('hidden');
  if (allLessons) {
    renderLessonList(allLessons);
    return;
  }
  settingsLessonList.textContent = '';
  const note = document.createElement('p');
  note.className = 'settings-list-note';
  note.textContent = 'Loading lesson list…';
  settingsLessonList.appendChild(note);
  loadAllLessons().then((lessons) => {
    if (settingsPanel.classList.contains('hidden')) return; // closed meanwhile
    if (lessons) {
      // Only replace the loading note if the list hasn't already been
      // rendered by a faster concurrent open.
      if (note.isConnected) renderLessonList(lessons);
    } else {
      note.textContent = CONFIGURE_MODE
        ? 'The lesson list couldn’t load. Check this computer’s internet connection, then reopen this window.'
        : 'The lesson list couldn’t load — check the kiosk’s internet connection, then close and reopen this panel.';
    }
  });
}

function closeSettingsPanel() {
  // The configure page is the panel and nothing else: there is nothing
  // behind it to close onto. (The bullet editor's own debounce and its
  // collapse still save what was typed.)
  if (CONFIGURE_MODE) return;
  // Commit anything typed into the bullet editor first: the panel closes on
  // Escape or a backdrop click without the textarea ever blurring, so the
  // debounced save may still be pending.
  if (!notesEditBody.classList.contains('hidden')) saveNotesEditor();
  settingsPanel.classList.add('hidden');
}

function startPreview(url, title, fallbackUrl = null, week = null) {
  ++journeyRequestToken; // invalidate any in-flight showJourneyContent() call
  stopTeachingSlides();
  previewMode = true;
  playingWeek = null; // a preview is never the scheduled show's resume point
  previewFallbackUrl = fallbackUrl;
  previewWeek = week;
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  // The splash may be up when a preview starts (picking a lesson while the
  // scheduled window's "Large Group Time" screen is showing) — hide it, or
  // it sits on top of the video. playCurrentLesson() does the same.
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  videoControls.classList.remove('hidden');
  showVideoLoading();
  journeyVideo.loop = false;
  setMuted(!audioUnlocked);
  journeyVideo.src = url;
  applyCaptions();
  journeyVideo.play().catch(() => {
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
  console.log(`Journey: previewing "${title}"`);
}

function endPreview() {
  if (!previewMode) return;
  previewMode = false;
  previewFallbackUrl = null;
  previewWeek = null;
  // Tear the preview's video down before handing the view back. Without
  // this, ending a preview inside the 6:30-7:15 window left the finished
  // video element visible, which made showJourneyContent() early-return
  // (it sees "playback in progress") instead of re-showing the splash.
  stopJourneyContent();
  setView(scheduledPhase());
}

settingsBtn.addEventListener('click', () => {
  audioUnlocked = true;
  openSettingsPanel();
});

settingsCloseBtn.addEventListener('click', closeSettingsPanel);
settingsBackdrop.addEventListener('click', closeSettingsPanel);

settingsVariantBackBtn.addEventListener('click', resetSettingsPanelToList);

/* The picker's third choice: that week's teaching slides on their own, with
   no video at all. It is a preview like any other pick, so previewMode holds
   off the 15s scheduler poll and the hourly refresh, Finish runs endPreview()
   and the ⇄ button tears it down through stopJourneyContent(). previewWeek is
   set for the same reason a video preview sets it: the deck on screen is that
   lesson's, not the scheduled one's. */
function startSlidesPreview(week) {
  ++journeyRequestToken; // invalidate any in-flight playback request
  previewMode = true;
  previewFallbackUrl = null;
  previewWeek = week;
  playingWeek = null; // a preview is never the scheduled show's resume point
  if (startTeachingSlides(week, endPreview)) {
    console.log(`Journey: previewing week ${week} teaching slides`);
    return true;
  }
  // Nothing to show: hand control straight back rather than sitting in a
  // preview with an empty stage.
  previewMode = false;
  previewWeek = null;
  setView(scheduledPhase());
  return false;
}

settingsVariantSlidesBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('slides', pendingPreviewLesson);
});

/* Both roles' previews live in one function each, because the Read Prep
   overlay's timestamps start the same videos the picker does. `seekTo` is
   the second to open at: it is armed as pendingSeek only AFTER
   startPreview() has bumped journeyRequestToken, so the one permanent
   'loadedmetadata' listener applies it and a superseded request can never
   drop its seek onto a newer video. 0 means "from the top", which also
   clears any mark an abandoned request left behind. */
function armPreviewSeek(seconds) {
  pendingSeek = seconds > 0 ? { token: journeyRequestToken, t: seconds } : null;
}

/* Which file a picked video plays, and what it falls back to once if that
   errors. The two profiles are exact inverses of each other: a weak device
   wants the 480p Release copy and treats Awana's original as the emergency
   spare, a capable one wants the original and treats the Release copy as the
   spare. Neither is cached: a Release asset's redirect hop carries no CORS
   header, and an occasional manual pick does not need the nightly bundle's
   machinery, it just needs a file that plays. */
function previewSources(week, variant, originalUrl) {
  const release = transcodedPreviewUrl(week, variant);
  return effectiveProfile() === 'full' && originalUrl
    ? { url: originalUrl, fallback: release }
    : { url: release, fallback: originalUrl };
}

async function playStudentPreview(lesson, seekTo = 0) {
  // The current week's Student Video is the one already pre-downloaded for
  // the 6:30 show, so play the local copy instead of re-streaming it: a
  // same-week preview works with the network dead. resolveVideoSrc() serves
  // this device's own quality, so there is no risk of handing the Pi the
  // 1080p bytes; on the low profile the shortcut still needs transcodedAt,
  // because without it downloadUrl is that original.
  const sameWeek = !!currentLesson && currentLesson.week === lesson.week;
  if (sameWeek && (effectiveProfile() === 'full' || currentLesson.transcodedAt)) {
    const token = journeyRequestToken;
    const src = await resolveVideoSrc(currentLesson, token);
    if (!src || token !== journeyRequestToken) return; // torn down while reading the cache
    startPreview(
      src,
      `${lesson.title} (Student Video)`,
      transcodedPreviewUrl(lesson.week, 'student'),
      lesson.week
    );
    armPreviewSeek(seekTo);
    return;
  }
  const { url, fallback } = previewSources(lesson.week, 'student', lesson.downloadUrl);
  startPreview(url, `${lesson.title} (Student Video)`, fallback, lesson.week);
  armPreviewSeek(seekTo);
}

function playLeaderPreview(lesson, seekTo = 0) {
  const { url, fallback } = previewSources(lesson.week, 'leader', lesson.leaderDownloadUrl);
  startPreview(url, `${lesson.title} (Leader Video)`, fallback, lesson.week);
  armPreviewSeek(seekTo);
}

// Student is a two-step choice now too: the Student Video's transcript is
// readable in Read Prep, so "which video?" is followed by "video or prep?"
// on both sides rather than only the Leader's.
settingsVariantStudentBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  settingsStudentPrompt.textContent = `"${pendingPreviewLesson.title}" (Student): video or prep?`;
  settingsVariantPicker.classList.add('hidden');
  settingsStudentPicker.classList.remove('hidden');
});

settingsStudentVideoBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('student', pendingPreviewLesson);
});

settingsStudentPrepBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('student-prep', pendingPreviewLesson);
});

settingsStudentBackBtn.addEventListener('click', () => {
  settingsStudentPicker.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
});

// Leader is a two-step choice: first Leader vs Student, then Video vs
// Handout (the one-page summary PDF generated from the Leader Video's
// transcript).
settingsVariantLeaderBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  settingsLeaderPrompt.textContent = `"${pendingPreviewLesson.title}" (Leader) — video, handout, or prep?`;
  settingsVariantPicker.classList.add('hidden');
  settingsLeaderPicker.classList.remove('hidden');
});

settingsLeaderVideoBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson || !pendingPreviewLesson.leaderDownloadUrl) return;
  runPickerChoice('leader', pendingPreviewLesson);
});

settingsLeaderHandoutBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('handout', pendingPreviewLesson);
});

settingsLeaderPrepBtn.addEventListener('click', () => {
  if (!pendingPreviewLesson) return;
  runPickerChoice('leader-prep', pendingPreviewLesson);
});

settingsLeaderBackBtn.addEventListener('click', () => {
  settingsLeaderPicker.classList.add('hidden');
  settingsVariantPicker.classList.remove('hidden');
});

/* ── The picker's last step, here or relayed from a configure page ────
   Every final choice in the picker acts on the SCREEN (plays a lesson, puts
   the slides, a handout or a prep over the wall), so on a configure page it
   is not run at all: it is posted on the 'awana-configure' BroadcastChannel
   as { screen: 'journey', action: 'pick', data: { week, choice } }, the same
   shape as the lobby's relayToScreen(), and the live kiosk in the same
   browser profile runs it through the very same PICKER_CHOICES entry its own
   button would. A BroadcastChannel never leaves this origin in this browser
   profile, and nothing answers it: if no kiosk is open, nothing happens. */
const PICKER_CHOICES = {
  student: (lesson) => {
    closeSettingsPanel();
    requestPlayback(captionUrlFor(lesson.week, 'student'), () => playStudentPreview(lesson));
  },
  leader: (lesson) => {
    closeSettingsPanel();
    requestPlayback(captionUrlFor(lesson.week, 'leader'), () => playLeaderPreview(lesson));
  },
  slides: (lesson) => {
    closeSettingsPanel();
    startSlidesPreview(lesson.week);
  },
  handout: (lesson) => {
    openHandout(lesson);
    closeSettingsPanel();
  },
  'student-prep': (lesson) => {
    openPrep(lesson, 'student');
    closeSettingsPanel();
  },
  'leader-prep': (lesson) => {
    openPrep(lesson, 'leader');
    closeSettingsPanel();
  },
};
// The Leader side of the picker is disabled for a week with no Leader Video
// (27), so a relay may not reach these for one either.
const PICKER_NEEDS_LEADER = ['leader', 'handout', 'leader-prep'];
const PICKER_LABELS = {
  student: 'Student Video',
  leader: 'Leader Video',
  slides: 'teaching slides',
  handout: 'Leader Handout',
  'student-prep': 'Student Prep',
  'leader-prep': 'Leader Prep',
};

function runPickerChoice(choice, lesson) {
  if (!CONFIGURE_MODE) {
    PICKER_CHOICES[choice](lesson);
    return;
  }
  relayToKiosk('pick', { week: lesson.week, choice });
  // The panel stays (it is the page); it goes back to the list and says
  // where the choice went, because nothing changes on this screen.
  resetSettingsPanelToList();
  settingsPreviewNote.textContent =
    `Sent to the Journey screen: Week ${lesson.week}, ${PICKER_LABELS[choice]}.`;
}

function relayToKiosk(action, data) {
  try {
    const channel = new BroadcastChannel(CONFIGURE_CHANNEL);
    channel.postMessage({ screen: 'journey', action, data });
    channel.close();
  } catch {
    // No BroadcastChannel: the button simply does nothing.
  }
}

/* The live kiosk's side. Only 'pick' is allowed, and its data is checked as
   strictly as a click would be: a choice from PICKER_CHOICES, a week this
   kiosk's own lessons.json knows, and a Leader Video for the Leader side.
   Returns whether it acted (the tests read that). */
const RELAY_ACTIONS = ['pick'];

function handleConfigureRelay(message) {
  if (CONFIGURE_MODE) return false;
  if (!message || typeof message !== 'object' || message.screen !== 'journey') return false;
  if (!RELAY_ACTIONS.includes(message.action)) return false;
  const data = message.data;
  if (!data || typeof data !== 'object' || !Number.isInteger(data.week)) return false;
  const choice = data.choice;
  if (typeof choice !== 'string' || !Object.prototype.hasOwnProperty.call(PICKER_CHOICES, choice)) return false;
  if (!allLessons) {
    // Warmed at startup, so this is only a relay in the first seconds after a
    // boot: take it once the list is in.
    loadAllLessons().then((lessons) => { if (lessons) handleConfigureRelay(message); });
    return false;
  }
  const lesson = allLessons.find((l) => l && l.week === data.week);
  if (!lesson) return false;
  if (PICKER_NEEDS_LEADER.includes(choice) && !lesson.leaderDownloadUrl) return false;
  // On the kiosk the picker cannot be reached under a reading overlay, so one
  // left open is closed first rather than covering what was asked for.
  if (readerOverlayOpen()) {
    closeHandout();
    closePrep();
  }
  // The operator's click in the configure page stands in for one on the
  // kiosk. A browser that disagrees refuses the unmuted play, and every play
  // path already falls back to muted.
  audioUnlocked = true;
  PICKER_CHOICES[choice](lesson);
  return true;
}

// Kept in a binding so it is never collected while the kiosk runs.
const configureChannel = (() => {
  if (CONFIGURE_MODE || typeof BroadcastChannel === 'undefined') return null;
  try {
    const channel = new BroadcastChannel(CONFIGURE_CHANNEL);
    channel.onmessage = (event) => handleConfigureRelay(event.data);
    return channel;
  } catch {
    return null;
  }
})();

/* ── Teaching slides (after the lesson video) ─────────────────────────
   Each Advocates lesson ships a 5-slide "Teaching Slides" deck on the
   course page: title, core verse, misconception, illumination, and a
   blank TEMPLATE (heading + three empty bullets) for the leader to fill.
   scripts/render-teaching-slides.py renders slides 1-4 of every week into
   public/slides/week-NN/slide-N.jpg and extracts the template's bare
   background as template.jpg; public/teaching-slides.json carries the deck
   metadata plus, per week, the three generated "fills" for that template
   (Talk About It / Remember This / This Week), written from the week's
   Leader Video transcript and rendered here as HTML text over the
   background so they stay crisp and editable.

   When any lesson video ends — the scheduled show or a picker preview —
   startTeachingSlides() takes over the Journey layer: the deck's slides,
   then whichever generated slides Settings has ticked. A leader drives it
   (Space / → / Enter next, ← back, tap the slide, or the Prev/Next bar);
   an optional auto-advance interval from Settings ticks it along too, and
   any manual step resets that timer. "Finish" on the last slide (or the
   auto-advance running off the end) hands control to whatever the video's
   own ending used to do: back to the Check-in Display for the scheduled
   show, endPreview() for a preview. The ⇄ button and the 7:15 boundary tear
   the slideshow down through stopJourneyContent() like everything else.

   Preferences live in localStorage (per device, like the caption choice):
   journey.slides.autoAdvanceSec (0 = manual) and journey.slides.extras
   ({questions, takeaways, challenges} booleans, all on by default). */
const TEACHING_SLIDES_URL = 'teaching-slides.json';
const DECK_SLIDE_COUNT_DEFAULT = 4; // every Advocates deck has 4 slides + the template
const SLIDES_AUTO_KEY = 'journey.slides.autoAdvanceSec';
const SLIDES_EXTRAS_KEY = 'journey.slides.extras';
const SLIDE_EXTRA_KINDS = ['questions', 'takeaways', 'challenges'];
const SLIDE_HEADINGS_DEFAULT = {
  questions: 'Talk About It',
  takeaways: 'Remember This',
  challenges: 'This Week',
};


function weekTag(week) {
  return `week-${String(week).padStart(2, '0')}`;
}

function slideImageUrl(week, n) {
  return `slides/${weekTag(week)}/slide-${n}.jpg`;
}

function slideTemplateUrl(week) {
  return `slides/${weekTag(week)}/template.jpg`;
}

function teachingSlidesFor(week) {
  const weeks = teachingSlides && teachingSlides.weeks;
  return (weeks && weeks[String(week)]) || null;
}

function deckSlideCount(week) {
  const w = teachingSlidesFor(week);
  return w && Number.isInteger(w.slides) && w.slides > 0 ? w.slides : DECK_SLIDE_COUNT_DEFAULT;
}

// Same cache-first shape as lessons.json (see loadAllLessons): a good copy
// is kept in the assets cache so the slide fills work with the network dead.
function adoptTeachingSlides(data) {
  if (!data || typeof data !== 'object' || !data.weeks || typeof data.weeks !== 'object') return false;
  teachingSlides = data;
  return true;
}

async function fetchTeachingSlidesJson() {
  const res = await fetchWithTimeout(TEACHING_SLIDES_URL, {}, 5000);
  if (!res.ok) throw new Error(`${TEACHING_SLIDES_URL} ${res.status}`);
  const text = await res.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.weeks) throw new Error(`${TEACHING_SLIDES_URL}: unexpected shape`);
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      await cache.put(TEACHING_SLIDES_URL, new Response(text, { headers: { 'content-type': 'application/json' } }));
    } catch {
      // Not storable right now — still usable live.
    }
  }
  return data;
}

async function loadTeachingSlides() {
  if (teachingSlides) return teachingSlides;
  if ('caches' in window) {
    try {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const hit = await cache.match(TEACHING_SLIDES_URL);
      if (hit && adoptTeachingSlides(await hit.json())) {
        fetchTeachingSlidesJson().then(adoptTeachingSlides, () => {});
        return teachingSlides;
      }
    } catch {
      // fall through to the network
    }
  }
  try {
    adoptTeachingSlides(await fetchTeachingSlidesJson());
  } catch (err) {
    console.warn('Journey: teaching-slides.json unavailable —', err);
  }
  return teachingSlides;
}

function slidesAutoAdvanceSec() {
  try {
    const v = Number(localStorage.getItem(SLIDES_AUTO_KEY));
    return Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

function slidesExtras() {
  const extras = { questions: true, takeaways: true, challenges: true };
  try {
    const stored = JSON.parse(localStorage.getItem(SLIDES_EXTRAS_KEY) || 'null');
    if (stored && typeof stored === 'object') {
      for (const k of SLIDE_EXTRA_KINDS) if (typeof stored[k] === 'boolean') extras[k] = stored[k];
    }
  } catch {
    // unreadable → defaults
  }
  return extras;
}

function storeSlidesPrefs() {
  try {
    localStorage.setItem(SLIDES_AUTO_KEY, String(Number(slidesAutoAdvanceSelect.value) || 0));
    const extras = {};
    for (const k of SLIDE_EXTRA_KINDS) extras[k] = slidesExtraInputs[k].checked;
    localStorage.setItem(SLIDES_EXTRAS_KEY, JSON.stringify(extras));
  } catch {
    // Preference just won't survive a reload. Fine.
  }
}

function syncSlidesPrefInputs() {
  const sec = String(slidesAutoAdvanceSec());
  slidesAutoAdvanceSelect.value = Array.from(slidesAutoAdvanceSelect.options).some((o) => o.value === sec) ? sec : '0';
  const extras = slidesExtras();
  for (const k of SLIDE_EXTRA_KINDS) slidesExtraInputs[k].checked = extras[k];
}

syncSlidesPrefInputs();
slidesAutoAdvanceSelect.addEventListener('change', storeSlidesPrefs);
for (const k of SLIDE_EXTRA_KINDS) {
  slidesExtraInputs[k].addEventListener('change', storeSlidesPrefs);
  // The bullet editor labels each kind with whether it's actually shown.
  slidesExtraInputs[k].addEventListener('change', () => {
    if (!notesEditBody.classList.contains('hidden')) renderNotesEditor();
  });
}

/* ── Tonight's bullets, editable on the kiosk ─────────────────────────
   The three generated slides (Talk About It / Remember This / This Week)
   are written from the Leader Video's transcript into
   public/teaching-slides.json, so changing one word costs a repo edit, a
   deploy, and the ten-minute Pages cache. A leader who wants to ask a
   different question tonight — or who spots an awkward line five minutes
   before club — has neither.

   So: a per-device override, stored under journey.slides.notesOverride and
   keyed by week and kind, which buildSlideItems() prefers over the written
   text. public/teaching-slides.json is never touched and stays the
   canonical, hand-edited source; an override is this device's own copy of
   tonight's bullets, exactly like the caption and auto-advance
   preferences. Only kinds that actually DIFFER from the written bullets
   are stored, so a later correction to the JSON still reaches every kind
   the leader left alone. Nothing marks an override on the slide itself
   (the wall must look the same either way), so Settings carries an
   "Edited on this device" badge and a Reset instead — an override that
   nobody can see is worse than no override at all. */
const SLIDE_NOTES_OVERRIDE_KEY = 'journey.slides.notesOverride';
const SLIDE_BULLET_MAX_CHARS = 80; // the deck's own limit, which fitTemplateText() assumes
const SLIDE_BULLETS_PER_KIND = 3;

// One slide bullet is one line: a textarea's newlines would otherwise turn
// into an unpredictable wrap on a 4:3 stage read from across a room.
function cleanBullet(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SLIDE_BULLET_MAX_CHARS);
}

// The whole override blob, shape-checked on the way out and capped on both
// axes: this is device storage, which a browser (or a person with devtools)
// can leave in any state at all.
function slideNotesOverrides() {
  try {
    const raw = JSON.parse(localStorage.getItem(SLIDE_NOTES_OVERRIDE_KEY) || 'null');
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const week of Object.keys(raw)) {
      const byKind = raw[week];
      if (!/^\d+$/.test(week) || !byKind || typeof byKind !== 'object') continue;
      const kinds = {};
      for (const kind of SLIDE_EXTRA_KINDS) {
        if (!Array.isArray(byKind[kind])) continue;
        const bullets = byKind[kind]
          .map(cleanBullet)
          .filter(Boolean)
          .slice(0, SLIDE_BULLETS_PER_KIND);
        if (bullets.length) kinds[kind] = bullets;
      }
      if (Object.keys(kinds).length) out[week] = kinds;
    }
    return out;
  } catch {
    return {}; // unreadable/blocked storage → the written bullets, as if never edited
  }
}

function slideNotesOverrideFor(week) {
  return slideNotesOverrides()[String(week)] || null;
}

/* Replaces one week's whole override (a falsy/empty `kinds` clears it).
   Returns whether anything is stored for that week afterward — or null if
   the write itself failed, which the editor has to say out loud: the
   slideshow reads these back out of storage, so an edit that could not be
   stored did not take at all. */
function storeSlideNotesOverride(week, kinds) {
  const all = slideNotesOverrides();
  const key = String(week);
  if (kinds && Object.keys(kinds).length) all[key] = kinds;
  else delete all[key];
  try {
    if (Object.keys(all).length) {
      localStorage.setItem(SLIDE_NOTES_OVERRIDE_KEY, JSON.stringify(all));
    } else {
      localStorage.removeItem(SLIDE_NOTES_OVERRIDE_KEY);
    }
  } catch {
    return null; // storage blocked (kiosk/private mode) or full
  }
  return !!all[key];
}

// The written bullets for a week, normalised the same way a typed one is so
// the two can be compared honestly.
function writtenSlideNotesFor(week) {
  const w = teachingSlidesFor(week);
  const notes = w && w.notes && typeof w.notes === 'object' ? w.notes : {};
  const out = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (!Array.isArray(notes[kind])) continue;
    out[kind] = notes[kind].map(cleanBullet).filter(Boolean).slice(0, SLIDE_BULLETS_PER_KIND);
  }
  return out;
}

/* What buildSlideItems() should actually show: the written bullets, with any
   kind this device has overridden replacing that kind wholesale. Pure — it
   reads storage but never writes it. */
function slideNotesFor(week) {
  const w = teachingSlidesFor(week);
  const written = w && w.notes && typeof w.notes === 'object' ? w.notes : {};
  const override = slideNotesOverrideFor(week);
  const notes = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (override && override[kind]) notes[kind] = override[kind];
    else if (Array.isArray(written[kind])) notes[kind] = written[kind].map(String);
  }
  return notes;
}

/* Only tonight's lesson is editable. It is the one that will be on the wall
   in a few minutes, and naming a single week keeps the panel honest about
   what "Edited on this device" and Reset actually refer to. */
function editableNotesWeek() {
  return currentLesson && Number.isInteger(currentLesson.week) ? currentLesson.week : null;
}

let notesEditSaveTimer = null;

function updateNotesEditedBadge() {
  const week = editableNotesWeek();
  const edited = week !== null && !!slideNotesOverrideFor(week);
  notesEditedBadge.classList.toggle('hidden', !edited);
  notesResetBtn.classList.toggle('hidden', !edited);
}

function renderNotesEditor() {
  notesEditGroups.textContent = '';
  notesEditStatus.textContent = '';
  const week = editableNotesWeek();
  if (week === null) {
    notesEditWeek.textContent =
      'Tonight’s lesson hasn’t loaded yet, so there are no bullets to edit.';
    updateNotesEditedBadge();
    return;
  }
  if (!teachingSlides) {
    // Nothing is awaited before the editor renders — it says so and fills
    // itself in if teaching-slides.json turns up.
    notesEditWeek.textContent = `Week ${week} — loading the written bullets…`;
    loadTeachingSlides().then(() => {
      if (!settingsPanel.classList.contains('hidden') && !notesEditBody.classList.contains('hidden')) {
        renderNotesEditor();
      }
    });
    updateNotesEditedBadge();
    return;
  }
  const title = currentLesson && currentLesson.title ? ` — ${currentLesson.title}` : '';
  notesEditWeek.textContent =
    `Week ${week}${title}. Saved on this kiosk only; the written bullets are left alone. ` +
    `Clear a line to drop it, or clear all three to go back to what was written.`;
  const headings = Object.assign({}, SLIDE_HEADINGS_DEFAULT, (teachingSlides && teachingSlides.headings) || {});
  const notes = slideNotesFor(week);
  const extras = slidesExtras();
  for (const kind of SLIDE_EXTRA_KINDS) {
    const group = document.createElement('div');
    group.className = 'notes-edit-group';
    const heading = document.createElement('p');
    heading.className = 'notes-edit-heading';
    heading.textContent = extras[kind]
      ? headings[kind]
      : `${headings[kind]} (not ticked — this slide isn’t shown)`;
    group.appendChild(heading);
    const existing = Array.isArray(notes[kind]) ? notes[kind] : [];
    for (let i = 0; i < SLIDE_BULLETS_PER_KIND; i++) {
      const field = document.createElement('textarea');
      field.className = 'notes-edit-input';
      field.rows = 2;
      field.maxLength = SLIDE_BULLET_MAX_CHARS;
      field.dataset.kind = kind;
      field.value = existing[i] || ''; // a value, never innerHTML
      field.setAttribute('aria-label', `${headings[kind]} — bullet ${i + 1}`);
      field.addEventListener('input', scheduleNotesSave);
      group.appendChild(field);
    }
    notesEditGroups.appendChild(group);
  }
  updateNotesEditedBadge();
}

function saveNotesEditor() {
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = null;
  const week = editableNotesWeek();
  const fields = notesEditGroups.querySelectorAll('textarea');
  if (week === null || !fields.length) return; // never rendered — nothing to commit
  const typed = {};
  for (const field of fields) {
    const bullet = cleanBullet(field.value);
    if (!bullet) continue; // a blank line is simply one fewer bullet
    const kind = field.dataset.kind;
    (typed[kind] || (typed[kind] = [])).push(bullet);
  }
  const written = writtenSlideNotesFor(week);
  const kinds = {};
  for (const kind of SLIDE_EXTRA_KINDS) {
    const bullets = (typed[kind] || []).slice(0, SLIDE_BULLETS_PER_KIND);
    if (!bullets.length) continue; // all three cleared → back to the written bullets
    if ((written[kind] || []).join('\n') === bullets.join('\n')) continue; // unchanged
    kinds[kind] = bullets;
  }
  const stored = storeSlideNotesOverride(week, kinds);
  notesEditStatus.textContent =
    stored === null
      ? 'This kiosk’s browser won’t store settings, so the edit didn’t take.'
      : stored
        ? 'Saved on this device'
        : 'Using the written bullets';
  updateNotesEditedBadge();
}

// Typing writes through a short debounce rather than on every keystroke —
// this is a single-core Pi, and JSON.stringify per character is silly.
function scheduleNotesSave() {
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = setTimeout(saveNotesEditor, 500);
}

notesEditToggle.addEventListener('click', () => {
  const opening = notesEditBody.classList.contains('hidden');
  notesEditToggle.setAttribute('aria-expanded', String(opening));
  if (opening) renderNotesEditor(); // built from memory + localStorage; nothing awaited
  else saveNotesEditor(); // collapsing commits whatever is in the boxes
  notesEditBody.classList.toggle('hidden', !opening);
});

notesResetBtn.addEventListener('click', () => {
  const week = editableNotesWeek();
  if (week === null) return;
  clearTimeout(notesEditSaveTimer);
  notesEditSaveTimer = null;
  storeSlideNotesOverride(week, null);
  renderNotesEditor();
  notesEditStatus.textContent = 'Reset to the written bullets';
});

function buildSlideItems(week) {
  if (!Number.isInteger(week) || week < 1) return [];
  const items = [];
  const count = deckSlideCount(week);
  for (let n = 1; n <= count; n++) items.push({ type: 'image', url: slideImageUrl(week, n) });
  // slideNotesFor() is the written bullets with this device's own edits
  // layered on top (see the block above) — teaching-slides.json itself is
  // never modified.
  const notes = slideNotesFor(week);
  const headings = Object.assign({}, SLIDE_HEADINGS_DEFAULT, (teachingSlides && teachingSlides.headings) || {});
  const extras = slidesExtras();
  for (const kind of SLIDE_EXTRA_KINDS) {
    if (!extras[kind] || !notes || !Array.isArray(notes[kind]) || !notes[kind].length) continue;
    items.push({
      type: 'template',
      heading: headings[kind],
      bullets: notes[kind].map(String),
      url: slideTemplateUrl(week),
    });
  }
  return items;
}


function slideshowActive() {
  return slideshow !== null;
}

/* Serve a prefetched slide from the cache as a blob URL (memoized per
   slideshow, all revoked in stopTeachingSlides), else the plain URL. */
function resolveSlideUrl(show, url) {
  if (show.blobUrls.has(url)) return show.blobUrls.get(url);
  const pending = (async () => {
    if ('caches' in window) {
      try {
        const hit = await caches.match(url);
        if (hit) {
          const blobUrl = URL.createObjectURL(await hit.blob());
          if (slideshow !== show) {
            URL.revokeObjectURL(blobUrl); // torn down while reading
            return url;
          }
          return blobUrl;
        }
      } catch {
        // fall through to the live URL
      }
    }
    return url;
  })();
  show.blobUrls.set(url, pending); // memoized as a promise: one blob per URL, ever
  return pending;
}

function startTeachingSlides(week, onFinish) {
  const items = buildSlideItems(week);
  if (!items.length) return false;
  stopTeachingSlides();
  ++journeyRequestToken; // nothing in flight should touch the video now
  slideshow = { week, items, index: 0, onFinish, blobUrls: new Map(), errors: 0 };
  // Release the video the same way stopJourneyContent() does — a decoded
  // ~17MB blob has no business staying resident behind a slideshow.
  journeyVideo.pause();
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
  journeyVideo.classList.add('hidden');
  videoControls.classList.add('hidden');
  videoControls.classList.remove('force-visible');
  hideVideoLoading();
  removeCaptionTracks();
  ccBtn.classList.add('hidden');
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  journeySplash.classList.add('hidden');
  journeyPlaceholder.classList.add('hidden');
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  slidesView.classList.remove('hidden');
  showSlide(0);
  return true;
}

function showSlide(index) {
  const show = slideshow;
  if (!show) return;
  show.index = index;
  const item = show.items[index];
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  slideCounter.textContent = `Slide ${index + 1} of ${show.items.length}`;
  slidePrevBtn.disabled = index === 0;
  slideNextBtn.textContent = index === show.items.length - 1 ? 'Finish ✓' : 'Next →';
  if (item.type === 'image') {
    slideTemplate.classList.add('hidden');
    slideTemplate.style.backgroundImage = '';
    slideImage.classList.remove('hidden');
    resolveSlideUrl(show, item.url).then((src) => {
      if (slideshow !== show || show.index !== index) return;
      slideImage.src = src;
    });
  } else {
    slideImage.classList.add('hidden');
    slideImage.removeAttribute('src');
    slideTemplateHeading.textContent = item.heading;
    slideTemplateBullets.textContent = '';
    for (const bullet of item.bullets) {
      const li = document.createElement('li');
      li.textContent = bullet;
      slideTemplateBullets.appendChild(li);
    }
    slideTemplate.classList.remove('hidden');
    fitTemplateText();
    resolveSlideUrl(show, item.url).then((src) => {
      if (slideshow !== show || show.index !== index) return;
      slideTemplate.style.backgroundImage = `url("${src}")`;
    });
  }
  // Warm the next slide so the step lands instantly.
  const next = show.items[index + 1];
  if (next) {
    resolveSlideUrl(show, next.url).then((src) => {
      if (slideshow !== show) return;
      const img = new Image();
      img.src = src;
    });
  }
  const sec = slidesAutoAdvanceSec();
  if (sec > 0) slideAutoTimer = setTimeout(nextSlide, sec * 1000);
}

/* Three long bullets can outgrow the 4:3 stage on a short screen; step the
   list's type down until it fits rather than letting it spill off the
   slide (each bullet is capped at 80 characters, so this rarely fires). */
function fitTemplateText() {
  slideTemplateBullets.style.fontSize = '';
  const base = parseFloat(getComputedStyle(slideTemplateBullets).fontSize) || 24;
  let size = base;
  let guard = 12;
  while (guard-- > 0 && slideTemplateBullets.scrollHeight > slideTemplateBullets.clientHeight + 1 && size > base * 0.55) {
    size *= 0.92;
    slideTemplateBullets.style.fontSize = `${size}px`;
  }
}

window.addEventListener('resize', () => {
  if (slideshow && !slideTemplate.classList.contains('hidden')) fitTemplateText();
});

function nextSlide() {
  if (!slideshow) return;
  if (slideshow.index >= slideshow.items.length - 1) {
    finishTeachingSlides();
    return;
  }
  showSlide(slideshow.index + 1);
}

function prevSlide() {
  if (!slideshow || slideshow.index === 0) return;
  showSlide(slideshow.index - 1);
}

function finishTeachingSlides() {
  const show = slideshow;
  stopTeachingSlides();
  // The whole showing (video + slides) is done. Not for a preview: its
  // slides say nothing about where the scheduled lesson got to, and
  // previewMode is still set until onFinish() runs endPreview().
  if (!previewMode) clearResumePoint();
  if (show && typeof show.onFinish === 'function') show.onFinish();
}

function stopTeachingSlides() {
  clearTimeout(slideAutoTimer);
  slideAutoTimer = null;
  if (!slideshow) return;
  const show = slideshow;
  slideshow = null;
  slidesView.classList.add('hidden');
  slideImage.removeAttribute('src');
  slideTemplate.classList.add('hidden');
  slideTemplate.style.backgroundImage = '';
  slideTemplateBullets.textContent = '';
  slideTemplateBullets.style.fontSize = '';
  for (const pending of show.blobUrls.values()) {
    pending.then((u) => {
      if (typeof u === 'string' && u.startsWith('blob:')) URL.revokeObjectURL(u);
    }, () => {});
  }
}

// A slide image that can't load (never rendered, storage evicted, offline
// and uncached) skips ahead instead of leaving a black frame — bounded so a
// deck with nothing loadable ends instead of spinning.
slideImage.addEventListener('error', () => {
  if (!slideshow || slideImage.classList.contains('hidden')) return;
  const item = slideshow.items[slideshow.index];
  if (!item || item.type !== 'image') return; // a stale error for a slide we already left
  slideshow.errors += 1;
  if (slideshow.errors > slideshow.items.length) {
    finishTeachingSlides();
    return;
  }
  nextSlide();
});

slidePrevBtn.addEventListener('click', prevSlide);
slideNextBtn.addEventListener('click', () => {
  audioUnlocked = true;
  nextSlide();
});
// Tap/click the slide itself: left third steps back, the rest steps forward.
slideStage.addEventListener('click', (e) => {
  if (!slideshow) return;
  const rect = slideStage.getBoundingClientRect();
  if (e.clientX - rect.left < rect.width / 3) prevSlide();
  else nextSlide();
});

// Warm the lesson list + captions manifest at startup rather than on the
// first Settings press, and store lessons.json for offline use. Failure is
// fine — openSettingsPanel() retries and shows its own error state. (Kept at
// the very end of the script: it reads `allLessons`, a `let` that must be
// past its declaration before any call runs.)
loadAllLessons();
loadTeachingSlides();
// Small (~58KB) and only read when a leader presses "Read Prep" — but warmed
// here, because the whole point is that it opens on a dead connection. (A
// configure page never opens a prep itself: it relays the choice.)
if (!CONFIGURE_MODE) loadLeaderPrep();

/* ── Settings saved by another window, taken live ─────────────────────
   The configure page beside the kiosk (and the kiosk's own sync, run from
   either window) writes the same localStorage, and a 'storage' event fires
   in every OTHER window of the origin. Each key below is re-applied through
   the function its own control uses, so the kiosk ends up exactly where it
   would be had the change been made on it. The embedded Check-in Display
   writes this storage too (its own awana* keys), so anything not listed
   costs one lookup and nothing else: this is a Pi Zero. The sync session
   (awanaSyncSession.v1) is sync.js's to watch. */
const LIVE_STORAGE_KEYS = {
  [CAPTION_PREF_KEY]: () => {
    // Applied to a video already on screen too, which is what pressing CC
    // here would have done.
    const on = storedCaptionPref();
    if (on === null || on === captionsEnabled) return;
    captionsEnabled = on;
    if (journeyVideo.hasAttribute('src')) applyCaptions();
  },
  [CAPTION_SIZE_KEY]: () => {
    syncCaptionPrefInputs();
    applyCaptionDisplayPrefs();
  },
  [PLAYBACK_QUALITY_KEY]: () => {
    profileCache = null; // the cached answer is the old choice's
    applyCheckinDisplayUrl();
    syncQualityButtons();
  },
  [SLIDES_AUTO_KEY]: () => syncSlidesPrefInputs(),
  [SLIDE_NOTES_OVERRIDE_KEY]: () => {
    updateNotesEditedBadge();
    refreshOpenNotesEditor();
  },
};
LIVE_STORAGE_KEYS[CAPTION_BACKDROP_KEY] = LIVE_STORAGE_KEYS[CAPTION_SIZE_KEY];
LIVE_STORAGE_KEYS[SLIDES_EXTRAS_KEY] = () => {
  syncSlidesPrefInputs();
  refreshOpenNotesEditor(); // its headings say which kinds are ticked
};

// Never under someone's fingers: an editor being typed in keeps its words.
function refreshOpenNotesEditor() {
  if (notesEditBody.classList.contains('hidden') || notesEditBody.contains(document.activeElement)) return;
  renderNotesEditor();
}

function applyStoredSetting(key) {
  if (key === null) {
    // localStorage.clear() somewhere: everything is back to its default.
    for (const apply of new Set(Object.values(LIVE_STORAGE_KEYS))) apply();
    return;
  }
  const apply = Object.prototype.hasOwnProperty.call(LIVE_STORAGE_KEYS, key) ? LIVE_STORAGE_KEYS[key] : null;
  if (apply) apply();
}

window.addEventListener('storage', (event) => applyStoredSetting(event.key));

/* A configure page opens on the panel, for good: no close button, and the
   note above the list says where a pick goes. */
if (CONFIGURE_MODE) {
  settingsCloseBtn.hidden = true;
  settingsPreviewNote.textContent =
    'Picking a video here plays it once on the Journey screen. It never changes what plays automatically at 6:30 PM.';
  openSettingsPanel();
  // The bullet editor saves on a short debounce; a window closed inside it
  // must not lose the last words typed.
  window.addEventListener('pagehide', () => {
    if (!notesEditBody.classList.contains('hidden')) saveNotesEditor();
  });
}

/* The brand kit's fonts are self-hosted (brand/fonts.css), but a browser only
   fetches a web font once text set in it is actually rendered, and on this
   kiosk that first happens at the 6:30 splash: in the evening, on the
   connection this page already distrusts. So all three are asked for here,
   while the Check-in Display is up and nothing is waiting on them. A loaded
   face stays loaded for the life of the page, which on the kiosk is the whole
   day. Fire and forget: nothing awaits this, and a failure only means the
   splash uses the fallback faces the tokens name. */
const BRAND_FONT_FACES = ['400 1em "Paytone One"', '400 1em "Londrina Solid"', '400 1em Figtree'];

function warmBrandFonts() {
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  for (const face of BRAND_FONT_FACES) {
    try {
      fonts.load(face).catch(() => {});
    } catch {
      // A browser that rejects the shorthand outright: fallbacks it is.
    }
  }
}
warmBrandFonts();

/* ── Self-updating kiosk ──────────────────────────────────────────────
   The Pi is wall-mounted and nobody wants to SSH in or find a keyboard to
   press F5 after a deploy. So the page notices a new build and reloads
   itself, with two hard rules: never onto the old page, and never while a
   room is watching something.

   How it knows: deploy.yml runs scripts/stamp-build.mjs, which writes
   version.json and stamps the same commit SHA into the journey-build meta
   of the page that was uploaded (and onto the asset URLs, so the reloaded
   page cannot keep running the previous deploy's schedule.js out of disk
   cache). This page compares the two.

   Missing version.json (a local checkout, a stale Pages cache, a 404) is
   "no news", never a reload: an unstamped page polls harmlessly forever.

   The freshness check exists because Pages' max-age=600 applies to
   index.html too. version.json can report a new build minutes before the
   CDN edge serving this kiosk stops handing back the old page, and a reload
   onto the old page looks exactly like "the deploy did not take". So the
   new SHA has to be visible in a freshly fetched index.html before anything
   reloads; if it is not, the next tick tries again. */
const VERSION_POLL_MS = 3 * 60 * 1000;
const VERSION_BUSY_RECHECK_MS = 15000;
const VERSION_ONLINE_MIN_GAP_MS = 60 * 1000;

// The build this page is running, read fresh rather than cached at load, so
// there is exactly one source for it: the document itself.
function currentBuildId() {
  const meta = document.querySelector(`meta[name="journey-build"]`);
  const value = meta && meta.getAttribute('content');
  return typeof value === 'string' ? value.trim() : '';
}

function buildIdInHtml(html) {
  const tag = /<meta[^>]*name=["']journey-build["'][^>]*>/i.exec(String(html));
  if (!tag) return '';
  const content = /content=["']([^"']*)["']/i.exec(tag[0]);
  return content ? content[1].trim() : '';
}

let pendingBuild = null; // a newer build we have seen and are waiting to take
let versionBusyTimer = null;
let lastVersionCheckMs = 0;

/* Nothing is on screen that a reload would interrupt. A lesson playing, the
   slides up, a preview, a reading overlay, the Settings panel, the caption
   question, someone typing bullets, or the splash waiting for a leader to
   press Begin: all of those are the room's, not ours. In practice this means
   the Check-in Display is showing, or the Journey window has ended. */
function safeToReload() {
  const el = document.activeElement;
  const typing =
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  return (
    !previewMode &&
    !slideshowActive() &&
    journeyVideo.classList.contains('hidden') &&
    !journeyVideo.hasAttribute('src') &&
    !readerOverlayOpen() &&
    settingsPanel.classList.contains('hidden') &&
    !isCaptionPromptOpen() &&
    !isAwaitingPlay() &&
    !typing
  );
}

// One indirection, so a test can watch for the reload without navigating.
function reloadPage() {
  location.reload();
}

function scheduleBusyRecheck() {
  if (versionBusyTimer) return;
  versionBusyTimer = setTimeout(() => {
    versionBusyTimer = null;
    takeNewBuild();
  }, VERSION_BUSY_RECHECK_MS);
}

async function takeNewBuild() {
  if (!pendingBuild) return;
  if (!safeToReload()) {
    scheduleBusyRecheck();
    return;
  }
  let html;
  try {
    const res = await fetchWithTimeout(`index.html?b=${Date.now()}`, { cache: 'no-store' }, 5000);
    if (!res.ok) return; // try again on the next tick
    html = await res.text();
  } catch {
    return;
  }
  // Still the old page at this edge: reloading now would land back on the
  // build we are already running.
  if (buildIdInHtml(html) !== pendingBuild) return;
  // Re-checked after the await: a leader can have started the lesson while
  // that request was in flight.
  if (!safeToReload()) {
    scheduleBusyRecheck();
    return;
  }
  console.log(`Journey: reloading for build ${pendingBuild}`);
  reloadPage();
}

async function checkForNewBuild() {
  lastVersionCheckMs = Date.now();
  const mine = currentBuildId();
  if (!mine) return; // a page with no build id has nothing to compare
  if (pendingBuild) {
    takeNewBuild(); // already know; this tick is just another chance to take it
    return;
  }
  let data;
  try {
    const res = await fetchWithTimeout(
      `version.json?b=${Date.now()}`,
      { cache: 'no-store' },
      5000
    );
    if (!res.ok) return; // no version.json: nothing to compare, no news
    data = await res.json();
  } catch {
    return;
  }
  const build = data && typeof data.build === 'string' ? data.build.trim() : '';
  if (!build || build === mine) return;
  console.log(`Journey: a newer build is deployed (${build}); this page is ${mine}`);
  pendingBuild = build;
  takeNewBuild();
}

// A configure page never reloads itself under the operator's typing (its
// open panel would hold safeToReload() off anyway); it takes a new build the
// next time it is opened.
if (!CONFIGURE_MODE) {
  setInterval(checkForNewBuild, VERSION_POLL_MS);
  // A kiosk that was offline through a deploy should not wait out the timer.
  // 'online' fires in bursts on flapping WiFi, so it is rate limited.
  window.addEventListener('online', () => {
    if (Date.now() - lastVersionCheckMs < VERSION_ONLINE_MIN_GAP_MS) return;
    checkForNewBuild();
  });
}
