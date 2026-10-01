import { expect, test } from './pastFlagship.js';
import { boxes, embed, expectClear } from './embedHost.js';

// Embedded in the Journey kiosk (Journey-Display's public/index.html shows
// this page full-screen in an iframe), Journey floats its own always-visible
// buttons over the frame, and nothing in here can paint over a parent's
// element. Before the fix, at 1280x720 its view toggle sat on the last digit
// of the RIGHT NOW clock and at 1920x1080 its settings gear on the end of the
// weather chip's label. Now the two agree: while this display shows, Journey
// keeps both buttons in one column in the bottom-right corner, and this page,
// finding itself framed, keeps everything it draws down there out of it
// (src/lib/embed.js, the html.embedded rules in app.css). The top-right is
// ours and does not move; standalone nothing moves. This measures what
// Chromium lays out, under ?lowPower=1 so every frame is the resting one, at
// the Pi's 640x480 and at 720p and 1080p. The event-driven corners (the
// WAITING chip, the widest ticker night, a long name) are in
// embedded.events.spec.js.

const CORNERS = '.corner-stack .sticker-chip, .corner-top .corner-chip, .corner-bottom .corner-chip';
const FULL_SLIDE = {
  showClock: true,
  showTally: false,
  backgroundSource: 'manual',
  calendarEnabled: false,
  seasonPromos: false,
  slideshowDelaySec: 3,
  manualSlides: [{
    id: 's_fit',
    eyebrow: 'IMPORTANT ANNOUNCEMENT FOR ALL PARENTS AND GUARDIANS TONIGHT',
    text: 'Parents, please remember that pick-up is at the gym doors this week while the lobby floor is refinished. '.repeat(6).slice(0, 500),
    theme: 'sky',
    textSize: 'auto',
    durationSec: 0,
  }],
};

/** The same screen opened directly, for comparison. */
async function standalone(page, { config = {}, weather = null } = {}) {
  await page.route(/pusher|twotimtwo|sockjs/, (route) => route.abort());
  await page.route(/open-meteo/, (route) => (weather == null ? route.abort() : route.fulfill({
    body: JSON.stringify({ current: { temperature_2m: 56, apparent_temperature: 54, weather_code: weather, is_day: 1 } }),
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
  })));
  await page.addInitScript((cfg) => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaConfig.v1', JSON.stringify(cfg));
  }, { pusherAppKey: 'e2e-key', pusherCluster: 'us2', ...config });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return page.mainFrame();
}

/** Rounded boxes, for comparing two layouts of the same screen. */
const rounded = (list) => list.map((b) => [b.what, Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]);

for (const [width, height] of [[640, 480], [1280, 720], [1920, 1080]]) {
  test.describe(`embedded at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the clock chip keeps clear of the host\'s buttons', async ({ page }) => {
      const frame = await embed(page, { config: { showTally: false } });
      await expect(frame.locator('html')).toHaveClass(/\bembedded\b/);
      await expect(frame.locator('.corner-bottom .corner-chip--clock')).toBeVisible({ timeout: 12_000 });
      expectClear(await boxes(frame, CORNERS), { width, height });
    });

    // The top-right is budgeted to the pixel (the band beside it, a raised
    // headline under it, a tall problem sticker's words), so the host leaves
    // it alone and it stays exactly where it stands standalone: the widest
    // sky ("Thunderstorm with hail") under a problem sticker.
    test('the top-right stack keeps its own place', async ({ page, context }) => {
      const config = { pusherAppKey: '', showConnectionStatus: true, showClock: false, showTally: false };
      // At 640x480 the "not set up" sticker's px floors make it stand tall,
      // so the weather sits out there, framed or not; elsewhere it sits under
      // the sticker. Wait for that whole stack on both screens.
      const items = width === 640 ? 1 : 2;
      const settled = async (frame) => {
        await expect(frame.locator('.corner-stack .sticker-chip')).toBeVisible();
        if (items === 2) await expect(frame.locator('.corner-top .corner-chip--weather')).toBeVisible({ timeout: 12_000 });
        await frame.page().waitForTimeout(300);
        const list = await boxes(frame, CORNERS);
        expect(list).toHaveLength(items);
        return list;
      };
      const framed = await settled(await embed(page, { config, weather: 96 }));
      expectClear(framed, { width, height });
      const alone = await settled(await standalone(await context.newPage(), { config, weather: 96 }));
      expect(rounded(framed)).toEqual(rounded(alone));
    });

    // The other half of the agreement: the host's column (the gear stacked
    // over the toggle) starts below anything the slide copy can reach, and
    // the corner chip under a full slide still clears it.
    test('a full slide and its corner chip keep clear of the host\'s buttons', async ({ page }) => {
      const frame = await embed(page, { config: FULL_SLIDE });
      await expect(frame.locator('.lobby-headline')).toBeVisible();
      await expect(frame.locator('.corner-bottom .corner-chip--clock')).toBeVisible({ timeout: 12_000 });
      await page.waitForTimeout(300);
      const copy = await frame.evaluate(() => ['.lobby-kicker', '.lobby-headline'].flatMap((sel) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(sel));
        return [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, what: sel }));
      }));
      expectClear([...copy, ...await boxes(frame, CORNERS)], { width, height });
    });
  });
}

// The operator's panels, opened inside the frame. Settings and the slide
// editor are 94-96vw wide and the debug panel is parked top-left at nearly the
// full width, so on a small screen they reached under the host's column: at
// 640x480 and 1024x768 Settings' SAVE (now DONE) sat under the host's gear (a click on
// its right end opened JOURNEY's panel, and Settings stayed open unsaved), the
// slide editor's CANCEL under it at 640x480, and the debug panel's Close under
// the toggle. The stand-in host's buttons are real buttons over the frame, so
// a click there never reaches this page, exactly as on Journey. (Under
// ?lowPower=1, which the embed always passes, Done is a plain primary button:
// Jelly UI's <jelly-button> animates its canvas whatever the page says.)
const PANELS = [
  ['Settings', 'Control+Shift+S', '.panel--settings', (frame) => frame.locator('.panel .actions :is(jelly-button, button.primary)', { hasText: /^done$/i })],
  ['the slide editor', 'Control+Shift+E', '.panel--tabbed', (frame) => frame.locator('.panel .actions button', { hasText: /^cancel$/i })],
  ['the debug panel', 'Control+Shift+D', '.debug', (frame) => frame.locator('.debug-footer button')],
];

for (const [width, height] of [[640, 480], [1024, 768]]) {
  test.describe(`embedded at ${width}x${height}, the operator's panels`, () => {
    test.use({ viewport: { width, height } });

    for (const [name, keys, selector, lastButton] of PANELS) {
      test(`${name} ends short of the host's column, and its corner button takes a click at its far end`, async ({ page }) => {
        const frame = await embed(page, { config: { seasonPromos: false } });
        await frame.locator('.stage').click({ position: { x: 5, y: 5 } });
        await page.keyboard.press(keys);
        const panel = frame.locator(selector);
        await expect(panel).toBeVisible();
        await page.waitForTimeout(300);
        expectClear(await boxes(frame, selector), { width, height });
        const button = await lastButton(frame).boundingBox();
        await page.mouse.click(button.x + button.width * 0.9, button.y + button.height / 2);
        await expect(panel).toHaveCount(0);
      });
    }
  });
}

test.describe('embedded on a portrait phone (390x844)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // Journey is opened on a phone now and then; the first-run card is 90vw
  // there and ran under the host's gear.
  test('the first-run card ends short of the host\'s column', async ({ page }) => {
    const frame = await embed(page, { setupCard: true });
    await expect(frame.locator('.setup-card')).toBeVisible();
    expectClear(await boxes(frame, '.setup-card'), { width: 390, height: 844 });
  });
});

test.describe('standalone at 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  // The same screen as the first embedded case, opened directly: no class,
  // and the corners keep their own insets, exactly as before.
  test('nothing moves: the corners keep their own insets', async ({ page }) => {
    const frame = await standalone(page, { config: { pusherAppKey: '', showConnectionStatus: true, showTally: false } });
    await expect(frame.locator('html')).not.toHaveClass(/\bembedded\b/);
    const chip = page.locator('.corner-bottom .corner-chip--clock');
    await expect(chip).toBeVisible({ timeout: 12_000 });
    const u = 12.8;
    const bottom = await chip.boundingBox();
    expect(Math.abs(bottom.x + bottom.width - (1280 - 2.6 * u))).toBeLessThanOrEqual(1);
    const stack = await page.locator('.corner-stack').boundingBox();
    expect(stack.y).toBeCloseTo(24, 0);
    expect(Math.abs(stack.x + stack.width - (1280 - 24))).toBeLessThanOrEqual(1);
  });
});
