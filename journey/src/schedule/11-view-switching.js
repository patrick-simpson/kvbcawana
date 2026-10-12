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
}

/* Where a finished scheduled lesson (its video, then its slides) hands the
   screen: Trek's card when it is Trek's time (a lesson that ran past 7:00
   was waited for), else the Check-in Display, as always. */
function lessonDoneView() {
  return scheduledPhase() === 'trek' ? 'trek' : 'checkin';
}

// `lastPhase` tracks only the *scheduled* phase (for detecting a genuine
// 18:30/19:15 boundary crossing) — it is deliberately never written to from
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

