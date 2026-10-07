// Boot public/index.html + public/src/schedule.js inside jsdom, so the real
// page's listeners and helpers can be exercised the way a leader exercises
// them (press the button, read the DOM) rather than by calling internals.
//
// schedule.js is a classic script, so its top-level `function` declarations
// land on `window` and are callable from a test; its `let`/`const` state
// deliberately does not, which is why the assertions below go through the
// DOM and the <video> element instead of poking at variables.
//
// Everything the kiosk's Chromium has and jsdom does not (media playback,
// object URLs, the Cache API) is stubbed here. `caches` is left UNDEFINED on
// purpose: schedule.js feature-checks it, and that is the path a fresh kiosk
// takes before anything has been stored.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const REPO = path.dirname(new URL(import.meta.url).pathname).replace(/\/test$/, '');
const PUBLIC = path.join(REPO, 'public');

// The page's schedule is the Pi's LOCAL time of day (Journey 18:30-19:15), so a
// test that reads the real clock behaves differently inside that window than
// outside it (the suite hung every evening in it). Every boot therefore pins
// the page's Date to a fixed local time OUTSIDE the window; the clock still
// advances in real time from there, so timers and Date.now() deltas work.
// AWANA_TEST_NOW (any Date-parsable string) overrides it for an ad-hoc run.
export const DEFAULT_NOW = new Date(2026, 9, 7, 12, 0, 0).getTime(); // Wed noon, local

export function pinClock(window, nowMs = DEFAULT_NOW) {
  const RealDate = window.Date;
  const offset = nowMs - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  window.Date = PinnedDate;
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// The kiosk this harness boots is the real one: a Raspberry Pi Zero, which
// detectDeviceProfile() reads as the low-power profile. A test that wants the
// page as a Mac or a laptop sees it passes `device` (see below).
export const PI_ZERO = {
  userAgent:
    'Mozilla/5.0 (X11; Linux armv6l) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
  hardwareConcurrency: 1,
};

export const DESKTOP = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  hardwareConcurrency: 8,
};

/**
 * @param routes  url substring -> { json } | { status } | { text }
 * @param prefs   localStorage entries seeded BEFORE schedule.js runs, the way
 *                a kiosk that has been used before comes up
 * @param device  { userAgent, hardwareConcurrency } the machine this page is
 *                running on, defaulting to the kiosk's own Pi Zero
 * @param setup   optional (window) => void, run just before schedule.js, for a
 *                browser capability jsdom lacks that the page reads at startup
 * @param pageUrl the address the page is opened at (a query string such as
 *                ?configure=1 is read by the page itself)
 * @returns { dom, window, document, fetchLog, seeks, video, close }
 */
export function bootKiosk(routes = {}, prefs = {}, device = PI_ZERO, setup = null, pageUrl = 'https://example.test/') {
  const html = readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace(
    '<script src="src/schedule.js"></script>',
    ''
  );
  const dom = new JSDOM(html, {
    url: pageUrl,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    userAgent: device.userAgent,
  });
  const { window } = dom;
  // jsdom reports 4 cores whatever it is pretending to be, and the page reads
  // this to tell a Pi from a laptop.
  Object.defineProperty(window.navigator, 'hardwareConcurrency', {
    get: () => device.hardwareConcurrency,
    configurable: true,
  });

  const fetchLog = [];
  window.fetch = (url, options = {}) => {
    const href = String(url);
    fetchLog.push({ url: href, method: (options.method || 'GET').toUpperCase() });
    const key = Object.keys(routes).find((k) => href.includes(k));
    const route = key ? routes[key] : { status: 404 };
    if (route.status && route.status >= 400) {
      return Promise.resolve(makeResponse(window, '', route.status));
    }
    const body = 'json' in route ? JSON.stringify(route.json) : route.text || '';
    return Promise.resolve(makeResponse(window, body, 200));
  };

  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};
  window.HTMLMediaElement.prototype.play = function play() {
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function pause() {};

  // jsdom's <video> has no real media, so currentTime is stubbed on the one
  // element the page owns. The seeks array is what the tests read.
  const video = window.document.getElementById('journey-video');
  const seeks = [];
  let currentTime = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => currentTime,
    set: (t) => {
      currentTime = t;
      seeks.push(t);
    },
    configurable: true,
  });
  Object.defineProperty(video, 'duration', { get: () => 600, configurable: true });

  pinClock(window, process.env.AWANA_TEST_NOW ? new Date(process.env.AWANA_TEST_NOW).getTime() : DEFAULT_NOW);

  for (const [key, value] of Object.entries(prefs)) window.localStorage.setItem(key, value);
  if (setup) setup(window);

  const script = window.document.createElement('script');
  script.textContent = readFileSync(path.join(PUBLIC, 'src', 'schedule.js'), 'utf8');
  window.document.body.appendChild(script);

  // schedule.js sets a 15s poll and an hourly refresh; without closing the
  // window those keep the test process alive forever.
  const close = () => window.close();
  return { dom, window, document: window.document, fetchLog, seeks, video, close };
}

/* A Cache API just real enough for the page's use of it: one Map per bucket,
   keyed by absolute URL the way a browser keys it, so store-before-evict can
   be watched and a cached video can be put there by hand. Installed AFTER
   boot on purpose: schedule.js feature-checks `caches` at call time, and
   leaving it undefined at startup is the path a fresh kiosk takes. */
export function installCaches(window) {
  const buckets = new Map();
  const abs = (key) => new window.URL(String(key), 'https://example.test/').href;
  const bucket = (name) => {
    if (!buckets.has(name)) buckets.set(name, new Map());
    return buckets.get(name);
  };
  const open = async (name) => {
    const store = bucket(name);
    return {
      match: async (key) => store.get(abs(key)),
      put: async (key, response) => {
        store.set(abs(key), response);
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (request) => store.delete(abs(request.url || request)),
    };
  };
  window.caches = {
    open,
    match: async (key) => {
      for (const store of buckets.values()) {
        const hit = store.get(abs(key));
        if (hit) return hit;
      }
      return undefined;
    },
  };
  return { buckets, keysIn: (name) => [...bucket(name).keys()] };
}

function makeResponse(window, body, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    blob: () => Promise.resolve(new window.Blob([body])),
  };
}
