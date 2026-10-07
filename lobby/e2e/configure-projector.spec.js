import { expect, test } from '@playwright/test';

// The projector's configure page (?configure=1, views/ConfigureView.jsx) in
// the same browser context as the live projector, as the sound room app's
// Settings window has it: a wall pick there moves the projector, and a switch
// flipped there reaches it without a reload.

const NOW = 'now=2026-09-16T15:00:00';

test('a wall pick in the configure page moves the live projector', async ({ context }) => {
  const live = await context.newPage();
  await live.goto(`/countdown.html?${NOW}`);
  await expect(live.locator('[data-mode="countdown"]')).toBeVisible();
  await live.evaluate(() => { window.__sameLoad = true; });

  const cfg = await context.newPage();
  await cfg.goto(`/countdown.html?configure=1&${NOW}`);
  const page = cfg.getByRole('main', { name: 'Projector settings' });
  await expect(page).toBeVisible();
  // Nothing of the wall is drawn there.
  await expect(cfg.locator('[data-mode]')).toHaveCount(0);
  await expect(page.getByRole('switch', { name: /Full screen/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'T&T Game Time' }).click();
  await expect(live.locator('[data-mode="game-time"]')).toBeVisible();
  await page.getByRole('button', { name: 'Resume Schedule' }).click();
  await expect(live.locator('[data-mode="countdown"]')).toBeVisible();
  expect(await live.evaluate(() => window.__sameLoad)).toBe(true);
});

test('a switch flipped in the configure page reaches the live projector', async ({ context }) => {
  const live = await context.newPage();
  await live.goto(`/countdown.html?${NOW}`);
  const liveToggle = live.getByRole('button', { name: 'Low power mode' });
  await expect(liveToggle).not.toHaveClass(/brand-tnt/);

  const cfg = await context.newPage();
  await cfg.goto(`/countdown.html?configure=1&${NOW}`);
  await cfg.getByRole('switch', { name: /Low power mode/ }).click();
  await expect(liveToggle).toHaveClass(/brand-tnt/);
  await cfg.getByRole('switch', { name: /Low power mode/ }).click();
  await expect(liveToggle).not.toHaveClass(/brand-tnt/);
});
