// What the site streams instead of uploading (site/lib/largeFiles.js): every
// video and every file over Pages' 25 MiB, from Journey's public files or the
// home page's film, through a Function that passes Range (Safari will not
// play a video without it). Plain node --test, no dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES_FILE_MAX, REPO_FOLDERS, mustStream, repoPathFor } from '../lib/largeFiles.js';
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
  assert.deepEqual(Object.keys(REPO_FOLDERS).sort(), ['/journey/', '/reel/']);
});

test('the film the home page plays is committed, small enough for one request, and streamed with Range', async () => {
  for (const file of ['reel.mp4', 'poster.jpg']) {
    assert.ok(existsSync(path.join(ROOT, 'printer/public/reel', file)), `printer/public/reel/${file} is committed`);
  }
  // The owner's limit (2026-10-12): one 540p film of about 1.5 MB.
  assert.ok(statSync(path.join(ROOT, 'printer/public/reel/reel.mp4')).size <= 1.6 * 1000 * 1000);
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
