// Addresses a screen is about to frame or fetch its settings from (security,
// 2026-11-09). Pure, no imports.

/** The one public home of these pages: a ?config= there is ours too. */
export const SITE_ORIGIN = 'https://awana.kvbchurch.org';
const MAX = 2000;

/**
 * An https address with no user name or password and nothing odd in it, so it
 * can go into an iframe's src (never javascript:, data:, blob: or http:).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  if (!value || value.length > MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f<>"']/.test(value)) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  return u.protocol === 'https:' && !u.username && !u.password;
}

/** '' or an https address (a URL setting left empty is fine). @param {unknown} value */
export const isHttpsUrlOrEmpty = (value) => value === '' || isHttpsUrl(value);

/**
 * A ?config= address this page may fetch its settings from: on the page's own
 * origin (a path like /lobby/fleet.json works too) or on awana.kvbchurch.org
 * over https; anything else is null (a link to someone else's server must not
 * be able to set what this screen frames or shows).
 * @param {string} raw
 * @param {string} pageHref the page's own address
 * @returns {string|null}
 */
export function sameSiteConfigUrl(raw, pageHref) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s || s.length > MAX) return null;
  let u;
  let page;
  try { page = new URL(pageHref); u = new URL(s, page); } catch { return null; }
  if (u.username || u.password) return null;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.origin === page.origin || u.origin === SITE_ORIGIN) return u.href;
  return null;
}
