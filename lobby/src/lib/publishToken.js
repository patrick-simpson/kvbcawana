// @ts-check
// Storage for the slide PUBLISH TOKEN — the bearer credential the print
// server requires before this machine's slide editor may publish the deck to
// every screen (POST /api/lobby-slides).
//
// DELIBERATELY SEPARATE FROM useConfig.js — the same three documented leak
// paths displayKey.js enumerates apply verbatim:
//
//   1. `?config=<url>` merges remote JSON through the VALIDATORS table, so
//      anything in that table is settable (and thus publishable) from a URL.
//   2. Settings → Export serialises the overrides object and that file gets
//      emailed around; the token would ride along.
//   3. urlFlags.js accepts config on the query string, and URLs end up in
//      history, logs and screenshots.
//
// A separate storage key means there is no deny-list to forget. Blast radius
// if it leaks anyway: the holder must ALSO reach the print server's loopback
// interface from an allowlisted origin, and even then can only put
// length-capped, allowlist-sanitized text slides on the lobby TVs — then the
// operator regenerates the token on the printer dashboard and it is revoked.
// publishToken.test.js pins all three paths shut, like displayKey.test.js.

const STORAGE_KEY = 'awanaPublishToken.v1';

/** @returns {string} The stored token, or '' when this machine has none. */
export function loadPublishToken() {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Persist (or clear) this machine's publish token.
 * @param {string} value Empty string clears it.
 * @returns {boolean} false when storage is unavailable.
 */
export function savePublishToken(value) {
  const next = String(value == null ? '' : value).trim();
  try {
    if (next) localStorage.setItem(STORAGE_KEY, next);
    else localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(PUBLISH_TOKEN_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Name of the event fired when the token changes in THIS tab. */
export const PUBLISH_TOKEN_CHANGE_EVENT = 'awana-publish-token-change';

/** localStorage key, exported so tests can assert it is not `awanaConfig.v1`. */
export const PUBLISH_TOKEN_STORAGE = STORAGE_KEY;

/**
 * Mask the token for display — the Settings field shows this, so a photo of
 * the screen during setup does not hand it over.
 * @param {string} value
 */
export function maskPublishToken(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return '';
  if (s.length <= 8) return '•'.repeat(s.length);
  return `${s.slice(0, 4)}${'•'.repeat(Math.min(24, s.length - 8))}${s.slice(-4)}`;
}
