import { expect, test } from '@playwright/test';
import { liveChannel } from './liveChannel.js';

// The flagship slide against what happens over and around it, in a real
// browser with the real clock: check-ins play OVER it and it steps back for
// them (it never holds them), and it leads every pass through the deck.
// In the events project: multi-second and timing-sensitive, so ci.yml only.

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  manualSlides: [
    { id: 's_a', eyebrow: '', text: 'SLIDE ALPHA', theme: 'sky', durationSec: 3 },
    { id: 's_b', eyebrow: '', text: 'SLIDE BRAVO', theme: 'sky', durationSec: 3 },
  ],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
  standardDisplayMs: 2000,
};

async function boot(page, query = '', turn = 0) {
  const send = await liveChannel(page);
  await page.addInitScript(({ c, turn }) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    // Which welcome plays is this screen's turn (src/lib/flagship.js), set
    // once per tab so a reload carries on with the next one.
    if (!sessionStorage.getItem('flagshipTurnSet')) {
      localStorage.setItem('awanaFlagshipTurn.v1', String(turn));
      sessionStorage.setItem('flagshipTurnSet', '1');
    }
  }, { c: CONFIG, turn });
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.flagship')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return send;
}

const child = (name, n) => ({ id: `${name}-${n}`, firstName: name, club: 'sparks', at: new Date().toISOString(), isBirthday: false, isFirstTimer: false });

for (const query of ['', '?lowPower=1']) {
  test(`a name plays over the flagship at once, the logo steps aside for it, and comes back again ${query || '(with motion)'}`, async ({ page }) => {
    test.setTimeout(45_000);
    const send = await boot(page, query);
    await send('checkin', child('Maya', 1));
    // Not held: no WAITING chip, and the name is on screen immediately.
    await expect(page.locator('.checkin')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.corner-chip--waiting')).toHaveCount(0);
    await expect(page.locator('.stage')).toHaveClass(/checkin-active/);
    // The slide's logo and its line step aside, all the way (its own transition settles in ~0.6 s;
    // instant under ?lowPower=1); its field stays.
    await expect.poll(async () => Number(await page.locator('.flagship-copy').evaluate((e) => getComputedStyle(e).opacity)), { timeout: 3000 }).toBe(0);
    expect(Number(await page.locator('.flagship').evaluate((e) => getComputedStyle(e).opacity))).toBe(1);
    await expect(page.locator('.checkin')).toHaveCount(0, { timeout: 12_000 });
    await expect.poll(async () => Number(await page.locator('.flagship-copy').evaluate((e) => getComputedStyle(e).opacity)), { timeout: 3000 }).toBe(1);
  });
}

test('the flagship leads every pass: flagship, then the operator\'s slides, then round to the flagship again', async ({ page }) => {
  test.setTimeout(60_000);
  await boot(page);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 22_000) {
    const now = await page.evaluate(() => {
      if (document.querySelector('.flagship')) return 'FLAGSHIP';
      return document.querySelector('.manual-slide .lobby-headline')?.textContent.replace(/\s+/g, ' ').trim() || '';
    });
    if (now && seen.at(-1) !== now) seen.push(now);
    await page.waitForTimeout(250);
  }
  // 10 s flagship + 3 s + 3 s = 16 s a pass, so 22 s sees the flagship come round again.
  expect(seen.slice(0, 4)).toEqual(['FLAGSHIP', 'SLIDE ALPHA', 'SLIDE BRAVO', 'FLAGSHIP']);
});

test('with motion, each load plays the next style, and every one comes to rest on the same finished frame', async ({ page }) => {
  test.setTimeout(60_000);
  // The flagship's motion happens in real time, so this watches it with the real clock.
  await boot(page, '', 0);
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    if (i) await page.reload();
    await expect(page.locator('.flagship')).toBeVisible();
    seen.push(await page.locator('.flagship').getAttribute('data-style'));
    // The longest moment (the parade) is still by 6.5 s of real time.
    await page.waitForTimeout(7_000);
    const rest = await page.evaluate(() => {
      const ink = document.querySelector('.flagship-ink');
      const strip = document.querySelector('.flagship-parade__strip');
      return {
        color: getComputedStyle(ink).color,
        // Nothing in the lockup is left moved, scaled or tilted (a doodle rests at its own tilt).
        moving: [...document.querySelectorAll('.flagship-ink *:not(.flagship-doodle)')]
          .filter((e) => !['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(getComputedStyle(e).transform)).length,
        stripGone: !strip || strip.getBoundingClientRect().bottom <= 0,
      };
    });
    expect(rest.color, seen.at(-1)).toBe('rgb(35, 31, 32)');
    expect(rest.moving, seen.at(-1)).toBe(0);
    expect(rest.stripGone, seen.at(-1)).toBe(true);
  }
  expect(seen).toEqual(['bounce', 'pop', 'parade']);
});
