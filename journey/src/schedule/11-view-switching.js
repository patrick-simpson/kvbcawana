/* ── View switching ──────────────────────────────────────────────── */

function setView(phase) {
  const showJourney = phase === 'journey';
  journeyView.classList.toggle('hidden', !showJourney);
  checkinView.classList.toggle('hidden', showJourney);
  if (showJourney) {
    showJourneyContent();
  } else {
    stopJourneyContent();
  }
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

setInterval(() => {
  if (previewMode || CONFIGURE_MODE) return;
  const phase = scheduledPhase();
  if (phase !== lastPhase) {
    lastPhase = phase;
    setView(phase);
  }
}, POLL_INTERVAL_MS);

toggleBtn.addEventListener('click', () => {
  audioUnlocked = true;
  if (previewMode) {
    endPreview();
    return;
  }
  const showingJourney = !journeyView.classList.contains('hidden');
  setView(showingJourney ? 'checkin' : 'journey');
});

unmuteBtn.addEventListener('click', () => {
  audioUnlocked = true;
  setMuted(!journeyVideo.muted);
});

