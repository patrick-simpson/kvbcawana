// The full profile's motion (24-motion.js + style.css's motion block), and
// the Pi's lack of it. jsdom checks who gets html.motion-full and the two
// JS-driven pieces (the view-flip stinger, the slide sweep); real Chromium
// checks what the stylesheet then does: a low page runs no animation but
// the splash's pulse, a full page runs the kit-timed entrances, reduced
// motion runs none of them even if the class were there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKiosk, tick, PI_ZERO, DESKTOP } from './kiosk-dom.mjs';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const json = (rel) => JSON.parse(readFileSync(path.join(PUBLIC, rel), 'utf8'));
const ROUTES = {
  'current-lesson.json': { json: json('current-lesson.json') },
  'lessons.json': { json: json('lessons.json') },
  'teaching-slides.json': { json: json('teaching-slides.json') },
};
const ANSWERED = { 'journey.captions': 'off' };
const ticks = async (n = 4) => {
  for (let i = 0; i < n; i += 1) await tick();
};
const reduce = (matches) => (window) => {
  window.matchMedia = (query) => ({
    matches: matches && /prefers-reduced-motion:\s*reduce/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
};
const hasMotion = (k) => k.document.documentElement.classList.contains('motion-full');
const stinger = (k) => k.document.querySelector('.jm-stinger');

test('the Pi never gets the motion: no class, no stinger, no sweep, no inline style', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, PI_ZERO);
  try {
    await ticks();
    assert.equal(hasMotion(k), false);
    k.document.getElementById('toggle-btn').click();
    await ticks();
    assert.equal(k.document.getElementById('journey-view').classList.contains('hidden'), false);
    assert.equal(stinger(k), null);
    k.window.startSlidesPreview(6);
    k.window.nextSlide();
    await ticks();
    assert.equal(k.document.querySelector('.jm-slide-sweep'), null);
    assert.doesNotMatch(k.document.documentElement.getAttribute('style') || '', /--jm-/);
    assert.doesNotMatch(k.document.documentElement.className, /motion/);
  } finally {
    k.close();
  }
});

test('a desktop gets the motion; the view has flipped before the stinger is even built', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, DESKTOP, reduce(false));
  try {
    await ticks();
    assert.equal(hasMotion(k), true);
    assert.equal(stinger(k), null, 'nothing plays for the view the page opened on');
    k.document.getElementById('toggle-btn').click();
    // Synchronously after the click: the Journey view is already up.
    assert.equal(k.document.getElementById('journey-view').classList.contains('hidden'), false);
    await ticks(1);
    const s = stinger(k);
    assert.ok(s, 'the flip stinger plays over the new view');
    assert.equal(s.getAttribute('aria-hidden'), 'true');
    assert.equal(s.querySelectorAll('.jm-stinger-bar').length, 4);
    assert.ok(s.querySelector('.jm-stinger-word img'), 'into Journey: the Journey wordmark');
    k.document.getElementById('toggle-btn').click();
    await ticks(1);
    assert.match(stinger(k).textContent, /Check-in/, 'and back: the Check-in name, one stinger at a time');
    assert.equal(k.document.querySelectorAll('.jm-stinger').length, 1);
    // A video that starts playing takes it down at once.
    k.video.dispatchEvent(new k.window.Event('playing'));
    assert.equal(stinger(k), null);
  } finally {
    k.close();
  }
});

test('desktop slides: each step sends a sweep over the stage, a step back sweeps the other way', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, DESKTOP, reduce(false));
  try {
    await ticks();
    k.window.startSlidesPreview(6);
    await ticks(1);
    // The flip into the slides has its own stinger (covering slide 1); let it end.
    const bars = k.document.querySelectorAll('.jm-stinger .jm-stinger-bar');
    assert.equal(bars.length, 4);
    bars[0].dispatchEvent(new k.window.Event('animationend'));
    assert.equal(stinger(k), null);
    k.window.nextSlide();
    await ticks(1);
    const sweep = k.document.querySelector('#slides-view > .jm-slide-sweep');
    assert.ok(sweep);
    assert.equal(sweep.classList.contains('is-back'), false);
    k.window.prevSlide();
    await ticks(1);
    assert.equal(k.document.querySelectorAll('.jm-slide-sweep').length, 1, 'one sweep at a time');
    assert.equal(k.document.querySelector('.jm-slide-sweep').classList.contains('is-back'), true);
  } finally {
    k.close();
  }
});

test('reduced motion, configure mode and the Low power choice all switch it off; Full switches it on', async () => {
  const reduced = bootKiosk(ROUTES, ANSWERED, DESKTOP, reduce(true));
  try {
    await ticks();
    assert.equal(hasMotion(reduced), false, 'the OS asked for reduced motion');
    reduced.document.getElementById('toggle-btn').click();
    await ticks();
    assert.equal(stinger(reduced), null);
  } finally {
    reduced.close();
  }
  const configure = bootKiosk(ROUTES, ANSWERED, DESKTOP, reduce(false), 'https://example.test/?configure=1');
  try {
    assert.equal(hasMotion(configure), false, 'the configure window is a tool, not the show');
  } finally {
    configure.close();
  }
  const desk = bootKiosk(ROUTES, ANSWERED, DESKTOP, reduce(false));
  try {
    desk.document.getElementById('pi-mode-switch').click();
    assert.equal(hasMotion(desk), false, 'Low power on a laptop is the Pi, motion included');
    desk.document.getElementById('quality-auto').click();
    assert.equal(hasMotion(desk), true);
  } finally {
    desk.close();
  }
  const pi = bootKiosk(ROUTES, ANSWERED, PI_ZERO, reduce(false));
  try {
    pi.document.getElementById('pi-mode-switch').click();
    assert.equal(hasMotion(pi), true, 'Full quality chosen by hand is the full profile');
  } finally {
    pi.close();
  }
});

/* ── Real Chromium: what the stylesheet does with (or without) the class ── */
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
};

async function openPage(browser, device, reducedMotion = 'no-preference') {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: device.userAgent,
    reducedMotion,
  });
  const page = await context.newPage();
  // Noon, outside the 6:30 window (the page reads the local clock).
  await page.addInitScript((cores) => {
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => cores });
    const RealDate = Date;
    const noon = new RealDate(2026, 9, 7, 12, 0, 0).getTime();
    const offset = noon - RealDate.now();
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
  }, device.hardwareConcurrency);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.host !== 'journey.test') return route.abort();
    if (url.pathname.startsWith('/lobby/')) return route.fulfill({ body: '<body style="background:#1db6d9">', contentType: 'text/html' });
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!existsSync(file) || /\.(mp4|pdf|vtt)$/.test(rel)) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  });
  await page.goto('http://journey.test/index.html');
  await page.waitForLoadState('networkidle');
  return { page, context };
}

// Every animation the page is running, by name, after walking it through the
// splash (by the flip), the settings panel and a picker step.
async function walkAndCollect(page) {
  return page.evaluate(async () => {
    const names = new Set();
    const note = () => document.getAnimations().forEach((a) => names.add(a.animationName || 'waapi'));
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('toggle-btn').click();
    await wait(50);
    note();
    document.getElementById('settings-btn').click();
    for (let i = 0; i < 40 && !document.querySelector('.settings-lesson-row'); i += 1) await wait(50);
    note();
    document.querySelector('.settings-lesson-row').click();
    await wait(20);
    note();
    return { names: [...names].sort(), cls: document.documentElement.className };
  });
}

// Steps a week-6 slideshow onto its first generated (template) slide, then
// one more, and reports what moved and what the heading says.
async function stepSlides(page) {
  return page.evaluate(async () => {
    startSlidesPreview(6);
    const counter = document.getElementById('slide-counter');
    const heading = document.getElementById('slide-template-heading');
    const template = document.getElementById('slide-template');
    // Image slides first; step until the template slide shows.
    for (let i = 0; i < 8 && template.classList.contains('hidden'); i += 1) nextSlide();
    await Promise.resolve();
    const text = heading.textContent;
    const running = (el) => el.getAnimations().length;
    const first = {
      text,
      words: [...heading.querySelectorAll('.jm-word')].map((w) => w.textContent),
      templateAnims: running(template),
      bulletAnims: [...document.querySelectorAll('#slide-template-bullets li')].map(running),
      counter: counter.textContent,
    };
    nextSlide(); // pressed again mid-animation: the next slide, at once
    await Promise.resolve();
    const second = { counter: counter.textContent, text: heading.textContent, templateAnims: running(template) };
    return { first, second };
  });
}

test('in Chromium: slide changes animate the layers on a desktop, never on the Pi, and never hold a press', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const full = await openPage(browser, DESKTOP);
    const { first, second } = await stepSlides(full.page);
    assert.ok(first.words.length >= 2, 'the heading is split into its words');
    assert.equal(first.words.join(' '), first.text.trim().split(/\s+/).join(' '), 'the same words in the same order');
    assert.equal(first.templateAnims, 1, 'the background wipes in');
    assert.ok(first.bulletAnims.length === 3 && first.bulletAnims.every((n) => n === 1), 'each bullet cascades in');
    assert.notEqual(second.counter, first.counter, 'a press mid-transition steps on at once');
    assert.equal(second.templateAnims, 1, 'the old transition is cancelled, the new one runs');
    await full.context.close();

    for (const [device, reducedMotion] of [[PI_ZERO, 'no-preference'], [DESKTOP, 'reduce']]) {
      const quiet = await openPage(browser, device, reducedMotion);
      const run = await stepSlides(quiet.page);
      assert.deepEqual(run.first.words, [], 'the heading stays one text node');
      assert.equal(run.first.templateAnims, 0);
      assert.deepEqual(run.first.bulletAnims, [0, 0, 0]);
      await quiet.context.close();
    }
  } finally {
    await browser.close();
  }
});

test('in Chromium: the Pi profile runs only the splash pulse; a desktop runs the entrances', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const low = await openPage(browser, PI_ZERO);
    const lowRun = await walkAndCollect(low.page);
    assert.equal(lowRun.cls.includes('motion-full'), false);
    assert.deepEqual(lowRun.names.filter((n) => n !== 'journey-splash-pulse'), [], 'nothing moves on the Pi but the pulse');
    // Every element's computed animation, everywhere on the page.
    const stray = await low.page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .flatMap((el) => [el, '::before', '::after'].map((p) => (p === el ? getComputedStyle(el) : getComputedStyle(el, p))))
        .map((cs) => cs.animationName)
        .filter((n) => n !== 'none' && n !== 'journey-splash-pulse')
    );
    assert.deepEqual(stray, []);
    await low.context.close();

    const full = await openPage(browser, DESKTOP);
    const fullRun = await walkAndCollect(full.page);
    assert.match(fullRun.cls, /\bmotion-full\b/);
    for (const name of ['jm-bar-in', 'jm-slam', 'jm-slam-hard', 'jm-card-in', 'jm-fly-in', 'jm-slam-soft']) {
      assert.ok(fullRun.names.includes(name), `${name} runs on a desktop (ran: ${fullRun.names.join(', ')})`);
    }
    await full.context.close();

    const reduced = await openPage(browser, DESKTOP, 'reduce');
    const reducedRun = await walkAndCollect(reduced.page);
    assert.equal(reducedRun.cls.includes('motion-full'), false);
    assert.deepEqual(reducedRun.names.filter((n) => n !== 'journey-splash-pulse'), []);
    // And the stylesheet's own gate holds even if the class were there.
    const forced = await reduced.page.evaluate(() => {
      document.documentElement.classList.add('motion-full');
      return getComputedStyle(document.getElementById('settings-card')).animationName;
    });
    assert.equal(forced, 'none');
    await reduced.context.close();
  } finally {
    await browser.close();
  }
});
