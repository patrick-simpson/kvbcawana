import { expect, test } from '@playwright/test';

// The lobby's first-run card against the things that come and go over it.
//
// The card stands in the foot of the lobby (OVERLAY.setup) and a screen that is
// not keyed yet always wants it, so it has to give way, and give way in step
// with what the ROOM sees, not with the flags that lead it:
//
//  - A name (now pinned by src/App.director.test.jsx alone, see "Names" below).
//    `currentEvent` goes null the moment a run's hold ends, but the run
//    is still leaving for ~700 ms and the next may be a second away; judged by
//    it alone the white card came back over "WELCOME NOAH" and the club's mark
//    as they left, and popped in and out between children a few seconds apart.
//  - A held slide (a promo poster, a slide marked "Hold check-ins"). Its flag
//    drops as the slideshow moves on, while the poster is on screen until the
//    stinger's wave covers the screen, and the wave itself until it has gone.
//    The card came back over the poster's date chip and over the wave; and under
//    ?lowPower=1 a passive report left it drawn over a poster that had
//    already been swapped in (a frame or four; longer on a weak Pi).
//
// These sample real frames in the page (requestAnimationFrame, a rolling record
// of what stood on screen in each), because the overlap lives in single frames
// and in 700 ms exits that Playwright's paused clock cannot drive.
//
// In the events project (ci.yml only, never the deploy gate): multi-second,
// timing-sensitive, and a club-night fix must never wait on them.

/** Records, every frame, whether the card is up and what it might be standing over. */
function record() {
  const rec = { frames: [] };
  window.__rec = rec;
  const onScreen = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  };
  const loop = (t) => {
    const card = document.querySelector('.setup-card');
    const moment = document.querySelector('.checkin');
    const heldCopy = [...document.querySelectorAll('.lobby-headline')].some((h) => h.textContent.includes('HELD'));
    const wave = document.querySelector('.slide-stinger');
    const f = { t: Math.round(t), card: !!card, moment: !!moment, held: heldCopy, wave: !!wave && onScreen(wave) };
    const last = rec.frames[rec.frames.length - 1];
    if (!last || last.card !== f.card || last.moment !== f.moment || last.held !== f.held || last.wave !== f.wave) rec.frames.push(f);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

const frames = (page) => page.evaluate(() => window.__rec.frames);
const nowMs = (page) => page.evaluate(() => Math.round(performance.now()));

// The flagship welcome slide leads every pass and never holds check-ins, so both
// tests here run in real time and simply let it play: a name over it is the
// case, and the held-slide test waits for two laps (the flagship adds ten
// seconds to the first, well inside its 75 s budget).
const QUIET_MS = 5000; // SETUP_CARD_QUIET_MS

/* ── Names ───────────────────────────────────────────────────────────── */

// There is no browser case for a name over the card any more: the card is for a
// screen that has not signed in, and only a signed-in screen hears the live
// channel that delivers names (Pusher, which let an unkeyed screen listen, is
// retired). The rule itself (a name, its exit and a quiet beat after it hold the
// card down) is still in the code and still pinned, against a connected screen
// whose login reads "logged out", by src/App.director.test.jsx.

/* ── A held slide ────────────────────────────────────────────────────── */

const DECK = [
  { id: 's_a', eyebrow: 'Before', text: 'ORDINARY ONE', theme: 'sky', durationSec: 3 },
  { id: 's_h', eyebrow: 'Hold it', text: 'HELD SLIDE', theme: 'night', durationSec: 3, holdCheckIns: true },
  { id: 's_b', eyebrow: 'After', text: 'ORDINARY TWO', theme: 'sky', durationSec: 3 },
];

/** [label, query, CPU throttle rate]: the Pi is the case the report's timing hurts. */
const CASES = [
  ['with motion', '', 1],
  ['under ?lowPower=1', '?lowPower=1', 1],
  ['under ?lowPower=1 on a 4x slower CPU', '?lowPower=1', 4],
];

for (const [label, query, cpu] of CASES) {
  test(`the card never stands over a held slide or its stinger, and returns after them ${label}`, async ({ page }) => {
    test.setTimeout(75_000);
    if (cpu > 1) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    }
    await page.route(/open-meteo|twotimtwo|sockjs/, (route) => route.abort());
    await page.addInitScript(record);
    await page.addInitScript((config) => {
      localStorage.setItem('awanaConfig.v1', JSON.stringify(config));
    }, {
      backgroundSource: 'manual',
      calendarEnabled: false,
      seasonPromos: false,
      manualSlides: DECK,
      slideshowDelaySec: 3,
      showClock: false,
      particleEffect: 'off',
    });
    await page.goto(`/index.html${query}`);
    await expect(page.locator('.setup-card')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    // Two full laps of the deck: the held slide comes up twice, and goes twice, and
    // the recording ends on a frame with the card back (the last lap's held slide
    // has gone, so "it does come back" below has a frame to find).
    const start = await nowMs(page);
    await page.waitForFunction((from) => window.__rec.frames.filter((x, i, all) => x.held && !all[i - 1]?.held).length >= 2 && performance.now() - from > 20000 && window.__rec.frames.at(-1).card, start, { timeout: 65_000, polling: 250 });
    const f = await frames(page);

    // The held slide (and, with motion, the wave) really were on screen for the record to catch.
    const heldFrames = f.filter((x) => x.held);
    expect(heldFrames.length).toBeGreaterThan(0);
    if (!query) expect(f.filter((x) => x.wave).length).toBeGreaterThan(0);

    // Not one frame with the card over the held slide's copy, or over the wave...
    expect(f.filter((x) => x.card && x.held)).toEqual([]);
    expect(f.filter((x) => x.card && x.wave)).toEqual([]);
    // ...and it does come back: after the held slide is gone there is a frame with the card up.
    const lastHeld = f.filter((x, i) => x.held && !f[i + 1]?.held).at(-1);
    expect(f.some((x) => x.card && x.t > lastHeld.t)).toBe(true);
  });
}
