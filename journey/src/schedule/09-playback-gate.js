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

