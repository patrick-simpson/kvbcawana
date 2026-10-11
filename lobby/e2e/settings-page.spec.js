import { expect, test } from '@playwright/test';

// The one settings page (awana.kvbchurch.org/settings → settings.html,
// SETTINGS.md): configure mode on a device that is not a screen. Every
// screen's shared settings and signing in, none of this browser's own cards,
// and no button that acts on a screen (those reach a chosen screen later).

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo|kvbchurch\.org/, (route) => route.abort());
  await page.goto('/settings.html?lowPower=1');
});

test('it is Settings alone, opening on Sign in until signed in', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveTitle('KVBC Awana Settings');
  await expect(page.locator('html')).toHaveClass(/configure-mode/);
  await expect(dialog.getByRole('heading', { name: 'KVBC Awana Settings' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(dialog.getByText('Advanced — paste keys by hand')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Done' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open settings' })).toHaveCount(0);
});

test('no section shows a "This screen" card or a button that acts on a screen', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  for (const name of ['Status', 'Check-ins', 'Slides', 'Screen & corner', 'Celebrations', 'Pickup board', 'Look & season', 'Setup']) {
    await dialog.getByRole('tab', { name }).click();
    await expect(dialog.locator('.scope-tag--screen')).toHaveCount(0);
  }
  await dialog.getByRole('tab', { name: 'Check-ins' }).click();
  await expect(dialog.getByRole('button', { name: /Preview a check-in/ })).toHaveCount(0);
  await expect(dialog.locator('.scope-tag--shared').first()).toBeVisible();
  await dialog.getByRole('tab', { name: 'Screen & corner' }).click();
  await expect(dialog.getByRole('heading', { name: 'Simplified mode' })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Slides' }).click();
  await expect(dialog.getByRole('button', { name: /Edit slides/ })).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Follow published slides' })).toHaveCount(0);
  await dialog.getByRole('tab', { name: 'Setup' }).click();
  await expect(dialog.getByRole('button', { name: /Reset tonight/ })).toHaveCount(0);
});
