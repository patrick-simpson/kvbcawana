import { expect } from '@playwright/test';

// The stand-in Journey host for the embedded e2e specs (embedded.spec.js,
// embedded.events.spec.js): a page that shows the signage full-screen in an
// iframe the way Journey-Display's public/index.html does, with Journey's two
// corner buttons drawn where Journey draws them, and the measurements the
// specs make against them. A plain module, not a spec: Playwright refuses a
// spec that imports another.

/**
 * Journey's corner buttons while the Check-in Display shows (Journey-Display
 * public/src/style.css: #toggle-btn, and #settings-btn stacked above it by
 * `#checkin-view:not(.hidden) ~ #settings-btn`): one column of two 48px
 * buttons, max(3vw, 24px) in from the right edge, the toggle max(3vh, 24px)
 * up from the bottom and the gear 8px above it. Written out from Journey's
 * CSS here rather than imported from src/lib/embed.js, so a drift in the
 * app's own copy of the geometry fails these tests.
 */
export function hostSquares(vw, vh) {
  const right = Math.max(0.03 * vw, 24);
  const edge = Math.max(0.03 * vh, 24);
  const x = { left: vw - right - 48, right: vw - right };
  const toggle = { ...x, top: vh - edge - 48, bottom: vh - edge };
  return { toggle, gear: { ...x, top: toggle.top - 8 - 48, bottom: toggle.top - 8 } };
}

/** A stand-in for the Journey page: the iframe, and its two buttons drawn where Journey draws them. */
export const hostPage = (src) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
  iframe { position: fixed; inset: 0; width: 100vw; height: 100vh; border: none; }
  .host { position: fixed; right: max(3vw, 24px); width: 48px; height: 48px; border: none; border-radius: 999px; background: rgba(3, 4, 4, 0.5); z-index: 10; }
  .host--toggle { bottom: max(3vh, 24px); }
  .host--gear { bottom: calc(max(3vh, 24px) + 48px + 8px); }
</style></head><body><iframe src="${src}" title="Awana Check-in Display"></iframe>
<button class="host host--toggle" aria-label="Switch display"></button><button class="host host--gear" aria-label="Video settings"></button></body></html>`;

/** Boot the signage inside the stand-in host (the first-run card dismissed unless `setupCard`). Returns the signage's frame. */
export async function embed(page, { config = {}, weather = null, tally = 0, query = '?lowPower=1', setupCard = false } = {}) {
  await page.route(/pusher|twotimtwo|sockjs/, (route) => route.abort());
  await page.route(/open-meteo/, (route) => (weather == null ? route.abort() : route.fulfill({
    body: JSON.stringify({ current: { temperature_2m: 56, apparent_temperature: 54, weather_code: weather, is_day: 1 } }),
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
  })));
  await page.route('**/journey-host.html', (route) => route.fulfill({ contentType: 'text/html', body: hostPage(`/index.html${query}`) }));
  await page.addInitScript(({ cfg, count, card }) => {
    if (!location.pathname.endsWith('/index.html')) return;
    if (!card) localStorage.setItem('awanaSetupCardDismissed.v1', '1');
    localStorage.setItem('awanaConfig.v1', JSON.stringify(cfg));
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    if (count) localStorage.setItem('awanaTally.v1', JSON.stringify({ date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count }));
  }, { cfg: { pusherAppKey: 'e2e-key', pusherCluster: 'us2', ...config }, count: tally, card: setupCard });
  await page.goto('/journey-host.html');
  const frame = await (await page.waitForSelector('iframe')).contentFrame();
  await expect(frame.locator('.stage')).toBeVisible();
  await frame.evaluate(() => document.fonts.ready);
  return frame;
}

/** Each matching element's box, in the page's px (the frame fills the viewport from 0,0). */
export const boxes = (frame, selector) => frame.locator(selector).evaluateAll((els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, what: String(e.className).slice(0, 60) };
}));

export const hits = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Nothing in `list` is under either of the host's buttons, and all of it is on the screen. */
export function expectClear(list, { width, height }) {
  const { gear, toggle } = hostSquares(width, height);
  expect(list.length).toBeGreaterThan(0);
  for (const box of list) {
    expect(hits(box, gear), `${box.what} under the host's gear`).toBe(false);
    expect(hits(box, toggle), `${box.what} under the host's toggle`).toBe(false);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(width);
    expect(box.bottom).toBeLessThanOrEqual(height);
  }
}
