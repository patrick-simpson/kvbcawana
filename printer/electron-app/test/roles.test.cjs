'use strict';
// The roles file (src/roles.js): what a computer is the first time v9 starts.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roles = require('../src/roles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-roles-'));

describe('decideStartRoles', () => {
  it('an upgraded check-in laptop (printer data, no roles file) is a print server, display off, no wizard', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ printerName: 'DYMO' }));
    const d = roles.decideStartRoles({ saved: roles.readRoles(dir), handoff: null, printerData: roles.hasPrinterData(dir) });
    assert.equal(d.source, 'printer-upgrade');
    assert.deepEqual(d.roles, { print: true, display: false, name: '', setupDone: true });
    assert.equal(d.write, true);
  });

  it('any one of the printer\'s files counts, Chromium\'s own folders do not', () => {
    for (const name of ['print-history.json', 'clubbers.csv', 'chrome-extension']) {
      const dir = tmp();
      if (name === 'chrome-extension') fs.mkdirSync(path.join(dir, name)); else fs.writeFileSync(path.join(dir, name), '');
      assert.equal(roles.hasPrinterData(dir), true, name);
    }
    const dir = tmp();
    for (const name of ['Local State', 'Partitions', 'Cache', 'roles.json']) fs.mkdirSync(path.join(dir, name));
    assert.equal(roles.hasPrinterData(dir), false);
  });

  it('a new install has no role and opens the wizard', () => {
    const d = roles.decideStartRoles({ saved: null, handoff: null, printerData: false });
    assert.equal(d.source, 'new');
    assert.deepEqual(d.roles, { print: false, display: false, name: '', setupDone: false });
  });

  it('the sound room\'s hand-off makes a display, setup done', () => {
    const d = roles.decideStartRoles({ saved: null, handoff: { name: 'Sound room' }, printerData: false });
    assert.equal(d.source, 'handoff');
    assert.deepEqual(d.roles, { print: false, display: true, name: 'Sound room', setupDone: true });
  });

  it('a saved file always wins; a hand-off on a computer already set up only adds the display', () => {
    const saved = roles.normalizeRoles({ print: true, display: false, name: 'Desk', setupDone: true });
    assert.equal(roles.decideStartRoles({ saved, handoff: null, printerData: true }).source, 'file');
    const d = roles.decideStartRoles({ saved, handoff: { name: 'Sound room' }, printerData: true });
    assert.deepEqual(d.roles, { print: true, display: true, name: 'Desk', setupDone: true });
    const wizardPending = roles.normalizeRoles({ setupDone: false });
    assert.equal(roles.decideStartRoles({ saved: wizardPending, handoff: null, printerData: true }).source, 'file');
  });
});

describe('the file', () => {
  it('round-trips, cleans what it is given, and reads a damaged file from its backup', () => {
    const dir = tmp();
    assert.equal(roles.readRoles(dir), null);
    roles.writeRoles(dir, { print: 'yes', display: true, name: '  Sound\n room  ', setupDone: true, extra: 1 });
    assert.deepEqual(roles.readRoles(dir), { print: false, display: true, name: 'Sound room', setupDone: true });
    roles.writeRoles(dir, { print: true, display: true, name: 'Both', setupDone: true });
    fs.writeFileSync(path.join(dir, 'roles.json'), '{"print": tr');
    assert.deepEqual(roles.readRoles(dir), { print: false, display: true, name: 'Sound room', setupDone: true });
    assert.equal(roles.cleanName('x'.repeat(200)).length, roles.NAME_MAX);
  });
});

describe('checkRolesChange', () => {
  const both = roles.normalizeRoles({ print: true, display: true, setupDone: true });
  it('needs at least one role once set up', () => {
    assert.equal(roles.checkRolesChange(both, { print: false, display: false }).ok, false);
    assert.equal(roles.checkRolesChange(roles.normalizeRoles({}), { name: 'x' }).ok, true);
  });
  it('refuses turning the print server off while it prints', () => {
    const r = roles.checkRolesChange(both, { print: false }, { printing: true });
    assert.equal(r.ok, false);
    assert.match(r.error, /printing/);
    assert.deepEqual(roles.checkRolesChange(both, { print: false }).roles, { print: false, display: true, name: '', setupDone: true });
  });
});

describe('package.json', () => {
  it('keeps the identity that keeps the check-in laptop\'s data: name, appId, and NO top-level productName', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    // Electron's userData folder is the top-level productName when there is
    // one, else "name"; electron-builder's per-user install folder is "name".
    // A top-level productName would move userData to %APPDATA%\KVBC Awana
    // and orphan the laptop's roster, history and settings.
    assert.equal(pkg.name, 'awana-label-printer');
    assert.equal(pkg.productName, undefined);
    assert.equal(pkg.build.appId, 'com.kvbc.awana-label-printer');
    assert.equal(pkg.build.publish.url, 'https://awana.kvbchurch.org/updates/printer/');
  });
});
