#!/usr/bin/env node
// The edit: cuts the soundtrack to the film and encodes what the site plays.
//
// The music is "Happy Dance" by MercyMe (owner, 2026-10-16; reel/README.md),
// exactly 125 BPM (beat 0.480 s, first beat 0.044 s, steady to 4 ms). It is
// NOT in the repo (the repo is public; the song is not ours to publish): put
// the file at reel/music/happy-dance.mp3 (git-ignored) or name it in
// REEL_MUSIC. The film runs on its beat from song beat 48 (23.08 s: where the
// song really starts, owner 2026-10-16; before it is the file's lead-in):
// beats 48-159 (the verse and the first chorus), then a splice into the build,
// beat 320, four bars before the final chorus, to the song's own last hit
// (beat 392) and its ring, so every picture cut in film.js lands on the
// music's grid. A 20 ms crossfade at the splice, a short fade in, and a
// 1.8 s fade out at the end.
//
// Writes printer/public/reel/reel.mp4 (ONE file: H.264 High, 1280x720, 30 fps,
// AAC stereo 96 kbps, about 5.5 MB; owner 2026-10-16 "not compress it quite as
// heavily") and poster.jpg (the end card, 1280x720), from reel/.work/film.mp4
// (render.mjs).
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
const TRACK = process.env.REEL_MUSIC || path.join(HERE, 'music', 'happy-dance.mp3');

// The track's beat grid, measured off the file (reel/README.md): beat 0.480 s.
export const MUSIC = {
  beat: 0.48,
  at: (n) => 0.044 + n * 0.48,
};
const A_START = MUSIC.at(48);   // 23.084 s: the band comes in (film beat 0)
const A_END = MUSIC.at(160);    // 76.844 s: the first chorus ends (112 film beats)
const B_START = MUSIC.at(320);  // 153.644 s: the build into the final chorus
const XF = 0.02;

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());

/** The soundtrack, cut to `duration` seconds, as 48 kHz stereo WAV. */
export function soundtrack(duration, out = path.join(WORK, 'soundtrack.wav')) {
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(TRACK)) throw new Error(`the soundtrack ${TRACK} is missing: put "Happy Dance" there or name it in REEL_MUSIC (it is not in the repo)`);
  const fadeOut = 1.8;
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

function twoPass(input, audio, out, { width, height, fps, kbps, audioKbps = 128, channels = 1 }) {
  const log = path.join(WORK, `x264-${width}`);
  const vf = `scale=${width}:${height}:flags=lanczos,fps=${fps},format=yuv420p`;
  const common = ['-c:v', 'libx264', '-preset', 'veryslow', '-tune', 'animation', '-profile:v', 'high', '-level', '3.1',
    '-b:v', `${kbps}k`, '-maxrate', `${kbps * 2}k`, '-bufsize', `${kbps * 4}k`, '-g', String(fps * 2), '-passlogfile', log];
  ff(['-i', input, '-vf', vf, ...common, '-pass', '1', '-an', '-f', 'mp4', '/dev/null']);
  ff(['-i', input, '-i', audio, '-map', '0:v', '-map', '1:a', '-vf', vf, ...common, '-pass', '2',
    '-c:a', 'aac', '-b:a', `${audioKbps}k`, '-ac', String(channels), '-shortest', '-movflags', '+faststart', out]);
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
  // The owner's choice (2026-10-16): 720p, about 5.5 MB (decimal) in all, audio
  // included: 30 fps, video near 390 kbit/s, music at 96 kbit/s stereo.
  const budget = (mb, audioKbps) => Math.floor((mb * 8000) / duration - audioKbps);
  twoPass(film, audio, path.join(OUT, 'reel.mp4'), { width: 1280, height: 720, fps: 30, kbps: budget(5.5, 96) - 8, audioKbps: 96, channels: 2 });
  // The poster: the end card, settled (film.js POSTER_AT = beat 186.5).
  const posterAt = Number(process.env.REEL_POSTER_AT || 89.52);
  ff(['-ss', String(posterAt), '-i', film, '-frames:v', '1', '-vf', 'scale=1280:720:flags=lanczos', '-q:v', '4', path.join(OUT, 'poster.jpg')]);
  for (const f of ['reel.mp4', 'poster.jpg']) {
    console.log(`  ${f}: ${(statSync(path.join(OUT, f)).size / 1048576).toFixed(2)} MB`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  edit({ draft: process.argv.includes('--draft') });
}
