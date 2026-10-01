#!/usr/bin/env node
/**
 * Render the custom Trek + Journey wordmark art boards to the
 * white-on-transparent PNGs the display bundles as club logos.
 *
 * Official Trek/Journey logo art isn't in the 2026-27 catalog PDF (their
 * sections fall outside the pages we have), so scripts/wordmarks/*.html
 * draw catalog-style siblings using the app's own bundled Baloo 2 font,
 * and this script screenshots them with a transparent background.
 *
 * Dev-side tool only (not part of the app build). Requires a Chromium
 * binary; pass one via CHROMIUM env var, or it falls back to the
 * Playwright install location and common system paths.
 *
 * Usage:  node scripts/render-club-wordmarks.mjs
 * Output: src/assets/clubs/{trek,journey}.png
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Prefer Playwright's headless shell: its --window-size is the exact
// viewport, while full Chromium's new headless reserves ~87px of window
// chrome and silently letterboxes the capture.
const CANDIDATE_BROWSERS = [
  process.env.CHROMIUM,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/opt/pw-browsers/chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter(Boolean);

const chromium = CANDIDATE_BROWSERS.find((p) => existsSync(p));
if (!chromium) {
  console.error('No Chromium found. Set CHROMIUM=/path/to/chrome and retry.');
  process.exit(1);
}

const BOARDS = [
  { name: 'trek', width: 620, height: 300 },
  { name: 'journey', width: 780, height: 252 },
];

for (const { name, width, height } of BOARDS) {
  const src = join(root, 'scripts', 'wordmarks', `${name}.html`);
  const dest = join(root, 'src', 'assets', 'clubs', `${name}.png`);
  execFileSync(chromium, [
    // headless_shell is headless-only; the flag is required for (and
    // harmless on) full Chromium.
    '--headless',
    '--no-sandbox',
    '--hide-scrollbars',
    // The art boards @font-face the repo's bundled Baloo 2 via file://.
    '--allow-file-access-from-files',
    '--force-device-scale-factor=1',
    // 8-digit hex without '#': fully transparent page background.
    '--default-background-color=00000000',
    // Fast-forwards virtual time until the page (incl. fonts) settles,
    // then forces a complete raster before the capture — without this the
    // screenshot can race the compositor and miss part of the board.
    '--virtual-time-budget=10000',
    '--run-all-compositor-stages-before-draw',
    `--window-size=${width},${height}`,
    `--screenshot=${dest}`,
    `file://${src}`,
  ], { stdio: 'pipe' });
  const kb = Math.round(statSync(dest).size / 1024);
  console.log(`${name}: ${width}x${height} -> ${dest} (${kb} KB)`);
}
