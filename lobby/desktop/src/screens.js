// @ts-check
// The three screens the app can put up, one at a time (owner, 2026-10-07):
// the lobby signage, the projector (countdown, ceremonies and game time) and
// the Journey kiosk. All three live on the one site, on one origin, so they
// share the app's one browser profile (the passphrase typed once signs in
// all three). Pure: main.js hands it the site's lobby URL.

/** @typedef {'lobby' | 'projector' | 'journey'} ScreenId */
/** @typedef {{ id: ScreenId, name: string, short: string, dir: string, page: string, background: string }} Screen */

/** @type {Record<ScreenId, Screen>} */
export const SCREENS = {
  lobby: { id: 'lobby', name: 'Lobby check-in signage', short: 'the lobby', dir: '../lobby/', page: 'index.html', background: '#B3D0E7' },
  projector: { id: 'projector', name: 'Projector: countdown and game time', short: 'the projector', dir: '../lobby/', page: 'countdown.html', background: '#000000' },
  journey: { id: 'journey', name: 'Journey kiosk', short: 'Journey', dir: '../journey/', page: '', background: '#000000' },
};

export const DEFAULT_SCREEN = 'lobby';

/** @param {unknown} id @returns {Screen} */
export function screenFor(id) {
  return Object.hasOwn(SCREENS, /** @type {string} */ (id)) ? SCREENS[/** @type {ScreenId} */ (id)] : SCREENS[DEFAULT_SCREEN];
}

/**
 * Where a screen lives, from the lobby's own site URL (…/lobby/): the page to
 * load, the folder its window may navigate within, and its configure-mode
 * page (the screen's settings, for the configurator window).
 *
 * @param {string} lobbySite  e.g. https://awana.kvbchurch.org/lobby/
 * @param {unknown} id
 */
export function screenUrls(lobbySite, id) {
  const screen = screenFor(id);
  const base = new URL(screen.dir, lobbySite);
  const page = new URL(screen.page, base);
  const configure = new URL(page);
  configure.searchParams.set('configure', '1');
  return { screen, page: page.href, base: base.href, configure: configure.href };
}

/**
 * Whether `url` is one of this screen's own pages: same origin and inside its
 * folder. The window never leaves it (awana.kvbchurch.org also serves the
 * other screens and the printer's site); anything else opens in the browser.
 *
 * @param {string} url
 * @param {string} base  screenUrls(...).base
 */
export function isScreenPage(url, base) {
  try {
    const u = new URL(url);
    const b = new URL(base);
    return u.origin === b.origin && u.pathname.startsWith(b.pathname);
  } catch { return false; }
}
