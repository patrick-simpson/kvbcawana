/* global document -- used only inside page.waitForFunction, which runs in the browser */
// Rasterize SVGs to transparent PNGs with headless Chromium (MuPDF's own SVG
// reader ignores clip-path, which the Sparks gradient fill depends on).
// Usage: node svg2png.mjs jobs.json   where jobs = [{svg, png, width}]
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const PW = process.env.PW_CORE
  ? pathToFileURL(process.env.PW_CORE).href
  : new URL('../../node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(PW);
const jobs = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const j of jobs) {
  const svg = readFileSync(j.svg, 'utf8');
  const m = svg.match(/viewBox="([\d.\-e ]+)"/);
  const [, , vw, vh] = m[1].trim().split(/\s+/).map(Number);
  const w = Math.round(j.width), h = Math.round((j.width * vh) / vw);
  await page.setViewportSize({ width: w, height: h });
  const src = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  await page.setContent(`<html><body style="margin:0;background:transparent"><img id="i" src="${src}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
  await page.waitForFunction(() => document.getElementById('i').complete);
  await page.screenshot({ path: j.png, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
}
await browser.close();
console.log(`rasterized ${jobs.length} svg(s)`);
