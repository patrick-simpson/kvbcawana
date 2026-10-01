import { expect, test } from './pastFlagship.js';
import { boxes, embed, expectClear, hits, hostSquares } from './embedHost.js';
import { fakePusher } from './fakePusher.js';

// Embedded in the Journey kiosk, the corners that only events bring up
// (embedded.spec.js has the static ones), against Journey's column of two
// buttons in the bottom-right: the WAITING chip behind a held slide, in the
// top slot and (under a tall problem sticker) in the bottom corner, a tall
// sticker over a raised headline, the widest night's ticker beside the
// corner chip, and a name long enough to fill the check-in's column.
// Multi-step choreography, so it runs with the events project (ci.yml only).

const HELD_DECK = [
  { id: 's_held', eyebrow: 'Tonight', text: 'Game night in the gym', theme: 'sky', holdCheckIns: true, durationSec: 600 },
  { id: 's_plain', eyebrow: 'Next week', text: 'Bring a friend', theme: 'sky', durationSec: 600 },
];
const FULL_SLIDE = [{
  id: 's_fit',
  eyebrow: 'IMPORTANT ANNOUNCEMENT FOR ALL PARENTS AND GUARDIANS TONIGHT',
  text: 'Parents, please remember that pick-up is at the gym doors this week while the lobby floor is refinished. '.repeat(6).slice(0, 500),
  theme: 'sky',
  textSize: 'auto',
  durationSec: 0,
}];
// Any 32 bytes: with a display key held, a plaintext name is refused, which
// puts the "NAMES REFUSED" strip on the status sticker (a tall sticker).
const DISPLAY_KEY = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

/** Open the signage's debug panel inside the frame, press `name` `times` times, close it. */
async function simulate(page, frame, name, times = 1) {
  await frame.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+Shift+D');
  await expect(frame.locator('.debug')).toBeVisible();
  for (let i = 0; i < times; i += 1) await frame.getByRole('button', { name }).first().click();
  await page.keyboard.press('Control+Shift+D');
  await expect(frame.locator('.debug')).toHaveCount(0);
}

/** A status sticker with a fault strip on it: a key on this screen, and a plaintext name refused. */
async function tallSticker(page, config) {
  const send = await fakePusher(page);
  await page.addInitScript((key) => {
    if (location.pathname.endsWith('/index.html')) localStorage.setItem('awanaDisplayKey.v1', key);
  }, DISPLAY_KEY);
  const frame = await embed(page, { config });
  await send('checkin', { id: 'e2e-plain', firstName: 'Ann', club: 'Sparks', at: new Date().toISOString() });
  await expect(frame.locator('.status-dot .name-fault')).toContainText(/NAMES REFUSED/);
  return frame;
}

const copyRects = (frame) => frame.evaluate(() => ['.lobby-kicker', '.lobby-headline'].flatMap((sel) => {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector(sel));
  return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }));
}));

for (const [width, height] of [[640, 480], [1920, 1080]]) {
  test.describe(`embedded at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the WAITING chip behind a held slide keeps the top slot, clear of the host\'s buttons', async ({ page }) => {
      const frame = await embed(page, { config: { backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: HELD_DECK } });
      await expect(frame.locator('.lobby-headline')).toContainText(/game night/i);
      await simulate(page, frame, 'Trigger 5 simultaneous');
      await expect(frame.locator('.corner-top .corner-chip--waiting')).toBeVisible();
      expectClear(await boxes(frame, '.corner-stack .sticker-chip, .corner-chip'), { width, height });
    });
  });
}

for (const [width, height] of [[640, 480], [1280, 720]]) {
  test.describe(`embedded at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    // A sticker that stands tall sends the WAITING chip down to the bottom
    // corner, which the held slide leaves empty: there it must clear the
    // host's column like the corner chip does.
    test('under a tall problem sticker, the WAITING chip waits beside the host\'s toggle, clear of it', async ({ page }) => {
      const frame = await tallSticker(page, { showConnectionStatus: true, backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: HELD_DECK });
      await simulate(page, frame, 'Trigger 5 simultaneous');
      await expect(frame.locator('.corner-bottom .corner-chip--waiting')).toBeVisible();
      expectClear(await boxes(frame, '.corner-stack .sticker-chip, .corner-chip'), { width, height });
    });

    // The top-right keeps its standalone budget: a sticker with a fault strip
    // on it still ends clear of a raised headline (moving the stack down under
    // a host button in the top-right would run it into the kicker on the Pi).
    test('a tall problem sticker keeps clear of a raised headline', async ({ page }) => {
      const frame = await tallSticker(page, { showConnectionStatus: true, showClock: false, showTally: false, backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, slideshowDelaySec: 3, manualSlides: FULL_SLIDE });
      await expect(frame.locator('.lobby-headline')).toBeVisible();
      await page.waitForTimeout(300);
      const [sticker] = await boxes(frame, '.corner-stack .sticker-chip');
      expectClear([sticker], { width, height });
      for (const r of await copyRects(frame)) expect(hits(sticker, r), 'the sticker over the headline').toBe(false);
    });
  });
}

for (const [width, height] of [[640, 480], [1280, 720], [390, 844]]) {
  test.describe(`embedded at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    // Four stats with three-digit counts beside the widest corner chip (the
    // clock): at 640x480 the gear, the ticker, the chip and the host's toggle
    // fill the row but for ~15px, so the ticker must neither run into the gear
    // nor the chip, and the chip must stay out from under the toggle. On a
    // portrait phone that room is narrower than the night (174px for 226px at
    // 390x844, where it ran 26px under the clock), so it wraps into it,
    // keeping its own stat gap from both.
    test('the widest night\'s ticker keeps clear of the gear and the corner chip, and the chip of the toggle', async ({ page }) => {
      const frame = await embed(page, { config: { showTally: false } });
      await expect(frame.locator('.corner-bottom .corner-chip--clock')).toBeVisible({ timeout: 12_000 });
      await simulate(page, frame, /Show tonight ticker/, 13);
      await expect(frame.locator('.tonight-ticker')).toBeVisible();
      await expect(frame.locator('.tonight-ticker-stat')).toHaveCount(4);
      await page.waitForTimeout(300);
      const [ticker] = await boxes(frame, '.tonight-ticker');
      const stats = await boxes(frame, '.tonight-ticker-stat');
      const [gear] = await boxes(frame, '.settings-gear');
      const chips = await boxes(frame, '.corner-bottom .corner-chip');
      expectClear([ticker, ...stats, ...chips], { width, height });
      for (const box of [ticker, ...stats]) {
        expect(hits(box, gear), `${box.what} over the settings gear`).toBe(false);
        for (const chip of chips) expect(hits(box, chip), `${box.what} over the corner chip`).toBe(false);
      }
    });
  });
}

for (const [width, height] of [[640, 480], [1280, 720], [1920, 1080]]) {
  test.describe(`embedded at ${width}x${height}, a long name`, () => {
    test.use({ viewport: { width, height } });

    // A name long enough to fill the 71u column ended at 95.6u, under the
    // host's toggle on every screen; embedded, the column ends short of it.
    test('a name that fills the column ends short of the host\'s buttons', async ({ page }) => {
      const send = await fakePusher(page);
      const frame = await embed(page, { config: { standardDisplayMs: 60_000, firstArrivalMoment: false, showClock: false } });
      await send('checkin', { id: 'e2e-long', firstName: 'Maximiliana Wolfeschlegel', club: 'Sparks', at: new Date().toISOString() });
      const name = frame.locator('.checkin__name');
      await expect(name).toHaveAttribute('aria-label', 'MAXIMILIANA WOLFESCHLEGEL');
      await frame.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const ink = await name.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, what: 'the name' }));
      });
      expectClear(ink, { width, height });
      // ...and it is still one line, the full name, not cut off.
      expect(new Set(ink.map((r) => Math.round(r.top))).size).toBe(1);
      const { toggle } = hostSquares(width, height);
      expect(Math.max(...ink.map((r) => r.right))).toBeLessThan(toggle.left);
    });
  });
}
