'use strict';
// The Cast desk's TV miniature (src/display/cast-preview.js), the desk's Mica material
// (cast-desk.js deskMaterial) and the wiring that keeps both honest.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCastPreview, MIN_GAP_MS } = require('../src/display/cast-preview');
const { createCastDesk, deskMaterial } = require('../src/display/cast-desk');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('the desk material', () => {
  it('Mica on Windows 11 22H2+ only', () => {
    assert.equal(deskMaterial('win32', '10.0.22621'), 'mica');
    assert.equal(deskMaterial('win32', '10.0.26100'), 'mica');
    assert.equal(deskMaterial('win32', '10.0.22000'), null, 'Windows 11 21H2');
    assert.equal(deskMaterial('win32', '10.0.19045'), null, 'Windows 10');
    assert.equal(deskMaterial('win32', ''), null);
    assert.equal(deskMaterial('darwin', '10.0.22621'), null);
    assert.equal(deskMaterial('linux', '6.18.44'), null);
  });

  function open(platform, release) {
    const made = [];
    class W {
      constructor(o) { this.opts = o; this.webContents = { setWindowOpenHandler() {}, on() {} }; made.push(this); }
      on() {} once() {} loadURL() {} isDestroyed() { return false; }
    }
    const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
    const d = createCastDesk({
      BrowserWindow: W, shell: {}, preload: '/p.cjs', log: () => {}, tvDisplayId: () => 2, platform, release,
      screen: { getAllDisplays: () => [display, { id: 2, workArea: display.workArea }], getPrimaryDisplay: () => display },
    });
    d.set(true);
    return made[0].opts;
  }
  it('the window options follow the material', () => {
    const m = open('win32', '10.0.22631');
    assert.equal(m.backgroundMaterial, 'mica');
    assert.equal(m.backgroundColor, '#00000000');
    assert.deepEqual(m.webPreferences.additionalArguments, ['--awana-cast-material=mica']);
    const w10 = open('win32', '10.0.19045');
    assert.equal(w10.backgroundMaterial, undefined);
    assert.equal(w10.backgroundColor, '#F3F3F3');
    assert.equal(w10.webPreferences.additionalArguments, undefined);
  });
});

describe('the TV preview limiter', () => {
  it('captures once per window, again after it, and caches the last answer', async () => {
    let t = 1000; let n = 0;
    const p = createCastPreview({ now: () => t, capture: async () => `data:image/jpeg;base64,${++n}` });
    assert.equal(await p.get(), 'data:image/jpeg;base64,1');
    t += MIN_GAP_MS - 1;
    assert.equal(await p.get(), 'data:image/jpeg;base64,1');
    assert.equal(n, 1);
    t += 1;
    assert.equal(await p.get(), 'data:image/jpeg;base64,2');
    assert.equal(n, 2);
  });
  it('null on failure or an empty answer, never throws, and recovers', async () => {
    let t = 0; let mode = 'throw';
    const p = createCastPreview({ now: () => t, capture: async () => { if (mode === 'throw') throw new Error('x'); return mode === 'empty' ? '' : 'data:ok'; } });
    assert.equal(await p.get(), null);
    t += 1000; mode = 'empty';
    assert.equal(await p.get(), null);
    t += 1000; mode = 'ok';
    assert.equal(await p.get(), 'data:ok');
    const sync = createCastPreview({ now: () => 0, capture: () => { throw new Error('sync'); } });
    assert.equal(await sync.get(), null);
  });
  it('overlapping calls share one capture', async () => {
    let n = 0;
    const p = createCastPreview({ now: () => 0, capture: async () => { n++; return 'data:a'; } });
    const [a, b] = await Promise.all([p.get(), p.get()]);
    assert.equal(a, 'data:a'); assert.equal(b, 'data:a'); assert.equal(n, 1);
  });
});

describe('the preview wiring', () => {
  const display = read('src', 'display', 'display.js');
  const preload = read('static', 'display', 'cast-preload.cjs');
  const desk = read('src', 'display', 'cast-desk.js');
  it('the bridge exposes preview and material, on Cast\'s origin only', () => {
    assert.match(preload, /preview: \(\) => ipcRenderer\.invoke\('cast:preview'\),/);
    assert.match(preload, /process\.argv\.find\(\(a\) => a\.startsWith\('--awana-cast-material='\)\)/);
    assert.ok(preload.indexOf("window.location.origin === 'https://cast.kvbchurch.org'") < preload.indexOf('preview:'));
  });
  it('the handler is sender-checked: the desk window only, top frame, /desk/, Cast up', () => {
    const fn = display.slice(display.indexOf('async function castPreviewFor(event)'), display.indexOf('function wireIpc()'));
    assert.match(fn, /fromCastWindow: false,/);
    assert.match(fn, /fromDeskWindow: castDesk\.isWindow\(event\.sender\) && urls\(\)\.screen\.id === 'cast',/);
    assert.match(fn, /isTopFrame: Boolean\(frame && !frame\.parent\)/);
    assert.match(fn, /if \(!allowed\) return null;/);
    assert.match(display, /ipcMain\.handle\('cast:preview', \(event\) => castPreviewFor\(event\)\);/);
    assert.match(display, /const IPC_HANDLES = \[[^\]]*'cast:preview'/);
  });
  it('captures the TV window small, as JPEG, only when it is visible', () => {
    assert.match(display, /lobby\.webContents\.capturePage\(\)/);
    assert.match(display, /resize\(\{ width: 640, quality: 'good' \}\)/);
    assert.match(display, /toJPEG\(70\)/);
    assert.match(display, /!lobby\.isVisible\(\) \|\| lobby\.isMinimized\(\)/);
  });
  it('additionalArguments only with mica', () => {
    assert.match(desk, /\.\.\.\(material \? \{ additionalArguments: \[`--awana-cast-material=\$\{material\}`\] \} : \{\}\),/);
    assert.equal((desk.match(/additionalArguments/g) || []).length, 1);
  });
});
