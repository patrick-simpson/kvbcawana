import { devices, expect, test } from '@playwright/test';

// The projector page on phones and tablets (owner, 2026-09-30: "I want this
// website to fully work on mobile").
// Everything a finger needs is gated on the primary pointer (src/presentation/
// lib/touch.js), so these run in real touch contexts (isMobile + hasTouch,
// Chromium's emulation, where `(hover: none) and (pointer: coarse)` is true)
// and the desktop suites (countdown-modes, setup-card, the visual
// baselines) stay the proof that the projector PC's wall did not change.
//
// The device descriptors' own viewports are the visible area under the
// browser's toolbars (an iPhone 14 is 390x664 in Safari, not its 390x844
// screen), which is what a page really gets. Their defaultBrowserType is
// dropped: only Chromium runs here, and it emulates each of them.

const device = (name) => {
  const { defaultBrowserType: _browser, ...rest } = devices[name];
  return rest;
};
const DEVICES = [
  ['iPhone 14', device('iPhone 14')],
  ['iPhone 14 landscape', device('iPhone 14 landscape')],
  ['Pixel 7', device('Pixel 7')],
  ['iPad Pro 11', device('iPad Pro 11')],
  ['iPad Pro 11 landscape', device('iPad Pro 11 landscape')],
];

const at = (now, extra = '') => `/countdown.html?now=${now}&freeze=1${extra}`;
const TUESDAY = '2026-09-15T18:30:00';

test.beforeEach(async ({ page }) => {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  // The first-run note is its own subject below; everywhere else it is dismissed.
  await page.addInitScript(() => localStorage.setItem('awanaSetupChecklistDismissed.v1', '1'));
});

/** The view's own crossfade scales it from 0.985 as it lands: measure after it. */
const settle = (page) => page.waitForTimeout(900);

/** A box {x, y, width, height} entirely on the screen, and at least 44x44 (to the device pixel). */
async function expectTarget(locator, name) {
  const box = await locator.boundingBox();
  expect(box, name).not.toBeNull();
  const vp = locator.page().viewportSize();
  expect(box.width, `${name} width`).toBeGreaterThanOrEqual(44 - 0.1);
  expect(box.height, `${name} height`).toBeGreaterThanOrEqual(44 - 0.1);
  expect(box.x, `${name} left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${name} top`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${name} right`).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height, `${name} bottom`).toBeLessThanOrEqual(vp.height + 0.5);
}

/** Every visible, enabled button inside `root`: each one must be a finger's target. */
async function expectAllTargets(root) {
  const sizes = await root.evaluate((el) => [...el.querySelectorAll('button')]
    .filter((b) => b.offsetParent !== null && !b.disabled)
    .map((b) => {
      const r = b.getBoundingClientRect();
      return { name: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30), w: r.width, h: r.height };
    }));
  expect(sizes.length).toBeGreaterThan(3);
  const small = sizes.filter((s) => s.w < 44 - 0.5 || s.h < 44 - 0.5);
  expect(small).toEqual([]);
}

const menuButton = (page) => page.getByRole('button', { name: 'Open the menu' });
const sheet = (page) => page.getByRole('dialog', { name: 'Projector menu' });

for (const [name, use] of DEVICES) {
  test.describe(name, () => {
    test.use(use);

    test('is a touch page: a visible menu button, and no hover panel on the wall', async ({ page }) => {
      await page.goto(at(TUESDAY));
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-touch', '1');
      await settle(page);
      await expectTarget(menuButton(page), 'menu button');
      // The hover menu is not on the page at all: nothing of it can catch a tap.
      await expect(page.getByRole('button', { name: 'Main Countdown' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Display Settings/ })).toHaveCount(0);
    });

    test('the menu opens by tap, covers the screen, and every control in it is a finger\'s size', async ({ page }) => {
      await page.goto(at(TUESDAY));
      await menuButton(page).tap();
      const s = sheet(page);
      await expect(s).toBeVisible();
      const box = await s.boundingBox();
      const vp = page.viewportSize();
      expect(Math.round(box.width)).toBe(vp.width);
      expect(Math.round(box.height)).toBe(vp.height);
      // Open the folds so their controls are measured too.
      await s.getByRole('button', { name: /Skip Weeks/ }).tap();
      await s.getByRole('button', { name: /Display Settings/ }).tap();
      await expectAllTargets(s);
      // Its fields are 16px or more, so iOS never zooms the page into one.
      const fonts = await s.locator('input').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      expect(fonts.length).toBeGreaterThan(1);
      for (const f of fonts) expect(f).toBeGreaterThanOrEqual(16);
      await s.getByRole('button', { name: 'Close the menu' }).tap();
      await expect(s).toHaveCount(0);
    });

    test('its picks change the wall, and the sheet gets out of the way', async ({ page }) => {
      await page.goto(`/countdown.html?now=${TUESDAY}`);
      await menuButton(page).tap();
      await sheet(page).getByRole('button', { name: 'Opening Ceremony' }).tap();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.locator('[data-mode="slideshow"][data-deck="opening"]')).toBeVisible();
      // A pick holds the wall: Resume Schedule is on offer now, and goes back.
      await menuButton(page).tap();
      await sheet(page).getByRole('button', { name: 'Resume Schedule' }).tap();
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
      await menuButton(page).tap();
      await sheet(page).getByRole('button', { name: 'T&T Game Time' }).tap();
      await expect(page.locator('[data-mode="game-time"]')).toBeVisible();
    });

    test('the switches flip by tap, with their hints written out', async ({ page }) => {
      await page.goto(at(TUESDAY));
      await menuButton(page).tap();
      const low = sheet(page).getByRole('switch', { name: /Low power mode/ });
      await expect(low).toHaveAttribute('aria-checked', 'false');
      await expect(sheet(page).getByText('Hides particle / weather layers for weak hardware')).toBeVisible();
      await low.tap();
      await expect(low).toHaveAttribute('aria-checked', 'true');
      expect(await page.evaluate(() => localStorage.getItem('awanaPresentationLowPower.v1'))).toBe('1');
      await low.tap();
      await expect(low).toHaveAttribute('aria-checked', 'false');
      // Full screen, where the browser can (Chromium can on every device it emulates).
      const full = sheet(page).getByRole('switch', { name: /Full screen/ });
      await full.tap();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
      await expect(full).toHaveAttribute('aria-checked', 'true');
      await full.tap();
      await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
    });

    test('taps on the wall never reach a hidden menu', async ({ page }) => {
      await page.goto(`/countdown.html?now=${TUESDAY}`);
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
      const vp = page.viewportSize();
      // The timer is a control of its own (two taps on it skip the countdown,
      // below), and a finger is not a point: Chromium snaps a tap that lands
      // near a control onto it, as a phone does. Everywhere else is only the wall.
      const timer = await page.locator('[data-timer]').boundingBox();
      const pad = 64;
      const onTimer = (x, y) => x >= timer.x - pad && x <= timer.x + timer.width + pad
        && y >= timer.y - pad && y <= timer.y + timer.height + pad;
      // Where the hover panel's invisible buttons used to sit (the top-right
      // two thirds of a phone), and the wall's other corners.
      for (const [fx, fy] of [[0.5, 0.12], [0.75, 0.3], [0.9, 0.55], [0.3, 0.2], [0.5, 0.92], [0.1, 0.9], [0.95, 0.35]]) {
        const [x, y] = [Math.round(vp.width * fx), Math.round(vp.height * fy)];
        if (!onTimer(x, y)) await page.touchscreen.tap(x, y);
      }
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
      await expect(sheet(page)).toHaveCount(0);
      expect(await page.evaluate(() => [
        localStorage.getItem('awanaCountdownStingers.v1'),
        localStorage.getItem('awanaPresentationLowPower.v1'),
        localStorage.getItem('awanaScheduleOverlay.v1'),
      ])).toEqual([null, null, null]);
    });
  });
}

/* ── The countdown's skip, the shutdown's restart, the watchdog's Stay ── */

for (const [name, use] of DEVICES) {
  test.describe(`the wall's own buttons on ${name}`, () => {
    test.use(use);

    test('the countdown\'s skip asks first: one tap on the clock only asks, a second skips', async ({ page }) => {
      await page.goto(`/countdown.html?now=${TUESDAY}`);
      const timer = page.locator('[data-timer]');
      await expect(timer).toBeVisible();
      await expect(timer).not.toHaveAttribute('title', /.*/);
      await timer.tap();
      const toast = page.locator('[data-skip-toast]');
      await expect(toast).toBeVisible();
      await expect(toast.getByRole('img')).toHaveAttribute('aria-label', 'START THE OPENING Tap the clock again');
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
      await timer.tap();
      await expect(page.locator('[data-mode="slideshow"][data-deck="opening"]')).toBeVisible();
    });

    test('the shutdown screen restarts from Start Over only, a finger\'s size, and never from its words', async ({ page }) => {
      await page.goto(at('2026-09-16T19:40:00'));
      await expect(page.locator('[data-mode="shutdown"]')).toBeVisible();
      await settle(page);
      await expect(page.getByText('or press Space')).toHaveCount(0);
      const words = page.locator('.pj-shutdown .pj-headline .w').first();
      await words.tap();
      await page.locator('.pj-shutdown .pj-body .w').first().tap();
      await expect(page.locator('[data-mode="shutdown"]')).toBeVisible();
      const restart = page.getByRole('button', { name: /Start Over/ });
      await expectTarget(restart, 'Start Over');
      expect(await restart.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
      await restart.tap();
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    });

    test('the watchdog\'s Stay is a finger\'s size, and holds the pick', async ({ page }) => {
      await page.clock.install();
      await page.goto(`/countdown.html?now=${TUESDAY}`);
      await menuButton(page).tap();
      await sheet(page).getByRole('button', { name: 'Opening Ceremony' }).tap();
      await expect(page.locator('[data-mode="slideshow"]')).toBeVisible();
      await expect(page.locator('[data-resume-pill]')).toHaveCount(0);
      // 14 min 10 s on: 50 s of the 15-minute watchdog left, inside its 60 s warning.
      const now = await page.evaluate(() => Date.now());
      await page.clock.setSystemTime(now + 14 * 60_000 + 10_000);
      const pill = page.locator('[data-resume-pill]');
      await expect(pill).toBeVisible({ timeout: 8000 });
      await page.waitForTimeout(700);
      const stay = pill.getByRole('button', { name: 'Stay' });
      await expectTarget(stay, 'Stay');
      // Clear of the slide controls it shares the bottom with.
      const [p, n] = await Promise.all([pill.boundingBox(), page.locator('[data-slideshow-touch-nav]').boundingBox()]);
      expect(p.y + p.height <= n.y || n.x >= p.x + p.width || n.y + n.height <= p.y).toBe(true);
      await stay.tap();
      await expect(pill).toHaveCount(0);
      await expect(page.locator('[data-mode="slideshow"]')).toBeVisible();
    });
  });
}

/* ── A slide deck by finger ───────────────────────────────────────────── */

const OPENING = '2026-09-16T18:00:30';

/** A real one-finger swipe (Chromium's touch events, so the page sees pointer events). */
async function swipe(page, fromX, toX, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fromX, y }] });
  for (let i = 1; i <= 6; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fromX + ((toX - fromX) * i) / 6, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const slideIs = (page, id) => expect(page.locator('[data-slide]')).toHaveAttribute('data-slide', id);

for (const [name, use] of DEVICES) {
  test.describe(`the opening deck on ${name}`, () => {
    test.use(use);

    test('moves by tap zones and swipes, the blackout included, and its last tap starts games', async ({ page }) => {
      await page.goto(at(OPENING));
      await slideIs(page, 'welcome');
      const vp = page.viewportSize();
      const y = Math.round(vp.height * 0.45);
      await page.touchscreen.tap(Math.round(vp.width * 0.8), y);
      await slideIs(page, 'us-pledge');
      await page.touchscreen.tap(Math.round(vp.width * 0.1), y);
      await slideIs(page, 'welcome');
      await swipe(page, Math.round(vp.width * 0.7), Math.round(vp.width * 0.2), y);
      await slideIs(page, 'us-pledge');
      await swipe(page, Math.round(vp.width * 0.3), Math.round(vp.width * 0.8), y);
      await slideIs(page, 'welcome');
      await page.touchscreen.tap(Math.round(vp.width * 0.6), y);
      await page.touchscreen.tap(Math.round(vp.width * 0.6), y);
      await page.touchscreen.tap(Math.round(vp.width * 0.6), y);
      await slideIs(page, 'black-slide');
      // The blackout is a bare wall with no button on it: the wall itself answers.
      await page.touchscreen.tap(Math.round(vp.width * 0.6), y);
      await expect(page.locator('[data-mode="game-time"]')).toBeVisible();
    });

    test('has visible controls, each a finger\'s size, and none of them over the slide\'s words', async ({ page }) => {
      await page.goto(at(OPENING));
      const nav = page.locator('[data-slideshow-touch-nav]');
      await expect(nav).toBeVisible();
      await settle(page);
      await expect(page.locator('[data-slideshow-nav]')).toHaveCount(0);
      for (const label of ['Exit the slides', 'Previous slide', 'Next slide']) {
        await expectTarget(nav.getByRole('button', { name: label }), label);
      }
      await nav.getByRole('button', { name: 'Next slide' }).tap();
      await slideIs(page, 'us-pledge');
      // Let the pledge's words land, then measure them against the controls.
      await page.waitForTimeout(1600);
      const hits = await page.evaluate(() => {
        const n = document.querySelector('[data-slideshow-touch-nav]').getBoundingClientRect();
        const out = [];
        for (const el of document.querySelectorAll('.pj-slide .w, .pj-slide .pj-kicker, .pj-slide-clock')) {
          const r = el.getBoundingClientRect();
          if (r.width && r.left < n.right && r.right > n.left && r.top < n.bottom && r.bottom > n.top) out.push(el.textContent.trim());
        }
        return out;
      });
      expect(hits).toEqual([]);
    });

    test('Exit is tapped twice, with the toast saying so, and goes back to the countdown', async ({ page }) => {
      await page.goto(`/countdown.html?now=${OPENING}`);
      const exit = page.getByRole('button', { name: 'Exit the slides' });
      await exit.tap();
      const toast = page.locator('[data-pj-bottom-overlay]');
      await expect(toast).toBeVisible();
      await expect(toast.getByRole('img')).toHaveAttribute('aria-label', 'EXIT SLIDES Tap Exit again');
      // The toast is read from arm's length: at least 15px type.
      const size = await toast.locator('.pj-chip').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(15);
      await page.getByRole('button', { name: 'Tap again to exit the slides' }).tap();
      await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    });
  });
}

/* ── The first-run setup note on touch ─────────────────────────────────── */

/** A new screen: no live-data key and the note not dismissed (on the first load only, so a dismissal holds). */
const NO_KEY = () => {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' }));
  if (!sessionStorage.getItem('pj-seeded')) {
    sessionStorage.setItem('pj-seeded', '1');
    localStorage.removeItem('awanaSetupChecklistDismissed.v1');
  }
};
const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

/** Every visible piece of the wall's text and every chip, and the note, in px. */
const noteAndWall = (page) => page.evaluate(() => {
  const note = document.querySelector('[data-setup-checklist]');
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const content = [];
  const walker = document.createTreeWalker(document.querySelector('[data-mode]'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim()) continue;
    let opacity = 1;
    for (let e = n.parentElement; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    if (opacity < 0.2 || n.parentElement.closest('.pj-reel')) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) content.push({ name: n.data.trim().slice(0, 24), ...box(r) });
  }
  for (const el of document.querySelectorAll('[data-mode] .pj-chip, [data-timer], [data-slideshow-touch-nav]')) content.push({ name: el.getAttribute('aria-label') || el.className, ...box(el.getBoundingClientRect()) });
  return {
    note: note && { ...box(note.getBoundingClientRect()), overflow: note.scrollWidth - note.clientWidth, fonts: [...note.querySelectorAll('p, li, button')].map((e) => parseFloat(getComputedStyle(e).fontSize)) },
    content,
  };
});

// Where a phone on its side has no band at all, the note leaves the wall.
const WALL_NOTE = DEVICES.filter(([name]) => !/iPhone 14 landscape/.test(name));

for (const [name, use] of WALL_NOTE) {
  test.describe(`the setup note on ${name}`, () => {
    test.use(use);

    for (const [wall, now] of [['the countdown', TUESDAY], ['game time', '2026-09-16T18:20:00'], ['the opening deck', OPENING]]) {
      test(`fits, covers nothing on ${wall}, and its buttons are a finger's size`, async ({ page }) => {
        await page.addInitScript(NO_KEY);
        await page.goto(at(now));
        const note = page.locator('[data-setup-checklist]');
        await expect(note).toBeVisible();
        await expect(note).not.toContainText(/[Hh]over/);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1800);
        const m = await noteAndWall(page);
        const vp = page.viewportSize();
        expect(m.note.left).toBeGreaterThanOrEqual(0);
        expect(m.note.right).toBeLessThanOrEqual(vp.width + 0.5);
        expect(m.note.bottom).toBeLessThanOrEqual(vp.height + 0.5);
        expect(m.note.overflow).toBeLessThanOrEqual(1);
        for (const f of m.note.fonts) expect(f).toBeGreaterThanOrEqual(14);
        expect(m.content.filter((c) => overlaps(m.note, c)).map((c) => c.name)).toEqual([]);
        await expectTarget(note.getByRole('button', { name: 'Set up' }), 'Set up');
        await expectTarget(note.getByRole('button', { name: /show again/ }), "Don't show again");
      });
    }

    test('Set up opens the menu on Display Settings, and "Don\'t show again" puts it away', async ({ page }) => {
      await page.addInitScript(NO_KEY);
      await page.goto(at(TUESDAY));
      await page.locator('[data-setup-checklist]').getByRole('button', { name: 'Set up' }).tap();
      await expect(sheet(page)).toBeVisible();
      await expect(sheet(page).getByLabel('Display passphrase')).toBeVisible();
      await sheet(page).getByRole('button', { name: 'Close the menu' }).tap();
      await page.locator('[data-setup-checklist]').getByRole('button', { name: /show again/ }).tap();
      await expect(page.locator('[data-setup-checklist]')).toHaveCount(0);
      await expect(menuButton(page)).not.toHaveAttribute('data-setup', /.*/);
      expect(await page.evaluate(() => localStorage.getItem('awanaSetupChecklistDismissed.v1'))).toBe('1');
    });
  });
}

test.describe('the setup note on a phone on its side', () => {
  test.use(DEVICES[1][1]);

  test('leaves the wall: the menu button carries the mark, and the sheet opens on the steps', async ({ page }) => {
    await page.addInitScript(NO_KEY);
    await page.goto(at(TUESDAY));
    await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    await expect(page.locator('[data-setup-checklist]')).toBeHidden();
    await expect(menuButton(page)).toHaveAttribute('data-setup', /^$/);
    await menuButton(page).tap();
    const notice = sheet(page).locator('[data-setup-in-sheet]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/Display Settings, below/);
    await expect(sheet(page).getByLabel('Display passphrase')).toBeVisible();
    await notice.getByRole('button', { name: /show again/ }).tap();
    await expect(notice).toHaveCount(0);
    await expect(menuButton(page)).not.toHaveAttribute('data-setup', /.*/);
  });
});

/* ── Upright: a wall re-laid for a tall screen, not a letterboxed band ─── */

// Four special nights dated from the real today (the feed parser filters on
// the real clock, not ?now=), so the countdown carries its full list.
const specialFeed = (route) => {
  const day = (weeks) => {
    const d = new Date(Date.now() + (weeks * 7 + 1) * 86_400_000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const titles = ['Bring a Friend Night - Posters due', 'Parents Night - Poster voting', 'Pajama Night', 'Missions Month Kickoff', 'Awana meeting'];
  return route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceUrl: 'https://example.invalid/calendar/index',
      events: titles.map((title, i) => ({ date: day(i), kind: 'club', title, isCancelled: false })),
    }),
  });
};

/**
 * The wall's content (its words, chips, figures and pictures, never the
 * operator's controls) against the frame and the screen, in px.
 */
const wallLayout = (page) => page.evaluate(() => {
  const view = document.querySelector('[data-mode]');
  const chrome = [...document.querySelectorAll('[data-touch-menu], [data-slideshow-touch-nav]')].map((e) => e.getBoundingClientRect());
  const inChrome = (el) => el.closest('[data-slideshow-touch-nav], .sr-only');
  const boxes = [];
  const fonts = [];
  const walker = document.createTreeWalker(view, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.data.trim() || inChrome(el) || el.closest('svg')) continue;
    if (el.closest('.pj-reel') && !el.closest('.pj-reel__digit')) continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    if (opacity < 0.2) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) continue;
    boxes.push(...rects.map((r) => ({ name: n.data.trim().slice(0, 20), r })));
    fonts.push({ name: n.data.trim().slice(0, 20), size: parseFloat(getComputedStyle(el).fontSize) });
  }
  // The wall's pictures count with its words: the art, the club marks and
  // game time's mascots (the waves and sparkles are the room's, not content).
  const art = '.pj-chip, [data-timer], .pj-game__marks img, .pj-game__character';
  for (const el of view.querySelectorAll(art)) {
    const r = el.getBoundingClientRect();
    if (r.width > 1 && !inChrome(el)) boxes.push({ name: el.getAttribute('aria-label') || el.className.baseVal || el.className, r });
  }
  const f = document.querySelector('.pj-frame').getBoundingClientRect();
  const top = Math.min(...boxes.map((b) => b.r.top));
  const bottom = Math.max(...boxes.map((b) => b.r.bottom));
  const under = (r) => chrome.some((c) => r.left < c.right - 0.5 && r.right > c.left + 0.5 && r.top < c.bottom - 0.5 && r.bottom > c.top + 0.5);
  return {
    frame: { height: f.height / innerHeight, width: f.width / innerWidth, ratio: f.height / f.width },
    span: (bottom - top) / f.height,
    smallest: fonts.sort((a, b) => a.size - b.size)[0],
    offscreen: boxes.filter((b) => b.r.left < -0.5 || b.r.right > innerWidth + 0.5 || b.r.bottom > innerHeight + 0.5).map((b) => b.name),
    underChrome: boxes.filter((b) => under(b.r)).map((b) => b.name),
  };
});

const UPRIGHT = DEVICES.filter(([name]) => !/landscape/.test(name));
const TALL_WALLS = [
  ['the countdown, with four special nights', TUESDAY, 0],
  ['the Pledge of Allegiance', OPENING, 1],
  ['the Awana Pledge', OPENING, 2],
  ['game time', '2026-09-16T18:20:00', 0],
  ['Upcoming Awana Nights', '2026-09-16T19:31:00', 1],
];

for (const [name, use] of UPRIGHT) {
  test.describe(`upright on ${name}`, () => {
    test.use(use);

    for (const [wall, now, nexts] of TALL_WALLS) {
      test(`${wall}: a tall frame, filled at least half, nothing off the screen or under the controls`, async ({ page }) => {
        await page.route('**/calendar-feed.json', specialFeed);
        await page.goto(at(now));
        await expect(page.locator('[data-mode]')).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('data-portrait', '1');
        for (let i = 0; i < nexts; i++) {
          await page.waitForTimeout(500);
          await page.getByRole('button', { name: 'Next slide' }).tap();
        }
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(2400);
        const m = await wallLayout(page);
        // 9:16, and the screen's height (the letterboxed band was a quarter of it).
        expect(m.frame.ratio).toBeCloseTo(16 / 9, 1);
        expect(m.frame.height).toBeGreaterThanOrEqual(0.85);
        expect(m.span).toBeGreaterThanOrEqual(0.5);
        if (m.smallest) expect(m.smallest.size, m.smallest.name).toBeGreaterThanOrEqual(11);
        expect(m.offscreen).toEqual([]);
        expect(m.underChrome).toEqual([]);
      });
    }
  });
}

test.describe('a phone on its side keeps the wall', () => {
  test.use(DEVICES[1][1]);

  test('the 16:9 frame the projector shows, fitted to the screen\'s height', async ({ page }) => {
    await page.goto(at(TUESDAY));
    await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-portrait', /.*/);
    const f = await page.locator('.pj-frame').boundingBox();
    expect(f.width / f.height).toBeCloseTo(16 / 9, 2);
    const vh = page.viewportSize().height;
    expect(f.height).toBeLessThanOrEqual(vh + 0.5);
    expect(f.height).toBeGreaterThanOrEqual(vh * 0.97);
  });
});
