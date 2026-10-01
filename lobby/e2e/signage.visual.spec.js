import { expect, test } from '@playwright/test';

// Visual regression for the lobby signage (index.html), the screen the
// rebrand changes most. Determinism:
//   ?lowPower=1         — zero animation: every M element jumps straight to
//                         its resting frame and every CSS animation is off
//   page.clock          — a fixed Wednesday wall clock that only moves when
//                         the test says so, so slide rotation, banner holds
//                         and the corner clock are identical on every run
//   seeded Math.random  — the demo simulators pick names and clubs at random
//                         (reseeded at each click, see boot()), and the idle
//                         scene scatters its doodles at random
//   fixture calendar    — the nightly Action rewrites the real feed
// Baselines are Linux-Chromium only; regenerate them with the
// update-snapshots workflow (or `npm run e2e:update` on Linux).

test.skip(process.platform !== 'linux', 'baselines are Linux-Chromium only');

const NOW = new Date('2026-09-16T18:10:00-04:00');

async function boot(page, { setupCard = false } = {}) {
  // install() alone lets time flow in real time; pauseAt() stops it, so
  // from here on only runFor() moves timers, frames or the wall clock.
  await page.clock.install({ time: new Date(NOW.getTime() - 60_000) });
  await page.clock.pauseAt(NOW);
  await page.addInitScript(({ setupCard }) => {
    // Reseeded on every click, in the capture phase (before React's own
    // listener), so a simulator's name and club pick reads the same two
    // values every run. Seeding once at load is not enough: framer-motion's
    // AnimatePresence draws a Math.random() on every render, and how many
    // renders land before the click depends on timing.
    const SEED = 0x2f6e2b1;
    let seed = SEED;
    document.addEventListener('click', () => { seed = SEED; }, true);
    Math.random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    try {
      if (!setupCard) localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    } catch { /* storage blocked: the card simply shows */ }
  }, { setupCard });
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.route('**/calendar-feed.json', (route) =>
    route.fulfill({ path: 'e2e/fixtures/calendar-feed.json', contentType: 'application/json' })
  );
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.clock.runFor(1500);
}

/** Fire one debug-panel simulator, close the panel, let the banner land. */
async function simulate(page, name) {
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.debug')).toBeVisible();
  await page.getByRole('button', { name }).click();
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.debug')).toHaveCount(0);
  await page.clock.runFor(2500);
  await page.evaluate(() => document.fonts.ready);
}

const SHOT = { animations: 'disabled', maxDiffPixelRatio: 0.01 };

test('visual: signage idle, first run', async ({ page }) => {
  await boot(page, { setupCard: true });
  await expect(page).toHaveScreenshot('signage-idle-first-run.png', SHOT);
});

for (const [name, file] of [
  ['Standard welcome', 'signage-welcome'],
  ['Birthday welcome', 'signage-birthday'],
  ['First-timer welcome', 'signage-first-timer'],
  ['Show tonight ticker', 'signage-ticker'],
]) {
  test(`visual: ${file}`, async ({ page }) => {
    await boot(page);
    await simulate(page, name);
    await expect(page).toHaveScreenshot(`${file}.png`, SHOT);
  });
}
