// Records a real page frame by frame on a virtual clock, so the footage is a
// smooth, exact 60 fps however long each frame takes to draw.
//
// How: Playwright's fake clock owns Date, performance.now and every timer;
// this file adds the two things it does not own.
//   1. requestAnimationFrame is a queue that runs once per recorded frame,
//      at the frame's own time (Playwright's fake rAF ticks on a 16 ms grid,
//      which beats against 60 fps).
//   2. Animations on the document timeline (CSS animations and transitions,
//      and any element.animate()) are paused and seeked to the frame's time.
//      framer-motion is kept off that timeline altogether: it uses the Web
//      Animations API only when Element.prototype owns `animate`, so the
//      method is moved down to HTMLElement and SVGElement (where any other
//      caller still finds it) and framer-motion animates on the main thread,
//      on the queue above. canvas-confetti is kept on the main thread the same
//      way (no transferControlToOffscreen, so no worker with its own clock).
// The page cannot tell any of this from a fast machine.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRINTER = path.resolve(HERE, '..', '..');

/** playwright-core from this app, else from a sibling app that has it. */
export function loadPlaywright() {
  for (const dir of [PRINTER, path.join(PRINTER, '..', 'journey'), path.join(PRINTER, '..', 'lobby')]) {
    try {
      return createRequire(path.join(dir, 'package.json'))('playwright-core');
    } catch { /* try the next */ }
  }
  throw new Error('playwright-core is not installed: run `npm ci` in printer/');
}

export const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM
  || ['/opt/pw-browsers/chromium'].find((p) => existsSync(p));

export async function launch() {
  const { chromium } = loadPlaywright();
  return chromium.launch({
    executablePath: CHROMIUM,
    args: ['--font-render-hinting=none', '--force-color-profile=srgb', '--hide-scrollbars', '--disable-lcd-text', '--autoplay-policy=no-user-gesture-required'],
  });
}

// Runs in every frame of the page before any of its scripts.
const INIT = `(() => {
  if (window.__reel) return;
  const native = Element.prototype.animate;
  if (native) {
    delete Element.prototype.animate;
    for (const P of [HTMLElement.prototype, SVGElement.prototype]) {
      Object.defineProperty(P, 'animate', { value: native, writable: true, configurable: true });
    }
  }
  try { delete HTMLCanvasElement.prototype.transferControlToOffscreen; } catch (e) {}
  const queue = new Map();
  let nextId = 1, mode = 'free', timer = null, firstSync = false, keepPhase = true;
  const flush = () => {
    timer = null;
    const ts = performance.now();
    const cbs = [...queue.values()];
    queue.clear();
    for (const cb of cbs) { try { cb(ts); } catch (e) { setTimeout(() => { throw e; }); } }
  };
  const raf = (cb) => {
    const id = nextId++;
    queue.set(id, cb);
    if (mode === 'free' && timer == null) timer = setTimeout(flush, 16);
    return id;
  };
  const caf = (id) => { queue.delete(id); };
  for (const [name, fn] of [['requestAnimationFrame', raf], ['cancelAnimationFrame', caf]]) {
    Object.defineProperty(window, name, { configurable: true, enumerable: true, get: () => fn, set: () => {} });
  }
  const starts = new WeakMap();
  const sync = () => {
    const now = performance.now();
    for (const a of document.getAnimations()) {
      let s = starts.get(a);
      if (s === undefined) {
        s = firstSync && keepPhase ? now - (Number(a.currentTime) || 0) : now;
        starts.set(a, s);
      }
      const t = now - s;
      let end = Infinity;
      try { end = a.effect ? a.effect.getComputedTiming().endTime : Infinity; } catch (e) {}
      try {
        if (Number.isFinite(end) && t >= end) { if (a.playState !== 'finished') a.finish(); }
        else { if (a.playState !== 'paused') a.pause(); a.currentTime = t; }
      } catch (e) {}
    }
    firstSync = false;
  };
  window.__reel = {
    capture(fromZero) { mode = 'capture'; firstSync = true; keepPhase = !fromZero; clearTimeout(timer); timer = null; },
    frame() { flush(); sync(); },
  };
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One recorded page.
 * @param {import('playwright-core').Browser} browser
 * @param {{ viewport: {width:number,height:number}, dpr?: number, time: Date|string|number, setup?: (page) => Promise<void> }} opts
 */
export async function openShot(browser, { viewport, dpr = 1, time, setup, paused = false, reducedMotion = 'no-preference', isMobile = false, hasTouch = false }) {
  const context = await browser.newContext({
    viewport, deviceScaleFactor: dpr, timezoneId: 'America/New_York', locale: 'en-US',
    serviceWorkers: 'block', reducedMotion, colorScheme: 'light', isMobile, hasTouch,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.warn(`  [page error] ${String(e).slice(0, 300)}`));
  const start = new Date(time).getTime();
  await page.clock.install({ time: new Date(start - 1000) });
  // Paused from the first instant: the page boots with time standing still,
  // so the first recorded frame is the first frame of every entrance.
  if (paused) await page.clock.pauseAt(new Date(start));
  await page.addInitScript(INIT);
  if (setup) await setup(page);
  const cdp = await context.newCDPSession(page);
  const shot = new Shot(context, page, cdp);
  if (paused) shot.virtual = start;
  return shot;
}

export class Shot {
  constructor(context, page, cdp) {
    this.context = context;
    this.page = page;
    this.cdp = cdp;
    this.virtual = null; // ms since epoch, once capturing
  }

  /** A page that booted paused: switch every frame to recorded frames. */
  async start() {
    if (this.virtual == null) { await this.freeze(); return; }
    this.virtual = await this.page.evaluate(() => Date.now());
    for (const f of this.page.frames()) await f.evaluate(() => window.__reel && window.__reel.capture(true)).catch(() => {});
    await this.frame();
  }

  /** Stop the free-running clock: from here on, time moves only by step(). */
  async freeze() {
    const now = await this.page.evaluate(() => Date.now());
    this.virtual = now + 400;
    await this.page.clock.pauseAt(new Date(this.virtual));
    for (const f of this.page.frames()) await f.evaluate(() => window.__reel && window.__reel.capture()).catch(() => {});
    await this.frame();
  }

  async frame() {
    for (const f of this.page.frames()) await f.evaluate(() => window.__reel && window.__reel.frame()).catch(() => {});
  }

  /** Advance the virtual clock by `ms` (whole ms) and run one frame. */
  async step(ms) {
    await this.page.clock.runFor(ms);
    this.virtual += ms;
    await sleep(2); // let real-time work (React's scheduler, socket frames) land
    await this.frame();
  }

  /** Run `seconds` of virtual time quickly at a coarse frame (no capture). */
  async run(seconds, frameMs = 50) {
    const n = Math.round((seconds * 1000) / frameMs);
    for (let i = 0; i < n; i++) await this.step(frameMs);
  }

  async shoot(file, { quality = 92 } = {}) {
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: false });
    writeFileSync(file, Buffer.from(data, 'base64'));
  }

  /**
   * Record `seconds` at `fps` into `dir/00000.jpg...`. `cues` maps a time in
   * seconds (from the start of this recording) to an async action, run just
   * before the first frame at or after it.
   */
  async record(dir, { seconds, fps = 60, cues = {}, quality = 92 } = {}) {
    mkdirSync(dir, { recursive: true });
    const pending = Object.entries(cues).map(([t, fn]) => [Number(t), fn]).sort((a, b) => a[0] - b[0]);
    const total = Math.round(seconds * fps);
    let elapsed = 0; // whole ms
    for (let i = 0; i < total; i++) {
      const t = i / fps;
      this.t = t;
      while (pending.length && pending[0][0] <= t + 1e-9) {
        const [, fn] = pending.shift();
        await fn(this.page);
        await sleep(40);
      }
      if (i > 0) {
        const target = Math.round((i * 1000) / fps);
        await this.step(target - elapsed);
        elapsed = target;
      }
      await this.shoot(path.join(dir, `${String(i).padStart(5, '0')}.jpg`), { quality });
      if (i % 60 === 0) process.stdout.write(`\r  ${path.basename(dir)} ${i}/${total}`);
    }
    process.stdout.write(`\r  ${path.basename(dir)} ${total}/${total}\n`);
  }

  async close() { await this.context.close(); }
}
