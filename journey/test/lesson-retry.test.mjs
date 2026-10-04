// A kiosk that could not read its lesson, or whose bundle download stalled.
//
// Before: a failed current-lesson.json read at boot was tried again an hour
// later (a kiosk booted at 6:20 with one hiccup showed the placeholder all
// night), and a bundle download whose body stalled held the in-flight latch
// for the life of the page, so nothing was ever cached again.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { bootKiosk, installCaches, pinClock, tick } from './kiosk-dom.mjs';

const SRC = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'src', 'schedule.js'), 'utf8');
const CURRENT = { week: 1, title: 'Lesson 1', downloadUrl: 'https://cdn.example/student-1-original.mp4', transcodedAt: '2026-10-01T00:00:00Z' };
const ROUTES = { 'current-lesson.json': { json: CURRENT } };
const ANSWERED = { 'journey.captions': 'off' };

test('the lesson is retried soon, not in an hour: 15 s, 30 s, 60 s, then every five minutes', () => {
  const kiosk = bootKiosk({ 'current-lesson.json': { status: 503 } }, ANSWERED);
  try {
    const { lessonRetryWait } = kiosk.window;
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(lessonRetryWait), [15000, 30000, 60000, 300000, 300000, 300000]);
    // The read itself has a deadline, and a failed first read books a retry.
    assert.match(SRC, /fetchWithTimeout\('current-lesson\.json', \{ cache: 'no-store' \}, 15000\)/);
    assert.match(SRC, /if \(!currentLesson\) \{[\s\S]*?scheduleLessonRetry\(\);/);
  } finally {
    kiosk.close();
  }
});

test('a lesson once read is remembered, and stands in when the next boot cannot read one', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  try {
    await tick(); await tick(); await tick();
    const remembered = JSON.parse(kiosk.window.localStorage.getItem('journey.lastLesson'));
    assert.equal(remembered.week, 1);
    assert.equal(remembered.downloadUrl, CURRENT.downloadUrl);
  } finally {
    kiosk.close();
  }

  // Next boot: the network is down. The remembered lesson is what the page
  // starts from (its bundle is most likely already cached), and the retries run.
  const offline = bootKiosk({ 'current-lesson.json': { status: 503 } }, { ...ANSWERED, 'journey.lastLesson': JSON.stringify(CURRENT) });
  try {
    await tick(); await tick(); await tick();
    assert.equal(JSON.stringify(offline.window.lastKnownLesson()), JSON.stringify(CURRENT));
    assert.match(SRC, /const last = lastKnownLesson\(\);\s*if \(last\) \{ currentLesson = last; cacheLessonBundle\(last\); \}/);
  } finally {
    offline.close();
  }
});

test('a bundle download that stalls does not hold the latch for the life of the page', async () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const { window } = kiosk;
  try {
    installCaches(window);
    await tick();
    // The video never arrives: a fetch that hangs, as a body that stalls does.
    const realFetch = window.fetch;
    let hung = 0;
    window.fetch = (url, options = {}) => {
      if (/\.mp4/.test(String(url))) { hung += 1; return new Promise(() => {}); }
      return realFetch(url, options);
    };
    const settle = async (want) => { for (let i = 0; i < 50 && hung < want; i++) await tick(); };
    window.cacheLessonBundle(CURRENT);   // hangs on the video
    await settle(1);
    assert.equal(hung, 1);
    await window.cacheLessonBundle(CURRENT);            // the latch holds: nothing new is fetched
    await settle(2);
    assert.equal(hung, 1);
    // Sixteen minutes later (the kiosk's clock, pinned by the harness) the
    // latch is not believed any more, and the next refresh caches again.
    pinClock(window, window.Date.now() + 16 * 60 * 1000);
    window.cacheLessonBundle(CURRENT);
    await settle(2);
    assert.equal(hung, 2);
  // Each file also has its own deadline, headers and body together.
  assert.match(SRC, /const BUNDLE_FILE_MS = 3 \* 60 \* 1000;/);
  assert.match(SRC, /const response = await fetch\(fetchUrl, controller \? \{ signal: controller\.signal \} : \{\}\);/);
    assert.match(SRC, /await cache\.put\(cacheKey, response\);[\s\S]*?finally \{\s*if \(deadline\) clearTimeout\(deadline\);/);
  } finally {
    kiosk.close();
  }
});
