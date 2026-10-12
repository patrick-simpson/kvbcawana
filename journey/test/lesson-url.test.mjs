import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepResolvedUrl } from '../scripts/lesson-url.mjs';

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
