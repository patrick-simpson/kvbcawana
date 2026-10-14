import { expect, test } from '@playwright/test';
import { liveChannel } from './liveChannel.js';

// The permanent flagship slide (src/lib/flagship.js, FlagshipSlide.jsx): the
// first thing a typed-deck screen shows, the church's logo huge in the middle
// (owner 2026-10-13). Under ?lowPower=1 (which is also how the paused-clock
// visual suite sees it) every beat is already at its last keyframe, so the
// finished slide must be on screen at once. Which style and wording plays is
// this screen's turn (localStorage awanaFlagshipTurn.v1), pinned here.

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  manualSlides: [],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
};

const LOGO = 'Kennebec Valley Baptist Church Awana Clubs. Strengthening the next generation of lifelong disciples for Christ';
// Turn 0 is bounce + the glad line; turn 1 is pop + "Welcome to" (flagshipPick).
const TURNS = { glad: 0, welcome: 1 };

async function boot(page, { query = '?lowPower=1', turn = 0 } = {}) {
  // The flagship is off the air Wednesdays 6:30-8:30 pm by the page's own
  // clock (src/lib/flagship.js): pin a morning so these tests hold at any
  // real hour, including a club night's.
  await page.clock.install({ time: new Date('2026-09-23T10:00:00-04:00') });
  await page.route(/open-meteo/, (r) => r.abort());
  await liveChannel(page);
  await page.addInitScript(({ c, turn }) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    // The turn is set once per tab: a reload carries on with the next one.
    if (!sessionStorage.getItem('flagshipTurnSet')) {
      localStorage.setItem('awanaFlagshipTurn.v1', String(turn));
      sessionStorage.setItem('flagshipTurnSet', '1');
    }
  }, { c: CONFIG, turn });
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.flagship')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('a screen with no slides of its own opens on the finished flagship, at rest under ?lowPower=1', async ({ page }) => {
  await boot(page);
  const slide = page.locator('.flagship');
  await expect(slide).toHaveAttribute('role', 'img');
  await expect(slide).toHaveAttribute('aria-label', `${LOGO}. We’re so glad you’re here!`);
  // The full logo, tagline and all, in ONE colour: ink on the sky.
  const logo = page.locator('.flagship-logo--full');
  await expect(logo).toBeVisible();
  await expect(page.locator('.flagship-logo--two-line')).toBeHidden();
  expect(await logo.evaluate((e) => getComputedStyle(e).color)).toBe('rgb(35, 31, 32)');
  expect(await logo.locator('.kvbc-tagline').count()).toBe(1);
  await expect(page.locator('.flagship-line--glad')).toHaveText('We’re so glad you’re here!');
  // Every letter in place: nothing left moved, tilted or squashed.
  const letters = await page.locator('.flagship-logo--full path').evaluateAll((els) => els.map((e) => ({
    op: Number(getComputedStyle(e).opacity),
    t: getComputedStyle(e).transform,
  })));
  expect(letters.length).toBe(3);
  for (const l of letters) {
    expect(l.op).toBe(1);
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(l.t);
  }
  expect(await page.locator('.flagship-plate, .flagship-kicker, .flagship-wave, .flagship-tab, .flagship-row').count()).toBe(0);
  // The foot is the scene's own chrome, as on every typed slide: the orange
  // house wave and its sunflower, and the orange corner tab, all home; the
  // tab's own small logo has stepped aside (one logo on screen at a time).
  await expect(page.locator('.lobby-chrome')).not.toHaveClass(/lobby-chrome--away/);
  await expect(page.locator('.lobby-chrome')).toHaveClass(/lobby-chrome--logo-away/);
  const tabLogo = await page.evaluate(() => [...document.querySelectorAll('.lobby-tab__logo')].map((e) => Number(getComputedStyle(e).opacity)));
  expect(tabLogo.every((o) => o === 0)).toBe(true);
  // Zero animation: nothing is moving, the parade is off the frame, no confetti canvas.
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length)).toBe(0);
  expect(await page.locator('canvas').count()).toBe(0);
});

test('"Welcome to" over the logo, nothing under it, on the next turn', async ({ page }) => {
  await boot(page, { turn: TURNS.welcome });
  await expect(page.locator('.flagship')).toHaveAttribute('aria-label', `Welcome to ${LOGO}`);
  await expect(page.locator('.flagship-line--welcome')).toHaveText('Welcome to');
  await expect(page.locator('.flagship-line--glad')).toHaveCount(0);
  const [line, mark] = await Promise.all(['.flagship-line--welcome', '.flagship-logo--full'].map((s) => page.locator(s).boundingBox()));
  expect(line.y + line.height).toBeLessThanOrEqual(mark.y + 1);
});

for (const [version, turn] of Object.entries(TURNS)) {
  test(`${version}: the logo is as big as the box allows, never under its smallest, clear of the tab, the stack and the foot`, async ({ page }) => {
    await boot(page, { turn });
    for (const [w, h] of [[640, 480], [640, 360], [1024, 768], [1280, 720], [1366, 768], [1920, 1080], [3840, 2160]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width }; };
        const shown = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none');
        const logo = shown('.flagship-logo')[0];
        return {
          variant: logo.classList.contains('flagship-logo--full') ? 'full' : 'two-line',
          logo: box(logo),
          ink: box(document.querySelector('.flagship-ink')),
          lines: shown('.flagship-line').map(box),
          tab: box(document.querySelector('.lobby-tab')),
          sun: box(document.querySelector('.lobby-wave--sun')),
          stack: shown('.top-right, .corner-stack').map(box),
          vw: innerWidth,
          vh: innerHeight,
        };
      });
      const at = `${w}x${h}`;
      const u = Math.min(m.vw / 100, m.vh / 56.25);
      const frameTop = (m.vh - 56.25 * u) / 2;
      const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      // The full logo wherever it can be 520px wide in the box; the two-line
      // only on a 16:9 screen under 722px wide, and never under 260px.
      expect(m.variant, at).toBe(w === 640 && h === 360 ? 'two-line' : 'full');
      expect(m.logo.w, at).toBeGreaterThanOrEqual(m.variant === 'full' ? 519.5 : 259.5);
      // As big as the box allows: 72u (75u under "Welcome to"), or 80u for the two-line.
      const wanted = m.variant === 'two-line' ? 80 * u : Math.max((version === 'welcome' ? 75 : 72) * u, Math.min(520, 84 * u));
      expect(Math.abs(m.logo.w - wanted), at).toBeLessThan(1.5);
      for (const piece of [m.logo, ...m.lines]) {
        expect(overlap(piece, m.tab), `${at}: under the corner tab`).toBe(false);
        for (const s of m.stack) expect(overlap(piece, s), `${at}: under the top-right stack`).toBe(false);
        expect(piece.l, at).toBeGreaterThan(0);
        expect(piece.r, at).toBeLessThan(m.vw);
      }
      // Above the house waves; on a 16:9 screen inside the headline box, 45u.
      expect(m.ink.b, `${at}: into the waves`).toBeLessThan(m.sun.t);
      if (Math.abs(m.vw / m.vh - 16 / 9) < 0.01) {
        expect(m.ink.b - frameTop, `${at}: below 45u`).toBeLessThanOrEqual(45.2 * u);
        expect(m.ink.t - frameTop, `${at}: above 19u`).toBeGreaterThanOrEqual(18.8 * u);
      }
    }
  });
}
