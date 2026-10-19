import { expect, test } from '@playwright/test';
import { liveChannel } from './liveChannel.js';

// The projector obeys the opening-ceremony remote (owner 2026-10-19): a
// screen action rung on the live channel for ITS id moves the opening deck
// like the arrow keys, and a backup covers the wall until it is taken down.

const ID = 'pj_bbbbbbbbbbbbbbbbbbbb';
const ring = (send, action, data) => send('changed', { what: 'screen-action', id: ID, action, ...(data ? { data } : {}) });

test.use({ viewport: { width: 1920, height: 1080 } });

test('Next and Back move the opening deck; a backup covers the wall until taken down', async ({ page }, info) => {
  const send = await liveChannel(page);
  await page.addInitScript((id) => { localStorage.setItem('awanaScreens.v1', JSON.stringify({ projector: { id } })); }, ID);
  await page.goto('/countdown.html?now=2026-09-16T18:00:30');
  await expect(page.locator('[data-mode="slideshow"] [data-slide]')).toHaveAttribute('data-slide', 'welcome');

  await ring(send, 'slide-next');
  await expect(page.locator('[data-slide]').first()).toHaveAttribute('data-slide', 'us-pledge');
  await ring(send, 'slide-prev');
  await expect(page.locator('[data-slide]').first()).toHaveAttribute('data-slide', 'welcome');
  // Another screen's action is not this projector's.
  await send('changed', { what: 'screen-action', id: 'tv_aaaaaaaaaaaaaaaaaaaa', action: 'slide-next' });

  for (const what of ['us-flag', 'awana-flag', 'verse']) {
    await ring(send, 'backup', { what });
    const backup = page.locator(`[data-backup="${what}"]`);
    await expect(backup).toBeVisible();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: info.outputPath(`backup-${what}.png`) });
  }
  // A Next over a backup only takes the backup down; the deck stays put.
  await ring(send, 'slide-next');
  await expect(page.locator('.pj-backup')).toHaveCount(0);
  await expect(page.locator('[data-slide]').first()).toHaveAttribute('data-slide', 'welcome');

  await ring(send, 'backup', { what: 'verse' });
  await expect(page.locator('[data-backup="verse"]')).toBeVisible();
  await ring(send, 'backup-end');
  await expect(page.locator('.pj-backup')).toHaveCount(0);
  await ring(send, 'backup', { what: 'us-flag' });
  await expect(page.locator('[data-backup="us-flag"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pj-backup')).toHaveCount(0);
});
