// "Lessons on this computer" in real Chromium: the real Origin Private File
// System, a real streamed fetch with a Range resume against a CloudFront-like
// host that refuses CORS preflights (as CloudFront does), the saved copy
// handed to the page as one disk-backed Blob that answers Range reads, and
// the panel's layout on the kiosk's TV (1920x1080) and small 4:3 screens.
// Every request is answered by the test itself (https://journey.test, a secure
// context, so OPFS is there); skipped without Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
};
const CDN = 'https://cdn.journey.test/';
const CHUNK = 64 * 1024;

const real = JSON.parse(readFileSync(path.join(PUBLIC, 'lessons.json'), 'utf8'));
// The real 32 lessons, their videos shrunk to a few hundred KB on the test CDN.
const sizeOf = (week, role) => 150 * 1024 + week * 977 + (role === 'leader' ? 5003 : 0);
const LESSONS = {
  ...real,
  lessons: real.lessons.map((l) => ({
    ...l,
    cdnUrl: `${CDN}student-${l.week}.mp4`,
    bytes: sizeOf(l.week, 'student'),
    ...(l.leaderDownloadUrl ? { leaderCdnUrl: `${CDN}leader-${l.week}.mp4`, leaderBytes: sizeOf(l.week, 'leader') } : {}),
  })),
};
function bytesFor(name) {
  const m = /^(student|leader)-(\d+)\.mp4$/.exec(name);
  const size = sizeOf(Number(m[2]), m[1]);
  const out = Buffer.alloc(size);
  for (let i = 0; i < size; i += 1) out[i] = (i * 31 + Number(m[2])) & 255;
  return out;
}

async function openKiosk(browser, viewport, { cdnLog = [], stall = () => false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript((chunk) => {
    const RealDate = Date;
    const noon = new RealDate(2026, 9, 7, 12, 0, 0).getTime();
    const offset = noon - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) {
        if (a.length) super(...a);
        else super(RealDate.now() + offset);
      }
      static now() {
        return RealDate.now() + offset;
      }
    };
    localStorage.setItem('journey.captions', 'off');
    window.journeyDownloadTuning = { chunkBytes: chunk, renderMs: 0, retryMs: [50, 50, 50], autoStartMs: 1e9, autoTickMs: 1e9, spaceMarginBytes: 0 };
  }, CHUNK);
  await page.route('**/*', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin + '/' === CDN) {
      const name = url.pathname.slice(1);
      cdnLog.push({ method: req.method(), name, range: req.headers().range || null, origin: req.headers().origin || null });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 403, body: 'no preflights here' });
      const body = bytesFor(name);
      const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*', 'content-type': 'video/mp4', 'accept-ranges': 'bytes', etag: '"e1"' };
      const m = /bytes=(\d+)-/.exec(req.headers().range || '');
      const start = m ? Number(m[1]) : 0;
      // A stalled transfer is cut short: the first part arrives, the rest never does.
      const end = stall(name) ? Math.min(body.length, start + CHUNK * 2 + 1000) : body.length;
      const slice = body.subarray(start, end);
      if (m) {
        return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${body.length - 1}/${body.length}`, 'content-length': String(body.length - start) }, body: slice });
      }
      return route.fulfill({ status: 200, headers: { ...headers, 'content-length': String(body.length) }, body: slice });
    }
    if (url.host !== 'journey.test') return route.abort();
    if (url.pathname.startsWith('/lobby/')) return route.fulfill({ body: '<body style="background:#1db6d9">', contentType: 'text/html' });
    if (url.pathname === '/lessons.json') return route.fulfill({ body: JSON.stringify(LESSONS), contentType: 'application/json' });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!existsSync(file) || /\.(mp4|pdf|vtt)$/.test(rel)) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('https://journey.test/index.html');
  return { page, context };
}

test('real OPFS: download, a Range resume with no preflight, and a disk-backed saved copy', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const cdnLog = [];
    // Week 6's first transfer is cut short after two whole pieces and a bit.
    const { page } = await openKiosk(browser, { width: 1280, height: 720 }, {
      cdnLog,
      stall: (name) => name === 'student-6.mp4' && cdnLog.filter((r) => r.name === name).length === 1,
    });
    // Student Videos only, and only weeks 6-7 for speed: the test plans by hand.
    const result = await page.evaluate(async () => {
      localStorage.setItem('journey.downloads.leaders', '0');
      await loadAllLessons();
      allLessons = allLessons.filter((l) => l.week === 6 || l.week === 7);
      document.getElementById('settings-btn').click();
      await new Promise((r) => setTimeout(r, 200));
      return { supported: lessonStoreSupported(), summary: document.getElementById('downloads-summary').textContent };
    });
    assert.equal(result.supported, true, 'OPFS with writable files');
    assert.match(result.summary, /^Nothing saved yet · 2 videos/);
    // fetchLessonsJson() re-reads the full list at the start of a run; keep the two weeks.
    await page.evaluate(() => {
      const keep = (data) => ({ ...data, lessons: data.lessons.filter((l) => l.week === 6 || l.week === 7) });
      const inner = fetchLessonsJson;
      window.fetchLessonsJson = async () => keep(await inner());
    });
    await page.evaluate(() => document.getElementById('downloads-start-btn').click());
    // The cut-short transfer fails once, then is retried with a Range from
    // the last whole piece.
    await page.waitForFunction(
      () => window.journeyDownloads.phase === 'idle' && Object.values(window.journeyDownloads.files).filter((f) => f.state === 'saved').length === 2,
      null,
      { timeout: 20000 }
    );
    assert.equal(cdnLog.some((r) => r.method === 'OPTIONS'), false, 'Range is CORS-safelisted: no preflight');
    const ranges = cdnLog.filter((r) => r.name === 'student-6.mp4').map((r) => r.range);
    assert.equal(ranges[0], null);
    assert.ok(ranges.slice(1).includes(`bytes=${CHUNK * 2}-`), `resumed from the last whole piece: ${ranges.join(', ')}`);
    assert.ok(cdnLog.every((r) => r.origin === 'https://journey.test'));

    const check = await page.evaluate(async (chunk) => {
      currentLesson = { week: 6, title: 'x', sourceUrl: 'https://clubs.awana.org/never-asked.mp4', downloadUrl: 'x' };
      const src = await resolveVideoSrc(currentLesson, journeyRequestToken);
      const blob = await savedLessonBlob('week-06-student');
      // A Range read through the blob URL, the way <video> asks for bytes.
      const res = await fetch(src, { headers: { Range: `bytes=${chunk - 2}-${chunk + 1}` } });
      const part = [...new Uint8Array(await res.arrayBuffer())];
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('journey-lessons-v1')).getDirectoryHandle('week-06-student');
      const names = [];
      for await (const n of dir.keys()) names.push(n);
      return { src, size: blob.size, status: res.status, part, names: names.sort() };
    }, CHUNK);
    assert.match(check.src, /^blob:/);
    assert.equal(check.size, sizeOf(6, 'student'));
    assert.equal(check.status, 206);
    const expect = [CHUNK - 2, CHUNK - 1, CHUNK, CHUNK + 1].map((i) => (i * 31 + 6) & 255);
    assert.deepEqual(check.part, expect, 'the bytes across a piece boundary are the file\'s');
    assert.deepEqual(check.names, ['c00000', 'c00001', 'c00002', 'info.json']);
  } finally {
    await browser.close();
  }
});

const VIEWPORTS = [
  [1920, 1080],
  [1024, 768],
  [640, 480],
];

test('the downloads panel fits the TV and small 4:3 screens, mid-download with a failure', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    for (const [width, height] of VIEWPORTS) {
      const at = `${width}x${height}`;
      const { page, context } = await openKiosk(browser, { width, height });
      const m = await page.evaluate(async () => {
        await document.fonts.load("400 16px 'Londrina Solid'");
        await document.fonts.load("600 16px 'Figtree'");
        document.getElementById('settings-btn').click();
        for (let i = 0; i < 60 && !window.journeyDownloads.items.length; i += 1) await new Promise((r) => setTimeout(r, 50));
        // The busiest the panel gets: running, a long summary, a long failure,
        // a row downloading, saved and part-saved rows.
        const dl = window.journeyDownloads;
        const GB = 1024 ** 3;
        dl.phase = 'running';
        dl.items.forEach((item, i) => {
          dl.files[item.id] = i < 9 ? { state: 'saved', have: 0.2 * GB, total: 0.2 * GB } : i === 10 ? { state: 'partial', have: 0.1 * GB, total: 0.2 * GB } : { state: 'none', have: 0, total: 0.2 * GB };
        });
        dl.activeId = dl.items[9].id;
        dl.files[dl.activeId] = { state: 'partial', have: 0.05 * GB, total: 0.2 * GB };
        dl.errors[dl.items[11].id] = 'the internet connection dropped or Awana’s server did not answer';
        dl.samples = [{ t: Date.now() - 20000, bytes: 0 }, { t: Date.now(), bytes: 20 * 1024 * 1024 }];
        dl.note = 'Week 12 · Student: the internet connection dropped or Awana’s server did not answer. Trying again in 30 seconds.';
        dl.tone = 'bad';
        dl.space = { free: 412.3 * GB, usage: 3 * GB, quota: 415 * GB, persisted: true };
        renderDownloads();
        const section = document.getElementById('settings-downloads');
        section.scrollIntoView();
        const card = document.getElementById('settings-card').getBoundingClientRect();
        const box = (el) => el.getBoundingClientRect();
        const visibleButtons = [...section.querySelectorAll('button')].filter((b) => b.offsetParent);
        const overflowing = [...section.querySelectorAll('*')]
          .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'auto')
          .map((el) => el.id || el.className);
        const rows = [...document.querySelectorAll('.downloads-row')];
        const list = document.getElementById('downloads-list');
        return {
          summary: document.getElementById('downloads-summary').textContent,
          cardScrollsSideways: document.getElementById('settings-card').scrollWidth > document.getElementById('settings-card').clientWidth + 1,
          outside: [section, ...visibleButtons, ...rows.slice(0, 3)].filter((el) => box(el).left < card.left - 0.5 || box(el).right > card.right + 0.5).map((el) => el.id || el.className),
          shortButtons: visibleButtons.filter((b) => box(b).height < 48).map((b) => b.id),
          overflowing,
          rows: rows.length,
          listScrolls: list.scrollHeight > list.clientHeight,
          listHeight: box(list).height,
          failedRow: rows[11].dataset.state,
          activeRow: rows[9].dataset.state,
          viewport: innerHeight,
          barWidth: box(document.getElementById('downloads-bar-fill')).width / box(document.getElementById('downloads-bar')).width,
        };
      });
      assert.match(m.summary, /^Video 10 of 63 · \d+% · .+ GB · about \d+ (h|min)/, `${at}: summary`);
      assert.equal(m.cardScrollsSideways, false, `${at}: no sideways scroll in the card`);
      assert.deepEqual(m.outside, [], `${at}: everything inside the card`);
      assert.deepEqual(m.shortButtons, [], `${at}: every button a 48px+ target`);
      assert.deepEqual(m.overflowing, [], `${at}: no text spills out of its box`);
      assert.equal(m.rows, 63, `${at}: a row per video`);
      assert.equal(m.failedRow, 'failed');
      assert.equal(m.activeRow, 'active');
      assert.ok(m.listScrolls, `${at}: the list scrolls inside its own box`);
      assert.ok(m.listHeight <= m.viewport * 0.6, `${at}: the list leaves room for the buttons`);
      assert.ok(m.barWidth > 0 && m.barWidth < 1, `${at}: the overall bar shows the part done`);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
