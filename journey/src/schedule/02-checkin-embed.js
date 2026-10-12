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

