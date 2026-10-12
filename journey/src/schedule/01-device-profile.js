/* ── Device profile: what this particular screen can cope with ────────
   This page runs in two very different places. The kiosk is a 2017
   Raspberry Pi Zero (single-core ARMv6) that cannot decode Awana's 1080p
   originals at a watchable frame rate, and wants the embedded Check-in
   Display's animations turned down. The same URL is also opened on a Mac,
   a laptop or a phone, where the converted 480p copies are a needless
   downgrade of a lesson projected to a room.

   So the page asks what it is running on, once, and everything quality
   related reads the answer: the iframe's ?lowPower=1 flag, which file the
   scheduled show and the picker play, and which bytes cacheLessonBundle()
   pre-downloads.

   'low' is the historical behavior, unchanged in every detail: a device
   that detects low, or is set to Low power by hand, does exactly what the
   kiosk did before this existed.

   detectDeviceProfile() is pure (it takes the two navigator readings) so
   the UA table below can be tested without a browser:
   - Linux on ARM is a Raspberry Pi, every model this could run on.
   - Phones and tablets stream on cell data onto a small screen, where the
     480p copy is the right trade rather than a compromise.
   - Two cores or fewer is a weak machine whatever it calls itself. */
const PLAYBACK_QUALITY_KEY = 'journey.playback.quality';
const PLAYBACK_QUALITY_CHOICES = ['auto', 'full', 'low'];

function detectDeviceProfile(userAgent, hardwareConcurrency) {
  const ua = String(userAgent || '');
  if (/\b(armv6l|armv7l|aarch64)\b/.test(ua)) return 'low';
  if (/Android|Mobile|iPhone|iPad/.test(ua)) return 'low';
  const cores = Number(hardwareConcurrency);
  if (Number.isFinite(cores) && cores > 0 && cores <= 2) return 'low';
  return 'full';
}

// The one place navigator is read.
const detectedProfile = detectDeviceProfile(
  navigator.userAgent,
  navigator.hardwareConcurrency
);

// Per-device override, wrapped like every other preference here: kiosk
// Chromium can throw on localStorage rather than returning null.
function storedPlaybackQuality() {
  try {
    const v = localStorage.getItem(PLAYBACK_QUALITY_KEY);
    return PLAYBACK_QUALITY_CHOICES.includes(v) ? v : 'auto';
  } catch {
    return 'auto';
  }
}

// Returns whether the choice was actually stored, because a write that failed has
// to be said out loud rather than reported as saved, like the bullet editor.
function storePlaybackQuality(choice) {
  try {
    localStorage.setItem(PLAYBACK_QUALITY_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

// Cached for the page's lifetime: this is read on every video pick and a
// localStorage hit per pick is pointless. chooseQuality() clears it, which
// is the only way the answer can change without a reload.
let profileCache = null;

function effectiveProfile() {
  if (profileCache) return profileCache;
  const choice = storedPlaybackQuality();
  profileCache = choice === 'auto' ? detectedProfile : choice;
  return profileCache;
}

