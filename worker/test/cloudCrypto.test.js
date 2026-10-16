// The Worker's side of shared/cloud-crypto.js: only the cheap pieces run
// here (the verifier hash and the identifier tags; every derivation, seal and
// open is a client's, ROADMAP.md#online-check-in). Pins that the module loads
// in the Worker's environment and that its night key is the watcher's.
import { describe, expect, it } from 'vitest';
import { authVerifier, base64ToBytes, churchNight, generateKeyPair, identityTag, importPrivateKey, keyRing, openAsStation, sealForStations } from '../../shared/cloud-crypto.js';
import vectors from '../../shared/cloud-vectors.json';
import { localTime } from '../src/watcher.js';

describe('cloud-crypto in the Worker', () => {
  it('churchNight is watcher.js localTime().date, hour by hour across both clock changes', () => {
    const starts = [Date.UTC(2026, 2, 7), Date.UTC(2026, 9, 31), Date.UTC(2026, 9, 13)];
    for (const start of starts) {
      for (let h = 0; h < 72; h++) {
        const ms = start + h * 3600_000 + 59 * 60_000;
        expect(churchNight(ms)).toBe(localTime(ms).date);
      }
    }
  });

  it('computes the verifier and the identifier tags of the vectors', async () => {
    const d = vectors.derive[0];
    expect(await authVerifier(d.authKey)).toBe(d.authVerifier);
    const t = vectors.tags.cases[0];
    expect(await identityTag(/** @type {Uint8Array} */ (base64ToBytes(vectors.tags.stateKey)), t.night, t.clubberId)).toBe(t.tag);
  });
  // The watcher seals a TwoTimTwo-page check-in's print job to the stations
  // itself (owner, 2026-10-12). The free plan allows 10 ms of CPU per request;
  // ECDH P-256 is native in WebCrypto. Node here is not workerd, so this is a
  // sanity bound, not the Worker's own figure: the number is printed.
  it('seals a print job to three stations well inside the free plan CPU budget', async () => {
    const stations = [];
    const rings = [];
    for (let i = 0; i < 3; i++) {
      const kp = await generateKeyPair();
      stations.push({ publicKey: kp.publicKey });
      rings.push(await keyRing(await importPrivateKey(kp.privateJwk), kp.publicKey));
    }
    const item = { id: 'jobAAAAAAAAAAAAAAAAAAA', night: '2026-10-14', kind: 'print', record: { name: 'Sam', club: 'Sparks' } };
    await sealForStations(stations, item); // warm up
    const runs = 20;
    const t0 = performance.now();
    let bundle;
    for (let i = 0; i < runs; i++) bundle = await sealForStations(stations, item);
    const ms = (performance.now() - t0) / runs;
    console.warn(`sealForStations to ${stations.length} stations: ${ms.toFixed(2)} ms per job`);
    expect(bundle.to).toHaveLength(3);
    expect((await openAsStation(rings[1], bundle)).name).toBe('Sam');
    expect(ms).toBeLessThan(10);
  });
});
