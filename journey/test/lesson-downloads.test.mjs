// Settings "Download all lessons (full quality)" and the saved lessons it
// leaves on the kiosk PC (src/schedule/04-lesson-store.js,
// 26-lesson-downloads.js): the progress maths, the skip/resume rules, pinned
// copies that only the Delete button removes, and the saved copy playing
// FIRST (05-stream-first.js). Driven through the real panel wherever there is
// a button to press. The OPFS and the CDN are fakes (test/fake-opfs.mjs); the
// real browser pieces are checked in Chromium by lesson-downloads-layout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bootKiosk, installCaches, pinClock, tick, KIOSK_PC, DESKTOP } from './kiosk-dom.mjs';
import { installFakeOpfs, installFakeCdn, videoBytes } from './fake-opfs.mjs';

const CDN = 'https://cdn.example.test/';
const SIZES = { 1: 50, 2: 37, 3: 64 }; // bytes (chunks of 16 in these tests)
const LEADER_SIZES = { 1: 20, 2: 21 }; // week 3 has no Leader Video (like week 27)
const CHUNK = 16;

const lessonsJson = (sizes = SIZES) => ({
  version: 1,
  lessons: [1, 2, 3].map((week) => ({
    week,
    unit: 1,
    lesson: week,
    title: `Unit 1, Lesson ${week}: Name${week}`,
    downloadUrl: `https://clubs.awana.org/student-${week}.mp4`,
    leaderDownloadUrl: LEADER_SIZES[week] ? `https://clubs.awana.org/leader-${week}.mp4` : null,
    cdnUrl: `${CDN}student-${week}.mp4`,
    bytes: sizes[week],
    ...(LEADER_SIZES[week] ? { leaderCdnUrl: `${CDN}leader-${week}.mp4`, leaderBytes: LEADER_SIZES[week] } : {}),
    captions: { student: true, leader: true },
  })),
});

const CURRENT = {
  version: 2,
  week: 2,
  title: 'Unit 1, Lesson 2: Name2',
  sourceUrl: 'https://clubs.awana.org/student-2.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: null,
  resolvedAt: '2026-10-01T00:00:00Z',
};

const FILES = Object.fromEntries([
  ...Object.entries(SIZES).map(([w, n]) => [`${CDN}student-${w}.mp4`, videoBytes(n, Number(w))]),
  ...Object.entries(LEADER_SIZES).map(([w, n]) => [`${CDN}leader-${w}.mp4`, videoBytes(n, 100 + Number(w))]),
]);

const ANSWERED = { 'journey.captions': 'off' };
// Automatic mode is on by default; its first pass is pushed out of reach here
// (autoStartMs) so each test starts it only when it means to.
const FAST = { chunkBytes: CHUNK, retryMs: [5, 5, 5], stallMs: 60000, resumeAfterLoadMs: 20, yieldPollMs: 10, renderMs: 0, spaceMarginBytes: 0, autoStartMs: 1e9, autoRecheckMs: 1e9, autoTickMs: 1e9, statusMs: 0 };
const at = (h, m) => new Date(2026, 9, 7, h, m, 0).getTime(); // a Wednesday, local

const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms = 4000, what = 'condition') {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (check()) return;
    await wait(5);
  }
  assert.fail(`timed out waiting for ${what}`);
}

function boot({ prefs = {}, cdn = {}, opfs = {}, routes = {}, tuning = {}, pageUrl, sizes, now = null, device = KIOSK_PC } = {}) {
  let store = null;
  let cdnLog = null;
  const kiosk = bootKiosk(
    {
      'lessons.json': { json: lessonsJson(sizes) },
      'current-lesson.json': { json: CURRENT },
      ...routes,
    },
    { ...ANSWERED, ...prefs },
    device,
    (window) => {
      store = installFakeOpfs(window, opfs);
      cdnLog = installFakeCdn(window, CDN, FILES, cdn);
      window.journeyDownloadTuning = { ...FAST, ...tuning };
      if (now) pinClock(window, now);
      window.statusEvents = [];
      window.addEventListener('journey-download-status', (e) => window.statusEvents.push(e.detail));
    },
    pageUrl
  );
  return { ...kiosk, store, cdn: cdnLog, $: (id) => kiosk.document.getElementById(id) };
}

const saved = (store, id) => store.exists(`journey-lessons-v1/${id}/info.json`);
function joined(store, id) {
  const names = store.list(`journey-lessons-v1/${id}`).filter((n) => n.startsWith('c'));
  const parts = names.map((n) => store.read(`journey-lessons-v1/${id}/${n}`));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}
function seedSaved(store, id, bytes, { done = true, url, chunk = CHUNK, cut = null } = {}) {
  const pieces = Math.ceil(bytes.byteLength / chunk);
  for (let i = 0; i < pieces; i += 1) {
    let part = bytes.subarray(i * chunk, (i + 1) * chunk);
    if (cut !== null && i === cut) part = part.subarray(0, Math.max(0, part.byteLength - 3));
    store.put(`journey-lessons-v1/${id}/c${String(i).padStart(5, '0')}`, part);
  }
  store.put(`journey-lessons-v1/${id}/info.json`, JSON.stringify({ v: 1, url, bytes: bytes.byteLength, etag: '"v1"', chunk, done }));
}

async function openSettings(k) {
  k.$('settings-btn').click();
  await ticks(8);
  await until(() => k.window.journeyDownloads.items.length > 0, 2000, 'the plan');
}

/* ── The maths ── */

test('progress: real bytes, floored percent, 100% only when every video is saved', async () => {
  const k = boot();
  const { downloadProgress, downloadSummaryText, formatBytePair, formatTimeLeft, formatBytes } = k.window;
  const items = [
    { id: 'a', url: 'x', bytes: 100 },
    { id: 'b', url: 'x', bytes: 300 },
    { id: 'c', url: null, bytes: null }, // not downloadable: out of every number
  ];
  let p = downloadProgress(items, { a: { state: 'saved', have: 100, total: 100 }, b: { state: 'partial', have: 299, total: 300 } }, true);
  assert.deepEqual([p.count, p.saved, p.done, p.total, p.percent, p.position], [2, 1, 399, 400, 99, 2]);
  p = downloadProgress(items, { a: { state: 'saved', have: 100, total: 100 }, b: { state: 'saved', have: 300, total: 300 } }, false);
  assert.equal(p.percent, 100);
  p = downloadProgress(items, {}, false);
  assert.deepEqual([p.done, p.total, p.percent, p.position], [0, 400, 0, 0], 'sizes from lessons.json before anything arrives');

  const GB = 1024 ** 3;
  const line = downloadSummaryText({ count: 30, saved: 6, done: 3.1 * GB, total: 7.4 * GB, percent: 42, position: 7 }, 'running', (4.3 * GB) / (25 * 60));
  assert.equal(line, 'Video 7 of 30 · 42% · 3.1 of 7.4 GB · about 25 min left');
  assert.match(downloadSummaryText({ count: 30, saved: 6, done: 1, total: 2, percent: 50, position: 7 }, 'running', null), /working out the time left$/);
  assert.equal(formatBytePair(150 * 1024 * 1024, 300 * 1024 * 1024), '150 of 300 MB');
  assert.equal(formatBytes(5.6 * GB), '5.6 GB');
  assert.equal(formatTimeLeft(30), 'less than a minute left');
  assert.equal(formatTimeLeft(125 * 60), 'about 2 h 5 min left');
  assert.equal(formatTimeLeft(120 * 60), 'about 2 h left');
  k.close();
});

test('rate, Content-Range and the committed-bytes rule', () => {
  const k = boot();
  const { downloadRate, parseContentRange, committedLessonBytes } = k.window;
  const samples = [{ t: 0, bytes: 0 }, { t: 5000, bytes: 5000 }, { t: 10000, bytes: 20000 }];
  assert.equal(downloadRate(samples, 10000, 30000), 2000);
  assert.equal(downloadRate(samples.slice(0, 1), 10000, 30000), null, 'too little to say');
  assert.equal(downloadRate([{ t: 9000, bytes: 0 }, { t: 10000, bytes: 9 }], 10000, 30000), null, 'under 5 s');
  assert.deepEqual({ ...parseContentRange('bytes 100-199/1000') }, { start: 100, end: 199, total: 1000 });
  assert.equal(parseContentRange('bytes */1000'), null);
  assert.equal(parseContentRange(null), null);
  // 50 bytes in 16-byte pieces: 16,16,16,2.
  assert.equal(committedLessonBytes([16, 16, 16, 2], 50, 16), 50);
  assert.equal(committedLessonBytes([16, 16, 13, 2], 50, 16), 32, 'a short piece and everything after it is fetched again');
  assert.equal(committedLessonBytes([16, 0], 50, 16), 16);
  assert.equal(committedLessonBytes([], 50, 16), 0);
  k.close();
});

test('the plan: Student Videos from this week on, then Leaders; only lessons.json video files', () => {
  const k = boot();
  const { downloadPlan, lessonFileSource } = k.window;
  const lessons = lessonsJson().lessons;
  const plan = downloadPlan(lessons, { leaders: true, startWeek: 2 });
  assert.deepEqual(Array.from(plan, (i) => i.id), ['week-02-student', 'week-03-student', 'week-01-student', 'week-02-leader', 'week-01-leader']);
  assert.deepEqual(Array.from(downloadPlan(lessons, { leaders: false, startWeek: 1 }), (i) => i.id), ['week-01-student', 'week-02-student', 'week-03-student']);
  // Never anything but an https .mp4 named by lessons.json's cdn fields.
  assert.equal(lessonFileSource({ week: 1, cdnUrl: 'https://cdn.example/x.vtt' }, 'student'), null);
  assert.equal(lessonFileSource({ week: 1, cdnUrl: 'http://cdn.example/x.mp4' }, 'student'), null);
  assert.equal(lessonFileSource({ week: 1, downloadUrl: 'https://clubs.awana.org/x.mp4' }, 'student'), null, 'the clubs.awana.org address has no CORS: never downloaded');
  const noCdn = downloadPlan([{ week: 4, downloadUrl: 'https://clubs.awana.org/4.mp4' }], { leaders: false });
  assert.equal(noCdn[0].url, null);
  k.close();
});

test('the real lessons.json: every original has a browser-downloadable address and a size', () => {
  const { lessons } = JSON.parse(readFileSync(new URL('../public/lessons.json', import.meta.url), 'utf8'));
  let total = 0;
  for (const l of lessons) {
    assert.match(l.cdnUrl, /^https:\/\/[a-z0-9]+\.cloudfront\.net\/wp-content\/.+\.mp4$/, `week ${l.week}`);
    assert.equal(new URL(l.cdnUrl).pathname, new URL(l.downloadUrl).pathname, `week ${l.week}: same file as downloadUrl`);
    assert.ok(Number.isInteger(l.bytes) && l.bytes > 10e6, `week ${l.week} size`);
    total += l.bytes;
    if (l.leaderDownloadUrl) {
      assert.equal(new URL(l.leaderCdnUrl).pathname, new URL(l.leaderDownloadUrl).pathname, `week ${l.week} leader`);
      assert.ok(Number.isInteger(l.leaderBytes) && l.leaderBytes > 10e6);
      total += l.leaderBytes;
    } else {
      assert.equal(l.leaderCdnUrl, undefined, `week ${l.week}: no Leader Video, no address`);
    }
  }
  assert.ok(total > 5e9 && total < 20e9, `all originals ~9 GB (got ${total})`);
});

/* ── The panel and the download ── */

test('Download all lessons saves every video, one at a time, fetching nothing else', async () => {
  const k = boot();
  await openSettings(k);
  assert.equal(k.$('downloads-start-btn').classList.contains('hidden'), false);
  assert.match(k.$('downloads-summary').textContent, /^Nothing saved yet · 5 videos/);
  const before = k.fetchLog.length;
  k.$('downloads-start-btn').focus();
  k.$('downloads-start-btn').click();
  assert.equal(k.document.activeElement, k.$('downloads-pause-btn'), 'focus follows to Pause');
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  for (const [url, bytes] of Object.entries(FILES)) {
    const id = url.replace(CDN, '').replace(/^(student|leader)-(\d+)\.mp4$/, (_, role, w) => `week-${w.padStart(2, '0')}-${role}`);
    assert.ok(saved(k.store, id), `${id} saved`);
    assert.deepEqual(joined(k.store, id), bytes, `${id} byte for byte`);
  }
  assert.deepEqual(k.cdn.requests.map((r) => r.url.replace(CDN, '')), ['student-2.mp4', 'student-3.mp4', 'student-1.mp4', 'leader-2.mp4', 'leader-1.mp4']);
  assert.ok(k.cdn.requests.every((r) => r.cache === 'no-store' && r.range === null));
  const others = k.fetchLog.slice(before).filter((r) => !r.url.endsWith('lessons.json'));
  assert.deepEqual(others, [], 'the panel fetched nothing but lessons.json and the videos');
  await wait(5);
  assert.match(k.$('downloads-summary').textContent, /^All 3 lessons saved ✓ \(5 videos, 0 MB, on this computer\)$/);
  assert.match(k.$('downloads-status').textContent, /Every lesson now plays from this computer/);
  assert.equal(k.$('downloads-start-btn').disabled, true);
  assert.equal(k.window.localStorage.getItem('journey.downloads.run'), null);
  const rows = [...k.document.querySelectorAll('.downloads-row')];
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.dataset.state === 'saved'));
  k.close();
});

test('saved videos are skipped and a part-saved one resumes with a Range request', async () => {
  const k = boot();
  seedSaved(k.store, 'week-02-student', FILES[`${CDN}student-2.mp4`], { url: `${CDN}student-2.mp4` });
  // Week 3: pieces 0 and 1 whole, piece 2 cut short by an interruption.
  seedSaved(k.store, 'week-03-student', FILES[`${CDN}student-3.mp4`], { url: `${CDN}student-3.mp4`, done: false, cut: 2 });
  k.$('downloads-leaders').click(); // Student Videos only for this one
  await openSettings(k);
  const row = () => k.document.querySelector('.downloads-row[data-id="week-03-student"] .downloads-row-state').textContent;
  assert.equal(row(), 'Partly saved (50%)');
  k.$('downloads-start-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  assert.deepEqual(k.cdn.requests.map((r) => [r.url.replace(CDN, ''), r.range]), [
    ['student-3.mp4', 'bytes=32-'],
    ['student-1.mp4', null],
  ]);
  assert.deepEqual(joined(k.store, 'week-03-student'), FILES[`${CDN}student-3.mp4`]);
  assert.equal(k.store.exists('journey-lessons-v1/week-02-leader'), false, 'Leader Videos left out when unticked');
  assert.equal(k.window.localStorage.getItem('journey.downloads.leaders'), '0');
  k.close();
});

test('one video failing does not stop the rest; it is named plainly and retried next time', async () => {
  const k = boot({ cdn: { behave: (url) => (url.endsWith('student-3.mp4') ? { status: 503 } : null) } });
  await openSettings(k);
  k.$('downloads-start-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  assert.equal(k.cdn.requests.filter((r) => r.url.endsWith('student-3.mp4')).length, 4, 'tried, then 3 retries');
  assert.ok(saved(k.store, 'week-01-student') && saved(k.store, 'week-01-leader'), 'the videos after it still came');
  await wait(5);
  const row = k.document.querySelector('.downloads-row[data-id="week-03-student"]');
  assert.equal(row.dataset.state, 'failed');
  assert.match(row.textContent, /Failed: Awana’s server answered with an error \(503\)\. Will retry next time\./);
  assert.match(k.$('downloads-status').textContent, /except 1 video that could not be downloaded/);
  assert.equal(k.$('downloads-status').dataset.tone, 'bad');
  k.close();
});

test('pause keeps every finished piece; resume carries on from the next one', async () => {
  // Week 2 (37 bytes) sends 35 (two whole pieces and a bit) and then hangs.
  let hang = true;
  const k = boot({ cdn: { behave: (url) => (hang && url.endsWith('student-2.mp4') ? { stallAfter: 35 } : null) } });
  await openSettings(k);
  k.$('downloads-start-btn').click();
  await until(() => (k.window.journeyDownloads.files['week-02-student'] || {}).have === 35, 2000, 'bytes arriving');
  k.$('downloads-pause-btn').focus();
  k.$('downloads-pause-btn').click();
  assert.equal(k.document.activeElement, k.$('downloads-resume-btn'));
  assert.equal(k.window.localStorage.getItem('journey.downloads.run'), 'paused');
  await wait(20);
  assert.equal(k.$('downloads-resume-btn').classList.contains('hidden'), false);
  assert.match(k.$('downloads-summary').textContent, /^Paused · /);
  assert.deepEqual(k.store.list('journey-lessons-v1/week-02-student').filter((n) => n !== 'info.json').map((n) => k.store.read(`journey-lessons-v1/week-02-student/${n}`).byteLength), [16, 16, 0], 'two whole pieces kept, the third dropped');
  hang = false;
  k.$('downloads-resume-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  assert.equal(k.cdn.requests.filter((r) => r.url.endsWith('student-2.mp4')).at(-1).range, 'bytes=32-');
  assert.deepEqual(joined(k.store, 'week-02-student'), FILES[`${CDN}student-2.mp4`]);
  k.close();
});

test('a run interrupted by a reload carries on by itself; a paused one waits', async () => {
  const k = boot({ prefs: { 'journey.downloads.run': 'running', 'journey.downloads.auto': '0' } });
  await until(() => saved(k.store, 'week-01-leader'), 4000, 'the resumed run');
  k.close();
  const p = boot({ prefs: { 'journey.downloads.run': 'paused' }, tuning: { autoStartMs: 10, autoTickMs: 10 } });
  await wait(60);
  assert.equal(p.cdn.requests.length, 0);
  await openSettings(p);
  assert.equal(p.$('downloads-resume-btn').classList.contains('hidden'), false);
  p.close();
});

test('the download gives way while a lesson video plays from the internet', async () => {
  const k = boot();
  await openSettings(k);
  k.video.classList.remove('hidden');
  k.video.setAttribute('src', 'https://clubs.awana.org/student-2.mp4');
  k.$('downloads-start-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'waiting', 2000, 'waiting');
  await wait(30);
  assert.equal(k.cdn.requests.length, 0, 'nothing downloaded under a streaming lesson');
  assert.match(k.$('downloads-status').textContent, /Waiting: a lesson video is playing from the internet/);
  k.video.removeAttribute('src');
  k.video.classList.add('hidden');
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  assert.ok(saved(k.store, 'week-01-leader'));
  k.close();
});

test('not enough disk space: says so plainly and does not start', async () => {
  const k = boot({ opfs: { quota: 100 } });
  await openSettings(k);
  k.$('downloads-start-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'idle', 2000, 'the refusal');
  await wait(5);
  assert.match(k.$('downloads-status').textContent, /^Not enough space: the videos still to download need/);
  assert.equal(k.cdn.requests.length, 0);
  k.close();
});

test('Delete asks first (focus on "keep"), and is the only thing that removes saved lessons', async () => {
  const k = boot();
  const cache = installCaches(k.window);
  seedSaved(k.store, 'week-02-student', FILES[`${CDN}student-2.mp4`], { url: `${CDN}student-2.mp4` });
  seedSaved(k.store, 'week-01-leader', FILES[`${CDN}leader-1.mp4`], { url: `${CDN}leader-1.mp4` });
  // The hourly bundle runs its store-before-evict over the Cache API: the
  // saved lessons are another store, and the saved week's video is not
  // downloaded a second time.
  const routesBefore = k.fetchLog.length;
  await k.window.cacheLessonBundle(CURRENT);
  assert.equal(k.fetchLog.slice(routesBefore).some((r) => r.url.includes('student-2.mp4')), false, 'no second copy of a saved video');
  assert.equal(cache.keysIn('journey-videos-v1').some((u) => u.includes('student-2')), false);
  assert.ok(saved(k.store, 'week-02-student') && saved(k.store, 'week-01-leader'), 'eviction never touches saved lessons');

  await openSettings(k);
  assert.equal(k.$('downloads-delete-btn').disabled, false);
  k.$('downloads-delete-btn').click();
  assert.equal(k.$('downloads-confirm').classList.contains('hidden'), false);
  assert.equal(k.document.activeElement, k.$('downloads-confirm-no'));
  assert.match(k.$('downloads-confirm-text').textContent, /^Delete all 2 saved videos \(0 MB\) from this computer\?/);
  k.$('downloads-confirm-no').click();
  assert.equal(k.$('downloads-confirm').classList.contains('hidden'), true);
  assert.equal(k.document.activeElement, k.$('downloads-delete-btn'));
  assert.ok(saved(k.store, 'week-02-student'), '"No" keeps them');
  k.$('downloads-delete-btn').click();
  k.$('downloads-confirm-yes').click();
  await until(() => !k.store.exists('journey-lessons-v1'), 2000, 'the delete');
  await wait(5);
  assert.match(k.$('downloads-status').textContent, /^Deleted\. Lessons play from the internet again\./);
  assert.equal(k.$('downloads-delete-btn').disabled, true);
  k.close();
});

/* ── Playback: the saved copy first ── */

async function beginShow(k) {
  k.window.setView('journey');
  k.$('journey-splash-play-btn').click();
  await ticks(10);
}

test('a saved lesson plays from this computer even with the internet up: no probe, no stream', async () => {
  const k = boot({ routes: { 'student-2.mp4': { text: 'streamable' } } });
  await ticks();
  seedSaved(k.store, 'week-02-student', FILES[`${CDN}student-2.mp4`], { url: `${CDN}student-2.mp4` });
  const blobs = [];
  k.window.URL.createObjectURL = (blob) => (blobs.push(blob), 'blob:saved');
  const before = k.fetchLog.length;
  await beginShow(k);
  assert.equal(k.video.getAttribute('src'), 'blob:saved');
  assert.equal(blobs[0].size, SIZES[2], 'one Blob of the saved pieces');
  assert.equal(k.fetchLog.slice(before).some((r) => r.method === 'HEAD'), false, 'no network probe');
  k.close();
});

test('a damaged saved copy is passed over for the network', async () => {
  const k = boot({ routes: { 'student-2.mp4': { text: 'streamable' } } });
  await ticks();
  seedSaved(k.store, 'week-02-student', FILES[`${CDN}student-2.mp4`], { url: `${CDN}student-2.mp4`, cut: 1 });
  await beginShow(k);
  assert.equal(k.video.getAttribute('src'), CURRENT.sourceUrl);
  k.close();
});

test('a saved copy that will not play goes over to the internet copy once, where the room got to', async () => {
  const k = boot();
  await ticks();
  seedSaved(k.store, 'week-02-student', FILES[`${CDN}student-2.mp4`], { url: `${CDN}student-2.mp4` });
  k.window.URL.createObjectURL = () => 'blob:saved';
  await beginShow(k);
  assert.equal(k.video.getAttribute('src'), 'blob:saved');
  k.video.currentTime = 95;
  k.video.dispatchEvent(new k.window.Event('error'));
  assert.equal(k.video.getAttribute('src'), CURRENT.sourceUrl);
  k.video.dispatchEvent(new k.window.Event('loadedmetadata'));
  assert.equal(k.seeks.at(-1), 95, 'the room carries on where it was');
  assert.equal(k.$('slides-view').classList.contains('hidden'), true, 'not handed to the slides');
  await openSettings(k);
  await wait(5);
  assert.match(k.document.querySelector('.downloads-row[data-id="week-02-student"]').textContent, /Would not play from this computer/);
  k.close();
});

test('the picker plays a saved copy of any week, with the original then the 480p copy behind it', async () => {
  const k = boot();
  await ticks();
  seedSaved(k.store, 'week-01-leader', FILES[`${CDN}leader-1.mp4`], { url: `${CDN}leader-1.mp4` });
  k.window.URL.createObjectURL = () => 'blob:saved-leader';
  await k.window.loadAllLessons();
  await k.window.playLeaderPreview(k.window.allLessons ? k.window.allLessons[0] : lessonsJson().lessons[0]);
  assert.equal(k.video.getAttribute('src'), 'blob:saved-leader');
  k.video.dispatchEvent(new k.window.Event('error'));
  assert.equal(k.video.getAttribute('src'), 'https://clubs.awana.org/leader-1.mp4', 'then the original');
  k.video.dispatchEvent(new k.window.Event('error'));
  assert.equal(k.video.getAttribute('src'), 'videos/week-01-leader.mp4', 'then the 480p copy');
  k.close();
});

/* ── Where it does not run ── */

test('configure mode never downloads: it points at the kiosk', async () => {
  const k = boot({ pageUrl: 'https://example.test/?configure=1' });
  await ticks(8);
  assert.equal(k.$('downloads-start-btn').classList.contains('hidden'), true);
  assert.match(k.$('downloads-summary').textContent, /downloaded from the Journey screen itself/);
  await wait(20);
  assert.equal(k.cdn.requests.length, 0);
  k.close();
});

test('a browser without OPFS says so, and nothing else changes', async () => {
  const k = bootKiosk({ 'lessons.json': { json: lessonsJson() }, 'current-lesson.json': { json: CURRENT } }, ANSWERED);
  k.document.getElementById('settings-btn').click();
  await ticks(8);
  assert.equal(k.document.getElementById('downloads-start-btn').classList.contains('hidden'), true);
  assert.match(k.document.getElementById('downloads-summary').textContent, /This browser cannot save lessons/);
  k.close();
});

/* ── Automatic mode and the status ── */

test('quiet hours come from the schedule: 5:30-8 PM, and an automatic run holds for the lesson', () => {
  const k = boot();
  const { downloadQuietTime, downloadHoldReason } = k.window;
  const d = (h, m) => new Date(2026, 9, 7, h, m);
  assert.deepEqual([d(17, 29), d(17, 30), d(19, 59), d(20, 0), d(12, 0), d(3, 0)].map(downloadQuietTime), [false, true, true, false, false, false]);
  assert.equal(downloadHoldReason({ auto: false, videoFromInternet: false, lessonOnScreen: true, quiet: true }), null, 'the button works any time');
  assert.match(downloadHoldReason({ auto: false, videoFromInternet: true }), /playing from the internet/);
  assert.match(downloadHoldReason({ auto: true, lessonOnScreen: true }), /a lesson is on screen/);
  assert.match(downloadHoldReason({ auto: true, quiet: true }), /^it is lesson time \(5:30 PM to 8:00 PM\)/);
  assert.equal(downloadHoldReason({ auto: true }), null);
  assert.equal(k.$('downloads-auto-hint').textContent, 'by itself, never during a lesson or from 5:30 PM to 8:00 PM');
  k.close();
});

test('automatic mode: starts by itself after load with no press, saves everything, reports status', async () => {
  const k = boot({ tuning: { autoStartMs: 30, autoTickMs: 20 } });
  await wait(15);
  assert.equal(k.cdn.requests.length, 0, 'not in the boot rush');
  await until(() => saved(k.store, 'week-01-leader'), 4000, 'the automatic pass');
  await until(() => k.window.journeyDownloads.phase === 'idle', 2000, 'the end');
  const status = k.window.journeyDownloadStatus();
  assert.deepEqual(Object.keys(status).sort(), ['auto', 'bytesSaved', 'bytesTotal', 'currentWeek', 'downloading', 'error', 'known', 'lastSavedAt', 'paused', 'percent', 'saved', 'supported', 'total', 'waiting']);
  assert.equal(status.total, 5);
  assert.equal(status.saved, 5);
  assert.equal(status.bytesSaved, 50 + 37 + 64 + 20 + 21);
  assert.equal(status.percent, 100);
  assert.equal(status.downloading, false);
  assert.equal(status.currentWeek, null);
  assert.equal(status.error, null);
  assert.equal(status.auto, true);
  assert.match(status.lastSavedAt, /^\d{4}-\d\d-\d\dT/);
  const events = k.window.statusEvents;
  assert.ok(events.some((e) => e.downloading && e.currentWeek === 2), 'an event names the week arriving');
  assert.ok(events.filter((e) => e.saved > 0).length >= 5, 'an event at once for each saved video');
  assert.equal(events.at(-1).saved, 5);
  k.close();
});

test('automatic mode never starts in the quiet hours, with the switch off, or with a lesson on screen', async () => {
  const quiet = boot({ now: at(18, 0), tuning: { autoStartMs: 10, autoTickMs: 10 } });
  await wait(80);
  assert.equal(quiet.cdn.requests.length, 0, '6 PM: nothing');
  assert.equal(quiet.window.autoDownloadTick(), false);
  quiet.close();

  const off = boot({ prefs: { 'journey.downloads.auto': '0' }, tuning: { autoStartMs: 10, autoTickMs: 10 } });
  await wait(80);
  assert.equal(off.cdn.requests.length, 0, 'switched off: nothing');
  await openSettings(off);
  assert.equal(off.$('downloads-auto').checked, false);
  assert.equal(off.window.journeyDownloadStatus().auto, false);
  off.close();

  const showing = boot({ tuning: { autoStartMs: 10, autoTickMs: 10 } });
  showing.video.setAttribute('src', 'blob:saved'); // even a saved lesson playing holds it
  await wait(80);
  assert.equal(showing.cdn.requests.length, 0, 'a lesson on screen: nothing');
  showing.video.removeAttribute('src');
  await until(() => showing.cdn.requests.length > 0, 2000, 'starts once the lesson is over');
  showing.close();
});

test('the switch: off stops an automatic run (saved videos stay), on starts one', async () => {
  const k = boot({ cdn: { behave: (url) => (url.endsWith('student-3.mp4') ? { stallAfter: 20 } : null) }, tuning: { autoStartMs: 10, autoTickMs: 1e9 } });
  await until(() => saved(k.store, 'week-02-student'), 2000, 'the first video');
  await openSettings(k);
  k.$('downloads-auto').click(); // off
  assert.equal(k.window.localStorage.getItem('journey.downloads.auto'), '0');
  assert.equal(k.window.journeyDownloads.phase, 'idle');
  assert.ok(saved(k.store, 'week-02-student'));
  const asked = k.cdn.requests.length;
  k.$('downloads-auto').click(); // on again
  await until(() => k.cdn.requests.length > asked, 2000, 'a new pass');
  k.close();
});

test('an automatic run reaching the quiet hours waits, and carries on after 8 PM', async () => {
  let hang = true;
  const k = boot({ now: at(17, 29), cdn: { behave: (url, n) => (hang && n === 1 && url.endsWith('student-2.mp4') ? { stallAfter: 20 } : null) }, tuning: { autoStartMs: 10, autoTickMs: 1e9 } });
  await until(() => (k.window.journeyDownloads.files['week-02-student'] || {}).have === 20, 2000, 'bytes arriving');
  pinClock(k.window, at(17, 31));
  await until(() => k.window.journeyDownloads.phase === 'waiting', 3000, 'the quiet hours');
  const status = k.window.journeyDownloadStatus();
  assert.equal(status.downloading, false);
  assert.match(status.waiting, /^it is lesson time/);
  assert.equal(k.window.statusEvents.at(-1).waiting, status.waiting, 'the change was announced at once');
  await wait(40);
  const during = k.cdn.requests.length;
  hang = false;
  pinClock(k.window, at(20, 1));
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the rest of the run');
  assert.ok(k.cdn.requests.length > during);
  assert.equal(k.cdn.requests.filter((r) => r.url.endsWith('student-2.mp4')).at(-1).range, 'bytes=16-', 'resumed from the whole piece');
  assert.deepEqual(joined(k.store, 'week-02-student'), FILES[`${CDN}student-2.mp4`]);
  k.close();
});

test('a newly published lesson is picked up on a later automatic pass', async () => {
  const k = boot({ tuning: { autoStartMs: 10, autoTickMs: 10, autoRecheckMs: 50 }, prefs: { 'journey.downloads.leaders': '0' } });
  await until(() => saved(k.store, 'week-01-student') && k.window.journeyDownloads.phase === 'idle', 4000, 'the first pass');
  assert.equal(k.window.journeyDownloadStatus().total, 3);
  // lessons.json gains week 4 (served from now on by the same route table).
  const more = lessonsJson();
  more.lessons.push({ ...more.lessons[0], week: 4, lesson: 4, title: 'Unit 1, Lesson 4: Name4', cdnUrl: `${CDN}student-1.mp4`, bytes: 50, leaderDownloadUrl: null, leaderCdnUrl: undefined, leaderBytes: undefined });
  const inner = k.window.fetch;
  k.window.fetch = (url, o) => (String(url).endsWith('lessons.json') ? Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(more), json: async () => more }) : inner(url, o));
  await until(() => saved(k.store, 'week-04-student'), 4000, 'week 4 on a later pass');
  assert.equal(k.window.journeyDownloadStatus().total, 4);
  k.close();
});

test('an error reaches the status at once', async () => {
  const k = boot({ cdn: { behave: (url) => (url.endsWith('student-2.mp4') ? { status: 500 } : null) } });
  await openSettings(k);
  k.$('downloads-start-btn').click();
  await until(() => k.window.journeyDownloads.phase === 'idle', 4000, 'the run');
  assert.match(k.window.journeyDownloadStatus().error, /^Week 2 · Student: Awana’s server answered with an error \(500\)$/);
  assert.ok(k.window.statusEvents.some((e) => e.error));
  k.close();
});

test('automatic mode is on by default only in the kiosk app: a Mac or phone opening the page never starts by itself', async () => {
  const mac = boot({ device: DESKTOP, tuning: { autoStartMs: 10, autoTickMs: 10 } });
  await wait(80);
  assert.equal(mac.cdn.requests.length, 0);
  assert.equal(mac.window.journeyDownloadStatus().auto, false);
  await openSettings(mac);
  assert.equal(mac.$('downloads-auto').checked, false);
  mac.$('downloads-auto').click(); // switched on by hand: it then does
  await until(() => mac.cdn.requests.length > 0, 2000, 'the pass the switch starts');
  mac.close();
  const app = boot({ tuning: { autoStartMs: 1e9 } });
  await openSettings(app);
  assert.equal(app.$('downloads-auto').checked, true, 'the kiosk app: on');
  app.close();
});
