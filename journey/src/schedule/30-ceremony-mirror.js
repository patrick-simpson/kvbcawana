
/* ── The opening ceremony (owner 2026-10-19) ──────────────────────────
   "When the opening is happening ALL screens should show the games
   projector display. Classroom and journey included." The embedded Check-in
   Display does the showing itself: from 6:00 until T&T game time it puts the
   game time projector's own page over its wall (lobby/src/lib/ceremonyMirror.js),
   so whenever the Check-in Display is the view here, the room sees the
   opening. A busy kiosk is not interrupted (owner 2026-10-19: "Don't
   interrupt"): a lesson, a preview, the Trek card or a reading overlay keeps
   the frame hidden, as always.

   The display tells this page when the mirror goes up and comes down
   (lobby hostMirror: {type, up}, nothing else); this page only listens so a
   self-update never reloads the room in the middle of the opening
   (safeToReload, 23). Configure mode: nothing here runs. */
const CEREMONY_MIRROR_MESSAGE = 'awana-display:ceremony-mirror';
let ceremonyMirrorUp = false;

/** The opening is on the room's screen now (the Check-in Display showing it). */
function ceremonyMirrorShowing() {
  return ceremonyMirrorUp && !checkinView.classList.contains('hidden');
}

if (!CONFIGURE_MODE) {
  window.addEventListener('message', (event) => {
    if (!checkinFrame || event.source !== checkinFrame.contentWindow || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== CEREMONY_MIRROR_MESSAGE) return;
    ceremonyMirrorUp = data.up === true;
  });
}
