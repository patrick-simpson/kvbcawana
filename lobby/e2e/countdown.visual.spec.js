import { expect, test } from '@playwright/test';

// Visual regression over the schedule boundary states. Determinism:
//   ?freeze=1 — the simulated clock never ticks
//   ?vr=1     — all CSS animation + framer-motion transforms killed,
//               ambient particle/weather layers unmounted
//   fixture-routed calendar feed — the nightly Action rewrites the real
//               one, which would invalidate baselines weekly
// Baselines are Linux-Chromium only (authoring env and CI are both
// Linux); regenerate with `npm run e2e:update`.
const STATES = [
  { now: '2026-09-15T18:30:00', name: 'countdown' },
  { now: '2026-09-16T18:00:30', name: 'slideshow-opening' },
  { now: '2026-09-16T18:10:00', name: 'game-time-tnt' },
  { now: '2026-09-16T19:31:00', name: 'slideshow-closing' },
  { now: '2026-09-16T19:40:00', name: 'shutdown' },
];

test.skip(process.platform !== 'linux', 'baselines are Linux-Chromium only');

for (const { now, name } of STATES) {
  test(`visual: ${name}`, async ({ page }) => {
    await page.route('**/calendar-feed.json', (route) =>
      route.fulfill({ path: 'e2e/fixtures/calendar-feed.json', contentType: 'application/json' })
    );
    await page.goto(`/countdown.html?now=${now}&freeze=1&vr=1`);
    await expect(page.locator('[data-mode]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled',
      maxDiffPixelRatio: 0.01,
      mask: [page.locator('[data-live]')],
    });
  });
}
