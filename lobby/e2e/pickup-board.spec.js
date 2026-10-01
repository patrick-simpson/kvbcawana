import { expect, test } from '@playwright/test';

// The pickup board's columns and Settings' demo, in a real browser: one
// column per club, every name chip inside its column and the card, the card
// inside the room's middle, and the demo gone again after its 20 seconds.

async function open(page, query = '?lowPower=1') {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: '', seasonPromos: false, calendarEnabled: false,
  })));
  await page.clock.install();
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.stage')).toBeVisible();
}

async function startDemo(page) {
  await page.keyboard.press('Control+Shift+S');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Pickup board' }).click();
  await dialog.getByRole('button', { name: /Show a demo on this TV/ }).click();
  await expect(dialog).toBeHidden();
  const board = page.locator('.stage .checkout-board.names');
  await expect(board).toBeVisible();
  return board;
}

const within = (inner, outer, slack = 0.5) => inner.x >= outer.x - slack && inner.y >= outer.y - slack
  && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;

for (const [width, height] of [[1920, 1080], [1280, 720], [640, 480]]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the demo board stands one column per club, every chip inside its column and the card', async ({ page }) => {
      await open(page);
      const board = await startDemo(page);
      await expect(board.locator('.checkout-demo')).toHaveText('Demo · sample names');
      const columns = board.locator('.checkout-column');
      await expect(columns).toHaveCount(6);
      await page.evaluate(() => document.fonts.ready);
      const card = await board.boundingBox();
      // The card stays in the room's middle (12u to 46u of the 16:9 stage).
      const stage = await page.locator('.stage').boundingBox();
      const u = Math.min(stage.width, stage.height * 16 / 9) / 100;
      const top = stage.y + stage.height / 2 - 28.125 * u;
      expect(card.y).toBeGreaterThanOrEqual(top + 12 * u - 1);
      expect(card.y + card.height).toBeLessThanOrEqual(top + 46 * u + 1);
      for (const column of await columns.all()) {
        const box = await column.boundingBox();
        expect(within(box, card)).toBe(true);
        for (const chip of await column.locator('.checkout-name__chip').all()) {
          const c = await chip.boundingBox();
          expect(within(c, box, 1)).toBe(true);
          // The whole name is drawn, never cut short by the column.
          expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
        }
      }
      // The slides step aside behind it, as for a real pickup list.
      await expect(page.locator('.stage.board-up')).toHaveCount(1);
      // The demo badge marks the screen as not real.
      await expect(page.locator('.demo-pill')).toBeVisible();
    });
  });
}

test('the demo leaves after its 20 seconds, and the real (empty) board stays hidden', async ({ page }) => {
  await open(page);
  const board = await startDemo(page);
  await page.clock.runFor(19_000);
  await expect(board).toBeVisible();
  await page.clock.runFor(2_000);
  await expect(page.locator('.checkout-board')).toHaveCount(0);
});

test('Settings previews the board on sample names, and the guard empties it', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+Shift+S');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.getByRole('tab', { name: 'Pickup board' }).click();
  const preview = dialog.getByRole('img', { name: /preview of the pickup board/ });
  await expect(preview.locator('.checkout-column')).toHaveCount(6);
  const frame = await preview.boundingBox();
  const card = await preview.locator('.checkout-board').boundingBox();
  expect(within(card, frame)).toBe(true);
  await dialog.getByLabel("Who's still here board").selectOption('pickup');
  await dialog.getByLabel('Stop showing names at or below').fill('40');
  await expect(preview.locator('.checkout-column')).toHaveCount(0);
  await expect(preview).toContainText('Almost everyone has been picked up');
});
