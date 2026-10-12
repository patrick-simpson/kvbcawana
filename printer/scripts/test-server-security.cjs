#!/usr/bin/env node
// Integration tests for the print server's trust model (v5.3.0; Online only,
// 2026-10-12: the LAN, the Wi-Fi phone page and the PIN are gone).
//
// These assert the properties that keep children's names and allergy data off
// the network. They are integration tests rather than unit tests on purpose:
// every one of the original holes was a WIRING mistake — middleware order, a
// route that forgot its auth check, a bind call missing its host argument —
// and none of those are visible from a pure function test.
//
// A real non-loopback request is needed to exercise the gate, so the suite
// connects to a non-loopback local IPv4 address. If the host has no such
// address the LAN cases fail (loudly) rather than passing vacuously.
//
// Run: npm run test:security

'use strict';

// A crashed suite must FAIL, not pass: server.js's uncaughtException handler
// (a production never-crash feature) can swallow a test-time crash, letting
// the event loop drain and the process exit 0 without a summary ever printing.
// If we reach 'exit' with code 0 and the suite never declared itself finished,
// force red. (Found the hard way: a ReferenceError mid-suite passed CI.)
let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('\u2717 Test suite terminated before completing (crash swallowed?) \u2014 failing.');
    process.exitCode = 1;
  }
});


const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.AWANA_TEST_PORT || 34561);
const PIN = 'test-pin-9182';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(`${name}${detail ? ' — ' + detail : ''}`);
    console.error(`  \u2717 ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function lanAddress() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

function request(opts) {
  const { host, port = PORT, method = 'GET', pathname, headers = {}, body } = opts;
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = http.request({
      host,
      port,
      method,
      path: pathname,
      headers: {
        ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
      timeout: 8000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

function json(res) {
  try { return JSON.parse(res.body); } catch { return null; }
}

async function main() {
  const lan = lanAddress();

  // ── Fixture data dir ────────────────────────────────────────────────────────
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sec-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
    printerName: '',
    checkinUrl: 'https://example.twotimtwo.com/clubber/checkin',
    phonePin: PIN,                 // an old install's PIN: nothing reads it any more
    lanAccess: true,
    pusherSecret: 'SECRET-MUST-NOT-LEAK',
    pusherKey: 'key-abc',
    pusherAppId: '12345',
    displayLoginPassphrase: 'PASSPHRASE-MUST-NOT-LEAK',
    displayLoginSalt: Buffer.alloc(16, 7).toString('base64'),
  }, null, 2));
  // One roster row and one history row so the PII endpoints have something to
  // leak if the gate fails — a test that passes because the file was empty
  // would be worthless.
  fs.writeFileSync(path.join(dataDir, 'clubbers.csv'),
    'FirstName,LastName,Birthdate,Allergies,HandbookGroup,MedRelease\n'
    + 'Testkid,Leakcanary,2018-03-15,peanut allergy,Cubbies A,y\n');
  fs.writeFileSync(path.join(dataDir, 'print-history.json'), JSON.stringify([{
    firstName: 'Testkid', lastName: 'Leakcanary', clubName: 'Cubbies',
    printer: '', success: true, visitor: false, isAward: false, award: '',
    timestamp: new Date().toISOString(),
  }], null, 2));

  // printImage() shells out to `powershell`, absent on a Linux runner — stub it
  // so the leader-tag happy path below exercises a real 200, not a print error.
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sec-bin-'));
  fs.writeFileSync(path.join(binDir, 'powershell'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;

  process.env.AWANA_DATA_DIR = dataDir;
  process.env.AWANA_PORT = String(PORT);     // don't collide with a real install on 3456
  process.env.AWANA_BIND_HOST = '0.0.0.0';   // asking for the LAN must change nothing (checked below)

  // require() the server AFTER the env is set — DATA_DIR is read at module load.
  const server = require(path.join(__dirname, '..', 'print-server', 'server.js'));
  const listener = server.startListening();
  await new Promise((resolve) => {
    if (listener.listening) return resolve();
    listener.once('listening', resolve);
  });

  // ── Loopback is trusted ─────────────────────────────────────────────────────
  {
    const res = await request({ host: '127.0.0.1', pathname: '/stats/tonight' });
    check('loopback GET /stats/tonight is allowed', res.status === 200, `status ${res.status}`);
    const body = json(res) || {};
    check('loopback /stats/tonight still returns the data the settings page and the extension need',
      Array.isArray(body.allergyKids), 'allergyKids missing');
  }
  {
    const res = await request({ host: '127.0.0.1', pathname: '/config' });
    const cfg = json(res) || {};
    check('loopback GET /config (no Origin: the app on this computer) still carries the secrets',
      cfg.pusherSecret === 'SECRET-MUST-NOT-LEAK' && cfg.phonePin === PIN && cfg.displayLoginPassphrase === 'PASSPHRASE-MUST-NOT-LEAK',
      'the app could not read its own settings');
  }

  // ── The LAN is not served (Online only, 2026-10-12) ────────────────────────
  // The server binds 127.0.0.1 and refuses any non-loopback socket at the gate,
  // so there is no PIN, no Wi-Fi phone page and no dashboard. Two properties:
  //  1. WIRING: even if something put this app on a LAN socket (a second
  //     listener on 0.0.0.0 here), every request from a non-loopback address is
  //     refused, with or without an old PIN, and leaks nothing.
  //  2. BIND: a child process with the default config, and even with
  //     AWANA_BIND_HOST asking for 0.0.0.0, is unreachable on the LAN address.
  if (!lan) {
    console.warn('  ! No non-loopback IPv4 address on this host — LAN cases SKIPPED');
    check('LAN cases were exercised', false, 'no non-loopback address available');
  } else {
    const lanPort = PORT + 2;
    const lanListener = http.createServer(server.app);
    await new Promise((resolve) => lanListener.listen(lanPort, '0.0.0.0', resolve));
    const lanReq = (o) => request({ ...o, host: lan, port: lanPort });

    const GET_PATHS = [
      '/', '/phone', '/phone/ym', '/phone.html', '/index.html', '/step-chip.js',
      '/health', '/stats/tonight', '/history', '/history/today', '/checkin-csv-export', '/roster-status',
      '/failures', '/diagnostics', '/config', '/reconcile', '/clubs', '/leaders', '/attendance-audit',
      '/preview?name=Testkid%20Leakcanary',
      '/brand/fonts.css', '/brand/fonts/PaytoneOne-Regular.ttf', '/brand/tokens.css',
      '/brand/../index.html', '/brand/%2e%2e/index.html', '/brand/README.md', '/brand/',
    ];
    for (const p of GET_PATHS) {
      for (const headers of [{}, { 'X-Awana-Pin': PIN }]) {
        const res = await lanReq({ pathname: p, headers });
        check(`LAN GET ${p} is refused${headers['X-Awana-Pin'] ? ' even with the old PIN' : ''}`, res.status === 403, `status ${res.status}`);
        check(`LAN GET ${p} leaks no roster name`, !res.body.includes('Leakcanary') && !res.body.includes('peanut'),
          'response contained a child name');
      }
    }
    const POST_PATHS = [
      ['/phone/roster', {}], ['/phone/tonight', {}], ['/phone/undo', { firstName: 'Testkid', lastName: 'Leakcanary' }],
      ['/phone/restore', { firstName: 'Testkid', lastName: 'Leakcanary' }], ['/phone/visitor', { name: 'Stranger Danger' }],
      ['/phone/checkin', { name: 'Testkid Leakcanary' }],
      ['/print-leader', { name: 'Stranger Leader' }], ['/print-custom', { text: 'Stranger' }], ['/print-oneoff', { firstName: 'Stranger', clubName: 'Sparks' }],
      ['/leaders', {}], ['/leaders/forget', { key: 'lan leader' }], ['/clubs', {}], ['/reconcile', {}],
      ['/feed/source-count', { date: '2026-09-02', checkedIn: 999 }],
      ['/feed/completed-books', { entries: [{ name: 'Stranger Leakcanary', book: 'Wingrunner', date: '2026-09-02' }] }],
      ['/feed/attendance-grid', { meetingDates: ['2026-09-02'], clubsRead: ['Sparks'], rows: [{ name: 'Stranger Leakcanary', club: 'Sparks', dates: ['2026-09-02'] }] }],
      ['/attendance-audit/apply', { confirm: true }], ['/printer/clear-queue', { confirm: true }], ['/rehearsal', { on: true }],
      ['/config', { pusherSecret: 'attacker' }], ['/config', { printerName: 'Evil' }], ['/config/sync-login', { passphrase: 'x', url: 'https://evil.example' }],
      ['/config/display-key/generate', {}], ['/pending-actions/x/claim', {}],
    ];
    for (const [p, body] of POST_PATHS) {
      const res = await lanReq({ method: 'POST', pathname: p, body: { pin: PIN, ...body }, headers: { 'X-Awana-Pin': PIN } });
      check(`LAN POST ${p} is refused even with the old PIN`, res.status === 403, `status ${res.status}`);
      check(`LAN POST ${p} leaks no roster name`, !res.body.includes('Leakcanary'));
    }
    {
      // None of those refused writes may have touched anything.
      const stats = json(await request({ host: '127.0.0.1', pathname: '/stats/tonight' })) || {};
      check('the refused writes mutated nothing', stats.checkedIn === 1, JSON.stringify(stats));
      const hist = json(await request({ host: '127.0.0.1', pathname: '/history' })) || [];
      check('no history row was added by the refused writes',
        Array.isArray(hist) && !hist.some((r) => /Stranger/.test(r.firstName || '')), JSON.stringify(hist.map((r) => r.firstName)));
      const rec = json(await request({ host: '127.0.0.1', pathname: '/reconcile' })) || {};
      check('a refused source-count post planted no second opinion', rec.known === false || rec.theirs !== 999, JSON.stringify(rec));
      const cfg = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
      check('a refused config write changed nothing', cfg.printerName === '' && cfg.pusherSecret === 'SECRET-MUST-NOT-LEAK', JSON.stringify(Object.keys(cfg)));
    }
    await new Promise((resolve) => lanListener.close(resolve));
  }

  // ── The managed extension folder is loopback-only ───────────────────────────
  // /health is deliberately CORS-readable from the check-in site (the extension
  // polls it for the version banner and the privacy badge), and the folder path
  // is %APPDATA%\… — which contains the operator's Windows USERNAME. So the
  // version travels and the path does not.
  {
    server.setExtensionInfo({
      targetDir: 'C:\\Users\\pastor.jane\\AppData\\Roaming\\Club Label Printer\\chrome-extension',
      version: '9.9.9',
      action: 'updated',
    });

    const local = json(await request({ host: '127.0.0.1', pathname: '/health' }));
    check('a loopback caller sees the extension folder',
      local && local.extension && /chrome-extension$/.test(local.extension.dir || ''),
      JSON.stringify(local && local.extension));
    check('a loopback caller sees the extension version',
      local && local.extension && local.extension.version === '9.9.9');

    const remote = await request({
      host: '127.0.0.1', pathname: '/health',
      headers: { Origin: 'https://kvbchurch.twotimtwo.com' },
    });
    const remoteBody = json(remote);
    check('the check-in site still sees the extension VERSION',
      remoteBody && remoteBody.extension && remoteBody.extension.version === '9.9.9',
      JSON.stringify(remoteBody && remoteBody.extension));
    check('...but NOT the folder path',
      remoteBody && remoteBody.extension && remoteBody.extension.dir === undefined,
      JSON.stringify(remoteBody && remoteBody.extension));
    check('...so the Windows username never crosses an origin',
      !/pastor\.jane/.test(remote.body), remote.body.slice(0, 200));

    // A standalone `node server.js` has no managed folder; reporting one would
    // send an operator to a directory that does not exist.
    server.setExtensionInfo(null);
    const cleared = json(await request({ host: '127.0.0.1', pathname: '/health' }));
    check('with no managed folder /health reports none', cleared && cleared.extension === null,
      JSON.stringify(cleared && cleared.extension));
  }

  // ── Origin policy ───────────────────────────────────────────────────────────
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'https://evil.example' },
    });
    check('a stranger origin gets no Access-Control-Allow-Origin',
      !res.headers['access-control-allow-origin'],
      `got ${res.headers['access-control-allow-origin']}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'http://evil.example:' + PORT },
    });
    check('the old :3456 port-suffix bypass is closed',
      !res.headers['access-control-allow-origin'],
      `got ${res.headers['access-control-allow-origin']}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', pathname: '/stats/tonight',
      headers: { Origin: 'https://kvbchurch.twotimtwo.com' },
    });
    check('the check-in site origin is allowed to read',
      res.headers['access-control-allow-origin'] === 'https://kvbchurch.twotimtwo.com',
      `got ${res.headers['access-control-allow-origin']}`);
    check('the allowlist never answers with a wildcard',
      res.headers['access-control-allow-origin'] !== '*');
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/print',
      headers: { Origin: 'https://evil.example' },
      body: { firstName: 'Drive', lastName: 'By' },
    });
    check('a cross-origin write from a stranger is refused', res.status === 403, `status ${res.status}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'OPTIONS', pathname: '/print',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
    });
    check('a stranger preflight is refused', res.status === 403, `status ${res.status}`);
  }

  // ── The print queue is dashboard-only (#256) ────────────────────────────────
  // Clearing the queue BINS labels that are about to print, so it is gated on
  // isTrustedConfigOrigin — the same gate as /play-tune and /rehearsal, and
  // deliberately stricter than the phone PIN, which is LAN trust rather than
  // authorization to throw away a child's label.
  {
    {
      const res = await request({
        host: '127.0.0.1', method: 'POST', pathname: '/printer/clear-queue',
        headers: { Origin: 'http://evil.example:' + PORT }, body: { confirm: true },
      });
      check('a foreign origin on loopback cannot clear the queue',
        res.status === 403, `status ${res.status}`);
    }
    {
      const res = await request({
        host: '127.0.0.1', method: 'POST', pathname: '/printer/clear-queue',
        body: { printerName: 'x"; rm -rf /', confirm: true },
      });
      check('an unsafe printer name is refused before any platform branch',
        res.status === 400, `status ${res.status} ${res.body.slice(0, 120)}`);
    }
    {
      const res = await request({
        host: '127.0.0.1', method: 'POST', pathname: '/printer/clear-queue', body: {},
      });
      check('clearing the queue without confirm:true is a 400',
        res.status === 400, `status ${res.status}`);
    }
    if (process.platform !== 'win32') {
      const res = await request({
        host: '127.0.0.1', method: 'POST', pathname: '/printer/clear-queue',
        body: { printerName: 'Brother QL-820NWB', confirm: true },
      });
      check('off Windows the route reports 501 rather than shelling out',
        res.status === 501, `status ${res.status} ${res.body.slice(0, 120)}`);
    }
  }

  // ── checkinUrl validation (the shell.openExternal / Start-Process sink) ─────
  for (const bad of ['file:///C:/Windows/System32/calc.exe', 'javascript:alert(1)', 'ms-msdt:/id', 'data:text/html,x']) {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config', body: { checkinUrl: bad },
    });
    check(`POST /config rejects checkinUrl ${bad.slice(0, 24)}`, res.status === 400, `status ${res.status}`);
  }
  {
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config',
      body: { checkinUrl: 'https://example.twotimtwo.com/clubber/checkin' },
    });
    check('POST /config still accepts a normal https check-in URL', res.status === 200, `status ${res.status}`);
  }

  // ── The PIN, LAN access and the CORS list are retired keys ──────────────────
  // POST /config accepts the call (an old page may still send one) and changes
  // nothing: nothing reads them, so a poisoned config cannot widen the server.
  {
    const before = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    const res = await request({
      host: '127.0.0.1', method: 'POST', pathname: '/config',
      body: { phonePin: 'brand-new-pin', lanAccess: false, allowedOrigins: ['https://ok.example'] },
    });
    check('POST /config still answers an old page that sends them', res.status === 200, `status ${res.status}`);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
    check('...but the PIN is not changed', saved.phonePin === before.phonePin, JSON.stringify(saved.phonePin));
    check('...and LAN access is not changed', saved.lanAccess === before.lanAccess, JSON.stringify(saved.lanAccess));
    check('...and no allowed origin is added', saved.allowedOrigins === undefined, JSON.stringify(saved.allowedOrigins));
    // Even a config.json that still lists an origin does not widen CORS.
    server.applySavedConfig({ ...saved, allowedOrigins: ['https://ok.example'] });
    const cors = await request({ host: '127.0.0.1', pathname: '/stats/tonight', headers: { Origin: 'https://ok.example' } });
    check('an allowedOrigins entry left in an old config.json grants nothing', !cors.headers['access-control-allow-origin'],
      `got ${cors.headers['access-control-allow-origin']}`);
    server.applySavedConfig(saved);
  }
  {
    const res = await request({ host: '127.0.0.1', pathname: '/stats/tonight', headers: { Origin: 'http://192.168.1.20:' + PORT } });
    check('a LAN machine\'s page on our port is not "our own page"', !res.headers['access-control-allow-origin'],
      `got ${res.headers['access-control-allow-origin']}`);
    const own = await request({ host: '127.0.0.1', pathname: '/stats/tonight', headers: { Origin: 'http://localhost:' + PORT } });
    check('a loopback page on our port is', own.headers['access-control-allow-origin'] === 'http://localhost:' + PORT);
  }

  listener.close();
  // The server sets interval timers for club-night publishing; unref the loop.
  await new Promise((r) => setTimeout(r, 50));

  // ── The bind is loopback-only, whatever is asked ────────────────────────────
  // The most important property in this file, and it cannot be tested in-process
  // because the bind happens once at listen() time. A child process with a
  // default config, and one that ASKS for the LAN (AWANA_BIND_HOST=0.0.0.0, an
  // old lanAccess:true with a PIN), must be UNREACHABLE on the LAN address.
  if (lan) {
    for (const [label, envHost, cfgExtra] of [
      ['default install', '', {}],
      ['AWANA_BIND_HOST=0.0.0.0', '0.0.0.0', {}],
      ['an old config with lanAccess and a PIN', '', { lanAccess: true, phonePin: PIN }],
    ]) {
      const defaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-sec-default-'));
      fs.writeFileSync(path.join(defaultDir, 'config.json'), JSON.stringify({
        printerName: '', checkinUrl: 'https://example.twotimtwo.com/clubber/checkin', ...cfgExtra,
      }, null, 2));
      const childPort = PORT + 1;
      const child = require('child_process').spawn(
        process.execPath,
        [path.join(__dirname, '..', 'print-server', 'server.js')],
        {
          env: { ...process.env, AWANA_DATA_DIR: defaultDir, AWANA_PORT: String(childPort), AWANA_BIND_HOST: envHost },
          stdio: 'ignore',
        }
      );
      // Give it a moment to bind.
      await new Promise((r) => setTimeout(r, 1500));

      const reach = (host) => new Promise((resolve) => {
        const req = http.request({ host, port: childPort, path: '/health', timeout: 3000 },
          (res) => { res.resume(); resolve({ ok: true, status: res.statusCode }); });
        req.on('error', (e) => resolve({ ok: false, code: e.code }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, code: 'timeout' }); });
        req.end();
      });

      const viaLoopback = await reach('127.0.0.1');
      check(`${label}: still answers over loopback`, viaLoopback.ok && viaLoopback.status === 200, JSON.stringify(viaLoopback));
      const viaLan = await reach(lan);
      check(`${label}: is NOT reachable on the LAN address at all`, !viaLan.ok, `reachable with status ${viaLan.status}`);

      child.kill('SIGKILL');
      try { fs.rmSync(defaultDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }

  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(binDir, { recursive: true, force: true }); } catch { /* best effort */ }

  // ── Static check: no dashboard is served, and the page that replaced it escapes ─
  // The stored-XSS chain ran through print-history.json into the dashboard's
  // innerHTML. The dashboard is gone; its replacement is React text (never inner
  // HTML) on awana.kvbchurch.org, and the print server serves one tiny static
  // page that carries no child's name.
  {
    check('the dashboard page is gone from the print server', !fs.existsSync(path.join(__dirname, '..', 'print-server', 'public', 'index.html')));
    const settingsDir = path.join(__dirname, '..', '..', 'lobby', 'src', 'components', 'settings');
    const sources = fs.readdirSync(settingsDir).filter((f) => /^laptop.*\.jsx$/.test(f) && !/test/.test(f));
    check('the settings page\'s laptop cards were found', sources.length >= 2, sources.join());
    for (const f of sources) {
      const src = fs.readFileSync(path.join(settingsDir, f), 'utf8');
      check(`${f} renders children\'s names as React text, never inner HTML`, !/dangerouslySetInnerHTML|\.innerHTML\s*=/.test(src));
    }
  }

  console.log('');
  console.log(`${passed} passed, ${failed} failed`);
  if (failed) {
    console.error('\nFailures:');
    failures.forEach((f) => console.error('  - ' + f));
  }
  __suiteFinished = true;
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test harness error:', err);
  process.exit(1);
});
