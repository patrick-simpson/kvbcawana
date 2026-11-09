'use strict';
// The Cast desk (11.0.0, owner 2026-11-09): KVBC Awana's back-of-house "Cast control"
// window (src/display/cast-desk.js), and who may have the computer's sign-in through the
// bridge (screens.js castHostAllowed).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCastDesk, deskDisplay, DESK_URL, DESK_TITLE } = require('../src/display/cast-desk');
const { castHostAllowed } = require('../src/display/screens');

const D = (id, x) => ({ id, bounds: { x, y: 0, width: 1920, height: 1080 }, workArea: { x, y: 0, width: 1920, height: 1040 } });

describe('which monitor the desk goes on', () => {
  it('none with one monitor; the primary; the next one when the Cast TV is on the primary', () => {
    const a = D(1, 0); const b = D(2, 1920); const c = D(3, 3840);
    assert.equal(deskDisplay([a], a, 1), null);
    assert.equal(deskDisplay([a], a, null), null);
    assert.equal(deskDisplay([], a, null), null);
    assert.equal(deskDisplay([a, b], a, 2), a, 'the TV elsewhere: the primary');
    assert.equal(deskDisplay([a, b], a, 1), b, 'the TV on the primary: the next display');
    assert.equal(deskDisplay([b, a, c], a, 1), b);
    assert.equal(deskDisplay([a, b], b, 2), a);
    assert.equal(deskDisplay([a, b], null, 1), b, 'no primary known: the first, unless the TV is there');
  });
});

/** A stand-in Electron: windows, screen and shell, recording what happens. */
function fakeElectron(displays, primaryId) {
  const made = [];
  class FakeWindow extends EventEmitter {
    constructor(opts) {
      super();
      this.opts = opts;
      this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
      this.destroyed = false; this.maximized = false; this.shown = false; this.url = '';
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = (fn) => { this.webContents.openHandler = fn; };
      made.push(this);
    }
    loadURL(u) { this.url = u; this.emit('ready-to-show'); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    close() { const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; this.emit('close', e); if (!e.defaultPrevented) this.destroy(); }
    getBounds() { return this.bounds; }
    setBounds(b) { this.bounds = b; }
    maximize() { this.maximized = true; }
    unmaximize() { this.maximized = false; }
    isMaximized() { return this.maximized; }
    show() { this.shown = true; }
  }
  const screen = { list: displays, primary: primaryId, getAllDisplays() { return this.list; }, getPrimaryDisplay() { return this.list.find((d) => d.id === this.primary) || this.list[0]; } };
  const opened = [];
  return { made, screen, BrowserWindow: FakeWindow, shell: { openExternal: (u) => opened.push(u) }, opened };
}

function desk(displays, primaryId, tv) {
  const e = fakeElectron(displays, primaryId);
  const t = { tv };
  const d = createCastDesk({ BrowserWindow: e.BrowserWindow, screen: e.screen, shell: e.shell, preload: '/app/static/display/cast-preload.cjs', log: () => {}, tvDisplayId: () => t.tv });
  return { e, d, t };
}

describe('the desk window', () => {
  it('opens maximized on the right monitor only while Cast is on, with two monitors', () => {
    const { e, d } = desk([D(1, 0), D(2, 1920)], 1, 2);
    d.refresh();
    assert.equal(e.made.length, 0, 'Cast off: nothing');
    d.set(true);
    assert.equal(e.made.length, 1);
    const w = e.made[0];
    assert.equal(w.url, DESK_URL);
    assert.equal(w.opts.title, DESK_TITLE);
    assert.equal(w.bounds.x, 0, 'the primary (the TV is on display 2)');
    assert.ok(w.maximized && w.shown);
    // A normal window: never full screen or topmost, in the taskbar, the standard frame.
    for (const k of ['fullscreen', 'alwaysOnTop', 'skipTaskbar', 'frame', 'kiosk']) assert.equal(w.opts[k], undefined, k);
    // Sandboxed, isolated, the screens' profile, the Cast bridge.
    assert.deepEqual(
      { p: w.opts.webPreferences.partition, c: w.opts.webPreferences.contextIsolation, s: w.opts.webPreferences.sandbox, n: w.opts.webPreferences.nodeIntegration, pre: w.opts.webPreferences.preload },
      { p: 'persist:lobby', c: true, s: true, n: false, pre: '/app/static/display/cast-preload.cjs' },
    );
    d.set(false);
    assert.equal(w.destroyed, true, 'Cast off: closed');
    assert.equal(d.isOpen(), false);
  });

  it('one monitor: nothing changes', () => {
    const { e, d } = desk([D(1, 0)], 1, 1);
    d.set(true);
    assert.equal(e.made.length, 0);
  });

  it('goes to the next display when the TV is on the primary, and follows display changes', () => {
    const { e, d, t } = desk([D(1, 0), D(2, 1920)], 1, 1);
    d.set(true);
    assert.equal(e.made[0].bounds.x, 1920);
    // The TV moves to display 2: the desk comes back to the primary.
    t.tv = 2;
    d.refresh();
    assert.equal(e.made.length, 1, 'moved, not reopened');
    assert.ok(e.made[0].bounds.x < 1920);
    // A monitor unplugged: one left, the desk goes away; plugged back in, it returns.
    e.screen.list = [D(1, 0)];
    d.refresh();
    assert.equal(e.made[0].destroyed, true);
    e.screen.list = [D(1, 0), D(2, 1920)];
    d.refresh();
    assert.equal(e.made.length, 2);
  });

  it('closed by hand it stays away until Cast is next switched on', () => {
    const { e, d } = desk([D(1, 0), D(2, 1920)], 1, 2);
    d.set(true);
    e.made[0].close();
    assert.equal(d.isOpen(), false);
    d.refresh();
    d.set(true); // still on: not a new switch-on
    assert.equal(e.made.length, 1, 'not reopened while Cast stays on');
    d.set(false);
    d.set(true);
    assert.equal(e.made.length, 2, 'Cast switched on again: back');
  });

  it('stays on its page: anything else opens in the browser', () => {
    const { e, d } = desk([D(1, 0), D(2, 1920)], 1, 2);
    d.set(true);
    const wc = e.made[0].webContents;
    const nav = (url) => { const ev = { prevented: false, preventDefault() { this.prevented = true; } }; wc.emit('will-navigate', ev, url); return ev.prevented; };
    assert.equal(nav('https://cast.kvbchurch.org/desk/?x=1'), false);
    assert.equal(nav('https://cast.kvbchurch.org/screen/'), true);
    assert.equal(nav('https://cast.kvbchurch.org/'), true);
    assert.equal(nav('https://evil.example/desk/'), true);
    assert.deepEqual(wc.openHandler({ url: 'https://youtube.com/x' }), { action: 'deny' });
    assert.ok(e.opened.includes('https://evil.example/desk/'));
    // The page's own title never renames the window.
    const t = { prevented: false, preventDefault() { this.prevented = true; } };
    e.made[0].emit('page-title-updated', t);
    assert.equal(t.prevented, true);
    assert.equal(d.isWindow(wc), true);
    assert.equal(d.isWindow({}), false);
  });
});

describe('the bridge answers the desk window only on the desk page, the TV window only on the TV page', () => {
  it('each window its own folder; never both, never neither; top frame only', () => {
    const tv = { fromCastWindow: true, isTopFrame: true, frameUrl: 'https://cast.kvbchurch.org/screen/' };
    const dk = { fromCastWindow: false, fromDeskWindow: true, isTopFrame: true, frameUrl: 'https://cast.kvbchurch.org/desk/' };
    assert.equal(castHostAllowed(tv), true);
    assert.equal(castHostAllowed(dk), true);
    assert.equal(castHostAllowed({ ...dk, frameUrl: 'https://cast.kvbchurch.org/screen/' }), false, 'the TV page in the desk window');
    assert.equal(castHostAllowed({ ...tv, frameUrl: 'https://cast.kvbchurch.org/desk/' }), false, 'the desk page in the TV window');
    assert.equal(castHostAllowed({ ...dk, frameUrl: 'https://cast.kvbchurch.org/' }), false, 'the presenter page');
    assert.equal(castHostAllowed({ ...dk, isTopFrame: false }), false);
    assert.equal(castHostAllowed({ ...dk, frameUrl: 'https://kvbc-cast.pages.dev/desk/' }), false);
    assert.equal(castHostAllowed({ ...dk, fromCastWindow: true }), false, 'both at once is nonsense');
    assert.equal(castHostAllowed({ ...dk, fromDeskWindow: false }), false, 'neither');
  });
});
