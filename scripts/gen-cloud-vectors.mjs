#!/usr/bin/env node
// Writes lobby/shared/cloud-vectors.json: deterministic test vectors for every
// construction in lobby/shared/cloud-crypto.js (fixed keys, salts, IVs and
// ephemeral keys). The lobby (vitest) and the printer (node) reproduce them
// byte for byte.
//
//   node scripts/gen-cloud-vectors.mjs
//
// Run it ONLY for a deliberate format change. The fixed keys are kept from the
// existing file (they are made once), so a rerun with no format change writes
// the same file. Every name here is made up.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cc from '../lobby/shared/cloud-crypto.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'lobby/shared/cloud-vectors.json');
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;


const fixed = (seed, n) => Uint8Array.from({ length: n }, (_, i) => (seed * 31 + i * 7) & 0xff);
const b64 = cc.bytesToBase64;

async function keyNamed(name) {
  const old = prev?.keys?.[name];
  if (old) return old;
  const pair = await cc.generateKeyPair();
  return { jwk: pair.privateJwk, pub: pair.publicKey, kid: pair.kid };
}

const keys = {};
for (const name of ['history', 'stationA', 'stationB', 'eph1', 'eph2', 'eph3', 'eph4', 'eph5']) keys[name] = await keyNamed(name);

const derive = [];
for (const [passphrase, saltSeed, iter] of [['Kennebec', 1, 600000], ['  KENNEBEC  ', 1, 600000], ['awana rocks 2026', 2, 600001]]) {
  const salt = fixed(saltSeed, 16);
  const { authKey } = await cc.deriveKeys(passphrase, salt, iter);
  derive.push({ passphrase, salt: b64(salt), iter, authKey: b64(authKey), authVerifier: await cc.authVerifier(authKey) });
}

const wrapOpts = { iter: 600000, salt: fixed(3, 16), iv: fixed(4, 12) };
const wrapped = await cc.wrapPrivateKey(keys.history.jwk, 'Kennebec', wrapOpts);
const rewrapOpts = { iter: 600000, salt: fixed(5, 16), iv: fixed(6, 12) };
const rewrapped = await cc.rewrapPrivateKey(wrapped, 'Kennebec', 'new word 2027', keys.history.pub, rewrapOpts);

const night = '2026-10-14';
const rowCases = [
  { id: 'AAAAAAAAAAAAAAAAAAAAAA', kind: 'checkin', eph: 'eph1', iv: fixed(7, 12),
    record: { ts: '2026-10-14T22:31:05.000Z', clubberId: '100234', first: 'Ava', last: 'Example', club: 'Sparks', items: ['Attendance', 'Bible'], via: 'desk' } },
  { id: 'BBBBBBBBBBBBBBBBBBBBBB', kind: 'friend', eph: 'eph2', iv: fixed(8, 12),
    record: { ts: '2026-10-14T22:40:00.000Z', clubberId: '100777', first: 'Zoë', last: 'Sample', club: 'T&T', friendFirst: 'Mateo' } },
  { id: 'CCCCCCCCCCCCCCCCCCCCCC', kind: 'undo', eph: 'eph3', iv: fixed(9, 12),
    record: { ts: '2026-10-14T22:45:12.000Z', clubberId: '100234', club: 'Sparks' } },
];
const rows = [];
for (const r of rowCases) {
  const wire = await cc.sealRow(keys.history.pub, { id: r.id, night, kind: r.kind, record: r.record }, { ephemeralJwk: keys[r.eph].jwk, iv: r.iv });
  if (!wire) throw new Error(`row ${r.id} did not seal`);
  rows.push({ id: r.id, night, kind: r.kind, record: r.record, ephemeral: r.eph, iv: b64(r.iv), wire });
}

const stationCases = [
  { id: 'DDDDDDDDDDDDDDDDDDDDDD', kind: 'job', ephs: ['eph4', 'eph5'], ivs: [fixed(10, 12), fixed(11, 12)],
    record: { ts: '2026-10-14T22:31:05.000Z', jobId: 'DDDDDDDDDDDDDDDDDDDDDD', first: 'Ava', last: 'Example', club: 'Sparks', allergies: 'Peanuts (made up)', items: ['Attendance', 'Bible'] } },
  { id: 'EEEEEEEEEEEEEEEEEEEEEE', kind: 'roster', ephs: ['eph5', 'eph4'], ivs: [fixed(12, 12), fixed(13, 12)],
    record: { ts: '2026-10-14T21:00:00.000Z', kids: Array.from({ length: 40 }, (_, i) => ({ id: String(100000 + i), first: `Kid${i}`, last: 'Sample', club: ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'][i % 6], allergies: i % 7 === 0 ? 'Made-up allergy' : '' })) } },
];
const stations = [];
for (const s of stationCases) {
  const recipients = ['stationA', 'stationB'];
  const bundle = await cc.sealForStations(recipients.map((n) => ({ publicKey: keys[n].pub })),
    { id: s.id, night, kind: s.kind, record: s.record },
    { ephemeralJwks: s.ephs.map((e) => keys[e].jwk), ivs: s.ivs });
  if (!bundle) throw new Error(`station bundle ${s.id} did not seal`);
  stations.push({ id: s.id, night, kind: s.kind, record: s.record, recipients, ephemeral: s.ephs, iv: s.ivs.map(b64), bundle });
}

const stateKey = fixed(14, 32);
const tags = [
  { night, clubberId: '100234', tag: await cc.identityTag(stateKey, night, '100234') },
  { night: '2026-10-21', clubberId: '100234', tag: await cc.identityTag(stateKey, '2026-10-21', '100234') },
  { night, name: '  Mateo   GARCÍA ', club: 'Sparks', tag: await cc.visitorTag(stateKey, night, '  Mateo   GARCÍA ', 'Sparks') },
  { night, name: 'mateo garcía', club: 'sparks', tag: await cc.visitorTag(stateKey, night, 'mateo garcía', 'sparks') },
];

const nights = [
  { ms: Date.UTC(2026, 9, 15, 3, 59), night: '2026-10-14', note: '11:59 pm Wednesday Eastern (EDT) is still Wednesday' },
  { ms: Date.UTC(2026, 9, 15, 4, 0), night: '2026-10-15', note: 'midnight Eastern (EDT)' },
  { ms: Date.UTC(2026, 11, 3, 4, 30), night: '2026-12-02', note: '11:30 pm Wednesday Eastern (EST), already Thursday in UTC' },
  { ms: Date.UTC(2026, 10, 1, 5, 30), night: '2026-11-01', note: 'the morning the clocks go back' },
];

const refuse = [
  { why: 'a medical key in a history row', id: 'FFFFFFFFFFFFFFFFFFFFFF', night, kind: 'checkin', record: { first: 'Ava', allergies: 'made up' } },
  { why: 'nested medical key', id: 'FFFFFFFFFFFFFFFFFFFFFF', night, kind: 'checkin', record: { kid: { first: 'Ava', medicalNotes: 'made up' } } },
  { why: 'too big for ROW_PAD', id: 'FFFFFFFFFFFFFFFFFFFFFF', night, kind: 'checkin', record: { first: 'x'.repeat(1100) } },
  { why: 'a UTC-looking night', id: 'FFFFFFFFFFFFFFFFFFFFFF', night: '2026-10-15T02:00', kind: 'checkin', record: { first: 'Ava' } },
  { why: 'a row id that is not 22 base64url characters', id: 'short', night, kind: 'checkin', record: { first: 'Ava' } },
  { why: 'a kind with a capital', id: 'FFFFFFFFFFFFFFFFFFFFFF', night, kind: 'Checkin', record: { first: 'Ava' } },
];

const out = {
  version: cc.CLOUD_CRYPTO_VERSION,
  about: 'Deterministic vectors for lobby/shared/cloud-crypto.js (scripts/gen-cloud-vectors.mjs). Every name is made up. Never regenerate to make a test pass.',
  params: {
    PBKDF2_ITER: cc.PBKDF2_ITER, PBKDF2_ITER_MIN: cc.PBKDF2_ITER_MIN, PBKDF2_ITER_MAX: cc.PBKDF2_ITER_MAX,
    INFO_AUTH: cc.INFO_AUTH, INFO_WRAP: cc.INFO_WRAP, INFO_HIST: cc.INFO_HIST, INFO_STATION: cc.INFO_STATION,
    AAD_WRAP: cc.AAD_WRAP, AAD_HIST: cc.AAD_HIST, AAD_STATION: cc.AAD_STATION,
    ROW_PAD: cc.ROW_PAD, STATION_PAD_LADDER: cc.STATION_PAD_LADDER,
  },
  keys,
  derive,
  wrap: { passphrase: 'Kennebec', iter: wrapOpts.iter, salt: b64(wrapOpts.salt), iv: b64(wrapOpts.iv), wrapped },
  rewrap: { oldPassphrase: 'Kennebec', newPassphrase: 'new word 2027', iter: rewrapOpts.iter, salt: b64(rewrapOpts.salt), iv: b64(rewrapOpts.iv), wrapped: rewrapped },
  rows,
  stations,
  tags: { stateKey: b64(stateKey), cases: tags },
  nights,
  refuse,
};

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)}`);
