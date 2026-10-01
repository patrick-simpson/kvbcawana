import { expect, test } from '@playwright/test';

// The Settings panel's two-pane layout in a real browser: the rail beside the
// section on a TV or laptop, the list then one section on a phone, and Done
// always on screen. Changes apply as they are made, so closing is never a
// question.

const NO_KEY = () => localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' }));

async function open(page, query = '') {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.addInitScript(NO_KEY);
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.stage')).toBeVisible();
  await page.keyboard.press('Control+Shift+S');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog).toBeVisible();
  return dialog;
}

const inside = (box, { width, height }) => box.x >= 0 && box.y >= 0
  && box.x + box.width <= width + 0.5 && box.y + box.height <= height + 0.5;

for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 768]]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the rail and the section stand side by side, and Done is on screen', async ({ page }) => {
      const dialog = await open(page, '?lowPower=1');
      const nav = await dialog.locator('.settings-nav').boundingBox();
      const pane = await dialog.locator('.settings-pane').boundingBox();
      expect(nav.width).toBeGreaterThan(150);
      expect(pane.x).toBeGreaterThanOrEqual(nav.x + nav.width - 1);
      // Every section is one click away: all eight rail items are visible.
      for (const item of await dialog.getByRole('tab').all()) {
        expect(inside(await item.boundingBox(), { width, height })).toBe(true);
      }
      const done = dialog.locator('.actions button.primary', { hasText: /^done$/i });
      expect(inside(await done.boundingBox(), { width, height })).toBe(true);
      // An unconfigured screen opens on Setup, where the fix is.
      await expect(dialog.getByRole('tab', { name: 'Setup' })).toHaveAttribute('aria-selected', 'true');
      await expect(dialog.getByLabel('Pusher App Key')).toBeVisible();
    });

    test('a change applies at once and Undo puts it back', async ({ page }) => {
      const dialog = await open(page, '?lowPower=1');
      await dialog.getByRole('tab', { name: 'Screen & corner' }).click();
      await dialog.getByRole('checkbox', { name: 'Wall clock' }).click();
      const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('awanaConfig.v1') || '{}'));
      expect((await saved()).showClock).toBe(false);
      await dialog.getByRole('button', { name: 'Undo changes' }).click();
      expect(await saved()).toEqual({ pusherAppKey: '' });
      await expect(dialog.getByRole('checkbox', { name: 'Wall clock' })).toBeChecked();
    });
  });
}

test.describe('on a phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('the list comes first, a tap opens the section full width, and All settings goes back', async ({ page }) => {
    const dialog = await open(page, '?lowPower=1');
    await expect(dialog.locator('.settings-pane')).toBeHidden();
    const tabs = dialog.getByRole('tab');
    await expect(tabs).toHaveCount(8);
    for (const item of await tabs.all()) {
      const box = await item.boundingBox();
      // A thumb-sized target, inside the screen.
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(inside(box, { width: 390, height: 844 })).toBe(true);
    }
    await dialog.getByRole('tab', { name: 'Celebrations' }).click();
    await expect(dialog.locator('.settings-nav')).toBeHidden();
    const pane = await dialog.locator('.settings-pane').boundingBox();
    const panel = await dialog.boundingBox();
    expect(pane.width).toBeGreaterThan(panel.width - 4);
    await expect(dialog.getByLabel('Room milestone (every N check-ins)')).toBeVisible();
    // Nothing in the section runs off the side.
    const overflow = await dialog.locator('.panel-body').evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const back = dialog.getByRole('button', { name: 'Back to all settings' });
    await expect(back).toBeFocused();
    await back.click();
    await expect(dialog.locator('.settings-nav')).toBeVisible();
    const done = dialog.locator('.actions button.primary', { hasText: /^done$/i });
    expect(inside(await done.boundingBox(), { width: 390, height: 844 })).toBe(true);
    await done.click();
    await expect(dialog).toBeHidden();
  });
});

test('Escape closes, and focus goes back to where it was', async ({ page }) => {
  const dialog = await open(page, '?lowPower=1');
  await expect(dialog.getByRole('tab', { name: 'Setup' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
