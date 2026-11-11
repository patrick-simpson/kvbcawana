#!/usr/bin/env node
// Renders film.html to video, frame by frame: every frame is the page at an
// exact time (window.setTime), photographed at 1920x1080, so the result is a
// true 60 fps with no dropped or doubled frame however slow this computer is.
//
//   node video/lobby-intro/render.mjs            the real one -> lobby/public/intro/awana-intro.mp4
//   node video/lobby-intro/render.mjs --preview  half size, 30 fps, to out/preview.mp4 (quick look)
//   node video/lobby-intro/render.mjs --stills 1.2,2.6,5.3   PNGs of those moments to out/
//   node video/lobby-intro/render.mjs --to <file.mp4>        the real one, somewhere else (to review first)
//   node video/lobby-intro/render.mjs --film <page.html> --to <file.mp4>   another film built the same way
//                                                 (video/grand-welcome/doors/film.html, the 6:00 pm one)
//
// Needs the lobby's packages (cd lobby && npm ci) and ffmpeg.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(REPO, 'lobby', 'package.json'));
const { chromium } = require('@playwright/test');

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const stillsAt = args.includes('--stills') ? args[args.indexOf('--stills') + 1].split(',').map(Number) : null;
const OUT = path.join(HERE, 'out');
const to = args.includes('--to') ? path.resolve(args[args.indexOf('--to') + 1]) : null;
const FILM_PAGE = args.includes('--film') ? path.resolve(args[args.indexOf('--film') + 1]) : path.join(HERE, 'film.html');
if (args.includes('--film') && !to && !preview && !stillsAt) {
  console.error('--film needs --to <file.mp4>: only the lobby film has a home of its own.');
  process.exit(1);
}
const TARGET = to || (preview || stillsAt ? path.join(OUT, 'preview.mp4') : path.join(REPO, 'lobby', 'public', 'intro', 'awana-intro.mp4'));

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`file://${FILM_PAGE}`);
await page.evaluate(() => window.ready);
const film = await page.evaluate(() => window.FILM);
const stage = page.locator('#stage');

if (stillsAt) {
  for (const t of stillsAt) {
    await page.evaluate((s) => window.setTime(s), t);
    writeFileSync(path.join(OUT, `still-${t.toFixed(2)}.png`), await stage.screenshot());
  }
  await browser.close();
  console.log(`stills written to ${OUT}`);
  process.exit(0);
}

const fps = preview ? 30 : film.fps;
const frames = Math.round(film.seconds * fps);
// Visually lossless H.264 a TV decodes easily: High profile, 4:2:0, BT.709
// tagged (flat colour must not shift), the index in front so it starts at once.
const ffmpeg = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'veryslow', '-crf', preview ? '20' : '12', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-vf', `${preview ? 'scale=960:540:flags=lanczos,' : ''}scale=in_color_matrix=bt601:out_color_matrix=bt709:in_range=pc:out_range=tv`,
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
  '-g', String(fps), '-movflags', '+faststart', '-an', TARGET], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((resolve, reject) => { ffmpeg.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg exited ${c}`)))); });

for (let f = 0; f < frames; f += 1) {
  await page.evaluate((s) => window.setTime(s), f / fps);
  const png = await stage.screenshot();
  if (!ffmpeg.stdin.write(png)) await new Promise((r) => ffmpeg.stdin.once('drain', r));
  if (f % 60 === 0) process.stdout.write(`\r${Math.round((f / frames) * 100)}%  `);
}
ffmpeg.stdin.end();
await done;
await browser.close();
const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size', '-of', 'csv=p=0', TARGET], { encoding: 'utf8' });
console.log(`\r100%  ${TARGET}  (${frames} frames at ${fps} fps; duration,bytes = ${probe.stdout.trim()})`);
if (film.home != null) console.log(`HOME (FLAGSHIP_INTRO.homeAt in lobby/src/lib/flagship.js) = ${film.home} s; opening still = ${film.still} s`);
