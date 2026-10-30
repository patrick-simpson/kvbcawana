import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { liveChannel } from './liveChannel.js';

// The Awana Grand Prix promo (src/components/promos/GrandPrixPromo.jsx), in a
// real browser playing the committed video (public/promos/grand-prix.mp4) on
// the real clock, through the deck: a copy slide on the sky, the promo, the
// next copy slide. It comes in with NO stinger (an ordinary change: the words
// lift away, the scene comes to rest, then the video appears over the
// identical picture and takes the tab and waves over; the scene's loops came
// to rest during the last slide, so that is about as soon as its words go), the tab and waves come
// home under its closing plate, and it leaves with no stinger. Both seams are
// MEASURED: Chrome's own frames (CDP screencast, lossless PNG, 1920x1080)
// just before the video shows vs once it is fully in (entrance), and its last
// frame vs the first frame after it is gone (exit). The date is moved into its
// window for this page only, to a Wednesday evening (2027-01-06, 7:00 pm) when
// the flagship is off the air, so the deck is [promo slot, ALPHA, BRAVO]; the
// snow slide takes the slot's first lap, so the promo is the second pass's,
// after BRAVO. In the events project: long and timing-sensitive.

const FEED = {
  version: 1,
  generatedAt: '2027-01-06T15:00:00.000Z',
  sourceUrl: 'https://example.invalid/calendar/index',
  events: ['2027-01-06', '2027-01-13', '2027-01-20'].map((date) => ({ date, kind: 'club', title: 'Awana', isCancelled: false, isSpecial: false })),
};

const CONFIG = {
  backgroundSource: 'manual',
  calendarEnabled: true,
  calendarShowWelcome: false,
  calendarShowNextWeek: false,
  calendarShowRemaining: false,
  seasonPromos: true,
  manualSlides: [
    { id: 's_a', eyebrow: '', text: 'SLIDE ALPHA', theme: 'sky', durationSec: 3 },
    { id: 's_b', eyebrow: '', text: 'SLIDE BRAVO', theme: 'sky', durationSec: 3 },
  ],
  showClock: false,
  showTally: false,
  showWeatherChip: false,
  particleEffect: 'off',
  confettiLevel: 'off',
  firstArrivalMoment: false,
};

/** GRAND_PRIX.fade and .openPlate (GrandPrixPromo.jsx), in ms. */
const FADE_MS = 150;
const OPEN_PLATE_MS = 1000;

async function boot(page) {
  await liveChannel(page);
  await page.route(/open-meteo/, (r) => r.abort());
  await page.route('**/calendar-feed.json', (r) => r.fulfill({ body: JSON.stringify(FEED), contentType: 'application/json' }));
  await page.addInitScript((c) => {
    // Only Date moves: timers, animation frames and the video keep the real clock.
    const offset = new Date('2027-01-06T19:00:00-05:00').getTime() - Date.now();
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + offset); }
      static now() { return Real.now() + offset; }
    }
    window.Date = Shifted;
    localStorage.setItem('awanaConfig.v1', JSON.stringify(c));
    localStorage.setItem('awanaSetupCardDismissed.v1', '1');
  }, CONFIG);
  await page.goto('/index.html');
}

const video = (page) => page.locator('video.grand-prix-promo__video');
const chrome = (page) => page.locator('.lobby-chrome');
const words = (page, text) => page.locator('.manual-slide-text', { hasText: text });

// The lobby plate the video opens and ends on (video/grand-prix/concepts/), as rendered.
const PLATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../video/grand-prix/concepts/lobby-plate-sky.png');

/** Mean absolute difference per channel (0..255) of two PNG frames, outside `mask`. */
function meanDiff(a, b, mask = null) {
  const pa = PNG.sync.read(Buffer.from(a, 'base64'));
  const pb = PNG.sync.read(Buffer.from(b, 'base64'));
  expect([pa.width, pa.height]).toEqual([pb.width, pb.height]);
  let sum = 0;
  let n = 0;
  for (let y = 0; y < pa.height; y += 1) {
    for (let x = 0; x < pa.width; x += 1) {
      if (mask && x >= mask.x0 && x < mask.x1 && y >= mask.y0 && y < mask.y1) continue;
      const i = (y * pa.width + x) * 4;
      sum += Math.abs(pa.data[i] - pb.data[i]) + Math.abs(pa.data[i + 1] - pb.data[i + 1]) + Math.abs(pa.data[i + 2] - pb.data[i + 2]);
      n += 3;
    }
  }
  return { mean: sum / n, size: [pa.width, pa.height] };
}

test('the Grand Prix comes in over the lobby and hands back to it with no stinger, and both seams measure as one picture', async ({ page }) => {
  test.setTimeout(180_000);
  // Chrome's own frames, as the room sees them, timed by the compositor's clock.
  const frames = [];
  const marks = {};
  await page.exposeBinding('__gpMark', (_src, name, at, extra) => { if (!(name in marks)) marks[name] = { at, extra }; });
  await boot(page);
  await expect(words(page, 'SLIDE BRAVO').last()).toBeVisible({ timeout: 100_000 });
  // What the room sees from here on, and when each piece moves.
  await page.evaluate(() => {
    const now = () => performance.timeOrigin + performance.now();
    window.__wave = document.querySelector('.slide-stinger');
    const seen = new Set();
    const mark = (name, extra) => { if (!seen.has(name)) { seen.add(name); window.__gpMark(name, now(), extra ?? null); } };
    const look = () => {
      const v = document.querySelector('video.grand-prix-promo__video');
      if (v) {
        mark('mounted');
        if (!v.__gp) {
          v.__gp = true;
          v.addEventListener('ended', () => mark('ended'));
        }
        if (v.classList.contains('is-shown')) mark('shown');
        // The last slide's words have all left (the lobby's plain plate is up).
        if (!document.querySelector('.manual-slide-copy .manual-slide')) mark('wordsGone');
      }
      const c = document.querySelector('.lobby-chrome');
      if (seen.has('shown') && c?.classList.contains('lobby-chrome--handed-over')) mark('handedOver');
      if (seen.has('handedOver') && !c?.classList.contains('lobby-chrome--handed-over')) mark('home');
      if (seen.has('ended') && !document.querySelector('.grand-prix-promo')) {
        // Where the next slide's words stand (they land while the video fades away).
        const pieces = document.querySelectorAll('.manual-slide-copy :is(.lobby-kicker, .lobby-headline, .lobby-sub, .lobby-chip, .lobby-word)');
        const boxes = [...pieces].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
        const box = boxes.length ? {
          x0: Math.floor(Math.min(...boxes.map((r) => r.left))) - 24,
          y0: Math.floor(Math.min(...boxes.map((r) => r.top))) - 24,
          x1: Math.ceil(Math.max(...boxes.map((r) => r.right))) + 24,
          y1: Math.ceil(Math.max(...boxes.map((r) => r.bottom))) + 24,
        } : null;
        mark('gone', box);
      }
    };
    new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  });
  const cdp = await page.context().newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ at: metadata.timestamp * 1000, data });
    // Only the newest frames and those around the two seams are kept (1080p PNGs are big).
    const near = (t) => [marks.shown, marks.ended, marks.gone].some((m) => m && Math.abs(t - m.at) < 4000);
    for (let i = frames.length - 31; i >= 0; i -= 1) if (!near(frames[i].at)) frames.splice(i, 1);
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

  // In: an ordinary change, no stinger; the chrome stays home; the video waits unseen.
  await expect(video(page)).toBeAttached({ timeout: 20_000 });
  await expect(page.locator('.grand-prix-promo--enter')).toHaveCount(1);
  await expect(page.locator('.catalog-scene')).toHaveClass(/catalog-scene--sky/);
  await expect(chrome(page)).toHaveClass(/lobby-chrome--home/);
  await expect(chrome(page)).not.toHaveClass(/lobby-chrome--away/);
  // Once the scene is at rest it appears, takes the tab and waves over, and plays.
  await expect(video(page)).toHaveClass(/is-shown/, { timeout: 8_000 });
  await expect(chrome(page)).toHaveClass(/lobby-chrome--handed-over/, { timeout: 2_000 });
  await expect.poll(() => video(page).evaluate((v) => !v.paused && v.currentTime > 0 && v.muted), { timeout: 5_000 }).toBe(true);
  expect(await page.evaluate(() => document.querySelector('.slide-stinger') === window.__wave)).toBe(true);
  // The scene under it was at rest when it appeared: every ambient loop stopped.
  expect(await page.evaluate(() => [...document.querySelectorAll('.catalog-scene .lobby-ambient')]
    .flatMap((el) => el.getAnimations()).filter((a) => a.playState === 'running').length)).toBe(0);
  expect(marks.handedOver.at - marks.shown.at).toBeLessThan(OPEN_PLATE_MS);
  await page.waitForTimeout(1500);

  // Into its closing seconds (skipped ahead to save time): the tab and waves come home over the plate.
  await video(page).evaluate((v) => { v.currentTime = Math.max(0, v.duration - 2.6); });
  await expect(chrome(page)).not.toHaveClass(/lobby-chrome--handed-over/, { timeout: 5_000 });
  // It ends, goes, and the next slide lands: no stinger swept the screen.
  await expect(words(page, 'SLIDE ALPHA').last()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.grand-prix-promo')).toHaveCount(0, { timeout: 5_000 });
  expect(await page.evaluate(() => document.querySelector('.slide-stinger') === window.__wave)).toBe(true);
  await expect(chrome(page)).toHaveClass(/lobby-chrome--home/);
  await expect(page.locator('.catalog-scene')).toHaveClass(/catalog-scene--sky/);
  await page.waitForTimeout(400);
  await cdp.send('Page.stopScreencast');

  // The seams.
  const before = (t) => frames.filter((f) => f.at < t).at(-1);
  const after = (t) => frames.find((f) => f.at > t);
  const inBefore = before(marks.shown.at);
  const inAfter = after(marks.shown.at + FADE_MS * 2 + 50);
  expect(inBefore, 'a frame before the video showed').toBeTruthy();
  expect(inAfter, 'a frame once it was fully in').toBeTruthy();
  const entrance = meanDiff(inBefore.data, inAfter.data);
  const outBefore = before(marks.ended.at);
  const outAfter = after(marks.gone.at + 20);
  expect(outBefore && outAfter, 'frames either side of the exit').toBeTruthy();
  const exit = meanDiff(outBefore.data, outAfter.data, marks.gone.extra);
  const emptyPlate = Math.max(0, marks.shown.at - marks.wordsGone.at);
  // And the lobby as it stood just before the video showed vs the plate the
  // video is drawn from: what the entrance seam is once a cut opens on it.
  const plate = existsSync(PLATE) ? meanDiff(inBefore.data, readFileSync(PLATE).toString('base64')) : null;
  const report = `entrance ${entrance.mean.toFixed(2)}/255 (frames ${Math.round(inAfter.at - inBefore.at)} ms apart), `
    + `exit ${exit.mean.toFixed(2)}/255 outside the next words (${Math.round(outAfter.at - outBefore.at)} ms apart), `
    + `empty plate ${Math.round(emptyPlate)} ms (last words gone to the video showing; ${Math.round(marks.shown.at - marks.mounted.at)} ms from the slide change), `
    + `lobby before the video vs lobby-plate-sky.png ${plate ? `${plate.mean.toFixed(2)}/255` : 'n/a'}, ${entrance.size.join('x')}`;
  // GP_SEAM_DIR=<folder> keeps the four frames, to look at.
  if (process.env.GP_SEAM_DIR) {
    mkdirSync(process.env.GP_SEAM_DIR, { recursive: true });
    for (const [name, f] of Object.entries({ inBefore, inAfter, outBefore, outAfter })) {
      writeFileSync(join(process.env.GP_SEAM_DIR, `${name}.png`), Buffer.from(f.data, 'base64'));
    }
  }
  test.info().annotations.push({ type: 'seams', description: report });
  console.log(`Grand Prix seams: ${report}`);
  expect(entrance.size).toEqual([1920, 1080]);
  // The exit has been one picture since the first cut; the entrance is once
  // the cut that opens on the plate is in (GP_ENTRANCE_SEAM=1 asks for it).
  expect(exit.mean).toBeLessThan(2);
  // The scene came to rest under the last slide's words: the video shows
  // about as soon as they have gone (aim ~0.5 s), not after a 3 s settle.
  expect(emptyPlate).toBeLessThan(1000);
  if (process.env.GP_ENTRANCE_SEAM === '1') expect(entrance.mean).toBeLessThan(2);
});
