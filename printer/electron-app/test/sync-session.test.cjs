'use strict';
// The wizard's sign-in (src/sync-session.js), on the print server's own
// sync-client.js, with a stand-in fetch and a stand-in safeStorage.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const syncClient = require('../../print-server/sync-client.js');
const { createSyncSession, FILE } = require('../src/sync-session');

const SESSION = 'v1.1760000000.1.abcdefghijklmnopqrstuvwxyz012345';
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => {
    const t = b.toString();
    if (!t.startsWith('ENC:')) throw new Error('not ours');
    return Buffer.from(t.slice(4), 'base64').toString();
  },
});

const SALT = 'AAECAwQFBgcICQoLDA0ODw==';

// Passphrase v2 is the only sign-in (the old {passphrase} login is gone, owner 2026-10-16).
let keyForKennebec = null;
const kennebecKey = () => (keyForKennebec ||= require('../../print-server/cloud-crypto').deriveAuthKey('kennebec', SALT, 600000));

/** A stand-in service: v2 params, and a login that takes only the authKey "kennebec" derives. `v2: false` = a service older than v2. */
function fakeFetch({ v2 = true } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    if (url.endsWith('/lobby/shared/sync.json')) return json(200, { url: 'https://awana.kvbchurch.org/api' });
    if (url === 'https://awana.kvbchurch.org/api/v1/auth/params' && v2) return json(200, { v: 2, salt: SALT, iter: 600000, legacy: false, upgrade: false });
    if (url === 'https://awana.kvbchurch.org/api/v1/login') {
      const b = JSON.parse(init.body);
      if (!b.authKey) return json(401, { reason: 'legacy-off' });
      return b.authKey === await kennebecKey() && !b.passphrase ? json(200, { session: SESSION, displayKey: `${'k'.repeat(43)}=`, history: null }) : json(401, { reason: 'wrong', triesLeft: 4 });
    }
    return json(404, {});
  };
  return { fn, calls };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-sync-'));

describe('sync session, passphrase v2', () => {
  it('derives the authKey on this computer and sends only that', async () => {
    const dir = tmp();
    const f = fakeFetch();
    const s = createSyncSession({ userData: dir, safeStorage: fakeSafe(), syncClient, fetchFn: f.fn });
    assert.deepEqual(await s.signIn('  Kennebec '), { ok: true, url: 'https://awana.kvbchurch.org/api', kept: 'encrypted' });
    const login = f.calls.find((c) => c.url.endsWith('/v1/login'));
    assert.deepEqual(Object.keys(JSON.parse(login.init.body)), ['authKey']);
    assert.ok(!JSON.stringify(f.calls).includes('ennebec'));
    const wrong = await s.signIn('kenebec');
    assert.equal(wrong.ok, false);
    assert.equal(wrong.triesLeft, 4);
  });
});

describe('sync session', () => {
  it('signs in as the screens do and keeps only the session, encrypted', async () => {
    const dir = tmp();
    const f = fakeFetch();
    const s = createSyncSession({ userData: dir, safeStorage: fakeSafe(), syncClient, fetchFn: f.fn });
    const r = await s.signIn('  Kennebec ');
    assert.deepEqual(r, { ok: true, url: 'https://awana.kvbchurch.org/api', kept: 'encrypted' });
    const login = f.calls.find((c) => c.url.endsWith('/v1/login'));
    assert.equal(login.init.method, 'POST');
    assert.deepEqual(Object.keys(JSON.parse(login.init.body)), ['authKey']);
    const onDisk = fs.readFileSync(path.join(dir, FILE), 'utf8');
    assert.ok(onDisk.startsWith('ENC:'));
    assert.ok(!onDisk.includes(SESSION) && !onDisk.includes('kennebec'));
    assert.equal(s.session().session, SESSION);
    assert.equal(s.status().signedIn, true);
    assert.equal(JSON.stringify(s.status()).includes(SESSION), false);
    // A fresh run reads it back.
    const again = createSyncSession({ userData: dir, safeStorage: fakeSafe(), syncClient, fetchFn: f.fn });
    assert.equal(again.status().signedIn, true);
    again.signOut();
    assert.equal(again.status().signedIn, false);
  });

  it('never writes a plain file when safeStorage cannot encrypt', async () => {
    const dir = tmp();
    const s = createSyncSession({ userData: dir, safeStorage: fakeSafe(false), syncClient, fetchFn: fakeFetch().fn });
    const r = await s.signIn('kennebec');
    assert.equal(r.kept, 'memory');
    assert.equal(fs.existsSync(path.join(dir, FILE)), false);
    assert.equal(s.status().signedIn, true);
  });

  it('says what went wrong', async () => {
    const s = createSyncSession({ userData: tmp(), safeStorage: fakeSafe(), syncClient, fetchFn: fakeFetch().fn });
    const r = await s.signIn('wrong');
    assert.equal(r.ok, false);
    assert.equal(r.triesLeft, 4);
    // A service older than v2 is never sent the passphrase.
    const old = fakeFetch({ v2: false });
    const tooOld = await createSyncSession({ userData: tmp(), safeStorage: fakeSafe(), syncClient, fetchFn: old.fn }).signIn('kennebec');
    assert.equal(tooOld.ok, false);
    assert.match(tooOld.error, /older than this app/);
    assert.equal(old.calls.filter((c) => c.url.endsWith('/v1/login')).length, 0);
    assert.equal((await s.signIn('   ')).error, 'Type the passphrase first.');
    const offline = createSyncSession({ userData: tmp(), safeStorage: fakeSafe(), syncClient, fetchFn: async () => { throw new Error('offline'); } });
    assert.match((await offline.signIn('kennebec')).error, /internet/);
  });
});
