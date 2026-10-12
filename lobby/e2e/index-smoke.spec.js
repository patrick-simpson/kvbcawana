import { test as plain } from '@playwright/test';
import { advanceUntilVisible, expect, test } from './pastFlagship.js';
import { liveChannel } from './liveChannel.js';

// A screen that has not signed in to the sync service: no saved overrides, so
// its socket status is 'off'.
const NO_KEY = () => localStorage.setItem('awanaConfig.v1', JSON.stringify({}));

// The signage page must boot cleanly when it is not signed in (socket status
// 'off' by design) and no network beyond its own origin. Cross-origin
// fetches (weather, calendar scrape) are aborted so the test is
// hermetic — the app is built to treat those as ordinary offline.
// Plain `test`, not the flagship-skipping one: a brand-new screen's first frame is
// the flagship with the first-run card over it, and that is what this looks at.
plain('signage stage boots with no errors and no external network', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    // Resource-load failures for the fetches we deliberately abort are
    // browser noise, not app errors.
    if (msg.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(NO_KEY);

  await page.goto('/index.html');
  await expect(page.locator('.stage')).toBeVisible();
  // The placeholder background ("screen is never blank") should render
  // since no PowerPoint embed URL is configured — and a brand-new screen
  // offers a volunteer a way in.
  await expect(page.locator('.setup-card')).toBeVisible();
  await expect(page.locator('.setup-card')).toContainText('Two quick setup steps');
  await page.waitForTimeout(1500);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('overlay mode renders a transparent stage', async ({ page }) => {
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.goto('/index.html?overlay=1');
  await expect(page.locator('.stage.overlay')).toBeVisible();
  // Operator chrome never reaches an OBS/ProPresenter feed.
  await expect(page.locator('.setup-card')).toHaveCount(0);
});

// Slide sync, end to end from the cache: a screen that received a published
// deck renders THAT deck after a reboot — no network, no local slides. This
// is the boot path every display takes at 5pm on club night.
test('a cached synced deck renders in place of local slides', async ({ page }) => {
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ backgroundSource: 'manual' }));
    localStorage.setItem('awanaSyncedSlides.v1', JSON.stringify({
      deckRev: 7,
      publishedAt: 1789939800000,
      slides: [{
        id: 's_sync', eyebrow: 'Awana Clubs', text: 'Synced from the check-in desk',
        theme: 'sky', textSize: 'auto', durationSec: 0,
      }],
    }));
  });
  await page.goto('/index.html');
  // getByText, not the class: the calendar slide crossfades with the deck, so two slides coexist briefly.
  await advanceUntilVisible(page, page.getByText('Synced from the check-in desk'));
  await expect(page.getByText('Synced from the check-in desk')).toBeVisible();
});

// The published deck is the DEFAULT background: a freshly logged-in screen
// with NO background setting saved shows the deck the check-in machine
// published, not the welcome placeholder.
test('a published deck shows on a screen with no background setting saved', async ({ page }) => {
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaSyncedSlides.v1', JSON.stringify({
      deckRev: 8,
      publishedAt: 1789939800000,
      slides: [{
        id: 's_sync', eyebrow: 'Awana Clubs', text: 'Published with nothing else set',
        theme: 'sky', textSize: 'auto', durationSec: 0,
      }],
    }));
  });
  await page.goto('/index.html');
  await advanceUntilVisible(page, page.getByText('Published with nothing else set'));
  await expect(page.getByText('Published with nothing else set')).toBeVisible();
});

// An OBS / ProPresenter link written before Pusher was retired still carries
// ?key= and ?cluster=. They are ignored: the page boots, and (signed in to
// nothing) the dot still says "not set up", exactly as without them.
test('an old link\'s Pusher ?key= and ?cluster= are ignored', async ({ page }) => {
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ showConnectionStatus: true }));
  });
  await page.goto('/index.html?key=abc123&cluster=us2');
  await expect(page.locator('.stage')).toBeVisible();
  await expect(page.locator('.status-dot')).toContainText('not set up');
});

// A signed-in screen listens on the sync service's live channel: the dot
// leaves "not set up" and reads connected once the socket opens.
test('a signed-in screen connects to the live channel', async ({ page }) => {
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await liveChannel(page);
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ showConnectionStatus: true }));
  });
  await page.goto('/index.html');
  await expect(page.locator('.status-dot')).toContainText('connected');
  await expect(page.locator('.status-dot')).not.toContainText('not set up');
});
