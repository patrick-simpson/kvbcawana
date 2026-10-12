/* ── Keep the kiosk screen awake ─────────────────────────────────────
   Raspberry Pi OS ships with screen blanking enabled by default; with no
   keyboard/mouse activity for hours, the display can go to sleep long
   before 6:30 PM arrives. The Wake Lock API only prevents the screen from
   blanking — it doesn't dismiss a blank that already happened — so this
   also re-acquires on visibilitychange (e.g. after the tab/monitor was
   backgrounded and the lock was released) rather than only once on load.
   Requires HTTPS, which GitHub Pages provides. Not fatal if unsupported
   (older Chromium builds) — disabling blanking at the OS level (see
   PI_SETUP.md) is the belt-and-braces fallback either way. */
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    // The OS can release the lock on its own (a power event, a modal, a
    // monitor sleeping), and a kiosk never fires visibilitychange, so the
    // release itself is the cue to ask again, a moment later.
    if (wakeLock && typeof wakeLock.addEventListener === 'function') {
      wakeLock.addEventListener('release', () => { setTimeout(requestWakeLock, 2000); }, { once: true });
    }
  } catch {
    // e.g. the tab isn't visible yet — visibilitychange below retries.
  }
}
// The configure page is on the operator's own monitor: it has no business
// holding that screen awake.
if (!CONFIGURE_MODE) {
  requestWakeLock();
  // And a slow heartbeat for a lock that was never granted or whose release
  // event was missed: ask again every five minutes while there is none.
  setInterval(() => { if (!wakeLock || wakeLock.released) requestWakeLock(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && (!wakeLock || wakeLock.released)) {
      requestWakeLock();
    }
  });
}

// Once the lesson finishes, there's nothing left to show for the rest of
// the window — fall back to the Check-in Display right away rather than
// holding on a blank/frozen frame until 7:15. Deliberately does NOT touch
// lastPhase (see the comment above it) — doing so would make the very next
// poll tick see a manufactured "flip" back to 'journey' and restart the
// lesson from frame zero, which is exactly the bug this comment is here to
// prevent regressing.
/* The single way out of a lesson video, whatever ended it: Awana's teaching
   slides for that lesson come next, and only once they finish does the old
   end-of-video behavior run (Check-in Display for the scheduled show,
   endPreview() for a preview). Reached four ways — the video's own 'ended'
   event, the near-end stall watchdog, a manual skip with →, and a fatal
   video error. It used to hang off 'ended' alone, which stranded a leader
   mid-club: the lesson stalled on its last chunk over flaky WiFi, 'ended'
   never fired, and there was no way to reach the slides at all. */
function endOfLessonHandoff() {
  const finish = () => {
    if (previewMode) {
      endPreview();
      return;
    }
    setView('checkin');
  };
  const week = previewMode ? previewWeek : currentLesson && currentLesson.week;
  if (startTeachingSlides(week, finish)) return true;
  finish();
  return false;
}

// The lesson played out — there is nothing left to resume. (Cleared here
// rather than in endOfLessonHandoff(), which also runs for a → skip and for
// a stall/error, where the mark is still the best guess at where the room
// got to.)
journeyVideo.addEventListener('ended', () => {
  if (!previewMode) clearResumePoint();
});
journeyVideo.addEventListener('ended', endOfLessonHandoff);

/* A video that stalls within a few seconds of its end has, for the room's
   purposes, finished — the last frames are never worth waiting on. Judged
   only when the stall has already lasted LOADING_STALL_MS, so an ordinary
   buffering hiccup near the end still gets a chance to recover and play out. */
const END_STALL_TOLERANCE_S = 3;
function videoNearEnd() {
  const d = journeyVideo.duration;
  const t = journeyVideo.currentTime;
  return Number.isFinite(d) && d > 0 && d - t <= END_STALL_TOLERANCE_S;
}

// A failed/unsupported video load, or a stall that never recovers, should
// fall back to the placeholder rather than leaving a silent black frame
// that's indistinguishable from a dead display.
journeyVideo.addEventListener('error', () => {
  console.warn('Journey: video failed to load/play', journeyVideo.error);
  hideVideoLoading();
  if (previewMode) {
    // A preview tries the transcoded release asset first; if that errored
    // (asset missing, release renamed), retry once with the lesson's
    // original URL before giving up. Cleared immediately so a failure of
    // the fallback itself lands in endPreview() below, not a loop.
    if (previewFallbackUrl) {
      const fallback = previewFallbackUrl;
      previewFallbackUrl = null;
      console.warn('Journey: transcoded preview failed, retrying with the original —', fallback);
      showVideoLoading();
      journeyVideo.src = fallback;
      applyCaptions(); // keep captions across the one-time fallback swap
      journeyVideo.play().catch(() => {});
      return;
    }
    endPreview();
    return;
  }
  if (!journeyView.classList.contains('hidden')) {
    // The lesson can't play, but this week's teaching slides are already on
    // this device — far better on the wall than a dead placeholder. Only a
    // week with no slides falls through to it.
    if (startTeachingSlides(currentLesson && currentLesson.week, () => setView('checkin'))) return;
    journeyVideo.classList.add('hidden');
    videoControls.classList.add('hidden');
    journeyPlaceholder.classList.remove('hidden');
  }
});

