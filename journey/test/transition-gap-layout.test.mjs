// The club transition black and its welcome cards in a real browser
// (src/schedule/29-transition-gap.js): the real page and schedule.js, every
// request answered by the test (the kiosk's files from public/, the lobby's
// two schedule files and a stand-in lobby page under /lobby/), the clock fixed
// at 6:59 PM on a club night. Pure black around the cards; each card inside
// the screen, clear of the corner buttons (which stay above the black and
// clickable); two cards side by side, never overlapping. At 1080p and on a
// small 4:3 screen. AWANA_GAP_SHOTS=<dir> also saves the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const SHOTS = process.env.AWANA_GAP_SHOTS || '';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const SCHEDULE = { version: 1, timezone: 'America/New_York', meeting: { day: 3, start: '18:00' }, windows: [], specialDates: {} };
const FEED = { version: 1, generatedAt: '2026-10-01T12:00:00Z', events: [{ date: '2026-10-07', kind: 'club', title: 'Awana meeting', isCancelled: false, isSpecial: false }] };
const LOBBY = '<!doctype html><html><body style="margin:0;background:#1db6d9"><h1>Lobby</h1></body></html>';

async function open(browser, width, height, time) {
  const context = await browser.newContext({ viewport: { width, height }, timezoneId: 'America/New_York', reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.clock.install({ time });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'kiosk.test') return route.abort();
    const p = decodeURIComponent(url.pathname);
    if (p === '/lobby/') return route.fulfill({ body: LOBBY, contentType: 'text/html' });
    if (p === '/lobby/shared/schedule.json') return route.fulfill({ body: JSON.stringify(SCHEDULE), contentType: 'application/json' });
    if (p === '/lobby/calendar-feed.json') return route.fulfill({ body: JSON.stringify(FEED), contentType: 'application/json' });
    if (!p.startsWith('/journey/')) return route.fulfill({ status: 404, body: '' });
    const file = path.join(PUBLIC, p.slice('/journey/'.length) || 'index.html');
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://kiosk.test/journey/index.html');
  await page.waitForFunction(() => !document.getElementById('gap-view').classList.contains('hidden'));
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function handUp(page, data) {
  const frame = page.frames().find((f) => f.url().endsWith('/lobby/'));
  await frame.evaluate((m) => parent.postMessage({ type: 'awana-display:checkin', ...m }, location.origin), data);
}

const box = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}, sel);
const apart = (a, b) => a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

test('on the black: one welcome centred, then Journey and Trek side by side, clear of the corner buttons', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    for (const [width, height] of [[1920, 1080], [640, 480]]) {
      const { context, page } = await open(browser, width, height, new Date('2026-10-07T18:59:00-04:00'));
      const at = `${width}x${height}`;
      const bg = await page.evaluate(() => getComputedStyle(document.getElementById('gap-view')).backgroundColor);
      assert.equal(bg, 'rgb(0, 0, 0)', `${at}: pure black`);
      assert.equal(await page.isVisible('#checkin-frame') || await page.evaluate(() => document.getElementById('checkin-frame').isConnected), true, 'the frame stays in the page');
      // The buttons are the topmost thing at their own centres (above the black).
      for (const id of ['toggle-btn', 'settings-btn']) {
        const r = await box(page, `#${id}`);
        const top = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).closest('button')?.id || '', [(r.left + r.right) / 2, (r.top + r.bottom) / 2]);
        assert.equal(top, id, `${at}: ${id} is above the black`);
      }
      await handUp(page, { id: 'a', firstName: 'Abigail', club: 'Journey' });
      await page.waitForSelector('#gap-welcome-journey:not(.hidden)');
      const one = await box(page, '#gap-welcome-journey');
      assert.ok(one.left >= 0 && one.top >= 0 && one.right <= width && one.bottom <= height, `${at}: on the screen`);
      assert.ok(Math.abs((one.left + one.right) / 2 - width / 2) < 2, `${at}: centred`);
      if (SHOTS && width === 1920) await page.screenshot({ path: path.join(SHOTS, 'gap-journey-welcome-1080p.png') });
      await handUp(page, { id: 'b', firstName: 'Mateo', club: 'Journey' });
      await handUp(page, { id: 'c', firstName: 'Zoe', club: 'Trek' });
      await handUp(page, { id: 'd', firstName: 'Liam', club: 'Trek' });
      await handUp(page, { id: 'e', firstName: 'Priya', club: 'Trek' });
      await page.waitForSelector('#gap-welcome-trek:not(.hidden)');
      const j = await box(page, '#gap-welcome-journey');
      const t = await box(page, '#gap-welcome-trek');
      assert.ok(apart(j, t) && j.right <= t.left, `${at}: Journey left of Trek, apart`);
      for (const [name, r] of [['journey', j], ['trek', t]]) {
        assert.ok(r.left >= 0 && r.top >= 0 && r.right <= width && r.bottom <= height, `${at}: ${name} on the screen`);
        for (const id of ['toggle-btn', 'settings-btn']) assert.ok(apart(r, await box(page, `#${id}`)), `${at}: ${name} clear of ${id}`);
        const names = await box(page, `#gap-welcome-${name} .gap-welcome-names`);
        assert.ok(names.left >= r.left && names.right <= r.right && names.bottom <= r.bottom, `${at}: ${name}'s names inside the card`);
      }
      if (SHOTS && width === 1920) await page.screenshot({ path: path.join(SHOTS, 'gap-journey-and-trek-welcomes-1080p.png') });
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
