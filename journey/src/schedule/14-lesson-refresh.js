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
  // that from stacking duplicate multi-MB downloads.)
  window.addEventListener('online', () => refreshLesson());
}

