'use strict';
// Selector self-test receiver and canary.
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
const $station = lazy('./station');
const app = $http.app;

// ── Selector self-test receiver ───────────────────────────────────────────────
// The extension probes the TwoTimTwo DOM (roster rows, names, #lastCheckin,
// club icons) every 10 minutes and posts the result here so silent selector
// drift is visible on the dashboard before it eats a club night. A transition
// into hard failure publishes an ops event (type/at only — no PII).
app.post('/selftest', (req, res) => {
  const body = req.body || {};
  const wasOk = !$eventBuffer.lastSelfTest || $eventBuffer.lastSelfTest.ok !== false;
  $eventBuffer.lastSelfTest = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 20).map(r => ({
          check: String(r && r.check || '').slice(0, 60),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    at: new Date().toISOString(),
  };
  $eventBuffer.recordExtensionReport(body.extensionVersion);
  if (!$eventBuffer.lastSelfTest.ok && wasOk) {
    console.warn('[selftest] Extension reports selector failure — check-in page markup may have changed');
    events.publish($config.EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
  }
  res.json({ ok: true });
});

// Contract-drift canary (#3): the extension's full once-a-day sweep of every
// TwoTimTwo selector and endpoint docs/TWOTIMTWO.md documents as load-bearing.
// Same shape as /selftest but a superset in scope; a fresh failure publishes
// the existing ops selector-fail (no contract change) and raises a tray alert
// through the Electron shell, so the operator hears about drift BEFORE club
// night rather than when a modal click silently stops working.
app.post('/contract-canary', (req, res) => {
  const body = req.body || {};
  const wasOk = !$eventBuffer.lastContractCanary || $eventBuffer.lastContractCanary.ok !== false;
  $eventBuffer.lastContractCanary = {
    ok: body.ok !== false,
    results: Array.isArray(body.results)
      ? body.results.slice(0, 40).map(r => ({
          check: String(r && r.check || '').slice(0, 80),
          passed: !!(r && r.passed),
          detail: String(r && r.detail || '').slice(0, 120),
          // soft (#3 refinement): meeting-dependent checks that legitimately
          // miss on a non-club day — informational, never counted as drift.
          soft: !!(r && r.soft),
        }))
      : [],
    extensionVersion: String(body.extensionVersion || '').slice(0, 20),
    manual: body.manual === true,
    at: new Date().toISOString(),
  };
  $eventBuffer.recordExtensionReport(body.extensionVersion);
  if (!$eventBuffer.lastContractCanary.ok && wasOk) {
    const failing = $eventBuffer.lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    console.warn('[contract-canary] TwoTimTwo contract drift detected: ' + failing.join(', '));
    events.publish($config.EVENT_CHANNEL, 'ops', events.buildOps('selector-fail'));
    $eventBuffer.fireOpsAlert('Club Label Printer — site check failed',
      'The TwoTimTwo page no longer matches what the printer expects (' +
      (failing[0] || 'unknown check') + (failing.length > 1 ? ' +' + (failing.length - 1) + ' more' : '') +
      '). Check the status on awana.kvbchurch.org/settings before club night.');
  }
  res.json({ ok: true });
});

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

// ── Church config (read-only) ─────────────────────────────────────────────────
// The extension fetches this once at startup so club-night windows, the
// check-in URL, and shares club ids live in one place instead of hardcodes.
// While this computer is the Worker's print station (configureCloud, station.js) and the
// Worker's YM_CHECKOUT switch is on (or not yet known: the 9.2 behaviour), the Worker does the
// Trek/Journey youth check-out (lobby/worker/src/ymcheckout.js), so the extension is told its
// own sweep is off; stopCloud(), or the switch turned off at runtime, hands it back (the
// extension reads this at its start-up: a TwoTimTwo tab reload picks the change up).
app.get('/config/church', (req, res) => {
  const cfg = $config.churchConfig;
  if (!$station.ymHandedOff()) return res.json(cfg);
  res.json({ ...cfg, ymCheckout: { ...(cfg.ymCheckout && typeof cfg.ymCheckout === 'object' ? cfg.ymCheckout : {}), enabled: false } });
});
