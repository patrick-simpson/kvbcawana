'use strict';
// The update state machine (src/update-state.js) and what each state tells
// /settings through the device-sync report (src/update-progress.js).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createUpdateState, transition, initialState, DOWNLOAD_ERROR } = require('../src/update-state');
const { createProgress, createAppReport, updateStateName } = require('../src/update-progress');

const machine = () => createUpdateState({ progress: createProgress({ now: () => 0 }) });
// A download that started and then failed: the one case that sets `error`.
function failedDownload() {
  const m = machine();
  m.apply('checking');
  m.apply('available', { version: '9.5.0' });
  m.apply('progress', { percent: 40, transferred: 68e6, total: 170e6, bytesPerSecond: 2e6 });
  m.apply('error');
  return m;
}
// What the Worker is told about this state.
const reported = (m) => createAppReport({ now: () => 0 }).read('9.4.0', m.state).app.update;

describe('update state machine', () => {
  it('starts idle and reports none', () => {
    const m = machine();
    assert.deepEqual(m.state, initialState());
    assert.deepEqual(reported(m), { state: 'none', percent: null, at: '1970-01-01T00:00:00.000Z' });
  });

  it('a failed download is an error: message, nothing downloading, no progress left', () => {
    const m = failedDownload();
    assert.equal(m.state.error, DOWNLOAD_ERROR);
    assert.equal(m.state.available, null);
    assert.equal(m.state.percent, null);
    assert.equal(m.state.progressLine, null);
    assert.equal(m.state.progressDetail, null);
    assert.equal(m.state.checking, false);
    assert.equal(reported(m).state, 'error');
    assert.equal(reported(m).percent, null);
  });

  it('error then not-available: up to date, no error', () => {
    const m = failedDownload();
    m.apply('not-available');
    assert.equal(m.state.error, null);
    assert.equal(m.state.upToDate, true);
    assert.equal(m.state.checking, false);
    assert.equal(reported(m).state, 'none');
    assert.equal(updateStateName(m.state), 'none');
  });

  it('error then checking: checking, error gone', () => {
    const m = failedDownload();
    m.apply('checking');
    assert.equal(m.state.checking, true);
    assert.equal(m.state.error, null);
    assert.equal(reported(m).state, 'none');
  });

  it('error then available: downloading again, error gone', () => {
    const m = failedDownload();
    m.apply('checking');
    m.apply('available', { version: '9.5.0' });
    assert.equal(m.state.available, '9.5.0');
    assert.equal(m.state.error, null);
    assert.equal(m.state.upToDate, false);
    assert.equal(reported(m).state, 'downloading');
    m.apply('progress', { percent: 12.4 });
    assert.deepEqual([m.state.percent, reported(m).percent], [12, 12]);
    assert.match(m.state.progressLine, /^Downloading update 12%/);
  });

  it('error then downloaded: ready, error gone, progress gone', () => {
    const m = failedDownload();
    m.apply('downloaded', { version: '9.5.0' });
    assert.equal(m.state.downloaded, '9.5.0');
    assert.equal(m.state.error, null);
    assert.equal(m.state.percent, null);
    assert.equal(m.state.progressLine, null);
    assert.equal(reported(m).state, 'ready');
    assert.equal(reported(m).percent, null);
  });

  it('error with the download event missing (downloaded straight after the error) still reads ready', () => {
    const m = failedDownload();
    m.apply('downloaded', { version: '9.5.0' });
    m.apply('not-available');
    assert.equal(m.state.error, null);
    assert.equal(updateStateName(m.state), 'ready');
  });

  it('an error while only checking (offline) stays silent', () => {
    const m = machine();
    m.apply('checking');
    m.apply('error');
    assert.equal(m.state.error, null);
    assert.equal(m.state.checking, false);
    assert.equal(m.state.available, null);
    assert.equal(m.state.upToDate, false);
    assert.equal(reported(m).state, 'none');
  });

  it('an offline check does not erase an up-to-date answer or a ready update', () => {
    const m = machine();
    m.apply('checking');
    m.apply('not-available');
    m.apply('checking');
    m.apply('error');
    assert.equal(m.state.upToDate, true);
    const r = machine();
    r.apply('available', { version: '9.5.0' });
    r.apply('downloaded', { version: '9.5.0' });
    r.apply('checking');
    r.apply('error');
    assert.equal(r.state.downloaded, '9.5.0');
    assert.equal(reported(r).state, 'ready');
  });

  it('progress flows through: percent, lines, and the repaint answer', () => {
    const m = machine();
    m.apply('available', { version: '9.5.0' });
    assert.equal(m.apply('progress', { percent: 10 }).repaint, true);
    assert.equal(m.state.percent, 10);
    assert.equal(m.state.progressDetail, 'Downloading update 10%');
    assert.equal(m.apply('progress', { percent: 10 }).repaint, false);
  });

  it('not-available clears a half-shown download too', () => {
    const m = machine();
    m.apply('available', { version: '9.5.0' });
    m.apply('progress', { percent: 30 });
    m.apply('not-available');
    assert.equal(m.state.available, null);
    assert.equal(m.state.percent, null);
    assert.equal(m.state.progressLine, null);
  });

  it('the status window check: requested forgets up to date, failed stops the spinner quietly', () => {
    const m = machine();
    m.apply('checking');
    m.apply('not-available');
    m.apply('check-requested');
    assert.equal(m.state.upToDate, false);
    m.apply('checking');
    m.apply('check-failed');
    assert.equal(m.state.checking, false);
    assert.equal(m.state.error, null);
    assert.equal(m.state.upToDate, false);
  });

  it('transition is pure and ignores unknown events', () => {
    const before = initialState();
    const frozen = Object.freeze({ ...before });
    const next = transition(frozen, 'checking');
    assert.equal(next.checking, true);
    assert.equal(frozen.checking, false);
    assert.deepEqual(transition(frozen, 'nonsense'), before);
  });

  it('keeps one state object, updated in place (main.js hands it around by reference)', () => {
    const m = machine();
    const ref = m.state;
    m.apply('checking');
    m.apply('available', { version: '9.5.0' });
    assert.equal(m.state, ref);
    assert.equal(ref.available, '9.5.0');
  });
});

describe('main.js wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  it('every updater event goes through the machine; main.js sets no update field itself', () => {
    assert.match(main, /require\('\.\/src\/update-state'\)/);
    for (const ev of ['checking', 'available', 'not-available', 'progress', 'downloaded', 'error', 'check-requested', 'check-failed']) {
      assert.match(main, new RegExp(`updateMachine\\.apply\\('${ev}'`), ev);
    }
    assert.doesNotMatch(main, /updateState\.(checking|available|upToDate|error|percent|progress\w*) = /);
    assert.doesNotMatch(main, /updateState\.downloaded = /);
  });
});
