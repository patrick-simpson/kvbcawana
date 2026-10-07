import { test as plain } from '@playwright/test';
import { expect, test } from './pastFlagship.js';

// The first-run setup card / note must never cover what a screen is showing.
//
// It used to stand in the bottom-left corner: 25u square on the lobby, 23rem
// on the projector. On the lobby that is inside the copy's own box at every
// size (it hid the start of a long calendar title at 720p and the chip row at
// 1080p); on the projector a corner of a centred, full-width layout is never
// free (it covered the left of the upcoming-nights list at 720p and the
// coming-up chips at 1080p). Both are strips in the bottom band now, the zone
// each page's layout keeps clear:
//   lobby     the strip under the copy's lowest line (45u), between the gear
//             and the corner chip (OVERLAY.setup, src/lib/overlayFit.js)
//   projector the bottom margin band, below the coming-up list's 51.75u
//             (SETUP_NOTE, src/presentation/components/SetupChecklist.jsx)
// These measure real layout in Chromium: every rect of content on the page
// against the card's own, at the sizes the screens actually run at.

const SIZES = [[1024, 768], [1280, 720], [1366, 768], [1920, 1080], [3840, 2160]];
const NO_KEY = () => localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '' }));

/** Do two boxes {left, top, right, bottom} share any area? Touching is not overlap. */
const overlaps = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;

/* ── The lobby ───────────────────────────────────────────────────────── */

const LOBBY = {
  // Three shouted rows at 720p: the tallest a shout gets, and the widest.
  shout: { eyebrow: 'Next club night', text: 'AWANA MEETING (MAKING BOOKMARKS)' },
  // The read layout: a paragraph that runs all the way down to 45u.
  read: {
    eyebrow: 'Please read',
    text: 'Bring a friend night is next Wednesday and every child who brings a guest gets a special prize from the leaders, so remind your family tonight and pick up a flyer at the door on your way out of the gym, and thank you for all the help this fall',
  },
};

async function showLobby(page, { eyebrow, text }) {
  await page.route(/open-meteo|pusher|twotimtwo|sockjs/, (route) => route.abort());
  await page.addInitScript((cfg) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify(cfg));
  }, {
    pusherAppKey: '',
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    slideshowDelaySec: 3,
    manualSlides: [{ id: 's_setup', eyebrow, text, theme: 'sky', textSize: 'auto', durationSec: 0 }],
  });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.lobby-headline')).toBeVisible();
  await expect(page.locator('.setup-card')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  // A face that lands after the first fit refits; let that settle.
  await page.waitForTimeout(300);
}

/** Everything the lobby draws that the card must not cover, in px, and the card. */
const lobbyBoxes = (page) => page.evaluate(() => {
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const textBoxes = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5).map(box);
  };
  const stage = document.querySelector('.lobby-stage').getBoundingClientRect();
  const u = stage.width / 100;
  const content = [];
  const add = (name, boxes) => boxes.forEach((b) => content.push({ name, ...b }));
  for (const w of document.querySelectorAll('.lobby-headline .lobby-word')) add(`word "${w.textContent}"`, [box(w.getBoundingClientRect())]);
  for (const k of document.querySelectorAll('.lobby-kicker')) add('kicker', textBoxes(k));
  for (const s of document.querySelectorAll('.lobby-sub')) add('sub line', textBoxes(s));
  for (const c of document.querySelectorAll('.lobby-chip')) add('date chip', [box(c.getBoundingClientRect())]);
  for (const el of document.querySelectorAll('.settings-gear')) add('gear', [box(el.getBoundingClientRect())]);
  for (const el of document.querySelectorAll('.corner-bottom .corner-chip')) add('corner chip', [box(el.getBoundingClientRect())]);
  for (const el of document.querySelectorAll('.corner-stack > *')) add('top-right stack', [box(el.getBoundingClientRect())]);
  for (const el of document.querySelectorAll('.tonight-ticker, .checkout-region')) add('ticker or board', [box(el.getBoundingClientRect())]);
  const card = document.querySelector('.setup-card');
  return {
    screen: { width: innerWidth, height: innerHeight },
    u,
    copyBottom: Math.max(...[...document.querySelectorAll('.lobby-copy')].map((c) => c.getBoundingClientRect().bottom)),
    line: stage.top + 45 * u,
    card: box(card.getBoundingClientRect()),
    cardFont: parseFloat(getComputedStyle(card.querySelector('li')).fontSize),
    cardOverflow: card.scrollHeight - card.clientHeight,
    content,
  };
});

for (const [width, height] of SIZES) {
  test.describe(`the lobby's first-run card at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const [name, slide] of Object.entries(LOBBY)) {
      test(`covers nothing on a ${name} slide, and stays under the copy's 45u line`, async ({ page }) => {
        await showLobby(page, slide);
        const m = await lobbyBoxes(page);
        expect(m.content.length).toBeGreaterThan(4);

        // Not one drawn box of copy, chrome or corner is under the card.
        const hits = m.content.filter((c) => overlaps(m.card, c)).map((c) => c.name);
        expect(hits).toEqual([]);

        // It is a foot: below everything the copy can reach, inside the screen,
        // and never spilling its own words out of its box.
        expect(m.card.top).toBeGreaterThanOrEqual(m.line - 0.5);
        expect(m.card.top).toBeGreaterThanOrEqual(m.copyBottom - 0.5);
        expect(m.card.left).toBeGreaterThanOrEqual(0);
        expect(m.card.right).toBeLessThanOrEqual(m.screen.width);
        expect(m.card.bottom).toBeLessThanOrEqual(m.screen.height);
        expect(m.cardOverflow).toBeLessThanOrEqual(1);
        // A volunteer reads it from arm's length: never below the 12px root's steps.
        expect(m.cardFont).toBeGreaterThanOrEqual(11.4);
      });
    }
  });
}

test.describe('the lobby\'s first-run card, 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('still opens Settings, and goes for good with "Don\'t show again"', async ({ page }) => {
    await showLobby(page, LOBBY.shout);
    await page.locator('.setup-card').getByRole('button', { name: 'Open Settings' }).click();
    await expect(page.locator('.setup-card')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.panel--tabbed')).toHaveCount(0);
    await expect(page.locator('.setup-card')).toBeVisible();
    await page.getByRole('button', { name: /show again/ }).click();
    await expect(page.locator('.setup-card')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('.lobby-headline')).toBeVisible();
    await expect(page.locator('.setup-card')).toHaveCount(0);
  });

  test('gives the foot to the tonight strip while it has counts, and never draws over it', async ({ page }) => {
    // Content over instructions: the strip is what the room is looking at,
    // and the debug panel's simulator must show it on a fresh screen too.
    await page.route(/open-meteo|pusher|twotimtwo|sockjs/, (route) => route.abort());
    // The strip is off by default (7.15.0): this screen has turned it on.
    await page.addInitScript(() => localStorage.setItem('awanaConfig.v1', JSON.stringify({ pusherAppKey: '', showTonightTicker: true })));
    await page.goto('/index.html?lowPower=1');
    await expect(page.locator('.setup-card')).toBeVisible();
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('.debug')).toBeVisible();
    await page.getByRole('button', { name: 'Show tonight ticker' }).click();
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('.debug')).toHaveCount(0);
    await expect(page.locator('.tonight-ticker')).toBeVisible();
    await expect(page.locator('.setup-card')).toHaveCount(0);
    // The strip sits clear of the gear and the corner chip, as it always did.
    const strip = await page.locator('.tonight-ticker').boundingBox();
    for (const sel of ['.settings-gear', '.corner-bottom .corner-chip']) {
      const other = await page.locator(sel).first().boundingBox();
      expect(overlaps(
        { left: strip.x, top: strip.y, right: strip.x + strip.width, bottom: strip.y + strip.height },
        { left: other.x, top: other.y, right: other.x + other.width, bottom: other.y + other.height },
      ), sel).toBe(false);
    }
  });

  // Plain `test`: the card must be there on the very first frame, over the flagship.
  plain('is still there, and still in the foot, when the zero-animation flag is off', async ({ page }) => {
    // The card has no motion of its own; ?lowPower=1 changes nothing about where it stands.
    await page.route(/open-meteo|pusher|twotimtwo|sockjs/, (route) => route.abort());
    await page.addInitScript(NO_KEY);
    await page.goto('/index.html');
    await expect(page.locator('.setup-card')).toBeVisible();
    const box = await page.locator('.setup-card').boundingBox();
    expect(box.y).toBeGreaterThan(720 / 2 + 16.875 * 12.8 - 1);
    const animations = await page.locator('.setup-card').evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(animations).toBe(0);
  });
});

/* ── The projector ───────────────────────────────────────────────────── */

const day = (weeks) => {
  const d = new Date(Date.now() + (weeks * 7 + 1) * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// The feed's own long run: three long names, two of them specials.
const NIGHTS = [
  'Awana meeting (Making Bookmarks)',
  'Awana meeting (Making Bookmarks)',
  'Bring a Friend Night - Posters due',
  'Parents Night - Poster voting',
  'Awana meeting',
];

async function showWall(page, { now, coming = false }) {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.route('**/calendar-feed.json', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      sourceUrl: 'https://example.invalid/calendar/index',
      events: NIGHTS.map((title, i) => ({ date: day(i), kind: 'club', title, isCancelled: false })),
    }),
  }));
  await page.addInitScript(NO_KEY);
  await page.goto(`/countdown.html?now=${now}`);
  await expect(page.locator('[data-setup-checklist]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (coming) {
    await expect(page.locator('[data-slide="goodnight"]')).toBeVisible();
    // The slideshow starts listening for keys a moment after its first slide is
    // on screen (its effects run after the first paint), so a press sent the
    // instant the slide appears can be lost, as countdown-modes.spec.js found.
    // Press until the next slide is up; the closing deck holds its last slide,
    // so an extra press is harmless.
    const chips = page.locator('.pj-chip-row .pj-chip');
    await expect
      .poll(async () => {
        if ((await chips.count()) === 0) await page.keyboard.press('Space');
        return chips.count();
      }, { timeout: 10_000, intervals: [250] })
      .toBeGreaterThan(0);
    await expect(chips).toHaveCount(5);
  }
}

/**
 * Everything the wall draws that the note must not cover, in px: every
 * visible piece of text (as far as its own clipping shows it: a digit reel
 * keeps its other numerals above and below, hidden), every stepped chip, and
 * the note itself. `settled` says two samples 300 ms apart agreed, so the
 * chips have finished landing and the figures are between rolls.
 */
const wallBoxes = (page) => page.evaluate(() => {
  const note = document.querySelector('[data-setup-checklist]');
  const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const clipOf = (el) => {
    const c = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity };
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const b = e.getBoundingClientRect();
      if (cs.overflowX !== 'visible') { c.left = Math.max(c.left, b.left); c.right = Math.min(c.right, b.right); }
      if (cs.overflowY !== 'visible') { c.top = Math.max(c.top, b.top); c.bottom = Math.min(c.bottom, b.bottom); }
    }
    return c;
  };
  const content = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.data.trim() || note.contains(n)) continue;
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    if (opacity < 0.2) continue;
    const clip = clipOf(el);
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const b = {
        left: Math.max(r.left, clip.left), right: Math.min(r.right, clip.right),
        top: Math.max(r.top, clip.top), bottom: Math.min(r.bottom, clip.bottom),
      };
      if (b.right - b.left > 1 && b.bottom - b.top > 1) content.push({ name: `text "${n.data.trim().slice(0, 30)}"`, ...b });
    }
  }
  for (const chip of document.querySelectorAll('.pj-chip')) content.push({ name: 'chip', ...box(chip.getBoundingClientRect()) });
  const frame = document.querySelector('.pj-frame')?.getBoundingClientRect();
  const u = frame ? frame.width / 100 : innerWidth / 100;
  return {
    screen: { width: innerWidth, height: innerHeight },
    u,
    frameTop: frame ? frame.top : 0,
    note: box(note.getBoundingClientRect()),
    // The smallest type the note sets: its own lines, never a stray icon.
    noteFont: Math.min(...[...note.querySelectorAll('li, p, button')].map((el) => parseFloat(getComputedStyle(el).fontSize))),
    content,
  };
});

async function settledWall(page) {
  let last = null;
  await expect.poll(async () => {
    const m = await wallBoxes(page);
    const key = JSON.stringify(m.content.map((c) => [c.name, Math.round(c.left), Math.round(c.top), Math.round(c.right), Math.round(c.bottom)]));
    const same = key === last;
    last = key;
    if (!same) await page.waitForTimeout(300);
    return same;
  }, { timeout: 10_000, intervals: [50] }).toBe(true);
  return wallBoxes(page);
}

const WALLS = [
  // The countdown: Tuesday evening, a night out, two special nights listed under the figures.
  ['the countdown', { now: '2026-09-15T18:30:00' }, [[1280, 720], [1920, 1080]]],
  // Game time: the club's waves and the game clock (the mascots are art, and are not content).
  ['game time', { now: '2026-09-16T18:20:00' }, [[1280, 720], [1920, 1080]]],
  // The closing deck's Upcoming Awana Nights, packed to its 51.75u limit: the tightest fit on any wall.
  ['the upcoming-nights list, packed', { now: '2026-09-16T19:31:00', coming: true }, SIZES],
];

for (const [name, opts, sizes] of WALLS) {
  for (const [width, height] of sizes) {
    test(`the projector's setup note covers nothing on ${name} at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await showWall(page, opts);
      const m = await settledWall(page);
      expect(m.content.length).toBeGreaterThan(3);

      const hits = m.content.filter((c) => overlaps(m.note, c)).map((c) => c.name);
      expect(hits).toEqual([]);

      // It is a strip in the bottom margin band: below the 51.75u the coming-up
      // list stops at, inside the window, and its second line still readable.
      expect(m.note.top).toBeGreaterThanOrEqual(m.frameTop + 51.75 * m.u - 0.5);
      expect(m.note.left).toBeGreaterThanOrEqual(0);
      expect(m.note.right).toBeLessThanOrEqual(m.screen.width);
      expect(m.note.bottom).toBeLessThanOrEqual(m.screen.height);
      expect(m.noteFont).toBeGreaterThanOrEqual(10.2);
    });
  }
}

test.describe('the projector\'s setup note, 1280x720', () => {
  test.use({ viewport: { width: 1280, height: 720 } });

  test('stays out of the screenshot mode and goes for good with "Don\'t show again"', async ({ page }) => {
    await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
    await page.addInitScript(NO_KEY);
    await page.goto('/countdown.html?now=2026-09-15T18:30:00&vr=1');
    await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    await expect(page.locator('[data-setup-checklist]')).toHaveCount(0);

    await page.goto('/countdown.html?now=2026-09-15T18:30:00');
    await expect(page.locator('[data-setup-checklist]')).toBeVisible();
    await page.getByRole('button', { name: /show again/i }).click();
    await expect(page.locator('[data-setup-checklist]')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-mode="countdown"]')).toBeVisible();
    await expect(page.locator('[data-setup-checklist]')).toHaveCount(0);
  });
});

/* ── The projector's note among the wall's own bottom overlays ───────── */

// The bottom band is not empty of the wall's OWN overlays. The slideshow's
// Prev / Next pill stands at the window's bottom-right while the pointer is on
// the wall; its "Exit slides / Press ESC again" toast and the watchdog's "Back
// to schedule in" pill stand at bottom-centre. A first pass put the note under
// all three: at 1920x1080 "DON'T SHOW AGAIN" was clipped to "DON'T SHOW AG" by
// the pill, and 25-41% of that button routed a click to Prev. The note now
// stops short of the pill, and gives way to the other two while they are up.

const OPENING_DECK = '/countdown.html?now=2026-09-16T18:00:30';
const NOTE = '[data-setup-checklist]';

async function showOpeningDeck(page) {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.addInitScript(NO_KEY);
  await page.goto(OPENING_DECK);
  await expect(page.locator(NOTE)).toBeVisible();
  await expect(page.locator('[data-slide="welcome"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

for (const [width, height] of SIZES) {
  test(`the projector's note stays clear of the hover Prev / Next pill, and its button is the one clicked, at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await showOpeningDeck(page);

    // The pointer on the wall shows the pill (a 300 ms fade), which is when it is in the way.
    await page.mouse.move(width / 2, height / 3);
    const nav = page.locator('[data-slideshow-nav]');
    await expect(nav).toHaveCSS('opacity', '1');

    const boxes = await page.evaluate(() => {
      const box = (r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      const note = document.querySelector('[data-setup-checklist]');
      const button = note.querySelector('button').getBoundingClientRect();
      return {
        note: box(note.getBoundingClientRect()),
        nav: box(document.querySelector('[data-slideshow-nav]').getBoundingClientRect()),
        // Whatever is topmost at seven points along the button's own middle line.
        hits: [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95].map((f) => {
          const hit = document.elementFromPoint(button.left + button.width * f, button.top + button.height / 2);
          return note.querySelector('button').contains(hit) ? 'the button' : (hit?.closest('button')?.textContent.trim() || hit?.tagName);
        }),
      };
    });
    expect(overlaps(boxes.note, boxes.nav)).toBe(false);
    expect(boxes.hits).toEqual(Array(7).fill('the button'));
    expect(boxes.note.right).toBeLessThanOrEqual(boxes.nav.left);
    expect(boxes.note.bottom).toBeLessThanOrEqual(height);
  });
}

for (const [width, height] of [[1280, 720], [1920, 1080]]) {
  test.describe(`at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the projector\'s note gives way to the ESC toast, and comes back when the toast has gone', async ({ page }) => {
      await showOpeningDeck(page);
      await page.mouse.move(width / 2, height / 3);
      await page.keyboard.press('Escape');

      const toast = page.locator('[data-pj-bottom-overlay]');
      await expect(toast).toBeVisible();
      await expect(toast).toContainText('Press ESC again');
      // They share the ground (that is why the note yields): the toast sits on the note's strip.
      const [t, n] = await Promise.all([toast.boundingBox(), page.locator(NOTE).boundingBox()]);
      expect(overlaps(
        { left: t.x, top: t.y, right: t.x + t.width, bottom: t.y + t.height },
        { left: n.x, top: n.y, right: n.x + n.width, bottom: n.y + n.height },
      )).toBe(true);
      await expect(page.locator(NOTE)).toBeHidden();

      // The toast times itself out after 3 s; the note returns once it has left the DOM, not before.
      await expect(toast).toHaveCount(0, { timeout: 8000 });
      await expect(page.locator(NOTE)).toBeVisible();
    });

    test('the projector\'s note gives way to the watchdog\'s "back to schedule" pill, and comes back when it goes', async ({ page }) => {
      await page.clock.install();
      await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
      await page.addInitScript(NO_KEY);
      await page.goto('/countdown.html?now=2026-09-15T18:30:00');
      await expect(page.locator(NOTE)).toBeVisible();
      await page.evaluate(() => document.fonts.ready);

      // An operator override of the schedule, from the hover menu at the top-right.
      await page.mouse.move(width - 20, 20);
      await page.getByRole('button', { name: 'Opening Ceremony' }).click();
      await page.mouse.move(width / 2, height / 3);
      await expect(page.locator('[data-mode="slideshow"]')).toBeVisible();
      await expect(page.locator('[data-resume-pill]')).toHaveCount(0);
      await expect(page.locator(NOTE)).toBeVisible();

      // 14 min 10 s on: 50 s of the 15-minute watchdog left, inside its 60 s warning.
      const now = await page.evaluate(() => Date.now());
      await page.clock.setSystemTime(now + 14 * 60_000 + 10_000);
      const pill = page.locator('[data-resume-pill]');
      await expect(pill).toBeVisible({ timeout: 8000 });
      await expect(pill).toHaveAttribute('data-pj-bottom-overlay');
      await expect(page.locator(NOTE)).toBeHidden();

      await page.getByRole('button', { name: 'Stay' }).click();
      await expect(pill).toHaveCount(0);
      await expect(page.locator(NOTE)).toBeVisible();
    });
  });
}
