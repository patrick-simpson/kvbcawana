// The lesson intro (src/schedule/06-lesson-intro.js): four cards
// over the video while it buffers, only when the splash's Begin starts the
// lesson from the top (any time of day); held for the video at most holdMaxMs; never in
// the way of playback (errors, ⇄, skips). jsdom drives the logic with the
// timing shrunk through window.journeyIntroTiming (under reduced motion, so
// the cards just swap, unless a test asks for motion); real Chromium checks
// the reduced-motion cards never animate and the kiosk's do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const json = (rel) => JSON.parse(readFileSync(path.join(PUBLIC, rel), 'utf8'));
const CURRENT = json('current-lesson.json');
const ROUTES = {
  'current-lesson.json': { json: CURRENT },
  'lessons.json': { json: json('lessons.json') },
  'teaching-slides.json': { json: json('teaching-slides.json') },
  'current-lesson-video.mp4': { text: '' },
};
const ANSWERED = { 'journey.captions': 'off' };
const SHOW_TIME = new Date(2026, 9, 7, 18, 35, 0).getTime(); // inside 6:30-7:15
const NOON = new Date(2026, 9, 7, 12, 0, 0).getTime();
const TIMING = { cardsAt: [0, 40, 80, 120], minMs: 160, holdMaxMs: 400, pollMs: 20 };
const CARD_IDS = ['journey-intro-journey', 'journey-intro-advocates', 'journey-intro-lesson', 'journey-intro-lgt'];

const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Boots the kiosk at `now`, the video reporting `media.readyState` (0 until
   a test says otherwise), counting play() calls. The OS asks for reduced
   motion unless `motion` is set, so the timing tests see instant swaps. */
async function boot({ now = SHOW_TIME, motion = false, prefs = ANSWERED, timing = TIMING } = {}) {
  const media = { readyState: 0, plays: 0 };
  const k = bootKiosk(ROUTES, prefs, undefined, (window) => {
    pinClock(window, now);
    window.journeyIntroTiming = timing;
    window.matchMedia = (query) => ({
      matches: !motion && /prefers-reduced-motion:\s*reduce/.test(query),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    });
    window.HTMLMediaElement.prototype.play = function play() {
      media.plays += 1;
      return Promise.resolve();
    };
    Object.defineProperty(window.document.getElementById('journey-video'), 'readyState', {
      get: () => media.readyState,
      configurable: true,
    });
  });
  await ticks(8);
  return { k, media, $: (id) => k.document.getElementById(id) };
}

const shown = (el) => !el.classList.contains('hidden');
// The card a viewer sees: the last unhidden one (each is opaque, later on top).
const topCard = ($) => [...CARD_IDS].reverse().find((id) => shown($(id))) || null;

test('the 6:30 Begin runs the four cards in order over the buffering video, then plays it', async () => {
  const { k, media, $ } = await boot();
  try {
    assert.ok(shown($('journey-splash')), 'the show is waiting on the splash');
    $('journey-splash-play-btn').click();
    await ticks();
    assert.ok(shown($('journey-intro')), 'the intro is up at once');
    assert.equal(topCard($), 'journey-intro-journey');
    // The video is attached right away (buffering under the cards), shown,
    // but not playing, with no control bar or loading overlay over it.
    assert.ok(k.video.getAttribute('src'), 'the video is loading from the start');
    assert.equal(k.video.preload, 'auto');
    assert.ok(shown(k.video));
    assert.equal(media.plays, 0);
    assert.equal(shown($('video-controls')), false);
    assert.equal(shown($('journey-loading')), false);
    assert.equal(shown($('journey-chip')), false, 'no count chip over the intro');
    assert.equal(k.window.journeyChipWanted(), false);
    assert.equal(k.window.safeToReload(), false, 'a reload never cuts the intro');
    assert.equal(k.window.journeyLessonRunning(), true, 'Trek waits for it like a lesson');
    assert.equal($('journey-intro-title').textContent, 'Monotheism', "the lesson's own name");
    assert.match($('journey-intro-week').textContent, /^Week 6 · Unit 2 · Lesson 2$/);

    const order = [];
    media.readyState = 4; // it can play through by the time the cards are done
    for (let i = 0; i < 60 && shown($('journey-intro')); i += 1) {
      const top = topCard($);
      if (top && order[order.length - 1] !== top) order.push(top);
      await sleep(5);
    }
    assert.deepEqual(order, CARD_IDS, 'Journey, Advocates, the lesson, Large Group Time');
    await ticks();
    assert.equal(shown($('journey-intro')), false, 'the cards are gone');
    assert.equal(media.plays, 1, 'and the video started, once');
    assert.ok(shown($('video-controls')));
    assert.equal(shown($('journey-intro-wait')), false, 'it never had to hold');
    // Reduced motion: the cards just swap. No motion class, no band, no inline style.
    assert.equal(k.document.documentElement.classList.contains('motion-full'), false);
    assert.equal(k.document.querySelector('.jm-intro-sweep, .jm-intro-out'), null);
    for (const el of [$('journey-intro'), ...CARD_IDS.map($)]) assert.equal(el.getAttribute('style'), null);
  } finally {
    k.close();
  }
});

test('not ready at the end: the last card holds, says so, and goes the moment the video is', async () => {
  const { k, media, $ } = await boot();
  try {
    $('journey-splash-play-btn').click();
    await sleep(TIMING.minMs + 80);
    assert.ok(shown($('journey-intro')), 'still up past the cards');
    assert.equal(topCard($), 'journey-intro-lgt');
    assert.ok($('journey-intro').classList.contains('is-holding'));
    assert.ok(shown($('journey-intro-wait')), '"Getting the video ready"');
    assert.equal(media.plays, 0);
    media.readyState = 4;
    k.video.dispatchEvent(new k.window.Event('canplaythrough'));
    await ticks();
    assert.equal(shown($('journey-intro')), false);
    assert.equal(media.plays, 1);
    assert.equal(shown($('journey-loading')), false, 'ready: no loading flash');
  } finally {
    k.close();
  }
});

test('never ready: the hold is capped, then the video starts anyway with the loading overlay', async () => {
  const { k, media, $ } = await boot();
  try {
    $('journey-splash-play-btn').click();
    await sleep(TIMING.minMs + TIMING.holdMaxMs / 2);
    assert.ok(shown($('journey-intro')), 'held');
    assert.equal(media.plays, 0);
    await sleep(TIMING.holdMaxMs / 2 + 120);
    assert.equal(shown($('journey-intro')), false, 'the cap ends the hold');
    assert.equal(media.plays, 1, 'the video starts as it always has');
    assert.ok(shown($('journey-loading')), 'and says it is still loading');
  } finally {
    k.close();
  }
});

test('the default hold is capped at 15 seconds after a ~5 second sequence', async () => {
  const src = readFileSync(path.join(PUBLIC, 'src', 'schedule.js'), 'utf8');
  const block = src.slice(src.indexOf('const LESSON_INTRO = {'), src.indexOf('};', src.indexOf('const LESSON_INTRO = {')));
  assert.match(block, /holdMaxMs: 15000\b/);
  const minMs = Number(/minMs: (\d+)/.exec(block)[1]);
  assert.ok(minMs >= 4000 && minMs <= 5500, `cards last about five seconds (${minMs} ms)`);
});

test('the splash Begin from the top at any time (noon too), not a resume, not Start over', async () => {
  // Noon: ⇄ to the Journey view, Begin still gets the intro (owner 2026-10-12).
  const noon = await boot({ now: NOON });
  try {
    noon.$('toggle-btn').click();
    await ticks(8);
    noon.$('journey-splash-play-btn').click();
    await ticks(8);
    assert.equal(shown(noon.$('journey-intro')), true, 'the intro plays at noon too');
    assert.equal(noon.media.plays, 0, 'the video waits for the cards');
  } finally {
    noon.k.close();
  }
  // A resume mark for this week: Resume and Start over both skip the intro.
  const mark = JSON.stringify({ week: CURRENT.week, t: 120, d: 600, at: SHOW_TIME - 60000 });
  for (const button of ['journey-splash-resume-btn', 'journey-splash-startover-btn']) {
    const r = await boot({ prefs: { ...ANSWERED, 'journey.resume': mark } });
    try {
      assert.ok(shown(r.$(button)), `${button} is offered`);
      r.$(button).click();
      await ticks(8);
      assert.equal(shown(r.$('journey-intro')), false, `${button}: no intro`);
      assert.equal(r.media.plays, 1);
    } finally {
      r.k.close();
    }
  }
  // A video picked in Settings never gets it either.
  const pick = await boot();
  try {
    pick.k.window.startPreview('videos/week-06-student.mp4', 'Week 6', null, 6);
    await ticks();
    assert.equal(shown(pick.$('journey-intro')), false);
    assert.equal(pick.media.plays, 1);
  } finally {
    pick.k.close();
  }
});

test('Space skips to the video; ⇄ takes the screen; a video error plays as today', async () => {
  const skip = await boot({ timing: { ...TIMING, minMs: 5000 } });
  try {
    skip.$('journey-splash-play-btn').click();
    await ticks(8);
    skip.k.document.dispatchEvent(new skip.k.window.KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
    await ticks();
    assert.equal(shown(skip.$('journey-intro')), false, 'Space: straight to the video');
    assert.equal(skip.media.plays, 1);
    assert.equal(shown(skip.$('slides-view')), false, 'never on to the slides');
  } finally {
    skip.k.close();
  }

  const away = await boot({ timing: { ...TIMING, minMs: 5000 } });
  try {
    away.$('journey-splash-play-btn').click();
    await ticks(8);
    away.$('toggle-btn').click();
    await ticks();
    assert.equal(shown(away.$('journey-intro')), false, '⇄ ends it');
    await sleep(60);
    assert.equal(away.media.plays, 0, 'and nothing starts behind the Check-in Display');
    assert.equal(away.k.window.lessonIntroActive(), false);
  } finally {
    away.k.close();
  }

  const broken = await boot({ timing: { ...TIMING, minMs: 5000 } });
  try {
    broken.$('journey-splash-play-btn').click();
    await ticks(8);
    broken.k.video.dispatchEvent(new broken.k.window.Event('error'));
    await ticks();
    assert.equal(shown(broken.$('journey-intro')), false, 'an error drops the intro at once');
    assert.ok(shown(broken.$('slides-view')), "and the video's own error handling runs (this week's slides)");
  } finally {
    broken.k.close();
  }
});

test('with motion: the last card rides off on the band, then the video starts', async () => {
  const { k, media, $ } = await boot({ motion: true });
  try {
    assert.ok(k.document.documentElement.classList.contains('motion-full'));
    media.readyState = 4;
    $('journey-splash-play-btn').click();
    await sleep(TIMING.minMs + 60);
    const sweep = k.document.querySelector('#journey-view > .jm-intro-sweep');
    assert.ok(sweep, 'the band is on its way');
    assert.ok($('journey-intro').classList.contains('jm-intro-out'), 'carrying the card');
    assert.equal(media.plays, 0, 'never over a playing video: it starts once the band has passed');
    sweep.querySelector('.jm-carry-band').dispatchEvent(new k.window.Event('animationend'));
    await ticks();
    assert.equal(shown($('journey-intro')), false);
    assert.equal(k.document.querySelector('.jm-intro-sweep'), null);
    assert.equal(media.plays, 1);
  } finally {
    k.close();
  }
});

/* ── Real Chromium: reduced-motion cards never animate; the kiosk's do ─── */
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };

async function introAnimations(browser, reducedMotion) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, reducedMotion });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const RealDate = Date;
    const offset = new RealDate(2026, 9, 7, 18, 35, 0).getTime() - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...a) {
        if (a.length) super(...a);
        else super(RealDate.now() + offset);
      }
      static now() {
        return RealDate.now() + offset;
      }
    };
    localStorage.setItem('journey.captions', 'off');
    window.journeyIntroTiming = { cardsAt: [0, 250, 500, 750], minMs: 60000 };
  });
  // The video never answers: the cards hold, nothing errors.
  await page.route('**/*.mp4', () => {});
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (/\.mp4$/.test(url.pathname)) return route.fallback();
    if (url.host !== 'journey.test') return route.abort();
    if (url.pathname.startsWith('/lobby/')) return route.fulfill({ body: '<body>', contentType: 'text/html' });
    const file = path.join(PUBLIC, decodeURIComponent(url.pathname).replace(/^\/+/, ''));
    if (!existsSync(file)) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://journey.test/index.html');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !document.getElementById('journey-splash').classList.contains('hidden'));
  const run = await page.evaluate(async () => {
    const names = new Set();
    const tops = [];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('journey-splash-play-btn').click();
    for (let i = 0; i < 24; i += 1) {
      await wait(50);
      const intro = document.getElementById('journey-intro');
      intro.getAnimations({ subtree: true }).forEach((a) => names.add(a.animationName || 'waapi'));
      const top = [...intro.querySelectorAll('.journey-intro-card:not(.hidden)')].pop();
      if (top && tops[tops.length - 1] !== top.id) tops.push(top.id);
    }
    return { names: [...names].sort(), tops };
  });
  await context.close();
  return run;
}

test('in Chromium: the reduced-motion intro is instant swaps (no animation at all); the kiosk animates it', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const still = await introAnimations(browser, 'reduce');
    assert.deepEqual(still.tops, CARD_IDS, 'the same four cards, in order');
    assert.deepEqual(still.names, [], 'nothing on the reduced-motion intro animates');
    const full = await introAnimations(browser, 'no-preference');
    assert.deepEqual(full.tops, CARD_IDS);
    for (const name of ['jm-intro-wipe', 'jm-slam-hard']) assert.ok(full.names.includes(name), `${name} (ran: ${full.names})`);
  } finally {
    await browser.close();
  }
});
