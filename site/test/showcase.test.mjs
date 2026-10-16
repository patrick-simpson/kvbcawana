// The home page's showcase twins (site/showcase/stub.js, site/build.mjs; owner
// 2026-10-16): the real screens on a stand-in club night. What must hold, so a
// twin can never touch a real visitor's data or reach the real Worker:
//   - the stand-in runs FIRST, inline (it cannot fail to load on its own);
//   - storage lives in memory; IndexedDB, BroadcastChannel and service workers are off;
//   - the Worker's address and this site's own /api answer from the stand-in;
//   - only the parent page, on this origin, may direct a twin.
// The stub is also run here, in a bare stand-in window, to prove the storage swap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stub = readFileSync(path.join(ROOT, 'site/showcase/stub.js'), 'utf8');
const build = readFileSync(path.join(ROOT, 'site/build.mjs'), 'utf8');

test('the build puts the stand-in inline at the top of every twin, and Journey frames the lobby twin', () => {
  for (const [from, to, kind] of [
    ['lobby/index.html', 'lobby/showcase.html', 'lobby'],
    ['lobby/countdown.html', 'lobby/countdown-showcase.html', 'projector'],
    ['lobby/settings.html', 'lobby/settings-showcase.html', 'settings'],
    ['journey/index.html', 'journey/showcase.html', 'journey'],
    ['journey/remote/index.html', 'journey/remote/showcase.html', 'remote'],
    ['checkin/index.html', 'checkin/showcase.html', 'checkin'],
  ]) assert.ok(build.includes(`['${from}', '${to}', '${kind}']`), to);
  assert.match(build, /html\.replace\(head\[0\], head\[0\] \+ inject\)/, 'right after <head>');
  assert.match(build, /<script>\\n\$\{stub\}<\/script>/, 'inline, not a src');
  assert.match(build, /src="\.\.\/lobby\/showcase\.html"/);
  assert.match(build, /'\/\*showcase\.html',\s*'  Cache-Control: no-cache',\s*'  X-Robots-Tag: noindex, nofollow'/);
});

test('the stand-in answers the Worker, this site\'s /api and the live socket itself, and takes direction only from its parent', () => {
  assert.match(stub, /var BASE = 'https:\/\/showcase\.invalid\/api';/);
  assert.match(stub, /url\.origin === location\.origin && \/\^\\\/api\(\\\/\|\$\)\/\.test\(url\.pathname\)/);
  assert.match(stub, /String\(url\)\.indexOf\('\/v1\/live'\) < 0\) return new RealWebSocket\(url\)/);
  assert.match(stub, /if \(e\.origin !== parentOrigin \|\| e\.source !== window\.parent\) return;/);
  assert.doesNotMatch(stub, /\.innerHTML|eval\(|new Function\(/, 'a message is data, never code');
});

test('the leader\'s remote twin never has the Talk About It sample answers (Journey licensing: a leader\'s own phone only)', () => {
  assert.ok(stub.includes(String.raw`if (/\/slide-answers\.json$/.test(url.pathname)) return Promise.resolve(json(404,`));
  const at = stub.indexOf('slide-answers');
  assert.ok(at > 0 && at < stub.lastIndexOf('return realFetch(input, init);'), 'refused before anything reaches the network');
});

test('run in a window, it swaps storage for memory and switches IndexedDB and BroadcastChannel off', () => {
  const real = { localStorage: { getItem: () => 'REAL' }, indexedDB: { real: true } };
  const listeners = [];
  const win = {
    __SHOWCASE__: { kind: 'checkin' },
    location: { origin: 'https://awana.kvbchurch.org', href: 'https://awana.kvbchurch.org/checkin/showcase.html', search: '?at=2026-10-14T18:00:30', pathname: '/checkin/showcase.html' },
    navigator: {},
    fetch: async () => { throw new Error('the real network'); },
    WebSocket: function RealSocket() {},
    addEventListener: (type, fn) => listeners.push(type),
    parent: null,
    postMessage: () => {},
    ...real,
  };
  win.window = win;
  win.parent = win;
  const ctx = vm.createContext({ ...win, window: win, Date, URL, URLSearchParams, Map, Promise, JSON, Object, Array, String, Number, Function, setTimeout, Response: class {}, EventTarget, Event: class {}, MessageEvent: class {}, CloseEvent: class {}, KeyboardEvent: class {} });
  ctx.window = win;
  vm.runInContext(stub, ctx);
  assert.notEqual(win.localStorage, real.localStorage);
  assert.equal(win.localStorage.getItem('awanaDeskHistoryKey.v1') !== null, true, 'seeded for the check-in page');
  win.localStorage.setItem('x', '1');
  assert.equal(win.localStorage.getItem('x'), '1');
  assert.equal(win.indexedDB, undefined);
  assert.equal(typeof win.BroadcastChannel, 'function');
  assert.equal(new win.BroadcastChannel('awana-configure').postMessage('x'), undefined);
  assert.ok(listeners.includes('message') && listeners.includes('storage'));
  // The clock reads the night's wall time.
  const d = new win.Date();
  assert.equal(d.getHours(), 18);
  assert.equal(d.getDay(), 3, 'a Wednesday');
});
