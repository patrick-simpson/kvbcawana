// @ts-check
// Who is making a change, for the Worker's change log (routes.md 10.1,
// docs/SETTINGS-OVERHAUL.md section 7). Two headers on every Worker call:
//   X-Device       16..64 of A-Za-z0-9_-: this browser's id, or a registered
//                  screen's own id;
//   X-Device-Name  encodeURIComponent(name): what the log calls it.
// Never an IP, a user agent or a session. The settings page's own device lives
// in `awanaDevice.v1` {id, name} (a per-viewer convenience: try/catch, and a
// blocked storage just keeps an in-memory one for the page's lifetime).

import { liveScreenId, liveScreenName, newScreenId } from './screenSync.js';

export const DEVICE_STORAGE = 'awanaDevice.v1';
export const DEVICE_NAME_MAX = 40;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** "Chrome on Windows", from the user agent string. @param {string} [ua] */
export function defaultDeviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\/|CriOS\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
          : /CrOS/.test(ua) ? 'ChromeOS'
            : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/** @param {unknown} name */
export function cleanDeviceName(name) {
  // \s covers tabs and newlines; any other control character is dropped.
  return [...String(name ?? '')].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c)).join('')
    .replace(/\s+/g, ' ').trim().slice(0, DEVICE_NAME_MAX);
}

/** @returns {{id: string, name: string} | null} */
function read() {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_STORAGE) || 'null');
    if (raw && typeof raw === 'object' && ID_RE.test(raw.id)) {
      return { id: raw.id, name: cleanDeviceName(raw.name) || defaultDeviceName() };
    }
  } catch { /* fall through */ }
  return null;
}

let memory = /** @type {{id: string, name: string} | null} */ (null);

/**
 * This browser's device: made and kept the first time it is asked for. When
 * storage is blocked an in-memory one stands in for the page's lifetime.
 * @returns {{id: string, name: string}}
 */
export function loadDevice() {
  const have = read();
  if (have) return have;
  const made = memory ?? { id: newScreenId(), name: defaultDeviceName() };
  memory = made;
  try { localStorage.setItem(DEVICE_STORAGE, JSON.stringify(made)); } catch { /* memory only */ }
  return made;
}

/**
 * @param {string} name
 * @returns {{id: string, name: string}}
 */
export function saveDeviceName(name) {
  const cur = loadDevice();
  const next = { id: cur.id, name: cleanDeviceName(name) || defaultDeviceName() };
  memory = next;
  try { localStorage.setItem(DEVICE_STORAGE, JSON.stringify(next)); } catch { /* memory only */ }
  return next;
}

/** Test seam: forget the in-memory device. */
export function _resetDeviceForTest() { memory = null; }

/**
 * The two headers for the next Worker call. A registered screen speaks as
 * itself; any other page is this browser's device.
 * @returns {Record<string, string>}
 */
export function deviceHeaders() {
  const screenId = liveScreenId();
  const who = screenId ? { id: screenId, name: cleanDeviceName(liveScreenName()) } : loadDevice();
  /** @type {Record<string, string>} */
  const headers = { 'X-Device': who.id };
  if (who.name) headers['X-Device-Name'] = encodeURIComponent(who.name);
  return headers;
}
