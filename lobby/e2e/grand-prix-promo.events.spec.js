import { expect, test } from '@playwright/test';
import { liveChannel } from './liveChannel.js';

// The Awana Grand Prix promo (src/components/promos/GrandPrixPromo.jsx), in a
// real browser playing the committed video (public/promos/grand-prix.mp4) on
// the real clock, through the deck: it comes in under the stinger on the sky
// field, the scene's tab and waves come home under its end card, and it leaves
// for the next slide with NO stinger (its last second is the lobby itself).
// The date is moved into its window (Tuesday 2027-01-05, flagship on air) for
// this page only; the snow slide takes the slot's first lap, so the promo is
// the second pass's. In the events project: long and timing-sensitive.

const FEED = {
  version: 1,
  generatedAt: '2027-01-05T15:00:00.000Z',
  sourceUrl: 'https://example.invalid/calendar/index',
  events: ['2027-01-06', '2027-01-13', '2027-01-20'].map((date) => ({ date, kind: 'club', title: 'Awana', isCancelled: false, isSpecial: false })),
};

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: true,
  calendarShowWelcome: false,
  calendarShowNextWeek: false,
  calendarShowRemaining: false,
  seasonPromos: true,
  manualSlides: [{ id: 's_a', eyebrow: '', text: 'SLIDE ALPHA', theme: 'sky', durationSec: 3 }],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
};

async function boot(page) {
  await liveChannel(page);
  await page.route(/open-meteo/, (r) => r.abort());
  await page.route('**/calendar-feed.json', (r) => r.fulfill({ body: JSON.stringify(FEED), contentType: 'application/json' }));
  await page.addInitScript((c) => {
    // Only Date moves: timers, animation frames and the video keep the real clock.
    const offset = new Date('2027-01-05T12:00:00-05:00').getTime() - Date.now();
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
      static now() { return Real.now() + offset; }
    }
    window.Date = Shifted;
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaFlagshipTurn.v1', '0');
  }, CONFIG);
  await page.goto('/index.html');
  await expect(page.locator('.flagship')).toBeVisible();
}

const video = (page) => page.locator('video.grand-prix-promo__video');
const chrome = (page) => page.locator('.lobby-chrome');

test('the Grand Prix plays on the sky, hands the tab and waves back under its end, and leaves with no stinger', async ({ page }) => {
  test.setTimeout(150_000);
  await boot(page);
  await expect(video(page)).toBeAttached({ timeout: 100_000 });
  // It came in under the stinger, on the field its last frame is drawn on.
  await expect(page.locator('.catalog-scene')).toHaveClass(/catalog-scene--sky/);
  await expect(chrome(page)).toHaveClass(/lobby-chrome--away/);
  await page.evaluate(() => { window.__wave = document.querySelector('.slide-stinger'); });
  await expect.poll(() => video(page).evaluate((v) => !v.paused && v.currentTime > 0 && v.muted), { timeout: 10_000 }).toBe(true);
  // Into its still end card (skipped ahead to save time): the tab and waves come home over it.
  await video(page).evaluate((v) => { v.currentTime = 26; });
  await expect(chrome(page)).toHaveClass(/lobby-chrome--home/, { timeout: 5_000 });
  await expect(chrome(page)).not.toHaveClass(/lobby-chrome--away/);
  await expect(page.locator('.grand-prix-promo')).toBeVisible();
  // It ends, goes, and the next slide lands: no second stinger swept the screen.
  await expect(page.locator('.manual-slide-text', { hasText: 'SLIDE ALPHA' }).last()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.grand-prix-promo')).toHaveCount(0, { timeout: 5_000 });
  expect(await page.evaluate(() => document.querySelector('.slide-stinger') === window.__wave)).toBe(true);
  await expect(chrome(page)).toHaveClass(/lobby-chrome--home/);
  await expect(page.locator('.catalog-scene')).toHaveClass(/catalog-scene--sky/);
});
