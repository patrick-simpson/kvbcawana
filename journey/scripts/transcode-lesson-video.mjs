#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────
// Nightly video transcode (run by .github/workflows/journey-update-lesson.yml,
// after scripts/fetch-current-lesson.mjs, or by hand):
//
//   node scripts/transcode-lesson-video.mjs
//   node scripts/transcode-lesson-video.mjs --lesson public/current-lesson.json --out build/current-lesson-video.mp4
//
// The Pi Zero this kiosk runs on (single-core ARMv6, 512MB RAM) struggles
// to decode Awana's original files smoothly — they're 1080p H.264 Main
// profile at ~2.2Mbps, 90-220MB each. This downloads the current lesson's
// `sourceUrl` (server-side — Node's fetch doesn't enforce CORS, so the
// redirect-through-CloudFront shape that requires special handling in the
// browser is a non-issue here) and re-encodes it to something far easier
// to decode: 854x480, H.264 *Baseline* profile (avoids CABAC entropy
// coding, which costs meaningfully more CPU to decode than baseline's
// CAVLC), a modest capped bitrate, and the original frame rate preserved
// (shrinking resolution/bitrate/profile complexity is what should let a
// weak decoder keep up, not a lower frame rate). Verified against a real
// lesson file: 94MB 1080p -> ~17MB 480p, visually clean at normal viewing
// distance on a TV.
//
// KNOWN, ACCEPTED TRADE-OFF — re-hosting: the transcoded file is served at
// awana.kvbchurch.org/journey/current-lesson-video.mp4, streamed from the
// asset of that name on this public repo's `journey-videos-v2` release (the
// same release, and the same encode, as every other lesson's 480p copy). This
// is a deliberate, informed exception to this project's own "never
// re-serve/re-host the original video files" rule (see CLAUDE.md) — that rule
// is about not redistributing Awana's ORIGINAL files; this is a re-encoded,
// lower-quality copy created and used solely for this kiosk's own on-device
// playback, not linked or advertised anywhere else. The project owner chose
// this trade-off explicitly, knowing it's technically a public URL, because
// the Pi Zero's hardware needs it. See CLAUDE.md before touching this
// boundary either direction.
//
// Repo size (owner, 2026-10-12): the video is NOT committed. Committed, every
// lesson change added ~17-32 MB to git history for good. This script writes
// it to build/ (ignored), and the workflow uploads it over the release asset
// of the same name (one asset, replaced in place) BEFORE it commits
// current-lesson.json and the small pointer public/current-lesson-video.json
// ({week, transcodedAt, sha256, bytes}). The pointer is what is committed in
// its place: it changes exactly when the video does, so Journey's build hash
// (a hash of public/) still moves on a lesson change and only then.
//
// Skip rule: nothing to do when current-lesson.json is already transcoded
// (transcodedAt set; fetch-current-lesson.mjs clears it whenever the lesson
// genuinely changes), the pointer names that same transcode, and — when the
// workflow checked the release (RELEASE_VIDEO_CHECKED=1) — the release asset's
// sha256 (RELEASE_VIDEO_SHA256, empty when there is no asset) is the
// pointer's. A missing or different asset is made again, so a failed upload
// heals itself the next night.
//
// Failure handling: any failure here (download, ffmpeg, disk) leaves
// current-lesson.json's `downloadUrl` exactly as fetch-current-lesson.mjs
// left it (pointing at the original CORS-friendly `sourceUrl`) — the kiosk
// still plays and caches that directly, just at the original size/quality,
// rather than being left with no video at all. This script never treats a
// failure to transcode as fatal to the overall nightly job.
// ─────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeForPi, PI_VIDEO_MAX_BYTES } from './pi-encode.mjs';

const DEFAULT_LESSON = 'public/current-lesson.json';
const DEFAULT_OUT = 'build/current-lesson-video.mp4';
export const DEFAULT_POINTER = 'public/current-lesson-video.json';
const OUT_FILENAME = 'current-lesson-video.mp4'; // relative path written into downloadUrl

/**
 * Is the release copy already this lesson's transcode?
 * @param {object} lesson   current-lesson.json
 * @param {object|null} pointer  current-lesson-video.json, or null
 * @param {{checked: boolean, sha256: string}} release  what the workflow saw
 *   on the release (sha256 '' = no asset); checked false = not looked at.
 */
export function videoIsCurrent(lesson, pointer, release = { checked: false, sha256: '' }) {
  if (!lesson || !lesson.transcodedAt || !pointer) return false;
  if (pointer.transcodedAt !== lesson.transcodedAt || pointer.week !== lesson.week) return false;
  if (!/^[0-9a-f]{64}$/.test(String(pointer.sha256))) return false;
  // A file from before the size cap (pi-encode.mjs) is done again.
  if (!(pointer.bytes > 0 && pointer.bytes < PI_VIDEO_MAX_BYTES)) return false;
  if (release.checked && release.sha256 !== pointer.sha256) return false;
  return true;
}

/** The pointer committed in the video's place. */
export function pointerFor(lesson, bytes, sha256) {
  return { version: 1, week: lesson.week, transcodedAt: lesson.transcodedAt, sha256, bytes };
}

export function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function downloadTo(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60 * 1000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(destPath, buf);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const lessonPath = arg('--lesson') || DEFAULT_LESSON;
  const outPath = arg('--out') || DEFAULT_OUT;
  const pointerPath = arg('--pointer') || DEFAULT_POINTER;
  const release = {
    checked: process.env.RELEASE_VIDEO_CHECKED === '1',
    sha256: (process.env.RELEASE_VIDEO_SHA256 || '').replace(/^sha256:/, '').toLowerCase(),
  };

  if (!existsSync(lessonPath)) {
    console.log(`${lessonPath} doesn't exist yet — nothing to transcode.`);
    return;
  }

  const lesson = readJson(lessonPath);
  if (!lesson) {
    console.error(`${lessonPath} is not valid JSON — leaving it alone.`);
    return; // not this script's job to fix a corrupt feed
  }

  if (!lesson.sourceUrl || typeof lesson.sourceUrl !== 'string') {
    console.log(`${lessonPath} has no sourceUrl yet — nothing to transcode.`);
    return;
  }

  // Never leave an old output behind: the workflow uploads whatever is here.
  rmSync(outPath, { force: true });

  if (videoIsCurrent(lesson, readJson(pointerPath), release)) {
    console.log(`Week ${lesson.week} already transcoded at ${lesson.transcodedAt}${release.checked ? ' and on the release' : ''} — nothing to do.`);
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), 'journey-transcode-'));
  const rawPath = join(tmpDir, 'source.mp4');

  try {
    console.log(`Downloading week ${lesson.week}'s source video…`);
    await downloadTo(lesson.sourceUrl, rawPath);

    console.log('Transcoding to 854x480 baseline H.264…');
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    const { refit } = await encodeForPi(rawPath, outPath);
    if (refit) console.log('Refit to stay under the site\'s 25 MiB file limit.');

    lesson.downloadUrl = OUT_FILENAME;
    lesson.transcodedAt = new Date().toISOString();
    const pointer = pointerFor(lesson, statSync(outPath).size, sha256File(outPath));
    writeFileSync(pointerPath, `${JSON.stringify(pointer, null, 2)}\n`);
    writeFileSync(lessonPath, `${JSON.stringify(lesson, null, 2)}\n`);
    console.log(`Transcoded week ${lesson.week} -> ${outPath} (sha256 ${pointer.sha256}), updated ${lessonPath} and ${pointerPath}.`);
  } catch (err) {
    // Never fatal to the nightly job: current-lesson.json's downloadUrl is
    // still whatever fetch-current-lesson.mjs left it as (the original,
    // CORS-friendly sourceUrl) — playback still works, just at full size.
    // No output is left for the workflow to upload.
    rmSync(outPath, { force: true });
    console.error(`Transcode failed, leaving ${lessonPath}'s existing downloadUrl in place —`, err.message);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
