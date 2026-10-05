// A forgotten preview or an open Settings panel no longer pins the kiosk:
// idleWatch() hands the room back after a quiet stretch. Also the wake lock's
// re-acquire and the sync index's retry schedule (source pins: both are
// browser APIs jsdom does not model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootKiosk, pinClock, tick, DEFAULT_NOW } from './kiosk-dom.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = readFileSync(path.join(here, '..', 'public', 'src', 'schedule.js'), 'utf8');
const SYNC = readFileSync(path.join(here, '..', 'public', 'src', 'sync.js'), 'utf8');
const MIN = 60 * 1000;
const ANSWERED = { 'journey.captions': 'off' };

test('the Settings panel left open closes after 15 quiet minutes, and activity resets the clock', async () => {
  const kiosk = bootKiosk({}, ANSWERED);
  const { window } = kiosk;
  try {
    pinClock(window, DEFAULT_NOW);
    window.noteActivity();   // the last touch was "now", on the pinned clock
    await tick();
    const panel = window.document.getElementById('settings-panel');
    window.openSettingsPanel();
    assert.equal(panel.classList.contains('hidden'), false, 'the panel opened');
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 10 * MIN)), JSON.stringify([]), 'ten quiet minutes: still open');
    assert.equal(panel.classList.contains('hidden'), false);
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 16 * MIN)), JSON.stringify(['settings']));
    assert.equal(panel.classList.contains('hidden'), true, 'closed after 15 quiet minutes');
    // a tap keeps it open
    window.openSettingsPanel();
    window.Date.now = () => DEFAULT_NOW + 14 * MIN;
    window.noteActivity();
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 28 * MIN)), JSON.stringify([]), 'activity 14 minutes in: not idle yet');
    assert.equal(panel.classList.contains('hidden'), false);
  } finally {
    kiosk.close();
  }
});

test('a PAUSED preview left for 20 minutes hands the room back; a playing one is never cut', async () => {
  const kiosk = bootKiosk({}, ANSWERED);
  const { window } = kiosk;
  try {
    pinClock(window, DEFAULT_NOW);
    window.noteActivity();   // the last touch was "now", on the pinned clock
    await tick();
    const journeyView = window.document.getElementById('journey-view');
    const video = window.document.getElementById('journey-video');
    window.startPreview('https://cdn.example/week-3-student.mp4', 'Lesson 3', null, 3);
    assert.equal(journeyView.classList.contains('hidden'), false, 'the preview is up');
    Object.defineProperty(video, 'paused', { value: false, configurable: true });
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 45 * MIN)), JSON.stringify([]), 'playing: left alone however long');
    Object.defineProperty(video, 'paused', { value: true, configurable: true });
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 10 * MIN)), JSON.stringify([]), 'paused ten minutes: still theirs');
    assert.equal(JSON.stringify(window.idleWatch(DEFAULT_NOW + 21 * MIN)), JSON.stringify(['preview']));
    assert.equal(journeyView.classList.contains('hidden'), true, 'at noon the room is the Check-in Display again');
    assert.match(SRC, /setInterval\(idleWatch, 60 \* 1000\);/);
  } finally {
    kiosk.close();
  }
});

test('the wake lock asks again when released, and every five minutes while there is none', () => {
  assert.match(SRC, /wakeLock\.addEventListener\('release', \(\) => \{ setTimeout\(requestWakeLock, 2000\); \}, \{ once: true \}\);/);
  assert.match(SRC, /setInterval\(\(\) => \{ if \(!wakeLock \|\| wakeLock\.released\) requestWakeLock\(\); \}, 5 \* 60 \* 1000\);/);
});

test('sync: the index is retried with backoff until read, and every request has a timeout', () => {
  // sync.js is its own classic script, loaded after schedule.js; the harness
  // boots schedule.js alone, so its schedule is lifted out of the source.
  const m = /function indexRetryWait\(n\) \{[^}]*\}/.exec(SYNC);
  assert.ok(m, 'indexRetryWait is defined');
  const wait = new Function(m[0] + '; return indexRetryWait;')();
  assert.deepEqual([0, 1, 2, 3, 4, 8].map(wait), [15000, 30000, 60000, 120000, 240000, 300000]);
  assert.match(SYNC, /function readIndex\(\) \{[\s\S]*?setTimeout\(readIndex, indexRetryWait\(attempt\+\+\)\);/);
  assert.match(SYNC, /var REQUEST_TIMEOUT_MS = 8000;/);
  assert.equal((SYNC.match(/AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/g) || []).length, 2, 'the index read and every request');
});
