#!/usr/bin/env node
// Online check-in P2: this computer's station key and the history key it opens
// (print-server/station-keys.js) with a stand-in safeStorage and a stand-in
// Worker. The private key is ONLY ever on disk through safeStorage, and where
// safeStorage cannot encrypt the station role is refused and nothing is written.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function check(name, cond, detail) {
  if (cond) passed++;
  else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

const root = path.join(__dirname, '..');
const cc = require(path.join(root, 'print-server', 'cloud-crypto.js'));
const { createStationKeys, STATION_FILE, HISTORY_FILE } = require(path.join(root, 'print-server', 'station-keys.js'));

// Not real encryption: reversible and unreadable as JSON, which is all the
// test needs (it proves the key reaches disk only THROUGH safeStorage).
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).toString('base64')}`),
  decryptString: (b) => {
    const t = b.toString();
    if (!t.startsWith('ENC:')) throw new Error('not ours');
    return Buffer.from(t.slice(4), 'base64').toString();
  },
});
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-station-'));
const SESSION = 'v1.1760000000.1.abcdefghijklmnopqrstuvwxyz012345';

(async () => {
  console.log('\nstation key: made once, kept only through safeStorage');
  {
    const dir = tmp();
    const calls = [];
    const request = async (base, p, opts) => { calls.push({ base, p, opts }); return { ok: true, status: 200, body: { stations: [] } }; };
    const keys = createStationKeys({ dir, safeStorage: fakeSafe(), request });
    const a = await keys.ensure();
    check('a key is made', a.ok && a.created === true && /^[0-9a-f]{16}$/.test(a.kid) && a.publicKey.length > 80, JSON.stringify(a));
    check('its kid is the public key\'s own', a.kid === await cc.kidOf(a.publicKey));
    const file = path.join(dir, STATION_FILE);
    const onDisk = fs.readFileSync(file);
    const stored = JSON.parse(Buffer.from(onDisk.toString().slice(4), 'base64').toString());
    check('the file is safeStorage\'s (not JSON on disk)', (() => { try { JSON.parse(onDisk.toString()); return false; } catch { return true; } })());
    check('nothing of the private key is readable on disk', !onDisk.toString().includes(stored.privateJwk.d) && !onDisk.toString('latin1').includes('"d"'));
    check('only the encrypted file and no temp are left', fs.readdirSync(dir).join() === STATION_FILE);

    const again = await createStationKeys({ dir, safeStorage: fakeSafe(), request }).ensure();
    check('the same key comes back after a restart', again.ok && again.created === false && again.publicKey === a.publicKey);

    const ring = await keys.ring();
    check('the ring has a NON-extractable private key', ring && ring.privateKey.extractable === false && ring.kid === a.kid);
    const bundle = await cc.sealForStations([{ publicKey: a.publicKey }], { id: cc.newRowId(), night: '2026-10-14', kind: 'print', record: { route: '/print', body: { firstName: 'Ava' } } });
    const opened = await cc.openAsStation(ring, bundle);
    check('a bundle sealed to this station opens with it', opened && opened.body.firstName === 'Ava', JSON.stringify(opened));
    const other = await cc.generateKeyPair();
    const foreign = await cc.sealForStations([{ publicKey: other.publicKey }], { id: cc.newRowId(), night: '2026-10-14', kind: 'print', record: { x: 1 } });
    check('one sealed to another station does not', (await cc.openAsStation(ring, foreign)) === null);

    const reg = await keys.register({ base: 'https://w.test/api', session: SESSION, stationId: 'dev-0123456789abcdef', name: 'Check-in laptop' });
    const c = calls[0];
    check('register posts the PUBLIC key under X-Station', reg.ok && c.p === '/v1/station/register' && c.opts.method === 'POST' && c.opts.station === 'dev-0123456789abcdef'
      && c.opts.session === SESSION && c.opts.body.pub === a.publicKey && c.opts.body.kid === a.kid && c.opts.body.stationId === 'dev-0123456789abcdef'
      && c.opts.body.name === 'Check-in laptop' && !JSON.stringify(c.opts.body).includes(stored.privateJwk.d), JSON.stringify(c.opts));
    const refused = await createStationKeys({ dir, safeStorage: fakeSafe(), request: async () => ({ ok: false, status: 401, body: null }) })
      .register({ base: 'https://w.test/api', session: SESSION, stationId: 'dev-0123456789abcdef' });
    check('a signed-out register says so', refused.ok === false && refused.reason === 'signed-out');
  }

  console.log('\nstation key: fails closed where safeStorage cannot encrypt');
  {
    const dir = tmp();
    let requested = 0;
    const keys = createStationKeys({ dir, safeStorage: fakeSafe(false), request: async () => { requested++; return { ok: true, status: 200, body: {} }; } });
    const e = await keys.ensure();
    check('the station role is refused', e.ok === false && e.reason === 'safe-storage-unavailable' && /cannot be a print station/.test(e.error), JSON.stringify(e));
    check('no ring, no registration, no request', (await keys.ring()) === null
      && (await keys.register({ base: 'https://w.test/api', session: SESSION, stationId: 'x'.repeat(16) })).reason === 'safe-storage-unavailable' && requested === 0);
    check('and NOTHING is written', fs.readdirSync(dir).length === 0, fs.readdirSync(dir).join());
    check('no history key either', (await keys.unlockHistory({ base: 'https://w.test/api', session: SESSION, passphrase: 'kennebec' })).reason === 'safe-storage-unavailable' && requested === 0);
    check('status says refused', keys.status().station === 'refused' && keys.available() === false);
    const throwing = createStationKeys({ dir, safeStorage: { isEncryptionAvailable() { throw new Error('boom'); } }, request: async () => ({}) });
    check('a safeStorage that throws is unavailable too', (await throwing.ensure()).ok === false);
    check('no safeStorage at all is unavailable', (await createStationKeys({ dir, safeStorage: null, request: async () => ({}) }).ensure()).ok === false);
  }

  console.log('\nstation key: a damaged or foreign file is replaced, never trusted');
  {
    const dir = tmp();
    const safe = fakeSafe();
    fs.writeFileSync(path.join(dir, STATION_FILE), Buffer.from('garbage'));
    const k = await createStationKeys({ dir, safeStorage: safe, request: async () => ({}) }).ensure();
    check('garbage makes a fresh key', k.ok && k.created === true);
    // a stored pair whose private half is not the public half's
    const a = await cc.generateKeyPair();
    const b = await cc.generateKeyPair();
    fs.writeFileSync(path.join(dir, STATION_FILE), safe.encryptString(JSON.stringify({ v: 1, publicKey: a.publicKey, kid: a.kid, privateJwk: b.privateJwk })));
    const k2 = await createStationKeys({ dir, safeStorage: safe, request: async () => ({}) }).ensure();
    check('a mismatched pair is not used', k2.ok && k2.created === true && k2.publicKey !== a.publicKey);
  }

  console.log('\nhistory key: unwrapped with the passphrase at setup, kept through safeStorage');
  {
    const dir = tmp();
    const hist = await cc.createHistoryKey('Kennebec 1');
    let answer = { ok: true, status: 200, body: { pub: hist.pub, kid: hist.kid, wrapped: hist.wrapped } };
    const calls = [];
    const request = async (base, p, opts) => { calls.push({ p, opts }); return answer; };
    const keys = createStationKeys({ dir, safeStorage: fakeSafe(), request });
    check('before setup there is nothing to read with', (await keys.historyRing()) === null && keys.historyPub() === null && keys.status().history === 'locked');

    const wrong = await keys.unlockHistory({ base: 'https://w.test/api', session: SESSION, stationId: 'dev-0123456789abcdef', passphrase: 'not it' });
    check('a wrong passphrase opens nothing and writes nothing', wrong.ok === false && wrong.reason === 'wrong-passphrase' && !fs.existsSync(path.join(dir, HISTORY_FILE)));
    const ok = await keys.unlockHistory({ base: 'https://w.test/api', session: SESSION, stationId: 'dev-0123456789abcdef', passphrase: '  KENNEBEC 1 ' });
    check('the right one (normalized as every client does) opens it', ok.ok === true && ok.kid === hist.kid, JSON.stringify(ok));
    check('the key is fetched with the session and the station id', calls.at(-1).p === '/v1/history/key' && calls.at(-1).opts.session === SESSION && calls.at(-1).opts.station === 'dev-0123456789abcdef');
    const onDisk = fs.readFileSync(path.join(dir, HISTORY_FILE));
    const kept = JSON.parse(Buffer.from(onDisk.toString().slice(4), 'base64').toString());
    check('it is kept encrypted, and the passphrase is not kept at all', !onDisk.toString().includes(kept.jwk.d) && !onDisk.toString().includes('ennebec') && !JSON.stringify(kept).includes('ennebec'));

    const ring = await keys.historyRing();
    const row = await cc.sealRow(hist.pub, { id: cc.newRowId(), night: '2026-10-14', kind: 'checkin', record: { first: 'Ava' } });
    const rowId = cc.newRowId();
    const sealed = await cc.sealRow(hist.pub, { id: rowId, night: '2026-10-14', kind: 'checkin', record: { first: 'Ava', ts: 1 } });
    const opened = await cc.openRow(ring, { id: rowId, night: '2026-10-14', kind: 'checkin', v: 1, ...sealed });
    check('the history ring opens rows sealed to history:pub', row && opened && opened.first === 'Ava' && ring.privateKey.extractable === false, JSON.stringify(opened));

    const after = createStationKeys({ dir, safeStorage: fakeSafe(), request });
    check('and it is still there after a restart', (await after.historyRing()) !== null && after.historyPub() === hist.pub && after.status().history === 'ready');
    after.forgetHistory();
    check('forgetting it removes the file', !fs.existsSync(path.join(dir, HISTORY_FILE)) && (await after.historyRing()) === null);

    answer = { ok: false, status: 404, body: null };
    check('no history key yet says so', (await keys.unlockHistory({ base: 'b', session: SESSION, passphrase: 'x' })).reason === 'no-history-key');
    answer = { ok: true, status: 200, body: { pub: hist.pub, kid: '0000000000000000', wrapped: hist.wrapped } };
    check('a kid that is not the pub\'s is refused', (await keys.unlockHistory({ base: 'b', session: SESSION, passphrase: 'Kennebec 1' })).reason === 'bad-history-key');
    const stranger = await cc.createHistoryKey('Kennebec 1');
    answer = { ok: true, status: 200, body: { pub: stranger.pub, kid: stranger.kid, wrapped: hist.wrapped } };
    check('a wrap that is another key\'s is refused', (await keys.unlockHistory({ base: 'b', session: SESSION, passphrase: 'Kennebec 1' })).reason === 'wrong-passphrase');
    answer = { ok: false, status: 0, body: null };
    check('an unreachable service is not a wrong passphrase', (await keys.unlockHistory({ base: 'b', session: SESSION, passphrase: 'x' })).reason === 'unreachable');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
