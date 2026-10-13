// The phone remote from the kiosk's side (src/schedule/28-phone-remote.js and
// public/src/sync.js; owner 2026-10-13: "Doing it on the phone should advance
// the slide for all"). Each press runs through the page's own functions and
// reports how it went; what the screen shows is reported only while a phone
// is watching, and NOTHING extra is sent when nobody is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootKiosk, tick, pinClock, DESKTOP, KIOSK_PC } from './kiosk-dom.mjs';
import { JOURNEY_REMOTE_ACTIONS, sanitizeJourneyNow } from '../../lobby/shared/journeyRemote.js';
import * as sp from '../../lobby/shared/sync-protocol.js';
import * as cc from '../../lobby/shared/cloud-crypto.js';

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(REPO, 'public');
const json = (rel) => JSON.parse(readFileSync(path.join(PUBLIC, rel), 'utf8'));
const LESSONS = json('lessons.json');
const SLIDES = json('teaching-slides.json');
const CURRENT = json('current-lesson.json');
const ROUTES = {
  'current-lesson.json': { json: CURRENT },
  'lessons.json': { json: LESSONS },
  'teaching-slides.json': { json: SLIDES },
  'current-lesson-video.mp4': { text: '' },
};
const ANSWERED = { 'journey.captions': 'off' };
const NOON = new Date(2026, 9, 7, 12, 0, 0).getTime();
const SYNC_JS = readFileSync(path.join(PUBLIC, 'src', 'sync.js'), 'utf8');
const SERVICE = 'https://awana-sync.test.workers.dev';
const SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';

const ticks = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shown = (el) => !el.classList.contains('hidden');

/* A <video> whose play()/pause() move `paused`, as a browser's does. */
function mediaSetup(window) {
  window.matchMedia = (query) => ({ matches: /prefers-reduced-motion:\s*reduce/.test(query), media: query, addEventListener() {}, removeEventListener() {} });
  window.journeyIntroTiming = { cardsAt: [0, 10, 20, 30], minMs: 40, holdMaxMs: 80, pollMs: 10 };
  const video = window.document.getElementById('journey-video');
  let paused = true;
  Object.defineProperty(video, 'paused', { get: () => paused, configurable: true });
  Object.defineProperty(video, 'readyState', { get: () => 4, configurable: true });
  window.HTMLMediaElement.prototype.play = function play() { paused = false; this.dispatchEvent(new window.Event('play')); return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function pause() { paused = true; this.dispatchEvent(new window.Event('pause')); };
}

async function boot({ device = KIOSK_PC, prefs = ANSWERED, pageUrl } = {}) {
  const k = bootKiosk(ROUTES, prefs, device, (window) => { pinClock(window, NOON); mediaSetup(window); }, pageUrl);
  // Slide pictures decode a moment after a step: let them land before the window goes.
  const close = k.close;
  k.close = () => sleep(30).then(close);
  await ticks(10);
  const $ = (id) => k.document.getElementById(id);
  const press = (action, data, id) => k.window.journeyRemote.command({ action, data, id });
  const now = () => JSON.parse(JSON.stringify(sanitizeJourneyNow(k.window.journeyRemote.now())));
  return { k, $, press, now };
}

test('the kiosk takes exactly the phone\'s eleven actions, in both of its files', () => {
  const part = readFileSync(path.join(REPO, 'src', 'schedule', '28-phone-remote.js'), 'utf8');
  const fromPart = JSON.parse(/const REMOTE_COMMANDS = (\[[^\]]*\]);/.exec(part)[1].replace(/'/g, '"'));
  const fromSync = JSON.parse(/var PHONE_ACTIONS = (\[[^\]]*\]);/.exec(SYNC_JS)[1].replace(/'/g, '"'));
  assert.deepEqual(fromPart, [...JOURNEY_REMOTE_ACTIONS]);
  assert.deepEqual(fromSync, [...JOURNEY_REMOTE_ACTIONS]);
});

test('Next and Back step the slides through the page\'s own functions, and the report follows', async () => {
  const { k, $, press, now } = await boot();
  try {
    assert.equal(press('slide-next', undefined, 'r1'), false, 'nothing to step yet');
    assert.deepEqual(now().last, { id: 'r1', action: 'slide-next', ok: false, reason: 'no-slides' });
    assert.equal(now().view, 'checkin');

    assert.equal(press('slides-start', undefined, 'r2'), true, 'from the Check-in Display: this week\'s slides');
    await ticks();
    assert.equal(shown($('slides-view')), true);
    const total = k.window.buildSlideItems(CURRENT.week).length;
    assert.equal($('slide-counter').textContent, `Slide 1 of ${total}`);
    assert.equal(press('slide-prev'), false);
    assert.equal(now().last.reason, 'first-slide');
    assert.equal(press('slides-start'), false);
    assert.equal(now().last.reason, 'already');

    press('slide-next');
    press('slide-next');
    assert.equal($('slide-counter').textContent, `Slide 3 of ${total}`, 'two presses, two steps');
    let report = now();
    assert.equal(report.view, 'slides');
    assert.equal(report.week, CURRENT.week);
    assert.equal(report.title, LESSONS.lessons.find((l) => l.week === CURRENT.week).title);
    assert.deepEqual(report.slide, { n: 3, of: total, kind: 'misconception', heading: null, lines: [] });
    press('slide-prev');
    assert.equal($('slide-counter').textContent, `Slide 2 of ${total}`);

    // On to the questions slide: its lines are the very questions on the wall.
    while (now().slide.kind !== 'questions') press('slide-next');
    report = now();
    assert.equal(report.slide.heading, 'Talk About It');
    assert.deepEqual(report.slide.lines, SLIDES.weeks[String(CURRENT.week)].notes.questions);
    assert.deepEqual([...$('slide-template-bullets').children].map((li) => li.textContent), report.slide.lines);
  } finally {
    await k.close();
  }
});

test('an edited bullet on this kiosk is what the report carries (the phone then hides its sample answers)', async () => {
  const week = CURRENT.week;
  const edited = ['Our own question?'];
  const { k, press, now } = await boot({ prefs: { ...ANSWERED, 'journey.slides.notesOverride': JSON.stringify({ [week]: { questions: edited } }) } });
  try {
    press('slides-start');
    await ticks();
    while (now().slide.kind !== 'questions') press('slide-next');
    assert.deepEqual(now().slide.lines, edited);
  } finally {
    await k.close();
  }
});

test('Begin on the splash, then Play/Pause, ±15 s and Mute act on the video; the report says where it is', async () => {
  const { k, $, press, now } = await boot();
  try {
    assert.equal(press('begin'), false);
    assert.equal(now().last.reason, 'not-splash');
    k.window.setView('journey');
    await ticks();
    assert.equal(now().view, 'splash');
    assert.equal(press('play'), false);
    assert.equal(now().last.reason, 'no-video');
    assert.equal(press('begin', undefined, 'go'), true);
    await ticks(10);
    for (let i = 0; i < 40 && now().view !== 'video'; i += 1) await sleep(10);
    assert.equal(now().view, 'video', 'the intro ran and the video is up');
    assert.equal(k.video.hasAttribute('src'), true);
    // The KVBC Awana app grants autoplay, so a phone's Begin plays with sound.
    assert.equal(k.video.muted, false);
    assert.equal(press('begin'), false);
    assert.equal(now().last.reason, 'already');

    assert.equal(press('pause'), true);
    assert.equal(k.video.paused, true);
    assert.equal(press('pause'), false, 'already paused');
    assert.equal(press('toggle-pause'), true);
    assert.equal(k.video.paused, false);
    assert.equal(press('play'), false);
    assert.equal(now().last.reason, 'already');

    k.video.currentTime = 100;
    k.seeks.length = 0;
    assert.equal(press('seek', { by: 15 }), true);
    assert.equal(press('seek', { by: -900 }), true, 'clamped to 15 back');
    assert.deepEqual(k.seeks, [115, 100]);
    assert.equal(press('seek', { by: 0 }), false);

    assert.equal(press('mute'), true);
    assert.equal(k.video.muted, true);
    assert.equal(press('unmute'), true);
    assert.equal(k.video.muted, false);
    const report = now();
    assert.deepEqual(report.video, { t: 100, d: 600, paused: false, muted: false });
    assert.equal(report.week, CURRENT.week);

    // "Start teaching slides" while the video is up = the → handoff.
    assert.equal(press('slides-start'), true);
    assert.equal(now().view, 'slides');
    assert.equal(k.video.hasAttribute('src'), false, 'the video is let go, as → does');
  } finally {
    await k.close();
  }
});

test('a plain browser: a phone press is not a tap, so the video stays muted and Unmute says why', async () => {
  const { k, press, now } = await boot({ device: DESKTOP });
  try {
    k.window.setView('journey');
    await ticks();
    press('begin');
    for (let i = 0; i < 40 && now().view !== 'video'; i += 1) await sleep(10);
    assert.equal(now().view, 'video');
    assert.equal(k.video.muted, true, 'no gesture on this page: muted, as the browser requires');
    assert.equal(press('unmute'), false);
    assert.equal(now().last.reason, 'sound-blocked');
    assert.equal(k.video.muted, true);
    // Someone taps the screen (the corner toggle is a real press): now it may.
    k.window.document.getElementById('unmute-btn').click();
    assert.equal(k.video.muted, false);
  } finally {
    await k.close();
  }
});

test('a pick: checked like the configure relay, and never over a running lesson without force', async () => {
  const { k, $, press, now } = await boot();
  try {
    assert.equal(press('pick', { week: 99, choice: 'slides' }), false);
    assert.equal(now().last.reason, 'unknown-week');
    const noLeader = LESSONS.lessons.find((l) => !l.leaderDownloadUrl).week;
    assert.equal(press('pick', { week: noLeader, choice: 'leader' }), false);
    assert.equal(now().last.reason, 'no-leader');
    assert.equal(press('pick', { week: 3, choice: 'teaching-slides' }), false);

    assert.equal(press('pick', { week: 3, choice: 'slides' }), true, 'nothing running: done at once');
    await ticks();
    assert.equal(now().view, 'slides');
    assert.equal(now().week, 3);
    assert.equal(now().preview, true);

    assert.equal(press('pick', { week: 4, choice: 'slides' }), false, 'a lesson is up');
    assert.equal(now().last.reason, 'lesson-running');
    assert.equal(now().week, 3);
    assert.equal(press('pick', { week: 4, choice: 'slides', force: true }), true, 'after the phone\'s confirm tap');
    await ticks();
    assert.equal(now().week, 4);
    assert.equal(shown($('settings-panel')), false);
  } finally {
    await k.close();
  }
});

test('Settings open, a handout open, or the caption question: the press waits for a person at the screen', async () => {
  const { k, $, press, now } = await boot();
  try {
    press('slides-start');
    await ticks();
    $('settings-btn').click();
    assert.equal(now().wait, 'settings');
    assert.equal(press('slide-next'), false);
    assert.equal(now().last.reason, 'settings-open');
    assert.equal($('slide-counter').textContent.startsWith('Slide 1 '), true);
    k.window.closeSettingsPanel();
    assert.equal(press('slide-next'), true);
    // A reading overlay (a handout, Read Prep) over the room: the same.
    $('handout-view').classList.remove('hidden');
    assert.equal(now().wait, 'reader');
    assert.equal(press('slide-next'), false);
    assert.equal(now().last.reason, 'reader-open');
    assert.equal(press('pick', { week: 3, choice: 'slides' }), false, 'a pick waits for it too');
    assert.equal(now().last.reason, 'reader-open');
    $('handout-view').classList.add('hidden');
  } finally {
    await k.close();
  }
  // The caption question (a kiosk that never answered it).
  const fresh = await boot({ prefs: {} });
  try {
    fresh.k.window.setView('journey');
    await ticks();
    fresh.press('begin');
    await ticks(10);
    assert.equal(fresh.now().wait, 'captions');
    assert.equal(fresh.press('play'), false);
    assert.equal(fresh.now().last.reason, 'captions-question');
  } finally {
    await fresh.k.close();
  }
});

test('a pick waits for a person at the screen like every press: Settings, a handout, the caption question, confirmed or not', async () => {
  const { k, $, press, now } = await boot();
  try {
    // Settings open over the Check-in Display: nothing running, and still skipped.
    $('settings-btn').click();
    assert.equal(press('pick', { week: 3, choice: 'slides' }), false);
    assert.equal(now().last.reason, 'settings-open');
    assert.equal(press('pick', { week: 3, choice: 'slides', force: true }), false, 'the confirm tap does not close Settings');
    assert.equal(now().last.reason, 'settings-open');
    assert.equal(shown($('settings-panel')), true, 'left for the person at the screen');
    assert.equal(shown($('slides-view')), false);
    k.window.closeSettingsPanel();
    // A handout open over the room: skipped, confirmed or not, and left open.
    $('handout-view').classList.remove('hidden');
    assert.equal(press('pick', { week: 3, choice: 'slides', force: true }), false);
    assert.equal(now().last.reason, 'reader-open');
    assert.equal(shown($('handout-view')), true);
    assert.equal(shown($('slides-view')), false);
    $('handout-view').classList.add('hidden');
    // Nothing in the way: the pick runs.
    assert.equal(press('pick', { week: 3, choice: 'slides' }), true);
    await ticks();
    assert.equal(now().view, 'slides');
  } finally {
    await k.close();
  }
  // The caption question (a kiosk that never answered it).
  const fresh = await boot({ prefs: {} });
  try {
    fresh.k.window.setView('journey');
    await ticks();
    fresh.press('begin');
    await ticks(10);
    assert.equal(fresh.now().wait, 'captions');
    assert.equal(fresh.press('pick', { week: 4, choice: 'slides', force: true }), false);
    assert.equal(fresh.now().last.reason, 'captions-question');
    assert.equal(fresh.now().wait, 'captions', 'the question is still up');
  } finally {
    await fresh.k.close();
  }
});

test('configure mode never runs a press', async () => {
  const { k, press } = await boot({ pageUrl: 'https://example.test/?configure=1' });
  try {
    assert.equal(press('slides-start'), false);
    assert.equal(shown(k.document.getElementById('slides-view')), false);
  } finally {
    await k.close();
  }
});

/* ── sync.js: the Worker side of the kiosk ── */

function bootSynced({ watch = false, onNow = null } = {}) {
  const calls = [];
  const state = { watch, queue: [] };
  return boot().then(({ k, $, now }) => {
    const { window } = k;
    window.journeyAuthModules = { sp, cc };
    window.journeyScreenTuning = { helloMs: 60_000, nowGapMs: 60, playingMs: 400, pollGapMs: 10, bellGapMs: 30 };
    window.localStorage.setItem('awanaSyncSession.v1', SESSION);
    const inner = window.fetch;
    const reply = (status, body) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
    window.fetch = (u, init = {}) => {
      const href = String(u);
      if (href.endsWith('/shared/sync.json')) return reply(200, { url: SERVICE });
      if (!href.startsWith(SERVICE)) return inner(u, init);
      const route = href.slice(SERVICE.length);
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ route, body });
      if (route === '/v1/state') return reply(200, { journey: null });
      if (route === '/v1/journey') return reply(200, { savedAt: '2026-10-13T19:00:00.000Z', settings: body.settings });
      if (route === '/v1/screens/hello') {
        const remote = state.queue; state.queue = [];
        return reply(200, { screen: { id: body.id, kind: 'journey', name: 'Journey kiosk' }, settings: null, actions: [], remote, watch: state.watch });
      }
      if (route === '/v1/screens/now') {
        if (onNow) onNow(body);
        const actions = state.queue; state.queue = [];
        return reply(200, { actions, watch: state.watch, hello: false });
      }
      if (/\/settings$/.test(route)) return reply(200, { savedAt: '2026-10-13T19:00:00.000Z', settings: body.settings, dropped: [] });
      return reply(404, {});
    };
    const script = window.document.createElement('script');
    script.textContent = SYNC_JS;
    window.document.body.appendChild(script);
    const nows = () => calls.filter((c) => c.route === '/v1/screens/now');
    const hellos = () => calls.filter((c) => c.route === '/v1/screens/hello');
    const ring = () => {
      const id = JSON.parse(window.localStorage.getItem('awanaScreens.v1')).journey.id;
      const frame = window.document.querySelector('#checkin-view iframe');
      window.dispatchEvent(new window.MessageEvent('message', {
        data: { type: 'awana-display:sync-doorbell', what: 'screen-action', id }, source: frame.contentWindow, origin: window.location.origin,
      }));
    };
    return { k, $, now, calls, state, nows, hellos, ring };
  });
}

test('nobody watching: the screen changing sends nothing at all', async () => {
  const s = await bootSynced({ watch: false });
  try {
    for (let i = 0; i < 40 && !s.hellos().length; i += 1) await sleep(10);
    assert.equal(s.hellos().length, 1, 'the usual hello at start');
    const before = s.calls.length;
    s.k.window.journeyRemote.command({ action: 'slides-start' });
    s.k.window.nextSlide();
    s.k.window.nextSlide();
    s.k.window.setView('checkin');
    await sleep(300);
    assert.equal(s.calls.length, before, 'no request for any of it');
  } finally {
    await s.k.close();
  }
});

test('a phone watching: the report goes at once, then on each change (never twice within the gap), and one timed poll every few seconds', async () => {
  const sent = [];
  const s = await bootSynced({ watch: true, onNow: (body) => { if (body.now) sent.push(body.now); } });
  try {
    for (let i = 0; i < 40 && !sent.length; i += 1) await sleep(10);
    assert.equal(sent.length, 1, 'the hello said a phone is watching: the report goes at once');
    assert.equal(sent[0].view, 'checkin');
    assert.ok(sanitizeJourneyNow(sent[0]), 'in the Worker\'s shape');

    s.k.window.journeyRemote.command({ action: 'slides-start' });
    s.k.window.nextSlide();
    s.k.window.nextSlide();
    await sleep(200);
    const last = sent.at(-1);
    assert.equal(last.view, 'slides');
    assert.equal(last.slide.n, 3, 'the newest state');
    assert.ok(sent.length <= 3, `bursts are folded together (${sent.length} reports)`);
    const n = sent.length;
    await sleep(150);
    assert.equal(sent.length, n, 'nothing changed: nothing sent before the next timed poll');

    // While watched, one poll every playingMs: a playing video's position goes up.
    s.k.window.startPreview('videos/week-06-student.mp4', 'Week 6', null, 6);
    await sleep(100);
    const m = sent.length;
    await sleep(1000);
    assert.ok(sent.length >= m + 2 && sent.length <= m + 4, `heartbeats while watched (${sent.length - m})`);
    assert.equal(sent.at(-1).view, 'video');

    // The phone went away: the next answer says so, and the reports stop.
    s.state.watch = false;
    await sleep(500);
    const p = sent.length;
    s.k.window.journeyRemote.command({ action: 'pause' });
    await sleep(900);
    assert.equal(sent.length, p, 'no phone, no reports');
  } finally {
    await s.k.close();
  }
});

test('the doorbell collects the phone\'s presses at once; each press id runs once; only the allowlisted', async () => {
  const s = await bootSynced({ watch: true });
  try {
    for (let i = 0; i < 40 && !s.nows().length; i += 1) await sleep(10);
    s.state.queue = [
      { id: 'p1', action: 'slides-start', at: '2026-10-13T19:00:00Z' },
      { id: 'p2', action: 'slide-next', at: '2026-10-13T19:00:00Z' },
      { id: 'p2', action: 'slide-next', at: '2026-10-13T19:00:00Z' }, // the same press twice: once
      { id: 'p3', action: 'format-disk', at: '2026-10-13T19:00:00Z' },
      'junk',
    ];
    const before = s.nows().length;
    s.ring();
    s.ring(); // a burst of rings is one poll
    for (let i = 0; i < 40 && s.nows().length === before; i += 1) await sleep(10);
    await sleep(50);
    assert.equal(s.$('slide-counter').textContent.startsWith('Slide 2 '), true);
    // A press handed over again (say, by a hello) is not run twice.
    s.state.queue = [{ id: 'p2', action: 'slide-next' }];
    await s.k.window.journeySync.hello();
    await ticks();
    assert.equal(s.$('slide-counter').textContent.startsWith('Slide 2 '), true);
    // A new one through the hello's answer is run.
    s.state.queue = [{ id: 'p4', action: 'slide-next' }];
    await s.k.window.journeySync.hello();
    await ticks();
    assert.equal(s.$('slide-counter').textContent.startsWith('Slide 3 '), true);
    for (let i = 0; i < 40 && s.nows().at(-1).body.now?.last?.id !== 'p4'; i += 1) await sleep(10);
    assert.deepEqual(s.nows().at(-1).body.now.last, { id: 'p4', action: 'slide-next', ok: true, reason: null });
  } finally {
    await s.k.close();
  }
});
