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

