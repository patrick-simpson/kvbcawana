// Decode the final mp4 in Chrome and compare frames to the lobby plate: node measure.mjs <mp4> t0 t1 step
import { createRequire } from 'module'; import { pathToFileURL, fileURLToPath } from 'url'; import path from 'path';
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)), REPO = path.resolve(HERE, '..', '..', '..', '..');
const { chromium } = require(path.join(REPO, 'lobby', 'node_modules', '@playwright', 'test'));
const [mp4, a, b, st] = process.argv.slice(2);
const b0 = await chromium.launch({ channel: 'chrome', args: ['--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
const p = await b0.newPage(); await p.goto(pathToFileURL(path.join(HERE, 'film.html')).href);
const out = await p.evaluate(async ({ v, pl, a, b, st }) => {
  const img = new Image(); img.src = pl; await img.decode();
  const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; const x = cv.getContext('2d', { willReadFrequently: true });
  x.drawImage(img, 0, 0); const P = x.getImageData(0, 0, 1920, 1080).data;
  const vid = document.createElement('video'); vid.src = v; vid.muted = true; await new Promise((r) => { vid.onloadeddata = r; });
  const res = [];
  for (let t = a; t <= b + 1e-6; t += st) {
    vid.currentTime = t; await new Promise((r) => { vid.onseeked = r; });
    x.drawImage(vid, 0, 0, 1920, 1080); const D = x.getImageData(0, 0, 1920, 1080).data;
    let s = 0; for (let i = 0; i < D.length; i += 4) s += Math.abs(D[i] - P[i]) + Math.abs(D[i + 1] - P[i + 1]) + Math.abs(D[i + 2] - P[i + 2]);
    res.push([+t.toFixed(3), +(s / (1920 * 1080 * 3)).toFixed(3)]);
  }
  return { res, dur: vid.duration, w: vid.videoWidth, h: vid.videoHeight };
}, { v: pathToFileURL(mp4).href, pl: pathToFileURL(path.join(HERE, '..', 'lobby-plate-sky.png')).href, a: +a, b: +b, st: +st });
console.log(JSON.stringify(out)); await b0.close();
