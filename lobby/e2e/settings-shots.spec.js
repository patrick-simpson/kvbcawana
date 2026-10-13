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

// The Trends card's source line (the trends back-fill, routes.md section 3), in
// each state the Worker answers, over a history with earlier seasons from
// TwoTimTwo beside the desk's own nights: history-import-<state>-<size>.png.
const OLD = ['2025-09-10', '2025-09-17', '2025-09-24', '2025-10-01', '2025-10-08'];
const seasonsIn = [{ season: '2026-27', nights: 6, importedAt: new Date(now - 3 * 3600000).toISOString() }];
for (let y = 2025; y >= 2016; y--) seasonsIn.push({ season: `${y}-${String((y + 1) % 100).padStart(2, '0')}`, nights: 30, importedAt: new Date(now - 3 * 3600000).toISOString() });
const IMPORT_STATES = {
  done: { state: 'done', seasons: seasonsIn, oldestSeason: '2016-17', nextDueAt: null, ended: 'empty', crosscheck: { compared: 4, matching: 4, differing: 0, deskHigher: 0, examples: [], at: new Date(now - 3 * 3600000).toISOString() } },
  running: { state: 'running', seasons: seasonsIn.slice(0, 3), oldestSeason: '2024-25', nextDueAt: new Date(now + 15000).toISOString(), ended: null, crosscheck: { compared: 4, matching: 3, differing: 1, deskHigher: 0, examples: [{ night: '2026-09-23', club: 'Sparks', desk: 18, twotimtwo: 20 }], at: new Date(now).toISOString() } },
  unreadable: { state: 'unreadable', seasons: [], oldestSeason: null, nextDueAt: new Date(now + 86400000).toISOString(), lastError: 'unreadable', unreadableWhy: 'header', ended: null, crosscheck: null },
  'not-configured': { state: 'not-configured', reason: 'no-secrets', seasons: [], oldestSeason: null, nextDueAt: null, ended: null, crosscheck: null },
};
for (const [size, viewport] of SIZES) {
  test.describe(`history import ${size}`, () => {
    test.use({ viewport, hasTouch: size === '390x844' });
    for (const [state, status] of Object.entries(IMPORT_STATES)) {
      test(state, async ({ page }) => {
        mkdirSync(OUT, { recursive: true });
        await page.route(/open-meteo|twotimtwo|kvbchurch\.org/, (route) => route.abort());
        const w = world();
        w.importStatus = status;
        if (state !== 'unreadable' && state !== 'not-configured') {
          w.summary = [...OLD.flatMap((night, i) => ['Sparks', 'Cubbies', 'Puggles'].map((club, j) => ({ night, club, checkedIn: 12 + i + j * 3, checkedOut: 0, undone: 0, prints: 0, imported: true }))), ...w.summary];
        }
        await installWorker(page, w);
        await page.goto('/settings.html?lowPower=1');
        const dialog = page.getByRole('dialog', { name: 'Settings' });
        await dialog.getByRole('tab', { name: 'History', exact: true }).click();
        await expect(dialog.locator('.hist-source')).toBeVisible();
        await expect(dialog.getByRole('img', { name: /Attendance by club/ })).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${OUT}/history-import-${state}-${size}.png` });
        if (state === 'done') {
          await dialog.getByRole('img', { name: /Checked out/ }).scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await page.screenshot({ path: `${OUT}/history-import-${state}-${size}-charts.png` });
        }
      });
    }
  });
}
