#!/usr/bin/env node
// Captures the lobby's flagship welcome slide AT REST, exactly as a TV draws
// it at 1920x1080, as the plates the intro film is built on (film.html):
//
//   plates/rest.png     the whole slide (bounce style, "We're so glad you're
//                       here!"): the film's first and last frame.
//   plates/bg.png       the same with the logo and the glad line taken away
//                       (the field, the corner tab, the waves, the doodles).
//   plates/<line>.png   each line of the logo and the glad line alone, as
//                       ink on a clear background (church, awana, tagline, glad).
//
// The film only ever moves these captured pieces, so its first and last
// frames are the lobby's own pixels and the cut into and out of the video is
// invisible. Re-run whenever the flagship's look changes, then render again.
//
//   cd lobby && npm ci && npm run build && cd ..
//   node video/lobby-intro/capture.mjs
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const LOBBY = path.join(REPO, 'lobby');
const OUT = path.join(HERE, 'plates');
const require = createRequire(path.join(LOBBY, 'package.json'));
const { chromium } = require('@playwright/test');

const PORT = 4181;
const W = 1920;
const H = 1080;
const INK = [0x23, 0x1f, 0x20];

// The same quiet lobby tools/measure-lobby.mjs measured for the old film.
const CONFIG = {
  backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: [],
  showClock: false, showTally: false, showWeatherChip: false, particleEffect: 'off',
  confettiLevel: 'off', firstArrivalMoment: false,
};

const PIECES = {
  church: '.flagship-logo--full .kvbc-church',
  awana: '.flagship-logo--full .kvbc-awana',
  tagline: '.flagship-logo--full .kvbc-tagline',
  glad: '.flagship-line--glad',
};

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never answered: build the lobby first (cd lobby && npm run build)`);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const vite = path.join(LOBBY, 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { cwd: LOBBY, stdio: 'ignore' });
  try {
    await waitFor(`http://127.0.0.1:${PORT}/index.html`);
    const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.route(/open-meteo/, (r) => r.abort());
    await page.addInitScript((c) => {
      localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
      localStorage.setItem('awanaSetupCardDismissed.v1', '1');
      localStorage.setItem('awanaFlagshipTurn.v1', '0');   // bounce + the glad line
    }, CONFIG);
    await page.goto(`http://127.0.0.1:${PORT}/index.html?lowPower=1`);   // every beat at its last keyframe
    await page.waitForSelector('.flagship[data-style="bounce"][data-version="glad"]');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);

    // A TV that is signed in shows no status sticker; this capture is not signed in, so its
    // "NOT SET UP" sticker (top right) is left out of every plate.
    await page.addStyleTag({ content: '.sticker-chip { visibility: hidden !important; }' });
    await page.waitForTimeout(100);
    writeFileSync(path.join(OUT, 'rest.png'), await page.screenshot());

    await page.addStyleTag({ content: `
      html.nocopy .flagship-logo, html.nocopy .flagship-line { visibility: hidden !important; }
      html.iso, html.iso body, html.iso body * { background: #fff !important; }
      html.iso body * { visibility: hidden !important; }
      html.iso [data-iso], html.iso [data-iso] * { visibility: visible !important; }
      html.iso .lobby-tab__logo { visibility: hidden !important; }` });
    await page.evaluate(() => document.documentElement.classList.add('nocopy'));
    writeFileSync(path.join(OUT, 'bg.png'), await page.screenshot());
    await page.evaluate(() => document.documentElement.classList.remove('nocopy'));

    const boxes = {};
    for (const [name, selector] of Object.entries(PIECES)) {
      await page.evaluate((sel) => {
        document.querySelectorAll('[data-iso]').forEach((e) => e.removeAttribute('data-iso'));
        document.documentElement.classList.add('iso');
        const el = document.querySelector(sel);
        if (!el) throw new Error(`nothing matches ${sel}`);
        el.setAttribute('data-iso', '');
      }, selector);
      const shot = (await page.screenshot()).toString('base64');
      // Ink on white -> ink with alpha (the logo is one colour, so the white
      // behind it gives its coverage exactly).
      const out = await page.evaluate(async ([b64, ink]) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const img = g.getImageData(0, 0, bmp.width, bmp.height);
        const d = img.data;
        let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
        for (let i = 0; i < d.length; i += 4) {
          const a = Math.max(0, Math.min(1, ((255 - d[i]) / (255 - ink[0]) + (255 - d[i + 1]) / (255 - ink[1]) + (255 - d[i + 2]) / (255 - ink[2])) / 3));
          d[i] = ink[0]; d[i + 1] = ink[1]; d[i + 2] = ink[2]; d[i + 3] = Math.round(a * 255);
          if (a > 0.02) {
            const p = i / 4; const x = p % bmp.width; const y = (p - x) / bmp.width;
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
          }
        }
        g.putImageData(img, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (let i = 0; i < buf.length; i += 1) s += String.fromCharCode(buf[i]);
        return { png: btoa(s), box: [x0, y0, x1 + 1, y1 + 1] };
      }, [shot, INK]);
      writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(out.png, 'base64'));
      boxes[name] = out.box;
    }
    writeFileSync(path.join(OUT, 'boxes.json'), `${JSON.stringify({ note: 'Ink boxes [left, top, right, bottom] in px at 1920x1080, by capture.mjs.', boxes }, null, 1)}\n`);
    console.log('plates written:', boxes);
    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
