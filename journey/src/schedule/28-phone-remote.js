/* ── The phone remote (awana.kvbchurch.org/journey/remote/) ─────────────
   Owner 2026-10-13: "build a way to advance slides for Journey on a phone.
   Doing it on the phone should advance the slide for all." A leader's phone
   presses Next (or Back, Start teaching slides, Play/Pause, Back 15s, Skip
   15s, Mute, Begin, or picks a lesson) and EVERY Journey kiosk does it. The
   press reaches this page through public/src/sync.js (the sync Worker keeps
   it for 20 seconds; the embedded Check-in Display's doorbell makes this
   page collect it within about a second), which hands each one to
   journeyRemote.command() here.

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
     press, and the reason rides the next report: the phone shows it. A pick
     never replaces a lesson already running unless the phone sent
     `force: true` (only after its confirm tap).
   - journeyRemote.now() is what the screen shows, in the shape the Worker
     keeps (lobby/shared/journeyRemote.js sanitizeJourneyNow): the view, the
     lesson's week and TITLE (never a file), the slide (number, kind, and the
     lines of a filled-in slide, so the phone can match the Talk About It
     questions to its sample answers), the video position, why it waits, and
     how the last press went. A `journey-remote-change` event on window says
     it may have changed; sync.js sends it only while a phone is watching.
   - Never in configure mode (that page is only the Settings panel). */

// What the phone may ask: exactly lobby/shared/journeyRemote.js
// JOURNEY_REMOTE_ACTIONS (test/phone-remote.test.mjs pins the two lists).
const REMOTE_COMMANDS = ['slide-next', 'slide-prev', 'slides-start', 'play', 'pause', 'toggle-pause', 'seek', 'mute', 'unmute', 'begin', 'pick'];
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

/* What the screen shows now (lobby/shared/journeyRemote.js sanitizeJourneyNow). */
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
   over a running lesson (or an open handout / Read Prep) without `force`. */
function remotePick(data) {
  const target = pickerTargetFor(data);
  if (target.reason === 'lessons-loading') {
    loadAllLessons();
    return 'lessons-loading';
  }
  if (!target.lesson) return target.reason;
  if (data.force !== true && (journeyLessonRunning() || readerOverlayOpen())) return 'lesson-running';
  if (readerOverlayOpen()) {
    closeHandout();
    closePrep();
  }
  if (remoteSoundAllowed()) audioUnlocked = true;
  PICKER_CHOICES[target.choice](target.lesson);
  return null;
}

/* One press: null when it was done, else the reason it was skipped. */
function runRemoteCommand(action, data) {
  if (CONFIGURE_MODE) return 'configure';
  if (action === 'pick') return remotePick(data && typeof data === 'object' ? data : {});
  const blocked = remoteBlockedBy();
  if (blocked) return blocked;
  switch (action) {
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
