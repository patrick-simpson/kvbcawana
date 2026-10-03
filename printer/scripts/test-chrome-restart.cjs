#!/usr/bin/env node
// Chrome restarts after an update (7.4.1): closed, then reopened on the
// check-in page only. Drives electron-app/src/chrome-restart.js with fakes for
// tasklist, taskkill and the launch, so it runs anywhere.
'use strict';
const fs = require('fs');
const path = require('path');
const cr = require('../electron-app/src/chrome-restart.js');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const URL = 'https://kvbchurch.twotimtwo.com/clubber/checkin';
const ENV = { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' };
const EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function rig({ running = true, installed = true, dies = true } = {}) {
  const r = { calls: [], spawned: null, opened: null, alive: running };
  r.execFileSync = (cmd, args) => {
    r.calls.push([cmd, ...args].join(' '));
    if (cmd === 'tasklist') return r.alive ? 'chrome.exe  1234 Console  1  100,000 K' : 'INFO: No tasks are running which match the specified criteria.';
    if (cmd === 'taskkill' && dies) r.alive = false;
    return '';
  };
  r.spawn = (exe, args, opts) => { r.spawned = { exe, args, opts }; return { unref() {} }; };
  r.existsSync = (p) => installed && p === EXE;
  r.openExternal = async (u) => { r.opened = u; };
  r.sleep = async () => {};
  return r;
}

(async () => {
  console.log('\nchrome restart after an update');
  let r = rig();
  let out = await cr.restartChrome({ url: URL, env: ENV, platform: 'win32', ...r });
  check('Chrome is closed, every window and its children', r.calls.includes('taskkill /IM chrome.exe /T /F') && out.closed, r.calls.join(' | '));
  check('and reopened on the check-in page only, without the restore bubble', r.spawned && r.spawned.exe === EXE
    && JSON.stringify(r.spawned.args) === JSON.stringify(['--hide-crash-restore-bubble', '--new-window', URL]) && out.launched === 'chrome', JSON.stringify(r.spawned));
  check('launched detached, so it outlives the app', r.spawned && r.spawned.opts.detached === true);

  r = rig({ running: false });
  out = await cr.restartChrome({ url: URL, env: ENV, platform: 'win32', ...r });
  check('Chrome not running: nothing to close, it is opened on the check-in page', !r.calls.some(c => c.startsWith('taskkill')) && r.spawned && out.launched === 'chrome');

  r = rig({ installed: false });
  out = await cr.restartChrome({ url: URL, env: ENV, platform: 'win32', ...r });
  check('Chrome not found: the check-in page opens in the default browser', r.opened === URL && out.launched === 'default-browser');

  r = rig({ dies: false });
  out = await cr.restartChrome({ url: URL, env: ENV, platform: 'win32', ...r });
  check('a Chrome that will not close does not hang the app', out.closed === false && r.spawned);

  r = rig();
  out = await cr.restartChrome({ url: URL, env: ENV, platform: 'linux', ...r });
  check('Windows only', out.launched === 'not-windows' && !r.calls.length);

  check('per-user and per-machine installs are both looked for', cr.chromeCandidates(ENV).some(p => p.startsWith('C:\\Users')) && cr.chromeCandidates(ENV).includes(EXE));

  const main = fs.readFileSync(path.join(__dirname, '..', 'electron-app', 'main.js'), 'utf8');
  check('it runs on the launch that wrote a newer extension, packaged builds only',
    /const restartChromeNow = app\.isPackaged && extensionState\.action === 'updated'/.test(main));
  check('after the extension folder is synced', main.indexOf('syncBundledExtension();\n') < main.indexOf('const restartChromeNow'));
  check('with a check-in address judged safe first', /restartChromeNow = [^;]*isSafeExternalUrl\(config\.checkinUrl\)/.test(main));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
