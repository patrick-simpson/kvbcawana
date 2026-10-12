/* ── Settings saved by another window, taken live ─────────────────────
   The configure page beside the kiosk (and the kiosk's own sync, run from
   either window) writes the same localStorage, and a 'storage' event fires
   in every OTHER window of the origin. Each key below is re-applied through
   the function its own control uses, so the kiosk ends up exactly where it
   would be had the change been made on it. The embedded Check-in Display
   writes this storage too (its own awana* keys), so anything not listed
   costs one lookup and nothing else: this is a Pi Zero. The sync session
   (awanaSyncSession.v1) is sync.js's to watch. */
const LIVE_STORAGE_KEYS = {
  [CAPTION_PREF_KEY]: () => {
    // Applied to a video already on screen too, which is what pressing CC
    // here would have done.
    const on = storedCaptionPref();
    if (on === null || on === captionsEnabled) return;
    captionsEnabled = on;
    if (journeyVideo.hasAttribute('src')) applyCaptions();
  },
  [CAPTION_SIZE_KEY]: () => {
    syncCaptionPrefInputs();
    applyCaptionDisplayPrefs();
  },
  [PLAYBACK_QUALITY_KEY]: () => {
    profileCache = null; // the cached answer is the old choice's
    applyCheckinDisplayUrl();
    applyMotionProfile();
    syncQualityButtons();
  },
  [SLIDES_AUTO_KEY]: () => syncSlidesPrefInputs(),
  [SLIDE_NOTES_OVERRIDE_KEY]: () => {
    updateNotesEditedBadge();
    refreshOpenNotesEditor();
  },
};
LIVE_STORAGE_KEYS[CAPTION_BACKDROP_KEY] = LIVE_STORAGE_KEYS[CAPTION_SIZE_KEY];
LIVE_STORAGE_KEYS[SLIDES_EXTRAS_KEY] = () => {
  syncSlidesPrefInputs();
  refreshOpenNotesEditor(); // its headings say which kinds are ticked
};

// Never under someone's fingers: an editor being typed in keeps its words.
function refreshOpenNotesEditor() {
  if (notesEditBody.classList.contains('hidden') || notesEditBody.contains(document.activeElement)) return;
  renderNotesEditor();
}

function applyStoredSetting(key) {
  if (key === null) {
    // localStorage.clear() somewhere: everything is back to its default.
    for (const apply of new Set(Object.values(LIVE_STORAGE_KEYS))) apply();
    return;
  }
  const apply = Object.prototype.hasOwnProperty.call(LIVE_STORAGE_KEYS, key) ? LIVE_STORAGE_KEYS[key] : null;
  if (apply) apply();
}

window.addEventListener('storage', (event) => applyStoredSetting(event.key));

/* A configure page opens on the panel, for good: no close button, and the
   note above the list says where a pick goes. */
if (CONFIGURE_MODE) {
  settingsCloseBtn.hidden = true;
  settingsPreviewNote.textContent =
    'Picking a video here plays it once on the Journey screen. It never changes what plays automatically at 6:30 PM.';
  openSettingsPanel();
  // The bullet editor saves on a short debounce; a window closed inside it
  // must not lose the last words typed.
  window.addEventListener('pagehide', () => {
    if (!notesEditBody.classList.contains('hidden')) saveNotesEditor();
  });
}

/* The brand kit's fonts are self-hosted (brand/fonts.css), but a browser only
   fetches a web font once text set in it is actually rendered, and on this
   kiosk that first happens at the 6:30 splash: in the evening, on the
   connection this page already distrusts. So all three are asked for here,
   while the Check-in Display is up and nothing is waiting on them. A loaded
   face stays loaded for the life of the page, which on the kiosk is the whole
   day. Fire and forget: nothing awaits this, and a failure only means the
   splash uses the fallback faces the tokens name. */
const BRAND_FONT_FACES = ['400 1em "Paytone One"', '400 1em "Londrina Solid"', '400 1em Figtree'];

function warmBrandFonts() {
  const fonts = document.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  for (const face of BRAND_FONT_FACES) {
    try {
      fonts.load(face).catch(() => {});
    } catch {
      // A browser that rejects the shorthand outright: fallbacks it is.
    }
  }
}
warmBrandFonts();

