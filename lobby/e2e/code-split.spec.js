import { expect, test } from '@playwright/test';

// Code splitting (owner 2026-10-12): the operator panels (Settings, the slide
// editor, the debug panel, a managed screen) and the PowerPoint parser are
// chunks of their own (src/components/operatorPanels.jsx, src/lib/pptxModel.js).
// A screen boots on the main chunks alone, and the service worker precaches
// every chunk, so an offline screen still opens its panels.

const LAZY = /\/assets\/(SettingsPanel|RemoteScreenPanel|SlideEditorPanel|DebugPanel|pptxHandler)-[\w-]+\.js$/;

// The Pi Zero's embed: 640x480, ?lowPower=1. Nothing operator-only is fetched
// on the way to the first paint, nor after it while the lobby just runs.
test.use({ viewport: { width: 640, height: 480 } });

test('a lowPower Pi-sized screen boots on the main chunks alone', async ({ page }) => {
  const requested = [];
  page.on('request', (req) => requested.push(req.url()));
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage')).toBeVisible();
  await page.waitForTimeout(1500);

  expect(requested.filter((u) => LAZY.test(u))).toEqual([]);
  // Every script the page ran before its first paint is one its HTML names.
  const { early, named } = await page.evaluate(() => {
    const paint = performance.getEntriesByType('paint').find((e) => e.name === 'first-paint');
    const at = paint ? paint.startTime : Infinity;
    return {
      early: performance.getEntriesByType('resource')
        .filter((e) => e.startTime < at && /\/assets\/.+\.js$/.test(new URL(e.name).pathname))
        .map((e) => new URL(e.name).pathname.split('/').pop()),
      named: [...document.querySelectorAll('script[src], link[rel="modulepreload"]')]
        .map((el) => new URL(el.getAttribute('src') || el.getAttribute('href'), location.href).pathname.split('/').pop()),
    };
  });
  for (const file of early) expect(named).toContain(file);

  // Settings still opens: its chunk arrives on demand.
  await page.keyboard.press('Control+Shift+S');
  await expect(page.locator('.panel--settings.panel--tabbed')).toBeVisible();
  expect(requested.some((u) => /\/assets\/SettingsPanel-[\w-]+\.js$/.test(u))).toBe(true);
});

test('the service worker precaches every chunk the pages can load', async ({ request }) => {
  const text = async (path) => (await request.get(path)).text();
  const sw = await text('/sw.js');
  const precache = JSON.parse(sw.match(/const PRECACHE = (\[[\s\S]*?\]);/)[1]);

  const seen = new Set();
  const queue = [];
  for (const page of ['/index.html', '/settings.html', '/countdown.html']) {
    const html = await text(page);
    for (const m of html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+\.js)"/g)) queue.push(m[1]);
  }
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await text(`/${file}`);
    // Static imports and dynamic import("./x-<hash>.js") alike: chunks sit side
    // by side in assets/ (the hash keeps out "./sw.js" and friends).
    for (const m of code.matchAll(/["']\.\/([\w-]+-[\w-]{8}\.js)["']/g)) queue.push(`assets/${m[1]}`);
  }

  const files = [...seen];
  expect(files.filter((f) => LAZY.test(`/${f}`)).length).toBeGreaterThanOrEqual(5);
  for (const f of files) expect(precache).toContain(`./${f}`);
});
