'use strict';
// The canary: an end-to-end night-systems test.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const fs    = require('fs');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $labelRender = lazy('./label-render');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $http = lazy('./http');
const $relay = lazy('./relay');
const app = $http.app;

// ── Canary — end-to-end night-systems test ────────────────────────────────────
// Stage 1 prints a real label with a TEST overlay (unique name defeats the
// duplicate window; excluded from history, stats, tally, and the checkin
// event). Stage 2 publishes a canary event so displays can confirm the pipe.
app.post('/canary', async (req, res) => {
  const stages = [];
  const canaryName = 'Canary ' + new Date().toTimeString().slice(0, 8);

  let pngPath = null;
  try {
    const result = await $labelRender.generateLabel({
      firstName: canaryName, lastName: '', clubName: 'Test', testBanner: true,
    });
    pngPath = result.pngPath;
    const printerName = (req.body && req.body.printerName && String(req.body.printerName).trim()) || $config.PRINTER_NAME;
    // Startup chirp (#12): the morning test print announces itself with a
    // two-second motor melody. Failure is swallowed inside — the canary's
    // job is the label and the pipe, never the music.
    await $tunes.playTuneIfEnabled(printerName);
    await $printing.printLabel(pngPath, printerName);
    stages.push({ stage: 'print', passed: true, detail: `TEST label sent to ${printerName || 'default printer'}` });
  } catch (err) {
    stages.push({ stage: 'print', passed: false, detail: err.message });
  } finally {
    if (pngPath) fs.unlink(pngPath, () => {});
  }

  const published = await events.publish($config.EVENT_CHANNEL, 'canary', events.buildCanary());
  stages.push({
    stage: 'live channel',
    passed: published,
    detail: published ? `canary event on ${$config.EVENT_CHANNEL}`
      : ($relay.signedInToSync() ? 'publish failed' : 'This computer is not signed in to the sync service'),
  });

  // Third stage: prove the ENCRYPTED path works, not just the channel. A screen
  // that can reach the channel but cannot open a sealed frame shows no banners, and
  // without this stage the only symptom is "the wall stopped welcoming children"
  // — discovered mid-service rather than at 5:45.
  const keyState = events.getDisplayKeyState();
  if (keyState.configured) {
    // An empty recap on purpose: the consumer's handleRecap iterates entries, so
    // [] is a clean no-op that still exercises seal -> publish -> open.
    const sealedOk = await events.publish(
      $config.EVENT_CHANNEL, 'recap', events.buildRecap([]));
    stages.push({
      stage: 'display key',
      passed: sealedOk,
      detail: sealedOk
        ? `sealed recap sent (key ${keyState.kid}) — each screen should flash "key OK"`
        : 'could not publish the sealed test event',
    });
  } else {
    stages.push({
      stage: 'display key',
      passed: false,
      detail: "No display key set — names are going out UNENCRYPTED on a public channel. Generate one under Realtime.",
    });
  }

  $eventBuffer.lastCanary = { at: new Date().toISOString(), stages };
  console.log(`[canary] ${stages.map(s => `${s.stage}:${s.passed ? 'ok' : 'FAIL'}`).join(' ')}`);
  res.json({ ok: stages.every(s => s.passed), stages });
});
