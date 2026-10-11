// @ts-check
// The bridge to KVBC Awana (2.1.0, the last release of this app; owner,
// 2026-10-11, UNIFIED-APP.md: "the sound room app is replaced automatically:
// its last update installs KVBC Awana as a display with its screen, monitor,
// hours and shutdown carried over, then removes Awana Lobby Display").
//
// On each update check, main.js reads KVBC Awana's feed (the printer feed,
// awana.kvbchurch.org/updates/printer/latest.yml). Once that names 9.0.0 or
// later, it downloads that installer, checks its sha512, writes the hand-off
// below, runs the installer silently and quits; KVBC Awana starts, applies the
// hand-off and uninstalls this app. Until then the ordinary lobby feed update
// goes on as before. Pure: main.js does the fetching and the files.
//
// The hand-off goes to %APPDATA%\awana-label-printer\handoff.json: KVBC
// Awana's own userData folder (its package.json "name", kept from the label
// printer). Its format is printer/electron-app/src/handoff.js's; change the
// two together.

export const KVBC_FEED_URL = 'https://awana.kvbchurch.org/updates/printer/latest.yml';
export const KVBC_MIN_VERSION = '9.0.0';
export const HANDOFF_DIR = 'awana-label-printer';
export const HANDOFF_FILE = 'handoff.json';
export const INSTALLER_NAME = 'KVBC-Awana-Setup.exe';
// One try a day for the same version: a failed install must not download
// 250 MB every ten minutes.
export const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const INSTALLER_HOSTS = new Set(['github.com', 'awana.kvbchurch.org']);

/** @param {string} v @returns {number[] | null} */
function parts(v) {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,5})$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Whether version `v` is `min` or later; false for anything not X.Y.Z. */
export function isAtLeast(v, min) {
  const a = parts(v);
  const b = parts(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

const unquote = (s) => s.trim().replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');

/**
 * The installer an electron-updater feed (latest.yml) names: its version,
 * absolute URL and sha512. Only the top-level `version`, `path` and `sha512`
 * lines are read (the feed's own shape, as printer-release.yml writes it);
 * null when they are missing or the URL is not an https address on GitHub or
 * the church site.
 *
 * @param {string} text
 * @param {string} [feedUrl]
 * @returns {{ version: string, url: string, sha512: string } | null}
 */
export function parseFeed(text, feedUrl = KVBC_FEED_URL) {
  /** @type {Record<string, string>} */
  const top = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^(version|path|sha512):\s*(.+)$/.exec(line);
    if (m && !(m[1] in top)) top[m[1]] = unquote(m[2]);
  }
  if (!parts(top.version) || !top.path || !/^[A-Za-z0-9+/]{80,}={0,2}$/.test(top.sha512 || '')) return null;
  let url;
  try { url = new URL(top.path, feedUrl); } catch { return null; }
  if (url.protocol !== 'https:' || !INSTALLER_HOSTS.has(url.hostname) || url.username || url.password) return null;
  return { version: top.version, url: url.href, sha512: top.sha512 };
}

/**
 * Whether to hand over now: the feed is KVBC Awana 9 or later, and this
 * version was not already tried in the last day.
 *
 * @param {{ version: string } | null} feed
 * @param {{ version?: string, at?: number } | null | undefined} lastTry
 * @param {number} nowMs
 */
export function shouldHandOff(feed, lastTry, nowMs) {
  if (!feed || !isAtLeast(feed.version, KVBC_MIN_VERSION)) return false;
  if (lastTry && lastTry.version === feed.version && Number.isFinite(lastTry.at) && nowMs - /** @type {number} */ (lastTry.at) < RETRY_AFTER_MS) return false;
  return true;
}

/**
 * The hand-off for KVBC Awana: this PC is a display, with this app's
 * settings (state.json) and where its browser profile is, so the screens
 * come up signed in as they were.
 *
 * @param {{ display?: any, settings?: any }} state
 * @param {{ version: string, userData: string, exe: string, startWithWindows: boolean, name?: string, at: string }} from
 */
export function buildHandoff(state, from) {
  const s = state && typeof state === 'object' ? state : {};
  return {
    kind: 'kvbc-awana-handoff',
    version: 1,
    at: from.at,
    from: { appId: 'org.kvbc.awana-lobby-display', version: from.version, userData: from.userData, exe: from.exe },
    roles: { print: false, display: true },
    name: from.name || 'Sound room',
    display: {
      settings: s.settings && typeof s.settings === 'object' ? s.settings : null,
      monitor: s.display && typeof s.display === 'object' ? s.display : null,
    },
    startWithWindows: from.startWithWindows !== false,
  };
}
