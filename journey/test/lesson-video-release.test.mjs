// The nightly lesson video lives on the journey-videos-v2 release, not in the
// tree (owner, 2026-10-12). scripts/transcode-lesson-video.mjs decides whether
// the release copy is already this lesson's; the workflow uploads a new one
// before it commits the pointer. Plain node --test, no ffmpeg, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_POINTER, pointerFor, videoIsCurrent } from '../scripts/transcode-lesson-video.mjs';

const JOURNEY = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ROOT = path.dirname(JOURNEY);
const SHA = 'a'.repeat(64);
const LESSON = { week: 6, title: 'Lesson', sourceUrl: 'https://cdn.example/x.mp4', downloadUrl: 'current-lesson-video.mp4', transcodedAt: '2026-10-08T15:44:31.611Z' };
const POINTER = pointerFor(LESSON, 21938220, SHA);

test('the pointer records the transcode it stands for', () => {
  assert.deepEqual(POINTER, { version: 1, week: 6, transcodedAt: LESSON.transcodedAt, sha256: SHA, bytes: 21938220 });
});

test('a lesson is re-encoded unless the pointer and the release both hold its transcode', () => {
  assert.equal(videoIsCurrent(LESSON, POINTER), true, 'by hand: the pointer alone');
  assert.equal(videoIsCurrent(LESSON, POINTER, { checked: true, sha256: SHA }), true);
  assert.equal(videoIsCurrent(LESSON, POINTER, { checked: false, sha256: '' }), true, 'release not readable: trust the pointer');
  assert.equal(videoIsCurrent(LESSON, POINTER, { checked: true, sha256: '' }), false, 'no asset on the release');
  assert.equal(videoIsCurrent(LESSON, POINTER, { checked: true, sha256: 'b'.repeat(64) }), false, 'a different asset');
  assert.equal(videoIsCurrent({ ...LESSON, transcodedAt: null }, POINTER), false, 'the lesson changed');
  assert.equal(videoIsCurrent({ ...LESSON, transcodedAt: '2026-10-15T08:30:00.000Z' }, POINTER), false);
  assert.equal(videoIsCurrent({ ...LESSON, week: 7 }, POINTER), false);
  assert.equal(videoIsCurrent(LESSON, null), false, 'no pointer');
  assert.equal(videoIsCurrent(LESSON, { ...POINTER, bytes: 30 * 1024 * 1024 }), false, 'over the size cap');
  assert.equal(videoIsCurrent(LESSON, { ...POINTER, sha256: 'nope' }), false);
});

test('the committed pointer matches current-lesson.json', () => {
  const lesson = JSON.parse(readFileSync(path.join(JOURNEY, 'public/current-lesson.json'), 'utf8'));
  const pointer = JSON.parse(readFileSync(path.join(JOURNEY, DEFAULT_POINTER), 'utf8'));
  if (!lesson.transcodedAt) return; // a lesson whose transcode failed plays its original
  assert.equal(lesson.downloadUrl, 'current-lesson-video.mp4');
  assert.equal(videoIsCurrent(lesson, pointer), true, `${DEFAULT_POINTER} is this lesson's transcode`);
});

test('the nightly workflow uploads to the release before it commits the pointer, never the video', () => {
  const wf = readFileSync(path.join(ROOT, '.github/workflows/journey-update-lesson.yml'), 'utf8');
  const upload = wf.indexOf('gh release upload journey-videos-v2 build/current-lesson-video.mp4 --clobber');
  const commit = wf.indexOf('uses: ./.github/actions/push-main');
  assert.ok(upload > 0 && commit > upload, 'upload, then commit');
  assert.match(wf, /paths: public\/current-lesson\.json public\/current-lesson-video\.json\n/);
  assert.doesNotMatch(wf, /paths:.*current-lesson-video\.mp4/);
  assert.match(wf, /RELEASE_VIDEO_SHA256: \$\{\{ steps\.release\.outputs\.sha256 \}\}/);
});
