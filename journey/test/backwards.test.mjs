// Backwards Night (src/schedule/31-backwards.js, owner 2026-11-23): the
// embedded Check-in Display says when; this page's own cards spell backwards,
// the lesson's slides and Settings do not, and every word comes back after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootKiosk, tick, pinClock } from './kiosk-dom.mjs';

const at = (h, m) => new Date(2026, 9, 7, h, m).getTime(); // a Wednesday

function say(k, on, { source, origin } = {}) {
  const frame = k.document.getElementById('checkin-frame');
  k.window.dispatchEvent(new k.window.MessageEvent('message', {
    data: { type: 'awana-display:backwards', on },
    origin: origin ?? k.window.location.origin,
    source: source === undefined ? frame.contentWindow : source,
  }));
}

test('the splash spells backwards on the frame\'s word only, and comes back after', async () => {
  const k = bootKiosk({}, { 'journey.captions': 'off' }, undefined, (window) => pinClock(window, at(18, 35)));
  try {
    for (let i = 0; i < 6; i += 1) await tick();
    const splash = () => k.document.getElementById('journey-splash').textContent.replace(/\s+/g, ' ').trim();
    const settings = () => k.document.getElementById('settings-panel')?.textContent || '';
    const before = splash();
    const settingsBefore = settings();
    assert.ok(before.length > 0);
    say(k, true, { source: k.window });
    say(k, true, { origin: 'https://evil.example' });
    assert.equal(splash(), before, 'only its own frame at its own origin is believed');
    say(k, true);
    assert.equal(k.document.documentElement.classList.contains('backwards'), true);
    assert.notEqual(splash(), before);
    assert.match(splash(), /puorG egraL|PUORG EGRAL/i);
    assert.equal(settings(), settingsBefore, 'Settings stay the right way round');
    say(k, false);
    assert.equal(splash(), before);
  } finally {
    k.close();
  }
});
