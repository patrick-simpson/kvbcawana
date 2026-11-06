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
    'POST /v1/scoreboard/sounds': (b) => core.sounds(b),
  };
  /** @param {import('@playwright/test').Page} page */
  const attach = async (page) => {
    await page.route(`${SYNC_BASE}/**`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      // No signal at all (Chrome's offline switch does not reach routed requests).
      if (api.down) return route.abort('internetdisconnected');
      const path = new URL(req.url()).pathname.replace('/api', '');
      const handler = routes[`${req.method()} ${path}`];
      if (!handler) return route.fulfill({ status: 503, headers: CORS, contentType: 'application/json', body: '{}' });
      const res = await handler(req.postData() ? JSON.parse(req.postData()) : {});
      // The Worker did it, but the phone never hears back (the gym's Wi-Fi).
      if (path === '/v1/scoreboard/point' && api.loseAnswers > 0) { api.loseAnswers -= 1; return route.abort('connectionreset'); }
      return route.fulfill({ status: res.status, headers: CORS, contentType: 'application/json', body: await res.text() });
    });
  };
  /** Scores set without a ring (a game already under way), as many points per team. */
  const seed = async (club, points) => {
    quiet = true;
    for (const [team, n] of Object.entries(points)) for (let i = 0; i < n; i += 1) await core.point({ club, team, delta: 1 });
    quiet = false;
  };
  const api = { core, attach, seed, onRing: (fn) => rings.push(fn), loseAnswers: 0, down: false };
  return api;
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

/**
 * A lobby TV on the same Worker, Date moved to 6:17:19 pm on a club night
 * (only Date: timers and animation frames keep the real clock).
 */
async function lobby(browser, w) {
  const page = await (await browser.newContext({ deviceScaleFactor: SHOTS ? 2 : 1 })).newPage();
  await page.setViewportSize({ width: 1600, height: 900 });
  const send = await liveChannel(page);
  await w.attach(page);
  w.onRing((payload) => { send.all('changed', payload).catch(() => {}); });
  await page.route(/open-meteo/, (r) => r.abort());
  await page.addInitScript(() => {
    const offset = new Date('2026-11-04T18:17:19-05:00').getTime() - Date.now();
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
      static now() { return Real.now() + offset; }
    }
    window.Date = Shifted;
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
  });
  await page.goto('/index.html');
  return { page, send };
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

    // The sound switch (owner 2026-11-05): the speaker beside End game.
    // Owner 2026-11-05: "That setting should be under more": the More sheet.
    await ph.locator('#opts-btn').click();
    await expect(ph.locator('#sound-btn')).toHaveAttribute('aria-checked', 'false');
    await ph.locator('#sound-btn').click();
    await expect(ph.locator('#sound-btn')).toHaveAttribute('aria-checked', 'true');
    await expect(ph.locator('#sound-word')).toHaveText(/^On:/);
    expect((await w.core.state().then((r) => r.json())).board.sounds).toBe(true);
    await shot(ph, 'phone-11-sound-on');
    await ph.locator('#opts-close').click();

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

    // The More sheet opens before any club too (the sound switch), the setups waiting for one.
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

  test('the lobby\'s score bar: up with the club, a point, a name in between, the stopwatch, the final', async ({ browser }) => {
    test.setTimeout(90000);
    const w = worker();
    const { page: tv, send } = await lobby(browser, w);
    const ph = await phone(browser, w);
    await expect(tv.locator('.score-ticker')).toHaveCount(0);
    await ph.locator('.sb-club[data-club="tnt"]').click();
    await expect(tv.locator('.score-ticker')).toBeVisible();
    await expect(tv.locator('.score-ticker__team')).toHaveCount(4);
    await expect(tv.locator('.score-ticker__clock')).toContainText('GAME ENDS 6:30', { ignoreCase: true });
    await expect(tv.locator('.corner-bottom .corner-chip')).toHaveCount(0);

    await w.seed('tnt', { blue: 12, red: 9, yellow: 14, green: 7 });
    await tv.reload();
    await expect(tv.locator('[data-team="red"] .score-ticker__num')).toHaveText('9');
    await expect(ph.locator('.sb-plus[data-team="red"] .sb-plus__num')).toHaveText('9', { timeout: 8000 });
    await tv.waitForTimeout(1500);
    await shot(tv, 'lobby-1-bar');
    await ph.locator('.sb-plus[data-team="red"]').click();
    await expect(tv.locator('[data-team="red"] .score-ticker__plus')).toBeVisible();
    await tv.waitForTimeout(300);
    await shot(tv, 'lobby-2-point');
    await expect(tv.locator('[data-team="red"] .score-ticker__num')).toHaveText('10');

    // A name: the bar drops away for the welcome and rises after it.
    await send('checkin', { id: 'e2e-ava', firstName: 'Ava', club: 'Sparks', at: new Date().toISOString() });
    await expect(tv.locator('.score-ticker')).toHaveCount(0, { timeout: 5000 });
    await tv.waitForTimeout(1500);
    await shot(tv, 'lobby-3-checkin');
    await ph.locator('.sb-plus[data-team="green"]').click();
    await expect(tv.locator('.score-ticker')).toBeVisible({ timeout: 20000 });
    await expect(tv.locator('[data-team="green"] .score-ticker__num')).toHaveText('8');
    await expect(tv.locator('.score-ticker__plus')).toHaveCount(0);

    // The stopwatch takes the clock slot.
    await ph.locator('#clock-btn').click();
    await ph.locator('#clock-go').click();
    await expect(tv.locator('.score-ticker__clock[data-kind="stopwatch"]')).toBeVisible();
    await tv.waitForTimeout(2300);
    expect(await tv.locator('.score-ticker__clock-value').textContent()).toMatch(/^0:0[2-3]\.\d$/);
    await shot(tv, 'lobby-4-stopwatch');
    await ph.locator('#clock-reset').click();
    await ph.locator('#sheet-close').click();

    // End: the final, the winner named, then the bar goes.
    await ph.locator('#end-btn').click();
    await ph.locator('#end-btn').click();
    await expect(tv.locator('.score-ticker[data-final="1"]')).toBeVisible();
    await expect(tv.locator('.score-ticker__clock')).toContainText('YELLOW');
    await tv.waitForTimeout(800);
    await shot(tv, 'lobby-5-final');
    await expect(tv.locator('.score-ticker')).toHaveCount(0, { timeout: 12000 });
    await tv.context().close();
    await ph.context().close();
  });

  test('taps made while the Wi-Fi is down wait on the phone and all arrive, each once (owner 2026-11-06)', async ({ browser }) => {
    test.setTimeout(60000);
    const w = worker();
    const wall = await projector(browser, w);
    const ph = await phone(browser, w);
    await ph.locator('.sb-club[data-club="sparks"]').click();
    await expect(wall.locator('[data-scoring="sparks"]')).toBeVisible();

    // No signal: the taps show at once and wait.
    w.down = true;
    for (let i = 0; i < 3; i += 1) await ph.locator('.sb-plus[data-team="red"]').click();
    await expect(ph.locator('.sb-plus[data-team="red"] .sb-plus__num')).toHaveText('3');
    await expect(ph.locator('#live')).toHaveText(/3 taps waiting to send/, { timeout: 5000 });
    expect((await w.core.state().then((r) => r.json())).board.scores.sparks.red).toBe(0);
    await shot(ph, 'phone-12-waiting');

    // Back online: all three arrive, in order, and the line says Live again.
    w.down = false;
    await expect.poll(async () => (await w.core.state().then((r) => r.json())).board.scores.sparks.red, { timeout: 15000 }).toBe(3);
    await expect(ph.locator('#live')).not.toHaveText(/waiting/, { timeout: 10000 });
    await expect(wall.locator('[data-team="red"] .pj-score__num')).toHaveText('3');

    // The Worker counted a tap but its answer was lost: sent again, counted once.
    w.loseAnswers = 1;
    await ph.locator('.sb-plus[data-team="green"]').click();
    await expect.poll(async () => (await w.core.state().then((r) => r.json())).board.scores.sparks.green, { timeout: 15000 }).toBe(1);
    await expect(ph.locator('#live')).not.toHaveText(/waiting/, { timeout: 10000 });
    await ph.waitForTimeout(3500);   // a read or two later, still exactly one
    expect((await w.core.state().then((r) => r.json())).board.scores.sparks.green).toBe(1);
    await expect(ph.locator('.sb-plus[data-team="green"] .sb-plus__num')).toHaveText('1');

    // Green catches red (3-3), then passes it: TAKES THE LEAD! on the wall.
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 6000 });
    await ph.locator('.sb-plus[data-team="green"]').click();
    await ph.locator('.sb-plus[data-team="green"]').click();
    await expect.poll(async () => (await w.core.state().then((r) => r.json())).board.scores.sparks.green, { timeout: 8000 }).toBe(3);
    await expect(wall.locator('.pj-take')).toHaveCount(0, { timeout: 6000 });
    await ph.locator('.sb-plus[data-team="green"]').click();
    await expect(wall.locator('.pj-take[data-lead="green"]')).toBeVisible();
    await expect(wall.locator('.pj-take__lead')).toHaveText(/takes the lead/i);
    await wall.waitForTimeout(1300);
    await shot(wall, 'wall-13-lead');
    await wall.context().close();
    await ph.context().close();
  });
});
