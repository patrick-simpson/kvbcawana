// The large-file proxy (site/lib/proxyLarge.js): what a video player and the
// kiosk's cache see of GitHub's answer. Plain node --test, no dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proxyLarge, upstreamFor } from '../lib/proxyLarge.js';

const FILES = { '/journey/current-lesson-video.mp4': 'https://raw.example/repo/journey/public/current-lesson-video.mp4' };
const PREFIXES = { '/journey/videos/': 'https://github.example/releases/download/journey-videos-v2/' };
const req = (path, headers = {}, method = 'GET') => new Request(`https://awana.kvbchurch.org${path}`, { method, headers });
const upstream = (status, headers = {}, body = 'bytes') => async (url, init) => {
  upstream.last = { url, init };
  return new Response(status === 304 || status === 204 ? null : body, { status, headers });
};

test('paths: the exact map, a plain name under a prefix, and nothing else', () => {
  assert.equal(upstreamFor('/journey/current-lesson-video.mp4', FILES, PREFIXES), FILES['/journey/current-lesson-video.mp4']);
  assert.equal(upstreamFor('/journey/videos/week-3.mp4', FILES, PREFIXES), `${PREFIXES['/journey/videos/']}week-3.mp4`);
  assert.equal(upstreamFor('/journey/videos/../../secret.mp4', FILES, PREFIXES), null);
  assert.equal(upstreamFor('/journey/videos/week-3.mp3', FILES, PREFIXES), null);
  assert.equal(upstreamFor('/journey/index.html', FILES, PREFIXES), null);
});

test('a plain GET streams the file with the headers a player needs, and no caching', async () => {
  const f = upstream(200, { 'Content-Length': '5', 'Accept-Ranges': 'bytes', ETag: '"v1"', 'X-GitHub-Request-Id': 'nope' });
  const res = await proxyLarge(req('/journey/videos/week-3.mp4'), FILES, f, PREFIXES);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'video/mp4');
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
  assert.equal(res.headers.get('ETag'), '"v1"');
  assert.equal(res.headers.get('X-GitHub-Request-Id'), null);
  assert.equal(await res.text(), 'bytes');
});

test('Range and the conditional headers go up; a 304 comes back as a 304', async () => {
  let f = upstream(206, { 'Content-Range': 'bytes 0-4/100' });
  let res = await proxyLarge(req('/journey/videos/week-3.mp4', { Range: 'bytes=0-4', 'If-Range': '"v1"' }), FILES, f, PREFIXES);
  assert.equal(res.status, 206);
  assert.equal(upstream.last.init.headers.get('Range'), 'bytes=0-4');
  assert.equal(upstream.last.init.headers.get('If-Range'), '"v1"');
  f = upstream(304, { ETag: '"v1"' });
  res = await proxyLarge(req('/journey/current-lesson-video.mp4', { 'If-None-Match': '"v1"', 'If-Modified-Since': 'Sat, 03 Oct 2026 00:00:00 GMT' }), FILES, f, PREFIXES);
  assert.equal(res.status, 304);
  assert.equal(upstream.last.init.headers.get('If-None-Match'), '"v1"');
  assert.equal(upstream.last.init.headers.get('If-Modified-Since'), 'Sat, 03 Oct 2026 00:00:00 GMT');
  assert.equal(res.headers.get('ETag'), '"v1"');
});

test('an upstream outage or rate limit is 502/503 with Retry-After, never "not found"', async () => {
  let res = await proxyLarge(req('/journey/videos/week-3.mp4'), FILES, upstream(429, { 'Retry-After': '120' }), PREFIXES);
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Retry-After'), '120');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  res = await proxyLarge(req('/journey/videos/week-3.mp4'), FILES, upstream(502), PREFIXES);
  assert.equal(res.status, 502);
  res = await proxyLarge(req('/journey/videos/week-3.mp4'), FILES, async () => { throw new Error('reset'); }, PREFIXES);
  assert.equal(res.status, 502);
  assert.equal(res.headers.get('Retry-After'), '30');
});

test('only an upstream 404 is a 404, and a bad range is 416', async () => {
  let res = await proxyLarge(req('/journey/videos/week-9.mp4'), FILES, upstream(404), PREFIXES);
  assert.equal(res.status, 404);
  res = await proxyLarge(req('/journey/videos/week-3.mp4', { Range: 'bytes=999-' }), FILES, upstream(416), PREFIXES);
  assert.equal(res.status, 416);
});

test('HEAD answers headers only; other methods are refused; other paths fall through', async () => {
  const res = await proxyLarge(req('/journey/videos/week-3.mp4', {}, 'HEAD'), FILES, upstream(200, { 'Content-Length': '5' }), PREFIXES);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '');
  const post = await proxyLarge(req('/journey/videos/week-3.mp4', {}, 'POST'), FILES, upstream(200), PREFIXES);
  assert.equal(post.status, 405);
  assert.equal(await proxyLarge(req('/journey/index.html'), FILES, upstream(200), PREFIXES), null);
});
