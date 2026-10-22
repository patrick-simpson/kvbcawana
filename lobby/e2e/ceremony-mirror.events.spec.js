import { expect, test } from '@playwright/test';
import { embed } from './embedHost.js';
import { liveChannel } from './liveChannel.js';

// The lobby mirrors the game time projector during the opening ceremony
// (owner 2026-10-19): the projector's own page in a hidden frame, turned over
// to the moment its ceremony starts and handed back when games start;
// check-ins in between wait (WAITING chip) and play after.
//
// Real time throughout: Playwright's fake clock does not drive the
// animations inside the frame, so the test seam loads the mirror now and
// time-travels the projector inside it to 5:59:58 (?now=, its own QA flag).
// The ceremony ends at its closing blackout (owner 2026-10-22: "the other
// screens should un duplicate once we get to the pure black screen"): the gym
// projector announces that slide.

test.use({ viewport: { width: 1280, height: 720 } });

const GYM = 'pj_bbbbbbbbbbbbbbbbbbbb';

test('the lobby turns over to the projector at 6:00, labelled; names wait and play at the blackout', async ({ page }) => {
  const send = await liveChannel(page);
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    window.awanaMirrorTuning = { wanted: true, query: `&now=${encodeURIComponent('2026-09-16T17:59:58-04:00')}` };
  });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage')).toBeVisible();

  const mirror = page.locator('[data-testid="ceremony-mirror"]');
  const frame = page.frameLocator('.lobby-mirror__frame');
  // Loaded hidden, counting down; then 6:00 and the lobby is the projector.
  await expect(mirror).toHaveAttribute('data-up', '0');
  await expect(frame.locator('[data-mode="slideshow"] [data-grand-welcome]')).toBeAttached({ timeout: 10000 });
  await expect(mirror).toHaveAttribute('data-up', '1');
  // The copy says what it is (owner 2026-10-22).
  await expect(page.locator('[data-testid="ceremony-label"]')).toHaveText('Opening ceremony in progress');

  // A check-in now waits behind the WAITING chip.
  await send.all('checkin', { id: 'e2e-ceremony', firstName: 'Penelope', club: 'Sparks', at: new Date().toISOString() });
  await expect(page.locator('.corner-chip--waiting')).toContainText('1');
  await expect(page.locator('.stage')).not.toContainText(/Penelope/i);

  // The gym projector moves to a slide: the mirror follows.
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'slide-go', data: { index: 2 } });
  await expect(frame.locator('[data-slide]').first()).toHaveAttribute('data-slide', 'awana-pledge');
  // A backup on the gym shows on the lobby too, and comes down with it.
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'backup', data: { what: 'verse' } });
  await expect(frame.locator('[data-backup="verse"]')).toBeVisible();
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'backup-end' });
  await expect(frame.locator('.pj-backup')).toHaveCount(0);

  // The gym reaches its blackout: the lobby comes back (no label) and the name plays.
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'slide-go', data: { index: 3 } });
  await expect(frame.locator('[data-slide]').first()).toHaveAttribute('data-slide', 'black-slide');
  await expect(mirror).toHaveAttribute('data-up', '0');
  await expect(page.locator('[data-testid="ceremony-label"]')).toHaveCount(0);
  await expect(page.locator('.stage')).toContainText(/Penelope/i, { timeout: 15000 });
});

// Owner 2026-10-22: "go back to countdown" (an accidental jump to game time).
// The remote's Back to the countdown reaches every projector, the lobby's copy
// too: it goes to the countdown and the lobby stops copying; the gym's Next
// then starts the ceremony again and the lobby copies it again.
test("the remote's Back to the countdown takes the copy down; the ceremony started again brings it back", async ({ page }) => {
  const send = await liveChannel(page);
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    window.awanaMirrorTuning = { wanted: true, query: `&now=${encodeURIComponent('2026-09-16T17:59:58-04:00')}` };
  });
  await page.goto('/index.html?lowPower=1');
  const mirror = page.locator('[data-testid="ceremony-mirror"]');
  const frame = page.frameLocator('.lobby-mirror__frame');
  await expect(mirror).toHaveAttribute('data-up', '1', { timeout: 10000 });
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'to-countdown' });
  await expect(frame.locator('[data-mode="countdown"]')).toBeAttached();
  await expect(mirror).toHaveAttribute('data-up', '0');
  await send.all('changed', { what: 'screen-action', id: GYM, action: 'slide-go', data: { index: 0 } });
  await expect(frame.locator('[data-mode="slideshow"] [data-grand-welcome]')).toBeAttached({ timeout: 10000 });
  await expect(mirror).toHaveAttribute('data-up', '1');
});

// Owner 2026-10-22: a five-second "switching to opening ceremony" card before
// the turn-over. The seam's `switching` stands for those five seconds (the
// real rule is lib/ceremonyMirror.js mirrorSwitching, unit-tested).
test('the five seconds before the turn-over show the switching card, with the lobby held', async ({ page }) => {
  await liveChannel(page);
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    window.awanaMirrorTuning = { wanted: true, switching: true, query: `&now=${encodeURIComponent('2026-09-16T17:59:30-04:00')}` };
  });
  await page.goto('/index.html?lowPower=1');
  const mirror = page.locator('[data-testid="ceremony-mirror"]');
  await expect(mirror).toHaveAttribute('data-up', '1');
  const card = page.locator('[data-testid="mirror-switching"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Switching to');
  await expect(card).toContainText('Opening ceremony');
  await expect(page.locator('[data-testid="ceremony-label"]')).toHaveCount(0);   // not copying yet
  await page.screenshot({ path: test.info().outputPath('switching.png') });
});

// Owner 2026-10-19: "ALL screens should show the games projector display.
// Classroom and journey included." Framed (the Journey kiosk, the classroom),
// the lobby runs the same mirror and tells its host when it is up.
test('a framed lobby shows the opening too and tells its host', async ({ page }) => {
  await page.addInitScript(() => {
    window.awanaMirrorTuning = { wanted: true, query: `&now=${encodeURIComponent('2026-09-16T17:59:58-04:00')}` };
    if (location.pathname.endsWith('/journey-host.html')) {
      window.__said = [];
      addEventListener('message', (e) => { if (e.data && e.data.type === 'awana-display:ceremony-mirror') window.__said.push(e.data); });
    }
  });
  const frame = await embed(page);
  const mirror = frame.locator('[data-testid="ceremony-mirror"]');
  await expect(mirror).toHaveAttribute('data-up', '1', { timeout: 10000 });
  await expect.poll(() => page.evaluate(() => window.__said)).toEqual([{ type: 'awana-display:ceremony-mirror', up: true }]);
});

// Owner 2026-10-19: "they should start from 10 seconds before start time".
// The seam's `early` stands for the last ten seconds before 6:00 (the real
// rule is lib/ceremonyMirror.js mirrorEarly, unit-tested): the projector's
// countdown is on the lobby before 6:00, and it stays up through the turn.
test('ten seconds early the lobby shows the projector counting down, and stays on it into the opening', async ({ page }) => {
  await liveChannel(page);
  await page.route(/open-meteo|twotimtwo/, (route) => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    window.awanaMirrorTuning = { wanted: true, early: true, query: `&now=${encodeURIComponent('2026-09-16T17:59:53-04:00')}` };
  });
  await page.goto('/index.html?lowPower=1');
  const mirror = page.locator('[data-testid="ceremony-mirror"]');
  const frame = page.frameLocator('.lobby-mirror__frame');
  await expect(mirror).toHaveAttribute('data-up', '1');
  await expect(frame.locator('[data-grand-welcome]')).toHaveCount(0);
  await expect(frame.locator('[data-mode="slideshow"] [data-grand-welcome]')).toBeAttached({ timeout: 15000 });
  await expect(mirror).toHaveAttribute('data-up', '1');
});
