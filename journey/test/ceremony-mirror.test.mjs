// The opening ceremony (src/schedule/30-ceremony-mirror.js, owner 2026-10-19:
// "ALL screens should show the games projector display ... journey
// included"): the embedded Check-in Display shows the projector itself; this
// page only hears it go up and down, and never self-updates over it while
// the room can see it. Only its own frame, at its own origin, is believed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';

const at = (h, m) => new Date(2026, 9, 7, h, m).getTime(); // a Wednesday

function boot() {
  return bootKiosk({}, { 'journey.captions': 'off' }, undefined, (window) => {
    pinClock(window, at(18, 1));
  });
}

function say(k, up, { source, origin } = {}) {
  const frame = k.document.getElementById('checkin-frame');
  k.window.dispatchEvent(new k.window.MessageEvent('message', {
    data: { type: 'awana-display:ceremony-mirror', up },
    origin: origin ?? k.window.location.origin,
    source: source === undefined ? frame.contentWindow : source,
  }));
}

test('no self-update while the opening is on the Check-in Display; again once it is down', async () => {
  const k = boot();
  try {
    for (let i = 0; i < 6; i += 1) await tick();
    assert.equal(k.document.getElementById('checkin-view').classList.contains('hidden'), false, 'the Check-in Display is the view');
    assert.equal(k.window.safeToReload(), true);
    say(k, true);
    assert.equal(k.window.ceremonyMirrorShowing(), true);
    assert.equal(k.window.safeToReload(), false, 'the room is watching the opening');
    say(k, false);
    assert.equal(k.window.safeToReload(), true);
  } finally {
    k.close();
  }
});

test('only its own frame at its own origin is believed', async () => {
  const k = boot();
  try {
    for (let i = 0; i < 6; i += 1) await tick();
    say(k, true, { source: k.window });
    say(k, true, { origin: 'https://evil.example' });
    assert.equal(k.window.ceremonyMirrorShowing(), false);
  } finally {
    k.close();
  }
});

test('a hidden Check-in Display (a lesson, a preview) is not the opening on screen', async () => {
  const k = boot();
  try {
    for (let i = 0; i < 6; i += 1) await tick();
    say(k, true);
    k.document.getElementById('checkin-view').classList.add('hidden');
    assert.equal(k.window.ceremonyMirrorShowing(), false);
  } finally {
    k.close();
  }
});
