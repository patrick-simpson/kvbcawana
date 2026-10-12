'use strict';
// The print station's tray text (src/station.js) and how main.js wires the
// station (pinned at the source, as main-wiring.test.cjs does for the roles).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { stationSummary, stationMenuItems, importResultText } = require('../src/station');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

describe('the station in the tray', () => {
  it('says nothing until it is a station', () => {
    assert.equal(stationSummary({ station: 'off', history: 'locked', check: 0 }), '');
    assert.deepEqual(stationMenuItems({ station: 'off', history: 'locked', check: 0 }), []);
  });

  it('a computer that cannot keep a key safely says so and offers nothing', () => {
    const items = stationMenuItems({ station: 'refused', error: 'This computer cannot keep a secret key safely', history: 'locked', check: 0 });
    assert.match(items[0].label, /cannot be a print station/);
    assert.ok(items.every((i) => !i.action));
    assert.match(stationSummary({ station: 'refused' }), /refused/);
  });

  it('signed out offers the wizard; waiting just waits', () => {
    assert.equal(stationMenuItems({ station: 'signed-out' })[0].action, 'wizard');
    assert.ok(stationMenuItems({ station: 'waiting' }).every((i) => i.enabled === false));
  });

  it('a ready station offers the import, and only once the history key is open', () => {
    const ready = stationMenuItems({ station: 'ready', history: 'ready', check: 0 });
    const imp = ready.find((i) => i.action === 'import-history');
    assert.equal(imp.enabled, true);
    const locked = stationMenuItems({ station: 'ready', history: 'locked', check: 0 });
    assert.equal(locked.find((i) => i.action === 'import-history').enabled, false);
    assert.equal(locked.find((i) => i.action === 'wizard').action, 'wizard');
    const none = stationMenuItems({ station: 'ready', history: 'none', check: 0 });
    assert.match(none.find((i) => /no history key/.test(i.label)).label, /no history key yet/);
  });

  it('CHECK THE PRINTER is a click away from cleared, and shows in the summary', () => {
    const items = stationMenuItems({ station: 'ready', history: 'ready', check: 2 });
    const warn = items.find((i) => i.action === 'clear-check');
    assert.match(warn.label, /Check the printer: 2 labels may not have come out/);
    assert.match(stationMenuItems({ station: 'ready', history: 'ready', check: 1 }).find((i) => i.action === 'clear-check').label, /a label may not/);
    assert.equal(stationSummary({ station: 'ready', history: 'ready', check: 1 }), 'Cloud printing: CHECK THE PRINTER');
    assert.equal(stationMenuItems({ station: 'ready', history: 'ready', check: 0 }).some((i) => i.action === 'clear-check'), false);
  });

  it('the import result is in plain words', () => {
    assert.match(importResultText({ ok: true, rows: 12, stored: 10, duplicates: 2 }), /Imported 12 records \(10 new, 2 already there\)/);
    assert.match(importResultText({ ok: true, rows: 0 }), /nothing on this laptop/);
    assert.match(importResultText({ ok: false, missing: true, error: 'x' }), /cannot take the import yet/);
    assert.equal(importResultText({ ok: false, error: 'This computer is not signed in.' }), 'This computer is not signed in.');
  });
});

describe('main.js wires the station safely', () => {
  it('the station key lives only in safeStorage: the module is handed it and nothing else', () => {
    assert.match(main, /createStationKeys\(\{\n\s+dir: userData, safeStorage,/);
    assert.doesNotMatch(main, /station-key\.bin|privateJwk/);
  });

  it('the key is made first, a refusal stops everything, and cloud mode starts only after a good registration', () => {
    const fn = main.slice(main.indexOf('async function ensureStation()'), main.indexOf('/** The passphrase is at hand'));
    const ensure = fn.indexOf('stationKeys.ensure()');
    const refused = fn.indexOf("setStation({ state: 'refused'");
    const register = fn.indexOf('stationKeys.register(');
    const cloud = fn.indexOf('serverModule.configureCloud(');
    assert.ok(ensure > 0 && refused > ensure && register > refused && cloud > register);
    assert.match(fn, /if \(!k\.ok\) \{ setStation\(\{ state: 'refused', error: k\.error \}\); return; \}/);
    assert.match(fn, /if \(!r\.ok\) \{[^\n]*return; \}\n\s+if \(serverModule && serverModule\.configureCloud/);
  });

  it('only the print role starts it, and there is no pairing step', () => {
    assert.match(main, /async function ensureStation\(\) \{\n  if \(!roles\.print \|\| !stationKeys/);
    assert.match(main, /startServer\(config\);\n  buildTray\(config\);\n  startStationLoop\(\);/);
    assert.doesNotMatch(main, /pair(ing)? ?code/i);
  });

  it('the history key is opened with the passphrase at setup, then the passphrase is dropped', () => {
    assert.match(main, /unlockHistoryKey\(pendingPassphrase\)/);
    assert.match(main, /pendingPassphrase = null;\n  \/\/ A new sign-in/);
  });

  it('the tray offers the import and the check-printer clear through the server module', () => {
    assert.match(main, /serverModule\.importLaptopHistory\(\)/);
    assert.match(main, /serverModule\.clearCheckThePrinter\(\)/);
  });
});
