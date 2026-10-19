
/* ── The opening ceremony (owner 2026-10-19) ──────────────────────────
   "When the opening is happening ALL screens should show the games
   projector display. Classroom and journey included." The embedded Check-in
   Display does the showing itself: from 10 seconds before 6:00 until T&T game
   time it puts the game time projector's own page over its wall
   (lobby/src/lib/ceremonyMirror.js), and tells this page when it goes up and
   comes down (lobby hostMirror: {type, up}, nothing else).

   While it is up this page shows the Check-in Display OVER whatever is on
   screen (html.ceremony-up, style.css "The opening ceremony"): the splash, the
   teaching slides, the Trek card, a reading overlay, Settings. "Really the
   only thing that should stop the opening from playing properly is a video"
   (owner 2026-10-19): a lesson video PLAYING keeps it down (and a video
   started during the opening takes the screen back). Nothing underneath is
   changed: views, lastPhase and the lesson rules stand, and what was there
   is there again when the opening ends. A self-update never reloads the
   room in the middle of it (safeToReload, 23). Configure mode: nothing here
   runs. */
const CEREMONY_MIRROR_MESSAGE = 'awana-display:ceremony-mirror';
let ceremonyMirrorUp = false;

/** A lesson video is playing: the one thing the opening never covers. */
function ceremonyVideoPlaying() {
  return journeyVideo.hasAttribute('src') && !journeyVideo.paused && !journeyVideo.ended;
}

/** The opening is on the room's screen now. */
function ceremonyMirrorShowing() {
  return document.documentElement.classList.contains('ceremony-up');
}

function drawCeremony() {
  const up = ceremonyMirrorUp && !ceremonyVideoPlaying();
  if (up === ceremonyMirrorShowing()) return;
  document.documentElement.classList.toggle('ceremony-up', up);
  console.info(`[journey] opening ceremony ${up ? 'on screen' : 'off screen'}`);
}

if (!CONFIGURE_MODE) {
  window.addEventListener('message', (event) => {
    if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== CEREMONY_MIRROR_MESSAGE) return;
    ceremonyMirrorUp = data.up === true;
    drawCeremony();
  });
  for (const type of ['play', 'playing', 'pause', 'ended', 'emptied']) journeyVideo.addEventListener(type, drawCeremony);
  setInterval(drawCeremony, 1000);
}
