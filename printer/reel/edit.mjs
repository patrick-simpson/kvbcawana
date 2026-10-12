#!/usr/bin/env node
// The edit: cuts the soundtrack to the film and encodes what the site plays.
//
// The music is "Incredible You" by Soft and Furious (CC0; reel/README.md),
// 120.25 BPM. The film runs on its beat from bar 2 (MUSIC.start): bars 2-31,
// then a splice into the final phrase, bar 72 to the track's own ending, so
// every picture cut in film.js lands on the music's grid. A 20 ms crossfade
// at the splice, a short fade in, and a 2.4 s fade out at the end.
//
// Writes printer/public/reel/reel.mp4 (ONE file: H.264 High, 960x540, 30 fps,
// AAC mono 64 kbps, about 1.5 MB) and poster.jpg (a still of the closing
// title, 1280x720), from reel/.work/film.mp4 (render.mjs).
//
//   node reel/edit.mjs            all of it
//   node reel/edit.mjs --draft    a quick 720p cut into reel/.work/draft.mp4
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(HERE, '.work');
const OUT = path.join(HERE, '..', 'public', 'reel');
const TRACK = path.join(HERE, 'music', 'soft-and-furious-incredible-you.ogg');

// The track's beat grid, measured off the file (reel/README.md): beat 0.498947 s.
export const MUSIC = {
  beat: 0.498947,
  bar: (n) => 0.2812 + n * 4 * 0.498947,
};
const A_START = MUSIC.bar(2);   // 4.2728 s
const A_END = MUSIC.bar(32);    // 64.1463 s
const B_START = MUSIC.bar(72);  // 143.9778 s
const XF = 0.02;

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

/** The soundtrack, cut to `duration` seconds, as 48 kHz stereo WAV. */
export function soundtrack(duration, out = path.join(WORK, 'soundtrack.wav')) {
  mkdirSync(WORK, { recursive: true });
  const fadeOut = 2.4;
  const graph = [
    `[0:a]atrim=start=${A_START.toFixed(4)}:end=${A_END.toFixed(4)},asetpts=PTS-STARTPTS[a]`,
    `[0:a]atrim=start=${(B_START - XF).toFixed(4)},asetpts=PTS-STARTPTS[b]`,
    `[a][b]acrossfade=d=${XF}:c1=tri:c2=tri[ab]`,
    `[ab]atrim=end=${duration.toFixed(3)},afade=t=in:d=0.04,afade=t=out:st=${(duration - fadeOut).toFixed(3)}:d=${fadeOut},`
      + 'loudnorm=I=-15:TP=-1.5:LRA=11,aresample=48000[out]',
  ].join(';');
  ff(['-i', TRACK, '-filter_complex', graph, '-map', '[out]', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', out]);
  return out;
}

function twoPass(input, audio, out, { width, height, fps, kbps, audioKbps = 128 }) {
  const log = path.join(WORK, `x264-${width}`);
  const vf = `scale=${width}:${height}:flags=lanczos,fps=${fps},format=yuv420p`;
  const common = ['-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-profile:v', 'high', '-level', '3.1',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps * 2}k`, '-bufsize', `${kbps * 4}k`, '-g', String(fps * 2), '-passlogfile', log];
  ff(['-i', input, '-vf', vf, ...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
  ff(['-i', input, '-i', audio, '-map', '0:v', '-map', '1:a', '-vf', vf, ...common, '-pass', '2',
    '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', '1', '-shortest', '-movflags', '+faststart', out]);
}

export function edit({ draft = false } = {}) {
  const film = path.join(WORK, draft ? 'draft-film.mp4' : 'film.mp4');
  if (!existsSync(film)) throw new Error(`${path.relative(process.cwd(), film)} is missing: run render.mjs first`);
  const duration = probe(film);
  const audio = soundtrack(duration);
  if (draft) {
    const out = path.join(WORK, 'draft.mp4');
    ff(['-i', film, '-i', audio, '-map', '0:v', '-map', '1:a', '-vf', 'scale=1280:720:flags=lanczos,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-c:a', 'aac', '-b:a', '128k', '-shortest', '-movflags', '+faststart', out]);
    console.log(`  draft: ${path.relative(process.cwd(), out)} (${(statSync(out).size / 1048576).toFixed(1)} MB)`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  // The owner's limit (2026-10-12): about 1.5 MB (decimal) in all, audio
  // included: 540p at 30 fps, video near 86 kbit/s, music at 64 kbit/s mono.
  const budget = (mb, audioKbps) => Math.floor((mb * 8000) / duration - audioKbps);
  twoPass(film, audio, path.join(OUT, 'reel.mp4'), { width: 960, height: 540, fps: 30, kbps: budget(1.5, 64) - 3, audioKbps: 64 });
  // The poster: the closing title, settled (film.js POSTER_AT).
  const posterAt = Number(process.env.REEL_POSTER_AT || 73.2);
  ff(['-ss', String(posterAt), '-i', film, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', path.join(OUT, 'poster.jpg')]);
  for (const f of ['reel.mp4', 'poster.jpg']) {
    console.log(`  ${f}: ${(statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  edit({ draft: process.argv.includes('--draft') });
}
