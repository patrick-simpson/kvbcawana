// Stamps the published copy of classroom/public with its build id (site/build.mjs
// runs it on site/dist/classroom; the committed index.html keeps "dev"):
//   - <meta name="classroom-build" content="<id>">, which app.js compares with
//     version.json to reload itself onto a new build (only while the screen is black);
//   - version.json {build, builtAt};
//   - ?v=<id> on every local asset the page names (STAMPED), so a reload never
//     pairs the new page with a stale script from the disk cache (app.js asks
//     for logic.js with its own ?v=).
// Usage: node scripts/stamp-build.mjs <build-id> <published dir>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const STAMPED = ['brand/tokens.css', 'brand/fonts.css', 'src/style.css', 'src/app.js', 'art/cubbie-waving.svg'];

const [build, dir] = process.argv.slice(2);
if (!/^[0-9a-f]{7,64}$/.test(build || '') || !dir) {
  console.error('usage: stamp-build.mjs <hex build id> <dir>');
  process.exit(1);
}
const file = path.join(dir, 'index.html');
let html = readFileSync(file, 'utf8');
const meta = /<meta name="classroom-build" content="[^"]*">/;
if (!meta.test(html)) throw new Error('index.html has no classroom-build meta');
html = html.replace(meta, `<meta name="classroom-build" content="${build}">`);
for (const asset of STAMPED) {
  const plain = new RegExp(`(["'])${asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\?v=[0-9a-f]+)?\\1`, 'g');
  if (!plain.test(html)) throw new Error(`index.html no longer names ${asset}`);
  html = html.replace(plain, (_m, q) => `${q}${asset}?v=${build}${q}`);
}
writeFileSync(file, html);
writeFileSync(path.join(dir, 'version.json'), `${JSON.stringify({ build, builtAt: new Date().toISOString() })}\n`);
console.log(`classroom build ${build}`);
