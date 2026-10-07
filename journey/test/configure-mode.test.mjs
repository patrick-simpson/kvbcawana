// Configure mode (?configure=1): the sound room app's Settings window opens
// this page beside the live kiosk, in the same browser profile. There the page
// is only the Settings panel, which never closes, runs nothing of the kiosk
// (above all, never loads the Check-in Display frame), and relays what would
// act on the screen over the 'awana-configure' BroadcastChannel. The live
// kiosk obeys a relay only for a lesson it knows, and takes settings saved by
// another window through its storage listener.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, PI_ZERO } from './kiosk-dom.mjs';

const LESSONS = {
  version: 1,
  lessons: [
    {
      week: 3,
      unit: 1,
      lesson: 3,
      title: 'Unit 1, Lesson 3: Truth',
      downloadUrl: 'https://clubs.awana.org/student-3.mp4',
      leaderDownloadUrl: 'https://clubs.awana.org/leader-3.mp4',
      captions: { student: false, leader: false },
    },
    {
      week: 27,
      unit: 7,
      lesson: 3,
      title: 'Unit 7, Lesson 3: Suffering',
      downloadUrl: 'https://clubs.awana.org/student-27.mp4',
      leaderDownloadUrl: null,
      captions: { student: false, leader: false },
    },
  ],
};

const CURRENT = {
  version: 2,
  week: 27,
  title: 'Unit 7, Lesson 3: Suffering',
  sourceUrl: 'https://cdn.awana.example/student-27-original.mp4',
  downloadUrl: 'current-lesson-video.mp4',
  transcodedAt: '2026-09-15T04:00:00Z',
};

const ROUTES = {
  'current-lesson.json': { json: CURRENT },
  'lessons.json': { json: LESSONS },
};
const ANSWERED = { 'journey.captions': 'off' };
const CONFIGURE_URL = 'https://example.test/?configure=1';

const ticks = async (n = 8) => {
  for (let i = 0; i < n; i += 1) await tick();
};

/* A BroadcastChannel stand-in, installed before schedule.js runs: it records
   every channel the page opens and every message the page posts, and lets a
   test deliver a message to the page's own listener. */
function fakeChannels(window) {
  const opened = [];
  const posted = [];
  window.BroadcastChannel = class {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this.closed = false;
      opened.push(this);
    }
    postMessage(data) {
      posted.push({ name: this.name, data: JSON.parse(JSON.stringify(data)) });
    }
    close() {
      this.closed = true;
    }
  };
  const deliver = (data) => {
    for (const ch of opened) {
      if (!ch.closed && ch.name === 'awana-configure' && ch.onmessage) ch.onmessage({ data });
    }
  };
  return { opened, posted, deliver };
}

function bootConfigure() {
  let channels;
  const kiosk = bootKiosk(ROUTES, ANSWERED, PI_ZERO, (w) => { channels = fakeChannels(w); }, CONFIGURE_URL);
  return { ...kiosk, channels };
}

function bootLive(prefs = ANSWERED) {
  let channels;
  const kiosk = bootKiosk(ROUTES, prefs, PI_ZERO, (w) => { channels = fakeChannels(w); });
  return { ...kiosk, channels };
}

const hidden = (doc, id) => doc.getElementById(id).classList.contains('hidden');

test('configure mode is the Settings panel alone, open from load, and nothing of the kiosk runs', async () => {
  const k = bootConfigure();
  try {
    await ticks();
    const doc = k.document;
    assert.ok(doc.documentElement.classList.contains('configure-mode'));
    assert.equal(hidden(doc, 'settings-panel'), false, 'the panel is open from load');
    // The Check-in Display frame never loads: it is gone before schedule.js runs.
    assert.equal(doc.getElementById('checkin-frame'), null);
    assert.equal(doc.querySelectorAll('iframe[src*="lobby"]').length, 0);
    // No layer is shown, no splash, no video.
    assert.equal(hidden(doc, 'journey-view'), true);
    assert.equal(hidden(doc, 'journey-splash'), true);
    assert.equal(k.video.hasAttribute('src'), false);
    assert.equal(doc.documentElement.classList.contains('cursor-hidden'), false, 'the pointer stays');
    // Only the panel's data was read: no video, no bundle, no prep, no probe.
    const urls = k.fetchLog.map((f) => f.url);
    assert.ok(urls.some((u) => u.includes('lessons.json')), 'the lesson list loads');
    assert.ok(urls.some((u) => u.includes('current-lesson.json')), 'tonight\'s week is read');
    assert.equal(urls.filter((u) => /\.mp4|transcripts\/|handouts\/|slides\/week-|leader-prep\.json|version\.json/.test(u)).length, 0, urls.join(', '));
    assert.equal(k.fetchLog.filter((f) => f.method === 'HEAD').length, 0);
    // The list rendered, with tonight's week marked.
    assert.equal(doc.querySelectorAll('.settings-lesson-row').length, 2);
    assert.match(doc.querySelector('.settings-lesson-current').textContent, /Week 27/);
    // A kiosk's channel listener is the live screen's, not this page's.
    assert.equal(k.channels.opened.filter((c) => c.onmessage).length, 0);
  } finally {
    k.close();
  }
});

test('configure mode: the panel cannot be closed, by button, backdrop, Escape or the idle timer', async () => {
  const k = bootConfigure();
  try {
    await ticks();
    const { window, document: doc } = k;
    const close = doc.getElementById('settings-close-btn');
    assert.equal(close.hidden, true, 'no close button');
    close.click();
    doc.getElementById('settings-backdrop').click();
    doc.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
    assert.equal(hidden(doc, 'settings-panel'), false);
    assert.equal(JSON.stringify(window.idleWatch(Date.now() + 60 * 60 * 1000)), JSON.stringify([]));
    assert.equal(hidden(doc, 'settings-panel'), false, 'an hour untouched: still open');
  } finally {
    k.close();
  }
});

test('configure mode: a pick is relayed to the live kiosk, never played here', async () => {
  const k = bootConfigure();
  try {
    await ticks();
    const doc = k.document;
    doc.querySelectorAll('.settings-lesson-row')[0].click(); // week 3
    doc.getElementById('settings-variant-student').click();
    doc.getElementById('settings-student-video').click();
    assert.deepEqual(k.channels.posted, [
      { name: 'awana-configure', data: { screen: 'journey', action: 'pick', data: { week: 3, choice: 'student' } } },
    ]);
    assert.ok(k.channels.opened.every((c) => c.closed), 'the sending channel is closed again');
    // Nothing happened on this page, and the panel is back on the list.
    assert.equal(hidden(doc, 'settings-panel'), false);
    assert.equal(hidden(doc, 'settings-lesson-list'), false);
    assert.equal(hidden(doc, 'journey-view'), true);
    assert.equal(k.video.hasAttribute('src'), false);
    assert.match(doc.getElementById('settings-preview-note').textContent, /Sent to the Journey screen: Week 3, Student Video\./);

    // The handout and the preps open over the kiosk's wall too, so they relay.
    doc.querySelectorAll('.settings-lesson-row')[0].click();
    doc.getElementById('settings-variant-leader').click();
    doc.getElementById('settings-leader-handout').click();
    assert.equal(hidden(doc, 'handout-view'), true, 'no handout opens here');
    assert.deepEqual(k.channels.posted.at(-1).data.data, { week: 3, choice: 'handout' });
  } finally {
    k.close();
  }
});

test('the live kiosk plays a relayed pick only for a lesson it knows', async () => {
  const k = bootLive();
  try {
    await ticks();
    const { window, document: doc } = k;
    const live = k.channels.opened.find((c) => c.name === 'awana-configure' && c.onmessage);
    assert.ok(live, 'the live kiosk listens on awana-configure');

    // Ignored: another screen, an unknown action, an unknown week, a bad
    // shape, a choice that is not the picker's, a Leader pick for week 27.
    const ignored = [
      { screen: 'lobby', action: 'pick', data: { week: 3, choice: 'student' } },
      { screen: 'journey', action: 'reload', data: { week: 3, choice: 'student' } },
      { screen: 'journey', action: 'pick', data: { week: 99, choice: 'student' } },
      { screen: 'journey', action: 'pick', data: { week: '3', choice: 'student' } },
      { screen: 'journey', action: 'pick', data: { week: 3, choice: 'toString' } },
      { screen: 'journey', action: 'pick', data: { week: 27, choice: 'leader' } },
      { screen: 'journey', action: 'pick', data: null },
      null,
    ];
    for (const m of ignored) assert.equal(window.handleConfigureRelay(m), false, JSON.stringify(m));
    k.channels.deliver({ screen: 'projector', action: 'pick', data: { week: 3, choice: 'student' } });
    await ticks();
    assert.equal(hidden(doc, 'journey-view'), true, 'still the Check-in Display');
    assert.equal(k.video.hasAttribute('src'), false);

    // A known lesson, through the channel itself: the same preview the
    // picker's own button starts.
    window.openSettingsPanel();
    k.channels.deliver({ screen: 'journey', action: 'pick', data: { week: 3, choice: 'student' } });
    await ticks();
    assert.equal(hidden(doc, 'settings-panel'), true, 'the kiosk\'s own panel closes, as the button does');
    assert.equal(hidden(doc, 'journey-view'), false);
    assert.match(k.video.getAttribute('src') || '', /videos\/week-03-student\.mp4$/);
  } finally {
    k.close();
  }
});

test('the live kiosk takes caption and quality settings saved by another window, live', async () => {
  const k = bootLive();
  try {
    await ticks();
    const { window, document: doc } = k;
    const root = doc.documentElement;
    assert.equal(root.style.getPropertyValue('--caption-scale'), '1');
    window.localStorage.setItem('journey.captions.size', '1.6');
    window.localStorage.setItem('journey.captions.backdrop', 'on');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'journey.captions.backdrop' }));
    assert.equal(root.style.getPropertyValue('--caption-scale'), '1.6');
    assert.ok(doc.getElementById('caption-overlay').classList.contains('caption-backdrop'));
    assert.equal(doc.getElementById('captions-size').value, '1.6');
    assert.equal(doc.getElementById('captions-backdrop').checked, true);

    // The quality choice is cached per page load: the event must drop it.
    const frame = doc.getElementById('checkin-frame');
    assert.match(frame.getAttribute('src'), /lowPower=1/);
    window.localStorage.setItem('journey.playback.quality', 'full');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'journey.playback.quality' }));
    assert.doesNotMatch(frame.getAttribute('src'), /lowPower/);
    assert.equal(doc.getElementById('quality-full').getAttribute('aria-pressed'), 'true');

    // Slides preferences re-sync their inputs.
    window.localStorage.setItem('journey.slides.autoAdvanceSec', '30');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'journey.slides.autoAdvanceSec' }));
    assert.equal(doc.getElementById('slides-auto-advance').value, '30');

    // Anyone else's key (the embedded lobby writes this storage) is ignored.
    window.localStorage.setItem('journey.captions.size', '0.8');
    window.dispatchEvent(new window.StorageEvent('storage', { key: 'awanaConfig.v1' }));
    assert.equal(root.style.getPropertyValue('--caption-scale'), '1.6');
  } finally {
    k.close();
  }
});
