#!/usr/bin/env node
// Renders the film page (reel/film/) frame by frame into a silent master,
// reel/.work/film.mp4: each frame is film.seek(t) and one screenshot, piped
// straight into ffmpeg, so nothing depends on how long a frame takes to draw.
//
//   node reel/render.mjs                     1920x1080 at 60 fps
//   node reel/render.mjs --fps 30 --scale 0.6667 --out .work/draft.mp4
//   node reel/render.mjs --from 20 --to 30   a stretch of it
//   node reel/render.mjs --stills 3,12.5,40  PNG stills into .work/stills/
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import { launch } from './lib/vclock.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORK = path.join(HERE, '.work');

export async function render({ fps = 60, scale = 1, from = 0, to = null, out = path.join(WORK, 'film.mp4'), stills = null, quality = 95 } = {}) {
  mkdirSync(WORK, { recursive: true });
  const srv = await serve({ site: path.join(ROOT, 'site', 'dist'), film: path.join(HERE, 'film'), work: WORK, shared: path.join(ROOT, 'lobby', 'shared') });
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn(`  [film error] ${e}`));
  page.on('console', (m) => { if (m.type() === 'error') console.warn(`  [film console] ${m.text()}`); });
  await page.goto(`${srv.origin}/film/index.html`);
  await page.waitForFunction(() => window.film && window.film.ready, null, { timeout: 60000 });
  await page.evaluate(() => window.film.ready);
  const duration = await page.evaluate(() => window.film.duration);
  const cdp = await context.newCDPSession(page);
  const shoot = async (format = 'jpeg') => {
    const { data } = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? quality : undefined, optimizeForSpeed: false });
    return Buffer.from(data, 'base64');
  };
  try {
    if (stills) {
      const dir = path.join(WORK, 'stills');
      mkdirSync(dir, { recursive: true });
      for (const t of stills) {
        await page.evaluate((x) => window.film.seek(x), t);
        const file = path.join(dir, `t${t.toFixed(2).padStart(6, '0')}.png`);
        writeFileSync(file, await shoot('png'));
        console.log(`  ${file}`);
      }
      return;
    }
    const end = to == null ? duration : Math.min(to, duration);
    const total = Math.round((end - from) * fps);
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(fps), out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
    const started = Date.now();
    for (let i = 0; i < total; i++) {
      const t = from + i / fps;
      await page.evaluate((x) => window.film.seek(x), t);
      const buf = await shoot();
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 60 === 0) process.stdout.write(`\r  film ${t.toFixed(1)}s / ${end.toFixed(1)}s (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
    ff.stdin.end();
    await done;
    process.stdout.write(`\r  film ${end.toFixed(1)}s rendered in ${((Date.now() - started) / 1000).toFixed(0)}s -> ${path.relative(process.cwd(), out)}\n`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const stills = opt('stills', null);
  render({
    fps: Number(opt('fps', 60)),
    scale: Number(opt('scale', 1)),
    from: Number(opt('from', 0)),
    to: opt('to', null) == null ? null : Number(opt('to', null)),
    out: path.resolve(opt('out', path.join(WORK, 'film.mp4'))),
    stills: stills ? stills.split(',').map(Number) : null,
  }).catch((e) => { console.error(e); process.exit(1); });
}
