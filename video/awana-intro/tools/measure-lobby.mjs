#!/usr/bin/env node
// Measures the lobby's flagship welcome slide (bounce style, "We're so glad
// you're here!", at rest) exactly as a TV draws it, and writes
// ../lobby-layout.json for awana_intro.py.
//
// Why: the video starts and ends on that slide, and the lobby cuts into and
// out of it (lobby/src/components/FlagshipIntro.jsx). The cut is only
// invisible if every piece of the video's first and last frame sits where the
// lobby draws it, to the pixel. Guessing positions from the CSS drifted by
// 25 px at 1080p, so the script now fits its flat layout to these numbers.
//
// Everything is in lobby u (1% of the 16:9 screen's width; the screen is
// 100 x 56.25 u, origin top-left), measured at 1920x1080:
//   boxes     the INK box of each piece [left, top, right, bottom]: the logo's
//             three lines, the glad line, the six doodles (in FlagshipSlide's
//             DOODLES_AROUND order, the same as LAYOUT_DOODLES). Each piece is
//             drawn alone and its pixels found, so a box is what the eye sees.
//   outlines  the corner tab and the two house waves, as point lists along
//             their real SVG paths (as far as they go, off-screen included).
//
// Usage (from the repo root, after `cd lobby && npm ci`):
//   cd lobby && npm run build && cd ..
//   node video/awana-intro/tools/measure-lobby.mjs
// It serves lobby/dist itself (vite preview on a spare port) and needs no
// network. Re-run it whenever the flagship's look changes, then re-render.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const LOBBY = path.join(REPO, 'lobby');
const OUT = path.join(HERE, '..', 'lobby-layout.json');
const require = createRequire(path.join(LOBBY, 'package.json'));
const { chromium } = require('@playwright/test');

const PORT = 4179;
const W = 1920;
const H = 1080;
const U = W / 100;

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  manualSlides: [],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
};

function serve() {
  const vite = path.join(LOBBY, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { cwd: LOBBY, stdio: 'ignore' });
  return child;
}

async function waitFor(url, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never answered: build the lobby first (cd lobby && npm run build)`);
}

/** The bounding box of every pixel that differs from `base`, in px. */
async function inkBox(page, base, shot) {
  return page.evaluate(async ([a, b]) => {
    const load = async (b64) => createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = new OffscreenCanvas(ia.width, ia.height);
    const g = c.getContext('2d');
    g.drawImage(ia, 0, 0);
    const da = g.getImageData(0, 0, ia.width, ia.height).data;
    g.drawImage(ib, 0, 0);
    const db = g.getImageData(0, 0, ib.width, ib.height).data;
    const diff = new Uint8Array(ia.width * ia.height);
    let most = 0;
    for (let k = 0; k < diff.length; k += 1) {
      const i = k * 4;
      diff[k] = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2]));
      if (diff[k] > most) most = diff[k];
    }
    // An edge pixel counts once the shape covers half of it: the box is the
    // shape's own edge, not its antialiasing.
    const half = Math.max(8, most / 2);
    let x0 = Infinity; let y0 = Infinity; let x1 = -1; let y1 = -1;
    for (let y = 0; y < ia.height; y += 1) {
      for (let x = 0; x < ia.width; x += 1) {
        if (diff[y * ia.width + x] < half) continue;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
  }, [base.toString('base64'), shot.toString('base64')]);
}

const round = (n) => Math.round(n * 1000) / 1000;
const toU = (box) => box.map((v) => round(v / U));

async function main() {
  const server = serve();
  try {
    await waitFor(`http://127.0.0.1:${PORT}/index.html`);
    // Playwright's own Chromium if it is downloaded, else the computer's Chrome.
    const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chrome' }));
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    await page.route(/open-meteo/, (r) => r.abort());
    await page.addInitScript((c) => {
      localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
      localStorage.setItem('awanaSetupCardDismissed.v1', '1');
      // Turn 0 = bounce + the glad line (src/lib/flagship.js flagshipPick).
      localStorage.setItem('awanaFlagshipTurn.v1', '0');
    }, CONFIG);
    // ?lowPower=1: every beat at its last keyframe, the waves' roll at rest.
    await page.goto(`http://127.0.0.1:${PORT}/index.html?lowPower=1`);
    await page.waitForSelector('.flagship[data-style="bounce"][data-version="glad"]');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // Draw one piece alone: everything else hidden, the page's own colour behind.
    await page.addStyleTag({
      content: `html.iso, html.iso body, html.iso body * { background: #fff !important; }
        html.iso body * { visibility: hidden !important; }
        html.iso [data-iso], html.iso [data-iso] * { visibility: visible !important; }
        html.iso .lobby-tab__logo { visibility: hidden !important; }`,
    });
    const isolate = async (selector, index = 0) => page.evaluate(([sel, i]) => {
      document.querySelectorAll('[data-iso]').forEach((e) => e.removeAttribute('data-iso'));
      document.documentElement.classList.add('iso');
      const el = document.querySelectorAll(sel)[i];
      if (!el) throw new Error(`nothing matches ${sel} #${i}`);
      el.setAttribute('data-iso', '');
    }, [selector, index]);
    await page.evaluate(() => document.documentElement.classList.add('iso'));
    const base = await page.screenshot();
    const measure = async (selector, index = 0) => {
      await isolate(selector, index);
      const box = await inkBox(page, base, await page.screenshot());
      if (!box) throw new Error(`${selector} #${index} drew nothing`);
      return toU(box);
    };

    const logo = '.flagship-logo--full';
    const boxes = {
      church: await measure(`${logo} .kvbc-church`),
      awana: await measure(`${logo} .kvbc-awana`),
      tagline: await measure(`${logo} .kvbc-tagline`),
      glad: await measure('.flagship-line--glad'),
      doodles: [],
    };
    const doodleCount = await page.locator('.flagship-doodle').count();
    for (let i = 0; i < doodleCount; i += 1) boxes.doodles.push(await measure('.flagship-doodle', i));
    await page.evaluate(() => document.documentElement.classList.remove('iso'));

    // The tab and the waves: points along their real paths, in u.
    const outlines = await page.evaluate((u) => {
      const sample = (sel, n = 240) => {
        const p = document.querySelector(sel);
        if (!p) throw new Error(`nothing matches ${sel}`);
        const m = p.getScreenCTM();
        const len = p.getTotalLength();
        const pts = [];
        for (let k = 0; k < n; k += 1) {
          const q = p.getPointAtLength((k / n) * len);
          const s = new DOMPoint(q.x, q.y).matrixTransform(m);
          pts.push([Math.round((s.x / u) * 1000) / 1000, Math.round((s.y / u) * 1000) / 1000]);
        }
        return pts;
      };
      return {
        tab: sample('.lobby-tab > svg path'),
        waveSun: sample('.lobby-wave--sun svg path'),
        waveHouse: sample('.lobby-wave--house svg path'),
      };
    }, U);

    // The glad line letter by letter: where the browser puts each one (its
    // pen position, kerning and all; Blender's text has no kerning), its
    // baseline and its font size.
    const glad = await page.evaluate((u) => {
      const el = document.querySelector('.flagship-line--glad');
      const text = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE);
      if (!text) throw new Error('the glad line has no text of its own');
      const range = document.createRange();
      const glyphs = [];
      for (let i = 0; i < text.data.length; i += 1) {
        range.setStart(text, i);
        range.setEnd(text, i + 1);
        glyphs.push([text.data[i], Math.round((range.getBoundingClientRect().left / u) * 1000) / 1000]);
      }
      // A zero-size inline-block sits on the baseline.
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.appendChild(probe);
      const baseline = probe.getBoundingClientRect().top / u;
      probe.remove();
      return {
        font: getComputedStyle(el).fontFamily,
        size: Math.round((parseFloat(getComputedStyle(el).fontSize) / u) * 1000) / 1000,
        baseline: Math.round(baseline * 1000) / 1000,
        glyphs,
      };
    }, U);

    const layout = {
      note: 'Measured off the lobby by tools/measure-lobby.mjs; read by awana_intro.py. Lobby u, origin top-left, screen 100 x 56.25.',
      measuredAt: new Date().toISOString(),
      viewport: [W, H],
      boxes,
      outlines,
      glad,
    };
    writeFileSync(OUT, `${JSON.stringify(layout, null, 1)}\n`);
    console.log(`wrote ${path.relative(REPO, OUT)}`);
    console.log(JSON.stringify(boxes, null, 1));
    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
