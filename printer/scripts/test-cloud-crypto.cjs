#!/usr/bin/env node
// Online check-in's cryptography as the print server and the KVBC Awana app
// load it: the GENERATED CommonJS copy (print-server/cloud-crypto.js, from
// shared/cloud-crypto.js by scripts/shared-copies.mjs) against the
// shared vectors (shared/cloud-vectors.json). Plain Node, zero deps.
// The negative cases are the product: a seal that opens somewhere it should
// not is worse than none.
//
// Run: npm run test:cloud-crypto

'use strict';

let finished = false;
process.on('exit', (code) => {
  if (code === 0 && !finished) {
    console.error('✗ Test suite terminated before completing — failing.');
    process.exitCode = 1;
  }
});

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cc = require('../print-server/cloud-crypto.js');

const vectors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'cloud-vectors.json'), 'utf8'));
const bytes = (b64) => cc.base64ToBytes(b64);
const ring = async (name) => cc.keyRing(await cc.importPrivateKey(vectors.keys[name].jwk), vectors.keys[name].pub);

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err && err.stack || err}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log('cloud-crypto (CommonJS copy) against the shared vectors');

  await test('parameters match the vectors', () => {
    assert.strictEqual(vectors.version, cc.CLOUD_CRYPTO_VERSION);
    for (const [k, v] of Object.entries(vectors.params)) assert.deepStrictEqual(cc[k], v, k);
  });

  await test('derives every authKey and verifier', async () => {
    for (const d of vectors.derive) {
      const { authKey, wrapKey } = await cc.deriveKeys(d.passphrase, d.salt, d.iter);
      assert.strictEqual(cc.bytesToBase64(authKey), d.authKey);
      assert.strictEqual(await cc.authVerifier(authKey), d.authVerifier);
      assert.strictEqual(wrapKey.extractable, false);
    }
    await assert.rejects(cc.deriveKeys('Kennebec', vectors.derive[0].salt, 1000), RangeError);
  });

  await test('wraps, unwraps (non-extractable) and re-wraps to the vectors', async () => {
    const { wrap, rewrap, keys } = vectors;
    assert.deepStrictEqual(await cc.wrapPrivateKey(keys.history.jwk, wrap.passphrase,
      { iter: wrap.iter, salt: bytes(wrap.salt), iv: bytes(wrap.iv) }), wrap.wrapped);
    const key = await cc.unwrapPrivateKey(wrap.wrapped, wrap.passphrase, keys.history.pub);
    assert.ok(key && key.extractable === false);
    assert.strictEqual(await cc.unwrapPrivateKey(wrap.wrapped, 'wrong word', keys.history.pub), null);
    assert.strictEqual(await cc.unwrapPrivateKey(wrap.wrapped, wrap.passphrase, keys.stationA.pub), null);
    assert.deepStrictEqual(await cc.rewrapPrivateKey(wrap.wrapped, rewrap.oldPassphrase, rewrap.newPassphrase, keys.history.pub,
      { iter: rewrap.iter, salt: bytes(rewrap.salt), iv: bytes(rewrap.iv) }), rewrap.wrapped);
  });

  await test('seals and opens every history row exactly; a moved row will not open', async () => {
    const history = await ring('history');
    for (const r of vectors.rows) {
      assert.deepStrictEqual(await cc.sealRow(vectors.keys.history.pub, { id: r.id, night: r.night, kind: r.kind, record: r.record },
        { ephemeralJwk: vectors.keys[r.ephemeral].jwk, iv: bytes(r.iv) }), r.wire);
      const row = { id: r.id, night: r.night, kind: r.kind, ...r.wire };
      assert.deepStrictEqual(await cc.openRow(history, row), r.record);
      assert.strictEqual(await cc.openRow(history, { ...row, night: '2026-10-21' }), null);
      assert.strictEqual(await cc.openRow(await ring('stationA'), row), null);
    }
  });

  await test('fails closed on every refuse case', async () => {
    for (const r of vectors.refuse) assert.strictEqual(await cc.sealRow(vectors.keys.history.pub, r), null, r.why);
  });

  await test('station bundles: exact, each station opens, the history key cannot', async () => {
    for (const s of vectors.stations) {
      assert.deepStrictEqual(await cc.sealForStations(s.recipients.map((n) => ({ publicKey: vectors.keys[n].pub })),
        { id: s.id, night: s.night, kind: s.kind, record: s.record },
        { ephemeralJwks: s.ephemeral.map((e) => vectors.keys[e].jwk), ivs: s.iv.map(bytes) }), s.bundle);
      for (const name of s.recipients) assert.deepStrictEqual(await cc.openAsStation(await ring(name), s.bundle), s.record);
      assert.strictEqual(await cc.openAsStation(await ring('history'), s.bundle), null);
    }
  });

  await test('identifier tags and church nights', async () => {
    const key = bytes(vectors.tags.stateKey);
    for (const t of vectors.tags.cases) {
      const tag = t.clubberId ? await cc.identityTag(key, t.night, t.clubberId) : await cc.visitorTag(key, t.night, t.name, t.club);
      assert.strictEqual(tag, t.tag);
    }
    for (const n of vectors.nights) assert.strictEqual(cc.churchNight(n.ms), n.night, n.note);
  });

  finished = true;
  if (process.exitCode) console.error('✗ cloud-crypto failed');
  else console.log(`✓ ${passed} cloud-crypto checks passed`);
})();
