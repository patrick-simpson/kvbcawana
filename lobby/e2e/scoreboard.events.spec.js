import { expect, test } from '@playwright/test';
import { SYNC_BASE, liveChannel } from './liveChannel.js';
import { Scoreboard } from '../../worker/src/scoreboard.js';

// The game time scoreboard end to end (owner 2026-11-05; routes.md 10.17): the
// leader's phone (scoreboard.html) and the game time projector
// (countdown.html), both on ONE stand-in Worker that is the real Worker module
// (worker/src/scoreboard.js) over memory storage; its doorbell rings reach the
// projector on its live channel, as the Worker's broadcast does.
//
// SCOREBOARD_SHOTS=<dir> also saves the screenshots the owner reviews.

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
const SHOTS = process.env.SCOREBOARD_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
/** A clip the takeover's wipe opens fully within its first half second. */
const wipeOpen = (page, sel) => page.locator(sel).evaluate((el) => getComputedStyle(el).clipPath);

/** One stand-in Worker for every page of a test. */
function worker() {
  const store = new Map();
  const rings = [];
  let quiet = false;
  const core = new Scoreboard({
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); } },
    now: () => Date.now(),
    ring: (payload) => { if (!quiet) for (const fn of rings) fn(structuredClone(payload)); },
  });
  const routes = {
    'GET /v1/scoreboard': () => core.state(),
    'POST /v1/scoreboard/club': (b) => core.club(b),
    'POST /v1/scoreboard/point': (b) => core.point(b),
    'POST /v1/scoreboard/end': () => core.end(),
    'POST /v1/scoreboard/clock': (b) => core.clock(b),
    'POST /v1/scoreboard/setup': (b) => core.setup(b),
  };
  /** @param {import('@playwright/test').Page} page */
  const attach = async (page) => {
    await page.route(`${SYNC_BASE}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      const path = new URL(req.url()).pathname.replace('/api', '');
      const handler = routes[`${req.method()} ${path}`];
      if (!handler) return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{}' });
      const res = await handler(req.postData() ? JSON.parse(req.postData()) : {});
      return route.fulfill({ status: res.status, headers: CORS, contentType: 'application/json', body: await res.text() });
    });
  };
  /** Scores set without a ring (a game already under way), as many points per team. */
  const seed = async (club, points) => {
    quiet = true;
    for (const [team, n] of Object.entries(points)) for (let i = 0; i < n; i += 1) await core.point({ club, team, delta: 1 });
    quiet = false;
  };
  return { core, attach, seed, onRing: (fn) => rings.push(fn) };
}

/** The projector at 6:17:19 pm on a club night (T&T game time, 12:41 left). */
async function projector(browser, w) {
  const page = await (await browser.newContext({ deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  const send = await liveChannel(page);
  await w.attach(page);
  w.onRing((payload) => { send.all('changed', payload).catch(() => {}); });
  await page.goto('/countdown.html?now=2026-11-04T18:17:19');
  return page;
}

async function phone(browser, w) {
  const page = await (await browser.newContext({ deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  await page.route('**/shared/sync.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: SYNC_BASE }) }));
  await w.attach(page);
  await page.addInitScript(() => { localStorage.setItem('awanaSyncSession.v1', 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc'); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scoreboard.html');
  await expect(page.locator('#board')).toBeVisible();
  return page;
}

test.describe('the game time scoreboard', () => {
  test('a club on the phone takes the projector into scoring; points, the stopwatch and End reach the wall', async ({ browser }) => {
    test.setTimeout(90000);
    const w = worker();
    const wall = await projector(browser, w);
    await expect(wall.locator('[data-mode="game-time"]')).toBeVisible();
    await shot(wall, 'wall-1-game-time');

    const ph = await phone(browser, w);
    await expect(ph.locator('#teams')).toHaveAttribute('data-off', '1');
    await shot(ph, 'phone-1-pick');

    await ph.locator('.sb-club[data-club="tnt"]').click();
    await expect(ph.locator('.sb-club[data-club="tnt"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(wall.locator('[data-mode="scoring"]')).toBeVisible();
    await expect(wall.locator('.pj-score__team')).toHaveCount(4);
    await wall.waitForTimeout(1500);
    await shot(wall, 'wall-2-scoring');

    // A game well under way (the wall picks it up on its next read).
    await w.seed('tnt', { blue: 12, red: 9, yellow: 14, green: 7 });
    await wall.reload();
    await expect(wall.locator('[data-team="red"] .pj-score__num')).toHaveText('9');
    await expect(ph.locator('.sb-plus[data-team="red"] .sb-plus__num')).toHaveText('9', { timeout: 8000 });
    await wall.waitForTimeout(1200);
    await ph.locator('.sb-plus[data-team="red"]').click();
    await expect(ph.locator('.sb-plus[data-team="red"] .sb-plus__num')).toHaveText('10');
    await expect(wall.locator('.pj-take')).toBeVisible();
    await expect(wall.locator('.pj-take')).toContainText('RED +1!');
    await wall.waitForTimeout(650);
    expect(await wipeOpen(wall, '.pj-take')).toMatch(/circle\(150%|none/);
    await shot(wall, 'wall-3-takeover');
    await shot(ph, 'phone-2-tnt');
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 5000 });
    await expect(wall.locator('[data-team="red"] .pj-score__num')).toHaveText('10');
    await expect(wall.locator('[data-team="yellow"] .pj-score__lead')).toBeVisible();
    await shot(wall, 'wall-4-scores');

    // Two teams within a moment share one takeover.
    await ph.locator('.sb-plus[data-team="blue"]').click();
    await ph.locator('.sb-plus[data-team="green"]').click();
    await expect(wall.locator('.pj-take[data-teams="blue green"]')).toBeVisible();
    await wall.waitForTimeout(700);
    await shot(wall, 'wall-5-combined');
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 5000 });

    // The stopwatch, on the Worker's clock.
    await ph.locator('#clock-btn').click();
    await expect(ph.locator('#sheet')).toBeVisible();
    await ph.locator('#clock-go').click();
    await expect(wall.locator('.pj-score-clock')).toBeVisible();
    await expect(wall.locator('.pj-score')).toHaveAttribute('data-compact', '1');
    await ph.waitForTimeout(2300);
    await shot(ph, 'phone-3-stopwatch');
    await shot(wall, 'wall-6-stopwatch');
    const wallMain = await wall.locator('.pj-score-clock__main').textContent();
    expect(wallMain).toMatch(/^0:0[2-3]$/);

    // A timer.
    await ph.locator('.sb-seg__btn[data-kind="timer"]').click();
    await ph.locator('.sb-pick-btn[data-secs="60"]').click();
    await ph.locator('#clock-go').click();
    await expect(wall.locator('.pj-score-clock[data-kind="timer"]')).toBeVisible();
    await ph.waitForTimeout(1200);
    await shot(ph, 'phone-4-timer');
    await shot(wall, 'wall-7-timer');
    await ph.locator('#clock-reset').click();
    await expect(wall.locator('.pj-score-clock')).toHaveCount(0);
    await ph.locator('#sheet-close').click();

    // End takes two taps; the winner plays, then the schedule (T&T game time) is back.
    await ph.locator('#end-btn').click();
    await expect(ph.locator('#end-btn')).toHaveText('Tap again to end');
    await shot(ph, 'phone-5-end-armed');
    await ph.locator('#end-btn').click();
    await expect(wall.locator('.pj-finale')).toBeVisible();
    await expect(wall.locator('.pj-finale')).toContainText('YELLOW WINS!');
    await wall.waitForTimeout(1600);
    await shot(wall, 'wall-8-winner');
    await expect(wall.locator('[data-mode="game-time"]')).toBeVisible();
    await expect(wall.locator('.pj-finale')).toHaveCount(0, { timeout: 12000 });
    await wall.context().close();
    await ph.context().close();
  });

  test('switching clubs asks once more, then plays the old club\'s winner; Cubbies too; team setups', async ({ browser }) => {
    test.setTimeout(90000);
    const w = worker();
    const wall = await projector(browser, w);
    const ph = await phone(browser, w);
    await ph.locator('.sb-club[data-club="sparks"]').click();
    for (let i = 0; i < 3; i += 1) await ph.locator('.sb-plus[data-team="blue"]').click();
    for (let i = 0; i < 3; i += 1) await ph.locator('.sb-plus[data-team="green"]').click();
    await expect(ph.locator('.sb-plus[data-team="green"] .sb-plus__num')).toHaveText('3');
    await shot(ph, 'phone-6-sparks');
    await ph.locator('.sb-club[data-club="cubbies"]').click();
    await expect(ph.locator('.sb-club[data-club="cubbies"]')).toHaveText('Tap again');
    await ph.locator('.sb-club[data-club="cubbies"]').click();
    await expect(wall.locator('.pj-finale')).toContainText("IT'S A TIE!");
    await wall.waitForTimeout(1600);
    await shot(wall, 'wall-9-tie');
    await expect(wall.locator('[data-scoring="cubbies"]')).toBeVisible();
    await expect(ph.locator('.sb-club[data-club="cubbies"]')).toHaveAttribute('aria-pressed', 'true');
    await shot(ph, 'phone-7-cubbies');
    await expect(wall.locator('.pj-finale')).toHaveCount(0, { timeout: 12000 });
    await shot(wall, 'wall-10-cubbies');

    // Team setups (owner 2026-11-05): Options; no points yet = at once.
    await ph.locator('#opts-btn').click();
    await expect(ph.locator('#opts')).toBeVisible();
    await shot(ph, 'phone-8-options');
    await ph.locator('.sb-setup[data-setup="boys-girls"]').click();
    await expect(ph.locator('#opts')).toBeHidden();
    await expect(ph.locator('.sb-plus')).toHaveCount(2);
    await expect(wall.locator('.pj-score[data-count="2"] .pj-score__team')).toHaveCount(2);
    for (let i = 0; i < 4; i += 1) await ph.locator('.sb-plus[data-team="girls"]').click();
    for (let i = 0; i < 3; i += 1) await ph.locator('.sb-plus[data-team="boys"]').click();
    await expect(ph.locator('.sb-plus[data-team="boys"] .sb-plus__num')).toHaveText('3');
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 6000 });
    await expect(wall.locator('[data-team="girls"] .pj-score__num')).toHaveText('4');
    await wall.waitForTimeout(800);
    await shot(ph, 'phone-9-boys-girls');
    await shot(wall, 'wall-11-boys-girls');

    // With points the phone asks; Start at 0 plays GIRLS WINS first.
    await ph.locator('#opts-btn').click();
    await ph.locator('.sb-setup[data-setup="leaders-kids"]').click();
    await expect(ph.locator('#opts-ask')).toBeVisible();
    await shot(ph, 'phone-10-ask');
    await ph.locator('#opts-zero').click();
    await expect(wall.locator('.pj-finale')).toContainText('GIRLS WINS!');
    await expect(wall.locator('.pj-finale__chip')).toHaveCount(2);
    await expect(wall.locator('.pj-finale')).toHaveCount(0, { timeout: 12000 });
    await expect(wall.locator('[data-team="leaders"]')).toBeVisible();
    await ph.locator('.sb-plus[data-team="kids"]').click();
    await expect(wall.locator('.pj-take[data-teams="kids"]')).toBeVisible();
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 6000 });
    await wall.waitForTimeout(800);
    await shot(wall, 'wall-12-leaders-kids');
    await wall.context().close();
    await ph.context().close();
  });
});
