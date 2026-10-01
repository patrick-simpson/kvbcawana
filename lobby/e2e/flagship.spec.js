import { expect, test } from '@playwright/test';

// The permanent flagship slide (src/lib/flagship.js, FlagshipSlide.jsx): the
// first thing a typed-deck screen shows. Under ?lowPower=1 (which is also how
// the paused-clock visual suite sees it) every beat is already at its last
// keyframe, so the finished slide must be on screen at once.

const CONFIG = {
  pusherAppKey: 'e2e-key',
  pusherCluster: 'us2',
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

async function boot(page, query = '?lowPower=1', config = CONFIG) {
  // The flagship is off the air Wednesdays 6:30-8:30 pm by the page's own
  // clock (src/lib/flagship.js): pin a morning so these tests hold at any
  // real hour, including a club night's.
  await page.clock.install({ time: new Date('2026-09-23T10:00:00-04:00') });
  await page.route(/open-meteo|pusher/, (r) => r.abort());
  await page.addInitScript((c) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
  }, config);
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.flagship')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('a screen with no slides of its own opens on the finished flagship, at rest under ?lowPower=1', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.flagship')).toHaveAttribute('aria-label', /welcome to awana/i);
  // Every letter of both rows, fully lit and in place.
  const letters = await page.locator('.flagship-letter').evaluateAll((els) => els.map((e) => ({
    op: Number(getComputedStyle(e).opacity),
    t: getComputedStyle(e).transform,
  })));
  expect(letters.length).toBe('WELCOME'.length + 'TOAWANA!'.length);
  for (const l of letters) {
    expect(l.op).toBe(1);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(l.t);
  }
  expect(await page.locator('.flagship-plate, .flagship-kicker, .flagship-wave, .flagship-tab').count()).toBe(0);
  // The foot is the scene's own chrome, as on every typed slide: the orange
  // house wave and its sunflower, and the orange corner tab, all home.
  await expect(page.locator('.lobby-chrome')).not.toHaveClass(/lobby-chrome--away/);
  const chrome = await page.evaluate(() => {
    const box = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    return { house: box('.lobby-wave--house'), sun: box('.lobby-wave--sun'), tab: box('.lobby-tab'), vw: innerWidth, vh: innerHeight };
  });
  expect(chrome.house.b).toBeGreaterThan(chrome.vh - 2);
  expect(chrome.house.t).toBeGreaterThan(chrome.vh * 0.75);
  // Both doodle clusters stand in their own halves of the frame (a stray
  // `inset: auto` once stacked them both at the top-left).
  const clusters = await page.evaluate(() => ['left', 'right'].map((side) => {
    const b = document.querySelector(`.flagship-doodle-slot--${side} .flagship-doodles`).getBoundingClientRect();
    return { side, l: b.left, r: b.right, vw: innerWidth };
  }));
  expect(clusters[0].r).toBeLessThan(clusters[0].vw * 0.4);
  expect(clusters[1].l).toBeGreaterThan(clusters[1].vw * 0.6);
  expect(chrome.tab.l).toBeLessThanOrEqual(1);
  expect(chrome.tab.t).toBeLessThanOrEqual(1);
  // Zero animation: nothing is moving, and the sheen has left.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  expect(Number(await page.locator('.flagship-sheen').evaluate((e) => getComputedStyle(e).opacity))).toBe(0);
});

test('the headline stays clear of the corner tab and the foot at every common size', async ({ page }) => {
  await boot(page);
  for (const [w, h] of [[1024, 768], [1280, 720], [1366, 768], [1920, 1080], [3840, 2160]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(150);
    const boxes = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
      const rows = [...document.querySelectorAll('.flagship-row')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
      return { tab: r('.lobby-tab'), rows, vw: innerWidth, vh: innerHeight };
    });
    const u = Math.min(boxes.vw / 100, boxes.vh / 56.25);
    const frameTop = (boxes.vh - 56.25 * u) / 2;
    const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    for (const row of boxes.rows) {
      expect(overlap(row, boxes.tab), `${w}x${h}: a headline row under the corner tab`).toBe(false);
      expect(row.l, `${w}x${h}`).toBeGreaterThan(0);
      expect(row.r, `${w}x${h}`).toBeLessThan(boxes.vw);
    }
    // The lobby's content ends 45u down (LAYOUT.safeBottom): nothing of the headline below it.
    const lowestRow = Math.max(...boxes.rows.map((r) => r.b));
    expect(lowestRow - frameTop, `${w}x${h}: the headline below 45u`).toBeLessThanOrEqual(45.2 * u);
  }
});
