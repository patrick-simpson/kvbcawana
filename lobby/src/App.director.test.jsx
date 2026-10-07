import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

// THE LOBBY DIRECTOR (rebrand stage 4), wired end to end.
//
// The pieces each have their own tests (the queue's hold in checkInQueue,
// the pause and the slide reports in ManualSlideshow, the snapshots in
// cornerInfo). These are whole-App tests of the seams between them, which is
// where the headline behaviour lives: a slide that holds check-ins really
// does hold the line, names really do pause the deck, the corner really does
// step aside, and a waiting child really does keep the screen from reloading
// underneath them.
//
// Fake timers drive the slideshow and the queue; framer-motion runs its
// frames on the real clock (it captures requestAnimationFrame at import), so
// `settle()` waits a few real frames for an exit to finish. Zero-animation
// mode makes every exit a one-frame jump.

const realSetTimeout = globalThis.setTimeout;
const settle = () => act(() => new Promise((r) => realSetTimeout(r, 30)));
// Time passes in short steps with the frames in between, the way it does on
// a real screen: inside one long act() React holds every effect (so every
// timer an effect would start) until the act ends, which is not a clock any
// screen runs on.
async function tick(ms) {
  for (let left = ms; left > 0; left -= 250) {
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(250, left)); });
    await settle();
  }
  if (ms === 0) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

let bound = {};
vi.mock('pusher-js', () => ({
  default: class FakePusher {
    constructor() {
      this.connection = { state: 'connected', bind: () => {}, unbind: () => {} };
    }
    subscribe() { return { bind: (evt, fn) => { bound[evt] = fn; }, unbind_all: () => {} }; }
    unsubscribe() {}
    disconnect() {}
    connect() {}
  },
}));

// The self-update poller, captured rather than run: the test asks the same
// "may this screen reload right now?" question the poller would.
let reloadBusy = null;
vi.mock('./hooks/useBuildReload.js', () => ({
  useBuildReload: (isBusy) => { reloadBusy = isBusy; },
}));

import { STINGER_SEC } from './lib/lobbyMotion.js';
import { SETUP_CARD_QUIET_MS } from './lib/constants.js';

const App = (await import('./App.jsx')).default;
const cfg = await import('./hooks/useConfig.js');
const { FLAGSHIP_DURATION_SEC } = await import('./lib/flagship.js');

function todayKey(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const A = { id: 's_a', text: 'Slide A', durationSec: 5 };
const H = { id: 's_h', text: 'Held poster', durationSec: 10, holdCheckIns: true };
const B = { id: 's_b', text: 'Slide B', durationSec: 5 };

function configure(over = {}) {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    pusherAppKey: 'k',
    pusherCluster: 'us2',
    confettiLevel: 'off',
    firstArrivalMoment: false,
    reduceMotion: true,
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    showWeatherChip: false,
    showClock: true,
    showTally: true,
    slideshowDelaySec: 5,
    standardDisplayMs: 6000,
    manualSlides: [A, H, B],
    ...over,
  }));
  cfg._resetForTest();
}

async function mount() {
  await act(async () => { render(<App />); });
  await tick(0);
  expect(bound.checkin).toBeTypeOf('function');
}
// The permanent flagship welcome slide (src/lib/flagship.js) leads every typed
// deck and holds FLAGSHIP_DURATION_SEC. A test about what the deck does
// around a held slide plays it out first and begins on Slide A, as it always
// did; the rest start on the flagship, which is what a screen shows at boot.
async function mountPastFlagship() {
  await mount();
  await tick(FLAGSHIP_DURATION_SEC * 1000);
}

const onScreen = (text) => [...document.querySelectorAll('.manual-slide')].some((el) => el.textContent.includes(text));
const banner = () => document.querySelector('.checkin');
const waiting = () => document.querySelector('.corner-chip--waiting');
const cornerIds = () => [...document.querySelectorAll('.corner-chip')]
  .map((el) => [...el.classList].find((c) => /^corner-chip--(clock|tally|weather)$/.test(c)))
  .filter(Boolean)
  .map((c) => c.replace('corner-chip--', ''));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    // A Tuesday noon: the flagship is off the air Wednesday 6:30-8:30 pm, and
    // these tests must not depend on when they happen to run.
    now: new Date(2026, 8, 29, 12, 0) });
  bound = {};
  reloadBusy = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Each test waits out ~30 ms of real frames per 250 ms of screen time, so a
// run of 20-odd screen seconds costs 2-4 s of wall clock on an idle machine:
// too close to vitest's 5 s default for a busy one. The budget is wall clock
// only; every assertion about screen time runs on the fake clock.
describe('the lobby director, end to end', { timeout: 20_000 }, () => {
  // These two run FIRST on purpose. Started on the flagship slide (the boot
  // slide) after an earlier test in this file has played a held slide, a
  // banner's exit stops completing under jsdom (the queue has moved on; the
  // node stays), and only there. Alone, first, and in a real browser
  // (e2e/flagship.events.spec.js) it leaves on time; the leftover is from this
  // file's own shared framer-motion frame loop, not from the app.
  it('the first-run card stays down through a name, its exit and a quiet beat after it, and then returns', async () => {
    configure({ manualSlides: [A, B] });
    await mount();
    await settle();
    const card = () => document.querySelector('.setup-card');
    expect(card()).not.toBeNull();

    await act(async () => { bound.checkin({ firstName: 'Ann', club: 'Sparks', id: 'a1', at: Date.now() }); });
    expect(banner()).not.toBeNull();
    expect(card()).toBeNull();

    // Her six seconds, then the gap (400 ms), then the quiet beat: down throughout.
    const seen = [];
    for (let t = 250; t <= 6000 + 400 + SETUP_CARD_QUIET_MS - 500; t += 250) {
      await tick(250);
      seen.push(!!card());
    }
    expect(banner()).toBeNull();
    expect(seen).not.toContain(true);

    await tick(1000);
    await settle();
    expect(card()).not.toBeNull();
  });

  it('two names a few seconds apart never have the card pop in between them', async () => {
    configure({ manualSlides: [A, B] });
    await mount();
    await settle();
    const card = () => document.querySelector('.setup-card');
    const seen = [];
    const watch = async (ms) => {
      for (let left = ms; left > 0; left -= 250) { await tick(250); seen.push(!!card()); }
    };

    await act(async () => { bound.checkin({ firstName: 'Ann', club: 'Sparks', id: 'a1', at: Date.now() }); });
    await watch(6000 + 400 + 1500);       // Ann's moment, its gap, and a second and a half of empty stage
    expect(banner()).toBeNull();
    await act(async () => { bound.checkin({ firstName: 'Ben', club: 'Sparks', id: 'b1', at: Date.now() }); });
    expect(banner()).not.toBeNull();
    await watch(6000 + 400 + SETUP_CARD_QUIET_MS - 500);
    expect(seen).not.toContain(true);

    await watch(1000);
    expect(seen.at(-1)).toBe(true);
  });


  it('a held slide makes arrivals wait, then they play in full and pause the deck', async () => {
    configure();
    await mountPastFlagship();
    expect(onScreen('Slide A')).toBe(true);

    await tick(5000);
    await settle();
    expect(onScreen('Held poster')).toBe(true);

    await act(async () => { bound.checkin({ firstName: 'Ann', club: 'Sparks', id: 'a1', at: Date.now() }); });
    // Held: no name over the poster, but the room is told someone is coming.
    expect(banner()).toBeNull();
    expect(waiting()?.getAttribute('aria-label')).toBe('1 child waiting to be welcomed');
    // Six quiet seconds later (past BUILD_QUIET_MS) the stage is still empty,
    // but the line lives only in memory, so a waiting child is a busy screen.
    await tick(6000);
    expect(banner()).toBeNull();
    expect(reloadBusy()).toBe(true);

    // The poster ends: Ann plays at once, on the next slide.
    await tick(4000);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    expect(banner()).not.toBeNull();
    expect(waiting()).toBeNull();

    // Her name pauses the deck: well past Slide B's 5 seconds it is still up.
    await tick(5500);
    await settle();
    expect(banner()).not.toBeNull();
    expect(onScreen('Slide B')).toBe(true);
    expect(onScreen('Slide A')).toBe(false);

    // Her full 6 seconds, then the slide keeps the time it had (none).
    await tick(1000);
    await settle();
    expect(banner()).toBeNull();
    await tick(4000);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    await tick(1500);
    await settle();
    // Round again: the flagship leads every pass, so B is followed by it, not A.
    expect(document.querySelector('.flagship')).not.toBeNull();
    expect(onScreen('Slide A')).toBe(false);
  });

  it('the corner steps aside on a held slide without spending an item there', async () => {
    localStorage.setItem('awanaTally.v1', JSON.stringify({ date: todayKey(), count: 7 }));
    configure();
    await mountPastFlagship();
    await settle();
    // The flagship's load took the clock; Slide A's is the tally.
    expect(cornerIds()).toEqual(['tally']);

    await tick(5000);
    await settle();
    expect(onScreen('Held poster')).toBe(true);
    expect(cornerIds()).toEqual([]);

    // The first ordinary slide after the poster picks up where the corner
    // left off: the clock, which the poster's load would otherwise have eaten.
    await tick(10000);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    expect(cornerIds()).toEqual(['clock']);
  });

  it('the first-run card steps aside for a held slide, like the corner, and comes back after it', async () => {
    configure();
    await mountPastFlagship();
    await settle();
    const card = () => document.querySelector('.setup-card');
    expect(onScreen('Slide A')).toBe(true);
    expect(card()).not.toBeNull();

    // A poster is full-bleed art with its own footer: the card leaves it whole.
    await tick(5000);
    await settle();
    expect(onScreen('Held poster')).toBe(true);
    expect(card()).toBeNull();

    await tick(10000);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    expect(card()).not.toBeNull();
  });

  it('under zero animation the first-run card is back the moment a held slide is gone', async () => {
    // The poster is replaced in one frame, so there is nothing to wait for.
    const card = () => document.querySelector('.setup-card');
    configure();
    await mountPastFlagship();
    await settle();
    await tick(5000);
    await settle();
    expect(onScreen('Held poster')).toBe(true);
    expect(card()).toBeNull();
    // Held's 10 s end at t = 15 s: just before it, then across it.
    await tick(9750);
    expect(card()).toBeNull();
    await tick(500);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    expect(card()).not.toBeNull();
  });

  it('a tally correction reaches the corner with the corrected number, once', async () => {
    localStorage.setItem('awanaTally.v1', JSON.stringify({ date: todayKey(), count: 80 }));
    configure({ manualSlides: [A, B] });
    await mountPastFlagship();
    // Loads run flagship (clock), A (tally), B (clock), flagship (tally), A
    // (clock), B (tally): Slide A is up, showing the tally.
    const tallyChip = () => document.querySelector('.corner-chip--tally');
    const value = () => tallyChip()?.querySelector('[role="img"]').getAttribute('aria-label');
    const note = () => tallyChip()?.querySelector('.corner-chip__note')?.textContent ?? null;
    expect(value()).toBe('TONIGHT 80');

    // An 80 → 83 catch-up lands while the tally is up. The chip is frozen
    // until the next load, so it must not explain a number it is not showing.
    await act(async () => { bound.tally({ counts: { Sparks: 83 }, total: 83, at: Date.now() }); });
    expect(value()).toBe('TONIGHT 80');
    expect(note()).toBeNull();

    // The next time the tally comes round (past any few-second timer), it
    // shows the corrected number, explained...
    await tick(10000);
    expect(value()).toBe('TONIGHT 83');
    expect(note()).toBe('synced with the check-in desk');

    // ...and the time after that it is an ordinary one.
    await tick(15000);
    expect(value()).toBe('TONIGHT 83');
    expect(note()).toBeNull();
  });

  it('a drop (children checking out) lowers the corner without a "synced" note', async () => {
    localStorage.setItem('awanaTally.v1', JSON.stringify({ date: todayKey(), count: 40 }));
    configure({ manualSlides: [A, B] });
    await mountPastFlagship();
    const tallyChip = () => document.querySelector('.corner-chip--tally');
    const value = () => tallyChip()?.querySelector('[role="img"]').getAttribute('aria-label');
    const note = () => tallyChip()?.querySelector('.corner-chip__note')?.textContent ?? null;
    expect(value()).toBe('TONIGHT 40');
    // Trek and Journey checked out at 7:15: 40 → 28.
    await act(async () => { bound.tally({ counts: { Sparks: 28 }, total: 28, at: Date.now() }); });
    await tick(10000);
    expect(value()).toBe('TONIGHT 28');
    expect(note()).toBeNull();
  });

  it('an idle lobby with nobody waiting may reload', async () => {
    configure();
    await mount();
    await tick(4000);
    expect(reloadBusy()).toBe(false);
  });
  // LAST in the file on purpose: it runs the slideshow with motion on, and an
  // exit that framer-motion had under way when the test ended keeps its frame
  // loop busy for the tests after it in this file (their exits then outlast
  // their fake seconds). Nothing follows it.
  it('with motion, the first-run card waits out the stinger after a held slide before it comes back', async () => {
    // The flag drops when the slideshow moves on, but the poster is on screen
    // until the wave covers the screen, and the wave until it has gone
    // (STINGER_SEC): the card returns after all of that, not before.
    const card = () => document.querySelector('.setup-card');
    configure({ reduceMotion: false });
    await mountPastFlagship();
    await settle();
    await tick(5000);
    await settle();
    expect(card()).toBeNull();
    await tick(9750);
    expect(card()).toBeNull();
    await tick(500);
    await settle();
    expect(onScreen('Slide B')).toBe(true);
    // Just past the swap the wave is still on its way off the top of the screen.
    expect(card()).toBeNull();
    await tick(Math.ceil(STINGER_SEC * 1000) - 750);
    expect(card()).toBeNull();
    await tick(1000);
    expect(card()).not.toBeNull();
  });

});

// Inside the Journey kiosk's iframe, Journey keeps its own buttons in one
// column in this page's bottom-right corner (src/lib/embed.js). The layout
// half is CSS under html.embedded (embed.test.js pins it; e2e/embedded.spec.js
// measures it in Chromium); this pins what App decides, and that the
// top-right, which is ours, is decided exactly as it is standalone.
describe('embedded in the Journey kiosk\'s frame', { timeout: 20_000 }, () => {
  const framed = () => vi.stubGlobal('top', { name: 'the Journey kiosk' });
  const html = () => document.documentElement.classList.contains('embedded');

  it('marks <html> embedded only while framed, and never standalone', async () => {
    configure();
    await mount();
    expect(html()).toBe(false);
    cleanup();

    framed();
    bound = {};
    configure();
    await mount();
    expect(html()).toBe(true);
    cleanup();
    expect(html()).toBe(false);
  });

  // (jsdom has no ResizeObserver, so the sticker's measured height never
  // reads tall: this is the short-sticker case.)
  it.each([[false], [true]])('framed %s: with a short problem sticker up, the WAITING chip keeps the top slot', async (isFramed) => {
    if (isFramed) framed();
    configure({ showConnectionStatus: true });
    await mountPastFlagship();
    await tick(5000);
    await settle();
    expect(onScreen('Held poster')).toBe(true);
    expect(document.querySelector('.corner-stack .status-dot')).not.toBeNull();

    await act(async () => { bound.checkin({ firstName: 'Ann', club: 'Sparks', id: 'e1', at: Date.now() }); });
    expect(waiting()?.closest('.corner-top')).not.toBeNull();
  });
});
