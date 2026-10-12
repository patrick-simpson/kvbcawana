'use strict';
// Update download progress text and throttle (src/update-progress.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createProgress, formatProgress, formatSizes, formatTimeLeft } = require('../src/update-progress');

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe('formatSizes', () => {
  it('says MB for installer-sized files, whole numbers', () => {
    assert.equal(formatSizes(71 * MB, 170 * MB), '71 of 170 MB');
  });
  it('uses one decimal under 10 MB and GB at a gigabyte', () => {
    assert.equal(formatSizes(1.5 * MB, 4 * MB), '1.5 of 4 MB');
    assert.equal(formatSizes(0.9 * GB, 1.4 * GB), '0.9 of 1.4 GB');
  });
  it('is empty when the total is unknown', () => {
    assert.equal(formatSizes(5, 0), '');
    assert.equal(formatSizes(5, undefined), '');
  });
  it('never shows more than the total', () => {
    assert.equal(formatSizes(200 * MB, 170 * MB), '170 of 170 MB');
  });
});

describe('formatTimeLeft', () => {
  it('about N min left', () => {
    assert.equal(formatTimeLeft(0, 180 * MB, 1 * MB), 'about 3 min left');
  });
  it('less than a minute', () => {
    assert.equal(formatTimeLeft(100 * MB, 170 * MB, 5 * MB), 'less than a minute left');
  });
  it('hours for very slow links', () => {
    assert.equal(formatTimeLeft(0, 170 * MB, 20 * 1024), 'about 2.4 hr left');
  });
  it('unknown speed says nothing', () => {
    assert.equal(formatTimeLeft(1, 100, 0), '');
  });
});

describe('formatProgress', () => {
  const p = { percent: 41.7, transferred: 71 * MB, total: 170 * MB, bytesPerSecond: 1 * MB };
  it('the tray line', () => {
    assert.equal(formatProgress(p, false), 'Downloading update 42% (71 of 170 MB)');
  });
  it('the window line adds time left', () => {
    assert.equal(formatProgress(p, true), 'Downloading update 42% (71 of 170 MB, about 2 min left)');
  });
  it('survives a bare or odd payload', () => {
    assert.equal(formatProgress({}, false), 'Downloading update 0%');
    assert.equal(formatProgress({ percent: 250 }, false), 'Downloading update 100%');
    assert.equal(formatProgress({ percent: 'x' }, false), 'Downloading update 0%');
  });
});

describe('createProgress throttle', () => {
  it('repaints the first tick, then at most once a second', () => {
    let t = 1000;
    const pr = createProgress({ now: () => t });
    assert.equal(pr.active(), false);
    assert.equal(pr.line(), null);
    assert.equal(pr.update({ percent: 1, transferred: 1, total: 100 }), true);
    t += 100;
    assert.equal(pr.update({ percent: 2, transferred: 2, total: 100 }), false);
    assert.equal(pr.percent(), 2, 'state still follows every tick');
    t += 950;
    assert.equal(pr.update({ percent: 3, transferred: 3, total: 100 }), true);
  });
  it('skips a repaint when the percent has not moved', () => {
    let t = 0;
    const pr = createProgress({ now: () => t });
    pr.update({ percent: 10 });
    t += 5000;
    assert.equal(pr.update({ percent: 10 }), false);
  });
  it('always repaints reaching 100', () => {
    let t = 0;
    const pr = createProgress({ now: () => t });
    pr.update({ percent: 98 });
    t += 10;
    assert.equal(pr.update({ percent: 100 }), true);
  });
  it('reset clears it for the next download', () => {
    const pr = createProgress({ now: () => 0 });
    pr.update({ percent: 50 });
    pr.reset();
    assert.equal(pr.active(), false);
    assert.equal(pr.percent(), null);
    assert.equal(pr.update({ percent: 1 }), true);
  });
});

describe('main.js wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  it('uses the module, and the install timing is untouched', () => {
    assert.match(main, /require\('\.\/src\/update-progress'\)/);
    assert.match(main, /autoUpdater\.on\('download-progress'/);
    assert.match(main, /Update ready, restarting\.\.\./);
    assert.match(main, /updateState\.downloaded = info\.version;[\s\S]*?scheduleAutoInstall\(info\);/);
  });
});
