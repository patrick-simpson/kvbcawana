import { expect, test } from '@playwright/test';
import { test as pastFlagship } from './pastFlagship.js';
import { fakePusher } from './fakePusher.js';

// The pickup board in the foot (owner, 2026-10-07: "The still remaining kids
// list should just take the bottom of the screen. It shouldn't take over all
// of the announcements."), and Settings' demo, in a real browser: the board
// stands in the strip under the copy's lowest line, between the gear and the
// corner chip, every plate and chip inside its run and the card, the slide
// copy above it untouched, the 60-entry cap held at every size (names behind
// "+N more" where even the smallest readable chips cannot hold them), a
// critical notice still in the middle, and the demo gone after its 20 seconds.

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

/**
 * Where everything stands, in px: the strip and the card, every plate and
 * chip against the run, the gear, the corner chip, and each drawn row of the
 * slide copy (a Range's client rects, so a full-width block box never stands
 * in for its words).
 */
const layout = (page) => page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  };
  const run = box(document.querySelector('.stage .checkout-run'));
  const pieces = [...document.querySelectorAll('.stage .checkout-plate, .stage .checkout-name__chip, .stage .checkout-more')].map(box);
  const rows = [...document.querySelectorAll('.stage .manual-slide-copy .lobby-kicker, .stage .manual-slide-copy .lobby-headline')].flatMap((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map((r) => ({ top: r.top, bottom: r.bottom }));
  });
  const stage = document.querySelector('.stage').getBoundingClientRect();
  const u = Math.min(stage.width / 100, (stage.height * 16 / 9) / 100);
  return {
    u,
    frameTop: stage.top + stage.height / 2 - 28.125 * u,
    vh: stage.height,
    region: box(document.querySelector('.stage .checkout-region')),
    board: box(document.querySelector('.stage .checkout-board')),
    run,
    pieces,
    escaped: run ? pieces.filter((p) => p.left < run.left - 0.5 || p.right > run.right + 0.5
      || p.top < run.top - 0.5 || p.bottom > run.bottom + 0.5).length : null,
    // Which pieces, and where, for the failure message.
    escapees: run ? [...document.querySelectorAll('.stage .checkout-plate, .stage .checkout-name__chip, .stage .checkout-more')]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.left < run.left - 0.5 || r.right > run.right + 0.5 || r.top < run.top - 0.5 || r.bottom > run.bottom + 0.5)
      .map(({ el, r }) => `${el.className}:"${el.textContent.trim()}" ${Math.round(r.left)},${Math.round(r.top)}-${Math.round(r.right)},${Math.round(r.bottom)}`)
      .concat(`run ${Math.round(run.left)},${Math.round(run.top)}-${Math.round(run.right)},${Math.round(run.bottom)}`) : [],
    size: document.querySelector('.stage .checkout-board')
      ? parseFloat(getComputedStyle(document.querySelector('.stage .checkout-board')).getPropertyValue('--name-size'))
      : null,
    gear: box(document.querySelector('.settings-gear')),
    corner: box(document.querySelector('.corner-bottom .corner-chip')),
    rows,
  };
});

/** The strip's own rules: under the copy's lowest line, clear of the gear and the corner chip. */
function expectInTheFoot(l) {
  expect(l.region.top).toBeGreaterThanOrEqual(l.frameTop + 45 * l.u - 1);
  expect(l.region.bottom).toBeLessThanOrEqual(l.vh - 1.8 * l.u + 1);
  expect(within({ x: l.board.left, y: l.board.top, width: l.board.right - l.board.left, height: l.board.bottom - l.board.top },
    { x: l.region.left, y: l.region.top, width: l.region.right - l.region.left, height: l.region.bottom - l.region.top })).toBe(true);
  expect(l.region.left).toBeGreaterThanOrEqual(l.gear.right);
  if (l.corner) expect(l.region.right).toBeLessThanOrEqual(l.corner.left);
  for (const row of l.rows) expect(row.bottom).toBeLessThanOrEqual(l.region.top);
}

for (const [width, height] of [[1920, 1080], [1280, 720], [640, 480]]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the demo board stands in the foot, every plate and chip inside its run, nothing stepping aside', async ({ page }) => {
      await open(page);
      const board = await startDemo(page);
      await expect(board.locator('.checkout-demo')).toHaveText('Demo · sample names');
      await expect(board.locator('.checkout-plate')).toHaveCount(6);
      await page.evaluate(() => document.fonts.ready);
      // Settled: the marks' images and the strip's own correction (it moves a
      // name behind "+N more" for as long as the browser's wrap overflows).
      await expect.poll(async () => (await layout(page)).escaped, { timeout: 5000 }).toBe(0)
        .catch(async (e) => { throw new Error(`${e.message}\n${(await layout(page)).escapees.join('\n')}`); });
      const l = await layout(page);
      expectInTheFoot(l);
      expect(l.escaped).toBe(0);
      // Shown and behind "+N more", every sample child is counted.
      const shown = await board.locator('.checkout-name__chip').count();
      const more = (await board.locator('.checkout-more').allTextContents()).map((t) => Number(/\d+/.exec(t)[0]));
      expect(shown + more.reduce((a, b) => a + b, 0)).toBe(17);
      for (const chip of await board.locator('.checkout-name__chip').all()) {
        // The whole name is drawn, never cut short.
        expect(await chip.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      // Nothing on the stage steps aside for it.
      await expect(page.locator('.stage.board-up')).toHaveCount(0);
      await expect(page.locator('.stage.notice-takeover')).toHaveCount(0);
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
  await expect(preview.locator('.checkout-plate')).toHaveCount(6);
  const frame = await preview.boundingBox();
  const card = await preview.locator('.checkout-board').boundingBox();
  expect(within(card, frame)).toBe(true);
  // A miniature TV: the card in the bottom of the frame, as on the lobby.
  expect(card.y).toBeGreaterThan(frame.y + frame.height * 0.75);
  await dialog.getByLabel('Stop showing names at or below').fill('40');
  await expect(preview.locator('.checkout-plate')).toHaveCount(0);
  await expect(preview).toContainText('Almost everyone has been picked up');
});

// The printer sends at most 60 entries. Over a typed slide, through a
// stand-in socket (only the wire can deliver real first names), at 7:45 pm on
// a Tuesday: the board comes on by itself from 7:30 (2026-10-08).
const CLUBS = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
const NAMES = ['Sophia', 'Oliver', 'Amelia', 'Lucas', 'Harper', 'Mason', 'Evelyn', 'Logan', 'Abigail', 'Elijah'];
const SIXTY = CLUBS.flatMap((club) => NAMES.map((firstName) => ({ firstName, club })));

const PICKUP_TIME = new Date('2026-10-06T19:45:00-04:00');

async function lobbyAtPickup(page, extra = {}) {
  const send = await fakePusher(page);
  await page.clock.setSystemTime(PICKUP_TIME);
  await page.addInitScript((cfg) => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaConfig.v1', JSON.stringify(cfg));
  }, {
    pusherAppKey: 'e2e-key', pusherCluster: 'us2', backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false,
    manualSlides: [{ id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook and a friend to Awana', theme: 'sky' }],
    particleEffect: 'off', firstArrivalMoment: false, sharedScheduleUrl: '',
    ...extra,
  });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage .manual-slide-copy .lobby-headline')).toBeVisible();
  return send;
}

for (const [width, height] of [[1920, 1080], [1280, 720], [640, 480]]) {
  pastFlagship.describe(`sixty names at ${width}x${height}`, () => {
    pastFlagship.use({ viewport: { width, height } });

    pastFlagship('hold the cap in the foot: inside the run, never under the floor, nobody uncounted, the copy untouched', async ({ page }) => {
      const send = await lobbyAtPickup(page);
      const copyOpacity = () => page.locator('.manual-slideshow .manual-slide-copy').evaluate((el) => Number(getComputedStyle(el).opacity));
      await send('checkout', { entries: SIXTY, printed: 75, at: PICKUP_TIME.toISOString() });
      const board = page.locator('.stage .checkout-board--list');
      await expect(board).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const l = await layout(page);
      expectInTheFoot(l);
      expect(l.escaped).toBe(0);
      expect(l.size).toBeGreaterThanOrEqual(10);
      await expect(board.locator('.checkout-plate__count')).toHaveText(Array(6).fill('10 waiting'));
      const shown = await board.locator('.checkout-name__chip').count();
      const more = (await board.locator('.checkout-more').allTextContents()).map((t) => Number(/\d+/.exec(t)[0]));
      expect(shown + more.reduce((a, b) => a + b, 0)).toBe(60);
      // A 1080p TV names every one of them; 720p and the Pi say "+N more".
      if (width === 1920) expect(more).toEqual([]);
      await expect(board.locator('.checkout-foot')).toContainText('60 not checked out yet');
      // The slides above carry on as normal.
      expect(await copyOpacity()).toBe(1);
      await expect(page.locator('.stage.board-up')).toHaveCount(0);
    });
  });
}

pastFlagship.describe('a critical notice over the pickup list', () => {
  pastFlagship.use({ viewport: { width: 1280, height: 720 } });

  pastFlagship('keeps its own place in the middle, clear of the board, and the board stays whole', async ({ page }) => {
    const send = await lobbyAtPickup(page);
    await send('checkout', { entries: SIXTY.slice(0, 24), printed: 75, at: PICKUP_TIME.toISOString() });
    await expect(page.locator('.stage .checkout-name__chip')).toHaveCount(24);
    await send('notice', { level: 'critical', message: 'Severe weather: everyone stays inside until further notice', at: PICKUP_TIME.toISOString() });
    const notice = page.locator('.notice-banner--critical');
    await expect(notice).toBeVisible();
    await expect(notice).not.toHaveClass(/is-band/);
    await page.waitForTimeout(600);
    const region = await page.locator('.stage .checkout-region').boundingBox();
    const plate = await notice.boundingBox();
    expect(plate.y + plate.height).toBeLessThanOrEqual(region.y);
    await expect(page.locator('.stage .checkout-name__chip')).toHaveCount(24);
  });
});

// "<First name> has checked out" (owner, 2026-10-08), in the same strip, one
// child at a time, in the list's place; and the per-screen club count in the
// top-right corner.
pastFlagship.describe('a child leaving the list', () => {
  for (const [width, height] of [[1920, 1080], [640, 480]]) {
    pastFlagship(`is said in the foot at ${width}x${height}, then the list comes back`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const send = await lobbyAtPickup(page);
      await send('checkout', { entries: SIXTY.slice(0, 24), printed: 75, at: PICKUP_TIME.toISOString() });
      await expect(page.locator('.stage .checkout-board--list')).toBeVisible();
      const left = SIXTY.slice(0, 24).filter((e) => !(e.firstName === 'Sophia' && e.club === 'Puggles'));
      await send('checkout', { entries: left, printed: 75, at: PICKUP_TIME.toISOString() });
      const banner = page.locator('.stage .checkout-leave--name');
      await expect(banner).toHaveText('Sophia has checked out');
      await expect(page.locator('.stage .checkout-board')).toHaveCount(0);
      // In the strip, clear of the copy, the gear and the corner chip.
      const l = await layout(page);
      const b = await banner.boundingBox();
      const strip = await page.locator('.stage .checkout-leaves').boundingBox();
      expect(within(b, strip)).toBe(true);
      expect(strip.y).toBeGreaterThanOrEqual(l.frameTop + 45 * l.u - 1);
      expect(strip.x).toBeGreaterThanOrEqual(l.gear.right);
      if (l.corner) expect(strip.x + strip.width).toBeLessThanOrEqual(l.corner.left);
      for (const row of l.rows) expect(row.bottom).toBeLessThanOrEqual(strip.y);
      // A few seconds, and the list is back without her.
      await page.clock.runFor(3500);
      await expect(page.locator('.stage .checkout-leave')).toHaveCount(0);
      await expect(page.locator('.stage .checkout-name__chip')).toHaveCount(23);
    });
  }
});

pastFlagship.describe('the club count, top right', () => {
  pastFlagship.use({ viewport: { width: 1280, height: 720 } });

  pastFlagship('stands under the status sticker\'s place, inside the 14u the stack may use', async ({ page }) => {
    const send = await lobbyAtPickup(page, { cornerClub: 'sparks', showWeatherChip: true });
    await send('tally', { counts: { Sparks: 23, 'T&T': 18 }, total: 41, at: PICKUP_TIME.toISOString() });
    const chip = page.locator('.corner-stack .corner-chip--club');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveAttribute('aria-label', 'Sparks: 23 here now');
    const box = await chip.boundingBox();
    const u = Math.min(1280, 720 * 16 / 9) / 100;
    expect(box.y + box.height).toBeLessThanOrEqual(14 * u + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    // The weather has left the corner on this screen.
    await expect(page.locator('.corner-top .corner-chip--weather')).toHaveCount(0);
  });
});
