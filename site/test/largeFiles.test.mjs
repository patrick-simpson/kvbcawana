// What the site streams instead of uploading (site/lib/largeFiles.js): every
// video and every file over Pages' 25 MiB, from Journey's public files or the
// home page's film, through a Function that passes Range (Safari will not
// play a video without it). Plain node --test, no dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES_FILE_MAX, RELEASE_FILES, REPO_FOLDERS, VIDEO_RELEASE_TAG, mustStream, releaseBase, releaseFiles, repoPathFor } from '../lib/largeFiles.js';
import { pathToFileURL } from 'node:url';
import { proxyLarge } from '../lib/proxyLarge.js';

const SITE = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(SITE);

test('every video is streamed, and any other file only when it is too big for Pages', () => {
  assert.equal(mustStream('/reel/reel.mp4', 1000), true);
  assert.equal(mustStream('/reel/reel.webm', 1000), true);
  assert.equal(mustStream('/journey/current-lesson-video.mp4', 22 * 1024 * 1024), true);
  assert.equal(mustStream('/reel/poster.jpg', 300 * 1024), false);
  assert.equal(mustStream('/assets/main.js', PAGES_FILE_MAX), true);
  assert.equal(mustStream('/assets/main.js', PAGES_FILE_MAX - 1), false);
});

test('a streamed path comes from Journey\'s public files or the film\'s folder, and nowhere else', () => {
  assert.equal(repoPathFor('/reel/reel.mp4'), 'printer/public/reel/reel.mp4');
  assert.equal(repoPathFor('/journey/current-lesson-video.mp4'), 'journey/public/current-lesson-video.mp4');
  assert.equal(repoPathFor('/assets/clip.mp4'), null);
  assert.equal(repoPathFor('/reel/../printer/secret.mp4'), null);
  assert.equal(repoPathFor('/reel//x.mp4'), null);
  assert.equal(repoPathFor('/reel/'), null);
  assert.equal(repoPathFor('/lobby/intro/awana-intro.mp4'), 'lobby/public/intro/awana-intro.mp4');
  assert.equal(repoPathFor('/lobby/promos/grand-prix.mp4'), 'lobby/public/promos/grand-prix.mp4');
  assert.equal(repoPathFor('/lobby/promos/../intro/x.mp4'), null);
  assert.equal(repoPathFor('/lobby/assets/clip.mp4'), null);
  assert.deepEqual(Object.keys(REPO_FOLDERS).sort(), ['/journey/', '/lobby/intro/', '/lobby/promos/', '/reel/']);
});

test('the lobby\'s 3D intro is committed, a web copy, and streamed with Range like the film', () => {
  const video = path.join(ROOT, 'lobby/public/intro/awana-intro.mp4');
  assert.ok(existsSync(video), 'lobby/public/intro/awana-intro.mp4 is committed');
  // video/awana-intro writes it at 6 Mbps (~11 MB for 15 s); a lossless render
  // committed by mistake would be hundreds.
  assert.ok(statSync(video).size <= 16 * 1000 * 1000);
  // Its index is in front of its pictures (tools/faststart.py), so a TV can
  // start it from the first request through the Function.
  const head = readFileSync(video).subarray(0, 64 * 1024);
  const moov = head.indexOf('moov');
  assert.ok(moov > 0 && (head.indexOf('mdat') === -1 || moov < head.indexOf('mdat')), 'moov before mdat');
  const fn = readFileSync(path.join(SITE, 'functions/lobby/intro/[[path]].js'), 'utf8');
  assert.match(fn, /proxyLarge\(context\.request, LARGE_FILES, fetch\)\) \|\| context\.next\(\)/);
});

test('the lobby\'s Grand Prix promo is committed, a small web copy with its end card, and streamed with Range', () => {
  const video = path.join(ROOT, 'lobby/public/promos/grand-prix.mp4');
  assert.ok(existsSync(video), 'lobby/public/promos/grand-prix.mp4 is committed');
  // The torn cut: 33.7 s at 1080p60, about 10.3 MB (the paper tear's grain and
  // fine edges cost more bits than the flat cut's 6.6 MB). This cap is only a
  // guard against committing a lossless render by mistake (hundreds of MB), as
  // the intro's is: the file is never uploaded to Pages (no 25 MiB limit) but
  // streamed by the Function from raw.githubusercontent.com, so the real
  // ceiling is GitHub's 100 MB a file (50 MB warns). Raised 2026-10-29.
  assert.ok(statSync(video).size <= 14 * 1000 * 1000);
  const head = readFileSync(video).subarray(0, 64 * 1024);
  const moov = head.indexOf('moov');
  assert.ok(moov > 0 && (head.indexOf('mdat') === -1 || moov < head.indexOf('mdat')), 'moov before mdat');
  // Its end card at rest (zero animation and the fallback) is a plain static file.
  const still = path.join(ROOT, 'lobby/public/promos/grand-prix-end.jpg');
  assert.ok(existsSync(still), 'lobby/public/promos/grand-prix-end.jpg is committed');
  assert.equal(mustStream('/lobby/promos/grand-prix-end.jpg', statSync(still).size), false);
  assert.equal(mustStream('/lobby/promos/grand-prix.mp4', statSync(video).size), true);
  const fn = readFileSync(path.join(SITE, 'functions/lobby/promos/[[path]].js'), 'utf8');
  assert.match(fn, /proxyLarge\(context\.request, LARGE_FILES, fetch\)\) \|\| context\.next\(\)/);
});

test('the film the home page plays is committed, small enough for one request, and streamed with Range', async () => {
  for (const file of ['reel.mp4', 'poster.jpg']) {
    assert.ok(existsSync(path.join(ROOT, 'printer/public/reel', file)), `printer/public/reel/${file} is committed`);
  }
  // The owner's choice (2026-10-16): one 720p film of about 5.5 MB.
  assert.ok(statSync(path.join(ROOT, 'printer/public/reel/reel.mp4')).size <= 6.2 * 1000 * 1000);
  // Its Function is the large-file proxy, like Journey's.
  const fn = readFileSync(path.join(SITE, 'functions/reel/[[path]].js'), 'utf8');
  assert.match(fn, /proxyLarge\(context\.request, LARGE_FILES, fetch\)\) \|\| context\.next\(\)/);
  const files = { '/reel/reel.mp4': 'https://raw.example/repo/printer/public/reel/reel.mp4' };
  let asked;
  const res = await proxyLarge(new Request('https://awana.kvbchurch.org/reel/reel.mp4', { headers: { Range: 'bytes=0-1' } }), files,
    async (url, init) => { asked = { url, range: init.headers.get('Range') }; return new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-1/9' } }); });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual(asked, { url: files['/reel/reel.mp4'], range: 'bytes=0-1' });
});

test('site/build.mjs streams by this rule and routes what it streams to a Function', () => {
  const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
  assert.match(build, /mustStream\(sitePath, statSync\(file\)\.size\)/);
  assert.match(build, /repoPathFor\(sitePath\)/);
  assert.match(build, /\.\.\.Object\.keys\(largeFiles\)\.sort\(\)/);
  const routes = path.join(SITE, 'dist', '_routes.json');
  if (!existsSync(routes)) return; // a built site is checked too, when there is one
  const include = JSON.parse(readFileSync(routes, 'utf8')).include;
  assert.ok(include.includes('/reel/reel.mp4'), '/reel/reel.mp4 goes to its Function');
  assert.equal(existsSync(path.join(SITE, 'dist', 'reel', 'reel.mp4')), false, 'and is not uploaded');
});

// This week's lesson video left the tree (owner, 2026-10-12): the nightly bot
// replaces one asset on the journey-videos-v2 release, and the site streams it
// at the URL the Pi always used, so the Pi needed no change.
const LESSON = '/journey/current-lesson-video.mp4';
const RELEASE_URL = 'https://github.com/patrick-simpson/kvbcawana/releases/download/journey-videos-v2/current-lesson-video.mp4';

test('this week\'s lesson video is the release asset of the same name, never a repo file', () => {
  assert.equal(VIDEO_RELEASE_TAG, 'journey-videos-v2');
  assert.deepEqual(RELEASE_FILES, { [LESSON]: 'current-lesson-video.mp4' });
  assert.equal(releaseBase('patrick-simpson/kvbcawana'), 'https://github.com/patrick-simpson/kvbcawana/releases/download/journey-videos-v2/');
  assert.deepEqual(releaseFiles('patrick-simpson/kvbcawana'), { [LESSON]: RELEASE_URL });
  const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
  assert.match(build, /const largeFiles = releaseFiles\(REPO\);/);
  // A stray local copy (the bot's output, ignored) is dropped, not streamed from the repo.
  assert.match(build, /hasOwnProperty\.call\(RELEASE_FILES, sitePath\)\) \{ rmSync\(file\); continue; \}/);
});

test('the Journey Function streams GET and Range on the lesson video from the release', async (t) => {
  const generated = path.join(SITE, 'lib', 'large-files.generated.js');
  if (!existsSync(generated)) { t.skip('no site build (node site/build.mjs writes the map)'); return; }
  const routes = JSON.parse(readFileSync(path.join(SITE, 'dist', '_routes.json'), 'utf8')).include;
  assert.ok(routes.includes(LESSON), 'the lesson video is routed to its Function');
  assert.equal(existsSync(path.join(SITE, 'dist', 'journey', 'current-lesson-video.mp4')), false, 'and is not uploaded');
  const { LARGE_FILES } = await import(pathToFileURL(generated).href);
  assert.match(LARGE_FILES[LESSON], /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\/journey-videos-v2\/current-lesson-video\.mp4$/);
  const { onRequest } = await import(pathToFileURL(path.join(SITE, 'functions', 'journey', '[[path]].js')).href);
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const range = init.headers.get('Range');
    asked.push({ url, method: init.method, range });
    if (range) return new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-1/9', 'Content-Length': '2', 'Accept-Ranges': 'bytes' } });
    return new Response('abcdefghi', { status: 200, headers: { 'Content-Length': '9', 'Accept-Ranges': 'bytes', ETag: '"0x1"' } });
  };
  t.after(() => { globalThis.fetch = realFetch; });
  const next = () => { throw new Error('fell through to a static file'); };
  // The Pi's own request: the kiosk adds ?v=<transcodedAt>, which the proxy drops.
  const page = 'https://awana.kvbchurch.org/journey/current-lesson-video.mp4?v=2026-10-08T15%3A44%3A31.611Z';
  let res = await onRequest({ request: new Request(page), next });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.equal(res.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(await res.text(), 'abcdefghi');
  res = await onRequest({ request: new Request(page, { headers: { Range: 'bytes=0-1' } }), next });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Range'), 'bytes 0-1/9');
  assert.equal(await res.text(), 'ab');
  assert.deepEqual(asked, [
    { url: LARGE_FILES[LESSON], method: 'GET', range: null },
    { url: LARGE_FILES[LESSON], method: 'GET', range: 'bytes=0-1' },
  ]);
});
