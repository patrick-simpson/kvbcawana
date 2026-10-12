import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { installWorker, makeWorld } from './settingsStub.js';

// Screenshots of the settings page, signed in (a stand-in Worker and live
// channel), one per section per size. Not part of the suite: it runs only
// when SETTINGS_SHOTS names a folder (a sandbox's scratchpad), never in CI.
//   SETTINGS_SHOTS=/some/dir npx playwright test --project=smoke e2e/settings-shots.spec.js

const OUT = process.env.SETTINGS_SHOTS;
test.skip(!OUT, 'set SETTINGS_SHOTS to a folder to take the screenshots');

const SECTIONS = [
  ['tonight', 'Tonight'], ['screens', 'Screens'], ['show', 'What screens show'], ['look', 'Slides & look'],
  ['printing', 'Printing'], ['history', 'History'], ['account', 'Account & app'],
];
const SIZES = [['390x844', { width: 390, height: 844 }], ['1366x768', { width: 1366, height: 768 }]];

const now = Date.now();
const NIGHTS = ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];
const world = () => makeWorld({
  screens: [
    { id: 'tv_aaaaaaaaaaaaaaaaaaaa', kind: 'lobby', name: 'Front door TV', createdAt: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), online: true, live: true },
    { id: 'pj_bbbbbbbbbbbbbbbbbbbb', kind: 'projector', name: 'Gym projector', createdAt: new Date(now).toISOString(), lastSeen: new Date(now - 86400000).toISOString(), online: false, live: false },
  ],
  nights: NIGHTS.map((night, i) => ({ night, rows: 60 + i * 7, kinds: { checkin: 55 + i * 7, visitor: 5 } })),
  summary: NIGHTS.flatMap((night, i) => ['Sparks', 'Cubbies', 'Puggles'].map((club, j) => ({ night, club, checkedIn: 14 + i * 2 + j * 3, checkedOut: 12 + i, undone: 0, prints: 16 }))),
  notice: null,
});

for (const [size, viewport] of SIZES) {
  test.describe(size, () => {
    test.use({ viewport, hasTouch: size === '390x844' });
    for (const [id, name] of SECTIONS) {
      test(`${id}`, async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
        const send = await installWorker(page, world());
        await page.goto('/settings.html?lowPower=1');
        const dialog = page.getByRole('dialog', { name: 'Settings' });
        await expect(dialog).toBeVisible();
        if (id === 'tonight') {
          await expect(dialog.getByTestId('mission-total')).toHaveText('42');
          for (const [i, first] of ['Maya', 'Noah', 'Ivy', 'Leo', 'Zoe', 'Eli'].entries()) {
            await send('checkin', { id: `c${i}`, at: new Date(now + i * 1000).toISOString(), firstName: first, club: ['Sparks', 'Cubbies', 'Puggles'][i % 3], isBirthday: false, isFirstTimer: false });
          }
          await expect(dialog.getByTestId('mission-recent').locator('li')).toHaveCount(5);
        }
        await dialog.getByRole('tab', { name, exact: true }).click();
        if (id === 'show') await dialog.getByRole('heading', { name: 'Welcome banners' }).hover();
        await expect(dialog.getByRole('heading', { level: 3 }).first()).toBeVisible();
        await page.waitForTimeout(700);
        await page.screenshot({ path: `${OUT}/${id}-${size}.png` });
      });
    }
  });
}
