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
  beginScheduledPlay();
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
  if (!startTeachingSlides(week, () => setView('checkin'))) {
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
function beginScheduledPlay(resumeAt = 0) {
  if (!currentLesson) return;
  requestPlayback(captionUrlFor(currentLesson.week, 'student'), () => playCurrentLesson(resumeAt));
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
     Repeats are ignored: a held key would queue seeks faster than the Pi's
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
    beginScheduledPlay(offeredResumeAt);
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

