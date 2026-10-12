#!/usr/bin/env node
// Films the real screens into reel/.work/footage/<shot>/00000.jpg ... at a
// steady 60 fps (or --fps), from the built site (site/dist).
//
//   node reel/record.mjs                 every shot
//   node reel/record.mjs lobby-run ...   just these
//   node reel/record.mjs --fps 30 ...    a quicker, rougher pass
import { existsSync, rmSync, writeFileSync } from 'node:fs';
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
  if (!existsSync(path.join(SITE, 'lobby', 'index.html'))) {
    throw new Error('site/dist is not built: run `SITE_ORIGIN=https://awana.kvbchurch.org node site/build.mjs` at the repo root first');
  }
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
