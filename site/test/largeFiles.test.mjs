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
  assert.equal(mustStream('/reel/reel-1080.mp4', 1000), true);
  assert.equal(mustStream('/reel/reel.webm', 1000), true);
  assert.equal(mustStream('/journey/current-lesson-video.mp4', 22 * 1024 * 1024), true);
  assert.equal(mustStream('/reel/poster.jpg', 300 * 1024), false);
  assert.equal(mustStream('/assets/main.js', PAGES_FILE_MAX), true);
  assert.equal(mustStream('/assets/main.js', PAGES_FILE_MAX - 1), false);
});

test('a streamed path comes from Journey\'s public files or the film\'s folder, and nowhere else', () => {
  assert.equal(repoPathFor('/reel/reel-1080.mp4'), 'printer/public/reel/reel-1080.mp4');
  assert.equal(repoPathFor('/reel/reel-720.mp4'), 'printer/public/reel/reel-720.mp4');
  assert.equal(repoPathFor('/journey/current-lesson-video.mp4'), 'journey/public/current-lesson-video.mp4');
  assert.equal(repoPathFor('/assets/clip.mp4'), null);
  assert.equal(repoPathFor('/reel/../printer/secret.mp4'), null);
  assert.equal(repoPathFor('/reel//x.mp4'), null);
  assert.equal(repoPathFor('/reel/'), null);
  assert.deepEqual(Object.keys(REPO_FOLDERS).sort(), ['/journey/', '/reel/']);
});

test('the film the home page plays is committed, small enough for one request, and streamed with Range', async () => {
  for (const file of ['reel-1080.mp4', 'reel-720.mp4', 'poster.jpg']) {
    assert.ok(existsSync(path.join(ROOT, 'printer/public/reel', file)), `printer/public/reel/${file} is committed`);
  }
  // The owner's limit: the 1080p film under 20 MB.
  assert.ok(statSync(path.join(ROOT, 'printer/public/reel/reel-1080.mp4')).size <= 20 * 1000 * 1000);
  // Its Function is the large-file proxy, like Journey's.
  const fn = readFileSync(path.join(SITE, 'functions/reel/[[path]].js'), 'utf8');
  assert.match(fn, /proxyLarge\(context\.request, LARGE_FILES, fetch\)\) \|\| context\.next\(\)/);
  const files = { '/reel/reel-1080.mp4': 'https://raw.example/repo/printer/public/reel/reel-1080.mp4' };
  let asked;
  const res = await proxyLarge(new Request('https://awana.kvbchurch.org/reel/reel-1080.mp4', { headers: { Range: 'bytes=0-1' } }), files,
    async (url, init) => { asked = { url, range: init.headers.get('Range') }; return new Response('ab', { status: 206, headers: { 'Content-Range': 'bytes 0-1/9' } }); });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.deepEqual(asked, { url: files['/reel/reel-1080.mp4'], range: 'bytes=0-1' });
});

test('site/build.mjs streams by this rule and routes what it streams to a Function', () => {
  const build = readFileSync(path.join(SITE, 'build.mjs'), 'utf8');
  assert.match(build, /mustStream\(sitePath, statSync\(file\)\.size\)/);
  assert.match(build, /repoPathFor\(sitePath\)/);
  assert.match(build, /\.\.\.Object\.keys\(largeFiles\)\.sort\(\)/);
  const routes = path.join(SITE, 'dist', '_routes.json');
  if (!existsSync(routes)) return; // a built site is checked too, when there is one
  const include = JSON.parse(readFileSync(routes, 'utf8')).include;
  for (const p of ['/reel/reel-1080.mp4', '/reel/reel-720.mp4']) assert.ok(include.includes(p), `${p} goes to its Function`);
  assert.equal(existsSync(path.join(SITE, 'dist', 'reel', 'reel-1080.mp4')), false, 'and is not uploaded');
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
