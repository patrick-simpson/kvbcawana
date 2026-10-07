import { expect, test } from '@playwright/test';

// Configure mode (?configure=1, src/lib/configureRelay.js): the sound room
// app's Settings window shows a screen's Settings beside the live screen, in
// the same browser profile. Two pages of one Playwright context are exactly
// that: one storage, one BroadcastChannel. The live screen must take every
// saved change and every relayed button without a reload, and the configure
// page must never become a second screen.

async function boot(context, query) {
  const page = await context.newPage();
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.goto(`/index.html${query}`);
  return page;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!localStorage.getItem('awanaConfig.v1')) localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' }));
  });
});

test('the configure page is Settings alone, with no Done and no gear', async ({ context }) => {
  const page = await boot(context, '?configure=1&lowPower=1');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/configure-mode/);
  await expect(dialog.getByText('Changes go live on the screen as you make them.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open settings' })).toHaveCount(0);
  // Escape and a click on the paper keep it open: there is nothing behind it.
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Setup' }).click();
  await expect(dialog.getByRole('button', { name: 'Debug panel' })).toHaveCount(0);
});

test('a setting changed there goes live on the screen, which never reloads', async ({ context }) => {
  const live = await boot(context, '?lowPower=1');
  await expect(live.locator('.stage')).toBeVisible();
  await live.evaluate(() => { window.__sameLoad = true; });
  const cfg = await boot(context, '?configure=1&lowPower=1');
  const dialog = cfg.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Screen & corner' }).click();
  await dialog.getByRole('checkbox', { name: 'Strip the screen to the basics' }).check();
  await expect(live.locator('.panic-pill')).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Strip the screen to the basics' }).uncheck();
  await expect(live.locator('.panic-pill')).toHaveCount(0);
  expect(await live.evaluate(() => window.__sameLoad)).toBe(true);
  // The configure page never shows the flag over its own (hidden) stage.
  await expect(live.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
});

test('Preview a check-in plays on the live screen, not in the configure page', async ({ context }) => {
  const live = await boot(context, '?lowPower=1');
  await expect(live.locator('.stage')).toBeVisible();
  const cfg = await boot(context, '?configure=1&lowPower=1');
  const dialog = cfg.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Check-ins' }).click();
  await dialog.getByRole('button', { name: 'Preview a check-in' }).click();
  await expect(live.locator('.checkin')).toBeVisible();
  await expect(live.locator('.demo-pill')).toBeVisible();
  await expect(cfg.locator('.checkin')).toHaveCount(0);
  await expect(dialog).toBeVisible();
});
