#!/usr/bin/env node
// The sync session and the display key at rest (10.14.0, print-server/secret-store.js).
//
// WHAT THIS GUARDS
//
// * Inside the app (useSecretStorage with safeStorage), plain-text secrets left in
//   config.json by an older version move into config-secrets.bin, encrypted, and out of
//   config.json AND config.json.bak; the live server still holds them.
// * Every later write keeps them out of config.json: a POST /config with a new display
//   key, the app handing over config.json as it reads it (no secrets) changes nothing.
// * A sign-out (a key dropped) is written to the store too.
// * Where safeStorage cannot encrypt: memory only, never a plain file.
// * Outside the app (no store) config.json keeps them as before (the other suites).
//
// Run: node scripts/test-secret-store.cjs

'use strict';

let __suiteFinished = false;
process.on('exit', (code) => {
  if (code === 0 && !__suiteFinished) {
    console.error('✗ Test suite terminated before completing (crash swallowed?) — failing.');
    process.exitCode = 1;
  }
});

const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const PORT = Number(process.env.AWANA_TEST_PORT || require('./free-port.cjs')());
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

// A stand-in for Electron's safeStorage: reversible, but never the plain text on disk.
function fakeSafeStorage(available = true) {
  return {
    available,
    isEncryptionAvailable() { return this.available; },
    encryptString(s) { return Buffer.concat([Buffer.from('ENC:'), Buffer.from(Buffer.from(String(s), 'utf8').toString('base64').split('').reverse().join(''))]); },
    decryptString(buf) {
      const b = Buffer.from(buf);
      if (b.slice(0, 4).toString() !== 'ENC:') throw new Error('not ours');
      return Buffer.from(b.slice(4).toString().split('').reverse().join(''), 'base64').toString('utf8');
    },
  };
}

const SESSION = 'v1.1.1700000000.' + 'a'.repeat(32);
const KEY = Buffer.alloc(32, 7).toString('base64');
const KEY2 = Buffer.alloc(32, 9).toString('base64');

async function main() {
  // ── The store on its own ──────────────────────────────────────────────────
  console.log('secret store: the module alone');
  {
    const { createSecretStore, pickSecrets, omitSecrets } = require(path.join(root, 'print-server', 'secret-store.js'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-secrets-unit-'));
    const ss = fakeSafeStorage(true);
    const s = createSecretStore({ dir, safeStorage: ss });
    check('nothing kept at first', JSON.stringify(s.read()) === '{}');
    check('write keeps only the two secrets', s.write({ syncSession: SESSION, displayKey: KEY, printerName: 'X' }) === true);
    const raw = fs.readFileSync(s.file);
    check('the file never holds the plain text', !raw.includes(SESSION) && !raw.includes(KEY));
    const again = createSecretStore({ dir, safeStorage: ss }).read();
    check('a new store reads them back', again.syncSession === SESSION && again.displayKey === KEY && !('printerName' in again));
    s.write({ displayKey: KEY });
    check('a key left out is forgotten', !('syncSession' in createSecretStore({ dir, safeStorage: ss }).read()));
    s.write({});
    check('nothing left = no file', !fs.existsSync(s.file));
    const off = createSecretStore({ dir, safeStorage: fakeSafeStorage(false) });
    check('no encryption: kept in memory', off.write({ syncSession: SESSION }) === false && off.read().syncSession === SESSION);
    check('no encryption: never a file', !fs.existsSync(off.file));
    check('a damaged file reads as nothing', (() => { fs.writeFileSync(s.file, 'garbage'); return JSON.stringify(createSecretStore({ dir, safeStorage: ss }).read()) === '{}'; })());
    check('pick/omit', JSON.stringify(pickSecrets({ syncSession: 'a', x: 1 })) === '{"syncSession":"a"}' && JSON.stringify(omitSecrets({ displayKey: 'k', x: 1 })) === '{"x":1}');
  }

  // ── The server inside the app ─────────────────────────────────────────────
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'awana-secrets-'));
  const cfgPath = path.join(dataDir, 'config.json');
  const bakPath = cfgPath + '.bak';
  const secretsPath = path.join(dataDir, 'config-secrets.bin');
  // An older version's files: the secrets in plain text, in config.json and its backup.
  fs.writeFileSync(cfgPath, JSON.stringify({ printerName: 'Fake', syncUrl: 'https://sync.example', syncSession: SESSION, displayKey: KEY }, null, 2));
  fs.writeFileSync(bakPath, JSON.stringify({ printerName: 'Old', syncSession: SESSION, displayKey: KEY }, null, 2));
  Object.assign(process.env, { AWANA_DATA_DIR: dataDir, AWANA_PORT: String(PORT), AWANA_BIND_HOST: '127.0.0.1', PRINTER_NAME: 'Fake' });

  const origLog = console.log; const origWarn = console.warn;
  console.log = () => {}; console.warn = () => {};
  const server = require(path.join(root, 'print-server', 'server.js'));
  const $config = require(path.join(root, 'print-server', 'server', 'config.js'));
  const events = require(path.join(root, 'print-server', 'events.js'));
  const listener = server.startListening();
  await new Promise((resolve) => { if (listener.listening) return resolve(); listener.once('listening', resolve); });
  console.log = origLog;

  const post = async (p, body) => {
    const res = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const fileText = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

  console.log('secret store: moving an older config.json');
  {
    check('before: the server read them from config.json (no store outside the app)', $config.config.syncSession === SESSION && $config.config.displayKey === KEY);
    const r = server.useSecretStorage({ safeStorage: fakeSafeStorage(true) });
    check('useSecretStorage says it moved them, encrypted', r.ok && r.encrypted && r.migrated, JSON.stringify(r));
    check('config.json no longer holds the session or the key', !fileText(cfgPath).includes(SESSION) && !fileText(cfgPath).includes(KEY), fileText(cfgPath));
    check('...nor does config.json.bak', !fileText(bakPath).includes(SESSION) && !fileText(bakPath).includes(KEY), fileText(bakPath));
    check('config.json kept everything else', JSON.parse(fileText(cfgPath)).printerName === 'Fake' && JSON.parse(fileText(cfgPath)).syncUrl === 'https://sync.example');
    check('config-secrets.bin exists and holds no plain text', fs.existsSync(secretsPath) && !fs.readFileSync(secretsPath).includes(SESSION));
    check('the live server still holds them', $config.config.syncSession === SESSION && $config.config.displayKey === KEY);
    check('names are still sealed with the key', events.getDisplayKeyState().configured === true);
    check('syncSignIn answers the print server\'s sign-in', JSON.stringify(server.syncSignIn()) === JSON.stringify({ url: 'https://sync.example', session: SESSION }));
    check('a second call changes nothing', server.useSecretStorage({ safeStorage: fakeSafeStorage(true) }).migrated === false);
  }

  console.log('secret store: later writes keep them out of config.json');
  {
    // The app hands over config.json as it reads it (no secrets): the sign-in stays.
    server.applySavedConfig(JSON.parse(fileText(cfgPath)));
    check('applySavedConfig with config.json alone keeps the sign-in', $config.config.syncSession === SESSION && $config.config.displayKey === KEY);
    const r = await post('/config', { displayKey: KEY2 });
    check('POST /config takes a new display key', r.status === 200, JSON.stringify(r));
    check('the new key is live', $config.config.displayKey === KEY2);
    check('and is not in config.json', !fileText(cfgPath).includes(KEY2) && !fileText(cfgPath).includes(SESSION));
    check('and is not in config.json.bak', !fileText(bakPath).includes(KEY2) && !fileText(bakPath).includes(SESSION));
    const res = await fetch(BASE + '/config');
    const got = await res.json();
    check('GET /config on this computer still reads them (as before)', got.displayKey === KEY2 && got.syncSession === SESSION);
    await post('/config', { printerName: 'Other' });
    check('an ordinary settings save keeps them', $config.config.syncSession === SESSION && !fileText(cfgPath).includes(SESSION));
  }

  console.log('secret store: a sign-out is written to the store');
  {
    // What relay.js writes on a refused session (writeConfigPatch: delete next.syncSession).
    const next = $config.loadConfigFile();
    delete next.syncSession;
    $config.writeConfigFile(next);
    server.applySavedConfig(next);
    check('the session is gone from the live server', !$config.config.syncSession);
    const { createSecretStore } = require(path.join(root, 'print-server', 'secret-store.js'));
    const kept = createSecretStore({ dir: dataDir, safeStorage: fakeSafeStorage(true) }).read();
    check('and from the store; the display key stays', !kept.syncSession && kept.displayKey === KEY2, JSON.stringify(Object.keys(kept)));
    check('syncSignIn says signed out', server.syncSignIn() === null);
  }

  console.log('secret store: the app source hands safeStorage over before anything reads config');
  {
    const main = fs.readFileSync(path.join(root, 'electron-app', 'main.js'), 'utf8');
    const i = main.indexOf('serverModule = require(fullServerPath);');
    const useAt = main.indexOf('serverModule.useSecretStorage({ safeStorage })', i);
    const applyAt = main.indexOf('serverModule.applySavedConfig(loadConfig() || {})', i);
    check('main.js calls useSecretStorage right after loading the server, before applySavedConfig', i > 0 && useAt > i && useAt < applyAt);
    check('main.js reads the print server\'s sign-in from the server, not config.json', /serverModule\.syncSignIn\(\)/.test(main));
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'electron-app', 'package.json'), 'utf8'));
    const filter = (pkg.build.extraResources.find((r) => r.to === 'print-server') || {}).filter || [];
    check('secret-store.js ships in the app (top-level *.js)', filter.includes('*.js'));
  }

  listener.close();
  if (server.stopListening) server.stopListening();
  console.warn = origWarn;
  console.log(`\n${passed} passed, ${failed} failed`);
  __suiteFinished = true;
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
