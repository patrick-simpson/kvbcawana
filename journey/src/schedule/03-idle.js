/* ── Idle cursor / idle controls ──────────────────────────────────────
   The cursor starts hidden (kiosk mode: nothing should look "parked" on
   the projected video) but reappears on any mouse movement or touch and
   hides again after a few idle seconds — an operator has to be able to
   see the pointer to use the corner buttons and the settings panel at
   all. The same cursor-hidden class also fades the playback control bar
   (see #video-controls in style.css), which is why touches count as
   activity too: phones/tablets have no mousemove. This only governs this
   document; the Check-in Display iframe is a different origin and
   manages its own cursor. */
const CURSOR_IDLE_MS = 5000;

/* A forgotten preview or an open Settings panel used to pin the kiosk for
   good: a leader previews a lesson, pauses it, walks away, and the 6:30
   scheduler (which previewMode holds off) never gets the room back; or the
   Settings panel is left up and the self-updater (which counts it as busy)
   never reloads. idleWatch() runs once a minute and, with nobody touching
   the kiosk for the stated time, ends a PAUSED preview (never a playing
   one) and closes the panel. Any key, tap or click is activity. */
const PREVIEW_IDLE_MS = 20 * 60 * 1000;
const SETTINGS_IDLE_MS = 15 * 60 * 1000;
let lastActivityAt = Date.now();
function noteActivity() { lastActivityAt = Date.now(); }
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach((type) => document.addEventListener(type, noteActivity, { passive: true, capture: true }));
function idleWatch(now = Date.now()) {
  const idleFor = now - lastActivityAt;
  const acted = [];
  if (previewMode && idleFor > PREVIEW_IDLE_MS && !slideshow && (journeyVideo.paused || journeyVideo.ended || !journeyVideo.src)) {
    console.log('Journey: a paused preview was left for ' + Math.round(idleFor / 60000) + ' minutes; handing the room back');
    endPreview();
    acted.push('preview');
  }
  // The configure page IS the panel: it never closes.
  if (!CONFIGURE_MODE && !settingsPanel.classList.contains('hidden') && idleFor > SETTINGS_IDLE_MS) {
    console.log('Journey: the Settings panel was left open; closing it');
    closeSettingsPanel();
    acted.push('settings');
  }
  return acted;
}
setInterval(idleWatch, 60 * 1000);
window.idleWatch = idleWatch;
window.noteActivity = noteActivity;
let cursorIdleTimer = null;
function markActivity() {
  const wasHidden = document.documentElement.classList.contains('cursor-hidden');
  document.documentElement.classList.remove('cursor-hidden');
  if (wasHidden && typeof syncScrubber === 'function') syncScrubber(); // the bar is back: catch it up
  if (wasHidden && typeof startScrubberLoop === 'function') startScrubberLoop(); // and glide from here
  clearTimeout(cursorIdleTimer);
  cursorIdleTimer = setTimeout(() => {
    document.documentElement.classList.add('cursor-hidden');
  }, CURSOR_IDLE_MS);
}
// A configure page is a desktop form under an operator's mouse: the pointer stays.
if (!CONFIGURE_MODE) {
  document.documentElement.classList.add('cursor-hidden');
  document.addEventListener('mousemove', markActivity);
  document.addEventListener('touchstart', markActivity, { passive: true });
}

function scheduledPhase() {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  // Trek's small group time comes first: on a club night it takes 7:00-7:30,
  // the Journey window's last quarter hour included (trekSmallGroupTime() in
  // 25-trek.js; a lesson still running holds it off, see pollSchedule()).
  if (minutes >= TREK_START_MINUTES && minutes < TREK_END_MINUTES && trekSmallGroupTime(now)) {
    return 'trek';
  }
  return minutes >= JOURNEY_START_MINUTES && minutes < JOURNEY_END_MINUTES
    ? 'journey'
    : 'checkin';
}

