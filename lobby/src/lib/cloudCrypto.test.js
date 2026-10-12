// @vitest-environment node
// lobby/shared/cloud-crypto.js against its deterministic vectors
// (lobby/shared/cloud-vectors.json; printer/scripts/test-cloud-crypto.cjs runs
// the same vectors through the generated CommonJS copy). Every PBKDF2 here is
// the real 600000 iterations, so the slow cases carry their own timeout.
import { describe, expect, it } from 'vitest';
import * as cc from '../../shared/cloud-crypto.js';
import vectors from '../../shared/cloud-vectors.json';
import { normalizeSyncPassphrase } from './syncSpecs.js';

const SLOW = 60_000;
const bytes = (b64) => /** @type {Uint8Array} */ (cc.base64ToBytes(b64));
const ring = async (name) => cc.keyRing(await cc.importPrivateKey(vectors.keys[name].jwk), vectors.keys[name].pub);

describe('cloud-crypto: parameters', () => {
  it('the vectors were made with these parameters', () => {
    expect(vectors.version).toBe(cc.CLOUD_CRYPTO_VERSION);
    for (const [k, v] of Object.entries(vectors.params)) expect(cc[k]).toEqual(v);
    expect(cc.PBKDF2_ITER).toBe(600000);
    expect([cc.PBKDF2_ITER_MIN, cc.PBKDF2_ITER_MAX]).toEqual([600000, 2000000]);
  });

  it('normalizes the passphrase exactly as the sync service does', () => {
    for (const p of ['Kennebec', '  KENNEBEC ', 'ｋｅｎｎｅｂｅｃ', 'İstanbul', 'Straße', '', null, undefined, 42]) {
      expect(cc.normalizePassphrase(p)).toBe(normalizeSyncPassphrase(p));
    }
  });

  it('every fixed key is a P-256 pair whose kid is its fingerprint', async () => {
    for (const k of Object.values(vectors.keys)) {
      expect(cc.bytesToBase64(cc.rawFromJwk(k.jwk))).toBe(k.pub);
      expect(await cc.kidOf(k.pub)).toBe(k.kid);
      expect(await cc.keyMatches(await cc.importPrivateKey(k.jwk), k.pub)).toBe(true);
    }
    expect(await cc.keyMatches(await cc.importPrivateKey(vectors.keys.history.jwk), vectors.keys.stationA.pub)).toBe(false);
  });
});

describe('cloud-crypto: the passphrase', () => {
  it('derives each vector\'s authKey and verifier', async () => {
    for (const d of vectors.derive) {
      const { authKey, wrapKey } = await cc.deriveKeys(d.passphrase, d.salt, d.iter);
      expect(cc.bytesToBase64(authKey)).toBe(d.authKey);
      expect(await cc.authVerifier(authKey)).toBe(d.authVerifier);
      expect(wrapKey.extractable).toBe(false);
      expect(wrapKey.algorithm).toMatchObject({ name: 'AES-GCM', length: 256 });
    }
    // Normalized first: the same word typed differently is the same key.
    expect(vectors.derive[0].authKey).toBe(vectors.derive[1].authKey);
  }, SLOW);

  it('refuses a cheap or absurd iteration count, a short salt and an empty word', async () => {
    const salt = vectors.derive[0].salt;
    await expect(cc.deriveKeys('Kennebec', salt, 599999)).rejects.toThrow(RangeError);
    await expect(cc.deriveKeys('Kennebec', salt, 2000001)).rejects.toThrow(RangeError);
    await expect(cc.deriveKeys('Kennebec', salt, 600000.5)).rejects.toThrow(RangeError);
    await expect(cc.deriveKeys('Kennebec', cc.bytesToBase64(new Uint8Array(15)), 600000)).rejects.toThrow(RangeError);
    await expect(cc.deriveKeys('   ', salt, 600000)).rejects.toThrow(RangeError);
  });
});

describe('cloud-crypto: the wrapped history key', () => {
  const { wrap, rewrap, keys } = vectors;

  it('wraps to exactly the vector, and unwraps into a non-extractable key that is history:pub\'s', async () => {
    const again = await cc.wrapPrivateKey(keys.history.jwk, wrap.passphrase, { iter: wrap.iter, salt: bytes(wrap.salt), iv: bytes(wrap.iv) });
    expect(again).toEqual(wrap.wrapped);
    expect(Object.keys(again).sort()).toEqual(['ct', 'iter', 'iv', 'salt', 'v']);
    const key = await cc.unwrapPrivateKey(wrap.wrapped, wrap.passphrase, keys.history.pub);
    expect(key).not.toBeNull();
    expect(key?.extractable).toBe(false);
    expect(await cc.keyMatches(/** @type {CryptoKey} */ (key), keys.history.pub)).toBe(true);
    await expect(crypto.subtle.exportKey('jwk', /** @type {CryptoKey} */ (key))).rejects.toThrow();
  }, SLOW);

  it('will not unwrap with the wrong word, for another public key, or once anything changed', async () => {
    expect(await cc.unwrapPrivateKey(wrap.wrapped, 'kennebeck', keys.history.pub)).toBeNull();
    expect(await cc.unwrapPrivateKey(wrap.wrapped, wrap.passphrase, keys.stationA.pub)).toBeNull();
    const ct = bytes(wrap.wrapped.ct); ct[5] ^= 1;
    expect(await cc.unwrapPrivateKey({ ...wrap.wrapped, ct: cc.bytesToBase64(ct) }, wrap.passphrase, keys.history.pub)).toBeNull();
    expect(await cc.unwrapPrivateKey({ ...wrap.wrapped, iter: 1000 }, wrap.passphrase, keys.history.pub)).toBeNull();
    expect(await cc.unwrapPrivateKey({ ...wrap.wrapped, v: 2 }, wrap.passphrase, keys.history.pub)).toBeNull();
  }, SLOW);

  it('re-wraps for a new passphrase to exactly the vector; the old word no longer opens it', async () => {
    const again = await cc.rewrapPrivateKey(wrap.wrapped, rewrap.oldPassphrase, rewrap.newPassphrase, keys.history.pub,
      { iter: rewrap.iter, salt: bytes(rewrap.salt), iv: bytes(rewrap.iv) });
    expect(again).toEqual(rewrap.wrapped);
    expect(rewrap.wrapped.salt).not.toBe(wrap.wrapped.salt);
    expect(await cc.unwrapPrivateKey(rewrap.wrapped, rewrap.newPassphrase, keys.history.pub)).not.toBeNull();
    expect(await cc.unwrapPrivateKey(rewrap.wrapped, rewrap.oldPassphrase, keys.history.pub)).toBeNull();
    expect(await cc.rewrapPrivateKey(wrap.wrapped, 'not the word', rewrap.newPassphrase, keys.history.pub)).toBeNull();
  }, SLOW);

  it('a new history key comes back wrapped, with fresh salts each time', async () => {
    const a = await cc.createHistoryKey('Kennebec');
    const b = await cc.createHistoryKey('Kennebec');
    expect(a.pub).not.toBe(b.pub);
    expect(a.wrapped.salt).not.toBe(b.wrapped.salt);
    expect(a.wrapped.iter).toBe(cc.PBKDF2_ITER);
    expect(a.kid).toBe(await cc.kidOf(a.pub));
    expect(Object.keys(a).sort()).toEqual(['kid', 'pub', 'wrapped']);
  }, SLOW);
});

describe('cloud-crypto: history rows', () => {
  it('seals each vector row to exactly its wire form, and opens it again', async () => {
    const history = await ring('history');
    for (const r of vectors.rows) {
      const wire = await cc.sealRow(vectors.keys.history.pub, { id: r.id, night: r.night, kind: r.kind, record: r.record },
        { ephemeralJwk: vectors.keys[r.ephemeral].jwk, iv: bytes(r.iv) });
      expect(wire).toEqual(r.wire);
      expect(Object.keys(r.wire).sort()).toEqual(['ct', 'epk', 'iv', 'kid', 'v']);
      expect(await cc.openRow(history, { id: r.id, night: r.night, kind: r.kind, ...r.wire })).toEqual(r.record);
    }
  });

  it('every row is the same size, whatever is in it', () => {
    const sizes = new Set(vectors.rows.map((r) => bytes(r.wire.ct).length));
    expect([...sizes]).toEqual([cc.ROW_PAD + 16]);
  });

  it('will not open a row moved to another id, night or kind, or with another key', async () => {
    const history = await ring('history');
    const r = vectors.rows[0];
    const row = { id: r.id, night: r.night, kind: r.kind, ...r.wire };
    expect(await cc.openRow(history, { ...row, id: vectors.rows[1].id })).toBeNull();
    expect(await cc.openRow(history, { ...row, night: '2026-10-21' })).toBeNull();
    expect(await cc.openRow(history, { ...row, kind: 'undo' })).toBeNull();
    expect(await cc.openRow(history, { ...row, epk: vectors.rows[1].wire.epk })).toBeNull();
    expect(await cc.openRow(await ring('stationA'), row)).toBeNull();
    expect(await cc.openRow(history, null)).toBeNull();
  });

  it('a live seal uses a fresh ephemeral key and IV every time', async () => {
    const history = await ring('history');
    const row = { id: cc.newRowId(), night: '2026-10-14', kind: 'checkin', record: { ts: 'x', first: 'Ava' } };
    const a = await cc.sealRow(vectors.keys.history.pub, row);
    const b = await cc.sealRow(vectors.keys.history.pub, row);
    expect(a && b).toBeTruthy();
    expect(a?.epk).not.toBe(b?.epk);
    expect(a?.iv).not.toBe(b?.iv);
    expect(await cc.openRow(history, { ...row, ...a })).toEqual(row.record);
    expect(row.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('fails closed: no sealed form for a medical key, an oversize row or a bad field', async () => {
    for (const r of vectors.refuse) {
      expect(await cc.sealRow(vectors.keys.history.pub, r), r.why).toBeNull();
    }
    expect(await cc.sealRow('not a key', { ...vectors.rows[0], record: { first: 'Ava' } })).toBeNull();
  });
});

describe('cloud-crypto: stations', () => {
  it('seals each vector bundle to exactly its wire form; each station opens its copy', async () => {
    for (const s of vectors.stations) {
      const bundle = await cc.sealForStations(s.recipients.map((n) => ({ publicKey: vectors.keys[n].pub })),
        { id: s.id, night: s.night, kind: s.kind, record: s.record },
        { ephemeralJwks: s.ephemeral.map((e) => vectors.keys[e].jwk), ivs: s.iv.map(bytes) });
      expect(bundle).toEqual(s.bundle);
      for (const name of s.recipients) expect(await cc.openAsStation(await ring(name), s.bundle)).toEqual(s.record);
      // The history key (anyone holding the passphrase) cannot read it: medical notes are station-only.
      expect(await cc.openAsStation(await ring('history'), s.bundle)).toBeNull();
    }
  });

  it('pads on the station ladder and refuses a partial bundle', async () => {
    for (const s of vectors.stations) {
      for (const w of s.bundle.to) expect(cc.STATION_PAD_LADDER).toContain(bytes(w.ct).length - 16);
    }
    const item = { id: cc.newRowId(), night: '2026-10-14', kind: 'job', record: { first: 'Ava' } };
    expect(await cc.sealForStations([], item)).toBeNull();
    expect(await cc.sealForStations([{ publicKey: vectors.keys.stationA.pub }, { publicKey: 'junk' }], item)).toBeNull();
    const stationAad = cc.stationAad(item.id, item.night, item.kind, cc.rawFromJwk(vectors.keys.eph1.jwk), vectors.keys.stationA.kid);
    const rowAad = cc.rowAad(item.id, item.night, item.kind, cc.rawFromJwk(vectors.keys.eph1.jwk), vectors.keys.stationA.kid);
    expect(stationAad && rowAad && cc.bytesToBase64(stationAad)).not.toBe(rowAad && cc.bytesToBase64(rowAad));
  });

  it('a station bundle moved to another night will not open', async () => {
    const s = vectors.stations[0];
    expect(await cc.openAsStation(await ring('stationA'), { ...s.bundle, night: '2026-10-21' })).toBeNull();
  });
});

describe('cloud-crypto: identifiers, nights, padding', () => {
  it('keys a child (and a visitor) the same way every time, per night', async () => {
    const key = bytes(vectors.tags.stateKey);
    for (const t of vectors.tags.cases) {
      const tag = t.clubberId ? await cc.identityTag(key, t.night, t.clubberId) : await cc.visitorTag(key, t.night, t.name, t.club);
      expect(tag).toBe(t.tag);
    }
    expect(vectors.tags.cases[0].tag).not.toBe(vectors.tags.cases[1].tag);
    expect(vectors.tags.cases[2].tag).toBe(vectors.tags.cases[3].tag);
    expect(await cc.identityTag(key, '2026-10-14', 'abc')).toBeNull();
    expect(await cc.identityTag(key, '20261014', '1')).toBeNull();
    expect(await cc.identityTag(new Uint8Array(8), '2026-10-14', '1')).toBeNull();
    expect(await cc.visitorTag(key, '2026-10-14', '   ', 'Sparks')).toBeNull();
  });

  it('the night is the church\'s local date, never UTC', () => {
    for (const n of vectors.nights) expect(cc.churchNight(n.ms), n.note).toBe(n.night);
  });

  it('pads with a length prefix and unpads exactly', () => {
    const msg = cc.utf8('héllo');
    const p = cc.pad(msg, 64);
    expect(p.length).toBe(64);
    expect(cc.unpad(p)).toEqual(msg);
    expect(() => cc.pad(new Uint8Array(61), 64)).toThrow(RangeError);
    expect(cc.rowPadSize(cc.ROW_PAD - 4)).toBe(cc.ROW_PAD);
    expect(cc.rowPadSize(cc.ROW_PAD - 3)).toBeNull();
    expect(cc.stationPadSize(5000)).toBe(16384);
    expect(cc.stationPadSize(2_000_000)).toBeNull();
    expect(cc.hasMedicalKey({ a: [{ b: { Allergies: '' } }] })).toBe(true);
    expect(cc.hasMedicalKey({ first: 'Ava', club: 'Sparks' })).toBe(false);
  });
});
