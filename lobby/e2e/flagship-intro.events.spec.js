import { expect, test } from '@playwright/test';
import { liveChannel } from './liveChannel.js';

// The flagship's 3D intro (src/components/FlagshipIntro.jsx), in a real browser
// playing the committed video (public/intro/awana-intro.mp4) on the real clock:
// the second pass's flagship carries on into it, the scene's tab and waves are
// handed over to it and back, and the deck moves on after it. Screens it does
// not fit, and zero animation, keep the plain flagship. In the events project:
// multi-second and timing-sensitive, so ci.yml only. Like every flagship spec,
// it misbehaves Wednesdays 6:30-8:30 pm (the flagship is off the air then).

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  manualSlides: [{ id: 's_a', eyebrow: '', text: 'SLIDE ALPHA', theme: 'sky', durationSec: 2 }],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
};

async function boot(page, query = '') {
  await liveChannel(page);
  await page.route(/open-meteo/, (r) => r.abort());
  await page.addInitScript((c) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaFlagshipTurn.v1', '0');
  }, CONFIG);
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.flagship')).toBeVisible();
}

const intro = (page) => page.locator('video.flagship-intro');
const chrome = (page) => page.locator('.lobby-chrome');

test('the second pass carries the flagship into the 3D intro and back, then the deck moves on', async ({ page }) => {
  test.setTimeout(90_000);
  await boot(page);
  // The first pass is the plain flagship (10 s), then the one slide (2 s).
  await expect(page.locator('.manual-slide-text', { hasText: 'SLIDE ALPHA' })).toBeVisible({ timeout: 15_000 });
  await expect(intro(page)).toBeAttached({ timeout: 10_000 });
  expect(await page.locator('.flagship:has(video.flagship-intro)').getAttribute('data-style')).toBe('bounce');
  expect(await page.locator('.flagship:has(video.flagship-intro)').getAttribute('data-version')).toBe('glad');
  await expect(intro(page)).not.toHaveClass(/is-shown/);
  // It plays, comes in over the slide, and the scene's tab and waves hand over to it.
  await expect(intro(page)).toHaveClass(/is-shown/, { timeout: 12_000 });
  await expect(chrome(page)).toHaveClass(/lobby-chrome--handed-over/);
  expect(await intro(page).evaluate((v) => !v.paused && v.currentTime > 0 && v.muted)).toBe(true);
  // ...and while it plays, the deck waits for it.
  await page.waitForTimeout(1_000);
  await expect(page.locator('.flagship:has(video.flagship-intro)')).toBeVisible();
  // Near its end (skipped ahead to save time): the tab and waves come back over it...
  await intro(page).evaluate((v) => { v.currentTime = 13.8; });
  await expect(chrome(page)).not.toHaveClass(/lobby-chrome--handed-over/, { timeout: 5_000 });
  await expect(intro(page)).toHaveClass(/is-shown/);
  // ...it ends and fades out over the slide, and the deck moves on.
  await expect(page.locator('video.flagship-intro.is-shown')).toHaveCount(0, { timeout: 5_000 });
  await expect(page.locator('.manual-slide-text', { hasText: 'SLIDE ALPHA' }).last()).toBeVisible({ timeout: 5_000 });
  await expect(intro(page)).toHaveCount(0, { timeout: 5_000 });
  await expect(chrome(page)).not.toHaveClass(/lobby-chrome--handed-over/);
});

test('a 4:3 screen keeps the plain flagship (the video is the 16:9 slide)', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await boot(page);
  await expect(page.locator('.manual-slide-text', { hasText: 'SLIDE ALPHA' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000); // into the second pass
  await expect(page.locator('.flagship').last()).toBeVisible();
  await expect(intro(page)).toHaveCount(0);
});

test('zero animation (?lowPower=1) keeps the plain flagship', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page, '?lowPower=1');
  await expect(page.locator('.manual-slide-text', { hasText: 'SLIDE ALPHA' })).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(3_000);
  await expect(page.locator('.flagship').last()).toBeVisible();
  await expect(intro(page)).toHaveCount(0);
});
