import { expect, test } from '@playwright/test';

// The pledges, as big as fits (owner, 2026-09-30: "make the pledge of
// allegiance and the awana pledge text a lot larger"): measured on the real
// page at the projector's sizes, the words fill the band between the Awana
// mark and the bottom margin band, at 1.5x the old 3u or more, and every
// row the page draws is a row the fit counted.

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('awanaPresentationSetupDismissed.v1', '1'));
});

const SIZES = [[1920, 1080], [1280, 720], [1024, 768]];

for (const [width, height] of SIZES) {
  test(`both pledges fill the wall, and stay inside it, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/countdown.html?now=2026-09-30T18:01:00&freeze=1&vr=1');
    await expect(page.locator('[data-slide="welcome"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['us-pledge', 'awana-pledge']) {
      // The deck listens for keys a moment after its first paint: press until the slide is up.
      await expect
        .poll(async () => {
          const now = await page.locator('[data-slide]').first().getAttribute('data-slide');
          if (now !== id) await page.keyboard.press('Space');
          return page.locator('[data-slide]').first().getAttribute('data-slide');
        }, { timeout: 10_000, intervals: [300] })
        .toBe(id);
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => {
        const block = document.querySelector('.pj-slide--pledge');
        const frame = block.closest('.pj-frame').getBoundingClientRect();
        const u = frame.width / 100;
        const b = block.getBoundingClientRect();
        const body = block.querySelector('.pj-body');
        const words = [...body.querySelectorAll('.w')].map((e) => e.getBoundingClientRect());
        return {
          size: parseFloat(getComputedStyle(body).fontSize) / u,
          top: (b.top - frame.top) / u,
          bottom: (Math.max(...words.map((r) => r.bottom)) - frame.top) / u,
          left: (Math.min(...words.map((r) => r.left)) - frame.left) / u,
          right: (Math.max(...words.map((r) => r.right)) - frame.left) / u,
          rows: new Set(words.map((r) => Math.round(r.top))).size,
          fitRows: Number(block.dataset.pledgeRows),
        };
      });
      expect(m.size, id).toBeGreaterThanOrEqual(4.5);
      expect(m.top, id).toBeGreaterThanOrEqual(10.9);
      expect(m.bottom, id).toBeLessThanOrEqual(51.75);
      expect(m.left, id).toBeGreaterThanOrEqual(5.9);
      expect(m.right, id).toBeLessThanOrEqual(94.1);
      expect(m.rows, id).toBe(m.fitRows);
    }
  });
}
