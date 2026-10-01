import { test as plain } from '@playwright/test';
import { advanceUntilVisible, expect, test } from './pastFlagship.js';

// A deployed build may carry a baked Pusher key (repository variables), so
// tests that need a screen with NO key seed an empty override rather than
// assuming one. Overrides win over the baked default; '' is a valid value.
const NO_KEY = () => localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' }));

// The signage page must boot cleanly with no Pusher key (socket status
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
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
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
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.goto('/index.html?overlay=1');
  await expect(page.locator('.stage.overlay')).toBeVisible();
  // Operator chrome never reaches an OBS/ProPresenter feed.
  await expect(page.locator('.setup-card')).toHaveCount(0);
});

// Slide sync, end to end from the cache: a screen that received a published
// deck renders THAT deck after a reboot — no network, no local slides. This
// is the boot path every display takes at 5pm on club night.
test('a cached synced deck renders in place of local slides', async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
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
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
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

// ?key= must reach the socket (an OBS/ProPresenter embed has no localStorage).
// Pusher itself is aborted, so the dot leaves "not set up" for connecting or
// disconnected — either proves the flag reached `new Pusher(...)`.
test('the ?key= URL flag reaches the socket', async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ showConnectionStatus: true, pusherAppKey: '' }));
  });
  await page.goto('/index.html');
  await expect(page.locator('.status-dot')).toContainText('not set up');
  await page.goto('/index.html?key=abc123&cluster=us2');
  await expect(page.locator('.status-dot')).not.toContainText('not set up');
});

// Saving the Pusher key in Settings connects the socket in the SAME tab —
// no reload. This is the first thing a volunteer does on a new screen.
test('saving the Pusher key in Settings connects without a reload', async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  // Keep the sticker visible once the screen leaves 'off' (it auto-shows
  // only for 'off' and for long drops).
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ showConnectionStatus: true, pusherAppKey: '' }));
  });
  await page.goto('/index.html');
  await expect(page.locator('.status-dot')).toContainText('not set up');
  await page.keyboard.press('Control+Shift+S');
  // With no key Settings opens on Setup, its Advanced fold already open.
  await page.getByLabel('Pusher App Key').fill('abc123');
  await page.getByLabel('Pusher Cluster').fill('us2');
  // Typed fields apply as they are left; Done applies the last one and closes.
  await page.locator('jelly-button:has-text("Done")').click();
  await expect(page.locator('.status-dot')).not.toContainText('not set up');
});
