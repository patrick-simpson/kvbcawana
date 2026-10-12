// Record, for every lesson in public/lessons.json, the address a BROWSER can
// download the original video from, and its size in bytes:
//   cdnUrl / bytes             (Student Video)
//   leaderCdnUrl / leaderBytes (Leader Video; left off when there is none)
//
// Why: Settings "Download all lessons" (src/schedule/26-lesson-downloads.js)
// saves every original onto the kiosk PC, with fetch() so the progress is real.
// lessons.json's own downloadUrl is on clubs.awana.org, whose 302 to the
// CloudFront host carries no Access-Control-Allow-Origin header, so a browser
// fetch of it fails (the redirect hop needs CORS too). CloudFront itself
// answers with `access-control-allow-origin: *` (only when the request
// carries an Origin header: it varies on Origin) and accepts a single
// `Range: bytes=N-` (CORS-safelisted, so no preflight; CloudFront 403s an
// OPTIONS preflight). This script follows each redirect once, server-side,
// with an Origin header, and keeps the final URL only when it is CORS-enabled.
// The sizes give the page an honest "3.1 of 7.4 GB" before anything arrives.
//
// HEAD requests only (never downloads a video). A lesson whose lookup fails
// keeps whatever it had (a bad run never wipes a good address). Re-run when
// Awana moves its files or lessons.json is rebuilt.
//
// Usage: node scripts/resolve-lesson-files.mjs [--dry-run]
// (behind a proxy: NODE_USE_ENV_PROXY=1)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const lessonsPath = path.join(repoRoot, 'public', 'lessons.json');
const ORIGIN = 'https://awana.kvbchurch.org';
const DRY = process.argv.includes('--dry-run');

/** One HEAD with the kiosk's Origin; the final URL and size when the answer
 * is a CORS-enabled video, else null. Exported shape kept small for tests. */
export async function resolveFile(url, fetchImpl = fetch) {
  if (typeof url !== 'string' || !url) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: 'HEAD',
        redirect: 'follow',
        headers: { Origin: ORIGIN },
        signal: AbortSignal.timeout(30000),
      });
      const bytes = Number(res.headers.get('content-length'));
      if (res.ok && res.headers.get('access-control-allow-origin') && Number.isFinite(bytes) && bytes > 0) {
        return { url: res.url, bytes };
      }
      return null;
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return null;
}

async function main() {
  const data = JSON.parse(readFileSync(lessonsPath, 'utf8'));
  let resolved = 0;
  let failed = 0;
  let total = 0;
  for (const lesson of data.lessons) {
    const student = await resolveFile(lesson.downloadUrl);
    if (student) {
      lesson.cdnUrl = student.url;
      lesson.bytes = student.bytes;
      resolved++;
    } else {
      failed++;
      console.warn(`week ${lesson.week}: Student Video not resolved (kept what was there)`);
    }
    if (lesson.leaderDownloadUrl) {
      const leader = await resolveFile(lesson.leaderDownloadUrl);
      if (leader) {
        lesson.leaderCdnUrl = leader.url;
        lesson.leaderBytes = leader.bytes;
        resolved++;
      } else {
        failed++;
        console.warn(`week ${lesson.week}: Leader Video not resolved (kept what was there)`);
      }
    } else {
      delete lesson.leaderCdnUrl;
      delete lesson.leaderBytes;
    }
    total += (lesson.bytes || 0) + (lesson.leaderBytes || 0);
  }
  if (!DRY) writeFileSync(lessonsPath, JSON.stringify(data, null, 2) + '\n');
  console.log(`lessons.json: ${resolved} files resolved, ${failed} not; all originals ${(total / 1e9).toFixed(2)} GB${DRY ? ' (dry run, nothing written)' : ''}`);
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  await main();
}
