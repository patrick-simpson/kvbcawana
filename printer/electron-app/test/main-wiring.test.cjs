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
