// The kiosk on a big screen (the Journey PC drives a TV that may run at 4K
// with no Windows scaling: 3840x2160 CSS px). The video bar, the slide bar,
// the corner buttons and the captions were drawn in px for 1080p; they now
// grow with --u past it (style.css, "--jr-corner-u"), and are unchanged at
// 1080p and below (the other layout tests' screens). Real Chromium, the
// page's stylesheet only (schedule.js not run), every request answered from
// public/ by the test itself; skipped without Chromium.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
const skip = existsSync(CHROMIUM) ? false : `no Chromium at ${CHROMIUM}`;
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const PILLS = ['back15-btn', 'pause-btn', 'fwd15-btn', 'unmute-btn', 'cc-btn'];

async function openAt(browser, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (url.host !== 'journey.test' || rel === 'src/schedule.js' || !existsSync(file)) return route.abort();
    return route.fulfill({ body: readFileSync(file), contentType: TYPES[path.extname(file)] });
  });
  await page.goto('http://journey.test/index.html');
  await page.evaluate(async () => {
    await document.fonts.load("400 16px 'Londrina Solid'");
    await document.fonts.load("600 16px 'Figtree'");
  });
  return page;
}

// Everything measured in one view: the Journey layer with the video bar, a
// caption and the count chip up, or the Check-in Display.
async function measure(page, view) {
  return page.evaluate(
    ({ view, pills }) => {
      const show = (id, on) => document.getElementById(id).classList.toggle('hidden', !on);
      show('checkin-view', view === 'checkin');
      show('journey-view', view !== 'checkin');
      show('video-controls', view === 'video');
      show('cc-btn', true);
      show('caption-overlay', view === 'video');
      show('slides-view', view === 'slides');
      show('journey-chip', view === 'slides');
      document.getElementById('video-time').textContent = '12:45 / 15:02';
      document.getElementById('caption-text').textContent = 'And that is why it still matters today.';
      const chipCount = document.querySelector('#journey-chip .jr-chip-count');
      if (chipCount) chipCount.textContent = '27';
      const box = (id) => {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      return {
        bar: box('video-controls'),
        pills: pills.map(box),
        scrubber: box('video-scrubber'),
        toggle: box('toggle-btn'),
        gear: box('settings-btn'),
        chip: box('journey-chip'),
        next: box('slide-next-btn'),
        slideBar: box('slide-controls'),
        caption: parseFloat(getComputedStyle(document.getElementById('caption-text')).fontSize),
      };
    },
    { view, pills: PILLS }
  );
}

test('1080p is exactly as it was; 4K gets the same bar, buttons and captions twice as big', { skip }, async () => {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: CHROMIUM });
  try {
    const hd = await openAt(browser, 1920, 1080);
    const hdVideo = await measure(hd, 'video');
    // The 1080p sizes the bar was drawn at (measured before the change).
    assert.ok(Math.abs(hdVideo.toggle.width - 48) < 0.5 && Math.abs(hdVideo.toggle.height - 48) < 0.5);
    assert.ok(Math.abs(hdVideo.caption - 48.6) < 0.05, `1080p caption ${hdVideo.caption}px, as before`);
    assert.ok(Math.abs(hdVideo.scrubber.height - 28) < 0.5);
    const hdSlides = await measure(hd, 'slides');

    const uhd = await openAt(browser, 3840, 2160);
    const uhdVideo = await measure(uhd, 'video');
    const uhdSlides = await measure(uhd, 'slides');
    const twice = (a, b, what) => assert.ok(Math.abs(b - 2 * a) <= 2, `${what}: ${b} is twice ${a}`);
    hdVideo.pills.forEach((p, i) => twice(p.height, uhdVideo.pills[i].height, `${PILLS[i]} height`));
    twice(hdVideo.bar.height, uhdVideo.bar.height, 'bar height');
    twice(hdVideo.scrubber.height, uhdVideo.scrubber.height, 'scrubber height');
    twice(hdVideo.toggle.width, uhdVideo.toggle.width, 'toggle over the lesson');
    twice(hdVideo.gear.width, uhdVideo.gear.width, 'gear over the lesson');
    twice(hdSlides.next.height, uhdSlides.next.height, 'slide Next height');
    twice(hdVideo.caption, uhdVideo.caption, 'caption size (no longer capped at 56px)');

    for (const [name, m] of [['1080p', hdVideo], ['4K', uhdVideo]]) {
      // One row of pills, inside the bar, clear of the toggle beside it.
      assert.equal(new Set(m.pills.map((p) => Math.round(p.top))).size, 1, `${name}: the pills share one row`);
      assert.ok(m.bar.right <= m.toggle.left - 16, `${name}: the bar stops short of the toggle`);
      assert.ok(m.scrubber.width > m.bar.width * 0.5, `${name}: the scrubber keeps most of the bar`);
    }
    for (const [name, m, k] of [['1080p', hdSlides, 1], ['4K', uhdSlides, 2]]) {
      assert.ok(m.slideBar.right <= m.toggle.left - 16, `${name}: the slide bar stops short of the toggle`);
      // The count chip sits left of the (grown) gear, as clear of it as at
      // 1080p (test/corner-buttons.test.mjs: at least 12px there).
      assert.ok(m.chip.right <= m.gear.left - 12 * k, `${name}: the Journey chip ends ${m.gear.left - m.chip.right}px left of the gear`);
      assert.ok(Math.abs(m.chip.top - m.gear.top) < 1, `${name}: top-aligned with it`);
    }

    // Over the Check-in Display the display's reserved column is 48px at
    // every size (the corner-button contract): there they never grow.
    for (const page of [hd, uhd]) {
      const m = await measure(page, 'checkin');
      for (const b of [m.toggle, m.gear]) {
        assert.ok(Math.abs(b.width - 48) < 0.5 && Math.abs(b.height - 48) < 0.5, `a 48px button over the display (${b.width}x${b.height})`);
      }
      assert.ok(Math.abs(m.gear.bottom + 8 - m.toggle.top) < 1, 'gear stacked 8px above the toggle');
    }
  } finally {
    await browser.close();
  }
});
