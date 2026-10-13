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
    assert.match(main, /updateMachine\.apply\('downloaded', info\);[\s\S]*?scheduleAutoInstall\(info\);/);
  });
});

describe("this computer's app on /settings", () => {
  const { createAppReport, appReportMoved, updateStateName, UPDATE_STATES } = require('../src/update-progress');
  const idle = { checking: false, available: null, downloaded: null, percent: null, error: null };

  it('the update in one word, the states the Worker allows (lobby/src/lib/syncSpecs.js APP_UPDATE_STATES)', async () => {
    assert.equal(updateStateName(idle), 'none');
    assert.equal(updateStateName({ ...idle, available: '9.5.0', percent: 42 }), 'downloading');
    assert.equal(updateStateName({ ...idle, available: '9.5.0', downloaded: '9.5.0' }), 'ready');
    assert.equal(updateStateName({ ...idle, error: 'The update could not finish downloading. It will try again soon.' }), 'error');
    assert.equal(updateStateName(null), 'none');
    const { APP_UPDATE_STATES } = await import('../../../lobby/src/lib/syncSpecs.js');
    assert.deepEqual([...UPDATE_STATES], [...APP_UPDATE_STATES]);
  });

  it('the running version, the state, the percent only while downloading, and when the state began', async () => {
    let t = Date.parse('2026-10-12T15:00:00Z');
    const r = createAppReport({ now: () => t });
    assert.deepEqual(r.read('9.4.0', idle), { app: { version: '9.4.0', update: { state: 'none', percent: null, at: '2026-10-12T15:00:00.000Z' } } });
    t += 60000;
    const down = r.read('9.4.0', { ...idle, available: '9.5.0', percent: 42.6 });
    assert.deepEqual(down.app.update, { state: 'downloading', percent: 43, at: '2026-10-12T15:01:00.000Z' });
    t += 60000;
    assert.equal(r.read('9.4.0', { ...idle, available: '9.5.0', percent: 60 }).app.update.at, '2026-10-12T15:01:00.000Z', 'same state, same start');
    assert.equal(r.read('9.4.0', { ...idle, available: '9.5.0', percent: null }).app.update.percent, 0);
    // Exactly what the Worker keeps.
    const { sanitizeScreenStatus } = await import('../../../lobby/src/lib/syncSpecs.js');
    assert.deepEqual(sanitizeScreenStatus('computer', down), down);
    const ready = r.read('9.4.0', { ...idle, available: '9.5.0', downloaded: '9.5.0' });
    assert.deepEqual(sanitizeScreenStatus('computer', ready), ready);
  });

  it('worth an early hello: a new state, a new version, or ten points; nothing sent yet counts', () => {
    const at = (state, percent = null, version = '9.4.0') => ({ app: { version, update: { state, percent, at: null } } });
    assert.equal(appReportMoved(null, at('none')), true);
    assert.equal(appReportMoved(at('none'), at('none')), false);
    assert.equal(appReportMoved(at('none'), at('downloading', 0)), true);
    assert.equal(appReportMoved(at('downloading', 40), at('downloading', 49)), false);
    assert.equal(appReportMoved(at('downloading', 40), at('downloading', 50)), true);
    assert.equal(appReportMoved(at('downloading', 99), at('ready')), true);
    assert.equal(appReportMoved(at('none'), at('none', null, '9.5.0')), true);
    assert.equal(appReportMoved(at('none'), null), false);
  });
});
