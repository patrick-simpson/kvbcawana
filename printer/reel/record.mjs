#!/usr/bin/env node
// Films the real screens into reel/.work/footage/<shot>/00000.jpg ... at a
// steady 60 fps (or --fps), from the built site (site/dist).
//
//   node reel/record.mjs                 every shot
//   node reel/record.mjs lobby-run ...   just these
//   node reel/record.mjs --fps 30 ...    a quicker, rougher pass
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './lib/serve.mjs';
import { launch, openShot } from './lib/vclock.mjs';
import { SHOTS } from './shots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const WORK = path.join(HERE, '.work');
const SITE = path.join(ROOT, 'site', 'dist');

export async function record(names, { fps = 60 } = {}) {
  names = [...names];
  if (!existsSync(path.join(SITE, 'lobby', 'index.html'))) {
    throw new Error('site/dist is not built: run `SITE_ORIGIN=https://awana.kvbchurch.org node site/build.mjs` at the repo root first');
  }
  // The lobby's own video files (the flagship's 3D intro, the Grand Prix promo):
  // the screen draws them full frame, the first and last frames ARE the lobby,
  // so their frames are the footage, taken straight from the file the lobby
  // plays (a <video> does not run on the virtual clock).
  const fromVideo = names.filter((n) => SHOTS[n] && SHOTS[n].video);
  for (const name of fromVideo) {
    const spec = SHOTS[name];
    const dir = path.join(WORK, 'footage', name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(spec.from || 0), '-t', String(spec.seconds), '-i', path.join(ROOT, spec.video),
      '-vf', `fps=${fps},scale=1920:1080`, '-q:v', '2', '-start_number', '0', path.join(dir, '%05d.jpg')]);
    const frames = readdirSync(dir).filter((f) => f.endsWith('.jpg')).length;
    writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({
      fps, seconds: spec.seconds, frames, viewport: { width: 1920, height: 1080 }, dpr: 1, taps: [], video: spec.video, from: spec.from || 0,
    }, null, 2)}\n`);
    console.log(`  ${name}: ${frames} frames from ${spec.video}`);
  }
  names = names.filter((n) => !fromVideo.includes(n));
  if (!names.length) return;
  const srv = await serve({ site: SITE, film: path.join(HERE, 'film'), work: WORK });
  const browser = await launch();
  try {
    for (const name of names) {
      const spec = SHOTS[name];
      if (!spec) throw new Error(`no shot called ${name}`);
      const started = Date.now();
      const ctx = {};
      const shot = await openShot(browser, {
        viewport: spec.viewport || { width: 1920, height: 1080 },
        dpr: spec.dpr || 1,
        time: spec.time,
        paused: true,
        isMobile: !!spec.mobile,
        hasTouch: !!spec.mobile,
        setup: spec.setup ? (page) => spec.setup(page, ctx) : undefined,
      });
      ctx.now = () => shot.virtual;
      ctx.shot = shot;
      // A tap the film can draw: where (CSS px of the viewport) and when.
      ctx.taps = [];
      ctx.tap = async (page, selector) => {
        const target = page.locator(selector).first();
        const box = await target.boundingBox();
        if (box) ctx.taps.push({ t: shot.t, x: box.x + box.width / 2, y: box.y + box.height / 2 });
        if (spec.mobile) await target.tap();
        else await target.click();
      };
      await shot.page.goto(srv.origin + spec.url);
      await shot.page.waitForSelector(spec.ready || 'body', { state: 'attached' });
      await shot.page.evaluate(() => document.fonts.ready);
      await shot.start();
      if (spec.warmup) await spec.warmup(shot, ctx);
      const dir = path.join(WORK, 'footage', name);
      rmSync(dir, { recursive: true, force: true });
      await shot.record(dir, {
        seconds: spec.seconds, fps,
        cues: spec.cues ? spec.cues(ctx) : {},
      });
      writeFileSync(path.join(dir, 'meta.json'), `${JSON.stringify({
        fps, seconds: spec.seconds, frames: Math.round(spec.seconds * fps),
        viewport: spec.viewport || { width: 1920, height: 1080 }, dpr: spec.dpr || 1, taps: ctx.taps,
      }, null, 2)}\n`);
      await shot.close();
      console.log(`  ${name}: ${spec.seconds}s at ${fps} fps in ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  } finally {
    await browser.close();
    await srv.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let fps = 60;
  const i = args.indexOf('--fps');
  if (i !== -1) { fps = Number(args[i + 1]); args.splice(i, 2); }
  const names = args.length ? args : Object.keys(SHOTS);
  record(names, { fps }).catch((e) => { console.error(e); process.exit(1); });
}
