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
  ['tonight', 'Tonight'], ['printing', 'Printing'], ['screens', 'Screens'], ['show', 'What screens show'], ['look', 'Slides & look'],
  ['journey', 'Journey'], ['history', 'History'], ['account', 'Account & app'],
];
const SIZES = [['390x844', { width: 390, height: 844 }], ['1280x800', { width: 1280, height: 800 }]];

const now = Date.now();
const NIGHTS = ['2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07'];
const world = () => makeWorld({
  screens: [
    { id: 'tv_aaaaaaaaaaaaaaaaaaaa', kind: 'lobby', name: 'Front door TV', createdAt: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), online: true, live: true },
    { id: 'pj_bbbbbbbbbbbbbbbbbbbb', kind: 'projector', name: 'Gym projector', createdAt: new Date(now).toISOString(), lastSeen: new Date(now - 86400000).toISOString(), online: false, live: false },
    { id: 'jk_cccccccccccccccccccc', kind: 'journey', name: 'Journey room', createdAt: new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), online: true, live: false,
      status: { lessons: { saved: 24, total: 63, bytesSaved: 12e9, bytesTotal: 14e9, downloading: true, waiting: false, paused: false, percent: 42, currentWeek: 7, lastSavedAt: new Date(now - 600000).toISOString(), error: null, auto: true, leaders: true, known: true, supported: true } } },
    { id: 'jk_dddddddddddddddddddd', kind: 'journey', name: 'Journey back room', createdAt: new Date(now).toISOString(), lastSeen: new Date(now - 7200000).toISOString(), online: false, live: false,
      status: { lessons: { saved: 63, total: 63, bytesSaved: 14e9, bytesTotal: 14e9, downloading: false, waiting: false, paused: false, percent: 0, currentWeek: null, lastSavedAt: new Date(now - 86400000).toISOString(), error: null, auto: true, leaders: false, known: true, supported: true } } },
  ],
  journey: { savedAt: new Date(now - 3600000).toISOString(), settings: { captions: true, captionSize: '1.3', slidesAutoAdvanceSec: 30, slideExtras: { questions: true, takeaways: true, challenges: false } } },
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
        // The rest of the section, scrolled a screenful at a time (the dialog scrolls inside itself).
        const steps = await page.evaluate(() => {
          const pane = [...document.querySelectorAll('.panel--settings *')].find((el) => {
            const st = getComputedStyle(el);
            return /(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 4 && el.closest('.settings-pane');
          });
          if (!pane) return 0;
          pane.setAttribute('data-shot-scroll', '');
          return Math.min(8, Math.ceil((pane.scrollHeight - pane.clientHeight) / (pane.clientHeight * 0.85)));
        });
        for (let i = 1; i <= steps; i++) {
          await page.evaluate((n) => {
            const pane = document.querySelector('[data-shot-scroll]');
            pane.scrollTop = Math.round(n * pane.clientHeight * 0.85);
          }, i);
          await page.waitForTimeout(150);
          await page.screenshot({ path: `${OUT}/${id}-${size}-part${i + 1}.png` });
        }
      });
    }
  });
}
