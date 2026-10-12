/* ── Caption appearance (Settings → Captions) ─────────────────────────
   One fixed type size cannot serve both readers this page has: a leader in
   the back row of a room reading a projected TV, and someone holding a
   phone. So the size is a per-device choice, stored like the on/off answer
   and the slide preferences.

   It MULTIPLIES the responsive clamp in style.css through --caption-scale
   rather than replacing it, so "Large" is still capped on a huge screen and
   still legible on a small one. The dark-backdrop option swaps the
   translucent band for a solid one, which is what a bright lesson frame
   needs. Both are pure CSS + localStorage: nothing is fetched, so none of
   this can delay a control that has just been pressed. */
const CAPTION_SIZE_KEY = 'journey.captions.size';
const CAPTION_BACKDROP_KEY = 'journey.captions.backdrop';
const CAPTION_SIZES = ['0.8', '1', '1.3', '1.6'];
const CAPTION_SIZE_DEFAULT = '1';

function storedCaptionSize() {
  try {
    const v = localStorage.getItem(CAPTION_SIZE_KEY);
    return CAPTION_SIZES.includes(v) ? v : CAPTION_SIZE_DEFAULT;
  } catch {
    return CAPTION_SIZE_DEFAULT;
  }
}

function storedCaptionBackdrop() {
  try {
    return localStorage.getItem(CAPTION_BACKDROP_KEY) === 'on';
  } catch {
    return false;
  }
}

// Takes the values explicitly so a change can still be APPLIED on a device
// where storage is blocked and the write above just failed — reading them
// back would hand out the defaults and the control would look inert.
function applyCaptionDisplayPrefs(size = storedCaptionSize(), backdrop = storedCaptionBackdrop()) {
  document.documentElement.style.setProperty('--caption-scale', size);
  captionOverlay.classList.toggle('caption-backdrop', backdrop);
  // The band's height changed, so the letterbox/control-bar clearance the
  // caption sits above has to be worked out again.
  positionCaptions();
}

function storeCaptionDisplayPrefs() {
  try {
    localStorage.setItem(CAPTION_SIZE_KEY, captionsSizeSelect.value);
    localStorage.setItem(CAPTION_BACKDROP_KEY, captionsBackdropInput.checked ? 'on' : 'off');
  } catch {
    // Won't survive a reload — the live change below still applies now.
  }
  applyCaptionDisplayPrefs(captionsSizeSelect.value, captionsBackdropInput.checked);
}

function syncCaptionPrefInputs() {
  captionsSizeSelect.value = storedCaptionSize();
  captionsBackdropInput.checked = storedCaptionBackdrop();
}

syncCaptionPrefInputs();
applyCaptionDisplayPrefs();
captionsSizeSelect.addEventListener('change', storeCaptionDisplayPrefs);
captionsBackdropInput.addEventListener('change', storeCaptionDisplayPrefs);

