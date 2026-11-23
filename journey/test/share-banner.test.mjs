// The share banner (src/schedule/32-share-banner.js, owner 2026-11-23): the embedded
// Check-in Display hands each gift up; this page shows it in the bottom third, from its
// own frame only, and waits while a lesson video plays.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';
import * as rule from '../../shared/shareBanner.js';

const at = (h, m) => new Date(2026, 9, 7, h, m).getTime();

test('a gift from its own frame shows in the bottom third; anyone else\'s is ignored', async () => {
  const k = bootKiosk({}, { 'journey.captions': 'off' }, undefined, (window) => { pinClock(window, at(17, 30)); window.journeyShareBannerModule = rule; });
  try {
    for (let i = 0; i < 6; i += 1) await tick();
    const frame = k.document.getElementById('checkin-frame');
    const send = (source) => k.window.dispatchEvent(new k.window.MessageEvent('message', {
      data: { type: 'awana-display:shares', kids: [{ firstName: 'Ava Stone', club: 'Journey' }], shares: 2 },
      origin: k.window.location.origin, source,
    }));
    send(k.window);
    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(k.document.getElementById('share-banner'), null, 'not from the frame: nothing');
    send(frame.contentWindow);
    await new Promise((r) => setTimeout(r, 1300));
    const box = k.document.getElementById('share-banner');
    assert.ok(box && !box.hidden);
    assert.equal(box.querySelector('.share-names').textContent, 'AVA');
    assert.equal(box.querySelector('.share-line').textContent, 'got 2 shares!');
  } finally {
    k.close();
  }
});
