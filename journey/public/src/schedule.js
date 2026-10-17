// Daily schedule: full-screen the Awana Check-in Display all day, except
// between JOURNEY_START and JOURNEY_END, when the Journey lesson video
// shows. See CLAUDE.md for the conventions around changing these
// constants, and for how the video content itself gets here.
const JOURNEY_START_MINUTES = 18 * 60 + 30; // 6:30 PM
const JOURNEY_END_MINUTES = 19 * 60 + 30; // 7:30 PM (owner 2026-10-17; was 7:15)
// Club nights only (the lobby's rule, shared/clubNight.js): Trek's small
// group time, a full-screen title card from 7:00 to 7:30 PM. It takes the
// Journey window's last half hour on those nights, but never cuts a lesson
// that is still running (see 25-trek.js).
const TREK_START_MINUTES = 19 * 60; // 7:00 PM
const TREK_END_MINUTES = 19 * 60 + 30; // 7:30 PM
const POLL_INTERVAL_MS = 15000;
const LESSON_REFRESH_MS = 60 * 60 * 1000; // current-lesson.json only changes nightly
const VIDEO_CACHE_NAME = 'journey-videos-v1';
// Small same-origin documents (lessons.json) that make the UI answerable
// offline — kept separate from the video bucket, whose eviction logic
// deliberately clears everything but the current week's bundle.
const ASSET_CACHE_NAME = 'journey-assets-v1';

// fetch() has no timeout of its own: on the kiosk's flaky connection a hung
// request can sit unresolved for minutes, which is how "you click buttons and
// it doesn't respond" happened. Anything the UI is (indirectly) waiting on
// goes through this instead. AbortController is feature-checked because this
// runs on an oldish kiosk Chromium.
function fetchWithTimeout(url, options, timeoutMs) {
  if (typeof AbortController === 'undefined') return fetch(url, options);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/* Configure mode (`?configure=1`, exactly '1'): the sound room app's Settings
   window loads this page beside the live kiosk, in the same browser profile,
   and here the page is ONLY the Settings panel. Nothing of the kiosk runs:
   no schedule, no video, no splash, no bundle download, no wake lock, no
   self-update, and the Check-in Display frame is removed by index.html before
   it can load. What the panel saves goes to localStorage, which the live
   kiosk picks up through its storage listener; what the panel would DO to
   the screen (play a lesson, open a handout or a prep) is relayed to the
   live kiosk instead (relayToKiosk / handleConfigureRelay below). The same
   protocol as the lobby's (lobby/src/lib/configureRelay.js). */
const CONFIGURE_MODE = (() => {
  try {
    return new URLSearchParams(window.location.search).get('configure') === '1';
  } catch {
    return false;
  }
})();
const CONFIGURE_CHANNEL = 'awana-configure';
if (CONFIGURE_MODE) document.documentElement.classList.add('configure-mode');

const checkinView = document.getElementById('checkin-view');
const checkinFrame = document.getElementById('checkin-frame');
const journeyView = document.getElementById('journey-view');
const journeyPlaceholder = document.getElementById('journey-placeholder');
const journeySplash = document.getElementById('journey-splash');
const journeySplashWeek = document.getElementById('journey-splash-week');
const journeySplashTitle = document.getElementById('journey-splash-title');
const journeySplashPlayBtn = document.getElementById('journey-splash-play-btn');
const journeySplashResumeBtn = document.getElementById('journey-splash-resume-btn');
const journeySplashResumeLabel = document.getElementById('journey-splash-resume-label');
const journeySplashStartOverBtn = document.getElementById('journey-splash-startover-btn');
const journeySplashSlidesBtn = document.getElementById('journey-splash-slides-btn');
const journeyVideo = document.getElementById('journey-video');
const journeyLoading = document.getElementById('journey-loading');
const journeyLoadingNote = document.getElementById('journey-loading-note');
const videoControls = document.getElementById('video-controls');
const pauseBtn = document.getElementById('pause-btn');
const back15Btn = document.getElementById('back15-btn');
const fwd15Btn = document.getElementById('fwd15-btn');
const unmuteBtn = document.getElementById('unmute-btn');
const videoScrubber = document.getElementById('video-scrubber');
const videoTime = document.getElementById('video-time');
const toggleBtn = document.getElementById('toggle-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const settingsPreviewNote = document.getElementById('settings-preview-note');
const settingsLessonList = document.getElementById('settings-lesson-list');
const settingsVariantPicker = document.getElementById('settings-variant-picker');
const settingsVariantPrompt = document.getElementById('settings-variant-prompt');
const settingsVariantStudentBtn = document.getElementById('settings-variant-student');
const settingsVariantLeaderBtn = document.getElementById('settings-variant-leader');
const settingsVariantSlidesBtn = document.getElementById('settings-variant-slides');
const settingsVariantBackBtn = document.getElementById('settings-variant-back');
const settingsStudentPicker = document.getElementById('settings-student-picker');
const settingsStudentPrompt = document.getElementById('settings-student-prompt');
const settingsStudentVideoBtn = document.getElementById('settings-student-video');
const settingsStudentPrepBtn = document.getElementById('settings-student-prep');
const settingsStudentBackBtn = document.getElementById('settings-student-back');
const settingsLeaderPicker = document.getElementById('settings-leader-picker');
const settingsLeaderPrompt = document.getElementById('settings-leader-prompt');
const settingsLeaderVideoBtn = document.getElementById('settings-leader-video');
const settingsLeaderHandoutBtn = document.getElementById('settings-leader-handout');
const settingsLeaderPrepBtn = document.getElementById('settings-leader-prep');
const settingsLeaderBackBtn = document.getElementById('settings-leader-back');
const handoutView = document.getElementById('handout-view');
const handoutTitle = document.getElementById('handout-title');
const handoutCloseBtn = document.getElementById('handout-close-btn');
const handoutFrame = document.getElementById('handout-frame');
const prepView = document.getElementById('prep-view');
const prepTitle = document.getElementById('prep-title');
const prepBody = document.getElementById('prep-body');
const prepCloseBtn = document.getElementById('prep-close-btn');
const ccBtn = document.getElementById('cc-btn');
const captionPrompt = document.getElementById('caption-prompt');
const captionYesBtn = document.getElementById('caption-yes');
const captionNoBtn = document.getElementById('caption-no');
const captionOverlay = document.getElementById('caption-overlay');
const captionText = document.getElementById('caption-text');
const captionsSizeSelect = document.getElementById('captions-size');
const captionsBackdropInput = document.getElementById('captions-backdrop');
const slidesView = document.getElementById('slides-view');
const slideStage = document.getElementById('slide-stage');
const slideImage = document.getElementById('slide-image');
const slideTemplate = document.getElementById('slide-template');
const slideTemplateHeading = document.getElementById('slide-template-heading');
const slideTemplateBullets = document.getElementById('slide-template-bullets');
const slidePrevBtn = document.getElementById('slide-prev-btn');
const slideNextBtn = document.getElementById('slide-next-btn');
const slideCounter = document.getElementById('slide-counter');
const slidesAutoAdvanceSelect = document.getElementById('slides-auto-advance');
const slidesExtraInputs = {
  questions: document.getElementById('slides-extra-questions'),
  takeaways: document.getElementById('slides-extra-takeaways'),
  challenges: document.getElementById('slides-extra-challenges'),
};
const notesEditToggle = document.getElementById('notes-edit-toggle');
const notesEditBody = document.getElementById('notes-edit-body');
const notesEditWeek = document.getElementById('notes-edit-week');
const notesEditGroups = document.getElementById('notes-edit-groups');
const notesEditStatus = document.getElementById('notes-edit-status');
const notesEditedBadge = document.getElementById('notes-edited-badge');
const notesResetBtn = document.getElementById('notes-reset-btn');
const trekView = document.getElementById('trek-view');
const trekChip = document.getElementById('trek-chip');
const trekChipCount = document.getElementById('trek-chip-count');
const trekLesson = document.getElementById('trek-lesson');
const trekLessonTitle = document.getElementById('trek-lesson-title');
const journeyChip = document.getElementById('journey-chip');
const journeyChipCount = document.getElementById('journey-chip-count');
const gapView = document.getElementById('gap-view');
const gapWelcomeEls = {
  journey: document.getElementById('gap-welcome-journey'),
  trek: document.getElementById('gap-welcome-trek'),
};

// What the Trek card knows about tonight (25-trek.js fills it in). Declared up
// here because scheduledPhase() reads it from the very first setView() call,
// long before that file's own lines have run. `ready` stays false until the
// club-night rule itself has loaded: until then no night is a club night.
const trekNight = { ready: false, rule: null, schedule: null, feed: null };

// The club transition gaps (29-transition-gap.js), declared up here for the
// same reason: setView() asks about them. `rule` is the shared module
// (shared/transitionGap.js); until it has loaded there is no gap at all.
// `welcomes` holds tonight's gap welcomes' first names, in memory only.
const gapState = { rule: null, up: false, clubs: [], key: '', dismissed: '', welcomes: null, outTimer: null };

/* ── The embedded Check-in Display ────────────────────────────────────
   index.html loads it at ../lobby/ (plain URL, full motion: the lobby's own
   ?lowPower=1 flag is not used here). The one site (awana.kvbchurch.org)
   serves both, so the display is this page's own origin. */
const CHECKIN_DISPLAY_ORIGIN = window.location.origin;
const CHECKIN_DISPLAY_URL = new URL('../lobby/', window.location.href).href;

let currentLesson = null;
// public/lessons.json's whole lesson list, once loaded (see loadAllLessons at
// the end of the file). Declared up here, with the rest of the shared state,
// because originalVideoUrl() reads it to find a week's original video URL and
// is reachable from the startup refreshLesson() call, and a `let` further down
// the file would still be in its temporal dead zone at that moment.
let allLessons = null;
let currentObjectUrl = null;
// Teaching-slides state (see the "Teaching slides" section near the end).
// Declared up here because stopJourneyContent() — reached from the startup
// setView() call below — tears the slideshow down, and a `let` further down
// the file would still be in its temporal dead zone at that moment.
let teachingSlides = null; // parsed teaching-slides.json, once loaded
let slideshow = null; // { week, items, index, onFinish, blobUrls: Map, errors }
let slideAutoTimer = null;
// Bumped on every showJourneyContent()/playCurrentLesson()/startPreview()
// call so a slow, in-flight call (e.g. still awaiting a cache read) can
// detect it's stale once it resolves and avoid clobbering state a newer
// call already set.
let journeyRequestToken = 0;
// Browsers only allow *unmuted* autoplay after a genuine user gesture has
// occurred on the page. This page's clickable elements are its corner
// buttons (a click inside the Check-in Display iframe is a different
// origin and never bubbles up to this document), so a click on any of
// them counts as "the kiosk has been touched" and unlocks unmuted autoplay
// for every subsequent lesson — no separate unmute tap needed after that
// first click. This flag deliberately lives only in memory, not
// localStorage: the browser's own gesture-based permission is itself
// scoped to this page's lifetime (it doesn't survive a reload/reboot
// either), so persisting a "still unlocked" flag past that point would
// just be wrong.
let audioUnlocked = false;

/* ── Idle cursor / idle controls ──────────────────────────────────────
   The cursor starts hidden (kiosk mode: nothing should look "parked" on
   the projected video) but reappears on any mouse movement or touch and
   hides again after a few idle seconds — an operator has to be able to
   see the pointer to use the corner buttons and the settings panel at
   all. The same cursor-hidden class also fades the playback control bar
   (see #video-controls in style.css), which is why touches count as
   activity too: phones/tablets have no mousemove. This only governs this
   document; the Check-in Display iframe is a different origin and
   manages its own cursor. */
const CURSOR_IDLE_MS = 5000;

/* A forgotten preview or an open Settings panel used to pin the kiosk for
   good: a leader previews a lesson, pauses it, walks away, and the 6:30
   scheduler (which previewMode holds off) never gets the room back; or the
   Settings panel is left up and the self-updater (which counts it as busy)
   never reloads. idleWatch() runs once a minute and, with nobody touching
   the kiosk for the stated time, ends a PAUSED preview (never a playing
   one) and closes the panel. Any key, tap or click is activity. */
const PREVIEW_IDLE_MS = 20 * 60 * 1000;
const SETTINGS_IDLE_MS = 15 * 60 * 1000;
let lastActivityAt = Date.now();
function noteActivity() { lastActivityAt = Date.now(); }
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((type) => document.addEventListener(type, noteActivity, { passive: true, capture: true }));
function idleWatch(now = Date.now()) {
  const idleFor = now - lastActivityAt;
  const acted = [];
  if (previewMode && idleFor > PREVIEW_IDLE_MS && !slideshow && (journeyVideo.paused || journeyVideo.ended || !journeyVideo.src)) {
    console.log('Journey: a paused preview was left for ' + Math.round(idleFor / 60000) + ' minutes; handing the room back');
    endPreview();
    acted.push('preview');
  }
  // The configure page IS the panel: it never closes.
  if (!CONFIGURE_MODE && !settingsPanel.classList.contains('hidden') && idleFor > SETTINGS_IDLE_MS) {
    console.log('Journey: the Settings panel was left open; closing it');
    closeSettingsPanel();
    acted.push('settings');
  }
  return acted;
}
setInterval(idleWatch, 60 * 1000);
window.idleWatch = idleWatch;
window.noteActivity = noteActivity;
let cursorIdleTimer = null;
function markActivity() {
  const wasHidden = document.documentElement.classList.contains('cursor-hidden');
  document.documentElement.classList.remove('cursor-hidden');
  if (wasHidden && typeof syncScrubber === 'function') syncScrubber(); // the bar is back: catch it up
  if (wasHidden && typeof startScrubberLoop === 'function') startScrubberLoop(); // and glide from here
  clearTimeout(cursorIdleTimer);
  cursorIdleTimer = setTimeout(() => {
    document.documentElement.classList.add('cursor-hidden');
  }, CURSOR_IDLE_MS);
}
// A configure page is a desktop form under an operator's mouse: the pointer stays.
if (!CONFIGURE_MODE) {
  document.documentElement.classList.add('cursor-hidden');
  document.addEventListener('mousemove', markActivity);
  document.addEventListener('touchstart', markActivity, { passive: true });
}

function scheduledPhase() {
  const now = new Date();
  return scheduledPhaseAt(now.getHours() * 60 + now.getMinutes(), trekSmallGroupTime(now));
}

/* The view the schedule wants at `minutes` (minute of the local day), given
   whether tonight is a club night (Trek's small group time). Pure: the club
   transitions (29-transition-gap.js) lay a night's views out from it.
   Trek's small group time comes first: on a club night it takes 7:00-7:30,
   the Journey window's last half hour included (trekSmallGroupTime() in
   25-trek.js; a lesson still running holds it off, see pollSchedule()). */
function scheduledPhaseAt(minutes, trekNight) {
  if (trekNight && minutes >= TREK_START_MINUTES && minutes < TREK_END_MINUTES) return 'trek';
  return minutes >= JOURNEY_START_MINUTES && minutes < JOURNEY_END_MINUTES
    ? 'journey'
    : 'checkin';
}

/* ── Saved lessons: Awana's original videos kept on this computer ────────
   Settings "Download all lessons (full quality)" (26-lesson-downloads.js)
   saves every lesson's original into the browser's Origin Private File
   System (OPFS: real files in the browser profile on the kiosk PC's disk,
   private to this site). A saved lesson then plays from the disk FIRST, even
   with the internet up (owner 2026-10-12: the church's internet is slow), and
   only a missing or damaged copy goes back to the network (05-stream-first.js).

   Storage design (CLAUDE.md "Saved lessons"): one folder per video,
   `journey-lessons-v1/week-07-student/`, holding `info.json` and the file cut
   into 16 MiB pieces `c00000`, `c00001`, … Each piece is written whole and
   committed on close, so an interrupted download keeps every finished piece
   and carries on from the next one with a Range request. Playback hands the
   <video> one Blob made of the pieces' File objects: those are disk-backed
   (Chromium reads them from the files as the video asks, with seeking), so a
   multi-GB lesson is never read into memory and needs no service worker.

   Nothing in this page's Cache API eviction can touch these files (a separate
   store): a saved lesson stays until someone presses "Delete downloaded
   lessons". The browser itself is asked to keep them too
   (navigator.storage.persist(), which the KVBC Awana app grants). */
const LESSON_STORE_DIR = 'journey-lessons-v1';
const LESSON_CHUNK_BYTES = 16 * 1024 * 1024;
const LESSON_ROLES = ['student', 'leader'];

/* Can this browser keep saved lessons at all? Needs OPFS with writable files
   (Chromium 86+, so the kiosk app and desktop Chrome/Edge; not every phone). */
function lessonStoreSupported() {
  try {
    return !!(
      window.isSecureContext !== false &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function' &&
      typeof window.FileSystemFileHandle === 'function' &&
      'createWritable' in window.FileSystemFileHandle.prototype
    );
  } catch {
    return false;
  }
}

function lessonFileId(week, role) {
  return `week-${String(week).padStart(2, '0')}-${role}`;
}

function lessonChunkName(index) {
  return `c${String(index).padStart(5, '0')}`;
}

/* The one address a lesson's original may be DOWNLOADED from, and its size:
   lessons.json `cdnUrl`/`bytes` (Student) or `leaderCdnUrl`/`leaderBytes`
   (Leader), recorded by scripts/resolve-lesson-files.mjs. That is the CORS-
   enabled CloudFront file clubs.awana.org redirects to (the redirect hop has
   no CORS header, so a browser cannot fetch the clubs.awana.org address).
   Only an https .mp4 counts: nothing but a lesson's own video is ever
   downloaded here. Null when the lesson has none. */
function lessonFileSource(lesson, role) {
  if (!lesson || !LESSON_ROLES.includes(role)) return null;
  const url = role === 'leader' ? lesson.leaderCdnUrl : lesson.cdnUrl;
  const bytes = role === 'leader' ? lesson.leaderBytes : lesson.bytes;
  if (role === 'leader' && !lesson.leaderDownloadUrl) return null;
  if (typeof url !== 'string' || !/^https:\/\/[^/]+\/.+\.mp4$/i.test(url)) return null;
  return { url, bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null };
}

/* The current address and size of `week`'s `role` video from the loaded
   lessons.json, or null when that is not known (the list not loaded, a week
   it does not have, no downloadable address). */
function currentLessonFileSource(week, role) {
  const entry = Array.isArray(allLessons) ? allLessons.find((l) => l && l.week === week) : null;
  return entry ? lessonFileSource(entry, role) : null;
}

/* Is the copy on disk (its info.json) still the file lessons.json names?
   `source` is { url, bytes } (lessonFileSource(), or a download plan item).
   A different address, or a different size when lessons.json gives one,
   means Awana replaced the file: that copy is NOT saved (it does not play,
   it is not counted) and the downloader starts it again (downloadOneLesson).
   No source to compare with (null): the copy counts, so a kiosk that cannot
   read lessons.json still plays what it saved. */
function savedCopyMatches(info, source) {
  if (!info || !source || !source.url) return true;
  return info.url === source.url && !(source.bytes && info.bytes !== source.bytes);
}

/* Pure: how many bytes of a file of `total` bytes, cut into `chunk`-byte
   pieces, are safely on disk given the pieces' sizes in order. A piece counts
   only at its full expected size and only while every piece before it does
   (an interrupted piece, or anything after it, is downloaded again). */
function committedLessonBytes(sizes, total, chunk) {
  if (!(total > 0) || !(chunk > 0)) return 0;
  let have = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const expected = Math.min(chunk, total - i * chunk);
    if (expected <= 0 || sizes[i] !== expected) break;
    have += expected;
  }
  return have;
}

async function lessonStoreRoot(create) {
  if (!lessonStoreSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(LESSON_STORE_DIR, { create: !!create });
  } catch {
    return null; // nothing saved yet (or storage off)
  }
}

async function lessonFileDir(id, create) {
  const root = await lessonStoreRoot(create);
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(id, { create: !!create });
  } catch {
    return null;
  }
}

async function readLessonInfo(dir) {
  try {
    const file = await (await dir.getFileHandle('info.json')).getFile();
    const info = JSON.parse(await file.text());
    return info && info.v === 1 && Number.isFinite(info.bytes) && info.bytes > 0
      && Number.isFinite(info.chunk) && info.chunk > 0 ? info : null;
  } catch {
    return null;
  }
}

async function writeLessonInfo(dir, info) {
  const handle = await dir.getFileHandle('info.json', { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(info));
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* already gone */ }
    throw err;
  }
}

/* The pieces on disk, in order, as File objects (stops at the first gap). */
async function lessonChunkFiles(dir, info) {
  const files = [];
  const count = Math.ceil(info.bytes / info.chunk);
  for (let i = 0; i < count; i += 1) {
    let file = null;
    try {
      file = await (await dir.getFileHandle(lessonChunkName(i))).getFile();
    } catch {
      break;
    }
    files.push(file);
  }
  return files;
}

/* What is on disk for one video: { state, have, total, info }.
   state: 'none' (nothing), 'partial' (some pieces, resumable), 'saved' (every
   byte), 'damaged' (marked finished but pieces missing or the wrong size:
   it is downloaded again, and plays from the internet meanwhile). A copy of
   a file lessons.json no longer names (`source`, savedCopyMatches()) is
   'none' with `stale`: the downloader starts it from the beginning. Its
   pieces stay on disk until then (only the downloader or Delete removes
   anything). */
async function inspectLessonFile(id, source) {
  const dir = await lessonFileDir(id, false);
  if (!dir) return { state: 'none', have: 0, total: 0, info: null };
  const info = await readLessonInfo(dir);
  if (!info) return { state: 'none', have: 0, total: 0, info: null };
  if (!savedCopyMatches(info, source)) return { state: 'none', have: 0, total: (source && source.bytes) || 0, info: null, stale: true };
  const files = await lessonChunkFiles(dir, info);
  const have = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
  let state = 'partial';
  if (have === info.bytes) state = 'saved';
  else if (info.done) state = 'damaged';
  else if (have === 0) state = 'none';
  return { state, have, total: info.bytes, info };
}

/* The saved video as ONE disk-backed Blob of its pieces, or null when it is
   not completely saved, or is a copy of a file lessons.json no longer names
   (`source`: savedCopyMatches(); the caller then plays from the network, as
   for a missing copy, and the downloader replaces it). Never reads the bytes
   themselves, never deletes anything. */
async function savedLessonBlob(id, source) {
  const dir = await lessonFileDir(id, false);
  if (!dir) return null;
  const info = await readLessonInfo(dir);
  if (!info || !savedCopyMatches(info, source)) return null;
  const files = await lessonChunkFiles(dir, info);
  if (committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk) !== info.bytes) return null;
  return new Blob(files, { type: 'video/mp4' });
}

/* Set when a <video> src is a saved copy: { src, networkUrl, id }. The video
   error listener (13-wake-lock.js) swaps a saved copy that will not play to
   the network address once, at the same position. */
let savedPlayback = null;
// Videos that failed to play from this computer since the page loaded (the
// downloads panel names them).
const savedPlaybackFailures = new Set();

/* A playable object URL for the saved copy of `week`'s `role` video, or null
   (none, damaged, replaced by Awana since it was saved (checked against the
   loaded lessons.json), storage off, or a newer request has taken over: callers
   re-check their own token). Follows the page's object-URL rule: the old
   currentObjectUrl is revoked only once the new one is in hand. */
async function savedLessonObjectUrl(week, role, token, networkUrl) {
  if (!lessonStoreSupported()) return null;
  const id = lessonFileId(week, role);
  let blob = null;
  try {
    blob = await savedLessonBlob(id, currentLessonFileSource(week, role));
  } catch {
    blob = null;
  }
  if (!blob) return null;
  if (token !== undefined && token !== journeyRequestToken) return null;
  const url = URL.createObjectURL(blob);
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = url;
  savedPlayback = { src: url, networkUrl: networkUrl || null, id };
  return url;
}

/* The video error hook: a saved copy that will not play (damaged on disk, or
   deleted while it played) goes over to the network address once, where the
   room got to. True when it took the error. */
function fallBackFromSavedCopy() {
  const saved = savedPlayback;
  if (!saved || journeyVideo.getAttribute('src') !== saved.src) return false;
  savedPlayback = null;
  savedPlaybackFailures.add(saved.id);
  if (!saved.networkUrl) return false;
  console.warn('Journey: the saved copy would not play; using the internet copy —', saved.id);
  const at = journeyVideo.currentTime;
  pendingSeek = at > 0 ? { token: journeyRequestToken, t: at } : null;
  showVideoLoading();
  journeyVideo.src = saved.networkUrl;
  applyCaptions();
  journeyVideo.play().catch(() => {});
  return true;
}

/* Is the current week's Student Video saved (and still the file lessons.json
   names)? cacheLessonBundle() then skips its own copy of it (no second
   ~150 MB in the Cache API). */
async function lessonSavedOnDisk(week, role) {
  if (!lessonStoreSupported()) return false;
  try {
    return (await inspectLessonFile(lessonFileId(week, role), currentLessonFileSource(week, role))).state === 'saved';
  } catch {
    return false;
  }
}

/* Delete every saved lesson (the one way they ever go). */
async function deleteSavedLessons() {
  if (!lessonStoreSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(LESSON_STORE_DIR, { recursive: true });
  } catch (err) {
    if (err && err.name === 'NotFoundError') return;
    throw err;
  }
}
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
    // A Student Video saved by "Download all lessons" (04-lesson-store.js) is
    // what plays, so the bundle keeps no second copy of it (and its old one
    // goes with the next eviction, the saved copy being the better one).
    const savedOnDisk = await lessonSavedOnDisk(lesson.week, 'student');
    const candidates = [
      ...(savedOnDisk ? [] : lessonVideoCandidates(lesson)),
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

/* ── A saved copy first, then stream, then the cached copy ─────────────
   1. A lesson saved on this computer (Settings "Download all lessons",
      04-lesson-store.js) plays from the disk, online or not: the church's
      internet is slow, and saving them was the whole point (owner
      2026-10-12). No probe, no stall swap (nothing to stall on). Only a
      missing or damaged saved copy goes on to 2; one that fails while it
      plays goes over to the network once (fallBackFromSavedCopy()).
   2. Stream first, play the cached copy only when streaming cannot.
   The old kiosk computer played a picker video streamed over plain HTTP
   smoothly, and stuttered badly on the SAME encode served to the <video>
   element as a blob URL out of the Cache API (owner report, 2026-09-16, from
   the live kiosk; both files verified as identical encodes). The blob path
   was the only variable, so a device with a working connection streams, exactly the way the picker always
   has, and the cache goes back to being what it is good at: the safety net
   for an evening with no internet.

   The bundle (cacheLessonBundle()) is still pre-downloaded, still
   store-before-evict, and is still what plays when the probe below says the
   network cannot answer (it skips its own copy of a video already saved).
   The saved copy in 1 is also a blob URL, but of disk-backed files, never
   the whole video in memory (04-lesson-store.js). */
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

/* Resolves what the <video> element should play: the saved copy when this
   computer has one, else the live URL when the network can serve it, the
   cached copy as a blob URL otherwise. `token` is
   the caller's journeyRequestToken snapshot. If a teardown or newer request
   has bumped the token while the probe or the cache read was in flight, this
   returns null WITHOUT committing anything, so a stale resolve can neither
   clobber currentObjectUrl nor strand a multi-megabyte blob URL that nothing
   will ever revoke (that leak would sit resident until the next show). Callers must bail on null. */
async function resolveVideoSrc(lesson, token) {
  const liveUrl = originalVideoUrl(lesson);
  const key = videoCacheKey(lesson);
  streamSwapCandidate = null;
  // The scheduled show is always the Student Video.
  const saved = await savedLessonObjectUrl(lesson.week, 'student', token, liveUrl);
  if (token !== undefined && token !== journeyRequestToken) return null;
  if (saved) return saved;
  if ('caches' in window) {
    try {
      const cache = await caches.open(VIDEO_CACHE_NAME);
      const cached = key ? await cache.match(key) : null;
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

/* ── Lesson intro: the scheduled show's opening cards (owner 2026-10-12) ──
   When the show begins (Begin Video, Space or → on the splash, at any time
   of day (owner 2026-10-12), nothing to resume) four cards come up one
   after another before the video: "Journey", "Advocates" (this year's
   study), the lesson's name, "Large Group Time". About five seconds, and
   they are there to hide buffering: the video is attached (paused, muted
   state as usual, preload auto) the moment the intro starts, so by the last
   card it has had five seconds to fill. If it still cannot play through
   (lessonIntroVideoReady()), the last card holds, saying so, until it can,
   at most LESSON_INTRO.holdMaxMs more; then the video starts anyway, the
   way it always has (the loading overlay and the stall machinery take over
   from there).

   Everything else starts as before: a resume, Start over, a lesson picked
   from Settings, the Skip to slides path. The intro never stands between the room and the
   lesson: any error (the video's own, or a throw in here) ends it at once
   and plays as today; ⇄, a Settings pick, the slides, a teardown all cancel
   it (cancelLessonIntro()). Space, →, Enter or a tap on it skips to the
   video.

   The same cards on every device. With motion: bold entrances and a band
   that carries the last card off into the video (style.css motion block,
   24-motion.js carryIntroOff()). Reduced motion: instant swaps, nothing
   animated. While it is
   up the video element is shown (under the cards), so the count chip, the
   reload check and the Trek poll all read it as the lesson it is.

   Timing is LESSON_INTRO; a test may override any of it through
   window.journeyIntroTiming (read at each start). */
const LESSON_INTRO = {
  cardsAt: [0, 1100, 2200, 3600], // Journey, Advocates, lesson, Large Group Time
  minMs: 4600, // the last card's earliest end (the motion's carry adds ~0.8s)
  holdMaxMs: 15000, // then the video starts whether it is ready or not
  pollMs: 250,
  aheadS: 8, // seconds buffered past the playhead that count as "ready"
};
const lessonIntroEl = document.getElementById('journey-intro');
const lessonIntroCards = lessonIntroEl ? [...lessonIntroEl.querySelectorAll('.journey-intro-card')] : [];
const lessonIntroWeek = document.getElementById('journey-intro-week');
const lessonIntroTitle = document.getElementById('journey-intro-title');
const lessonIntroWait = document.getElementById('journey-intro-wait');
let lessonIntro = null; // { token, timers, attached, onDone, ... } while one runs

function lessonIntroTiming() {
  const o = window.journeyIntroTiming;
  return o && typeof o === 'object' ? { ...LESSON_INTRO, ...o } : LESSON_INTRO;
}

function lessonIntroActive() {
  return lessonIntro !== null;
}

// The intro is the splash's Begin from the top, at any time of day.
function lessonIntroWanted(resumeAt) {
  return !!lessonIntroEl && lessonIntroCards.length === 4 && !(resumeAt > 0) && !previewMode;
}

// Can the attached video play through from here without stopping?
// HAVE_ENOUGH_DATA, or HAVE_FUTURE_DATA with aheadS seconds (or the rest of
// the file) buffered past the playhead.
function lessonIntroVideoReady(aheadS = lessonIntroTiming().aheadS) {
  const v = journeyVideo;
  if (!v.getAttribute('src') || v.error) return false;
  if (v.readyState >= 4) return true;
  if (v.readyState < 3) return false;
  const t = v.currentTime || 0;
  const d = v.duration;
  const ranges = v.buffered;
  for (let i = 0; ranges && i < ranges.length; i += 1) {
    if (ranges.start(i) <= t + 0.1 && ranges.end(i) >= t) {
      const end = ranges.end(i);
      return end - t >= aheadS || (Number.isFinite(d) && d > 0 && end >= d - 0.5);
    }
  }
  return false;
}

function showLessonIntroCard(index) {
  // The new card on top, the one before it left under it (its entrance wipes
  // over it with motion on); anything older goes.
  lessonIntroCards.forEach((card, i) => card.classList.toggle('hidden', i > index || i < index - 1));
  if (lessonIntro) lessonIntro.card = index;
}

function lessonIntroText(lesson) {
  const text = splashLessonText(lesson);
  lessonIntroWeek.textContent = text.kicker;
  lessonIntroTitle.textContent = text.headline;
  lessonIntroTitle.classList.toggle('is-long', text.headline.length > 14);
}

// Starts the cards for `token` (a playCurrentLesson request). Returns false
// (and the caller plays as today) when it should not or cannot run.
function startLessonIntro(token, lesson) {
  try {
    cancelLessonIntro();
    const timing = lessonIntroTiming();
    lessonIntroText(lesson);
    const intro = { token, timers: [], attached: false, onDone: null, card: 0, holding: false, startedAt: Date.now(), timing };
    lessonIntro = intro;
    lessonIntroWait.classList.add('hidden');
    lessonIntroEl.classList.remove('is-holding');
    showLessonIntroCard(0);
    lessonIntroEl.classList.remove('hidden');
    timing.cardsAt.forEach((at, i) => {
      if (i > 0) intro.timers.push(setTimeout(() => lessonIntro === intro && showLessonIntroCard(i), at));
    });
    intro.timers.push(setTimeout(() => lessonIntroCheck(intro), timing.minMs));
    return true;
  } catch (err) {
    console.warn('Journey: lesson intro could not start —', err);
    cancelLessonIntro();
    return false;
  }
}

// playCurrentLesson() has attached the video: `start` plays it. Runs it at
// once if the intro has already gone.
function lessonIntroVideoAttached(token, start) {
  const intro = lessonIntro;
  if (!intro || intro.token !== token) {
    if (token === journeyRequestToken) start();
    return;
  }
  intro.attached = true;
  intro.onDone = start;
  journeyVideo.preload = 'auto';
  if (intro.ready) finishLessonIntro(intro);
}

// A throw anywhere in the intro's own steps: drop it and start the video
// the way it starts without one.
function lessonIntroFailed(intro, err) {
  console.warn('Journey: lesson intro failed, starting the video —', err);
  if (lessonIntro !== intro) return;
  lessonIntro = null;
  for (const timer of intro.timers) clearTimeout(timer);
  try {
    hideLessonIntro();
  } catch {
    // nothing left to tidy that matters more than the video
  }
  if (intro.token !== journeyRequestToken) return;
  videoControls.classList.remove('hidden');
  showVideoLoading();
  if (typeof intro.onDone === 'function') intro.onDone();
}

function lessonIntroCheck(intro) {
  try {
    lessonIntroStep(intro);
  } catch (err) {
    lessonIntroFailed(intro, err);
  }
}

function lessonIntroStep(intro) {
  if (lessonIntro !== intro) return;
  if (intro.token !== journeyRequestToken) {
    cancelLessonIntro();
    return;
  }
  const waited = Date.now() - intro.startedAt - intro.timing.minMs;
  if (lessonIntroVideoReady(intro.timing.aheadS) || waited >= intro.timing.holdMaxMs) {
    intro.ready = true;
    if (intro.attached) finishLessonIntro(intro);
    else intro.timers.push(setTimeout(() => lessonIntroCheck(intro), intro.timing.pollMs)); // src still resolving
    return;
  }
  if (!intro.holding) {
    intro.holding = true;
    showLessonIntroCard(lessonIntroCards.length - 1);
    lessonIntroEl.classList.add('is-holding');
    lessonIntroWait.classList.remove('hidden');
  }
  intro.timers.push(setTimeout(() => lessonIntroCheck(intro), intro.timing.pollMs));
}

// The cards go and the video starts: with motion on, the last card is
// carried off first (the video, still paused, is what the band uncovers;
// motion is never laid over a playing video).
function finishLessonIntro(intro, { instant = false } = {}) {
  if (lessonIntro !== intro || intro.finishing) return;
  intro.finishing = true;
  for (const timer of intro.timers) clearTimeout(timer);
  const done = () => {
    if (lessonIntro !== intro) return;
    lessonIntro = null;
    hideLessonIntro();
    if (intro.token !== journeyRequestToken) return;
    videoControls.classList.remove('hidden');
    if (!lessonIntroVideoReady(0.5)) showVideoLoading();
    if (typeof intro.onDone === 'function') intro.onDone();
  };
  try {
    if (instant || !intro.attached) done();
    else carryIntroOff(lessonIntroEl, done);
  } catch (err) {
    lessonIntroFailed(intro, err);
  }
}

function hideLessonIntro() {
  if (!lessonIntroEl) return;
  lessonIntroEl.classList.add('hidden');
  lessonIntroEl.classList.remove('is-holding');
  for (const card of lessonIntroCards) card.classList.add('hidden');
  lessonIntroWait.classList.add('hidden');
}

// Every way the screen is taken from the intro (⇄, a pick in Settings, the
// slides, a newer playback request) ends it without starting anything.
function cancelLessonIntro() {
  const intro = lessonIntro;
  if (!intro) return;
  lessonIntro = null;
  for (const timer of intro.timers) clearTimeout(timer);
  cancelIntroCarry();
  hideLessonIntro();
}

// Skip: straight to the video (once it is attached; until then, as soon as
// it is).
function skipLessonIntro() {
  const intro = lessonIntro;
  if (!intro) return false;
  intro.ready = true;
  if (intro.attached) finishLessonIntro(intro, { instant: true });
  return true;
}

if (lessonIntroEl) {
  lessonIntroEl.addEventListener('click', () => {
    audioUnlocked = true;
    skipLessonIntro();
  });
  // The video failing while the cards are up: the intro steps aside at once
  // and the video's own error handling (slides, placeholder) runs as today.
  journeyVideo.addEventListener('error', cancelLessonIntro);
  // Ready early while holding: go now rather than at the next poll.
  journeyVideo.addEventListener('canplaythrough', () => {
    const intro = lessonIntro;
    if (intro && intro.holding) lessonIntroCheck(intro);
  });
}
/* ── Resume an interrupted lesson ─────────────────────────────────────
   A power cut, an accidental hard refresh, or a stray press of the ⇄
   button used to cost the room the whole lesson so far: playCurrentLesson()
   always attaches a fresh src and never seeks, and stopJourneyContent()
   detaches it, so every restart began again at 0:00. The scheduled show now
   marks its position in localStorage every few seconds, and the splash
   offers to pick it back up.

   Deliberately narrow, because resuming into the WRONG video would be worse
   than restarting: the stored week must match the lesson actually queued
   (a lesson change makes the mark meaningless, never "close enough"), the
   position has to be far enough in to be worth keeping and far enough from
   the end to be worth watching, and the mark has to be recent. Manual
   previews never record one (previewMode), so a previewed week can never be
   offered as the scheduled show's resume point.

   Reading it costs no network — it is pure localStorage, so the splash
   still renders synchronously (acknowledge first, network later). Every
   access is wrapped, like storeCaptionPref(): Chromium in kiosk/private
   modes can throw on localStorage rather than returning null. */
const RESUME_KEY = 'journey.resume';
const RESUME_WRITE_INTERVAL_MS = 5000; // one small write per 5s of playback
const RESUME_MIN_SECONDS = 30; // below this, starting over costs nothing
const RESUME_END_MARGIN_S = 10; // this close to the end, the lesson is over
const RESUME_MAX_AGE_MS = 4 * 60 * 60 * 1000; // last night's mark is not this evening's

let lastResumeWriteMs = 0;
// The position the splash is currently offering (0 = not offering one), read
// by the Resume button and by Space/→.
let offeredResumeAt = 0;
// The week of the lesson actually attached to the <video> right now, set by
// playCurrentLesson() and cleared on every teardown. The mark is written
// against THIS, not against currentLesson.week — the hourly refresh can
// legitimately swap currentLesson while the old video is still playing, and a
// mark carrying the new week with the old video's position would resume the
// wrong lesson at an arbitrary point.
let playingWeek = null;

function clearResumePoint() {
  lastResumeWriteMs = 0;
  try {
    localStorage.removeItem(RESUME_KEY);
  } catch {
    // Nothing to do — a mark that can't be cleared also can't have been written.
  }
}

// Bound to the video's 'timeupdate' below (which fires ~4x/second), so this
// throttles itself rather than writing on every tick.
function recordResumePoint() {
  if (previewMode || playingWeek === null) return;
  if (journeyVideo.classList.contains('hidden')) return;
  const t = journeyVideo.currentTime;
  const d = journeyVideo.duration;
  if (!Number.isFinite(t) || t < RESUME_MIN_SECONDS) return;
  if (Number.isFinite(d) && d > 0 && d - t <= RESUME_END_MARGIN_S) return;
  const now = Date.now();
  if (now - lastResumeWriteMs < RESUME_WRITE_INTERVAL_MS) return;
  lastResumeWriteMs = now;
  try {
    localStorage.setItem(
      RESUME_KEY,
      JSON.stringify({
        week: playingWeek,
        t: Math.floor(t),
        d: Number.isFinite(d) && d > 0 ? Math.floor(d) : 0,
        at: now,
      })
    );
  } catch {
    // Storage blocked/full — the lesson simply won't be resumable. Fine.
  }
}

function storedResumePoint() {
  try {
    const raw = localStorage.getItem(RESUME_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object') return null;
    if (typeof p.week !== 'number' || typeof p.t !== 'number' || typeof p.at !== 'number') {
      return null;
    }
    if (!Number.isFinite(p.t) || !Number.isFinite(p.at)) return null;
    return p;
  } catch {
    return null;
  }
}

// The mark, but only if it still describes THIS lesson and is still worth
// offering. Returns the seconds to resume at, or 0 for "just begin".
function resumeSecondsFor(lesson) {
  const p = storedResumePoint();
  if (!lesson || !p) return 0;
  if (p.week !== lesson.week) return 0;
  if (p.t < RESUME_MIN_SECONDS) return 0;
  if (Date.now() - p.at > RESUME_MAX_AGE_MS) return 0;
  if (typeof p.d === 'number' && Number.isFinite(p.d) && p.d > 0 && p.d - p.t <= RESUME_END_MARGIN_S) {
    return 0;
  }
  return p.t;
}

/* The splash shows EITHER "Begin Video" (nothing to resume) or the pair
   "Resume at M:SS" + "Start over" — never all three, because "Begin Video"
   and "Start over" are the same action and a third button on a screen read
   from across a room is just one more thing to get wrong. */
function offerResume(lesson) {
  offeredResumeAt = resumeSecondsFor(lesson);
  const offering = offeredResumeAt > 0;
  if (offering) journeySplashResumeLabel.textContent = `Resume at ${formatTime(offeredResumeAt)}`;
  journeySplashResumeBtn.classList.toggle('hidden', !offering);
  journeySplashStartOverBtn.classList.toggle('hidden', !offering);
  journeySplashPlayBtn.classList.toggle('hidden', offering);
}

/* currentTime can only be set once the media's duration is known, so the
   resume seek waits for this src's own 'loadedmetadata'. One permanent
   listener (rather than one added per play) so nothing accumulates, and the
   journeyRequestToken snapshot means a mark from a request that has since
   been superseded can never seek a newer video. */
let pendingSeek = null;
journeyVideo.addEventListener('loadedmetadata', () => {
  const seek = pendingSeek;
  pendingSeek = null;
  if (!seek || seek.token !== journeyRequestToken) return;
  const d = journeyVideo.duration;
  let t = seek.t;
  if (Number.isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 1));
  if (!(t > 0)) return;
  try {
    journeyVideo.currentTime = t;
  } catch {
    // Some sources refuse a seek before they are seekable — play from the
    // top rather than not at all.
  }
  syncScrubber();
});

// The splash names the lesson the way the catalog's Large Group Time page
// does: a small kicker ("Week 4 · Unit 1 · Lesson 4") over the lesson's own
// name, shouted ("Logic"). lessons.json titles all read "Unit N, Lesson M:
// Name"; a title in any other shape keeps the whole title as the headline and
// the week alone as the kicker, so a change on Awana's side can cost the
// layout but never a word. Pure, so the tests can pin it.
function splashLessonText(lesson) {
  const week = `Week ${lesson.week}`;
  const title = String(lesson.title == null ? '' : lesson.title);
  const match = /^\s*Unit\s+(\d+)\s*,\s*Lesson\s+(\d+)\s*:\s*(\S.*?)\s*$/i.exec(title);
  if (!match) return { kicker: week, headline: title };
  return { kicker: `${week} · Unit ${match[1]} · Lesson ${match[2]}`, headline: match[3] };
}

// Entering the journey window no longer autoplays anything: it shows a
// branded "Large Group Time" splash naming this week's lesson, and waits
// for the operator to actually start the video (Space / → / the on-screen
// button — see playCurrentLesson() and the keydown listener below). The
// video itself is still pre-fetched into the Cache API well ahead of time
// by refreshLesson()/cacheLessonBundle() regardless of what's on screen, so
// it's already "queued" and ready the moment playback is requested.
async function showJourneyContent() {
  // The lesson intro is the show already starting (its video attached or on
  // the way): like a playing video, never pulled back to the splash.
  if (lessonIntroActive()) return;
  ++journeyRequestToken; // invalidate any in-flight playCurrentLesson() call
  if (!currentLesson) {
    // No lesson resolved yet (or the nightly feed came back empty) —
    // show the plain placeholder rather than a broken video.
    journeyVideo.pause();
    journeyVideo.removeAttribute('src');
    journeyVideo.classList.add('hidden');
    hideVideoLoading();
    videoControls.classList.add('hidden');
    journeySplash.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
    offerResume(null);
    return;
  }
  // Don't rip control away from a playback that's already started (or
  // in-flight) — e.g. the hourly lesson refresh firing while the video is
  // already playing mid-window.
  if (!journeyVideo.classList.contains('hidden') || slideshowActive()) return;
  journeyPlaceholder.classList.add('hidden');
  // The splash owns the screen now — a loading overlay left up by an
  // in-flight playback request this call just invalidated would otherwise
  // sit on top of it (and its stall note would fire over it 12s later).
  hideVideoLoading();
  const splashText = splashLessonText(currentLesson);
  journeySplashWeek.textContent = splashText.kicker;
  journeySplashTitle.textContent = splashText.headline;
  // Every real lesson name is one word of at most 12 letters; anything longer
  // is a fallback title and gets the smaller size (see style.css).
  journeySplashTitle.classList.toggle('is-long', splashText.headline.length > 14);
  // Decided from localStorage alone — no fetch stands between the splash
  // appearing and the operator seeing which buttons it offers.
  offerResume(currentLesson);
  journeySplash.classList.remove('hidden');
}

// Actually starts the queued lesson playing — called only from a genuine
// user action (keypress or the on-screen button), which is also what makes
// unmuted autoplay reliable (see audioUnlocked below).
// `withIntro`: the splash's plain Begin (beginScheduledPlay); the lesson intro
// (06-lesson-intro.js) covers the first seconds while the video, attached at
// once, buffers underneath, and starts it when it is ready.
async function playCurrentLesson(resumeAt = 0, withIntro = false) {
  const token = ++journeyRequestToken;
  if (!currentLesson) return;
  stopTeachingSlides();
  journeySplash.classList.add('hidden');
  journeyVideo.classList.remove('hidden');
  const intro = withIntro && lessonIntroWanted(resumeAt) && startLessonIntro(token, currentLesson);
  if (intro) {
    hideVideoLoading(); // the cards are the loading screen
    videoControls.classList.add('hidden');
  } else {
    videoControls.classList.remove('hidden');
    showVideoLoading();
  }
  journeyVideo.loop = false; // plays once; falls back to Check-in Display on 'ended' below
  setMuted(!audioUnlocked);
  // Awana's original: streamed when the network answers, else the cached copy.
  const src = await resolveVideoSrc(currentLesson, token);
  if (!src || token !== journeyRequestToken) {
    // Nothing to play after all: what the room would have seen without the
    // intro (the loading overlay and its stall note).
    if (intro && token === journeyRequestToken && lessonIntroActive()) {
      cancelLessonIntro();
      videoControls.classList.remove('hidden');
      showVideoLoading();
    }
    return; // a newer call has since taken over
  }
  if (intro) journeyVideo.preload = 'auto';
  journeyVideo.src = src;
  // The seek is armed only after the token check above, so a stale resolve
  // can never drop a resume position onto a newer video.
  playingWeek = currentLesson.week;
  pendingSeek = resumeAt > 0 ? { token, t: resumeAt } : null;
  // Starting from the top invalidates the old mark immediately, so a restart
  // that is then interrupted in its first 30 seconds (before the first write)
  // can't be offered last time's position.
  if (!(resumeAt > 0)) clearResumePoint();
  applyCaptions();
  if (intro) {
    lessonIntroVideoAttached(token, startLessonVideo);
    return;
  }
  startLessonVideo();
}

function startLessonVideo() {
  journeyVideo.play().catch(() => {
    // Autoplay-with-sound can still be rejected in edge cases (e.g. the
    // browser's engagement heuristics disagree with our own tracking) —
    // fall back to muted so playback isn't left stuck on a paused frame.
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
}

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
   memory. */
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

/* ── Caption appearance (Settings → Captions) ─────────────────────────
   One fixed type size cannot serve both readers this page has: a leader in
   the back row of a room reading a projected TV, and someone holding a
   phone. So the size is a per-device choice, stored like the on/off answer
   and the slide preferences.

   It MULTIPLIES the responsive clamp in style.css through --caption-scale
   rather than replacing it, so "Large" is still capped on a huge screen and
   still legible on a small one. The dark-backdrop option swaps the
   translucent band for a solid one, which is what a bright lesson frame
   needs. Both are pure CSS + localStorage: nothing is fetched, so none of
   this can delay a control that has just been pressed. */
const CAPTION_SIZE_KEY = 'journey.captions.size';
const CAPTION_BACKDROP_KEY = 'journey.captions.backdrop';
const CAPTION_SIZES = ['0.8', '1', '1.3', '1.6'];
const CAPTION_SIZE_DEFAULT = '1';

function storedCaptionSize() {
  try {
    const v = localStorage.getItem(CAPTION_SIZE_KEY);
    return CAPTION_SIZES.includes(v) ? v : CAPTION_SIZE_DEFAULT;
  } catch {
    return CAPTION_SIZE_DEFAULT;
  }
}

function storedCaptionBackdrop() {
  try {
    return localStorage.getItem(CAPTION_BACKDROP_KEY) === 'on';
  } catch {
    return false;
  }
}

// Takes the values explicitly so a change can still be APPLIED on a device
// where storage is blocked and the write above just failed — reading them
// back would hand out the defaults and the control would look inert.
function applyCaptionDisplayPrefs(size = storedCaptionSize(), backdrop = storedCaptionBackdrop()) {
  document.documentElement.style.setProperty('--caption-scale', size);
  captionOverlay.classList.toggle('caption-backdrop', backdrop);
  // The band's height changed, so the letterbox/control-bar clearance the
  // caption sits above has to be worked out again.
  positionCaptions();
}

function storeCaptionDisplayPrefs() {
  try {
    localStorage.setItem(CAPTION_SIZE_KEY, captionsSizeSelect.value);
    localStorage.setItem(CAPTION_BACKDROP_KEY, captionsBackdropInput.checked ? 'on' : 'off');
  } catch {
    // Won't survive a reload — the live change below still applies now.
  }
  applyCaptionDisplayPrefs(captionsSizeSelect.value, captionsBackdropInput.checked);
}

function syncCaptionPrefInputs() {
  captionsSizeSelect.value = storedCaptionSize();
  captionsBackdropInput.checked = storedCaptionBackdrop();
}

syncCaptionPrefInputs();
applyCaptionDisplayPrefs();
captionsSizeSelect.addEventListener('change', storeCaptionDisplayPrefs);
captionsBackdropInput.addEventListener('change', storeCaptionDisplayPrefs);

function applyCaptions() {
  removeCaptionTracks();
  const show = captionsEnabled && !!activeCaptionUrl;
  ccBtn.classList.toggle('hidden', !activeCaptionUrl);
  ccBtn.setAttribute('aria-pressed', String(show));
  ccBtn.textContent = show ? 'CC on' : 'CC off';
  if (!show) return;
  const track = document.createElement('track');
  track.kind = 'captions';
  track.srclang = 'en';
  track.label = 'English';
  track.src = activeCaptionUrl;
  track.default = true;
  const attach = () => {
    if (!track.track) return;
    activeTextTrack = track.track;
    // 'hidden', not 'showing': parse cues and fire cuechange, but let
    // renderActiveCues() do the drawing into #caption-overlay.
    activeTextTrack.mode = 'hidden';
    activeTextTrack.addEventListener('cuechange', renderActiveCues);
    positionCaptions();
    renderActiveCues();
  };
  track.addEventListener('load', attach);
  journeyVideo.appendChild(track);
  attach();
}

function showCaptionPrompt() {
  captionPrompt.classList.remove('hidden');
  // Focus has to wait for the element to actually be rendered: .hidden is
  // `display: none !important`, and focus() on a still-unrendered element
  // silently does nothing — which would leave the Yes default with no focus
  // ring and nothing for a keyboard/screen-reader user to land on.
  requestAnimationFrame(() => captionYesBtn.focus());
}

function isCaptionPromptOpen() {
  return !captionPrompt.classList.contains('hidden');
}

function answerCaptionPrompt(on) {
  if (!isCaptionPromptOpen()) return;
  captionsEnabled = on;
  storeCaptionPref(on);
  captionPrompt.classList.add('hidden');
  const proceed = pendingPlay;
  pendingPlay = null;
  if (proceed) proceed();
}

/* The single gate every playback path goes through: works out whether this
   video has captions, asks once if the operator has never answered, then runs
   the actual play function.

   The screen changes BEFORE anything is awaited — the Journey layer and the
   loading overlay appear the instant the operator acts. An earlier version
   awaited the caption probe first, so on flaky WiFi a press of Begin
   Video/Space (or a picker choice) changed nothing on screen for as long as
   the network dawdled — reported from the live kiosk as "you click buttons
   and it doesn't respond". Hiding the splash immediately also makes
   isAwaitingPlay() false, so mashing Space/the button can't stack duplicate
   requests.

   The reveal matters for the prompt path too: the prompt lives inside
   #journey-view, so that layer has to be on screen or the question renders
   into a display:none ancestor and is invisible — which once stranded manual
   previews (operator picks a video, sees the Check-in Display, and playback
   waits forever on a question nobody can see). */
async function requestPlayback(captionUrl, proceed) {
  const token = ++journeyRequestToken;
  cancelLessonIntro(); // a newer request owns the screen
  stopTeachingSlides(); // a slideshow left from the previous video must not sit over this one
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  trekView.classList.add('hidden'); // a lesson or preview over Trek's card takes the screen
  journeyPlaceholder.classList.add('hidden');
  journeySplash.classList.add('hidden');
  showVideoLoading();
  const available = await captionsAvailable(captionUrl);
  // The operator may have torn this down (toggle button) or started a newer
  // request while the probe was in flight — don't resurrect it.
  if (token !== journeyRequestToken) return;
  const blobUrl = available ? await cachedCaptionBlobUrl(captionUrl) : null;
  if (token !== journeyRequestToken) {
    // Stale: a newer request owns the screen now — discard our blob rather
    // than clobbering (and revoking) caption state that request just set.
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    return;
  }
  if (blobUrl) {
    if (captionObjectUrl) URL.revokeObjectURL(captionObjectUrl);
    captionObjectUrl = blobUrl;
  }
  activeCaptionUrl = available ? blobUrl || captionUrl : null;
  if (available && storedCaptionPref() === null) {
    pendingPlay = proceed;
    hideVideoLoading();
    showCaptionPrompt();
    return;
  }
  proceed();
}

captionYesBtn.addEventListener('click', () => {
  audioUnlocked = true;
  answerCaptionPrompt(true);
});
captionNoBtn.addEventListener('click', () => {
  audioUnlocked = true;
  answerCaptionPrompt(false);
});

ccBtn.addEventListener('click', () => {
  audioUnlocked = true;
  captionsEnabled = !captionsEnabled;
  storeCaptionPref(captionsEnabled);
  applyCaptions();
});

// True only while the splash is up and waiting for the operator to start
// the queued lesson — Space/→/the on-screen button all no-op outside this.
function isAwaitingPlay() {
  return (
    !journeyView.classList.contains('hidden') &&
    !journeySplash.classList.contains('hidden') &&
    !previewMode
  );
}

/* Loading indicator: covers the gap between asking a video to play and
   frames actually rendering — which for a manual preview (streaming a
   full-size original over church WiFi) can be long enough to look like a
   dead screen. Also re-shown by the video's 'waiting' event for mid-play
   buffering stalls, and hidden again by 'playing'.

   A 'waiting' shows it only after LOADING_REVEAL_DELAY_MS: every seek (the
   ±15s jumps, the scrubber) fires 'waiting' for a moment while the decoder
   finds its feet, and flashing the full ink overlay over the picture on each
   one read as the screen blinking. A real stall still shows it half a second
   in; 'canplay' or 'playing' before then means it never appears. The stall
   clock (the 12s note, the near-end watchdog) starts at the 'waiting' itself,
   not at the reveal. A play request still shows it at once (that is the
   acknowledgement of the press), and the lesson intro's own calls are
   unchanged. */
const LOADING_STALL_MS = 12000;
const LOADING_REVEAL_DELAY_MS = 500;
const LOADING_NOTE_DEFAULT = journeyLoadingNote.textContent;
let loadingStallTimer = null;
let loadingRevealTimer = null;

function showVideoLoading(revealDelayMs = 0) {
  // If loading drags on, say so honestly instead of pulsing forever — a
  // stalled fetch on a dead connection never fires an error event, so
  // without this the overlay is indistinguishable from progress. The ⇄
  // button always works as the way out (it never waits on the network).
  clearTimeout(loadingStallTimer);
  loadingStallTimer = setTimeout(() => {
    // Stalled on the tail of the lesson — go straight to the slides rather
    // than leaving the room staring at a frozen last frame.
    if (!journeyVideo.classList.contains('hidden') && videoNearEnd()) {
      endOfLessonHandoff();
      return;
    }
    journeyLoadingNote.textContent =
      'Still loading — the internet may be down. Press → for the teaching slides, or ⇄ (bottom right) to go back.';
  }, LOADING_STALL_MS);
  clearTimeout(loadingRevealTimer);
  loadingRevealTimer = null;
  if (revealDelayMs > 0 && journeyLoading.classList.contains('hidden')) {
    loadingRevealTimer = setTimeout(() => {
      loadingRevealTimer = null;
      // Data arrived without an event we heard (or the video went): no cover.
      if (journeyVideo.classList.contains('hidden') || journeyVideo.readyState >= 3) return;
      journeyLoading.classList.remove('hidden');
    }, revealDelayMs);
    return;
  }
  journeyLoading.classList.remove('hidden');
}

function hideVideoLoading() {
  clearTimeout(loadingStallTimer);
  clearTimeout(loadingRevealTimer);
  loadingRevealTimer = null;
  // Frames are arriving again (or the video is being torn down), so the
  // stall swap has nothing to answer for either.
  clearStreamStallSwap();
  journeyLoadingNote.textContent = LOADING_NOTE_DEFAULT;
  journeyLoading.classList.add('hidden');
}

journeyVideo.addEventListener('playing', hideVideoLoading);
journeyVideo.addEventListener('waiting', () => {
  if (journeyVideo.classList.contains('hidden')) return;
  showVideoLoading(LOADING_REVEAL_DELAY_MS);
  // A stall on a streamed file is the one case where the cached copy is
  // worth its stutter: see swapToCachedCopy above.
  armStreamStallSwap();
});
// The short wait after a seek (or a paused seek, which never fires
// 'playing'): the data is there, so the overlay that was about to cover it
// is not needed, and neither is the stall clock that came with it. An overlay
// already up (a play request, a real stall) stays until 'playing' as before.
journeyVideo.addEventListener('canplay', () => {
  if (!loadingRevealTimer) return;
  clearTimeout(loadingRevealTimer);
  loadingRevealTimer = null;
  clearTimeout(loadingStallTimer);
  clearStreamStallSwap();
});

function setMuted(muted) {
  journeyVideo.muted = muted;
  unmuteBtn.textContent = muted ? '🔇' : '🔊';
  unmuteBtn.setAttribute('aria-pressed', String(!muted));
}

/* ── Playback controls: pause/play, scrubber, elapsed time ────────────
   The bar (#video-controls) shows whenever a video is active, fading out
   with the idle cursor and pinned visible while paused. Tapping/clicking
   the video itself toggles pause too — the natural touch gesture — and
   Space does the same during playback (it already starts the splash's
   queued lesson when that's what's on screen). */
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

let scrubbing = false;

function syncPlaybackUI() {
  const paused = journeyVideo.paused;
  pauseBtn.textContent = paused ? 'Play' : 'Pause';
  // While paused, the bar must not fade away with the idle cursor —
  // a silent frozen frame with no visible controls reads as a crash.
  videoControls.classList.toggle('force-visible', paused);
  syncScrubber(); // the bar may have just reappeared with a stale readout
}

/* The bar is invisible while the cursor is hidden (and not paused): do not
   write the DOM four times a second for nobody to see. */
function controlBarShowing() {
  return !document.documentElement.classList.contains('cursor-hidden')
    || videoControls.classList.contains('force-visible');
}

function syncScrubber() {
  if (scrubbing || !controlBarShowing()) return;
  const duration = journeyVideo.duration;
  let text;
  if (Number.isFinite(duration) && duration > 0) {
    videoScrubber.max = String(duration);
    videoScrubber.value = String(journeyVideo.currentTime);
    text = `${formatTime(journeyVideo.currentTime)} / ${formatTime(duration)}`;
  } else {
    // Duration unknown (still loading, or a stream that doesn't report
    // one) — show elapsed time only and leave the scrubber inert.
    videoScrubber.max = '0';
    videoScrubber.value = '0';
    text = formatTime(journeyVideo.currentTime);
  }
  // Called every frame while playing (below): the readout changes once a
  // second, so it is written once a second.
  if (videoTime.textContent !== text) videoTime.textContent = text;
}

/* The scrubber's thumb glides with the video instead of stepping four times
   a second with 'timeupdate': one requestAnimationFrame loop, running only
   while the video plays AND the bar can be seen (it stops itself the frame
   either stops being true: paused, faded out with the idle cursor, the video
   put away, a hidden tab). 'timeupdate' still catches the readout up when
   the loop is not running (a seek while paused). */
let scrubberRaf = 0;

function scrubberLoopWanted() {
  return (
    !journeyVideo.paused &&
    !journeyVideo.classList.contains('hidden') &&
    !videoControls.classList.contains('hidden') &&
    controlBarShowing() &&
    !document.hidden
  );
}

function scrubberFrame() {
  scrubberRaf = 0;
  if (!scrubberLoopWanted()) return;
  syncScrubber();
  scrubberRaf = requestAnimationFrame(scrubberFrame);
}

function startScrubberLoop() {
  if (scrubberRaf || typeof requestAnimationFrame !== 'function' || !scrubberLoopWanted()) return;
  scrubberRaf = requestAnimationFrame(scrubberFrame);
}

function scrubberLoopRunning() {
  return scrubberRaf !== 0;
}

function onVideoTimeUpdate() {
  if (!scrubberRaf) syncScrubber();
  startScrubberLoop();
}

function togglePause() {
  if (journeyVideo.classList.contains('hidden')) return;
  audioUnlocked = true; // pausing/resuming is itself a genuine gesture
  if (journeyVideo.paused) journeyVideo.play().catch(() => {});
  else journeyVideo.pause();
}

/* ± 15 seconds. A leader who wants the room to hear one sentence again was
   otherwise left dragging a finger-sized scrubber on a projected screen and
   overshooting; a fixed jump is the control that actually gets used mid-
   teaching. Purely local seeking on an already-attached source — no fetch,
   nothing to await — so it costs one decoder re-seek and nothing else.
   Clamped a quarter-second shy of the end so "skip" can never trip the
   'ended' handoff by accident: → is the deliberate way on to the slides. */
const SEEK_STEP_S = 15;

// `gesture` false: asked from the phone remote (28-phone-remote.js), which is
// not a press on this page, so it unlocks no sound.
function seekBy(delta, gesture = true) {
  if (journeyVideo.classList.contains('hidden')) return;
  if (gesture) audioUnlocked = true; // seeking is itself a genuine gesture
  const from = journeyVideo.currentTime;
  if (!Number.isFinite(from)) return;
  const d = journeyVideo.duration;
  let t = Math.max(0, from + delta);
  if (Number.isFinite(d) && d > 0) t = Math.min(t, Math.max(0, d - 0.25));
  try {
    journeyVideo.currentTime = t;
  } catch {
    return; // not seekable yet (still loading) — leave playback alone
  }
  syncScrubber(); // the readout must move on the same paint as the press
}

back15Btn.addEventListener('click', () => seekBy(-SEEK_STEP_S));
fwd15Btn.addEventListener('click', () => seekBy(SEEK_STEP_S));

journeyVideo.addEventListener('play', syncPlaybackUI);
journeyVideo.addEventListener('pause', syncPlaybackUI);
journeyVideo.addEventListener('timeupdate', onVideoTimeUpdate);
journeyVideo.addEventListener('playing', startScrubberLoop);
document.addEventListener('visibilitychange', startScrubberLoop);
journeyVideo.addEventListener('timeupdate', recordResumePoint);
journeyVideo.addEventListener('durationchange', syncScrubber);
journeyVideo.addEventListener('click', togglePause);
pauseBtn.addEventListener('click', togglePause);

/* Dragging only moves the readout; the one seek happens on release. Seeking on
   every input event made the decoder re-seek dozens of times a second. */
videoScrubber.addEventListener('input', () => {
  scrubbing = true;
  const t = Number(videoScrubber.value);
  if (Number.isFinite(t)) {
    videoTime.textContent = `${formatTime(t)} / ${formatTime(journeyVideo.duration)}`;
  }
});
videoScrubber.addEventListener('change', () => {
  const t = Number(videoScrubber.value);
  if (scrubbing && Number.isFinite(t)) {
    try { journeyVideo.currentTime = t; } catch { /* not seekable yet */ }
  }
  scrubbing = false;
});

function stopJourneyContent() {
  playingWeek = null; // nothing attached — stop marking a position
  // Invalidate any still-awaiting requestPlayback()/playCurrentLesson() call:
  // once the operator has torn the view down, a slow caption probe or cache
  // read resolving later must not restart playback into a hidden layer.
  ++journeyRequestToken;
  cancelLessonIntro();
  stopTeachingSlides();
  journeyVideo.pause();
  // Release the cached video's blob URL and detach the element while the
  // Journey view isn't showing — a ~100-200MB decoded blob has no business
  // staying resident for the other 23 hours of the day.
  // It costs one cheap Cache API read to reconstruct at the next 6:30 PM.
  journeyVideo.removeAttribute('src');
  journeyVideo.load();
  journeyVideo.classList.add('hidden');
  hideVideoLoading();
  videoControls.classList.add('hidden');
  videoControls.classList.remove('force-visible');
  // Drop caption tracks with the video, and abandon any unanswered prompt —
  // its pending play refers to a video that's no longer on screen.
  activeCaptionUrl = null;
  pendingPlay = null;
  captionPrompt.classList.add('hidden');
  removeCaptionTracks();
  if (captionObjectUrl) {
    URL.revokeObjectURL(captionObjectUrl);
    captionObjectUrl = null;
  }
  ccBtn.classList.add('hidden');
  videoScrubber.max = '0';
  videoScrubber.value = '0';
  videoTime.textContent = '0:00';
  journeySplash.classList.add('hidden');
  // Nothing is attached any more, so there is nothing to swap.
  streamSwapCandidate = null;
  clearStreamStallSwap();
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

/* ── View switching ──────────────────────────────────────────────── */

/* Three views: the Check-in Display, the Journey lesson, and (club nights,
   7:00-7:30) Trek's small group card. Every layer stays in the page; only
   `hidden` moves, so the check-in frame stays connected under the other two. */
function setView(phase) {
  const showJourney = phase === 'journey';
  const showTrek = phase === 'trek';
  journeyView.classList.toggle('hidden', !showJourney);
  trekView.classList.toggle('hidden', !showTrek);
  checkinView.classList.toggle('hidden', showJourney || showTrek);
  if (showJourney) {
    showJourneyContent();
  } else {
    stopJourneyContent();
  }
  if (showTrek) {
    renderTrekCard();
    // The card is shown only while it IS the scheduled phase (the poll, the
    // end of a lesson, the toggle all ask scheduledPhase() first), so this is
    // the schedule's own phase being adopted, never a fake flip.
    if (scheduledPhase() === 'trek') lastPhase = 'trek';
  }
  // The club transition black (29-transition-gap.js) follows what is now on
  // screen: a lesson that just finished inside a gap goes to black here.
  refreshGap();
}

/* Where a finished scheduled lesson (its video, then its slides) hands the
   screen: Trek's card when it is Trek's time (a lesson that ran past 7:00
   was waited for), else the Check-in Display, as always. */
function lessonDoneView() {
  return scheduledPhase() === 'trek' ? 'trek' : 'checkin';
}

// `lastPhase` tracks only the *scheduled* phase (for detecting a genuine
// 18:30/19:30 boundary crossing) — it is deliberately never written to from
// the manual toggle or the video's 'ended' handler below, both of which call
// setView() directly to change what's on screen right now without touching
// this. That's what lets either of them hold a view that disagrees with
// scheduledPhase() (e.g. checkin display shown early, or shown again after
// the lesson finished early) without the next 15s poll tick fighting them —
// the poll only acts when scheduledPhase() itself has actually changed.
let lastPhase = scheduledPhase();
// A configure page shows neither layer (style.css hides both), and nothing
// here may start the splash or a video behind the panel.
if (!CONFIGURE_MODE) setView(lastPhase);

// True while a manually-picked video (from the Settings panel) is playing.
// The poller and the hourly lesson refresh both skip their normal
// view-changing work while this is set, so a preview can't be interrupted
// mid-playback by the ordinary schedule machinery — it only ends via the
// video finishing/erroring, or the operator explicitly leaving it (the
// toggle button). See "Manual video preview" below.
let previewMode = false;

function pollSchedule() {
  if (previewMode || CONFIGURE_MODE) return;
  const phase = scheduledPhase();
  if (phase === lastPhase) return;
  // Trek's card never cuts a lesson: while the video or its slides are still
  // going (or about to: the caption question, the loading overlay) the flip
  // waits, lastPhase untouched so every poll asks again, and the lesson's own
  // finish hands over to the card (lessonDoneView()). Only 7:30 ends it.
  if (phase === 'trek' && journeyLessonRunning()) return;
  lastPhase = phase;
  setView(phase);
}

setInterval(pollSchedule, POLL_INTERVAL_MS);

toggleBtn.addEventListener('click', () => {
  audioUnlocked = true;
  // Over a club transition's black: the operator wants a view, so the black
  // goes for the rest of this gap (29-transition-gap.js), then as below.
  dismissGap();
  if (previewMode) {
    endPreview();
    return;
  }
  const showingJourney = !journeyView.classList.contains('hidden');
  const showingTrek = !trekView.classList.contains('hidden');
  if (showingJourney || showingTrek) {
    setView('checkin');
    return;
  }
  // Back from the Check-in Display: to Trek's card in Trek's time, else the
  // lesson (a lesson in Trek's time is still one press away in Settings).
  setView(scheduledPhase() === 'trek' ? 'trek' : 'journey');
});

unmuteBtn.addEventListener('click', () => {
  audioUnlocked = true;
  setMuted(!journeyVideo.muted);
});

/* ── Whole-page fullscreen on a double-click ──────────────────────────
   A double-click puts THIS page into fullscreen, not the thing that was
   double-clicked. That is the point: fullscreening the embedded display's
   own stage, or the <video>, would take the ⇄ and ⚙ corner buttons off the
   screen with it and leave an operator with no way back out except the
   keyboard. The next double-click leaves fullscreen again.

   Two ways in, because the two layers are different documents:
   - The Check-in Display is a cross-origin iframe, so a double-click inside
     it never reaches this document at all. That app posts a message up to
     its parent instead when it is embedded (see its urlFlags/CLAUDE.md), and
     the listener below is this side of that contract.
   - The Journey layer is ours, so a plain dblclick listener does it, minus
     anything that already means something else: a control, a text field, the
     settings panel, or a reading overlay.

   Nothing else is touched: no view changes, no lastPhase, no teardown. Every
   fullscreen call is best effort (a browser may refuse one that is not tied
   to a gesture it likes) and its failure is swallowed, because there is
   nothing useful to say about it on a wall-mounted screen. */
const DISPLAY_FULLSCREEN_MESSAGE = 'awana-display:toggle-fullscreen';

function togglePageFullscreen() {
  try {
    if (document.fullscreenElement) {
      const left = document.exitFullscreen && document.exitFullscreen();
      if (left && typeof left.catch === 'function') left.catch(() => {});
      return;
    }
    const el = document.documentElement;
    const entered = el.requestFullscreen && el.requestFullscreen();
    if (entered && typeof entered.catch === 'function') entered.catch(() => {});
  } catch {
    // Unsupported, or refused outright. The page carries on windowed.
  }
}

window.addEventListener('message', (event) => {
  // The source check is the real gate: only the window this page put in its
  // own iframe can ask for this. The origin check is belt and braces for the
  // two origins that window is ever legitimately on (the published display,
  // or a local copy served beside this page during development).
  if (!checkinFrame || event.source !== checkinFrame.contentWindow) return;
  if (event.origin !== location.origin && !String(event.origin).startsWith(CHECKIN_DISPLAY_ORIGIN)) {
    return;
  }
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== DISPLAY_FULLSCREEN_MESSAGE) return;
  togglePageFullscreen();
});

journeyView.addEventListener('dblclick', (e) => {
  const target = e.target;
  if (
    target instanceof Element &&
    target.closest('button, input, textarea, select, #settings-panel, #handout-view, #prep-view')
  ) {
    return;
  }
  if (!settingsPanel.classList.contains('hidden') || readerOverlayOpen()) return;
  togglePageFullscreen();
});

// Starts the queued lesson playing — only while the splash is actually up
// (isAwaitingPlay()), so a stray keypress at any other time (e.g. during
// the Check-in Display, or once the video's already playing) does nothing.
journeySplashPlayBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  beginScheduledPlay(0, true);
});

// Shown in place of "Begin Video" when an interrupted showing of THIS week's
// lesson was marked (see offerResume) — picks it back up a few seconds shy of
// where it stopped.
journeySplashResumeBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  beginScheduledPlay(offeredResumeAt);
});

journeySplashStartOverBtn.addEventListener('click', () => {
  if (!isAwaitingPlay()) return;
  audioUnlocked = true;
  clearResumePoint();
  beginScheduledPlay(0);
});

/* Skip the video, show this week's teaching slides (owner request
   2026-09-16). Some weeks the room has already watched the lesson, or there
   is no time for it, and the deck is the part the leader actually needs.

   It is the same slideshow the end-of-video handoff runs, in the same
   scheduled (non-preview) mode, so Finish hands back to the Check-in Display
   exactly as it does after a video. No video is ever attached:
   startTeachingSlides() releases the element and hides the splash itself.
   The resume mark goes, because the lesson is being treated as done, which is
   what finishTeachingSlides() does at the other end of the same show. Nothing
   is awaited before the stage appears; slide images load as they always do. */
function skipToTeachingSlides() {
  // Same gate as Begin Video, plus the panel: the Settings overlay covers the
  // splash, so a press that reaches this while it is open is not a press.
  if (!isAwaitingPlay() || !settingsPanel.classList.contains('hidden')) return false;
  const week = currentLesson && currentLesson.week;
  if (!startTeachingSlides(week, () => setView(lessonDoneView()))) {
    // No deck for this week at all: leave the splash exactly as it was
    // rather than tearing the screen down for nothing.
    console.warn('Journey: no teaching slides for week', week);
    return false;
  }
  clearResumePoint();
  return true;
}

journeySplashSlidesBtn.addEventListener('click', () => {
  audioUnlocked = true;
  skipToTeachingSlides();
});

// The scheduled show plays the Student Video, so that's the transcript to
// offer. requestPlayback() asks about captions only if this device has never
// answered, then starts playback either way.
// `intro`: the plain Begin (button, Space, →) with nothing to resume, which
// starts the lesson intro at any time of day. Resume and Start over begin
// as they always have.
function beginScheduledPlay(resumeAt = 0, intro = false) {
  if (!currentLesson) return;
  requestPlayback(captionUrlFor(currentLesson.week, 'student'), () => playCurrentLesson(resumeAt, intro && !(resumeAt > 0)));
}

document.addEventListener('keydown', (e) => {
  // A configure page is only the panel, which never closes: no shortcut
  // below (S, Escape, Space, the arrows) means anything there.
  if (CONFIGURE_MODE) return;
  // The caption prompt owns the keyboard while it's up: Y/N answer it, and
  // Space/Enter take the focused default (Yes) so an operator who reflexively
  // taps Space to start the video isn't stopped by an unfamiliar screen.
  if (isCaptionPromptOpen()) {
    if (e.code === 'KeyY') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(true);
    } else if (e.code === 'KeyN') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(false);
    } else if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      audioUnlocked = true;
      answerCaptionPrompt(true);
    }
    return;
  }
  const typing = e.target instanceof Element && e.target.closest('input, select, textarea');
  // Teaching slides own Space/arrows while they're up (the video is hidden
  // by then, so none of the playback shortcuts below can fire anyway).
  if (slideshowActive() && settingsPanel.classList.contains('hidden')
      && !readerOverlayOpen() && !typing) {
    if (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'PageDown') {
      e.preventDefault(); // (also stops Space from scrolling / clicking a focused button)
      if (e.repeat) return; // a held key must not fly through the deck
      audioUnlocked = true;
      nextSlide();
      return;
    }
    if (e.code === 'ArrowLeft' || e.code === 'PageUp' || e.code === 'Backspace') {
      e.preventDefault();
      if (e.repeat) return;
      prevSlide();
      return;
    }
  }
  // S opens Settings from anywhere (the splash advertises it); Escape closes.
  if (e.code === 'KeyS' && !e.repeat && !typing && settingsPanel.classList.contains('hidden')
      && !readerOverlayOpen()) {
    e.preventDefault();
    audioUnlocked = true;
    openSettingsPanel();
    return;
  }
  if (e.code === 'Escape' && !prepView.classList.contains('hidden')) {
    closePrep();
    return;
  }
  if (e.code === 'Escape' && !settingsPanel.classList.contains('hidden')) {
    closeSettingsPanel();
    return;
  }
  /* , and . (the keys marked < and >), with [ and ] as aliases, jump the
     lesson back/forward 15 seconds. Guarded exactly like the Space branch
     below: only while a video is actually on screen, never with the settings
     panel or the handout overlay open, never while typing. ArrowLeft is
     deliberately left alone — it means "previous slide" once the teaching
     slides are up — and ArrowRight stays the handoff to those slides.
     Repeats are ignored: a held key would queue seeks faster than the
     decoder can serve them. */
  if (e.code === 'Comma' || e.code === 'Period' || e.code === 'BracketLeft' || e.code === 'BracketRight') {
    if (
      !e.repeat &&
      !typing &&
      !journeyVideo.classList.contains('hidden') &&
      settingsPanel.classList.contains('hidden') &&
      !readerOverlayOpen()
    ) {
      e.preventDefault();
      const back = e.code === 'Comma' || e.code === 'BracketLeft';
      seekBy(back ? -SEEK_STEP_S : SEEK_STEP_S);
    }
    return;
  }
  /* Shift+→ on the splash goes straight to the teaching slides. Gated
     exactly like Begin Video below, and deliberately a modified key: plain →
     still begins the video, so no reflexive tap can skip the lesson. */
  if (
    e.code === 'ArrowRight' &&
    e.shiftKey &&
    !e.repeat &&
    !typing &&
    isAwaitingPlay() &&
    settingsPanel.classList.contains('hidden')
  ) {
    e.preventDefault();
    audioUnlocked = true;
    skipToTeachingSlides();
    return;
  }
  if (e.code !== 'Space' && e.code !== 'ArrowRight') return;
  // ...but not while the operator is typing (the Settings panel's bullet
  // editor has real text fields): a space between two words must stay a
  // space, not start the lesson behind the panel.
  if (isAwaitingPlay() && !typing && settingsPanel.classList.contains('hidden')) {
    e.preventDefault(); // stop Space from also "clicking" a focused button below
    audioUnlocked = true;
    // Whatever the splash's primary button says: Resume when one is offered,
    // otherwise plain Begin Video. "Start over" stays a deliberate press.
    beginScheduledPlay(offeredResumeAt, true);
    return;
  }
  // The lesson intro's cards: Space, → or Enter skip straight to the video
  // (never on to the slides: → only means that once the video is up).
  if (lessonIntroActive() && (e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter')
      && !typing && settingsPanel.classList.contains('hidden') && !readerOverlayOpen()) {
    e.preventDefault();
    if (e.repeat) return;
    audioUnlocked = true;
    skipLessonIntro();
    return;
  }
  // → moves the show on while a lesson video is up — playing, paused, or
  // wedged on a dead connection — handing over to the teaching slides. This
  // is the operator's guaranteed way forward when the video never finishes;
  // Space stays "pause" so a reflexive tap can't skip the lesson.
  if (
    e.code === 'ArrowRight' &&
    !journeyVideo.classList.contains('hidden') &&
    settingsPanel.classList.contains('hidden') &&
    !readerOverlayOpen()
  ) {
    e.preventDefault();
    audioUnlocked = true;
    endOfLessonHandoff();
    return;
  }
  // Once a video is actually on screen, Space toggles pause — but never
  // while the settings panel is open or a button/input has focus, where
  // Space already means "activate that control".
  if (
    e.code === 'Space' &&
    !journeyVideo.classList.contains('hidden') &&
    settingsPanel.classList.contains('hidden') &&
    !(e.target instanceof Element && e.target.closest('button, input'))
  ) {
    e.preventDefault();
    togglePause();
  }
});

/* ── Keep the kiosk screen awake ─────────────────────────────────────
   Operating systems blank the screen by default; with no
   keyboard/mouse activity for hours, the display can go to sleep long
   before 6:30 PM arrives. The Wake Lock API only prevents the screen from
   blanking — it doesn't dismiss a blank that already happened — so this
   also re-acquires on visibilitychange (e.g. after the tab/monitor was
   backgrounded and the lock was released) rather than only once on load.
   Requires HTTPS, which GitHub Pages provides. Not fatal if unsupported
   (older Chromium builds) — turning screen sleep off in the kiosk
   computer's own power settings is the belt-and-braces fallback either way. */
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
// holding on a blank/frozen frame until the window ends. Deliberately does NOT touch
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
    setView(lessonDoneView());
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
  // A saved copy (04-lesson-store.js) that will not play goes over to the
  // internet copy once, where the room got to, before anything below.
  if (fallBackFromSavedCopy()) return;
  if (previewMode) {
    // A preview tries Awana's original first; if that errored, retry once
    // with the lesson's 480p release copy before giving up. Cleared
    // immediately so a failure of the fallback itself lands in endPreview()
    // below, not a loop.
    if (previewFallbackUrl) {
      const fallback = previewFallbackUrl;
      previewFallbackUrl = null;
      console.warn('Journey: preview failed, retrying with the fallback copy —', fallback);
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
    if (startTeachingSlides(currentLesson && currentLesson.week, () => setView(lessonDoneView()))) return;
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
// try landing after the lesson window had closed. The teaching slides, read
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
  // that from stacking duplicate multi-MB downloads.)
  window.addEventListener('online', () => refreshLesson());
}

/* ── Manual video preview (Settings panel) ────────────────────────────
   Lets an operator browse every lesson in public/lessons.json and play
   any one of them right now — always a one-off: it never changes what
   the schedule above will automatically show at the next 6:30 PM, and
   never touches current-lesson.json. Plays Awana's original, falling
   back once to the lesson's 480p copy from videos/ on this site (see
   transcodedPreviewUrl below) if the original errors. Skips the Cache
   API: an occasional manual action doesn't need the nightly
   lesson's pre-caching machinery, it just needs a decodable file. Picking
   a lesson ALWAYS asks Leader or Student Video first (lessons with no
   Leader Video — week 27 — have that choice disabled); see the comment in
   onLessonPicked() for why this is deliberately unconditional. */

let pendingPreviewLesson = null;
// Set alongside each preview: the lesson's 480p copy, tried once if the
// original errors.
let previewFallbackUrl = null;
// The week of the lesson being previewed — the teaching slides shown after
// a preview video are that lesson's, not the scheduled one's.
let previewWeek = null;

// Every lesson (Student and Leader) has a 480p re-encode uploaded as a
// GitHub Release asset by scripts/transcode-all-lessons.mjs, the one-shot
// fallback when a picked original will not play. (Release asset URLs 302-redirect, which <video>
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
  // inside the 6:30 lesson window (playing the Student Video directly, like
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
  // Drop the PDF viewer's memory the moment it's closed — same memory
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
   Key Points, Scripture, the "For you" and "Ask your group" questions) as
   plain text this page lays out itself, so it reflows on any screen.

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

// leader-prep.json v2 carries two question sets: the leader's own reflection
// ("For you") and what the leader asks the students ("Ask your group", may be
// empty). A v1 copy still sitting in the asset cache has one plain list,
// which was always the leader's own questions: read it as "For you" until
// the quiet revalidate replaces it.
function prepQuestionSets(questions) {
  const clean = (list) => (Array.isArray(list) ? list.filter((q) => typeof q === 'string' && q.trim()) : []);
  if (Array.isArray(questions)) return { forYou: clean(questions), forGroup: [] };
  if (!questions || typeof questions !== 'object') return { forYou: [], forGroup: [] };
  return { forYou: clean(questions.forYou), forGroup: clean(questions.forGroup) };
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
  const sets = prepQuestionSets(entry.questions);
  for (const [heading, questions] of [
    ['For you', sets.forYou],
    ['Ask your group', sets.forGroup],
  ]) {
    if (!questions.length) continue;
    prepSection(heading, () => {
      const ol = document.createElement('ol');
      for (const question of questions) {
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
  settingsPanel.classList.remove('hidden');
  // "Lessons on this computer" (26-lesson-downloads.js): reads the disk in
  // the background, never the network first. A microtask later, because the
  // configure page opens the panel while schedule.js is still running, before
  // that file's own state exists.
  Promise.resolve().then(refreshDownloadsPanel);
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
  cancelLessonIntro();
  stopTeachingSlides();
  previewMode = true;
  playingWeek = null; // a preview is never the scheduled show's resume point
  previewFallbackUrl = fallbackUrl;
  previewWeek = week;
  journeyView.classList.remove('hidden');
  checkinView.classList.add('hidden');
  trekView.classList.add('hidden'); // a lesson or preview over Trek's card takes the screen
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
  // this, ending a preview inside the 6:30 lesson window left the finished
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
   errors: Awana's original, with the 480p Release copy as the spare (the
   Release copy alone when there is no original). Neither is cached: a Release asset's redirect hop carries no CORS
   header, and an occasional manual pick does not need the nightly bundle's
   machinery, it just needs a file that plays. */
function previewSources(week, variant, originalUrl) {
  const release = transcodedPreviewUrl(week, variant);
  return originalUrl
    ? { url: originalUrl, fallback: release }
    : { url: release, fallback: null };
}

async function playStudentPreview(lesson, seekTo = 0) {
  // The current week's Student Video is the one already pre-downloaded for
  // the 6:30 show, so play the local copy instead of re-streaming it: a
  // same-week preview works with the network dead. (resolveVideoSrc() takes
  // a saved copy first, then the stream, then the bundle.)
  const sameWeek = !!currentLesson && currentLesson.week === lesson.week;
  if (sameWeek) {
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
  await playSavedOrStreamedPreview(lesson, 'student', 'Student Video', lesson.downloadUrl, seekTo);
}

function playLeaderPreview(lesson, seekTo = 0) {
  return playSavedOrStreamedPreview(lesson, 'leader', 'Leader Video', lesson.leaderDownloadUrl, seekTo);
}

/* Any other picked video: the copy saved on this computer when there is one
   (Settings "Download all lessons"), else Awana's original streamed, with the
   480p Release copy as the one spare either way. A saved copy that will not
   play goes to the original first (fallBackFromSavedCopy()), then the spare.
   The saved-copy lookup is a local disk read, never the network. */
async function playSavedOrStreamedPreview(lesson, role, label, originalUrl, seekTo) {
  const token = journeyRequestToken;
  const saved = await savedLessonObjectUrl(lesson.week, role, token, originalUrl);
  if (token !== journeyRequestToken) return; // something newer took over
  const { url, fallback } = previewSources(lesson.week, role, originalUrl);
  if (saved) {
    startPreview(saved, `${lesson.title} (${label})`, transcodedPreviewUrl(lesson.week, role), lesson.week);
  } else {
    startPreview(url, `${lesson.title} (${label})`, fallback, lesson.week);
  }
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

/* A pick from outside this page (the configure relay, the phone remote in
   28-phone-remote.js), checked as strictly as a click: a choice from
   PICKER_CHOICES, a week this kiosk's own lessons.json knows, and a Leader
   Video for the Leader side. { lesson, choice } or { reason } (the phone
   remote's words for it); 'lessons-loading' only before the list is in. */
function pickerTargetFor(data) {
  if (!data || typeof data !== 'object' || !Number.isInteger(data.week)) return { reason: 'unknown-week' };
  const choice = data.choice;
  if (typeof choice !== 'string' || !Object.prototype.hasOwnProperty.call(PICKER_CHOICES, choice)) return { reason: 'unknown' };
  if (!allLessons) return { reason: 'lessons-loading' };
  const lesson = allLessons.find((l) => l && l.week === data.week);
  if (!lesson) return { reason: 'unknown-week' };
  if (PICKER_NEEDS_LEADER.includes(choice) && !lesson.leaderDownloadUrl) return { reason: 'no-leader' };
  return { lesson, choice };
}

function handleConfigureRelay(message) {
  if (CONFIGURE_MODE) return false;
  if (!message || typeof message !== 'object' || message.screen !== 'journey') return false;
  if (!RELAY_ACTIONS.includes(message.action)) return false;
  const target = pickerTargetFor(message.data);
  if (target.reason === 'lessons-loading') {
    // Warmed at startup, so this is only a relay in the first seconds after a
    // boot: take it once the list is in.
    loadAllLessons().then((lessons) => { if (lessons) handleConfigureRelay(message); });
    return false;
  }
  if (!target.lesson) return false;
  const { lesson, choice } = target;
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
   show, endPreview() for a preview. The ⇄ button and the window's end tear
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

// Awana's own decks for lessons 2-2 (Monotheism) and 2-4 (Naturalism) were
// published swapped; weeks 6 and 8 hold the right pictures since 2026-10-14.
// A kiosk keys saved pictures by address and never re-fetches one it has, so
// these two weeks carry a revision in the address: an old copy is never reused.
const SLIDE_REVISIONS = { 6: 2, 8: 2 };

function slideRevision(week) {
  return SLIDE_REVISIONS[week] ? `?r=${SLIDE_REVISIONS[week]}` : '';
}

function slideImageUrl(week, n) {
  return `slides/${weekTag(week)}/slide-${n}.jpg${slideRevision(week)}`;
}

function slideTemplateUrl(week) {
  return `slides/${weekTag(week)}/template.jpg${slideRevision(week)}`;
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
// JSON.stringify per character is silly.
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
      kind, // which fill (the phone remote reports it: 28-phone-remote.js)
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

/* A slide's picture, fetched (cache first, above) AND decoded, memoized per
   slideshow: { src } once the browser can paint it without a decode on the
   frame it appears (the decoded Image is kept in the map so it stays warm).
   A picture that will not decode still resolves, so the element gets its
   src and its own 'error' handling (skip ahead) runs as before. showSlide()
   puts a picture on screen only through this, the next slide is decoded
   ahead through it, and the slide-change motion (24-motion.js) holds its
   carry on the same promise, so a step never uncovers a half-loaded slide. */
function slidePicture(show, url) {
  if (!show.pictures) show.pictures = new Map();
  if (show.pictures.has(url)) return show.pictures.get(url).ready;
  const entry = { img: null, ready: null };
  entry.ready = Promise.resolve(resolveSlideUrl(show, url)).then((src) => {
    if (slideshow !== show || typeof Image !== 'function') return { src };
    const img = new Image();
    entry.img = img;
    img.src = src;
    if (typeof img.decode !== 'function') return { src };
    return img.decode().then(() => ({ src }), () => ({ src }));
  });
  show.pictures.set(url, entry);
  return entry.ready;
}

function startTeachingSlides(week, onFinish) {
  const items = buildSlideItems(week);
  if (!items.length) return false;
  stopTeachingSlides();
  ++journeyRequestToken; // nothing in flight should touch the video now
  cancelLessonIntro();
  slideshow = { week, items, index: 0, onFinish, blobUrls: new Map(), pictures: new Map(), errors: 0 };
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
  trekView.classList.add('hidden'); // a lesson or preview over Trek's card takes the screen
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
    slidePicture(show, item.url).then(({ src }) => {
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
    slidePicture(show, item.url).then(({ src }) => {
      if (slideshow !== show || show.index !== index) return;
      slideTemplate.style.backgroundImage = `url("${src}")`;
    });
  }
  // Fetch and decode the next slide now, so the step lands instantly.
  const next = show.items[index + 1];
  if (next) slidePicture(show, next.url);
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
   costs one lookup and nothing else. The sync session
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
   The kiosk is wall-mounted and nobody wants to find a keyboard to
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
  // A club transition's black with no welcome on it is nobody's to watch
  // (the black is only ever up when nothing below is being watched; the
  // splash waiting under it is not on screen yet).
  if (gapBlackUp() && !gapWelcoming()) return true;
  const el = document.activeElement;
  const typing =
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  return (
    !previewMode &&
    !slideshowActive() &&
    !lessonIntroActive() &&
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
/* ── Motion: Journey's motion graphics (owner 2026-10-12) ─────────────
   Journey moves like a sports broadcast: the splash, every menu, Read Prep,
   the handout, the slides and the flip between the Check-in Display and
   Journey. A page without motion (configure mode, or the OS asking for
   reduced motion) gets no class, no observer, no element, no inline style
   (only the reduced-motion query is listened to), and every rule in
   style.css's motion block is scoped to html.motion-full (see that block
   for its rules).

   html.motion-full is set when BOTH hold: not configure mode, and the OS
   does not ask for reduced motion (the stylesheet checks that too). It
   follows the OS setting live.

   Most motion is plain CSS that runs when an element is shown. Two pieces
   need a hand from here, and both are driven by watching the DOM rather
   than by touching the code that changes it, so no view switch or slide
   step waits on motion, and none of them knows motion exists. Both are the
   same move (owner 2026-10-12, "the band carries it"): a striped colour
   band sweeps across in ONE eased motion, the old picture rides off
   attached to the band's leading edge (same keyframes, same timing, so they
   never part), and the new picture, already in place underneath, is
   uncovered behind the band's trailing edge. Nothing waits for it, a new
   change cancels it and starts its own, and it never takes a click.
   - the view flip: a layer's `hidden` class changing (setView,
     requestPlayback, startTeachingSlides all flip them). The outgoing layer
     is the old picture: .jm-carry-out shows it again for the flip (the
     `hidden` class stays on, so every check in the code still reads it as
     hidden; the check-in iframe is restyled, never moved or reloaded) and
     moves it off with the band. Never at startup (this file runs after the
     first setView), never over a playing video (a video that starts playing
     ends it at once), never into Trek's card (it has its own entrance).
   - the slide change: the slide counter's text changing (showSlide). The
     old slide is a copy of the stage taken once the slide had landed
     (.jm-slide-ghost), carried off over the new one; the new slide's own
     layers then settle in as they are uncovered (animateSlideLayers). */
const MOTION_CLASS = 'motion-full';
// The splash's entrances wait this long under the flip, so its pieces land
// as the band uncovers them rather than playing out behind it.
const MOTION_LEAD_MS = 380;
// The carry's length (style.css --jm-carry-ms has the same numbers) and a
// backstop for its end, in case animationend never comes (hidden tab).
const CARRY_FLIP_MS = 1000;
const CARRY_SLIDE_MS = 720;
const reducedMotionQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
let motionWatchers = null;
let motionStinger = null; // the flip's band layer, while it runs
let motionOutgoing = null; // the layer it is carrying off
let motionLeadTimer = null;
let shownLayer = null;
let lastSlideNumber = 0;

function motionWanted() {
  if (CONFIGURE_MODE) return false;
  return !(reducedMotionQuery && reducedMotionQuery.matches);
}

function motionOn() {
  return document.documentElement.classList.contains(MOTION_CLASS);
}

/* The splash (and Trek's card) can be on screen the moment the page starts,
   while the kit's fonts are still arriving (index.html preloads them;
   warmBrandFonts asks for them). An entrance played in the fallback face and
   then swapped mid-slam reads as a glitch, so at startup those entrances are
   held at their first frame (.jm-fonts-wait, style.css: paused, never
   restyled) until document.fonts.ready, or FONTS_WAIT_MAX_MS at most: a font
   that never comes never holds the screen. Startup only, motion only; nothing
   waits on it. */
const FONTS_WAIT_CLASS = 'jm-fonts-wait';
const FONTS_WAIT_MAX_MS = 1200;
let fontsWaitDone = false;

function holdEntrancesForFonts() {
  if (fontsWaitDone) return;
  fontsWaitDone = true;
  const fonts = document.fonts;
  if (!fonts || !fonts.ready || typeof fonts.ready.then !== 'function' || fonts.status === 'loaded') return;
  const root = document.documentElement;
  root.classList.add(FONTS_WAIT_CLASS);
  const release = () => root.classList.remove(FONTS_WAIT_CLASS);
  const timer = setTimeout(release, FONTS_WAIT_MAX_MS);
  fonts.ready.then(
    () => {
      clearTimeout(timer);
      release();
    },
    () => {} // the timer releases it
  );
}

function applyMotion() {
  const root = document.documentElement;
  if (motionWanted()) {
    root.classList.add(MOTION_CLASS);
    holdEntrancesForFonts();
    startMotionWatchers();
    return;
  }
  root.classList.remove(FONTS_WAIT_CLASS);
  if (!root.classList.contains(MOTION_CLASS)) return; // never touch a still page
  root.classList.remove(MOTION_CLASS);
  stopMotionWatchers();
  clearStinger();
  clearSlideCarry();
  cancelSlideLayers();
  slideGhostSource = null;
}

// Which of the three full-screen layers is showing.
function visibleLayer() {
  if (!journeyView.classList.contains('hidden')) return journeyView;
  if (!trekView.classList.contains('hidden')) return trekView;
  return checkinView;
}

function startMotionWatchers() {
  if (motionWatchers) return;
  shownLayer = visibleLayer();
  const flip = new MutationObserver((records) => {
    const was = shownLayer;
    const now = visibleLayer();
    shownLayer = now;
    if (was === now) return;
    // Under a club transition's black (29-transition-gap.js) the black is the
    // transition: no band rides over it.
    if (gapBlackUp()) {
      clearStinger();
      return;
    }
    // Into Trek's card: the card has its own entrance (style.css). Only
    // flips into or out of Journey get the band, as they always have.
    if (now === trekView || (was !== journeyView && now !== journeyView)) {
      clearStinger();
      return;
    }
    const keep = was === journeyView ? keptJourneyPieces(records) : [];
    playViewFlip(was, now === journeyView ? 'journey' : 'checkin', keep);
  });
  for (const layer of [journeyView, trekView, checkinView, ...CARRY_KEEPABLE]) {
    flip.observe(layer, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  }
  const slides = new MutationObserver(onSlideCounterChange);
  slides.observe(slideCounter, { childList: true, characterData: true, subtree: true });
  journeyVideo.addEventListener('playing', clearStinger);
  motionWatchers = [flip, slides];
}

function stopMotionWatchers() {
  if (!motionWatchers) return;
  for (const watcher of motionWatchers) watcher.disconnect();
  journeyVideo.removeEventListener('playing', clearStinger);
  motionWatchers = null;
}

function videoPlaying() {
  return !journeyVideo.classList.contains('hidden') && !journeyVideo.paused;
}

function clearStinger() {
  if (motionStinger) motionStinger.remove();
  motionStinger = null;
  if (motionOutgoing) motionOutgoing.classList.remove('jm-carry-out', 'is-back');
  motionOutgoing = null;
  for (const piece of motionKept) piece.classList.remove('jm-carry-keep');
  motionKept = [];
  const still = slidesView.querySelector('.jm-slide-still');
  if (still) still.remove();
}

/* Leaving Journey, the code that changes the view has already put away what
   Journey was showing (stopJourneyContent hides the splash, empties the
   slides) before this sees the flip, so the old picture would be black. The
   pieces that are pictures rather than playback (the splash, the
   placeholder, the slides) are shown again for the carry by .jm-carry-keep
   (their `hidden` class stays on and their entrances are held at rest, so
   they ride off exactly as they stood); the slides get the copy of the last
   slide that landed. The video is never kept: its source is gone. */
const CARRY_KEEPABLE = [journeyPlaceholder, journeySplash, slidesView];
let motionKept = [];

function keptJourneyPieces(records) {
  const before = new Map();
  for (const record of records) {
    if (CARRY_KEEPABLE.includes(record.target) && !before.has(record.target)) {
      before.set(record.target, record.oldValue || '');
    }
  }
  return CARRY_KEEPABLE.filter((piece) => {
    const wasShown = before.has(piece)
      ? !/(^|\s)hidden(\s|$)/.test(before.get(piece))
      : !piece.classList.contains('hidden');
    return wasShown && piece.classList.contains('hidden');
  });
}

// The band: four stripes, trailing to leading hot, ink, deep, club purple.
// The purple's leading edge is square (the old picture hangs on it); the
// stripes between are slanted (style.css).
function buildCarryBand() {
  const band = document.createElement('div');
  band.className = 'jm-carry-band';
  const stripes = document.createElement('div');
  stripes.className = 'jm-carry-stripes';
  for (let i = 0; i < 4; i += 1) {
    const stripe = document.createElement('span');
    stripe.className = 'jm-carry-stripe';
    stripes.appendChild(stripe);
  }
  band.appendChild(stripes);
  return band;
}

// Calls `done` once, when `band` ends its carry (by event, or by the timer
// for a tab that never sends it).
function afterCarry(band, ms, done) {
  let fired = false;
  const once = () => {
    if (fired) return;
    fired = true;
    done();
  };
  band.addEventListener('animationend', (event) => {
    if (!event.animationName || /^jm-carry/.test(event.animationName)) once();
  });
  setTimeout(once, ms);
}

function playViewFlip(from, to, keep = []) {
  clearStinger();
  if (!motionOn() || videoPlaying()) return;
  for (const piece of keep) {
    if (piece === slidesView) {
      if (!slideGhostSource) continue;
      const still = document.createElement('div');
      still.className = 'jm-slide-still';
      still.setAttribute('aria-hidden', 'true');
      still.inert = true;
      still.appendChild(slideGhostSource.node);
      slideGhostSource = null;
      slidesView.appendChild(still);
    }
    piece.classList.add('jm-carry-keep');
    motionKept.push(piece);
  }
  const back = to === 'checkin'; // back to the Check-in Display: right to left
  const stinger = document.createElement('div');
  stinger.className = back ? 'jm-stinger is-back' : 'jm-stinger';
  stinger.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  stinger.appendChild(band);
  // Same frame, same keyframes, same timing: the old layer and the band
  // start together and stay together.
  from.classList.add('jm-carry-out');
  if (back) from.classList.add('is-back');
  document.body.appendChild(stinger);
  motionStinger = stinger;
  motionOutgoing = from;
  afterCarry(band, CARRY_FLIP_MS + 600, () => {
    if (motionStinger === stinger) clearStinger();
  });
  if (to === 'journey') {
    const root = document.documentElement;
    root.style.setProperty('--jm-lead', `${MOTION_LEAD_MS}ms`);
    clearTimeout(motionLeadTimer);
    motionLeadTimer = setTimeout(() => root.style.removeProperty('--jm-lead'), 2000);
  }
}

/* The lesson intro's last card into the video (06-lesson-intro.js): the same
   carry, the card hung on the band, the video (attached, still paused) what
   it uncovers. The one place motion is waited on, because the intro is a
   timed sequence of its own: `done` (which starts the video) runs when the
   band has passed, at once without motion. */
const CARRY_INTRO_MS = 820;
let introCarry = null; // { el, sweep }

function cancelIntroCarry() {
  if (!introCarry) return;
  introCarry.sweep.remove();
  introCarry.el.classList.remove('jm-intro-out');
  introCarry = null;
}

function carryIntroOff(el, done) {
  cancelIntroCarry();
  if (!motionOn()) {
    done();
    return;
  }
  const sweep = document.createElement('div');
  sweep.className = 'jm-intro-sweep';
  sweep.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  sweep.appendChild(band);
  el.classList.add('jm-intro-out');
  el.after(sweep);
  const carry = { el, sweep };
  introCarry = carry;
  afterCarry(band, CARRY_INTRO_MS + 400, () => {
    if (introCarry !== carry) return;
    cancelIntroCarry();
    done();
  });
}

/* The slide change. The copy of the slide on screen is taken once that
   slide has landed (its picture resolved: the cache read showSlide started),
   so when the next press changes the stage the old slide is still in hand.
   It is the stage cloned whole, ids and all, inside an aria-hidden,
   click-through layer appended AFTER the real stage: the deck's own pinned
   rules style the copy exactly like the original, every lookup in the code
   (cached references, getElementById) still finds the real one first, and
   the copy is gone in under a second. No copy yet (the first slide, or a
   press faster than the cache) carries off plain black instead. */
let slideGhostSource = null; // { show, node }
let slideCarry = null; // { ghost, sweep }

function captureSlideSource() {
  if (!motionOn() || !slideshowActive()) return;
  slideGhostSource = { show: slideshow, node: slideStage.cloneNode(true) };
}

function clearSlideCarry() {
  if (!slideCarry) return;
  slideCarry.ghost.remove();
  slideCarry.sweep.remove();
  slideCarry = null;
}

function onSlideCounterChange() {
  if (!motionOn() || slidesView.classList.contains('hidden') || !slideshowActive()) return;
  const match = /(\d+)/.exec(slideCounter.textContent || '');
  const number = match ? Number(match[1]) : 0;
  const back = number === lastSlideNumber - 1;
  lastSlideNumber = number;
  const show = slideshow;
  const old = slideGhostSource && slideGhostSource.show === show ? slideGhostSource.node : null;
  slideGhostSource = null;
  // Take this slide's copy once its picture is in (the same memoized
  // promise showSlide is waiting on, so this runs right after it).
  // (slidePicture: showSlide registered first on the same promise, so the
  // new picture is already on the stage when the copy is taken.)
  const item = show.items[show.index];
  const landed = item ? slidePicture(show, item.url) : Promise.resolve();
  landed.then(() => {
    if (slideshow === show && show.index === number - 1) captureSlideSource();
  }, () => {});
  if (typeof slideCounter.animate === 'function') {
    slideCounter.animate(
      [{ opacity: 0, transform: 'scale(1.3)' }, { opacity: 1, transform: 'none' }],
      { duration: 260, easing: MOTION_EASE.settle }
    );
  }
  clearSlideCarry();
  // Under the flip's band, slide 1 is what the flip uncovers.
  if (motionStinger) {
    animateSlideLayers(back, MOTION_LEAD_MS);
    return;
  }
  // The old slide and the band go up at once, HELD at their first frame
  // (.jm-hold: the old slide still covers the stage, the band still off
  // screen), and the new slide's layers wait at theirs, until the new
  // slide's picture is decoded: the carry never uncovers a black or
  // half-painted stage. Never longer than SLIDE_HOLD_MAX_MS (a picture
  // coming slowly from the network), and a new press replaces it all.
  const ghost = document.createElement('div');
  ghost.className = back ? 'jm-slide-ghost jm-hold is-back' : 'jm-slide-ghost jm-hold';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  if (old) ghost.appendChild(old);
  const sweep = document.createElement('div');
  sweep.className = back ? 'jm-slide-sweep jm-hold is-back' : 'jm-slide-sweep jm-hold';
  sweep.setAttribute('aria-hidden', 'true');
  const band = buildCarryBand();
  sweep.appendChild(band);
  slidesView.append(ghost, sweep);
  const carry = { ghost, sweep };
  slideCarry = carry;
  afterCarry(band, CARRY_SLIDE_MS + SLIDE_HOLD_MAX_MS + 500, () => {
    if (slideCarry === carry) clearSlideCarry();
  });
  const anims = animateSlideLayers(back, 0, { held: true });
  let released = false;
  const release = () => {
    if (released || slideCarry !== carry) return;
    released = true;
    ghost.classList.remove('jm-hold');
    sweep.classList.remove('jm-hold');
    for (const anim of anims) {
      // A cancelled one (a newer press) stays cancelled.
      if (anim.playState === 'paused') anim.play();
    }
  };
  setTimeout(release, SLIDE_HOLD_MAX_MS);
  landed.then(release, release);
}

const SLIDE_HOLD_MAX_MS = 400;

/* The new slide's own layers (owner 2026-10-12), timed to the band: the
   background drifts the last few percent in the band's direction (a little
   parallax, same curve, so it reads as being pushed into place), and on a
   generated slide the heading's words and the bullets settle in as the
   trailing edge uncovers them: short moves, quick fades, no overshoot. The
   new slide is already in place when this runs (showSlide is synchronous;
   this is a microtask after it). Web Animations from here, not stylesheet
   keyframes, because the same elements stay on screen from slide to slide
   and have to restart every step; a second press cancels what is running
   and starts the next slide's (nothing ever waits on them). Fill
   `backwards` only: when they end the deck's own pinned declarations are
   all that is left. The words are the heading's own text split at its
   spaces into .jm-word spans (textContent unchanged, nothing reordered; the
   next showSlide rewrites the heading anyway). */
const MOTION_EASE = {
  settle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  carry: 'cubic-bezier(0.5, 0, 0.2, 1)',
};
let slideLayerAnims = [];

function cancelSlideLayers() {
  for (const anim of slideLayerAnims) anim.cancel();
  slideLayerAnims = [];
}

function splitHeadingWords(heading) {
  const text = heading.textContent;
  heading.textContent = '';
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      heading.appendChild(document.createTextNode(part));
    } else {
      const word = document.createElement('span');
      word.className = 'jm-word';
      word.textContent = part;
      heading.appendChild(word);
    }
  }
  return [...heading.querySelectorAll('.jm-word')];
}

function animateSlideLayers(back, lead, { held = false } = {}) {
  cancelSlideLayers();
  if (typeof slideStage.animate !== 'function') return [];
  const play = (el, frames, duration, easing, delay) => {
    const anim = el.animate(frames, { duration, easing, delay: lead + delay, fill: 'backwards' });
    // Held: in place at its first frame until the picture is in (above).
    if (held && typeof anim.pause === 'function') anim.pause();
    slideLayerAnims.push(anim);
  };
  const template = !slideTemplate.classList.contains('hidden');
  const layer = template ? slideTemplate : slideImage;
  const dir = back ? 1 : -1;
  play(
    layer,
    [{ transform: `translateX(${dir * 6}%)` }, { transform: 'none' }],
    CARRY_SLIDE_MS,
    MOTION_EASE.carry,
    0
  );
  if (!template) return slideLayerAnims.slice();
  // The trailing edge reaches the bullets (left) before the heading
  // (centre) going forward, the other way round going back.
  const words = splitHeadingWords(slideTemplateHeading);
  const headingAt = back ? 220 : 280;
  const bulletsAt = back ? 280 : 200;
  words.forEach((word, i) => {
    play(
      word,
      [
        { opacity: 0, transform: `translateX(${dir * 0.5}em) scale(1.08)` },
        { opacity: 1, transform: 'none' },
      ],
      440,
      MOTION_EASE.settle,
      headingAt + i * 55
    );
  });
  [...slideTemplateBullets.children].forEach((li, i) => {
    play(
      li,
      [
        { opacity: 0, transform: `translateX(${dir * 1.2}em)` },
        { opacity: 1, transform: 'none' },
      ],
      460,
      MOTION_EASE.settle,
      bulletsAt + i * 90
    );
  });
  return slideLayerAnims.slice();
}

if (reducedMotionQuery) {
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', applyMotion);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(applyMotion);
  }
}
applyMotion();
/* ── Trek: small group time (owner 2026-10-12) ─────────────────────────
   On a CLUB NIGHT, 7:00-7:30 PM, the screen is Trek's title card ("TREK ·
   SMALL GROUP TIME", #trek-view) instead of the Check-in Display. Three
   things feed it, none of them a new connection of its own:

   - Is tonight a club night? Exactly the lobby's answer: the shared rule
     shared/clubNight.js (copied byte for byte beside this script by
     scripts/family-assets.mjs, loaded once as an ES module) asked with the
     lobby's own two files, its shared/schedule.json (noClub and special
     dates) and its calendar-feed.json (the season, cancelled nights). Both
     are same-origin under ../lobby/, read at startup and every six hours,
     the last good copy kept in the asset cache for a dead connection. Until
     the rule has loaded, no night is a club night (the card never guesses).
   - How many Trek kids are here: the embedded lobby (the frame under this
     page, which already holds the one live socket) leaves the latest tally's
     per-club counts in this origin's localStorage (`awanaClubCounts.v1`,
     numbers only: lobby/src/lib/clubCountsStore.js); its `storage` event
     redraws the chip. A count from another day, or none, hides the chip.
   - Tonight's Trek lesson: only a calendar entry on tonight's date that
     names Trek in so many words ("Trek: <title>", "Trek - <title>", "Trek
     Lesson 4: <title>"), uncancelled, and only when exactly one title
     matches. Anything else shows no title: never a guess.

   Journey's own count chip (owner 2026-10-12) reads the same entry
   (byClub.journey): over the Journey view (splash, slides, the menus) but
   never while a lesson video is up (playing, paused or loading), a reading
   overlay is open, or the Trek card shows (renderJourneyChip()).

   The schedule side (scheduledPhase() 'trek', the poll waiting for a running
   lesson, lessonDoneView()) lives with the other views; this file only knows
   the night and draws the card. */
const CLUB_COUNTS_KEY = 'awanaClubCounts.v1';
// A tally older than this (or from another day) is not tonight's count.
const TREK_COUNT_MAX_AGE_MS = 12 * 60 * 60 * 1000;
// The printer's clock may run a little ahead of the kiosk's.
const TREK_COUNT_SKEW_MS = 60 * 60 * 1000;
const TREK_NIGHT_REFRESH_MS = 6 * 60 * 60 * 1000;
const TREK_SCHEDULE_URL = new URL('shared/schedule.json', CHECKIN_DISPLAY_URL).href;
const TREK_FEED_URL = new URL('calendar-feed.json', CHECKIN_DISPLAY_URL).href;
// The rule sits beside this script (src/shared/clubNight.js) and is asked for
// with this script's own ?v=, so a deploy never pairs new code with a stale
// rule from the disk cache. (A test hands it over: window.journeyClubNightModule.)
const CLUB_NIGHT_MODULE_URL = (() => {
  const own = document.currentScript && document.currentScript.src;
  const url = new URL('shared/clubNight.js', own || new URL('src/schedule.js', window.location.href).href);
  if (own) url.search = new URL(own).search;
  return url.href;
})();
// "Trek: <title>" / "Trek - <title>" / "Trek · <title>" / "Trek Lesson 4: <title>".
const TREK_TITLE_PATTERN = /^\s*trek\b(?:\s*[:|·•–—-]\s*(.+?)|\s+(lesson\b.+?))\s*$/i;
const TREK_TITLE_MAX = 80;

/** True when `now` falls on a club night by the lobby's rule (time of day aside). */
function trekSmallGroupTime(now) {
  if (!trekNight.ready || !trekNight.rule) return false;
  try {
    return trekNight.rule.clubNightToday(now, { schedule: trekNight.schedule, feed: trekNight.feed }) === true;
  } catch {
    return false;
  }
}

/** Tonight's date key in the church's zone (the calendar's dates), else the kiosk's own. */
function trekDateKey(now) {
  if (trekNight.rule && typeof trekNight.rule.zonedParts === 'function') {
    const zone = trekNight.schedule && typeof trekNight.schedule.timezone === 'string' ? trekNight.schedule.timezone : undefined;
    try {
      return trekNight.rule.zonedParts(now, zone).dateKey;
    } catch {
      /* the kiosk's own date below */
    }
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A lesson the Trek card must not cut: its video, its slides, or the steps just before. */
function journeyLessonRunning() {
  return (
    slideshowActive() ||
    lessonIntroActive() ||
    journeyVideo.hasAttribute('src') ||
    isCaptionPromptOpen() ||
    !journeyLoading.classList.contains('hidden')
  );
}

/**
 * Tonight's Trek count from the lobby's stored entry, or null when there is
 * none worth showing (missing, malformed, another day's, no Trek entry).
 * Pure: the raw localStorage string and the time.
 */
function trekCountFrom(raw, nowMs) {
  return clubCountFrom(raw, nowMs, 'trek');
}

/** Tonight's count for one club id ('trek', 'journey') from the stored entry, or null. */
function clubCountFrom(raw, nowMs, club) {
  if (typeof raw !== 'string') return null;
  let entry;
  try {
    entry = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!entry || entry.v !== 1 || typeof entry.at !== 'number' || !Number.isFinite(entry.at)) return null;
  const age = nowMs - entry.at;
  if (age > TREK_COUNT_MAX_AGE_MS || age < -TREK_COUNT_SKEW_MS) return null;
  if (new Date(entry.at).toDateString() !== new Date(nowMs).toDateString()) return null;
  const n = entry.byClub && entry.byClub[club];
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : null;
}

/**
 * Tonight's Trek lesson title from the calendar's events, or null. Only a
 * title that says it is Trek's, on `dateKey`, not cancelled, and only one
 * distinct such title (two different ones = no title).
 */
function trekLessonTitleFor(events, dateKey) {
  if (!Array.isArray(events)) return null;
  const titles = new Set();
  for (const event of events) {
    if (!event || event.date !== dateKey || event.isCancelled === true || typeof event.title !== 'string') continue;
    const match = event.title.match(TREK_TITLE_PATTERN);
    if (!match) continue;
    const title = (match[1] || match[2] || '').replace(/\s+/g, ' ').trim();
    if (title) titles.add(title);
  }
  if (titles.size !== 1) return null;
  const [title] = titles;
  return title.length <= TREK_TITLE_MAX ? title : null;
}

function readClubCounts() {
  try {
    return localStorage.getItem(CLUB_COUNTS_KEY);
  } catch {
    return null;
  }
}

/* Draws what the card knows right now. Cheap (one storage read, no network)
   and touches only what changed, so the chip's entrance never replays for
   the same number. */
function renderTrekCard() {
  const now = new Date();
  const count = trekCountFrom(readClubCounts(), now.getTime());
  const countText = count == null ? '' : String(count);
  if (trekChipCount.textContent !== countText) trekChipCount.textContent = countText;
  trekChip.classList.toggle('hidden', count == null);
  const title = trekNight.feed ? trekLessonTitleFor(trekNight.feed.events, trekDateKey(now)) : null;
  if (trekLessonTitle.textContent !== (title || '')) trekLessonTitle.textContent = title || '';
  trekLesson.classList.toggle('hidden', !title);
}

/* Journey's count chip: up only while the Journey view shows something that
   is not a lesson video (the splash, the placeholder, the teaching slides,
   the caption question, the Settings menus over them), and a count is
   known. Cheap; re-asked whenever one of the layers it depends on changes. */
function journeyChipWanted() {
  return (
    !journeyView.classList.contains('hidden') &&
    trekView.classList.contains('hidden') &&
    journeyVideo.classList.contains('hidden') &&
    journeyLoading.classList.contains('hidden') &&
    !readerOverlayOpen()
  );
}

function renderJourneyChip() {
  const count = journeyChipWanted() ? clubCountFrom(readClubCounts(), Date.now(), 'journey') : null;
  const text = count == null ? '' : String(count);
  if (journeyChipCount.textContent !== text) journeyChipCount.textContent = text;
  journeyChip.classList.toggle('hidden', count == null);
  // Over the teaching slides it moves into the pillarbox bar, off Awana's
  // slide (style.css, #journey-chip.beside-slides).
  journeyChip.classList.toggle('beside-slides', count != null && !slidesView.classList.contains('hidden'));
}

const isPlainObject = (data) => !!data && typeof data === 'object' && !Array.isArray(data);
const isTrekFeed = (data) => isPlainObject(data) && Array.isArray(data.events);

/* One same-origin JSON file: the network first (the calendar changes), the
   last good copy (asset cache) when it cannot answer. A copy is stored only
   after it parsed and passed `valid`. */
async function trekJson(url, valid) {
  try {
    const res = await fetchWithTimeout(url, { cache: 'no-cache' }, 5000);
    if (res.ok) {
      const text = await res.text();
      const data = JSON.parse(text);
      if (valid(data)) {
        if ('caches' in window) {
          try {
            const cache = await caches.open(ASSET_CACHE_NAME);
            await cache.put(url, new Response(text, { headers: { 'content-type': 'application/json' } }));
          } catch {
            /* not storable now: still usable live */
          }
        }
        return data;
      }
    }
  } catch {
    /* offline, timed out, or not JSON: the stored copy below */
  }
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    const hit = await cache.match(url);
    const data = hit ? await hit.json() : null;
    return valid(data) ? data : null;
  } catch {
    return null;
  }
}

async function loadClubNightRule() {
  if (window.journeyClubNightModule) return window.journeyClubNightModule;
  try {
    return await import(CLUB_NIGHT_MODULE_URL);
  } catch {
    return null;
  }
}

/* Learns tonight (startup, then every six hours). A failed read keeps what
   was known; a rule that never loads keeps every night an ordinary one. */
async function loadTrekNight() {
  const [rule, schedule, feed] = await Promise.all([
    trekNight.rule || loadClubNightRule(),
    trekJson(TREK_SCHEDULE_URL, isPlainObject),
    trekJson(TREK_FEED_URL, isTrekFeed),
  ]);
  if (schedule) trekNight.schedule = schedule;
  if (feed) trekNight.feed = feed;
  if (rule && typeof rule.clubNightToday === 'function') {
    trekNight.rule = rule;
    trekNight.ready = true;
  }
  // A club night learned inside 7:00-7:30 flips now, not at the next poll.
  pollSchedule();
  if (!trekView.classList.contains('hidden')) renderTrekCard();
}

if (!CONFIGURE_MODE) {
  loadTrekNight();
  setInterval(loadTrekNight, TREK_NIGHT_REFRESH_MS);
  // The lobby frame writing a new tally (another document, same origin).
  window.addEventListener('storage', (event) => {
    if (event.key !== null && event.key !== CLUB_COUNTS_KEY) return;
    if (!trekView.classList.contains('hidden')) renderTrekCard();
    renderJourneyChip();
  });
  // And a slow redraw, for a write the event missed and a count going stale.
  setInterval(() => {
    if (!trekView.classList.contains('hidden')) renderTrekCard();
    renderJourneyChip();
  }, POLL_INTERVAL_MS);
  // Journey's chip follows the layers it depends on: one observer on their
  // `hidden` classes (no per-frame work), so no code that changes a view has
  // to remember it, and the chip is gone in the same task the video shows.
  const chipLayers = new MutationObserver(renderJourneyChip);
  for (const el of [journeyView, trekView, journeyVideo, journeyLoading, prepView, handoutView, slidesView]) {
    chipLayers.observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  renderJourneyChip();
}
/* ── Settings: "Download all lessons (full quality)" ─────────────────────
   Owner 2026-10-12: the church's internet at the kiosk is slow, so every
   lesson's ORIGINAL video can be saved onto the kiosk PC ahead of time; a
   saved lesson then plays from the disk (05-stream-first.js). Storage and
   playback: 04-lesson-store.js. This file is the downloader and its panel.

   - One video at a time, Student Videos first (from this week on, then the
     earlier weeks), then Leader Videos (a tick box, on by default).
   - fetch() streaming, so every percentage is real bytes: Content-Length /
     Content-Range from the server, bytes counted as they arrive.
   - Resumable: each finished 16 MiB piece is on disk for good; an interrupted
     video carries on from the next piece with `Range: bytes=N-` (a
     CORS-safelisted header: no preflight, which CloudFront would refuse).
     A video already saved is skipped. A reload or a restart of the PC
     carries on by itself (journey.downloads.run = 'running').
   - One failing video never stops the rest: it is tried 3 more times
     (10 s, 30 s, 1 min), then left with a plain reason, and pressing
     Download again retries it. Only "no disk space" stops the run.
   - Gives way to the room: while a lesson video plays from the internet the
     download waits (it would slow the lesson down), and carries on after.
   - Fetches nothing but lessons.json's cdnUrl / leaderCdnUrl video files
     (scripts/resolve-lesson-files.mjs). Licensing: kiosk-only caching for
     this kiosk's own playback (CLAUDE.md "licensing").
   - Configure mode (the app's Settings window) never downloads: the kiosk's
     own Settings does.
   - AUTOMATIC (owner 2026-10-12, Settings "Download lessons automatically",
     journey.downloads.auto; on by default in the KVBC Awana app, off by
     default in a plain browser, see inKioskApp()): a kiosk starts by itself a few
     minutes after the page loads, re-checks every poll (15 s) and on
     'online', and a finished pass looks again every 30 min (new lessons in
     lessons.json are picked up then). An automatic run holds while a lesson
     is on (video, intro, slides, caption question, the Trek card, a handout
     or Read Prep) and through the quiet hours around the evening
     (downloadQuietTime(): an hour before the 6:30 lesson to half an hour
     after Trek's 7:30 end, i.e. 5:30-8 PM, from the schedule constants), so
     the slow internet is free for check-in and the lesson. The button works
     any time (it only gives way to a video playing from the internet). A
     user's Pause holds automatic mode until Resume; Stop holds it until the
     page next loads.
   - Status for reporting: window.journeyDownloadStatus() and a
     'journey-download-status' CustomEvent on window when it changes (about
     once a second while downloading, at once on a saved video or an error).
   Timing is DOWNLOAD_TUNING; a test may override any of it through
   window.journeyDownloadTuning (read at each use). */
const DOWNLOADS_RUN_KEY = 'journey.downloads.run'; // 'running' | 'paused'
const DOWNLOADS_LEADERS_KEY = 'journey.downloads.leaders'; // '1' | '0'
const DOWNLOADS_AUTO_KEY = 'journey.downloads.auto'; // '1' | '0' (missing = on)
// The quiet hours, from the schedule itself: an hour before the 6:30 lesson
// to half an hour after Trek's small group time ends (5:30-8 PM).
const DOWNLOAD_QUIET_START_MINUTES = JOURNEY_START_MINUTES - 60;
const DOWNLOAD_QUIET_END_MINUTES = TREK_END_MINUTES + 30;
const DOWNLOAD_TUNING = {
  chunkBytes: LESSON_CHUNK_BYTES,
  retryMs: [10000, 30000, 60000],
  stallMs: 60000, // no byte for this long: the connection is dead, try again
  resumeAfterLoadMs: 30000, // a reload or reboot carries on after this
  yieldPollMs: 5000,
  renderMs: 400,
  rateWindowMs: 30000,
  spaceMarginBytes: 256 * 1024 * 1024,
  autoStartMs: 3 * 60 * 1000, // after page load, not in the boot rush
  autoRecheckMs: 30 * 60 * 1000, // after a finished (or failed) automatic pass
  autoTickMs: POLL_INTERVAL_MS,
  statusMs: 1000, // status events while downloading
};
function downloadTuning() {
  const override = window.journeyDownloadTuning;
  return override && typeof override === 'object' ? { ...DOWNLOAD_TUNING, ...override } : DOWNLOAD_TUNING;
}

const downloadsSection = document.getElementById('settings-downloads');
const downloadsLeadersInput = document.getElementById('downloads-leaders');
const downloadsAutoInput = document.getElementById('downloads-auto');
const downloadsStartBtn = document.getElementById('downloads-start-btn');
const downloadsPauseBtn = document.getElementById('downloads-pause-btn');
const downloadsResumeBtn = document.getElementById('downloads-resume-btn');
const downloadsStopBtn = document.getElementById('downloads-stop-btn');
const downloadsSummary = document.getElementById('downloads-summary');
const downloadsBar = document.getElementById('downloads-bar');
const downloadsBarFill = document.getElementById('downloads-bar-fill');
const downloadsStatus = document.getElementById('downloads-status');
const downloadsSpace = document.getElementById('downloads-space');
const downloadsList = document.getElementById('downloads-list');
const downloadsDeleteBtn = document.getElementById('downloads-delete-btn');
const downloadsConfirm = document.getElementById('downloads-confirm');
const downloadsConfirmText = document.getElementById('downloads-confirm-text');
const downloadsConfirmYes = document.getElementById('downloads-confirm-yes');
const downloadsConfirmNo = document.getElementById('downloads-confirm-no');

/* ── Pure pieces (unit-tested through window) ── */

const BINARY_GB = 1024 * 1024 * 1024;
const BINARY_MB = 1024 * 1024;

/* "1.2 GB" / "350 MB" (binary units, the way Windows shows disk sizes). */
function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= BINARY_GB) return `${(v / BINARY_GB).toFixed(1)} GB`;
  return `${Math.round(v / BINARY_MB)} MB`;
}

/* "3.1 of 7.4 GB": both in the unit of the larger. */
function formatBytePair(done, total) {
  const t = Math.max(0, Number(total) || 0);
  const d = Math.min(Math.max(0, Number(done) || 0), t);
  if (t >= BINARY_GB) return `${(d / BINARY_GB).toFixed(1)} of ${(t / BINARY_GB).toFixed(1)} GB`;
  return `${Math.round(d / BINARY_MB)} of ${Math.round(t / BINARY_MB)} MB`;
}

/* "about 25 min left", "about 2 h 10 min left", "less than a minute left". */
function formatTimeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}

/* Pure: is `date` (kiosk local time) inside the quiet hours, when an
   automatic download never runs? */
function downloadQuietTime(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= DOWNLOAD_QUIET_START_MINUTES && minutes < DOWNLOAD_QUIET_END_MINUTES;
}

function clockText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* Why a download must wait right now, in plain words, or null. Every run
   gives way to a video playing from the internet; an automatic run also to
   anything of the lesson on screen and to the quiet hours. Pure apart from
   the page state it is handed. */
function downloadHoldReason({ auto, videoFromInternet, lessonOnScreen, quiet }) {
  if (videoFromInternet) return 'a lesson video is playing from the internet';
  if (!auto) return null;
  if (lessonOnScreen) return 'a lesson is on screen';
  if (quiet) {
    return `it is lesson time (${clockText(DOWNLOAD_QUIET_START_MINUTES)} to ${clockText(DOWNLOAD_QUIET_END_MINUTES)}), when the internet is kept free for check-in and the lesson`;
  }
  return null;
}

function downloadLabel(item) {
  return `Week ${item.week} · ${item.role === 'leader' ? 'Leader' : 'Student'}`;
}

/* What to download, in order: Student Videos from `startWeek` on, then the
   weeks before it, then (with `leaders`) the Leader Videos in the same order.
   An item with no downloadable address keeps `url: null` (shown as such,
   never fetched, left out of the totals). */
function downloadPlan(lessons, { leaders = true, startWeek = 1 } = {}) {
  const sorted = (Array.isArray(lessons) ? lessons : [])
    .filter((l) => l && Number.isInteger(l.week))
    .slice()
    .sort((a, b) => a.week - b.week);
  const at = sorted.findIndex((l) => l.week >= startWeek);
  const ordered = at > 0 ? [...sorted.slice(at), ...sorted.slice(0, at)] : sorted;
  const items = [];
  for (const role of leaders ? ['student', 'leader'] : ['student']) {
    for (const lesson of ordered) {
      if (role === 'leader' && !lesson.leaderDownloadUrl) continue; // week 27
      const source = lessonFileSource(lesson, role);
      items.push({
        id: lessonFileId(lesson.week, role),
        week: lesson.week,
        role,
        url: source ? source.url : null,
        bytes: source ? source.bytes : null,
      });
    }
  }
  return items;
}

/* The overall numbers for the summary line. `files`: id -> { state, have,
   total } as on disk / arriving. Saved videos count as done; a partly saved
   one counts its bytes. `position` is the video being worked on, counted as
   "the n-th of the set" (saved ones first), so it reads like the owner's
   "Lesson 7 of 30". Percent is floored, so 100% means every byte is here. */
function downloadProgress(items, files, active) {
  const usable = (items || []).filter((i) => i.url);
  let done = 0;
  let total = 0;
  let saved = 0;
  let unknown = 0;
  for (const item of usable) {
    const f = (files && files[item.id]) || {};
    const size = f.total || item.bytes || 0;
    if (!size) unknown += 1;
    total += size;
    done += Math.min(f.have || 0, size);
    if (f.state === 'saved') saved += 1;
  }
  const count = usable.length;
  const lessons = new Set(usable.map((i) => i.week)).size;
  const percent = total > 0 ? (saved === count ? 100 : Math.min(99, Math.floor((done * 100) / total))) : 0;
  return {
    count,
    lessons,
    saved,
    done,
    total,
    unknown,
    percent,
    position: active ? Math.min(saved + 1, count) : 0,
  };
}

/* Bytes per second over the last `windowMs` of samples [{ t, bytes }]
   (bytes = running total received this session); null until there are at
   least 5 seconds of them. */
function downloadRate(samples, now, windowMs) {
  const recent = (samples || []).filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = (last.t - first.t) / 1000;
  if (span < 5) return null;
  return (last.bytes - first.bytes) / span;
}

/* The one line under the buttons, in plain words. */
function downloadSummaryText(progress, phase, rate) {
  const pair = formatBytePair(progress.done, progress.total);
  if (!progress.count) return 'No lesson videos can be downloaded from here.';
  if (phase === 'running' || phase === 'waiting') {
    const left = progress.total - progress.done;
    const eta = rate && rate > 0 ? formatTimeLeft(left / rate) : 'working out the time left';
    return `Video ${progress.position} of ${progress.count} · ${progress.percent}% · ${pair} · ${eta}`;
  }
  if (progress.saved === progress.count) {
    const lessons = progress.lessons || progress.count;
    return `All ${lessons} lessons saved ✓ (${progress.count} videos, ${formatBytes(progress.total)}, on this computer)`;
  }
  if (phase === 'paused') return `Paused · ${progress.percent}% · ${pair} saved`;
  if (!progress.done) return `Nothing saved yet · ${progress.count} videos, ${formatBytes(progress.total)} in all`;
  return `${progress.saved} of ${progress.count} videos saved · ${progress.percent}% · ${pair}`;
}

/* "bytes 100-199/1000" -> { start: 100, end: 199, total: 1000 }, else null. */
function parseContentRange(value) {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/i.exec(value || '');
  if (!m) return null;
  const range = { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
  return range.end >= range.start && range.total > range.end ? range : null;
}

/* What a failed download says, plainly. */
function plainDownloadError(err) {
  if (err && err.plain) return err.plain;
  if (err && err.name === 'QuotaExceededError') return 'this computer ran out of space for it';
  if (navigator.onLine === false) return 'there is no internet connection right now';
  return 'the internet connection dropped or Awana’s server did not answer';
}

function downloadError(plain, extra = {}) {
  const err = new Error(plain);
  err.plain = plain;
  return Object.assign(err, extra);
}

/* ── State ── */

const dl = {
  phase: 'idle', // idle | running | waiting | paused
  runId: 0,
  items: [],
  files: {}, // id -> { state, have, total }
  errors: {}, // id -> plain reason (failed this run)
  activeId: null,
  controller: null,
  abortWhy: null, // 'pause' | 'stall' | 'yield' while aborting on purpose
  samples: [],
  received: 0,
  note: '',
  tone: '',
  space: null, // { free, usage, quota, persisted }
  loop: null, // the running loop's promise
  renderTimer: null,
  rowsKey: '',
  auto: false, // the running (or last) run was automatic
  hold: null, // why the run is waiting, in plain words
  autoHeld: false, // Stop pressed: automatic mode rests until the page loads again
  nextAutoAt: 0, // no automatic pass before this (ms)
  loadedAt: Date.now(),
  inspected: false,
  lastSavedAt: null,
  lastError: null,
  statusTimer: null,
  statusSentAt: 0,
};

function downloadsLeadersWanted() {
  try {
    return localStorage.getItem(DOWNLOADS_LEADERS_KEY) !== '0';
  } catch {
    return true;
  }
}

/* Is this page running in the KVBC Awana app (Electron: the kiosk)? Only
   there is automatic downloading on by default: the same URL opens on a
   leader's Mac or phone, which must never start 8 GB by itself. */
function inKioskApp() {
  return /\bElectron\//.test(navigator.userAgent || '');
}

function downloadsAutoWanted() {
  try {
    const stored = localStorage.getItem(DOWNLOADS_AUTO_KEY);
    if (stored === '1' || stored === '0') return stored === '1';
  } catch { /* storage off: the default */ }
  return inKioskApp();
}

function setDownloadsRunMark(value) {
  try {
    if (value) localStorage.setItem(DOWNLOADS_RUN_KEY, value);
    else localStorage.removeItem(DOWNLOADS_RUN_KEY);
  } catch { /* storage off: a reload simply will not carry on by itself */ }
}

function downloadsRunMark() {
  try {
    return localStorage.getItem(DOWNLOADS_RUN_KEY);
  } catch {
    return null;
  }
}

function downloadsActive() {
  return dl.phase === 'running' || dl.phase === 'waiting';
}

function setDownloadsNote(text, tone = '') {
  dl.note = text;
  dl.tone = tone;
  scheduleDownloadsRender();
}

function planDownloads() {
  dl.items = downloadPlan(allLessons, {
    leaders: downloadsLeadersWanted(),
    startWeek: currentLesson && Number.isInteger(currentLesson.week) ? currentLesson.week : 1,
  });
}

/* Read what is on disk for every planned video. */
async function inspectDownloads() {
  const files = {};
  for (const item of dl.items) {
    if (!item.url) continue;
    if (downloadsActive() && item.id === dl.activeId && dl.files[item.id]) {
      files[item.id] = dl.files[item.id]; // arriving right now: keep the live count
      continue;
    }
    try {
      // A copy of a file Awana has since replaced is not counted as saved, so
      // the run below downloads it again (downloadOneLesson starts it over).
      const f = await inspectLessonFile(item.id, item);
      files[item.id] = { state: f.state, have: f.have, total: f.total || item.bytes || 0 };
      const at = f.state === 'saved' && f.info && f.info.savedAt;
      if (at && (!dl.lastSavedAt || at > dl.lastSavedAt)) dl.lastSavedAt = at;
    } catch {
      files[item.id] = { state: 'none', have: 0, total: item.bytes || 0 };
    }
  }
  dl.files = files;
  dl.inspected = true;
  emitDownloadStatus(true);
}

async function readStorageSpace() {
  try {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
    const { usage, quota } = await navigator.storage.estimate();
    let persisted = null;
    if (typeof navigator.storage.persisted === 'function') {
      try { persisted = await navigator.storage.persisted(); } catch { persisted = null; }
    }
    if (!Number.isFinite(quota)) return null;
    return { usage: usage || 0, quota, free: Math.max(0, quota - (usage || 0)), persisted };
  } catch {
    return null;
  }
}

/* The newest lessons.json (its cdnUrl/bytes), else whatever is loaded. */
async function lessonsForDownloads() {
  try {
    const data = await fetchLessonsJson();
    adoptLessonsData(data);
  } catch {
    await loadAllLessons();
  }
  return allLessons;
}

/* ── The download itself ── */

function videoUsesInternet() {
  const src = journeyVideo.getAttribute('src');
  return !!src && !src.startsWith('blob:') && !journeyVideo.classList.contains('hidden');
}

function noteReceived(bytes) {
  dl.received += bytes;
  const now = Date.now();
  const last = dl.samples[dl.samples.length - 1];
  if (!last || now - last.t >= 1000) {
    dl.samples.push({ t: now, bytes: dl.received });
    const keep = downloadTuning().rateWindowMs * 2;
    while (dl.samples.length > 2 && now - dl.samples[0].t > keep) dl.samples.shift();
  }
}

function sleepWhileRun(ms, runId) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (runId !== dl.runId || Date.now() - started >= ms) return resolve();
      setTimeout(tick, Math.min(1000, ms));
    };
    setTimeout(tick, Math.min(1000, ms));
  });
}

function currentHoldReason(auto) {
  return downloadHoldReason({
    auto,
    videoFromInternet: videoUsesInternet(),
    lessonOnScreen:
      journeyLessonRunning() ||
      !trekView.classList.contains('hidden') ||
      readerOverlayOpen(),
    quiet: downloadQuietTime(new Date()),
  });
}

async function waitForDownloadTurn(runId) {
  for (;;) {
    const hold = runId === dl.runId ? currentHoldReason(dl.auto) : null;
    if (!hold) break;
    if (dl.phase !== 'waiting' || dl.hold !== hold) {
      dl.phase = 'waiting';
      dl.hold = hold;
      setDownloadsNote(`Waiting: ${hold}. Downloading carries on after it.`);
      emitDownloadStatus(true);
    }
    await sleepWhileRun(downloadTuning().yieldPollMs, runId);
  }
  if (runId === dl.runId && dl.phase === 'waiting') {
    dl.phase = 'running';
    dl.hold = null;
    setDownloadsNote('');
    emitDownloadStatus(true);
  }
}

async function clearLessonDir(dir) {
  const names = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) {
    try { await dir.removeEntry(name, { recursive: true }); } catch { /* next try overwrites it */ }
  }
}

/* Pour the response body into the video's pieces, from piece have/chunk on.
   Each piece is its own file, committed when it is full. */
async function streamIntoChunks(body, dir, info, have, controller, item) {
  const tuning = downloadTuning();
  const reader = body.getReader();
  const count = Math.ceil(info.bytes / info.chunk);
  let index = Math.floor(have / info.chunk);
  let received = have;
  let writable = null;
  let fill = 0;
  let expected = 0;
  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt > tuning.stallMs) {
      dl.abortWhy = dl.abortWhy || 'stall';
      controller.abort();
    } else if (currentHoldReason(dl.auto)) {
      dl.abortWhy = dl.abortWhy || 'yield';
      controller.abort();
    }
  }, 1000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByteAt = Date.now();
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let offset = 0;
      while (offset < bytes.byteLength && index < count) {
        if (!writable) {
          const handle = await dir.getFileHandle(lessonChunkName(index), { create: true });
          writable = await handle.createWritable();
          fill = 0;
          expected = Math.min(info.chunk, info.bytes - index * info.chunk);
        }
        const take = Math.min(bytes.byteLength - offset, expected - fill);
        await writable.write(bytes.subarray(offset, offset + take));
        offset += take;
        fill += take;
        received += take;
        noteReceived(take);
        if (fill === expected) {
          await writable.close();
          writable = null;
          index += 1;
        }
      }
      dl.files[item.id] = { state: 'partial', have: received, total: info.bytes };
      scheduleDownloadsRender();
      emitDownloadStatus(false);
      if (index >= count) {
        // Every byte is here; anything more the server sends is not ours.
        try { await reader.cancel(); } catch { /* already finished */ }
        break;
      }
    }
    if (writable) throw downloadError('the download ended early');
  } catch (err) {
    if (writable) {
      try { await writable.abort(); } catch { /* already closed */ }
    }
    throw err;
  } finally {
    clearInterval(watchdog);
    try { reader.releaseLock(); } catch { /* still reading: the abort ends it */ }
  }
}

/* One video, from wherever it got to. Throws on failure; resolves once every
   byte is on disk and the video is marked finished. */
async function downloadOneLesson(item, restarts = 0) {
  const tuning = downloadTuning();
  const dir = await lessonFileDir(item.id, true);
  if (!dir) throw downloadError('this computer’s storage could not be opened');
  let info = await readLessonInfo(dir);
  if (info && !savedCopyMatches(info, item)) {
    // Awana moved or replaced the file: start that video again.
    await clearLessonDir(dir);
    info = null;
  }
  let have = 0;
  if (info) {
    const files = await lessonChunkFiles(dir, info);
    have = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
    if (have === info.bytes) {
      if (!info.done) await writeLessonInfo(dir, { ...info, done: true, savedAt: new Date().toISOString() });
      dl.files[item.id] = { state: 'saved', have, total: info.bytes };
      return;
    }
  } else {
    await clearLessonDir(dir); // leftovers of an unreadable info.json
  }
  const size = (info && info.bytes) || item.bytes || 0;
  const space = await readStorageSpace();
  if (space && size && size - have > space.free - tuning.spaceMarginBytes) {
    throw downloadError(
      `not enough space on this computer (this video needs ${formatBytes(size - have)}, ${formatBytes(space.free)} is free for saved lessons)`,
      { noSpace: true }
    );
  }
  dl.files[item.id] = { state: have ? 'partial' : 'none', have, total: size };
  const controller = new AbortController();
  dl.controller = controller;
  dl.abortWhy = null;
  // cache:'no-store' keeps the GBs out of the browser's HTTP cache (they go
  // to the store only). Range: bytes=N- is CORS-safelisted: no preflight.
  const res = await fetch(item.url, {
    headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    signal: controller.signal,
    cache: 'no-store',
    credentials: 'omit',
  });
  let total = 0;
  let start = 0;
  if (res.status === 206) {
    const range = parseContentRange(res.headers.get('content-range'));
    if (!range || range.start !== have) {
      try { await res.body.cancel(); } catch { /* fine */ }
      if (restarts >= 1) throw downloadError('Awana’s server sent the wrong part of the file');
      await clearLessonDir(dir);
      return downloadOneLesson(item, restarts + 1);
    }
    total = range.total;
    start = range.start;
  } else if (res.status === 200) {
    total = Number(res.headers.get('content-length')) || 0;
    start = 0;
  } else {
    try { await res.body.cancel(); } catch { /* fine */ }
    throw downloadError(
      res.status === 404 ? 'Awana’s server no longer has this video (404)' : `Awana’s server answered with an error (${res.status})`
    );
  }
  if (!(total > 0)) {
    try { await res.body.cancel(); } catch { /* fine */ }
    throw downloadError('Awana’s server did not say how big the video is');
  }
  const etag = res.headers.get('etag');
  const changed = info && (info.bytes !== total || (info.etag && etag && info.etag !== etag));
  if (changed || (info && start === 0 && have > 0)) {
    // The file changed on Awana's side, or the server ignored the Range and
    // sent it whole: start this video from the beginning.
    if (changed) {
      try { await res.body.cancel(); } catch { /* fine */ }
      if (restarts >= 1) throw downloadError('the video kept changing on Awana’s server');
      await clearLessonDir(dir);
      return downloadOneLesson(item, restarts + 1);
    }
    await clearLessonDir(dir);
    info = null;
    have = 0;
  }
  if (!info) {
    info = { v: 1, url: item.url, bytes: total, etag: etag || null, chunk: tuning.chunkBytes, done: false, startedAt: new Date().toISOString() };
    await writeLessonInfo(dir, info);
  }
  dl.files[item.id] = { state: 'partial', have, total };
  await streamIntoChunks(res.body, dir, info, have, controller, item);
  const files = await lessonChunkFiles(dir, info);
  const final = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
  if (final !== info.bytes) throw downloadError('the download ended early');
  const savedAt = new Date().toISOString();
  await writeLessonInfo(dir, { ...info, done: true, savedAt });
  dl.files[item.id] = { state: 'saved', have: final, total: final };
  dl.lastSavedAt = savedAt;
  emitDownloadStatus(true);
}

async function downloadWithRetries(item, runId) {
  const retries = downloadTuning().retryMs;
  let failures = 0;
  for (;;) {
    await waitForDownloadTurn(runId);
    if (runId !== dl.runId) return;
    dl.activeId = item.id;
    try {
      await downloadOneLesson(item);
      delete dl.errors[item.id];
      setDownloadsNote('');
      return;
    } catch (err) {
      const why = dl.abortWhy;
      dl.abortWhy = null;
      dl.controller = null;
      if (runId !== dl.runId) return; // paused or stopped: not a failure
      try {
        const f = await inspectLessonFile(item.id, item);
        dl.files[item.id] = { state: f.state, have: f.have, total: f.total || item.bytes || 0 };
      } catch { /* keep the last count */ }
      if (why === 'yield') continue; // a lesson started (or quiet hours): wait, then carry on
      if (err && err.noSpace) throw err;
      const reason = why === 'stall' ? 'the download stopped moving (the connection may have dropped)' : plainDownloadError(err);
      console.warn('Journey: could not download', item.id, err);
      dl.lastError = `${downloadLabel(item)}: ${reason}`;
      emitDownloadStatus(true);
      if (failures >= retries.length) {
        dl.errors[item.id] = reason;
        setDownloadsNote('');
        return;
      }
      const wait = retries[failures];
      failures += 1;
      setDownloadsNote(`${downloadLabel(item)}: ${reason}. Trying again in ${Math.max(1, Math.round(wait / 1000))} seconds.`, 'bad');
      await sleepWhileRun(wait, runId);
      if (runId !== dl.runId) return;
    } finally {
      if (dl.activeId === item.id) dl.activeId = null;
    }
  }
}

async function runDownloadLoop(runId) {
  await lessonsForDownloads();
  if (runId !== dl.runId) return;
  planDownloads();
  await inspectDownloads();
  dl.space = await readStorageSpace();
  if (runId !== dl.runId) return;
  const before = downloadProgress(dl.items, dl.files, false);
  const needed = before.total - before.done;
  if (dl.space && needed > dl.space.free - downloadTuning().spaceMarginBytes) {
    dl.phase = 'idle';
    setDownloadsRunMark(null);
    dl.lastError = `not enough disk space (${formatBytes(needed)} needed, ${formatBytes(dl.space.free)} free)`;
    setDownloadsNote(
      `Not enough space: the videos still to download need ${formatBytes(needed)}, and this computer has ${formatBytes(dl.space.free)} free for them. ` +
        (downloadsLeadersWanted() ? 'Untick Leader Videos, or free up disk space, then try again.' : 'Free up disk space, then try again.'),
      'bad'
    );
    return;
  }
  try {
    for (const item of dl.items) {
      if (runId !== dl.runId) return;
      if (!item.url) continue;
      if (dl.files[item.id] && dl.files[item.id].state === 'saved') continue;
      await downloadWithRetries(item, runId);
    }
  } catch (err) {
    if (runId !== dl.runId) return;
    dl.phase = 'idle';
    setDownloadsRunMark(null);
    dl.lastError = plainDownloadError(err);
    setDownloadsNote(`Stopped: ${plainDownloadError(err)}. Videos already saved stay saved.`, 'bad');
    return;
  }
  if (runId !== dl.runId) return;
  dl.phase = 'idle';
  setDownloadsRunMark(null);
  const failed = Object.keys(dl.errors).length;
  const after = downloadProgress(dl.items, dl.files, false);
  if (!failed) dl.lastError = null;
  if (failed) {
    setDownloadsNote(
      `Finished, except ${failed} ${failed === 1 ? 'video' : 'videos'} that could not be downloaded (listed below). ` +
        'Press "Download all lessons" again later to retry them; the rest are saved.',
      'bad'
    );
  } else if (after.saved === after.count) {
    setDownloadsNote(dl.auto ? '' : 'Done. Every lesson now plays from this computer.', 'ok');
  } else {
    setDownloadsNote('');
  }
}

/* Start (or resume) downloading. `auto`: carrying on by itself after a
   reload; a press also asks the browser to keep the files (persist). */
async function startLessonDownloads(auto = false, carryOn = false) {
  if (CONFIGURE_MODE || !lessonStoreSupported() || downloadsActive()) return;
  const runId = ++dl.runId;
  dl.auto = !!auto;
  dl.hold = null;
  if (!auto) dl.autoHeld = false;
  dl.phase = 'running';
  dl.errors = {};
  dl.samples = [];
  dl.received = 0;
  setDownloadsRunMark('running');
  setDownloadsNote(carryOn ? 'Carrying on with the download.' : '');
  emitDownloadStatus(true);
  if (!auto && typeof navigator.storage.persist === 'function') {
    navigator.storage.persist().then(() => refreshDownloadsSpace(), () => {});
  }
  const previous = dl.loop;
  const run = async () => {
    try {
      await runDownloadLoop(runId);
    } catch (err) {
      if (runId === dl.runId) {
        dl.phase = 'idle';
        setDownloadsNote(`Stopped: ${plainDownloadError(err)}.`, 'bad');
      }
    }
  };
  const locked = async () => {
    // A paused run lets go of its file and its lock first.
    if (previous) await Promise.race([previous.catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    if (runId !== dl.runId) return;
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      // One downloader per computer, whatever windows are open on this site.
      return navigator.locks.request('journey-lesson-downloads', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          if (runId === dl.runId) {
            dl.phase = 'idle';
            setDownloadsNote('Another Journey window on this computer is already downloading.', 'bad');
          }
          return;
        }
        await run();
      });
    }
    return run();
  };
  dl.loop = locked().finally(() => {
    if (runId === dl.runId && downloadsActive()) dl.phase = 'idle';
    if (runId === dl.runId) {
      dl.hold = null;
      dl.nextAutoAt = Date.now() + downloadTuning().autoRecheckMs;
    }
    dl.controller = null;
    emitDownloadStatus(true);
    refreshDownloadsSpace();
    scheduleDownloadsRender();
  });
  scheduleDownloadsRender();
  return dl.loop;
}

/* Pause / Stop: the piece being written is dropped, every finished piece and
   every saved video stays. */
function haltLessonDownloads(phase) {
  dl.runId += 1;
  dl.phase = phase;
  dl.hold = null;
  emitDownloadStatus(true);
  if (dl.controller) {
    dl.abortWhy = 'pause';
    try { dl.controller.abort(); } catch { /* already done */ }
  }
  dl.activeId = null;
  scheduleDownloadsRender();
}

function pauseLessonDownloads() {
  if (!downloadsActive()) return;
  haltLessonDownloads('paused');
  setDownloadsRunMark('paused');
  setDownloadsNote('Paused. Press Resume to carry on from where it stopped.');
}

function stopLessonDownloads() {
  if (!downloadsActive() && dl.phase !== 'paused') return;
  haltLessonDownloads('idle');
  setDownloadsRunMark(null);
  dl.autoHeld = true;
  setDownloadsNote(
    'Stopped. Videos already saved stay saved; press "Download all lessons" to carry on later.' +
      (downloadsAutoWanted() ? ' Automatic downloading starts again the next time this page loads (untick "Download lessons automatically" to stop it for good).' : '')
  );
}

async function deleteDownloadedLessons() {
  if (downloadsActive() || dl.phase === 'paused') {
    haltLessonDownloads('idle');
    setDownloadsRunMark(null);
  }
  // Let the stopped download let go of its file first.
  if (dl.loop) {
    await Promise.race([dl.loop.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  }
  try {
    await deleteSavedLessons();
    dl.files = {};
    dl.errors = {};
    setDownloadsNote('Deleted. Lessons play from the internet again.', 'ok');
  } catch (err) {
    console.warn('Journey: could not delete the saved lessons', err);
    setDownloadsNote('Some saved videos could not be deleted (one may be playing right now). Try again once it ends.', 'bad');
  }
  await refreshDownloadsPanel();
}

/* ── The panel ── */

function scheduleDownloadsRender() {
  if (dl.renderTimer) return;
  dl.renderTimer = setTimeout(() => {
    dl.renderTimer = null;
    renderDownloads();
  }, downloadTuning().renderMs);
}

function showOnly(el, shown) {
  el.classList.toggle('hidden', !shown);
}

/* Moves focus with a control that is about to hide, so the keyboard is never
   left on a hidden button. */
function handFocus(from, to) {
  if (from && to && document.activeElement === from) to.focus();
}

function rowState(item) {
  if (!item.url) return { state: 'unavailable', text: 'Cannot be downloaded here', pct: 0 };
  const f = dl.files[item.id] || {};
  const total = f.total || item.bytes || 0;
  const pct = total ? Math.min(100, Math.floor(((f.have || 0) * 100) / total)) : 0;
  if (savedPlaybackFailures.has(item.id)) return { state: 'failed', text: 'Would not play from this computer; delete and download again', pct };
  if (f.state === 'saved') return { state: 'saved', text: 'Saved', pct: 100 };
  if (dl.errors[item.id]) return { state: 'failed', text: `Failed: ${dl.errors[item.id]}. Will retry next time.`, pct };
  if (downloadsActive() && dl.activeId === item.id) return { state: 'active', text: `Downloading ${pct}%`, pct };
  if (f.state === 'damaged') return { state: 'failed', text: 'Damaged: will download again', pct };
  if (f.state === 'partial' && f.have) return { state: 'partial', text: `Partly saved (${pct}%)`, pct };
  return { state: 'waiting', text: total ? `Not saved (${formatBytes(total)})` : 'Not saved', pct: 0 };
}

function renderDownloadRows() {
  const key = dl.items.map((i) => i.id).join(',');
  if (key !== dl.rowsKey) {
    dl.rowsKey = key;
    downloadsList.textContent = '';
    for (const item of dl.items) {
      const li = document.createElement('li');
      li.className = 'downloads-row';
      li.dataset.id = item.id;
      const name = document.createElement('span');
      name.className = 'downloads-row-name';
      name.textContent = downloadLabel(item);
      const state = document.createElement('span');
      state.className = 'downloads-row-state';
      const bar = document.createElement('span');
      bar.className = 'downloads-row-bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'downloads-row-fill';
      bar.appendChild(fill);
      li.append(name, state, bar);
      downloadsList.appendChild(li);
    }
  }
  for (const li of downloadsList.children) {
    const item = dl.items.find((i) => i.id === li.dataset.id);
    if (!item) continue;
    const r = rowState(item);
    li.dataset.state = r.state;
    const state = li.querySelector('.downloads-row-state');
    if (state.textContent !== r.text) state.textContent = r.text;
    li.querySelector('.downloads-row-fill').style.width = `${r.pct}%`;
  }
}

function renderDownloads() {
  // Nothing to see with Settings closed; opening it draws everything.
  if (!downloadsSection || settingsPanel.classList.contains('hidden')) return;
  if (CONFIGURE_MODE || !lessonStoreSupported()) {
    for (const el of [downloadsStartBtn, downloadsPauseBtn, downloadsResumeBtn, downloadsStopBtn, downloadsBar, downloadsDeleteBtn, downloadsConfirm]) {
      showOnly(el, false);
    }
    downloadsLeadersInput.disabled = true;
    downloadsAutoInput.disabled = true;
    downloadsSummary.textContent = CONFIGURE_MODE
      ? 'Lessons are downloaded from the Journey screen itself: open Settings there (press S or the gear).'
      : 'This browser cannot save lessons for offline playback. The Journey kiosk (the KVBC Awana app) can.';
    downloadsStatus.textContent = '';
    downloadsSpace.textContent = '';
    downloadsList.textContent = '';
    dl.rowsKey = '';
    return;
  }
  const active = downloadsActive();
  const paused = dl.phase === 'paused';
  const progress = downloadProgress(dl.items, dl.files, active);
  const rate = downloadRate(dl.samples, Date.now(), downloadTuning().rateWindowMs);
  const allSaved = progress.count > 0 && progress.saved === progress.count;

  showOnly(downloadsStartBtn, !active && !paused);
  downloadsStartBtn.disabled = progress.count === 0 || allSaved;
  showOnly(downloadsPauseBtn, active);
  showOnly(downloadsResumeBtn, paused);
  showOnly(downloadsStopBtn, active || paused);
  downloadsLeadersInput.disabled = active || paused;
  downloadsLeadersInput.checked = downloadsLeadersWanted();
  downloadsAutoInput.checked = downloadsAutoWanted();

  downloadsSummary.textContent = dl.items.length
    ? downloadSummaryText(progress, dl.phase, rate)
    : allLessons ? 'No lesson videos can be downloaded from here.' : 'Loading the lesson list…';
  showOnly(downloadsBar, progress.count > 0);
  downloadsBar.setAttribute('aria-valuenow', String(progress.percent));
  downloadsBar.setAttribute('aria-valuetext', `${progress.percent}%`);
  downloadsBarFill.style.width = `${progress.percent}%`;

  downloadsStatus.textContent = dl.note;
  if (dl.tone) downloadsStatus.dataset.tone = dl.tone;
  else delete downloadsStatus.dataset.tone;

  const s = dl.space;
  downloadsSpace.textContent = s
    ? `Space for saved lessons on this computer: ${formatBytes(s.free)} free.` +
      (s.persisted === true
        ? ' Kept until you delete them.'
        : s.persisted === false
          ? ' The browser may clear them if the disk gets nearly full.'
          : '')
    : '';

  const anything = Object.values(dl.files).some((f) => f.state !== 'none' || f.have > 0);
  showOnly(downloadsDeleteBtn, downloadsConfirm.classList.contains('hidden'));
  downloadsDeleteBtn.disabled = !anything;
  renderDownloadRows();
}

/* Opening Settings: read the disk and the space, draw. Never waits on the
   network (the lesson list is whatever is loaded; it loads if missing). */
async function refreshDownloadsPanel() {
  if (!downloadsSection) return;
  if (CONFIGURE_MODE || !lessonStoreSupported()) {
    renderDownloads();
    return;
  }
  // Every open starts from the plain buttons (an Escape may have closed the
  // panel over the delete question).
  if (!downloadsConfirm.classList.contains('hidden')) {
    downloadsConfirm.classList.add('hidden');
  }
  renderDownloads();
  if (!allLessons) await loadAllLessons();
  if (!allLessons) {
    setDownloadsNote('The lesson list couldn’t load: check the kiosk’s internet connection, then close and reopen Settings.', 'bad');
    renderDownloads();
    return;
  }
  if (!downloadsActive()) planDownloads();
  await inspectDownloads();
  dl.space = await readStorageSpace();
  renderDownloads();
}

function refreshDownloadsSpace() {
  readStorageSpace().then((space) => {
    dl.space = space;
    scheduleDownloadsRender();
  });
}

/* "Download lessons automatically", from its tick box here or from the
   settings page (27-settings-page.js): stored, then a switch on looks for
   work at once, and a switch off stops an automatic run (saved videos stay). */
function setDownloadsAuto(on) {
  try {
    localStorage.setItem(DOWNLOADS_AUTO_KEY, on ? '1' : '0');
  } catch {
    setDownloadsNote('This choice could not be saved on this device.', 'bad');
  }
  if (on) {
    dl.autoHeld = false;
    dl.nextAutoAt = 0;
    autoDownloadTick();
  } else if (downloadsActive() && dl.auto) {
    // Switched off: an automatic run stops (saved videos stay).
    haltLessonDownloads('idle');
    setDownloadsRunMark(null);
    setDownloadsNote('Automatic downloading is off. Videos already saved stay saved.');
  }
  emitDownloadStatus(true);
  renderDownloads();
}

/* "Include Leader Videos", from its tick box or from the settings page. A
   run already going keeps its list; the next one (or Resume) reads this. */
function setDownloadsLeaders(on) {
  try {
    localStorage.setItem(DOWNLOADS_LEADERS_KEY, on ? '1' : '0');
  } catch {
    setDownloadsNote('This choice could not be saved on this device.', 'bad');
  }
  if (!downloadsActive()) refreshDownloadsPanel();
  emitDownloadStatus(true);
}

function hideDownloadsConfirm() {
  handFocus(downloadsConfirmNo, downloadsDeleteBtn);
  handFocus(downloadsConfirmYes, downloadsDeleteBtn);
  downloadsConfirm.classList.add('hidden');
  renderDownloads();
}

if (downloadsSection) {
  const autoHint = document.getElementById('downloads-auto-hint');
  if (autoHint) {
    autoHint.textContent = `by itself, never during a lesson or from ${clockText(DOWNLOAD_QUIET_START_MINUTES)} to ${clockText(DOWNLOAD_QUIET_END_MINUTES)}`;
  }
  downloadsStartBtn.addEventListener('click', () => {
    startLessonDownloads(false);
    renderDownloads();
    handFocus(downloadsStartBtn, downloadsPauseBtn);
  });
  downloadsPauseBtn.addEventListener('click', () => {
    pauseLessonDownloads();
    renderDownloads();
    handFocus(downloadsPauseBtn, downloadsResumeBtn);
  });
  downloadsResumeBtn.addEventListener('click', () => {
    startLessonDownloads(false);
    renderDownloads();
    handFocus(downloadsResumeBtn, downloadsPauseBtn);
  });
  downloadsStopBtn.addEventListener('click', () => {
    stopLessonDownloads();
    renderDownloads();
    handFocus(downloadsStopBtn, downloadsStartBtn);
  });
  downloadsAutoInput.addEventListener('change', () => setDownloadsAuto(downloadsAutoInput.checked));
  downloadsLeadersInput.addEventListener('change', () => setDownloadsLeaders(downloadsLeadersInput.checked));
  downloadsDeleteBtn.addEventListener('click', () => {
    const saved = Object.values(dl.files).filter((f) => f.state === 'saved');
    const bytes = Object.values(dl.files).reduce((sum, f) => sum + (f.have || 0), 0);
    downloadsConfirmText.textContent =
      `Delete ${saved.length === 1 ? 'the 1 saved video' : `all ${saved.length} saved videos`} (${formatBytes(bytes)}) from this computer? ` +
      'Lessons then play from the internet again, and downloading them again takes hours.';
    downloadsConfirm.classList.remove('hidden');
    downloadsDeleteBtn.classList.add('hidden');
    downloadsConfirmNo.focus(); // the safe answer is the one under the keyboard
  });
  downloadsConfirmNo.addEventListener('click', hideDownloadsConfirm);
  downloadsConfirmYes.addEventListener('click', () => {
    downloadsConfirm.classList.add('hidden');
    downloadsDeleteBtn.classList.remove('hidden');
    downloadsDeleteBtn.focus();
    setDownloadsNote('Deleting…');
    deleteDownloadedLessons();
  });
  // A download that was running when the page went away (a reload, the PC
  // restarting) carries on by itself; a paused one stays paused.
  if (!CONFIGURE_MODE && lessonStoreSupported()) {
    const mark = downloadsRunMark();
    if (mark === 'paused') dl.phase = 'paused';
    // (With automatic mode on, its own first pass a few minutes in does it.)
    if (mark === 'running' && !downloadsAutoWanted()) {
      setTimeout(() => {
        if (dl.phase === 'idle') startLessonDownloads(false, true);
      }, downloadTuning().resumeAfterLoadMs);
    }
    setInterval(() => {
      if (!downloadsActive() && !dl.autoHeld) {
        autoDownloadTick();
      }
    }, downloadTuning().autoTickMs);
    window.addEventListener('online', () => autoDownloadTick());
    setTimeout(async () => {
      await prepareDownloadStatus();
      autoDownloadTick();
    }, downloadTuning().autoStartMs);
  }
}

/* What is saved, read from the disk once after load (no network but a
   lessons.json the page may already hold), so the status is true even
   before Settings is opened or a pass runs. */
async function prepareDownloadStatus() {
  if (dl.inspected || downloadsActive()) return;
  try {
    if (!allLessons) await loadAllLessons();
    if (!allLessons || downloadsActive()) return;
    planDownloads();
    await inspectDownloads();
  } catch { /* the status stays "not known yet" */ }
}

/* The automatic pass: a few minutes after load, then on every poll and on
   'online'. Starts a run only when nothing must wait (so it never starts
   into the lesson or the quiet hours); the run itself waits if one begins.
   A finished pass looks again after autoRecheckMs, re-reading lessons.json,
   which is how a newly published lesson is picked up. */
function autoDownloadTick(now = Date.now()) {
  if (CONFIGURE_MODE || !lessonStoreSupported() || !downloadsAutoWanted()) return false;
  if (dl.autoHeld || dl.phase !== 'idle') return false;
  const tuning = downloadTuning();
  if (now - dl.loadedAt < tuning.autoStartMs) return false;
  if (now < dl.nextAutoAt) return false;
  if (navigator.onLine === false) return false;
  if (currentHoldReason(true)) return false;
  startLessonDownloads(true);
  return true;
}

/* ── Status for reporting (the owner's settings page reads it) ── */

function journeyDownloadStatus() {
  const progress = downloadProgress(dl.items, dl.files, downloadsActive());
  const active = dl.activeId ? dl.items.find((i) => i.id === dl.activeId) : null;
  return {
    total: progress.count,
    saved: progress.saved,
    bytesSaved: progress.done,
    bytesTotal: progress.total,
    downloading: dl.phase === 'running',
    waiting: dl.phase === 'waiting' ? dl.hold : null,
    paused: dl.phase === 'paused',
    percent: progress.percent,
    currentWeek: active && dl.phase === 'running' ? active.week : null,
    lastSavedAt: dl.lastSavedAt,
    error: dl.lastError,
    auto: downloadsAutoWanted(),
    leaders: downloadsLeadersWanted(),
    supported: lessonStoreSupported() && !CONFIGURE_MODE,
    known: dl.inspected,
  };
}

/* The event: at once (`now`) on a saved video, an error or a phase change,
   at most every statusMs otherwise (bytes arriving). */
function emitDownloadStatus(now) {
  const send = () => {
    dl.statusTimer = null;
    dl.statusSentAt = Date.now();
    try {
      window.dispatchEvent(new CustomEvent('journey-download-status', { detail: journeyDownloadStatus() }));
    } catch { /* no CustomEvent: the function still answers */ }
  };
  if (now) {
    clearTimeout(dl.statusTimer);
    send();
    return;
  }
  if (dl.statusTimer) return;
  const wait = Math.max(0, downloadTuning().statusMs - (Date.now() - dl.statusSentAt));
  dl.statusTimer = setTimeout(send, wait);
}

window.journeyDownloads = dl; // tests read the state
window.journeyDownloadStatus = journeyDownloadStatus;
/* ── The owner's settings page (awana.kvbchurch.org/settings → Journey) ──
   Owner 2026-10-12: "Lessons on this computer" can also be worked from the
   settings page, for every Journey kiosk at once. This kiosk's Settings panel
   keeps every control (it is the fallback at the PC); the settings page sends
   the same presses here, and this file runs them through the panel's own
   functions, so a press from there is exactly a press here.

   - Commands (lobby/src/lib/syncSpecs.js SCREEN_ACTIONS.journey): start,
     pause, resume, stop, delete. They reach this page in the answer to its
     hello (public/src/sync.js, which checks each one against the same list)
     a second or two after the press, or at the next two-minute hello.
     Configure mode, or a browser that cannot save lessons, does nothing.
   - The two switches ("Download lessons automatically", "Include Leader
     Videos") are this kiosk's own settings on the sync service
     (SCREEN_SPECS.journey downloadsAuto / downloadsLeader): sync.js hands
     them to journeySettingsPage.setPrefs, and sends a change made on the
     tick boxes here back up, so both places always show the same.
   Nothing here touches the network. */

/* The two switches as they are on this computer (the stored choice, else
   the default: automatic only in the KVBC Awana app, Leader Videos on). */
function downloadPrefs() {
  return { auto: downloadsAutoWanted(), leaders: downloadsLeadersWanted() };
}

/* Set either switch, as its tick box would (only one that differs). */
function setDownloadPrefs(patch) {
  if (!patch || typeof patch !== 'object') return;
  if (typeof patch.auto === 'boolean' && patch.auto !== downloadsAutoWanted()) setDownloadsAuto(patch.auto);
  if (typeof patch.leaders === 'boolean' && patch.leaders !== downloadsLeadersWanted()) setDownloadsLeaders(patch.leaders);
}

/* One command from the settings page. true when it was run. */
function settingsPageCommand(action) {
  if (CONFIGURE_MODE || !lessonStoreSupported()) return false;
  switch (action) {
    case 'start-downloads':
    case 'resume-downloads':
      // Resume of a run that already ended starts one: both mean "carry on".
      if (downloadsActive()) return false;
      startLessonDownloads(false);
      break;
    case 'pause-downloads':
      if (!downloadsActive()) return false;
      pauseLessonDownloads();
      break;
    case 'stop-downloads':
      if (!downloadsActive() && dl.phase !== 'paused') return false;
      stopLessonDownloads();
      break;
    case 'delete-downloads':
      setDownloadsNote('Deleting (asked from the settings page)…');
      deleteDownloadedLessons();
      break;
    default:
      return false;
  }
  renderDownloads();
  return true;
}

window.journeySettingsPage = { command: settingsPageCommand, prefs: downloadPrefs, setPrefs: setDownloadPrefs };
/* ── The phone remote (awana.kvbchurch.org/journey/remote/) ─────────────
   Owner 2026-10-13: "build a way to advance slides for Journey on a phone.
   Doing it on the phone should advance the slide for all." A leader's phone
   presses Next (or Back, Start teaching slides, Play/Pause, Back 15s, Skip
   15s, Mute, Volume - / +, Begin, or picks a lesson) and EVERY Journey kiosk does it. The
   press reaches this page through public/src/sync.js (the sync Worker keeps
   it for 20 seconds; the embedded Check-in Display's doorbell makes this
   page collect it within about a second), which hands each one to
   journeyRemote.command() here. Since 2026-10-15 the doorbell carries the
   press itself and public/src/sync.js runs it the moment the doorbell
   arrives (the collect stays as the fallback; each press id runs once).

   - Each press runs through the very function this page's own buttons and
     keys call (nextSlide, prevSlide, skipToTeachingSlides / the → handoff,
     seekBy, setMuted, beginScheduledPlay, PICKER_CHOICES through the
     configure relay's own checks), so a phone Next is a → press: the same
     slide carry, the same auto-advance reset.
   - A press is NOT a gesture on this page. Sound only where the browser
     allows it without one: the KVBC Awana app grants autoplay; in a plain
     browser a lesson started from the phone plays muted until someone taps
     the screen once, and the phone's Unmute says why it could not.
   - Something only a person at the screen can clear (Settings open, a
     handout or Read Prep open, the "Show captions?" question) skips the
     press (a pick too, `force` or not), and the reason rides the next
     report: the phone shows it. A pick never replaces a lesson already
     running unless the phone sent `force: true` (only after its confirm
     tap).
   - journeyRemote.now() is what the screen shows, in the shape the Worker
     keeps (shared/journeyRemote.js sanitizeJourneyNow): the view, the
     lesson's week and TITLE (never a file), the slide (number, kind, and the
     lines of a filled-in slide, so the phone can match the Talk About It
     questions to its sample answers), the video position, why it waits, and
     how the last press went. A `journey-remote-change` event on window says
     it may have changed; sync.js sends it only while a phone is watching.
   - Never in configure mode (that page is only the Settings panel). */

// What the phone may ask: exactly shared/journeyRemote.js
// JOURNEY_REMOTE_ACTIONS (test/phone-remote.test.mjs pins the two lists).
const REMOTE_COMMANDS = ['slide-next', 'slide-prev', 'slides-start', 'play', 'pause', 'toggle-pause', 'seek', 'mute', 'unmute', 'volume', 'begin', 'pick'];
// One volume press moves the lesson video's volume by this many percent (owner 2026-10-15).
const REMOTE_VOLUME_STEP_PCT = 10;
// The deck's four pictures, in Awana's order (20-teaching-slides.js).
const REMOTE_DECK_KINDS = ['title', 'verse', 'misconception', 'illumination'];
// How the last press went: { id, action, ok, reason }.
let remoteLast = null;

/* May a press from the phone start sound here? Only when the browser would
   let this page do it anyway: someone has touched it, or it is the KVBC
   Awana app (autoplay granted). Never a way round a browser's rule. */
function remoteSoundAllowed() {
  if (audioUnlocked || inKioskApp()) return true;
  try {
    return Boolean(navigator.userActivation && navigator.userActivation.hasBeenActive);
  } catch {
    return false;
  }
}

function remoteVideoUp() {
  return !journeyVideo.classList.contains('hidden') && journeyVideo.hasAttribute('src');
}

/* Which of the views the phone knows the screen is on. */
function remoteView() {
  if (!trekView.classList.contains('hidden')) return 'trek';
  if (!checkinView.classList.contains('hidden')) return 'checkin';
  if (lessonIntroActive()) return 'intro';
  if (slideshowActive()) return 'slides';
  if (!journeyVideo.classList.contains('hidden')) return 'video';
  if (isAwaitingPlay()) return 'splash';
  return 'idle';
}

/* Whose lesson is on screen: the deck's, the preview's, the playing one's,
   else tonight's (the Check-in Display, the splash, the card). */
function remoteWeek(view) {
  if (view === 'slides' && slideshow) return Number.isInteger(slideshow.week) ? slideshow.week : null;
  if ((view === 'video' || view === 'intro') && previewMode) return Number.isInteger(previewWeek) ? previewWeek : null;
  if ((view === 'video' || view === 'intro') && Number.isInteger(playingWeek)) return playingWeek;
  return currentLesson && Number.isInteger(currentLesson.week) ? currentLesson.week : null;
}

/* The lesson's title from lessons.json: a title only, never a file. */
function remoteTitle(week) {
  if (!Number.isInteger(week)) return null;
  const lesson = (allLessons || []).find((l) => l && l.week === week)
    || (currentLesson && currentLesson.week === week ? currentLesson : null);
  return lesson && typeof lesson.title === 'string' ? lesson.title.slice(0, 80) : null;
}

/* Why the screen is waiting for someone standing at it, if it is. */
function remoteWait(view) {
  if (isCaptionPromptOpen()) return 'captions';
  if (readerOverlayOpen()) return 'reader';
  if (!settingsPanel.classList.contains('hidden')) return 'settings';
  if (view === 'video' && !journeyLoading.classList.contains('hidden')) return 'loading';
  return null;
}

/* What the screen shows now (shared/journeyRemote.js sanitizeJourneyNow). */
function remoteNow() {
  const view = remoteView();
  const week = remoteWeek(view);
  const out = { view, week, title: remoteTitle(week), preview: previewMode, wait: remoteWait(view), last: remoteLast, at: new Date().toISOString() };
  if (view === 'slides' && slideshow) {
    const item = slideshow.items[slideshow.index] || {};
    const template = item.type === 'template';
    out.slide = {
      n: slideshow.index + 1,
      of: slideshow.items.length,
      kind: template ? (item.kind === 'questions' ? 'questions' : 'template') : (REMOTE_DECK_KINDS[slideshow.index] || 'template'),
      heading: template ? String(item.heading || '').slice(0, 80) || null : null,
      // The very lines on the wall (this device's own edits included).
      lines: template && Array.isArray(item.bullets) ? item.bullets.slice(0, 3).map((b) => String(b).slice(0, 80)) : [],
    };
  }
  if (view === 'video') {
    const d = journeyVideo.duration;
    const t = journeyVideo.currentTime;
    out.video = {
      t: Number.isFinite(t) ? Math.round(t * 10) / 10 : 0,
      d: Number.isFinite(d) && d > 0 ? Math.round(d * 10) / 10 : 0,
      paused: journeyVideo.paused,
      muted: journeyVideo.muted,
      volume: Math.round(journeyVideo.volume * 100),
    };
  }
  if (view === 'splash' && offeredResumeAt > 0) out.resume = Math.floor(offeredResumeAt);
  return out;
}

/* Something only a person at the screen can clear. */
function remoteBlockedBy() {
  if (isCaptionPromptOpen()) return 'captions-question';
  if (readerOverlayOpen()) return 'reader-open';
  if (!settingsPanel.classList.contains('hidden')) return 'settings-open';
  return null;
}

/* Play as the Play button does, without claiming a gesture nobody made. */
function remotePlay() {
  if (!journeyVideo.muted && !remoteSoundAllowed()) setMuted(true);
  journeyVideo.play().catch(() => {
    if (!journeyVideo.muted) {
      setMuted(true);
      journeyVideo.play().catch(() => {});
    }
  });
}

/* "Start teaching slides": the splash's Skip to slides, the → handoff while
   a video is up, else this week's slides from wherever the screen is (the
   Check-in Display, Trek's card), finishing back there the same way. */
function remoteStartSlides() {
  if (slideshowActive()) return 'already';
  if (isAwaitingPlay()) return skipToTeachingSlides() ? null : 'no-slides';
  const lessonUp = remoteVideoUp() || lessonIntroActive();
  const week = lessonUp && previewMode ? previewWeek : currentLesson && currentLesson.week;
  // Checked first: the → handoff with no deck would end the lesson instead.
  if (!Number.isInteger(week) || !buildSlideItems(week).length) return 'no-slides';
  if (lessonUp) {
    endOfLessonHandoff();
    return null;
  }
  return startTeachingSlides(week, () => setView(lessonDoneView())) ? null : 'no-slides';
}

/* A lesson from the phone's picker: the configure relay's checks, and never
   over a running lesson without `force`. Settings, a handout / Read Prep or
   the caption question has already skipped it (runRemoteCommand), as it
   skips every press: only a person at the screen closes those. */
function remotePick(data) {
  const target = pickerTargetFor(data);
  if (target.reason === 'lessons-loading') {
    loadAllLessons();
    return 'lessons-loading';
  }
  if (!target.lesson) return target.reason;
  if (data.force !== true && journeyLessonRunning()) return 'lesson-running';
  if (remoteSoundAllowed()) audioUnlocked = true;
  PICKER_CHOICES[target.choice](target.lesson);
  return null;
}

/* One press: null when it was done, else the reason it was skipped. */
function runRemoteCommand(action, data) {
  if (CONFIGURE_MODE) return 'configure';
  // Every press, a pick too, waits for a person at the screen first.
  const blocked = remoteBlockedBy();
  if (blocked) return blocked;
  switch (action) {
    case 'pick':
      return remotePick(data && typeof data === 'object' ? data : {});
    case 'slide-next':
      if (!slideshowActive()) return 'no-slides';
      nextSlide();
      return null;
    case 'slide-prev':
      if (!slideshowActive()) return 'no-slides';
      if (slideshow.index === 0) return 'first-slide';
      prevSlide();
      return null;
    case 'slides-start':
      return remoteStartSlides();
    case 'play':
    case 'pause':
    case 'toggle-pause': {
      if (lessonIntroActive()) return 'starting';
      if (!remoteVideoUp()) return 'no-video';
      const play = action === 'play' || (action === 'toggle-pause' && journeyVideo.paused);
      if (play && !journeyVideo.paused) return 'already';
      if (!play && journeyVideo.paused) return 'already';
      if (play) remotePlay();
      else journeyVideo.pause();
      return null;
    }
    case 'seek': {
      if (lessonIntroActive()) return 'starting';
      if (!remoteVideoUp()) return 'no-video';
      const by = data && typeof data.by === 'number' && Number.isFinite(data.by)
        ? Math.max(-SEEK_STEP_S, Math.min(SEEK_STEP_S, Math.round(data.by))) : 0;
      if (!by) return 'unknown';
      seekBy(by, false);
      return null;
    }
    case 'mute':
      if (!remoteVideoUp()) return 'no-video';
      if (journeyVideo.muted) return 'already';
      setMuted(true);
      return null;
    case 'unmute':
      if (!remoteVideoUp()) return 'no-video';
      if (!journeyVideo.muted) return 'already';
      // A browser that has seen no tap pauses a video unmuted without one.
      if (!remoteSoundAllowed()) return 'sound-blocked';
      setMuted(false);
      return null;
    case 'volume': {
      if (!remoteVideoUp()) return 'no-video';
      const step = data && (data.step === 1 || data.step === -1) ? data.step : 0;
      if (!step) return 'unknown';
      // Whole tenths, so a level never drifts off the 10% grid.
      const now = Math.round(journeyVideo.volume * 100 / REMOTE_VOLUME_STEP_PCT);
      const next = Math.max(0, Math.min(100 / REMOTE_VOLUME_STEP_PCT, now + step));
      const unmuting = step > 0 && journeyVideo.muted;
      if (next === now && !unmuting) return 'already';
      journeyVideo.volume = (next * REMOTE_VOLUME_STEP_PCT) / 100;
      if (!unmuting) return null;
      // Raising the volume while muted unmutes, where the browser allows sound
      // (as Unmute); the level is kept either way.
      if (!remoteSoundAllowed()) return 'sound-blocked';
      setMuted(false);
      return null;
    }
    case 'begin':
      if (lessonIntroActive() || remoteVideoUp() || slideshowActive()) return 'already';
      if (!isAwaitingPlay()) return 'not-splash';
      if (remoteSoundAllowed()) audioUnlocked = true;
      // The splash's primary button, as Space presses it: Resume when offered, else Begin.
      beginScheduledPlay(offeredResumeAt, true);
      return null;
    default:
      return 'unknown';
  }
}

/* The report may have changed: sync.js decides whether anyone wants it. */
function remoteChanged() {
  if (CONFIGURE_MODE) return;
  try {
    window.dispatchEvent(new CustomEvent('journey-remote-change'));
  } catch {
    // no CustomEvent: the next timed report carries it
  }
}

/* One press from sync.js ({id, action, data?}). true when it was done. */
function remoteCommand(cmd) {
  if (!cmd || typeof cmd !== 'object' || !REMOTE_COMMANDS.includes(cmd.action)) return false;
  let reason;
  try {
    reason = runRemoteCommand(cmd.action, cmd.data);
  } catch (err) {
    console.warn('Journey: a phone remote press failed —', err);
    reason = 'unknown';
  }
  remoteLast = {
    id: typeof cmd.id === 'string' ? cmd.id.slice(0, 40) : null,
    action: cmd.action,
    ok: reason === null,
    reason: reason === null ? null : reason,
  };
  remoteChanged();
  return reason === null;
}

// The screen changes by itself too (a video ends, a slide auto-advances, the
// schedule flips): the layers' classes, the slide counter and the video's
// own events say so. Cheap: one event, and sync.js ignores it unless a phone
// is watching.
if (!CONFIGURE_MODE && typeof MutationObserver === 'function') {
  const watched = [checkinView, journeyView, trekView, slidesView, journeySplash, journeyVideo, journeyPlaceholder,
    journeyLoading, captionPrompt, handoutView, prepView, settingsPanel, lessonIntroEl].filter(Boolean);
  const layers = new MutationObserver(remoteChanged);
  for (const el of watched) layers.observe(el, { attributes: true, attributeFilter: ['class'] });
  layers.observe(slideCounter, { childList: true, characterData: true, subtree: true });
  for (const type of ['play', 'pause', 'volumechange', 'seeked', 'loadedmetadata', 'ended']) {
    journeyVideo.addEventListener(type, remoteChanged);
  }
}

window.journeyRemote = { command: remoteCommand, now: remoteNow };
/* ── Club transitions: black gaps and gap welcomes (owner 2026-10-17) ───
   Around every scheduled hand-off between two views the screen goes pure
   black for TRANSITION_GAP_MIN minutes before the hand-off and as many after
   it, so Journey and Trek students pass at the door with no wrong club up.
   The number and the cutting are the family's ONE rule, shared/transitionGap.js
   (a byte copy beside this script, src/shared/transitionGap.js, loaded with
   this script's own ?v=; a test hands it over: window.journeyTransitionGapModule).
   Nothing here spells a gap edge: the night's views go in, the gaps come out.

   Tonight's views (journeyNightViews): the Check-in Display, Journey from
   JOURNEY_START, then on a Trek night (trekSmallGroupTime) Trek's card from
   TREK_START to TREK_END, else Journey to JOURNEY_END; then the Check-in
   Display. With a 2-minute gap: 6:28-6:32 black (Journey welcomed), Trek
   nights 6:58-7:02 (Journey and Trek) and 7:28-7:32 (Trek), other nights
   7:28-7:32 (Journey). The views themselves still change at the hand-off
   (scheduledPhase(), lastPhase and the poll are untouched): the black is a
   layer over them (#gap-view), never a view, so the check-in frame under it
   stays loaded and connected, and the corner buttons stay above it.

   Never over something being watched: a lesson running (journeyLessonRunning:
   its video, slides, intro, caption question, loading overlay), a preview,
   a reading overlay or Settings holds the black off; the lesson rules stand
   as they were, and a lesson that ends inside a gap hands to its next view
   UNDER the black, which stays until the gap's end. ⇄ pressed over the black
   puts it away for the rest of that gap (the operator asked for a view).
   Configure mode: nothing here runs.

   Welcomes: the embedded lobby hands each sanitized check-in up (lib/embed.js
   hostCheckin: id, first name, club, oneOff; this origin only, after its own
   dedupe). While the black is up, a child of one of the gap's clubs (both
   neighbours' clubs, the shared rule's data) gets a welcome card in their
   club's look (Journey purple / Trek teal, the club's wordmark) and a ding,
   up 20 s after that club's latest arrival, one card per club; the rules
   (WELCOME_MS, dedupe by id, the words) are the shared module's, the same
   the downstairs classroom uses. First names live in gapState.welcomes, in
   memory only, and are forgotten when the black goes. */
const GAP_CHECKIN_MESSAGE = 'awana-display:checkin';
const GAP_FADE_MS = 900;
const GAP_TICK_MS = 1000;
const GAP_CLUBS = ['journey', 'trek'];
const GAP_MODULE_URL = (() => {
  const own = document.currentScript && document.currentScript.src;
  const url = new URL('shared/transitionGap.js', own || new URL('src/schedule.js', window.location.href).href);
  if (own) url.search = new URL(own).search;
  return url.href;
})();

/** Tonight's views end to end, for the shared rule to cut its gaps from. */
function journeyNightViews(now) {
  const trek = trekSmallGroupTime(now);
  const views = [
    { view: 'checkin', from: 0, until: JOURNEY_START_MINUTES, clubs: [] },
    { view: 'journey', from: JOURNEY_START_MINUTES, until: trek ? TREK_START_MINUTES : JOURNEY_END_MINUTES, clubs: ['journey'] },
  ];
  if (trek) views.push({ view: 'trek', from: TREK_START_MINUTES, until: TREK_END_MINUTES, clubs: ['trek'] });
  views.push({ view: 'checkin', from: trek ? TREK_END_MINUTES : JOURNEY_END_MINUTES, until: 24 * 60, clubs: [] });
  return views;
}

/** The scheduled gap holding `now` ({from, until, clubs}), or null. */
function scheduledGap(now = new Date()) {
  const rule = gapState.rule;
  if (!rule) return null;
  try {
    const minutes = now.getHours() * 60 + now.getMinutes();
    const period = rule.periodAt(rule.periodsFor(journeyNightViews(now)), minutes);
    return period && period.gap ? period : null;
  } catch {
    return null;
  }
}

/** Something on screen the black must never cover. */
function gapHeldOff() {
  return (
    previewMode ||
    journeyLessonRunning() ||
    readerOverlayOpen() ||
    !settingsPanel.classList.contains('hidden')
  );
}

/** Whether the black is up (fading out counts as down). */
function gapBlackUp() {
  return gapState.up;
}

/** Is a welcome card on the black right now? */
function gapWelcoming() {
  return gapState.up && gapWelcomesUp().length > 0;
}

function gapWelcomesUp() {
  if (!gapState.rule || !gapState.welcomes) return [];
  return gapState.rule.welcomesUp(gapState.welcomes, gapState.clubs, Date.now());
}

/* Asks the clock and the screen, and puts the black up or away. Cheap: a
   class changes only when the answer does. Called every second, at the end
   of every setView(), and when the rule arrives. */
function refreshGap() {
  if (!gapState.rule || CONFIGURE_MODE) return;
  const now = new Date();
  const gap = scheduledGap(now);
  const key = gap ? `${now.toDateString()} ${gap.from}` : '';
  if (key !== gapState.key) {
    const leaving = gapState.key && !key;
    gapState.key = key;
    if (gapState.dismissed !== key) gapState.dismissed = '';
    // Out of a gap: the view the schedule wants is under the black before it lifts.
    if (leaving) pollSchedule();
  }
  const want = !!gap && gapState.dismissed !== key && !gapHeldOff();
  gapState.clubs = want ? gap.clubs.slice() : [];
  if (want) showGapBlack();
  else hideGapBlack();
  drawGapWelcomes();
}

function showGapBlack() {
  if (gapState.up) return;
  gapState.up = true;
  clearTimeout(gapState.outTimer);
  gapView.classList.remove('jm-gap-out', 'hidden');
  // A view-flip band would ride over the black (it sits above every layer).
  if (typeof clearStinger === 'function') clearStinger();
}

function hideGapBlack() {
  if (!gapState.up) return;
  gapState.up = false;
  // Names go with the black (the seen ids stay, for the dedupe).
  if (gapState.welcomes) gapState.welcomes = { cards: {}, seen: gapState.welcomes.seen };
  if (motionOn()) {
    gapView.classList.add('jm-gap-out');
    clearTimeout(gapState.outTimer);
    gapState.outTimer = setTimeout(() => {
      if (gapState.up) return;
      gapView.classList.add('hidden');
      gapView.classList.remove('jm-gap-out');
    }, GAP_FADE_MS);
  } else {
    gapView.classList.add('hidden');
  }
}

/* ⇄ over the black: the operator wants a view, so this gap's black is put
   away until it ends (the next gap comes as usual). */
function dismissGap() {
  if (!gapState.up) return;
  gapState.dismissed = gapState.key;
  hideGapBlack();
  drawGapWelcomes();
}

/* The welcome cards: one per club, centred, or side by side (Journey left,
   Trek right) when both clubs have one. */
function drawGapWelcomes() {
  const up = gapState.up ? gapWelcomesUp() : [];
  for (const club of GAP_CLUBS) {
    const el = gapWelcomeEls[club];
    if (!el) continue;
    const on = up.includes(club);
    if (!on) {
      if (!el.classList.contains('hidden')) el.classList.add('hidden');
      // A name leaves the page with its card.
      const gone = el.querySelector('.gap-welcome-names');
      if (gone.textContent) gone.textContent = '';
      continue;
    }
    const slot = up.length > 1 ? (club === 'journey' ? 'left' : 'right') : 'center';
    if (el.dataset.slot !== slot) el.dataset.slot = slot;
    const names = el.querySelector('.gap-welcome-names');
    const words = gapState.rule.welcomeWords(gapState.welcomes.cards[club].names);
    if (names.textContent !== words) names.textContent = words;
    const long = words.length > 24 ? 'long' : '';
    if ((el.dataset.size || '') !== long) el.dataset.size = long;
    el.classList.remove('hidden');
  }
}

let gapAudio = null;
/** A soft two-note ding, made here (no sound file; the classroom's notes). */
function gapDing() {
  try {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    gapAudio = gapAudio || new Context();
    if (gapAudio.state === 'suspended') gapAudio.resume();
    const t = gapAudio.currentTime + 0.02;
    for (const [freq, at, gain] of [[1318.5, 0, 0.16], [1760, 0.12, 0.12]]) {
      const osc = gapAudio.createOscillator();
      const g = gapAudio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(gain, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.1);
      osc.connect(g).connect(gapAudio.destination);
      osc.start(t + at);
      osc.stop(t + at + 1.2);
    }
  } catch {
    /* no sound here */
  }
}

/* A check-in handed up by the embedded lobby (its own frame, this origin). */
function onGapCheckin(event) {
  if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== CHECKIN_DISPLAY_ORIGIN) return;
  const data = event.data;
  if (!data || typeof data !== 'object' || data.type !== GAP_CHECKIN_MESSAGE) return;
  if (!gapState.rule || !gapState.up) return;
  const result = gapState.rule.welcomeFor(gapState.welcomes || gapState.rule.emptyWelcomes(), data, gapState.clubs, Date.now());
  if (!result.ding) return;
  gapState.welcomes = result.state;
  drawGapWelcomes();
  gapDing();
}

async function loadGapRule() {
  if (window.journeyTransitionGapModule) return window.journeyTransitionGapModule;
  try {
    return await import(GAP_MODULE_URL);
  } catch {
    return null;
  }
}

if (!CONFIGURE_MODE) {
  window.addEventListener('message', onGapCheckin);
  loadGapRule().then((rule) => {
    if (!rule || typeof rule.periodsFor !== 'function' || typeof rule.welcomeFor !== 'function') return;
    gapState.rule = rule;
    gapState.welcomes = rule.emptyWelcomes();
    refreshGap();
  });
  setInterval(refreshGap, GAP_TICK_MS);
}
