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

   The same cards on every device. Full profile: bold entrances and a band
   that carries the last card off into the video (style.css motion block,
   24-motion.js carryIntroOff()). Low profile (the Pi) and reduced motion:
   instant swaps, nothing animated, the paint budget untouched. While it is
   up the video element is shown (under the cards), so the count chip, the
   reload check and the Trek poll all read it as the lesson it is.

   Timing is LESSON_INTRO; a test may override any of it through
   window.journeyIntroTiming (read at each start). */
const LESSON_INTRO = {
  cardsAt: [0, 1100, 2200, 3600], // Journey, Advocates, lesson, Large Group Time
  minMs: 4600, // the last card's earliest end (the full profile's carry adds ~0.8s)
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
  // over it on the full profile); anything older goes.
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

// The cards go and the video starts: on the full profile the last card is
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
