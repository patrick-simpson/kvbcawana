// The control bar's scrubber on a Pi: one seek when the finger lifts, not one
// per drag event.
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
