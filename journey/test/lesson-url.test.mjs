import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepResolvedUrl, resolveCorsFriendlyVideoUrl, ORIGIN } from '../scripts/lesson-url.mjs';

const lesson = { week: 5, title: 'Who is God?', downloadUrl: 'https://clubs.awana.org/dl/5' };
const cdn = 'https://d123.cloudfront.net/5.mp4';

test('a failed HEAD keeps the address already resolved for the same lesson', () => {
  const existing = { week: 5, title: 'Who is God?', sourceUrl: cdn, transcodedAt: '2026-10-01T00:00:00Z' };
  assert.equal(keepResolvedUrl(existing, lesson, lesson.downloadUrl), cdn);
});

test('a resolved address is used as is', () => {
  const existing = { week: 5, title: 'Who is God?', sourceUrl: 'https://old.example/5.mp4' };
  assert.equal(keepResolvedUrl(existing, lesson, cdn), cdn);
});

test('a different week or title takes the fallback: it is a new lesson', () => {
  assert.equal(keepResolvedUrl({ week: 4, title: 'Who is God?', sourceUrl: cdn }, lesson, lesson.downloadUrl), lesson.downloadUrl);
  assert.equal(keepResolvedUrl({ week: 5, title: 'Renamed', sourceUrl: cdn }, lesson, lesson.downloadUrl), lesson.downloadUrl);
});

test('no feed yet, or one with no address: the fallback stands', () => {
  assert.equal(keepResolvedUrl(null, lesson, lesson.downloadUrl), lesson.downloadUrl);
  assert.equal(keepResolvedUrl({ week: 5, title: 'Who is God?' }, lesson, lesson.downloadUrl), lesson.downloadUrl);
});

function stub(status, allow, finalUrl = cdn) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, url: finalUrl, headers: new Headers(allow ? { 'access-control-allow-origin': allow } : {}) };
  };
  fn.calls = calls;
  return fn;
}

test('the HEAD sends the kiosk Origin and follows redirects', async () => {
  const f = stub(200, ORIGIN);
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, f), cdn);
  assert.equal(f.calls[0].init.method, 'HEAD');
  assert.equal(f.calls[0].init.redirect, 'follow');
  assert.equal(f.calls[0].init.headers.Origin, 'https://awana.kvbchurch.org');
});

test('a wildcard allow-origin is accepted', async () => {
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, stub(200, '*')), cdn);
});

test('no allow-origin, another origin, a bad status or a throw falls back to the original', async () => {
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, stub(200, null)), lesson.downloadUrl);
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, stub(200, 'https://other.example')), lesson.downloadUrl);
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, stub(403, '*')), lesson.downloadUrl);
  const boom = async () => { throw new Error('net'); };
  assert.equal(await resolveCorsFriendlyVideoUrl(lesson.downloadUrl, boom), lesson.downloadUrl);
});
