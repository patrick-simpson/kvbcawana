import { test as base, expect } from '@playwright/test';

// The permanent flagship slide (src/lib/flagship.js) leads every typed deck and
// holds for FLAGSHIP_DURATION_SEC, so a spec that wants to look at the slides
// AFTER it would wait ten real seconds per page load. This is `test` with the
// page's clock installed and every navigation to the signage fast-forwarded
// past the flagship's hold: the slideshow's own timer fires at once, and the
// deck is on its first ordinary slide, as it was before the flagship existed.
//
// A spec that is ABOUT the flagship (flagship.spec.js / flagship.events.spec.js)
// uses plain `@playwright/test` instead. The clock is installed running, not
// paused, so everything else (real-frame sampling included) keeps its speed.

export const FLAGSHIP_HOLD_MS = 10_000;

async function flagshipUp(page) {
  for (const frame of page.frames()) {
    if (await frame.locator('.flagship').count().catch(() => 0)) return true;
  }
  return false;
}

/**
 * Waits (briefly) for the flagship to be on screen, then fires its hold timer.
 * The slideshow arms that timer a beat after the slide mounts, so a single
 * fast-forward can land before it exists: keep nudging until the flagship has
 * left (its exit is a real-time animation, hence the short waits).
 */
export async function skipFlagship(page) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (await flagshipUp(page)) break;
    await page.waitForTimeout(100);
  }
  if (!(await flagshipUp(page))) return false;
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.clock.fastForward(FLAGSHIP_HOLD_MS + 250);
    await page.waitForTimeout(400);
    if (!(await flagshipUp(page))) return true;
  }
  return false;
}

const SIGNAGE = /\/(index\.html|journey-host\.html)?(\?|$)/;

async function prepare(page) {
  await page.clock.install();
  for (const method of ['goto', 'reload']) {
    const original = page[method].bind(page);
    page[method] = async (...args) => {
      const result = await original(...args);
      const url = new URL(method === 'goto' ? String(args[0]) : page.url(), 'http://x');
      if (SIGNAGE.test(url.pathname + url.search)) await skipFlagship(page);
      return result;
    };
  }
  return page;
}

// Wrapping the CONTEXT's newPage covers both the `page` fixture and the specs
// that open their own pages with `context.newPage()`.
export const test = base.extend({
  context: async ({ context }, provide) => {
    const newPage = context.newPage.bind(context);
    context.newPage = async (...args) => prepare(await newPage(...args));
    await provide(context);
  },
});

export { expect };

/**
 * Plays the deck forward, a hold at a time, until `locator` is on screen: for
 * a spec whose slide sits several places behind the flagship (a calendar's
 * auto-slides and a season poster come first in the pass).
 */
export async function advanceUntilVisible(page, locator, { holdMs = 15_000, max = 12 } = {}) {
  for (let i = 0; i < max; i++) {
    if (await locator.first().isVisible().catch(() => false)) return;
    await page.clock.fastForward(holdMs);
    await page.waitForTimeout(500);
  }
}
