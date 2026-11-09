// @ts-check
// Moved from lobby/desktop/src (KVBC Awana v9, ROADMAP.md#kvbc-awana-one-app); behaviour unchanged.
// The screens the app can put up, one at a time (owner, 2026-10-07): the
// lobby signage, the projector (countdown, ceremonies and game time), the
// Journey kiosk and (owner 2026-10-17) the downstairs classroom (Cubbies,
// then Sparks, then the Sparks lobby; classroom/). All live on the one site,
// on one origin, so they share the app's one browser profile (the passphrase
// typed once signs in all of them). Pure: main.js hands it the site's lobby URL.
//
// `defaults` (optional): what choosing that screen sets on this computer
// (settings.js settingsForScreen): the classroom's own hours (4:00 to 8:00 pm, black until its 6:30 card)
// and its 8:00 pm shutdown, owner 2026-10-17. Changed afterwards, they stay.
//
// The presentation screen (owner 2026-11-01) was REMOVED in 10.13.0 (owner 2026-11-09:
// the presentation is over, its page archived): a computer that had it chosen falls
// back to the lobby (screenFor's default).
//
// Cast (owner 2026-11-08: the lobby computer "kind of like an air server"; "It should
// be allowed to be enabled by right clicking on the icon in the task bar"): the tray's
// "Cast (screen sharing)" switch puts it up (site/cast/screen/: a code on the TV,
// presenters on cast.kvbchurch.org) and back to the screen before. `toggle`:
// it is not one of the Screen menu's choices or the wizard's (display.js castOn/castOff).
// Since 11.0.0 (owner 2026-11-09) Cast is on its OWN site, https://cast.kvbchurch.org,
// the TV page at /screen/: its `dir` is that absolute address (never the lobby's site),
// so its window may navigate within exactly that origin and folder (isScreenPage), and
// only its window gets the sign-in bridge (castHostAllowed, static/display/cast-preload.cjs):
// localStorage does not cross origins, so the app hands its own sign-in to that page.
'use strict';

/** @typedef {'lobby' | 'projector' | 'journey' | 'classroom' | 'cast'} ScreenId */
/** @typedef {{ id: ScreenId, name: string, short: string, dir: string, page: string, background: string, query?: Record<string, string>, always?: boolean, toggle?: boolean, defaults?: { hours: { start: string, end: string }, shutdownAt: string } }} Screen */

/** @type {Record<ScreenId, Screen>} */
const SCREENS = {
  lobby: { id: 'lobby', name: 'Lobby check-in signage', short: 'the lobby', dir: '../lobby/', page: 'index.html', background: '#B3D0E7' },
  projector: { id: 'projector', name: 'Projector: countdown and game time', short: 'the projector', dir: '../lobby/', page: 'countdown.html', background: '#000000' },
  journey: { id: 'journey', name: 'Journey kiosk', short: 'Journey', dir: '../journey/', page: '', background: '#000000' },
  classroom: {
    id: 'classroom', name: 'Downstairs classroom', short: 'the downstairs classroom', dir: '../classroom/', page: '', background: '#000000',
    defaults: { hours: { start: '16:00', end: '20:00' }, shutdownAt: '20:00' },
  },
  cast: {
    id: 'cast', name: 'Cast (screen sharing)', short: 'Cast', dir: 'https://cast.kvbchurch.org/screen/', page: '', background: '#F6F2EA',
    always: true, toggle: true,
  },
};

const DEFAULT_SCREEN = 'lobby';

/** @param {unknown} id @returns {Screen} */
function screenFor(id) {
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
function screenUrls(lobbySite, id) {
  const screen = screenFor(id);
  const base = new URL(screen.dir, lobbySite);
  const page = new URL(screen.page, base);
  const configure = new URL(page);
  configure.searchParams.set('configure', '1');
  for (const [k, v] of Object.entries(screen.query || {})) page.searchParams.set(k, v);
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
function isScreenPage(url, base) {
  try {
    const u = new URL(url);
    const b = new URL(base);
    return u.origin === b.origin && u.pathname.startsWith(b.pathname);
  } catch { return false; }
}

/** Cast's own site (owner 2026-11-09). */
const CAST_ORIGIN = 'https://cast.kvbchurch.org';

/**
 * Whether an IPC call may have the computer's sign-in (the Cast TV page's bridge): it
 * must come from the Cast screen's own window, from that window's TOP frame (never an
 * iframe: a YouTube or Facebook player, anything a presenter put up), and that frame
 * must be showing a page of exactly https://cast.kvbchurch.org inside the TV folder.
 *
 * @param {{ fromCastWindow: boolean, isTopFrame: boolean, frameUrl: unknown }} o
 */
function castHostAllowed({ fromCastWindow, isTopFrame, frameUrl }) {
  if (fromCastWindow !== true || isTopFrame !== true) return false;
  try {
    const u = new URL(String(frameUrl));
    return u.origin === CAST_ORIGIN && u.pathname.startsWith('/screen/');
  } catch { return false; }
}

/** The screens someone chooses from (the Screen menu, the wizard): not the Cast switch. */
const CHOOSABLE = Object.freeze(Object.values(SCREENS).filter((x) => !x.toggle));

module.exports = { SCREENS, CHOOSABLE, DEFAULT_SCREEN, CAST_ORIGIN, screenFor, screenUrls, isScreenPage, castHostAllowed };
