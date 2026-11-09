'use strict';
// main.js cannot run without Electron, so the rules that keep the roles apart
// are pinned at the source, the printer's way (scripts/test-config-store.cjs).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const display = fs.readFileSync(path.join(__dirname, '..', 'src', 'display', 'display.js'), 'utf8');
const setup = fs.readFileSync(path.join(__dirname, '..', 'static', 'setup.html'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'static', 'setup-preload.cjs'), 'utf8');

describe('main.js keeps the roles apart', () => {
  it('the print server starts only while the print role is on', () => {
    assert.match(main, /function startServer\(config\) \{\n  if \(!roles\.print\) return;/);
    assert.match(main, /async function ensureServerRunning\(context\) \{\n  if \(!roles\.print\) return false;/);
    assert.match(main, /if \(roles\.print\) await startPrintRole\(\);/);
  });

  it('the display starts only while the display role is on', () => {
    assert.match(main, /if \(roles\.display\) display\.start\(\);/);
    assert.match(main, /if \(!roles\.display && display\.isRunning\(\)\) display\.stop\(\);/);
  });

  it('the roles are decided before anything else writes to userData, and the wizard opens only when setup is not done', () => {
    const ready = main.indexOf('app.whenReady().then');
    const decide = main.indexOf('rolesStore.decideStartRoles', ready);
    assert.ok(decide > ready);
    for (const later of ['await startPrintRole();', 'saveConfig({ launchOnBoot: pendingHandoff', 'createDisplay({']) {
      assert.ok(main.indexOf(later, ready) > decide, later);
    }
    assert.match(main, /if \(!roles\.setupDone\) openWizard\(\);/);
  });

  it('updates install right away: no idle gate for either role', () => {
    assert.match(main, /setInterval\(check, UPDATE_EVERY_MS\)/);
    assert.match(main, /const UPDATE_EVERY_MS = 10 \* 60 \* 1000;/);
    assert.match(main, /if \(display\) display\.prepareInstall\(\);/);
    // The only wait is the fixed grace, or a busy poll capped at a minute.
    assert.match(main, /const AUTO_INSTALL_BUSY_CAP_MS = 60000;/);
    assert.doesNotMatch(main + display, /isVisible\(\)[^\n]*quitAndInstall|decideVisibility[^\n]*install/);
  });

  it('the display module never owns the updater, the single-instance lock or the login item itself', () => {
    assert.doesNotMatch(display, /electron-updater|requestSingleInstanceLock|setLoginItemSettings/);
  });
});

describe('the wizard', () => {
  it('a narrow bridge: six calls and nothing else', () => {
    const calls = [...preload.matchAll(/^\s{2}(\w+): /gm)].map((m) => m[1]);
    assert.deepEqual(calls, ['state', 'printers', 'signIn', 'identify', 'finish', 'close']);
    assert.doesNotMatch(preload, /require\((?!'electron')/);
  });

  it('a strict CSP and the brand kit from the print server\'s mirror', () => {
    assert.match(setup, /Content-Security-Policy" content="default-src 'none';/);
    assert.match(setup, /href="\.\.\/\.\.\/print-server\/public\/brand\/fonts\.css"/);
    assert.ok(fs.existsSync(path.join(__dirname, '..', '..', 'print-server', 'public', 'brand', 'fonts.css')));
  });

  it('never stores the passphrase: the field is cleared after a good sign-in', () => {
    assert.match(setup, /\$\('pass'\)\.value = '';/);
    assert.doesNotMatch(main, /saveConfig\(\{[^}]*passphrase/);
  });
});

describe('the repair installer download', () => {
  const start = main.indexOf('function downloadRepairInstaller');
  const body = main.slice(start, main.indexOf('function probeServer', start));
  it('handles a write error and never runs an incomplete file', () => {
    assert.match(body, /file\.on\('error'/);
    assert.match(body, /received !== expected/);
    assert.match(body, /fs\.unlinkSync\(dest\)/);
  });
  it('checks the installer\'s sha512 against the feed before it is opened', () => {
    const i = main.indexOf('function downloadRepairInstaller');
    const fn = main.slice(i, main.indexOf('function probeServer', i));
    assert.match(fn, /verifyInstaller\(dest, feedText\)/);
    assert.ok(fn.indexOf('verifyInstaller') < fn.indexOf('shell.openPath'));
  });
});

describe('the status window is locked to its own page (10.14.0)', () => {
  const statusPreload = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
  const channels = [...statusPreload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]);
  it('every channel its preload calls is registered through the sender check', () => {
    assert.ok(channels.length >= 9, channels.join(','));
    for (const c of channels) {
      assert.ok(main.includes(`statusHandle('${c}', `), `${c} goes through statusHandle`);
      assert.ok(!main.includes(`ipcMain.handle('${c}'`), `${c} is not registered without the check`);
    }
  });
  it('the check is the status window\'s own top frame on the app\'s own page', () => {
    assert.match(main, /event\.sender !== setupWindow\.webContents\) return false;/);
    assert.match(main, /if \(frame && frame\.parent\) return false;/);
    assert.match(main, /url\.startsWith\('file:'\) \|\| \(isDev && url\.startsWith\('http:\/\/localhost:5173\/'\)\)/);
  });
  it('it cannot navigate, opens no window of its own, and is sandboxed', () => {
    const i = main.indexOf('function createSetupWindow');
    const body = main.slice(i, main.indexOf('// ─── Tray', i));
    assert.match(body, /sandbox: true/);
    assert.match(body, /swc\.on\('will-navigate', \(event, url\) => \{\n    event\.preventDefault\(\);/);
    assert.match(body, /swc\.setWindowOpenHandler\(/);
    assert.match(body, /return \{ action: 'deny' \};/);
  });
  it('the preload needs nothing a sandboxed preload lacks', () => {
    const requires = [...statusPreload.matchAll(/require\('([^']+)'\)/g)].map((m) => m[1]);
    assert.deepEqual(requires, ['electron']);
  });
});

describe('the hidden printer window', () => {
  it('is made again after a crash, and every use goes through getPdfWindow', () => {
    assert.match(main, /function getPdfWindow\(\) \{\n  if \(!pdfWindow \|\| pdfWindow\.isDestroyed\(\)\) createPdfWindow\(\);/);
    assert.match(main, /render-process-gone/);
    assert.doesNotMatch(main, /[^t]pdfWindow\.webContents\.getPrintersAsync/);
  });
});

describe('the display role saves its state durably', () => {
  it('flushes the temp file to disk before renaming it into place', () => {
    const i = display.indexOf('function writeJson');
    const body = display.slice(i, display.indexOf('let state =', i));
    assert.match(body, /fs\.fsyncSync\(fd\)/);
    assert.ok(body.indexOf('fsyncSync') < body.indexOf('renameSync'));
  });
});

describe('a second launch', () => {
  it('ignores Windows\' own --autostart launch, so it never counts as a manual Show', () => {
    assert.match(main, /app\.on\('second-instance', \(event, argv\) => \{\n(?:  \/\/.*\n)+  if \(Array\.isArray\(argv\) && argv\.includes\('--autostart'\)\) return;/);
  });
});

describe('show-presentation is gone (owner 2026-11-09: the presentation is over; 10.13.0)', () => {
  it('no action handler, no Presentation screen shown from afar, no live-channel bell for it', () => {
    assert.ok(!/show-presentation/.test(main), 'main.js takes no show-presentation');
    assert.ok(!/showScreen\('presentation'\)/.test(main));
    assert.ok(!/screenBell/.test(main), 'the bell socket is gone');
    assert.ok(!/isScreenRing/.test(main));
  });

  it('showScreen lets a tray Hide go, switches another screen as if chosen, and never reloads the same screen up', () => {
    const fn = display.slice(display.indexOf('function showScreen(id)'), display.indexOf('/** New hours apply at once'));
    assert.match(fn, /state\.overrides = NO_OVERRIDES/);
    assert.match(fn, /blackDismissed = false/);
    assert.match(fn, /setScreen\(id\); return 'switched';/);
    assert.match(fn, /if \(lobby\) return 'already';/);
  });
});

describe('Cast on its own site signs in with the computer\'s own sign-in (11.0.0, owner 2026-11-09)', () => {
  const castPreload = fs.readFileSync(path.join(__dirname, '..', 'static', 'display', 'cast-preload.cjs'), 'utf8');
  it('only the Cast screen\'s window gets the bridge, sandboxed and isolated like every window', () => {
    assert.match(display, /\.\.\.\(urls\(\)\.screen\.id === 'cast' \? \{ preload: staticFile\('cast-preload\.cjs'\) \} : \{\}\),/);
    const open = display.slice(display.indexOf('function openLobby()'), display.indexOf('const wc = lobby.webContents;'));
    assert.match(open, /contextIsolation: true,\n\s*sandbox: true,\n\s*nodeIntegration: false,/);
    assert.equal((display.match(/staticFile\('cast-preload\.cjs'\)/g) || []).length, 1);
  });
  it('the preload exposes one call, on Cast\'s own origin only', () => {
    assert.match(castPreload, /if \(window\.location\.origin === 'https:\/\/cast\.kvbchurch\.org'\) \{/);
    assert.match(castPreload, /contextBridge\.exposeInMainWorld\('awanaCastHost', \{\n\s*session: \(\) => ipcRenderer\.invoke\('cast:session'\),\n\s*\}\);/);
    assert.equal((castPreload.match(/ipcRenderer\./g) || []).length, 1);
  });
  it('the main process checks the sender: the Cast window, its top frame, Cast\'s TV page', () => {
    const fn = display.slice(display.indexOf('function castSession(event)'), display.indexOf('function wireIpc()'));
    assert.match(fn, /event\.sender === lobby\.webContents && urls\(\)\.screen\.id === 'cast'/);
    assert.match(fn, /isTopFrame: Boolean\(frame && !frame\.parent\)/);
    assert.match(fn, /frameUrl: frame \? frame\.url : ''/);
    assert.match(fn, /if \(!allowed\) \{[^}]*return null; \}/);
    assert.match(display, /ipcMain\.handle\('cast:session', \(event\) => castSession\(event\)\);/);
    assert.match(display, /const IPC_HANDLES = \[[^\]]*'cast:session'/);
  });
  it('main.js hands over the bare session string of this computer\'s own sign-in', () => {
    assert.match(main, /castSession: \(\) => \{\n\s*const sess = deviceSession\(\);\n\s*return sess && syncClient && syncClient\.isValidSession\(sess\.session\) \? sess\.session : null;\n\s*\},/);
  });
});

describe('Cast from the tray (owner 2026-11-08: "enabled by right clicking on the icon in the task bar")', () => {
  it('a checkbox in the display\'s tray items turns Cast on and off', () => {
    assert.match(display, /label: 'Cast \(screen sharing\)', type: 'checkbox', checked: state\.settings\.screen === 'cast', click: \(\) => \(state\.settings\.screen === 'cast' \? castOff\(\) : castOn\(\)\)/);
  });

  it('on remembers the screen before and shows Cast whatever the hours; off goes back to it', () => {
    const on = display.slice(display.indexOf('function castOn()'), display.indexOf('function castOff()'));
    assert.match(on, /state\.castReturn = state\.settings\.screen;/);
    assert.match(on, /showScreen\('cast'\);/);
    const off = display.slice(display.indexOf('function castOff()'), display.indexOf('/** New hours apply at once'));
    assert.match(off, /setScreen\(back\);/);
    assert.match(off, /: 'lobby';/);
  });

  it('turning Cast off closes the room with this computer\'s own sign-in', () => {
    assert.match(main, /onCast: \(on\) => \{/);
    // "Show Cast code" (owner 2026-11-08): only while Cast is up; main.js resets the room.
    assert.match(display, /\{ label: 'Show Cast code', enabled: state\.settings\.screen === 'cast', click: castReset \}/);
    assert.match(main, /onCastReset: \(\) => \{/);
    assert.match(display, /\{ label: 'Disconnect the presenter', enabled: state\.settings\.screen === 'cast', click: castKick \}/);
    assert.match(main, /'\/v1\/cast\/kick', \{ method: 'POST', body: \{\}, session: sess\.session \}/);
    assert.match(main, /'\/v1\/cast\/reset', \{ method: 'POST', body: \{\}, session: sess\.session \}/);
    assert.match(main, /syncClient\.syncRequest\(sess\.url, '\/v1\/cast\/close', \{ method: 'POST'/);
  });

  it('screen pages answer with the real local address (no mDNS hiding), set before the app is ready', () => {
    assert.match(main, /app\.commandLine\.appendSwitch\('disable-features', 'WebRtcHideLocalIpsWithMdns'\);/);
    assert.ok(main.indexOf("appendSwitch('disable-features'") < main.indexOf('app.whenReady()'));
  });
});

describe('the tray menu is grouped (owner 2026-11-08: "redesign the context menu ... it seems messy")', () => {
  const tray = main.slice(main.indexOf('function buildTray(config)'), main.indexOf('tray.setContextMenu('));

  it('has the Screen, Cast, Printing and App submenus', () => {
    assert.match(tray, /\{ label: 'Screen', submenu: groups\.screen \}/);
    assert.match(tray, /\{ label: 'Cast', submenu: groups\.cast \}/);
    assert.match(tray, /\{ label: 'Printing', submenu: printing \}/);
    assert.match(tray, /\{ label: 'App', submenu: appMenu \}/);
  });

  it('keeps warnings top-level and puts Quit last', () => {
    assert.ok(tray.indexOf('Print server NOT RUNNING') < tray.indexOf("label: 'Printing'"));
    assert.ok(tray.indexOf('groups.warnings') < tray.indexOf("label: 'Screen'"));
    const last = tray.lastIndexOf('template.push(');
    assert.match(tray.slice(last), /^template\.push\(\{\n\s+label: 'Quit'/);
  });

  it('the display hands main.js its groups', () => {
    assert.match(display, /function menuGroups\(\)/);
    assert.match(display, /\{ label: 'Screen', submenu: g\.screen \}/);
  });
});
