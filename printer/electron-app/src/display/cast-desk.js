// @ts-check
// The Cast desk (11.0.0, owner 2026-11-09): a back-of-house "Cast control" window on the
// lobby computer, shown ONLY while Cast is on and only when the computer has two or more
// monitors (one monitor: nothing changes). It loads https://cast.kvbchurch.org/desk/
// (site/cast/desk/): the code, its QR and everything a presenter can do, alongside the
// one phone presenter (worker/src/routes.md 10.18 "The desk").
//
// - Monitor: ALWAYS the Windows primary display, unless the Cast TV is on it, then the
//   next display (no setting). Checked again whenever a display is added, removed or
//   moved (display.js's screen listeners call refresh()).
// - A NORMAL window: maximized on that monitor, the standard title bar, resizable,
//   movable, minimizable, in the taskbar, never full screen, never topmost (it never
//   covers the TV). Closing it puts it away until Cast is next switched on (not a quit).
// - Same profile as the screens (persist:lobby), sandboxed and isolated, with the Cast
//   bridge (static/display/cast-preload.cjs); its window may navigate only within
//   https://cast.kvbchurch.org/desk/, anything else opens in the browser.
'use strict';

const os = require('os');
const { isScreenPage } = require('./screens');

const DESK_URL = 'https://cast.kvbchurch.org/desk/';
const DESK_TITLE = 'KVBC Awana – Cast control';

/**
 * The window material (owner 2026-11-09, a Windows 11 look): Mica on Windows 11 22H2 and
 * later (OS build 22621+, from os.release() like "10.0.22631"), nothing anywhere else.
 * @param {string} platform process.platform
 * @param {string} release os.release()
 * @returns {'mica' | null}
 */
function deskMaterial(platform, release) {
  if (platform !== 'win32') return null;
  const build = parseInt(String(release || '').split('.')[2], 10);
  return Number.isFinite(build) && build >= 22621 ? 'mica' : null;
}

/**
 * Which monitor the desk goes on: null with fewer than two; else the primary, unless the
 * Cast TV is on it, then the first other display.
 * @param {{ id: number }[]} displays
 * @param {{ id: number } | null | undefined} primary
 * @param {number | null | undefined} tvId
 */
function deskDisplay(displays, primary, tvId) {
  if (!Array.isArray(displays) || displays.length < 2) return null;
  const main = primary && displays.find((d) => d.id === primary.id) ? displays.find((d) => d.id === primary.id) : displays[0];
  if (main && main.id !== tvId) return main;
  return displays.find((d) => d.id !== tvId) || null;
}

/**
 * @param {{
 *   BrowserWindow: any, screen: any, shell: any,
 *   preload: string, iconPath?: string, log: (...a: any[]) => void,
 *   tvDisplayId: () => number | null,
 *   platform?: string, release?: string,
 * }} deps
 */
function createCastDesk({ BrowserWindow, screen, shell, preload, iconPath, log, tvDisplayId, platform = process.platform, release = os.release() }) {
  /** @type {any} */
  let win = null;
  let on = false;
  // Closed by hand: away until Cast is next switched on.
  let dismissed = false;
  let closingByApp = false;

  const where = () => deskDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), tvDisplayId());

  function place(display) {
    if (!win || win.isDestroyed()) return;
    const wa = display.workArea;
    const b = win.getBounds();
    const inside = b.x >= wa.x && b.y >= wa.y && b.x < wa.x + wa.width && b.y < wa.y + wa.height;
    if (!inside) {
      if (win.isMaximized()) win.unmaximize();
      win.setBounds({ x: wa.x + 40, y: wa.y + 40, width: Math.max(800, wa.width - 80), height: Math.max(560, wa.height - 80) });
      win.maximize();
    }
  }

  function open(display) {
    const wa = display.workArea;
    const material = deskMaterial(platform, release);
    win = new BrowserWindow({
      show: false,
      title: DESK_TITLE,
      icon: iconPath,
      x: wa.x, y: wa.y, width: wa.width, height: wa.height,
      minWidth: 900, minHeight: 560,
      autoHideMenuBar: true,
      ...(material ? { backgroundMaterial: material, backgroundColor: '#00000000' } : { backgroundColor: '#F3F3F3' }),
      webPreferences: {
        partition: 'persist:lobby',
        preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: true,
        ...(material ? { additionalArguments: [`--awana-cast-material=${material}`] } : {}),
      },
    });
    const wc = win.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (isScreenPage(url, DESK_URL)) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    // The window keeps its own name in the taskbar, whatever the page calls itself.
    win.on('page-title-updated', (event) => event.preventDefault());
    win.on('close', () => {
      if (closingByApp) return;
      dismissed = true;
      log('cast desk closed by hand: away until Cast is next switched on');
    });
    const me = win;
    win.on('closed', () => { if (win === me) win = null; });
    win.once('ready-to-show', () => {
      if (!win || win.isDestroyed()) return;
      win.maximize();
      win.show();
    });
    win.loadURL(DESK_URL);
    log('cast desk opened on display', display.id);
  }

  function close() {
    if (!win || win.isDestroyed()) { win = null; return; }
    closingByApp = true;
    try { win.destroy(); } finally { closingByApp = false; }
    win = null;
    log('cast desk closed');
  }

  /** Up when Cast is on, there are two monitors and nobody closed it; on the right monitor. */
  function refresh() {
    if (!on || dismissed) { close(); return; }
    const display = where();
    if (!display) { close(); return; }
    if (win && !win.isDestroyed()) place(display);
    else open(display);
  }

  return {
    /** Cast switched on (a fresh start: a window closed by hand comes back) or off. @param {boolean} castOn */
    set(castOn) {
      if (castOn && !on) dismissed = false;
      on = castOn;
      refresh();
    },
    refresh,
    close,
    /** Whether an IPC sender is this window's own page. @param {any} sender */
    isWindow: (sender) => Boolean(win && !win.isDestroyed() && sender === win.webContents),
    isOpen: () => Boolean(win && !win.isDestroyed()),
  };
}

module.exports = { createCastDesk, deskDisplay, deskMaterial, DESK_URL, DESK_TITLE };
