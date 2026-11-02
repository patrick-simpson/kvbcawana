#!/usr/bin/env node
// Captures the projector's countdown at "0:00", alone on black, exactly as
// the gym's wall draws it at 1920x1080, for the grand welcome film's first
// frames (../grand_welcome.py reads ../projector-zero.png).
//
// Why: the film starts FROM the countdown (BRIEF.md): at 6:00 the projector
// cuts from its countdown to the film, so the film's opening "0:00" has to sit
// on the countdown's own pixels. In its last ten seconds the countdown shows
// only its figures (CountdownView FINAL_SEC); it never draws 0:00 itself (it
// turns to the ceremony as it reaches it), so this script opens it a few
// seconds before 6:00 and sets the figures to 0:00 as BigTimer draws zero
// (white figures, orange colons, no urgency rings, no shake), in the page's
// own fonts and layout, then saves the picture. It also writes the figures'
// cells to ../projector-layout.json, for the record.
//
// Usage (from the repo root, after `cd lobby && npm ci`):
//   cd lobby && npm run build && cd ..
//   node video/grand-welcome/tools/measure-projector.mjs
// It serves lobby/dist itself (vite preview on a spare port) and needs no
// network. Re-run it whenever the countdown's figures change, then re-render.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const LOBBY = path.join(REPO, 'lobby');
const PLATE = path.join(HERE, '..', 'projector-zero.png');
const LAYOUT = path.join(HERE, '..', 'projector-layout.json');
const require = createRequire(path.join(LOBBY, 'package.json'));
const { chromium } = require('@playwright/test');

const PORT = 4181;
const W = 1920;
const H = 1080;
// A club Wednesday, five seconds before the ceremony.
const NOW = '2026-11-04T17:59:55';

function serve() {
  const vite = path.join(LOBBY, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(process.execPath, [vite, 'preview', '--port', String(PORT), '--strictPort'], { cwd: LOBBY, stdio: 'ignore' });
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

const server = serve();
try {
  const base = `http://localhost:${PORT}`;
  await waitFor(`${base}/countdown.html`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  // The page's clock: a little before NOW, running, then stopped at NOW so
  // nothing ticks under the edit below.
  await page.clock.install({ time: new Date(new Date(NOW).getTime() - 3000) });
  await page.goto(`${base}/countdown.html`);
  await page.waitForSelector('[data-countdown-final="1"]', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);   // the step-away has finished
  await page.clock.pauseAt(new Date(NOW));
  await page.waitForTimeout(800);    // the last figure has rolled in
  // The colons' pulse (a CSS animation the page clock doesn't stop) at rest.
  await page.addStyleTag({ content: '.pj-timer__colon { animation: none !important; opacity: 1 !important; }' });
  const cells = await page.evaluate(() => {
    // Hand tools a first-run projector shows (never on the configured wall).
    for (const el of document.querySelectorAll('.pj-setup-note, [data-pj-bottom-overlay], [data-slideshow-nav]')) el.remove();
    // ...and the "clock off by" warning this script's own stopped clock sets off.
    for (const el of document.querySelectorAll('[title], .pj-touch-drift')) {
      if (/clock off by/i.test(el.textContent || '')) el.remove();
    }
    // 0:00 as BigTimer draws zero: white figures, orange colons, no urgency.
    for (const el of document.querySelectorAll('.animate-pulse-ring')) el.remove();
    for (const el of document.querySelectorAll('.animate-screen-shake')) el.classList.remove('animate-screen-shake');
    const timer = document.querySelector('.pj-timer');
    timer.style.color = '#FFFFFF';
    for (const c of timer.querySelectorAll('.pj-timer__colon')) c.style.color = '#FAA41D';
    for (const d of timer.querySelectorAll('.pj-reel__digit')) {
      d.textContent = '0';
      d.style.transform = 'none';
      d.style.opacity = '1';
    }
    return [...timer.children].map((el) => {
      const r = el.getBoundingClientRect();
      return { kind: el.classList.contains('pj-timer__colon') ? 'colon' : 'digit', box: [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * 100) / 100) };
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: PLATE });
  writeFileSync(LAYOUT, `${JSON.stringify({ size: [W, H], now: NOW, cells }, null, 2)}\n`);
  await browser.close();
  console.log(`saved ${PLATE}\n      ${LAYOUT}`);
} finally {
  server.kill();
}
