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

function seekBy(delta) {
  if (journeyVideo.classList.contains('hidden')) return;
  audioUnlocked = true; // seeking is itself a genuine gesture
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

