// Deterministic frame capture for the Grand Prix concept previews.
//   node capture.mjs <concept> [seconds=20] [frames=all|list]
//   GP_HD=1 node capture.mjs ...   finals: 1920x1080 (the 960x540 layout drawn at 2x), 60 fps
// Loads concepts/<concept>/index.html in Chrome, injects window.GP (brand
// tokens, kit SVG sources, the photo camera), sets T = frame/30, screenshots.
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const BRAND = path.join(REPO, 'shared', 'brand');
const { chromium } = require(path.join(REPO, 'lobby', 'node_modules', '@playwright', 'test'));
const concept = process.argv[2], secs = +(process.argv[3] || 30), list = process.argv[4];
const SCR = 'C:/Users/User/scratch-intro/gp';
const HD = process.env.GP_HD === '1', FPSN = HD ? 60 : 30, SCALE = HD ? 2 : 1, BG = HD ? 'bg1080' : 'bg';
const OUT = path.join(SCR, concept, HD ? 'frames1080' : 'frames'); fs.mkdirSync(OUT, { recursive: true });
const svg = {};
for (const d of ['logos', 'shapes', 'doodles']) for (const f of fs.readdirSync(path.join(BRAND, d))) if (f.endsWith('.svg')) svg[`${d}/${f}`] = fs.readFileSync(path.join(BRAND, d, f), 'utf8');
const camConcept = concept === 'flat-brand' ? null : concept;
const camFile = camConcept && (HD ? path.join(SCR, camConcept, BG, 'cam.json') : path.join(SCR, camConcept, 'cam.json'));
const GPdata = {
  tokens: JSON.parse(fs.readFileSync(path.join(BRAND, 'tokens.json'), 'utf8')), svg,
  cam: camFile && fs.existsSync(camFile) ? JSON.parse(fs.readFileSync(camFile, 'utf8')) : { C: [1000, 753], TW: [[748, 1], [1506, 2.6]], cams: [] },
  bgDir: pathToFileURL(path.join(SCR, camConcept || 'x', BG)).href + '/',
  fps: FPSN, scale: SCALE,
  plate: pathToFileURL(path.join(HERE, '..', 'lobby-plate-sky.png')).href,
  wave: JSON.parse(fs.readFileSync(path.join(SCR, 'plate', 'wave.json'), 'utf8')),
};
const browser = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 960 * SCALE, height: 540 * SCALE }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('page:', m.text())); page.on('pageerror', (e) => console.log('ERR', e.message));
await page.addInitScript((d) => { window.GP = d; }, GPdata);
await page.goto(pathToFileURL(path.join(HERE, '..', concept, 'index.html')).href, { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const N = Math.round(secs * FPSN);
const frames = list ? list.split(',').map(Number) : [...Array(N).keys()];
for (const f of frames) {
  await page.evaluate((T) => window.renderFrame(T), f / FPSN);
  await page.locator('#c').screenshot({ path: path.join(OUT, `frame_${String(f).padStart(4, '0')}.png`) });
  if (f % (FPSN * 2) === 0) console.log(concept, f, '/', N);
}
await browser.close();
console.log('frames ->', OUT);
