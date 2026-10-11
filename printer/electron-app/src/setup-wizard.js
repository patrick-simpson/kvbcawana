// "Set up this computer" (KVBC Awana v9, UNIFIED-APP.md: "a full wizard:
// role, the church passphrase, a name for the computer, then the printer
// (print server) and/or the screen and monitor (display)").
//
// A static page (static/setup.html) and a narrow preload
// (static/setup-preload.cjs: window.kvbcSetup, six calls). It opens by
// itself on a new install (roles.json setupDone false) and from the tray's
// "Set up this computer..." at any time after. Everything it changes goes
// through main.js's finishSetup(), the same path a role change from
// /settings will take.
'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');

/**
 * @param {{
 *   staticDir: string, iconPath?: string,
 *   state: () => Promise<object> | object,
 *   printers: () => Promise<Array<{ name: string, isDefault: boolean }>>,
 *   signIn: (passphrase: string) => Promise<object>,
 *   finish: (choices: object) => Promise<object>,
 * }} deps
 */
function createSetupWizard(deps) {
  /** @type {BrowserWindow | null} */
  let win = null;
  const identifiers = [];

  const fromWizard = (event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents);

  function closeIdentifiers() {
    while (identifiers.length) {
      const w = identifiers.pop();
      if (!w.isDestroyed()) w.destroy();
    }
  }

  /** A big number on every monitor for a few seconds, so "Monitor 2" means something. */
  function identify() {
    closeIdentifiers();
    screen.getAllDisplays().forEach((display, i) => {
      const wa = display.workArea;
      const size = 220;
      const w = new BrowserWindow({
        x: wa.x + Math.round((wa.width - size) / 2),
        y: wa.y + Math.round((wa.height - size) / 2),
        width: size, height: size,
        frame: false, resizable: false, movable: false, focusable: false, skipTaskbar: true,
        alwaysOnTop: true, show: false, transparent: false, backgroundColor: '#FAA41D',
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      identifiers.push(w);
      w.loadFile(path.join(deps.staticDir, 'identify.html'), { query: { n: String(i + 1) } });
      w.once('ready-to-show', () => { w.setAlwaysOnTop(true, 'screen-saver'); w.showInactive(); });
    });
    setTimeout(closeIdentifiers, 4000).unref?.();
  }

  function monitors() {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      n: i + 1,
      label: d.label || `Monitor ${i + 1}`,
      size: `${d.size.width} x ${d.size.height}`,
      primary: d.id === primary,
    }));
  }

  ipcMain.handle('setup:state', async (event) => (fromWizard(event) ? { ...(await deps.state()), monitors: monitors() } : null));
  ipcMain.handle('setup:printers', async (event) => (fromWizard(event) ? deps.printers() : []));
  ipcMain.handle('setup:sign-in', async (event, passphrase) => (fromWizard(event) ? deps.signIn(String(passphrase || '').slice(0, 200)) : { ok: false }));
  ipcMain.handle('setup:identify', (event) => { if (fromWizard(event)) identify(); return true; });
  ipcMain.handle('setup:finish', async (event, choices) => (fromWizard(event) ? deps.finish(choices) : { ok: false, error: 'not the setup window' }));
  ipcMain.on('setup:close', (event) => { if (fromWizard(event)) win.close(); });

  function open() {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
    win = new BrowserWindow({
      width: 820,
      height: 600,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'KVBC Awana: set up this computer',
      icon: deps.iconPath,
      backgroundColor: '#F6F8FB',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(deps.staticDir, 'setup-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.setMenu(null);
    win.on('closed', () => { win = null; closeIdentifiers(); });
    win.once('ready-to-show', () => win?.show());
    win.loadFile(path.join(deps.staticDir, 'setup.html'));
  }

  const close = () => { if (win && !win.isDestroyed()) win.close(); };
  const isOpen = () => Boolean(win && !win.isDestroyed());
  const onClosed = (fn) => { if (win) win.once('closed', fn); };

  return { open, close, isOpen, onClosed };
}

module.exports = { createSetupWizard };
