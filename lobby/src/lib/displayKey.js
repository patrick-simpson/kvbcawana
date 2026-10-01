// @ts-check
// Storage for the display key — the AES-256 secret that lets this screen read
// children's first names off the realtime channel.
//
// THIS FILE IS DELIBERATELY SEPARATE FROM useConfig.js, AND THAT IS THE POINT.
//
// Every other setting lives in `awanaConfig.v1` and flows through
// `VALIDATORS` / `sanitizeOverrides` in src/hooks/useConfig.js. Putting the
// display key there would have been the obvious thing to do and would have
// leaked it three different ways, each through a documented, encouraged
// workflow:
//
//   1. `?config=<url>` — App.jsx fetches a remote JSON and merges it through
//      the SAME sanitizeOverrides table (defaults < remote < device). Anything
//      in VALIDATORS is therefore settable from a file at a public URL. A
//      volunteer following the documented fleet-management pattern would have
//      published the decryption key for children's names to the open internet.
//
//   2. Settings → Export — SettingsPanel's exportSettings() serialises the
//      overrides object to `awana-display-settings.json` and downloads it.
//      This is the normal "set up the second screen" workflow, and that file
//      gets emailed and dropped in shared drives.
//
//   3. `?key=` — urlFlags.js already accepts the PUSHER app key on the query
//      string so an OBS/ProPresenter embed with no localStorage can connect.
//      A URL is the worst possible place for this secret: browser history,
//      server logs, screenshots, the kiosk shortcut someone tapes to the wall.
//
// Three deny-lists would each have been one forgotten line away from a leak.
// A separate storage key means there is no list to forget: the key is simply
// not part of the object those three paths operate on. The tests in
// displayKey.test.js assert all three stay closed.
//
// The consequence, accepted deliberately: an embed that genuinely cannot
// persist localStorage shows counts, countdown and slides but no names. That
// is the right trade.

const STORAGE_KEY = 'awanaDisplayKey.v1';

/** @returns {string} The stored key, or '' when this screen has none. */
export function loadDisplayKey() {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || '').trim();
  } catch {
    // localStorage can be blocked outright (some TV browsers, private mode).
    // No key means plaintext-only, which degrades visibly rather than crashing.
    return '';
  }
}

/**
 * Persist (or clear) this screen's key.
 * @param {string} value Base64 32-byte key; empty string clears it.
 * @returns {boolean} false when storage is unavailable.
 */
export function saveDisplayKey(value) {
  const next = String(value == null ? '' : value).trim();
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
    // Same-tab listeners: the `storage` event only fires in OTHER tabs, so
    // Settings saving a key would not re-key the socket in this one.
    window.dispatchEvent(new Event('awana-display-key-change'));
    return true;
  } catch {
    return false;
  }
}

/** Name of the event fired when the key changes in THIS tab. */
export const DISPLAY_KEY_CHANGE_EVENT = 'awana-display-key-change';

/** localStorage key, exported so tests can assert it is not `awanaConfig.v1`. */
export const DISPLAY_KEY_STORAGE = STORAGE_KEY;

/**
 * Mask a key for display. The Settings field shows this rather than the key,
 * so a screenshot or a photo of the TV during setup does not hand it over.
 * @param {string} value
 */
export function maskDisplayKey(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (s.length <= 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(24, s.length - 8))}${s.slice(-4)}`;
}
