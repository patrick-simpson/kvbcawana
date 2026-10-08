import { expect, test } from '@playwright/test';
import { fakePusher } from './fakePusher.js';

// End-to-end coverage of the signage page's EVENT rendering.
//
// Until demo mode existed there was no way to get an event into this page from
// a test: the only seam was the live Pusher socket, which index-smoke.spec.js
// deliberately aborts to stay hermetic. So the signage app — the thing families
// actually look at — had exactly two e2e assertions: it boots, and overlay mode
// works. Nothing checked that a check-in produces a banner.
//
// The debug panel's simulators now route through the same sanitizers as real
// wire traffic (see src/hooks/useSocket.js simulateEvent), so driving them here
// exercises the real path: sanitize → handler → queue → render. A payload the
// wire could not deliver is dropped, which means these tests also fail if a
// simulator's shape drifts from the contract.
//
// Deliberately in the `smoke` project but wired into ci.yml only, NOT
// deploy.yml — same reasoning the visual tests carry: a multi-step
// timing-sensitive test must never stand between someone and a live fix at
// 5:55pm on a club night.

/** Abort every cross-origin fetch so the run is hermetic and offline-safe. */
async function goSignage(page, query = '') {
  await page.route(/open-meteo|pusher|twotimtwo/, (route) => route.abort());
  await page.goto(`/index.html${query}`);
  await expect(page.locator('.stage')).toBeVisible();
}

/** Open the debug panel (Ctrl+Shift+D) and wait for it. */
async function openDebug(page) {
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.debug')).toBeVisible();
}

// Names the simulators draw from — asserted rather than assumed, because the
// whole point of that list is that nothing on screen during a demo can be
// mistaken for a real child.
const FAKE_NAME = /TEST KID|DEMO KID|SAMPLE STAR|PRETEND PAL|PRACTICE RUN/i;

test('a simulated check-in renders a welcome banner', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  await expect(page.locator('.demo-pill')).toHaveCount(0);

  await page.getByRole('button', { name: 'Standard welcome' }).click();

  const banner = page.locator('.banner').first();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText(FAKE_NAME);
});

test('firing a simulator raises the demo badge and it stays up', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);
  await page.getByRole('button', { name: 'Standard welcome' }).click();

  const badge = page.locator('.demo-pill');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText(/not real check-ins/i);

  // A training badge that expires would fail at exactly the wrong moment, so
  // it must survive the banner it was raised by.
  await page.waitForTimeout(2000);
  await expect(badge).toBeVisible();
});

test('birthday and first-timer check-ins render their own banner modes', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  await page.getByRole('button', { name: 'Birthday welcome' }).click();
  await expect(page.locator('.banner.birthday')).toBeVisible();
  // The birthday sticker is the kit's own SVG starburst on purpose: no emoji,
  // so every TV draws it the same.
  await expect(page.locator('.banner.birthday .brand-sticker svg').first()).toBeVisible();

  // Let the queue drain before asking for the next mode, so we're asserting on
  // the new banner rather than the previous one.
  await page.waitForTimeout(6000);

  await page.getByRole('button', { name: 'First-timer welcome' }).click();
  await expect(page.locator('.banner')).toBeVisible();
});

test('a notice event renders the announcement banner verbatim', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  await page.getByRole('button', { name: 'Show cancellation alert' }).click();
  // `message` is the only free-text field on the channel; it is church-authored
  // and shown as-is, so this asserts the real copy reaches the screen.
  await expect(page.getByText(/CLUB CANCELLED TONIGHT/i)).toBeVisible();
  // The simulated bar holds for hours like a real one; the Debug panel can take it down.
  await page.getByRole('button', { name: 'Clear notice banner' }).click();
  await expect(page.getByText(/CLUB CANCELLED TONIGHT/i)).toHaveCount(0);
});

test('a tonight event renders the ticker counters', async ({ page }) => {
  // The strip is off unless this screen turns it on (Settings → Screen &
  // corner → This TV → "Tonight's numbers strip", 2026-10-07).
  await page.addInitScript(() => localStorage.setItem('awanaConfig.v1', JSON.stringify({ showTonightTicker: true })));
  await goSignage(page);
  await openDebug(page);

  await page.getByRole('button', { name: 'Show tonight ticker' }).click();
  // The simulator sends checkedIn: 63 — a number that cannot appear by accident.
  await expect(page.getByText(/63/).first()).toBeVisible();
});

test('a 20-kid rush queues rather than dropping banners', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  // Rush mode is the behaviour that matters most on a real club night: five
  // families arriving at once must each still get their full moment.
  await page.getByRole('button', { name: /20-kid rush/ }).click();

  await expect(page.locator('.banner').first()).toBeVisible();
  // The panel reports queue depth; a rush must actually enqueue.
  await expect(page.locator('.debug-stats')).toContainText(/queued: [1-9]/);
});

test('a tally broadcast reconciles the corner counter, including counting DOWN, without a "synced" note', async ({ page }) => {
  // The corner shows one item at a time, moving on with each slide load. The
  // placeholder background has no slides, so a timer on the slideshow delay
  // stands in for the loads; with the clock off (and no weather in this
  // hermetic run) the tally is the corner's only item, on every tick.
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ showClock: false, backgroundSource: 'powerpoint', slideshowDelaySec: 5 }));
  });
  await goSignage(page);
  await openDebug(page);

  // Climb well past the tally simulator's fixed total (9+16+23+30 = 78, see
  // DebugPanel.jsx) so the reconciliation below has to count DOWN — the
  // undo case a real operator hits when they void a mis-scanned check-in.
  const rush = page.getByRole('button', { name: /20-kid rush/ });
  await rush.click();
  await rush.click();
  await rush.click();
  await rush.click();

  // The corner freezes its value at each load, so allow it a tick to catch
  // up. (By name, not by class: at each load the outgoing and incoming chips
  // briefly cross over.)
  const tally = (n) => page.locator('.corner-chip--tally').getByRole('img', { name: `TONIGHT ${n}` });
  await expect(tally(80)).toBeAttached({ timeout: 12000 });

  await page.getByRole('button', { name: 'Simulate club tally (counts)' }).click();
  // The printer's total wins, down as well as up. Since printer 7.15.0 the
  // count is "here now", so a drop is children checking out, not a
  // correction: it carries no "synced with the check-in desk" note (#351's
  // note is for a jump UP only, 2026-10-07).
  await expect(tally(78)).toBeAttached({ timeout: 12000 });
  await page.waitForTimeout(500);
  await expect(
    page.locator('.corner-chip--tally')
      .filter({ has: page.getByRole('img', { name: 'TONIGHT 78' }) })
      .locator('.corner-chip__note'),
  ).toHaveCount(0);
});

test('simulated events do not raise page errors', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (err) => pageErrors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/net::ERR_FAILED|Failed to load resource/.test(msg.text())) {
      consoleErrors.push(msg.text());
    }
  });

  await goSignage(page);
  await openDebug(page);

  for (const name of [
    'Standard welcome',
    'Birthday welcome',
    'First-timer welcome',
    'Simulate recap replay (quiet banners)',
    'Simulate print failure (ops)',
    'Simulate club tally (counts)',
    'Show tonight ticker',
    'Show info notice',
  ]) {
    await page.getByRole('button', { name }).click();
    await page.waitForTimeout(150);
  }

  await page.waitForTimeout(1500);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

// NOTE: the "a malformed payload is rejected rather than rendered" property —
// the thing that makes the debug panel a live contract check — is covered by
// src/hooks/simulateEvent.test.js, which can call the seam directly. It is
// deliberately NOT duplicated here: these specs run against the built bundle,
// where a raw module import doesn't resolve, and a permanently-skipped test
// reads as coverage that doesn't exist.

test('a birthday later this week rides a ribbon instead of claiming today', async ({ page }) => {
  // The weekly `birthdays` roster now reaches the signage page too. Both
  // simulators name the same fixed child/club pair on purpose — the ribbon
  // only fires on a unique name+club match, so a random pick could never
  // drive this path.
  await goSignage(page);
  await openDebug(page);

  await page.getByRole('button', { name: /Seed birthday-week roster/ }).click();
  await page.getByRole('button', { name: /Welcome the birthday-week kid/ }).click();

  const banner = page.locator('.banner').first();
  await expect(banner).toBeVisible();
  await expect(banner.locator('.checkin__line')).toContainText(/Birthday this \w+!/);

  // Let the queue drain, as the other multi-banner tests here do.
  await page.waitForTimeout(6000);

  await page.getByRole('button', { name: /Birthday banner for that kid/ }).click();
  const cake = page.locator('.banner.birthday');
  await expect(cake.locator('.checkin__line')).toContainText(/Birthday this \w+!/);
  // "It's your special day" is simply wrong three days early.
  await expect(cake).not.toContainText(/special day/i);
});

test('books finished tonight get their own toast, one at a time', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  // #358 — the tonight simulator ramps books by 4 a press. The first payload
  // is only a baseline (a screen booting at 8pm must not replay the evening),
  // so it takes two presses to cross the default 5-book threshold.
  const tonight = page.getByRole('button', { name: 'Show tonight ticker' });
  await tonight.click();
  await tonight.click();

  // That second press also crosses the 100-kid night threshold, which is
  // exactly the pile-up useCelebrationQueue exists for: whatever is showing,
  // there is never more than ONE toast on screen.
  await expect(page.locator('.milestone-toast')).toHaveCount(1);

  // The handbook toast gets its own copy and its green handbook edge — it may
  // be queued behind the night milestone's hold, hence the longer wait.
  const books = page.locator('.milestone-toast.handbook-milestone');
  await expect(books).toBeVisible({ timeout: 20000 });
  await expect(books).toContainText(/Handbooks/i);
  await expect(books).toContainText(/5 books finished tonight!/i);
  await expect(page.locator('.milestone-toast')).toHaveCount(1);
});

test('a club milestone toast wears that club’s wordmark', async ({ page }) => {
  await goSignage(page);
  await openDebug(page);

  // The first tally of the night is only a baseline, so it takes two presses
  // to produce a crossing: 9 / 16 / 23 / 30, then +10 per club. With the
  // default clubMilestoneEvery of 10 several clubs cross at once and the
  // queue plays their toasts one at a time.
  const tally = page.getByRole('button', { name: 'Simulate club tally (counts)' });
  await tally.click();
  await tally.click();

  const toast = page.locator('.milestone-toast.club-milestone');
  await expect(toast).toBeVisible();
  // The badge is the club's own wordmark art, sized by the toast-scoped CSS.
  const logo = toast.locator('.club-logo');
  await expect(logo).toBeVisible();
  const box = await logo.boundingBox();
  expect(box.width).toBeGreaterThan(0);
  // Whatever the art's intrinsic size, it must stay inside the pill.
  const toastBox = await toast.boundingBox();
  expect(box.width).toBeLessThan(toastBox.width);
  // The mascot sticker is banner-scale art and is deliberately hidden here.
  await expect(toast.locator('.club-mascot')).toBeHidden();
});

test('the night’s first check-in raises the doors-are-open flourish, exactly once', async ({ page }) => {
  // #335 is phase-gated, and resolvePhase reads the real wall clock — a CI run
  // on a Wednesday evening would otherwise resolve 'game-time' and see no
  // flourish at all. So pin the phase hermetically: blank the shared-schedule
  // URL (so nothing is fetched) and seed the cache with today marked no-club,
  // which resolvePhase turns into 'off' at any hour on any day.
  await page.addInitScript(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ sharedScheduleUrl: '' }));
    localStorage.setItem('awanaSchedule.v1', JSON.stringify({
      fetchedAt: d.toISOString(),
      raw: {
        meeting: { day: d.getDay() },
        windows: [{ start: '18:00', end: '19:30', kind: 'game' }],
        specialDates: { [today]: { noClub: true } },
      },
    }));
  });
  await goSignage(page);
  await openDebug(page);

  await page.getByRole('button', { name: 'Standard welcome' }).click();

  const flourish = page.locator('.milestone-toast.first-milestone');
  await expect(flourish).toBeVisible();
  await expect(flourish).toContainText(/Doors are open/i);
  await expect(flourish).toContainText(/is first in tonight!/i);
  // Only a first name reaches it — the same name the banner itself shows.
  await expect(flourish).toContainText(FAKE_NAME);

  // It retires after MILESTONE_TOAST_MS, and the SECOND child of the night
  // gets a banner and no flourish: the whole point is that it happens once.
  await expect(flourish).toHaveCount(0, { timeout: 15000 });
  await page.getByRole('button', { name: 'Standard welcome' }).click();
  await expect(page.locator('.banner').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('.milestone-toast.first-milestone')).toHaveCount(0);
});

test('a check-in washes the background in the arriving club’s color, then clears it', async ({ page }) => {
  // #349 is opt-in, so seed it on. Sticker mode keeps the corner widgets out
  // of the way; 'manual' with nothing typed renders the placeholder scene,
  // which is a CatalogScene — one of ours to tint.
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({
      clubTintBackground: true,
      backgroundSource: 'manual',
      calendarEnabled: false,
      standardDisplayMs: 2000,
    }));
  });
  await goSignage(page);
  await openDebug(page);

  const scene = page.locator('.catalog-scene').first();
  await expect(scene).toBeVisible();
  await expect(scene).not.toHaveClass(/catalog-scene--club-tinted/);

  await page.getByRole('button', { name: 'Standard welcome' }).click();
  await expect(page.locator('.banner').first()).toBeVisible();
  await expect(scene).toHaveClass(/catalog-scene--club-tinted/);
  // A real colour, taken from the club palette — not white, not empty.
  const color = await scene.evaluate((el) => el.style.getPropertyValue('--club-tint'));
  expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  // It is a wash behind everything, never something a click can land on.
  await expect(page.locator('.scene-club-tint')).toHaveCSS('pointer-events', 'none');

  // Once the banner retires, the wash goes with it.
  await expect(scene).not.toHaveClass(/catalog-scene--club-tinted/, { timeout: 15000 });
});

// ── Who holds which part of the room (rebrand stage 4b-2) ──────────────────
// src/lib/overlayFit.js lobbyRoom decides it and the unit tests pin the
// decision; these check what the real page PAINTS: stacking, the slide copy's
// computed opacity, and a club mark staying inside its slot.

const TYPED_DECK = [{ id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook', theme: 'sky' }];
const copyOpacity = (page) => page.locator('.manual-slideshow .manual-slide-copy').evaluate((el) => Number(getComputedStyle(el).opacity));

test('a critical notice stays on top of a check-in, and the slide copy steps aside for it', async ({ page }) => {
  await page.addInitScript((slides) => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: slides }));
  }, TYPED_DECK);
  await goSignage(page);
  await expect.poll(() => copyOpacity(page)).toBe(1);
  await openDebug(page);
  await page.getByRole('button', { name: 'Show cancellation alert' }).click();
  const notice = page.locator('.notice-banner--critical');
  await expect(notice).toBeVisible();
  await expect.poll(() => copyOpacity(page)).toBe(0);
  await page.getByRole('button', { name: 'Standard welcome' }).click();
  await expect(page.locator('.banner').first()).toBeVisible();
  // The debug panel sits above everything on the stage: put it away.
  await page.keyboard.press('Control+Shift+D');
  await expect(page.locator('.debug')).toHaveCount(0);
  // Whatever is painted at the alert's centre belongs to the alert, not the
  // check-in wave that has risen behind it. (Every overlay here ignores the
  // pointer, which hit-testing honours, so it is switched back on for the
  // question: what is on top at this point?)
  await page.addStyleTag({ content: '* { pointer-events: auto !important; }' });
  const onTop = await notice.evaluate((el) => {
    const r = el.querySelector('.notice-banner-message').getBoundingClientRect();
    // The confetti canvas floats over the whole page on purpose; skip it.
    const hit = document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      .find((e) => e.tagName !== 'CANVAS');
    if (hit && hit.closest('.notice-banner--critical')) return 'notice';
    return hit ? `${hit.tagName}.${String(hit.getAttribute('class') || '')}` : 'nothing';
  });
  expect(onTop).toBe('notice');
});

// The pickup features come on by themselves from 7:30 pm (2026-10-08): the
// page's clock is set to a Tuesday evening, running.
const PICKUP_TIME = new Date('2026-10-06T19:45:00-04:00');

test('at pickup time the list takes the foot by itself and the slides carry on above it', async ({ page }) => {
  await page.clock.install({ time: PICKUP_TIME });
  const config = { backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: TYPED_DECK, sharedScheduleUrl: '' };
  await page.addInitScript((c) => localStorage.setItem('awanaConfig.v1', JSON.stringify(c)), config);
  await goSignage(page);
  await openDebug(page);
  await page.getByRole('button', { name: /Still-here board: 9 children/ }).click();
  await expect(page.locator('.checkout-board.names.checkout-board--list')).toBeVisible();
  await expect(page.locator('.checkout-name__chip')).toHaveCount(9);
  await page.waitForTimeout(800);
  // Nothing steps aside for it, and it stays below the copy's box.
  expect(await copyOpacity(page)).toBe(1);
  await expect(page.locator('.stage.board-up')).toHaveCount(0);
  const card = await page.locator('.checkout-board').boundingBox();
  const copy = await page.locator('.manual-slideshow .manual-slide-copy .lobby-headline').first().boundingBox();
  expect(card.y).toBeGreaterThan(copy.y + copy.height);
});

test('before 7:30 pm a list on the wire shows nothing', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-06T18:10:00-04:00') });
  const config = { backgroundSource: 'manual', calendarEnabled: false, seasonPromos: false, manualSlides: TYPED_DECK, sharedScheduleUrl: '' };
  await page.addInitScript((c) => localStorage.setItem('awanaConfig.v1', JSON.stringify(c)), config);
  await goSignage(page);
  await openDebug(page);
  await page.getByRole('button', { name: /Still-here board: 9 children/ }).click();
  await page.waitForTimeout(800);
  await expect(page.locator('.checkout-board')).toHaveCount(0);
  expect(await copyOpacity(page)).toBe(1);
});

test('a T&T check-in keeps its square mark inside its slot, on screen', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    localStorage.setItem('awanaConfig.v1', JSON.stringify({ standardDisplayMs: 3000, firstArrivalMoment: false }));
  });
  await goSignage(page);
  await openDebug(page);
  await page.getByRole('button', { name: 'Trigger every club' }).click();
  // One run, every club in turn: T&T's name flips in a few children along.
  const tnt = page.locator('.checkin[data-club="T&T"]');
  await expect(tnt).toBeVisible({ timeout: 30000 });
  // The previous club's mark has crossed out by now; the name holds 3 s.
  await page.waitForTimeout(700);
  const { mark, slot, vh } = await tnt.evaluate((el) => {
    const m = el.querySelector('.checkin__mark').getBoundingClientRect();
    const s = el.querySelector('.checkin__mark-slot').getBoundingClientRect();
    return { mark: [m.top, m.bottom, m.height], slot: [s.top, s.bottom, s.height], vh: window.innerHeight };
  });
  expect(mark[2]).toBeGreaterThan(0);
  expect(mark[2]).toBeLessThanOrEqual(slot[2] + 1);
  expect(mark[1]).toBeLessThanOrEqual(vh);
});

// ── Marks on the overlays' plates ────────────────────────────────────
// Paytone One draws a capital's marks far past its caps: before these fixes
// MAXIMILIÁN's accent crossed the doors-open toast's top keyline, NGUYỄN's
// tilde went through its pill's, ȘTEFAN's comma shadow sat on its bottom one,
// and a pickup-board chip's mark ran off its pill onto the white card. A real
// first name only reaches either over the socket, so these tests stand in for
// Pusher (page.routeWebSocket) and publish plaintext, as a printer with no
// display key does, under ?lowPower=1 so every frame is the resting one.
// MilestoneToast.test.jsx and overlayFit.test.js pin the arithmetic; this
// pins what Chromium actually paints.

/** Boot the lobby on a typed slide, with a key for the stand-in socket. */
async function goLobby(page, extra = {}) {
  const send = await fakePusher(page);
  await page.addInitScript((config) => {
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaConfig.v1', JSON.stringify(config));
  }, {
    pusherAppKey: 'e2e-key',
    pusherCluster: 'us2',
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    manualSlides: TYPED_DECK,
    showClock: false,
    particleEffect: 'off',
    ...extra,
  });
  await page.goto('/index.html?lowPower=1');
  await expect(page.locator('.stage')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  return send;
}

/**
 * Screenshot the page and decode it in the page, so a test can ask whether a
 * pixel was painted white: `window.e2eWhite(x, y)`.
 */
async function decodePaint(page) {
  const png = (await page.screenshot()).toString('base64');
  await page.evaluate(async (data) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d');
    c.drawImage(bmp, 0, 0);
    const img = c.getImageData(0, 0, bmp.width, bmp.height).data;
    window.e2eWhite = (x, y) => {
      const i = (Math.round(y) * bmp.width + Math.round(x)) * 4;
      return img[i] > 235 && img[i + 1] > 235 && img[i + 2] > 235;
    };
  }, png);
}

/** Today is no club night, so the phase is 'off' at any hour (the flourish is phase-gated). */
async function pinNoClub(page) {
  await page.addInitScript(() => {
    const pad = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    localStorage.setItem('awanaSchedule.v1', JSON.stringify({
      fetchedAt: d.toISOString(),
      raw: { meeting: { day: d.getDay() }, windows: [{ start: '18:00', end: '19:30', kind: 'game' }], specialDates: { [today]: { noClub: true } } },
    }));
  });
}

for (const [width, height] of [[1920, 1080], [1280, 720], [3840, 2160]]) {
  test.describe(`marks on the overlays at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    for (const firstName of ['Maximilián', 'Nguyễn', 'Ștefan', 'Bartholomew']) {
      test(`the doors-open toast keeps ${firstName}'s line inside its keylines`, async ({ page }) => {
        await pinNoClub(page);
        const send = await goLobby(page, { firstArrivalMoment: true, sharedScheduleUrl: '' });
        await send('checkin', { id: `e2e-${firstName}`, firstName, club: 'Trek', at: new Date().toISOString() });
        const count = page.locator('.milestone-toast.first-milestone .milestone-count');
        await expect(count).toContainText(`${firstName} is first in tonight!`);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        await decodePaint(page);
        const m = await page.evaluate(() => {
          const white = window.e2eWhite;
          const u = Math.min(innerWidth, innerHeight * 16 / 9) / 100;
          const q = (s) => document.querySelector(`.milestone-toast ${s}`);
          const body = q('.step-plate__body').getBoundingClientRect();
          const pill = q('.step-plate__label').getBoundingClientRect();
          const kh = Number(q('.step-plate__keyline').getAttribute('stroke-width')) / 2;
          const dy = Number(q('.step-plate__fill').getAttribute('transform').match(/translate\([-\d.]+ ([-\d.]+)\)/)[1]);
          const line = q('.milestone-count');
          const cs = getComputedStyle(line);
          // The row's ink: its baseline from a zero-height probe, the letters'
          // reach from the canvas's box in the face and size the page drew.
          const probe = document.createElement('span');
          probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
          line.appendChild(probe);
          const baseline = probe.getBoundingClientRect().top;
          probe.remove();
          const ctx = new OffscreenCanvas(1, 1).getContext('2d');
          ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          const ink = ctx.measureText(line.textContent.toUpperCase());
          const shadow = parseFloat(cs.textShadow.match(/(-?[\d.]+)px\s+(-?[\d.]+)px/)?.[2] ?? '0');
          // White ink right of the pill, above the top keyline or in the room's
          // background between the keyline and the out-of-register fill (the
          // sparkles on the plate's shoulder are left out).
          let escaped = 0;
          for (let x = Math.ceil(pill.right + kh + 1); x <= body.right - 3 * u; x++) {
            for (let y = Math.floor(body.top - 3 * u); y <= body.top + dy - 0.5; y++) {
              if (Math.abs(y - body.top) <= kh + 1) continue;
              if (white(x, y)) escaped++;
            }
          }
          return {
            top: baseline - ink.actualBoundingBoxAscent - (body.top + kh),
            bottom: (body.bottom - kh) - (baseline + ink.actualBoundingBoxDescent + shadow),
            escaped,
            pad: [cs.paddingTop, cs.paddingBottom],
          };
        });
        // Clear of the keyline's inner edge above and below, marks, shadow and all.
        expect(m.top).toBeGreaterThanOrEqual(0);
        expect(m.bottom).toBeGreaterThanOrEqual(0);
        expect(m.escaped).toBe(0);
        // A plain name gets no room at all, so it sits exactly where it did.
        if (firstName === 'Bartholomew') expect(m.pad).toEqual(['0px', '0px']);
      });
    }

    test('a pickup-board chip keeps a capital\'s mark on its pill', async ({ page }) => {
      const at = '2026-09-16T19:40:00-04:00';
      await page.clock.install({ time: new Date(at) });
      const send = await goLobby(page, { checkoutBoardNamesAbove: 0, firstArrivalMoment: false });
      const names = ['Élodie', 'Ấn', 'NGUYỄN', 'Ștefan', 'Ava'];
      await send('checkout', { entries: names.map((firstName) => ({ firstName, club: 'Sparks' })), printed: 12, at });
      await expect(page.locator('.checkout-name__chip')).toHaveCount(names.length);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      await decodePaint(page);
      const chips = await page.evaluate(() => {
        const white = window.e2eWhite;
        return [...document.querySelectorAll('.checkout-name__chip')].map((el) => {
          const r = el.getBoundingClientRect();
          let broken = 0;
          // Along the pill's flat top: the row just inside its edge is the
          // pill's colour, never the name's white ink running through it.
          for (let x = Math.ceil(r.left + r.height * 0.6); x <= r.right - r.height * 0.6; x++) {
            if (white(x, Math.floor(r.top) + 1)) broken++;
          }
          return { name: el.textContent, broken, seat: el.style.getPropertyValue('--seat') };
        });
      });
      for (const c of chips) expect(c.broken, c.name).toBe(0);
      expect(chips.find((c) => c.name === 'Ava').seat).toBe('');
    });
  });
}
