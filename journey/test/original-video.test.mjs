// What every screen plays: Awana's original, on the kiosk PC, a Mac and a
// phone alike (the Pi and its low-power profile were removed 2026-10-12).
// Driven through the real page wherever there is a control to press, because
// the wiring is the part that has broken before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, installCaches, tick, DESKTOP } from './kiosk-dom.mjs';

const LESSONS = {
  version: 1,
  lessons: [
    {
      week: 1,
      unit: 1,
      lesson: 1,
      title: 'Unit 1, Lesson 1: Apologetics',
      downloadUrl: 'https://clubs.awana.org/student-1.mp4',
      leaderDownloadUrl: 'https://clubs.awana.org/leader-1.mp4',
      captions: { student: true, leader: true },
    },
  ],
};

// The steady state: the nightly transcode has run, so downloadUrl is the small
// same-origin copy and sourceUrl is still Awana's own CORS-friendly original,
// which is what plays.
const CURRENT = {
  version: 2,
  week: 1,
  title: 'Unit 1, Lesson 1: Apologetics',
  sourceUrl: 'https://cdn.awana.example/student-1-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
  resolvedAt: '2026-09-15T03:00:00Z',
};

const ROUTES = {
  'lessons.json': { json: LESSONS },
  'current-lesson.json': { json: CURRENT },
};

// cacheLessonBundle() fetches the video, both transcripts, the prep
// transcripts, the handout and the slides; a 404 is "legitimately missing,
// skip". These routes make the video (both copies) and one transcript real,
// so what is stored is what the page chose to store.
const BUNDLE_ROUTES = {
  ...ROUTES,
  'current-lesson-video.mp4': { text: 'transcoded bytes' },
  'student-1-original.mp4': { text: 'original bytes' },
  'transcripts/week-01-student.vtt': { text: 'WEBVTT' },
};

// The caption prompt asks once per device and would otherwise sit in front of
// every playback path here; a kiosk that has been used before has answered.
const ANSWERED = { 'journey.captions': 'off' };

const PHONE = {
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};

test('the embedded display is the plain lobby URL, never ?lowPower=1, and is not rewritten', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const frame = kiosk.document.getElementById('checkin-frame');
  assert.equal(frame.getAttribute('src'), '../lobby/');
  kiosk.close();
});

test('Settings has no playback-quality switch, and an old saved choice is ignored', async () => {
  const kiosk = bootKiosk(ROUTES, { ...ANSWERED, 'journey.playback.quality': 'low' });
  const { document } = kiosk;
  document.getElementById('settings-btn').click();
  for (const id of ['pi-mode-switch', 'quality-auto', 'quality-auto-note', 'quality-status', 'settings-quality']) {
    assert.equal(document.getElementById(id), null, `#${id} is gone`);
  }
  assert.equal(document.getElementById('journey-splash-quality'), null);
  // A kiosk that once saved "low" still plays the original.
  await tick();
  kiosk.window.setView('journey');
  document.getElementById('journey-splash-play-btn').click();
  await tick();
  await tick();
  assert.equal(kiosk.video.getAttribute('src'), CURRENT.sourceUrl);
  kiosk.close();
});

for (const [name, device] of [['the kiosk PC', undefined], ['a Mac', DESKTOP], ['a phone', PHONE]]) {
  test(`the scheduled show plays the original on ${name}`, async () => {
    const kiosk = bootKiosk(ROUTES, ANSWERED, device);
    await tick();
    kiosk.window.setView('journey');
    kiosk.document.getElementById('journey-splash-play-btn').click();
    await tick();
    await tick();
    assert.equal(kiosk.video.getAttribute('src'), CURRENT.sourceUrl);
    kiosk.close();
  });
}

test('a lesson with no transcode yet still plays the original', async () => {
  const lesson = { ...CURRENT, downloadUrl: CURRENT.sourceUrl, transcodedAt: null };
  const kiosk = bootKiosk({ ...ROUTES, 'current-lesson.json': { json: lesson } }, ANSWERED);
  await tick();
  kiosk.window.setView('journey');
  kiosk.document.getElementById('journey-splash-play-btn').click();
  await tick();
  await tick();
  assert.equal(kiosk.video.getAttribute('src'), CURRENT.sourceUrl);
  kiosk.close();
});

test('the picker plays the original, with the Release copy as its one fallback', async () => {
  // Week 1 is the current lesson, so use the Leader Video: the Student side
  // has its own same-week cached-copy shortcut (video-source.test.mjs).
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  await pickLeaderVideo(kiosk);
  assert.equal(kiosk.video.getAttribute('src'), LESSONS.lessons[0].leaderDownloadUrl);
  kiosk.video.dispatchEvent(new kiosk.window.Event('error'));
  await tick();
  assert.match(kiosk.video.getAttribute('src'), /week-01-leader\.mp4$/);
  kiosk.close();
});

async function pickLeaderVideo(kiosk) {
  const { document } = kiosk;
  document.getElementById('settings-btn').click();
  await tick();
  document.querySelector('.settings-lesson-row').click();
  document.getElementById('settings-variant-leader').click();
  document.getElementById('settings-leader-video').click();
  await tick();
  await tick();
}

test('the original is cached under a quality-marked query key', () => {
  const kiosk = bootKiosk(ROUTES, ANSWERED);
  const key = kiosk.window.videoCacheKey(CURRENT);
  assert.equal(key, `${CURRENT.sourceUrl}?q=1080`);
  // The marker has to be a query, not a #fragment: the Cache API ignores
  // fragments when it matches, so '#1080' would be the same key as the plain
  // URL a 480p copy may have been stored under.
  assert.doesNotMatch(key, /#/);
  kiosk.close();
});

test('the bundle stores the original, never the 480p copy', async () => {
  const kiosk = bootKiosk(BUNDLE_ROUTES, ANSWERED);
  const kioskCaches = installCaches(kiosk.window);
  await kiosk.window.cacheLessonBundle(CURRENT);
  const videos = kioskCaches
    .keysIn('journey-videos-v1')
    .filter((url) => url.includes('.mp4'));
  assert.deepEqual(videos, [`${CURRENT.sourceUrl}?q=1080`]);
  kiosk.close();
});

test('an original that will not download costs the video and nothing else', async () => {
  // A cross-origin original served without CORS headers: fetch() rejects, and
  // this page can do nothing about it. The rest of the bundle must still be
  // stored, and last week's must still be evicted.
  const kiosk = bootKiosk(BUNDLE_ROUTES, ANSWERED);
  const { window } = kiosk;
  const caches = installCaches(window);
  const realFetch = window.fetch;
  window.fetch = (url, options) => {
    if (String(url) === CURRENT.sourceUrl) return Promise.reject(new TypeError('Failed to fetch'));
    return realFetch(url, options);
  };
  const cache = await window.caches.open('journey-videos-v1');
  await cache.put('https://example.test/stale-last-week.mp4', { ok: true });

  await window.cacheLessonBundle(CURRENT);
  const keys = caches.keysIn('journey-videos-v1');
  assert.equal(keys.includes('https://example.test/stale-last-week.mp4'), false, 'store-before-evict still evicts once the rest is in');
  assert.equal(keys.some((url) => url.includes('.mp4')), false, 'no video was storable');
  assert.equal(keys.length > 0, true, 'the transcripts and slides still cached');
  kiosk.close();
});
