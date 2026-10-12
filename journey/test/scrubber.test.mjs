// The control bar's scrubber on a Pi: one seek when the finger lifts (not one
// per drag event), and no DOM writes while the bar is faded out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick } from './kiosk-dom.mjs';

const ANSWERED = { 'journey.captions': 'off' };

function rig(window) {
  const doc = window.document;
  const video = doc.getElementById('journey-video');
  const seeks = [];
  let now = 5;
  Object.defineProperty(video, 'duration', { value: 600, configurable: true });
  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => now,
    set: (t) => { seeks.push(t); now = t; },
  });
  const scrubber = doc.getElementById('video-scrubber');
  scrubber.max = '600';
  return { doc, video, seeks, scrubber, time: doc.getElementById('video-time'), setNow: (t) => { now = t; } };
}

test('dragging moves the readout only; the seek happens once, on release', async () => {
  const kiosk = bootKiosk({}, ANSWERED);
  try {
    const { window } = kiosk;
    await tick();
    const r = rig(window);
    for (const v of ['100', '150', '200']) {
      r.scrubber.value = v;
      r.scrubber.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    assert.deepEqual(r.seeks, [], 'no seek while dragging');
    assert.match(r.time.textContent, /^3:20 \//, 'the readout follows the finger');
    r.scrubber.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual(r.seeks, [200], 'one seek, to where the finger lifted');
  } finally {
    kiosk.close();
  }
});

test('while the bar is faded out (cursor hidden, not paused) the scrubber is not written', async () => {
  const kiosk = bootKiosk({}, ANSWERED);
  try {
    const { window } = kiosk;
    await tick();
    const r = rig(window);
    const root = r.doc.documentElement;
    Object.defineProperty(r.video, 'paused', { value: false, configurable: true });
    root.classList.add('cursor-hidden');
    r.setNow(42);
    r.video.dispatchEvent(new window.Event('timeupdate'));
    assert.notEqual(r.scrubber.value, '42', 'hidden bar: untouched');
    root.classList.remove('cursor-hidden');
    r.video.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(r.scrubber.value, '42', 'shown bar: follows the video');
    // The cursor coming back catches a hidden bar up at once.
    root.classList.add('cursor-hidden');
    r.setNow(77);
    r.video.dispatchEvent(new window.Event('timeupdate'));
    assert.equal(r.scrubber.value, '42');
    r.doc.dispatchEvent(new window.Event('mousemove', { bubbles: true }));
    assert.equal(r.scrubber.value, '77', 'mouse move shows the bar and syncs it');
  } finally {
    kiosk.close();
  }
});
