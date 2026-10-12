// The nightly encode must never replace a good video with a failed or
// oversized one. Needs ffmpeg (present on the CI runner and the Pi build host).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeForPi } from '../scripts/pi-encode.mjs';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function makeSource(dir) {
  const src = join(dir, 'source.mp4');
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=10:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', src]);
  assert.equal(r.status, 0, String(r.stderr));
  return src;
}

test('a finished encode replaces the live file and leaves no partial', { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-encode-test-'));
  try {
    const src = makeSource(dir);
    const out = join(dir, 'lesson.mp4');
    writeFileSync(out, 'OLD');
    const { bytes } = await encodeForPi(src, out);
    assert.ok(bytes > 100);
    assert.notEqual(readFileSync(out, 'utf8'), 'OLD');
    assert.equal(existsSync(`${out}.partial.mp4`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an encode that cannot fit the cap keeps the old file and cleans up', { skip: !hasFfmpeg }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-encode-test-'));
  try {
    const src = makeSource(dir);
    const out = join(dir, 'lesson.mp4');
    writeFileSync(out, 'OLD');
    await assert.rejects(encodeForPi(src, out, 1000));
    assert.equal(readFileSync(out, 'utf8'), 'OLD');
    assert.equal(existsSync(`${out}.partial.mp4`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
