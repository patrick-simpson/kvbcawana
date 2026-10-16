#!/usr/bin/env node
// `npm run reel` (in printer/): the whole film from its sources, in order.
//
//   1. the site, if site/dist is not built yet (--site rebuilds it anyway)
//   2. the labels      (labels.cjs: the print server's own renderer)
//   3. the footage     (record.mjs: the real screens, frame by frame)
//   4. the film        (render.mjs: film/ at 1920x1080, 30 fps)
//   5. the edit        (edit.mjs: soundtrack, encodes, poster)
//
// Writes printer/public/reel/{reel.mp4, poster.jpg}.
// --draft stops after a quick 720p/30 fps cut (reel/.work/draft.mp4).
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { record } from './record.mjs';
import { render } from './render.mjs';
import { edit } from './edit.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2);
const draft = args.includes('--draft');
const step = (name) => console.log(`\n── ${name}`);

const started = Date.now();
if (args.includes('--site') || !existsSync(path.join(ROOT, 'site', 'dist', 'lobby', 'index.html'))) {
  step('site');
  execFileSync('node', ['site/build.mjs'], {
    cwd: ROOT, stdio: 'inherit', env: { ...process.env, SITE_ORIGIN: process.env.SITE_ORIGIN || 'https://awana.kvbchurch.org' },
  });
}
step('labels');
execFileSync('node', [path.join(HERE, 'labels.cjs')], { stdio: 'inherit' });
step('footage');
await record(Object.keys((await import('./shots.mjs')).SHOTS), { fps: 60 });
step('film');
if (draft) {
  await render({ fps: 30, scale: 2 / 3, out: path.join(HERE, '.work', 'draft-film.mp4') });
} else {
  // The site plays 30 fps (edit.mjs), so the film is drawn at 30.
  await render({ fps: 30, scale: 1 });
}
step('edit');
edit({ draft });
console.log(`\nreel done in ${((Date.now() - started) / 60000).toFixed(1)} min`);
