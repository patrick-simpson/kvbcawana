// The one re-encode every lesson video gets for the kiosk (the Pi Zero cannot
// decode Awana's 1080p originals): 854x480 baseline H.264, AAC stereo,
// faststart. Used by transcode-lesson-video.mjs (this week's lesson) and
// transcode-all-lessons.mjs (every lesson, for the picker), so the two can
// never drift apart.
//
// SIZE CAP (owner, 2026-10-03): the videos are served from
// awana.kvbchurch.org, and Cloudflare Pages takes files up to 25 MiB. The
// usual quality-based encode (CRF 26, capped at 700 kbps) is kept whenever it
// lands under PI_VIDEO_MAX_BYTES, which is most lessons; a longer one is
// encoded again in two passes at the average bitrate that fits, so it is a
// little softer rather than missing.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PI_VIDEO_MAX_BYTES = 24 * 1024 * 1024;
const AUDIO_KBPS = 96;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject); // e.g. ffmpeg not installed
    proc.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))));
  });
}

const PICTURE = ['-vf', 'scale=854:480', '-c:v', 'libx264', '-profile:v', 'baseline', '-level', '3.1', '-preset', 'veryfast'];
const SOUND = ['-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2'];

/** Seconds of video in `file`, from ffprobe. */
async function durationSec(file) {
  const out = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const s = Number(out.trim());
  if (!(s > 0)) throw new Error(`ffprobe could not read the duration of ${file}`);
  return s;
}

/**
 * The video bitrate (kbps) that brings a `seconds`-long file to 95% of the
 * cap with the audio beside it.
 */
export function fittingVideoKbps(seconds, maxBytes = PI_VIDEO_MAX_BYTES) {
  const totalKbps = (maxBytes * 0.95 * 8) / 1000 / seconds;
  return Math.max(100, Math.floor(totalKbps - AUDIO_KBPS));
}

/**
 * Encode `input` to `output` for the Pi, under PI_VIDEO_MAX_BYTES.
 * @returns {Promise<{bytes: number, refit: boolean}>}
 */
export async function encodeForPi(input, output) {
  await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...PICTURE,
    '-crf', '26', '-maxrate', '700k', '-bufsize', '1400k', ...SOUND, '-movflags', '+faststart', output]);
  if (statSync(output).size < PI_VIDEO_MAX_BYTES) return { bytes: statSync(output).size, refit: false };

  const kbps = fittingVideoKbps(await durationSec(input));
  console.log(`  ${(statSync(output).size / 1048576).toFixed(1)} MiB is over the cap: two passes at ${kbps} kbps`);
  const logDir = mkdtempSync(join(tmpdir(), 'pi-encode-'));
  const passlog = join(logDir, 'pass');
  try {
    const rate = ['-b:v', `${kbps}k`, '-maxrate', `${Math.round(kbps * 1.5)}k`, '-bufsize', `${kbps * 3}k`];
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...PICTURE, ...rate,
      '-pass', '1', '-passlogfile', passlog, '-an', '-f', 'mp4', '/dev/null']);
    await run('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', input, ...PICTURE, ...rate,
      '-pass', '2', '-passlogfile', passlog, ...SOUND, '-movflags', '+faststart', output]);
  } finally {
    rmSync(logDir, { recursive: true, force: true });
  }
  const bytes = statSync(output).size;
  if (bytes >= PI_VIDEO_MAX_BYTES) throw new Error(`still ${(bytes / 1048576).toFixed(1)} MiB after the refit`);
  return { bytes, refit: true };
}
