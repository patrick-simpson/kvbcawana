// Journey's motion (24-motion.js + style.css's motion block), and its absence
// under reduced motion. jsdom checks who gets html.motion-full and the two
// JS-driven pieces (the view-flip stinger, the slide sweep); real Chromium
// checks what the stylesheet then does: a page with motion runs the
// kit-timed entrances, a reduced-motion page runs no animation but the
// splash's pulse, even if the class were there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKiosk, tick, KIOSK_PC, DESKTOP } from './kiosk-dom.mjs';

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

test('reduced motion never gets the motion: no class, no stinger, no sweep, no inline style', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, reduce(true));
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

// The carry's moving parts: the band, and the outgoing picture hung on it.
const band = (root) => root.querySelector(':scope > .jm-carry-band');
const outgoing = (k) => [...k.document.querySelectorAll('.jm-carry-out')];

test('the kiosk gets the motion; the band carries the old view off, the new one is already there', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, reduce(false));
  try {
    await ticks();
    assert.equal(hasMotion(k), true);
    assert.equal(stinger(k), null, 'nothing plays for the view the page opened on');
    const journeyView = k.document.getElementById('journey-view');
    const checkinView = k.document.getElementById('checkin-view');
    const splash = k.document.getElementById('journey-splash');
    k.document.getElementById('toggle-btn').click();
    // Synchronously after the click: the Journey view is already up.
    assert.equal(journeyView.classList.contains('hidden'), false);
    await ticks(1);
    const s = stinger(k);
    assert.ok(s, 'the flip plays over the new view');
    assert.equal(s.getAttribute('aria-hidden'), 'true');
    assert.equal(s.classList.contains('is-back'), false, 'into Journey: left to right');
    assert.equal(band(s).querySelectorAll('.jm-carry-stripe').length, 4, 'one band, four stripes');
    // The old view is the one the band carries: still `hidden` to the code,
    // shown again by the carry only, and never moved in the page (the
    // check-in frame is the same element, still in its layer).
    assert.deepEqual(outgoing(k), [checkinView]);
    assert.equal(checkinView.classList.contains('hidden'), true);
    assert.equal(k.document.getElementById('checkin-frame').parentElement, checkinView);
    assert.equal(splash.classList.contains('hidden'), false, 'the new view is in place under it');

    // And back: the other way, the Journey view (with the splash it was
    // showing, though the code has put it away) carried off.
    k.document.getElementById('toggle-btn').click();
    await ticks(1);
    assert.equal(k.document.querySelectorAll('.jm-stinger').length, 1, 'one carry at a time');
    assert.equal(stinger(k).classList.contains('is-back'), true);
    assert.deepEqual(outgoing(k), [journeyView]);
    assert.equal(journeyView.classList.contains('is-back'), true);
    assert.equal(checkinView.classList.contains('jm-carry-out'), false, 'the first carry let go');
    assert.equal(splash.classList.contains('hidden'), true, 'the code put the splash away');
    assert.equal(splash.classList.contains('jm-carry-keep'), true, '...and the carry shows it riding off');

    // The carry ends: everything it touched is back as the code left it.
    band(stinger(k)).dispatchEvent(new k.window.Event('animationend'));
    assert.equal(stinger(k), null);
    assert.deepEqual(outgoing(k), []);
    assert.equal(k.document.querySelector('.jm-carry-keep'), null);
    assert.equal(journeyView.classList.contains('is-back'), false);

    // A video that starts playing takes a carry down at once.
    k.document.getElementById('toggle-btn').click();
    await ticks(1);
    assert.ok(stinger(k));
    k.video.dispatchEvent(new k.window.Event('playing'));
    assert.equal(stinger(k), null);
    assert.deepEqual(outgoing(k), []);
  } finally {
    k.close();
  }
});

test('kiosk slides: the old slide rides off on the band, a step back runs the other way', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, reduce(false));
  try {
    await ticks();
    k.window.startSlidesPreview(6);
    await ticks(1);
    // The flip into the slides carries the Check-in Display off (slide 1 is
    // what it uncovers); let it end.
    band(stinger(k)).dispatchEvent(new k.window.Event('animationend'));
    assert.equal(stinger(k), null);
    await ticks(2);
    const realImage = k.document.getElementById('slide-image');
    const firstSrc = realImage.getAttribute('src');
    assert.ok(firstSrc, 'slide 1 landed');
    k.window.nextSlide();
    await ticks(1);
    const view = k.document.getElementById('slides-view');
    const sweep = view.querySelector(':scope > .jm-slide-sweep');
    const ghost = view.querySelector(':scope > .jm-slide-ghost');
    assert.ok(sweep && ghost, 'a band and the old slide beside it');
    assert.equal(sweep.classList.contains('is-back'), false);
    assert.equal(ghost.getAttribute('aria-hidden'), 'true');
    assert.equal(band(sweep).querySelectorAll('.jm-carry-stripe').length, 4);
    // The old picture is slide 1 (a copy of the stage), the real stage
    // already shows slide 2, and every lookup still finds the real one.
    assert.equal(ghost.querySelector('img').getAttribute('src'), firstSrc);
    assert.equal(k.document.getElementById('slide-image'), realImage);
    assert.equal(k.document.getElementById('slide-counter').textContent, 'Slide 2 of 7');
    assert.ok(ghost.compareDocumentPosition(realImage) & k.window.Node.DOCUMENT_POSITION_PRECEDING, 'the copy comes after the real stage');
    await ticks(2);
    const secondSrc = realImage.getAttribute('src');
    assert.notEqual(secondSrc, firstSrc);
    k.window.prevSlide();
    await ticks(1);
    assert.equal(k.document.querySelectorAll('.jm-slide-sweep').length, 1, 'one band at a time');
    assert.equal(k.document.querySelectorAll('.jm-slide-ghost').length, 1, 'one old slide at a time');
    assert.equal(k.document.querySelector('.jm-slide-sweep').classList.contains('is-back'), true);
    assert.equal(k.document.querySelector('.jm-slide-ghost').classList.contains('is-back'), true);
    assert.equal(k.document.querySelector('.jm-slide-ghost img').getAttribute('src'), secondSrc, 'slide 2 rides off');
    band(k.document.querySelector('.jm-slide-sweep')).dispatchEvent(new k.window.Event('animationend'));
    assert.equal(k.document.querySelector('.jm-slide-ghost, .jm-slide-sweep'), null, 'gone when the band is');

    // Leaving the slides for the Check-in Display: the last slide rides off
    // as a still copy (the code has already emptied the stage).
    await ticks(2);
    k.document.getElementById('toggle-btn').click();
    await ticks(1);
    assert.ok(stinger(k));
    assert.equal(view.classList.contains('jm-carry-keep'), true);
    assert.equal(view.querySelector('.jm-slide-still img').getAttribute('src'), firstSrc);
    band(stinger(k)).dispatchEvent(new k.window.Event('animationend'));
    assert.equal(view.querySelector('.jm-slide-still'), null);
  } finally {
    k.close();
  }
});


/* Every slide picture is decoded before it is shown, and a step's carry waits
   for it at its first frame (the old slide still covering the stage), so the
   band never uncovers a black or half-painted slide. `decodes` holds each
   pending Image.decode() so a test can finish one when it chooses. */
function heldDecodes(window) {
  const decodes = [];
  window.HTMLImageElement.prototype.decode = function decode() {
    return new Promise((resolve) => decodes.push({ src: this.getAttribute('src'), resolve }));
  };
  return decodes;
}

test('kiosk slides: the carry is held at its first frame until the new picture is decoded', async () => {
  let decodes = [];
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, (window) => {
    reduce(false)(window);
    decodes = heldDecodes(window);
  });
  try {
    await ticks();
    k.window.startSlidesPreview(6);
    await ticks(2);
    band(stinger(k)).dispatchEvent(new k.window.Event('animationend'));
    const realImage = k.document.getElementById('slide-image');
    // Slide 1 is not put on the stage until it is decoded.
    assert.equal(realImage.getAttribute('src'), null, 'no half-decoded picture on screen');
    for (const d of decodes.splice(0)) d.resolve();
    await ticks(2);
    const firstSrc = realImage.getAttribute('src');
    assert.match(firstSrc, /slide-1\.jpg(\?r=\d+)?$/);
    // The next slide was decoded ahead already (asked for, at least).
    await ticks(2);
    for (const d of decodes.splice(0)) d.resolve();
    await ticks(2);

    k.window.nextSlide();
    await ticks(1);
    const ghost = k.document.querySelector('.jm-slide-ghost');
    const sweep = k.document.querySelector('.jm-slide-sweep');
    assert.ok(ghost && sweep);
    // Slide 2 was decoded ahead, so the carry runs at once.
    await ticks(2);
    assert.equal(ghost.classList.contains('jm-hold'), false, 'a picture decoded ahead never holds the carry');
    assert.match(realImage.getAttribute('src'), /slide-2\.jpg(\?r=\d+)?$/);

    // Slide 3: its decode is still pending (asked for ahead, not done).
    band(sweep).dispatchEvent(new k.window.Event('animationend'));
    await ticks(2);
    const pendingThird = decodes.filter((d) => /slide-3\.jpg(\?r=\d+)?$/.test(d.src));
    assert.equal(pendingThird.length, 1, 'slide 3 is being decoded ahead');
    k.window.nextSlide();
    await ticks(2);
    const held = k.document.querySelector('.jm-slide-ghost');
    assert.equal(held.classList.contains('jm-hold'), true, 'the old slide holds, still covering the stage');
    assert.equal(k.document.querySelector('.jm-slide-sweep').classList.contains('jm-hold'), true, 'the band waits off screen');
    assert.match(held.querySelector('img').getAttribute('src'), /slide-2\.jpg(\?r=\d+)?$/, 'what covers the stage is the old slide');
    assert.match(realImage.getAttribute('src'), /slide-2\.jpg(\?r=\d+)?$/, 'the new picture is not on the stage half-decoded');
    assert.equal(k.document.getElementById('slide-counter').textContent, 'Slide 3 of 7', 'the press is acknowledged at once');
    pendingThird[0].resolve();
    await ticks(2);
    assert.equal(held.classList.contains('jm-hold'), false, 'decoded: the carry goes');
    assert.equal(k.document.querySelector('.jm-slide-sweep').classList.contains('jm-hold'), false);
    assert.match(realImage.getAttribute('src'), /slide-3\.jpg(\?r=\d+)?$/);
  } finally {
    k.close();
  }
});

test('kiosk slides: a picture that never decodes holds the carry 400ms at most, and still goes on screen', async () => {
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, (window) => {
    reduce(false)(window);
    heldDecodes(window); // never resolved
  });
  try {
    await ticks();
    k.window.startSlidesPreview(6);
    await ticks(2);
    band(stinger(k)).dispatchEvent(new k.window.Event('animationend'));
    k.window.nextSlide();
    await ticks(2);
    const ghost = k.document.querySelector('.jm-slide-ghost');
    assert.equal(ghost.classList.contains('jm-hold'), true);
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(ghost.classList.contains('jm-hold'), false, 'the cap lets the carry go');
  } finally {
    k.close();
  }
});

/* The splash's entrance waits for the kit's fonts at startup (never longer
   than 1.2s), so it never slams in a fallback face and jumps. */
function pendingFonts(window) {
  let resolve;
  const ready = new Promise((r) => (resolve = r));
  Object.defineProperty(window.document, 'fonts', {
    configurable: true,
    value: { status: 'loading', ready, load: () => Promise.resolve([]) },
  });
  return () => resolve();
}

test('startup: the entrances wait for the fonts, and only with motion', async () => {
  let fontsIn;
  const k = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, (window) => {
    reduce(false)(window);
    fontsIn = pendingFonts(window);
  });
  try {
    const root = k.document.documentElement;
    assert.equal(root.classList.contains('jm-fonts-wait'), true, 'held while the fonts load');
    fontsIn();
    await ticks(2);
    assert.equal(root.classList.contains('jm-fonts-wait'), false, 'released when they are in');
  } finally {
    k.close();
  }
  const slow = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, (window) => {
    reduce(false)(window);
    pendingFonts(window); // never ready
  });
  try {
    assert.equal(slow.document.documentElement.classList.contains('jm-fonts-wait'), true);
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(slow.document.documentElement.classList.contains('jm-fonts-wait'), false, 'a font that never comes never holds the screen');
  } finally {
    slow.close();
  }
  const still = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, (window) => {
    reduce(true)(window);
    pendingFonts(window);
  });
  try {
    assert.doesNotMatch(still.document.documentElement.className, /motion|jm-/, 'reduced motion: no motion class at all');
  } finally {
    still.close();
  }
});

test('reduced motion and configure mode switch it off; every device without them gets it', async () => {
  const reduced = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, reduce(true));
  try {
    await ticks();
    assert.equal(hasMotion(reduced), false, 'the OS asked for reduced motion');
    reduced.document.getElementById('toggle-btn').click();
    await ticks();
    assert.equal(stinger(reduced), null);
  } finally {
    reduced.close();
  }
  const configure = bootKiosk(ROUTES, ANSWERED, KIOSK_PC, reduce(false), 'https://example.test/?configure=1');
  try {
    assert.equal(hasMotion(configure), false, 'the configure window is a tool, not the show');
  } finally {
    configure.close();
  }
  // The page no longer asks what it runs on: a Mac and a phone get it too,
  // and an old saved "low" choice from the removed Pi mode is ignored.
  const phone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' };
  for (const device of [DESKTOP, phone]) {
    const k = bootKiosk(ROUTES, { ...ANSWERED, 'journey.playback.quality': 'low' }, device, reduce(false));
    try {
      assert.equal(hasMotion(k), true);
    } finally {
      k.close();
    }
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
  await page.addInitScript(() => {
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
  });
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
      bulletAnims: [...document.getElementById('slide-template-bullets').children].map(running),
      counter: counter.textContent,
    };
    nextSlide(); // pressed again mid-animation: the next slide, at once
    await Promise.resolve();
    const second = { counter: counter.textContent, text: heading.textContent, templateAnims: running(template) };
    return { first, second };
  });
}

test('in Chromium: slide changes animate the layers, never under reduced motion, and never hold a press', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const full = await openPage(browser, KIOSK_PC);
    const { first, second } = await stepSlides(full.page);
    assert.ok(first.words.length >= 2, 'the heading is split into its words');
    assert.equal(first.words.join(' '), first.text.trim().split(/\s+/).join(' '), 'the same words in the same order');
    assert.equal(first.templateAnims, 1, 'the background wipes in');
    assert.ok(first.bulletAnims.length === 3 && first.bulletAnims.every((n) => n === 1), 'each bullet cascades in');
    assert.notEqual(second.counter, first.counter, 'a press mid-transition steps on at once');
    assert.equal(second.templateAnims, 1, 'the old transition is cancelled, the new one runs');
    await full.context.close();

    const quiet = await openPage(browser, KIOSK_PC, 'reduce');
    const run = await stepSlides(quiet.page);
    assert.deepEqual(run.first.words, [], 'the heading stays one text node');
    assert.equal(run.first.templateAnims, 0);
    assert.deepEqual(run.first.bulletAnims, [0, 0, 0]);
    await quiet.context.close();
  } finally {
    await browser.close();
  }
});

test('in Chromium: reduced motion runs only the splash pulse; the kiosk runs the entrances', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const full = await openPage(browser, KIOSK_PC);
    const fullRun = await walkAndCollect(full.page);
    assert.match(fullRun.cls, /\bmotion-full\b/);
    for (const name of ['jm-carry', 'jm-slam', 'jm-slam-hard', 'jm-card-in', 'jm-fly-in', 'jm-slam-soft']) {
      assert.ok(fullRun.names.includes(name), `${name} runs on the kiosk (ran: ${fullRun.names.join(', ')})`);
    }
    await full.context.close();

    const reduced = await openPage(browser, KIOSK_PC, 'reduce');
    const reducedRun = await walkAndCollect(reduced.page);
    assert.equal(reducedRun.cls.includes('motion-full'), false);
    assert.deepEqual(reducedRun.names.filter((n) => n !== 'journey-splash-pulse'), [], 'nothing moves but the pulse');
    // Every element's computed animation, everywhere on the page.
    const stray = await reduced.page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .flatMap((el) => [el, '::before', '::after'].map((p) => (p === el ? getComputedStyle(el) : getComputedStyle(el, p))))
        .map((cs) => cs.animationName)
        .filter((n) => n !== 'none' && n !== 'journey-splash-pulse')
    );
    assert.deepEqual(stray, []);
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

// Freezes every running animation at `t` ms and reports where the band's
// leading edge and the old picture's edge are (both in viewport px).
async function carryEdges(page, t, bandSel, oldSel) {
  return page.evaluate(
    ({ t, bandSel, oldSel }) => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = t;
      }
      const band = document.querySelector(bandSel).getBoundingClientRect();
      const old = document.querySelector(oldSel).getBoundingClientRect();
      const back = !!document.querySelector(bandSel).closest('.is-back');
      return { lead: back ? band.left : band.right, edge: back ? old.right : old.left, width: innerWidth };
    },
    { t, bandSel, oldSel }
  );
}

test('in Chromium: the old picture is hung on the band the whole way (flip both ways, slide steps)', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const { page, context } = await openPage(browser, KIOSK_PC);
    const sample = async (bandSel, oldSel) => {
      const seen = [];
      for (const t of [0, 150, 300, 450, 600, 900]) {
        const { lead, edge, width } = await carryEdges(page, t, bandSel, oldSel);
        assert.ok(Math.abs(lead - edge) < 1, `at ${t}ms the band's leading edge (${lead}) holds the old picture's edge (${edge})`);
        seen.push(edge);
      }
      assert.ok(Math.abs(seen[0] - (seen[0] < 1 ? 0 : 1280)) < 1, 'it starts exactly where the old picture stood');
      assert.ok(seen.some((x) => x > 100 && x < 1180), 'and crosses the screen');
      await page.evaluate(() => document.getAnimations().forEach((a) => (a.effect.getComputedTiming().endTime === Infinity ? a.play() : a.finish())));
      await page.waitForTimeout(50);
    };
    // Into Journey, left to right: the Check-in Display rides off.
    await page.click('#toggle-btn');
    await sample('.jm-stinger > .jm-carry-band', '#checkin-view');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('checkin-view')).display), 'none');
    // And back, right to left: the splash rides off.
    await page.click('#toggle-btn');
    await sample('.jm-stinger > .jm-carry-band', '#journey-view');
    // A slide step: the copy of the old slide rides off.
    await page.evaluate(() => startSlidesPreview(6));
    await page.waitForTimeout(1500);
    await page.evaluate(() => nextSlide());
    await sample('.jm-slide-sweep > .jm-carry-band', '.jm-slide-ghost');
    await page.waitForTimeout(300);
    await page.evaluate(() => prevSlide());
    await sample('.jm-slide-sweep > .jm-carry-band', '.jm-slide-ghost');
    await context.close();
  } finally {
    await browser.close();
  }
});


test('in Chromium: the slide stage clips the drift, so a step never slides over the pillarbox', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const { page, context } = await openPage(browser, KIOSK_PC); // 1280x720: stage 960 wide, bars 160
    await page.evaluate(() => startSlidesPreview(6));
    await page.waitForTimeout(1500);
    const hit = await page.evaluate(async () => {
      nextSlide();
      // Let the held carry go (slide 2 was decoded ahead), then freeze every
      // animation at its first frame: the new slide drifted 6% left.
      await new Promise((r) => setTimeout(r, 100));
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 0;
      }
      document.querySelectorAll('.jm-slide-ghost, .jm-slide-sweep').forEach((el) => el.remove());
      const img = document.getElementById('slide-image').getBoundingClientRect();
      const stage = document.getElementById('slide-stage').getBoundingClientRect();
      const at = document.elementFromPoint(stage.left - 20, 360);
      return { imgLeft: img.left, stageLeft: stage.left, at: at && at.id };
    });
    assert.ok(hit.imgLeft < hit.stageLeft - 20, `the picture really is drifted past the stage (${hit.imgLeft} < ${hit.stageLeft})`);
    assert.equal(hit.at, 'slides-view', 'what shows beside the stage is the black pillarbox, not the drifting slide');
    await context.close();
  } finally {
    await browser.close();
  }
});

test('in Chromium: while the fonts load the splash entrance waits at its first frame, then plays', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const { page, context } = await openPage(browser, KIOSK_PC);
    const states = await page.evaluate(async () => {
      const root = document.documentElement;
      root.classList.add('jm-fonts-wait');
      document.getElementById('toggle-btn').click();
      await new Promise((r) => setTimeout(r, 50));
      const title = document.getElementById('journey-splash-title');
      const held = title.getAnimations().map((a) => a.playState);
      const opacity = getComputedStyle(title).opacity;
      root.classList.remove('jm-fonts-wait');
      await new Promise((r) => setTimeout(r, 50));
      return { held, opacity, after: title.getAnimations().map((a) => a.playState), cls: root.className };
    });
    assert.match(states.cls, /\bmotion-full\b/);
    assert.deepEqual(states.held, ['paused'], 'the slam waits');
    assert.equal(states.opacity, '0', 'at its first frame: not drawn in a fallback face');
    assert.deepEqual(states.after, ['running'], 'and plays once the fonts are in');
    await context.close();
  } finally {
    await browser.close();
  }
});
