#!/usr/bin/env node
// The wake-up call (9.5.0, owner 2026-10-15): a print station keeps one socket open
// to the check-in service's live channel, and the service's ring makes the job
// puller ask for the label at once instead of at its next 5 s poll. Driven here
// with a stand-in WebSocket and hand-run timers:
//   * the socket's address is the sync URL turned to ws(s), with the session and the station id;
//   * only {e: 'changed', d: {what: 'print'}} is a ring; other frames, "pong" and junk are not;
//   * a ping every PING_MS keeps it alive; nothing heard for SILENT_MS closes and reopens it;
//   * a closed socket opens again after a back-off that doubles to a minute, and resets once open;
//   * signed out: no socket, asked again later; stop() closes it and nothing reopens;
//   * startJobPuller's kick: an idle puller asks at once; a kick during a round asks again right after it.
'use strict';
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
const root = path.join(__dirname, '..');
const sw = require(path.join(root, 'print-server', 'station-wake.js'));
const jp = require(path.join(root, 'print-server', 'job-puller.js'));

// Hand-run timers: setT records, run(ms) advances the clock and fires what is due.
function clock() {
  let t = 1000000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setT: (fn, ms) => { const id = ++seq; timers.set(id, { fn, at: t + ms }); return id; },
    clearT: (id) => { timers.delete(id); },
    pending: () => timers.size,
    run(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
  };
}

function fakeWs() {
  const made = [];
  class FakeWs {
    constructor(url) { this.url = url; this.sent = []; this.closed = false; made.push(this); }
    send(x) { this.sent.push(x); }
    close() { this.closed = true; }
  }
  return { FakeWs, made };
}

(async () => {
  console.log('\nthe address and the ring');
  {
    check('https becomes wss, with session and station', sw.wakeUrl('https://awana.kvbchurch.org/api/', 'v1.1.2.abc', 'dev-0123456789abcdef')
      === 'wss://awana.kvbchurch.org/api/v1/live?session=v1.1.2.abc&station=dev-0123456789abcdef', sw.wakeUrl('https://awana.kvbchurch.org/api/', 'v1.1.2.abc', 'dev-0123456789abcdef'));
    check('http becomes ws', sw.wakeUrl('http://127.0.0.1:8787', 's', 'id12345678').startsWith('ws://127.0.0.1:8787/v1/live?'));
    check('the ring is a ring', sw.isWake('{"e":"changed","d":{"what":"print"}}') === true);
    check('another doorbell, a frame, pong and junk are not',
      !sw.isWake('{"e":"changed","d":{"what":"calendar"}}') && !sw.isWake('{"e":"tally","d":{}}') && !sw.isWake('pong') && !sw.isWake('{') && !sw.isWake(null));
  }

  console.log('\na ring kicks the puller; pings keep it alive; a quiet socket is reopened');
  {
    const c = clock();
    const { FakeWs, made } = fakeWs();
    let wakes = 0;
    const w = sw.startStationWake({
      signedIn: () => ({ base: 'https://awana.kvbchurch.org/api', session: 'S' }), stationId: () => 'dev-0123456789abcdef',
      onWake: () => { wakes++; }, WebSocketImpl: FakeWs, setTimeoutFn: c.setT, clearTimeoutFn: c.clearT, now: c.now,
    });
    check('one socket at once, to the live channel as the station', made.length === 1 && /\/v1\/live\?session=S&station=dev-0123456789abcdef$/.test(made[0].url), made[0] && made[0].url);
    made[0].onopen();
    check('open', w.status().open === true && w.status().opens === 1);
    made[0].onmessage({ data: '{"e":"changed","d":{"what":"print"}}' });
    made[0].onmessage({ data: '{"e":"changed","d":{"what":"journey"}}' });
    check('the ring wakes the puller, other frames do not', wakes === 1 && w.status().rings === 1, `${wakes}`);
    c.run(sw.PING_MS);
    check('a ping after PING_MS', made[0].sent.includes('ping'), JSON.stringify(made[0].sent));
    made[0].onmessage({ data: 'pong' });
    c.run(sw.PING_MS);
    check('still the same socket while pongs come', made.length === 1 && !made[0].closed);
    c.run(sw.SILENT_MS + sw.PING_MS);
    check('nothing heard for SILENT_MS: closed', made[0].closed === true);
    c.run(sw.RETRY_MAX_MS);
    check('and opened again', made.length === 2, `${made.length}`);
    w.stop();
    check('stop closes it', made[1].closed === true);
    c.run(10 * sw.RETRY_MAX_MS);
    check('and nothing reopens', made.length === 2, `${made.length}`);
  }

  console.log('\nback-off, sign-out, no WebSocket');
  {
    const c = clock();
    const { FakeWs, made } = fakeWs();
    const w = sw.startStationWake({
      signedIn: () => ({ base: 'https://x.test', session: 'S' }), stationId: () => 'dev-0123456789abcdef', onWake: () => {},
      WebSocketImpl: FakeWs, setTimeoutFn: c.setT, clearTimeoutFn: c.clearT, now: c.now,
    });
    made[0].onclose();
    c.run(sw.RETRY_MIN_MS - 1);
    check('not before the first back-off', made.length === 1);
    c.run(1);
    check('again after RETRY_MIN_MS', made.length === 2);
    made[1].onerror();
    c.run(sw.RETRY_MIN_MS);
    check('the next back-off is longer', made.length === 2);
    c.run(sw.RETRY_MIN_MS);
    check('doubled', made.length === 3);
    made[2].onopen();
    made[2].onclose();
    c.run(sw.RETRY_MIN_MS);
    check('an open resets the back-off', made.length === 4);
    w.stop();

    let signed = null;
    const c2 = clock();
    const f2 = fakeWs();
    const w2 = sw.startStationWake({
      signedIn: () => signed, stationId: () => 'dev-0123456789abcdef', onWake: () => {},
      WebSocketImpl: f2.FakeWs, setTimeoutFn: c2.setT, clearTimeoutFn: c2.clearT, now: c2.now,
    });
    check('signed out: no socket', f2.made.length === 0);
    signed = { base: 'https://x.test', session: 'S' };
    c2.run(60 * 1000);
    check('signed in later: it opens', f2.made.length === 1);
    w2.stop();

    const w3 = sw.startStationWake({ signedIn: () => null, stationId: () => 'x', onWake: () => {}, WebSocketImpl: 'none' });
    check('no WebSocket here: nothing, the poll carries on', w3.status().supported === false);
  }

  console.log('\nthe puller\'s kick');
  {
    const c = clock();
    let rounds = 0;
    let release = null;
    const puller = { tick: () => { rounds++; return new Promise((resolve) => { release = () => resolve({ wait: jp.IDLE_MS }); }); } };
    const stop = jp.startJobPuller({ puller, setTimeoutFn: c.setT, clearTimeoutFn: c.clearT });
    c.run(3000);
    check('the first round at 3 s', rounds === 1);
    release(); await new Promise((r) => setImmediate(r));
    stop.kick();
    c.run(0);
    check('a kick while idle asks at once (not after 5 s)', rounds === 2, `${rounds}`);
    stop.kick();   // during that round
    release(); await new Promise((r) => setImmediate(r));
    c.run(0);
    check('a kick during a round asks again right after it', rounds === 3, `${rounds}`);
    release(); await new Promise((r) => setImmediate(r));
    c.run(jp.IDLE_MS - 1);
    check('otherwise the 5 s poll', rounds === 3);
    c.run(1);
    check('...which still runs', rounds === 4);
    stop();
    stop.kick();
    c.run(10 * 1000);
    check('a stopped puller ignores a kick', rounds === 4, `${rounds}`);
    check('the lease asks for up to ten labels', jp.LEASE_BATCH === 10);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
