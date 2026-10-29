// Deterministic capture of film.html: node capture.mjs [hd] [workers=4] [frames=list|a-b]
//   check: 960x540 at 30 fps -> C:/Users/User/scratch-intro/gp/gp-brand/frames
//   hd:    1920x1080 at 60 fps -> .../frames1080
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const { chromium } = require(path.join(REPO, 'lobby', 'node_modules', '@playwright', 'test'));
const HD = process.argv[2] === 'hd', WORKERS = +(process.argv[3] || 4), LIST = process.argv[4];
const FPS = HD ? 60 : 30, SCALE = HD ? 1 : 0.5, SECS = 30;
const OUT = path.join('C:/Users/User/scratch-intro/gp/gp-brand', HD ? 'frames1080' : 'frames'); fs.mkdirSync(OUT, { recursive: true });
const CFG = {
  fps: FPS, scale: SCALE,
  plate: pathToFileURL(path.join(HERE, '..', 'lobby-plate-sky.png')).href,
  wave: JSON.parse(fs.readFileSync('C:/Users/User/scratch-intro/gp/plate/wave.json', 'utf8')),
};
let frames = [...Array(Math.round(SECS * FPS)).keys()];
if (LIST) frames = LIST.includes('-') ? (([a, b]) => frames.filter((f) => f >= a && f <= b))(LIST.split('-').map(Number)) : LIST.split(',').map(Number);
const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
const t0 = Date.now();
await Promise.all([...Array(WORKERS).keys()].map(async (w) => {
  const page = await browser.newPage({ viewport: { width: 1920 * SCALE, height: 1080 * SCALE }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('ERR', e.message)); page.on('console', (m) => console.log('page:', m.text()));
  await page.addInitScript((d) => { window.CFG = d; }, CFG);
  await page.goto(pathToFileURL(path.join(HERE, 'film.html')).href, { waitUntil: 'load' });
  await page.evaluate(() => window.ready);
  const mine = frames.filter((_, i) => i % WORKERS === w);
  for (const f of mine) {
    await page.evaluate((T) => window.renderFrame(T), f / FPS);
    await page.locator('#c').screenshot({ path: path.join(OUT, `frame_${String(f).padStart(4, '0')}.png`) });
    if (w === 0 && f % (FPS * 2) < WORKERS) console.log('frame', f, ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
}));
await browser.close();
console.log('done', frames.length, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's ->', OUT);
