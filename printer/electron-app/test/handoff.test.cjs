'use strict';
// The sound room app's hand-off (src/handoff.js) and its removal (src/old-app.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const handoff = require('../src/handoff');
const oldApp = require('../src/old-app');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-handoff-'));
const GOOD = {
  kind: 'kvbc-awana-handoff', version: 1, at: '2026-10-12T01:00:00.000Z',
  from: { appId: 'org.kvbc.awana-lobby-display', version: '2.1.0', userData: '', exe: 'C:\\Users\\booth\\AppData\\Local\\Programs\\awana-lobby-display\\Awana Lobby Display.exe' },
  roles: { print: false, display: true },
  name: 'Sound room',
  display: {
    settings: { screen: 'projector', shutdown: { enabled: true, at: '20:30' } },
    monitor: { id: 2, label: 'SAMSUNG', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
  },
  startWithWindows: false,
};

describe('parseHandoff', () => {
  it('reads the sound room\'s settings, with the default hours', () => {
    const h = handoff.parseHandoff(GOOD);
    assert.deepEqual(h.settings, { screen: 'projector', hours: { start: '16:00', end: '20:00' }, shutdown: { enabled: true, at: '20:30' } });
    assert.deepEqual(h.monitor, GOOD.display.monitor);
    assert.equal(h.startWithWindows, false);
    assert.equal(h.name, 'Sound room');
  });
  it('refuses what is not a hand-off, and cleans what is', () => {
    assert.equal(handoff.parseHandoff(null), null);
    assert.equal(handoff.parseHandoff({ ...GOOD, kind: 'x' }), null);
    assert.equal(handoff.parseHandoff({ ...GOOD, version: 2 }), null);
    assert.equal(handoff.parseHandoff({ ...GOOD, roles: { print: true } }), null);
    assert.equal(handoff.parseHandoff({ ...GOOD, from: { appId: 'com.evil' } }), null);
    const h = handoff.parseHandoff({ ...GOOD, display: { settings: { screen: 'nope' }, monitor: { id: 'x' } }, from: { userData: 'relative\\path' } });
    assert.equal(h.settings.screen, 'lobby');
    assert.equal(h.monitor, null);
    assert.equal(h.from.userData, null);
    assert.equal(handoff.parseHandoff({ ...GOOD, startWithWindows: undefined }).startWithWindows, true);
  });
});

describe('applyHandoff', () => {
  it('writes the display state (quiet relaunch), copies the old profile, and marks it done', () => {
    const userData = tmp();
    const old = tmp();
    fs.mkdirSync(path.join(old, 'Partitions', 'lobby', 'Local Storage'), { recursive: true });
    fs.writeFileSync(path.join(old, 'Partitions', 'lobby', 'Local Storage', 'x.ldb'), 'signed in');
    const raw = { ...GOOD, from: { ...GOOD.from, userData: old } };
    fs.writeFileSync(path.join(userData, 'handoff.json'), JSON.stringify(raw));
    const h = handoff.readHandoff(userData);
    const r = handoff.applyHandoff(userData, h);
    assert.equal(r.applied, true);
    assert.equal(r.profile, 'copied');
    const state = JSON.parse(fs.readFileSync(path.join(userData, 'display', 'state.json'), 'utf8'));
    assert.equal(state.quietRelaunch, true);
    assert.equal(state.settings.screen, 'projector');
    assert.deepEqual(state.display, GOOD.display.monitor);
    assert.equal(fs.readFileSync(path.join(userData, 'Partitions', 'lobby', 'Local Storage', 'x.ldb'), 'utf8'), 'signed in');
    assert.equal(fs.existsSync(path.join(userData, 'handoff.json')), false);
    assert.equal(handoff.readHandoff(userData), null);
    const doneRec = handoff.readHandoffDone(userData);
    assert.equal(doneRec.oldAppRemoved, false);
    handoff.markOldAppRemoved(userData, { removed: true, source: 'registry' });
    assert.equal(handoff.readHandoffDone(userData).oldAppRemoved, true);
  });
  it('never overwrites a profile this app already has', () => {
    const userData = tmp();
    const old = tmp();
    fs.mkdirSync(path.join(old, 'Partitions', 'lobby'), { recursive: true });
    fs.mkdirSync(path.join(userData, 'Partitions', 'lobby'), { recursive: true });
    const r = handoff.applyHandoff(userData, handoff.parseHandoff({ ...GOOD, from: { userData: old } }));
    assert.equal(r.profile, 'kept this app\'s own');
  });
});

// RFC 4122 v5, written out here so the pinned GUID is checked independently
// of electron-builder (its NsisTarget names the uninstall key this way).
function uuidV5(name, ns) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ''), 'hex');
  const h = crypto.createHash('sha1').update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

describe('old-app', () => {
  it('the uninstall key is electron-builder\'s GUID for the old appId', () => {
    assert.equal(uuidV5('org.kvbc.awana-lobby-display', '50e065bc-3134-11e6-9bab-38c9862bdaf3'), oldApp.OLD_APP_GUID);
  });

  it('reads reg.exe and splits a command line', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\...\\fb4f\r\n    QuietUninstallString    REG_SZ    "C:\\Users\\b\\AppData\\Local\\Programs\\awana-lobby-display\\Uninstall Awana Lobby Display.exe" /currentuser /S\r\n';
    const v = oldApp.parseRegValue(out, 'QuietUninstallString');
    assert.deepEqual(oldApp.splitCommandLine(v), ['C:\\Users\\b\\AppData\\Local\\Programs\\awana-lobby-display\\Uninstall Awana Lobby Display.exe', '/currentuser', '/S']);
    assert.equal(oldApp.parseRegValue('nothing here', 'QuietUninstallString'), null);
  });

  it('runs the registry\'s uninstaller, deletes the login item, and waits until it is gone', async () => {
    const calls = [];
    let installed = true;
    const exe = 'C:\\P\\Uninstall Awana Lobby Display.exe';
    const run = async (cmd, args) => {
      calls.push([cmd, ...args].join(' '));
      if (cmd === 'tasklist') return { code: 0, stdout: 'INFO: No tasks are running' };
      if (cmd === 'reg' && args[0] === 'query' && args[1] === oldApp.UNINSTALL_KEY) {
        if (!installed) return { code: 1, stdout: '' };
        return { code: 0, stdout: `    QuietUninstallString    REG_SZ    "${exe}" /currentuser /S` };
      }
      if (cmd === 'reg' && args[0] === 'query') return { code: 0, stdout: 'found' };
      if (cmd === exe) { installed = false; return { code: 0, stdout: '' }; }
      return { code: 0, stdout: '' };
    };
    const r = await oldApp.removeOldApp({ run, exists: (p) => p === exe && installed, sleep: async () => {}, env: {} });
    assert.equal(r.removed, true);
    assert.equal(r.source, 'registry');
    assert.equal(r.loginItem, true);
    assert.ok(calls.includes(`${exe} /currentuser /S`));
    assert.ok(calls.some((c) => c.startsWith('reg delete HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v org.kvbc.awana-lobby-display')));
  });

  it('falls back to the known folder, and says so when nothing is installed', async () => {
    const run = async (cmd) => ({ code: cmd === 'tasklist' ? 0 : 1, stdout: '' });
    const found = await oldApp.findUninstaller({ run, exists: (p) => p.includes('awana-lobby-display'), env: { LOCALAPPDATA: 'C:\\L' } });
    assert.equal(found.source, 'folder');
    assert.equal(found.exe, 'C:\\L\\Programs\\awana-lobby-display\\Uninstall Awana Lobby Display.exe');
    const r = await oldApp.removeOldApp({ run, exists: () => false, sleep: async () => {}, env: {} });
    assert.deepEqual([r.removed, r.reason], [true, 'not installed']);
  });
});
