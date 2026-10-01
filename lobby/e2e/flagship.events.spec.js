import { expect, test } from '@playwright/test';
import { fakePusher } from './fakePusher.js';

// The flagship slide against what happens over and around it, in a real
// browser with the real clock: check-ins play OVER it and it steps back for
// them (it never holds them), and it leads every pass through the deck.
// In the events project: multi-second and timing-sensitive, so ci.yml only.

const CONFIG = {
  pusherAppKey: 'e2e-key',
  pusherCluster: 'us2',
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  manualSlides: [
    { id: 's_a', eyebrow: '', text: 'SLIDE ALPHA', theme: 'sky', durationSec: 3 },
    { id: 's_b', eyebrow: '', text: 'SLIDE BRAVO', theme: 'sky', durationSec: 3 },
  ],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
  standardDisplayMs: 2000,
};

async function boot(page, query = '') {
  const send = await fakePusher(page);
  await page.addInitScript((c) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
  }, CONFIG);
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.flagship')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return send;
}

const child = (name, n) => ({ id: `${name}-${n}`, firstName: name, club: 'sparks', at: new Date().toISOString(), isBirthday: false, isFirstTimer: false });

for (const query of ['', '?lowPower=1']) {
  test(`a name plays over the flagship at once, the slide steps back for it, and comes forward again ${query || '(with motion)'}`, async ({ page }) => {
    test.setTimeout(45_000);
    const send = await boot(page, query);
    await send('checkin', child('Maya', 1));
    // Not held: no WAITING chip, and the name is on screen immediately.
    await expect(page.locator('.checkin')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.corner-chip--waiting')).toHaveCount(0);
    await expect(page.locator('.stage')).toHaveClass(/checkin-active/);
    // The slide behind steps back (its own transition settles in ~0.6 s; instant under ?lowPower=1).
    await expect.poll(async () => Number(await page.locator('.flagship').evaluate((e) => getComputedStyle(e).opacity)), { timeout: 3000 }).toBeLessThan(0.4);
    await expect(page.locator('.checkin')).toHaveCount(0, { timeout: 12_000 });
    await expect.poll(async () => Number(await page.locator('.flagship').evaluate((e) => getComputedStyle(e).opacity)), { timeout: 3000 }).toBe(1);
  });
}

test('the flagship leads every pass: flagship, then the operator\'s slides, then round to the flagship again', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 22_000) {
    const now = await page.evaluate(() => {
      if (document.querySelector('.flagship')) return 'FLAGSHIP';
      return document.querySelector('.manual-slide .lobby-headline')?.textContent.replace(/\s+/g, ' ').trim() || '';
    });
    if (now && seen.at(-1) !== now) seen.push(now);
    await page.waitForTimeout(250);
  }
  // 10 s flagship + 3 s + 3 s = 16 s a pass, so 22 s sees the flagship come round again.
  expect(seen.slice(0, 4)).toEqual(['FLAGSHIP', 'SLIDE ALPHA', 'SLIDE BRAVO', 'FLAGSHIP']);
});
