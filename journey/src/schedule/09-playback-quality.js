/* ── Settings: Playback quality ───────────────────────────────────────
   Three buttons, Auto / Full quality / Low power, with Auto naming what was
   detected so an operator can see what it would do before trusting it. A
   change applies at once: the embedded display's flag is swapped now, and
   the next video pick reads the new profile.

   Like the caption size, the change is applied in memory whether or not the
   write succeeded, and a failed write says so instead of claiming it saved:
   nothing else on the page would tell the operator that the choice will be
   gone after a reload. */
function qualityWords(profile) {
  return profile === 'full' ? 'full quality' : 'low power';
}

function syncQualityButtons() {
  qualityButtons.auto.textContent = `Auto (detected: ${qualityWords(detectedProfile)})`;
  const choice = storedPlaybackQuality();
  for (const key of PLAYBACK_QUALITY_CHOICES) {
    qualityButtons[key].setAttribute('aria-pressed', String(key === choice));
  }
}

function chooseQuality(choice) {
  if (!PLAYBACK_QUALITY_CHOICES.includes(choice)) return;
  const stored = storePlaybackQuality(choice);
  // Applied from the choice itself, not read back from storage, so the
  // buttons still do something on a device where the write just failed.
  profileCache = choice === 'auto' ? detectedProfile : choice;
  applyCheckinDisplayUrl();
  applyMotionProfile();
  syncQualityButtons();
  qualityStatus.textContent = stored
    ? `Using ${qualityWords(effectiveProfile())} on this device.`
    : `Using ${qualityWords(effectiveProfile())} now, but this kiosk’s browser won’t ` +
      'store settings, so it goes back to Auto when the page reloads.';
}

syncQualityButtons();
for (const key of PLAYBACK_QUALITY_CHOICES) {
  qualityButtons[key].addEventListener('click', () => chooseQuality(key));
}

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
   buffering stalls, and hidden again by 'playing'. */
const LOADING_STALL_MS = 12000;
const LOADING_NOTE_DEFAULT = journeyLoadingNote.textContent;
let loadingStallTimer = null;

function showVideoLoading() {
  journeyLoading.classList.remove('hidden');
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
}

function hideVideoLoading() {
  clearTimeout(loadingStallTimer);
  // Frames are arriving again (or the video is being torn down), so the
  // stall swap has nothing to answer for either.
  clearStreamStallSwap();
  journeyLoadingNote.textContent = LOADING_NOTE_DEFAULT;
  journeyLoading.classList.add('hidden');
}

journeyVideo.addEventListener('playing', hideVideoLoading);
journeyVideo.addEventListener('waiting', () => {
  if (journeyVideo.classList.contains('hidden')) return;
  showVideoLoading();
  // A stall on a streamed file is the one case where the cached copy is
  // worth its stutter: see swapToCachedCopy above.
  armStreamStallSwap();
});

function setMuted(muted) {
  journeyVideo.muted = muted;
  unmuteBtn.textContent = muted ? '🔇' : '🔊';
  unmuteBtn.setAttribute('aria-pressed', String(!muted));
}

