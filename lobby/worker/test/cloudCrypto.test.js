// The Worker's side of lobby/shared/cloud-crypto.js: only the cheap pieces run
// here (the verifier hash and the identifier tags; every derivation, seal and
// open is a client's, ROADMAP.md#online-check-in). Pins that the module loads
// in the Worker's environment and that its night key is the watcher's.
import { describe, expect, it } from 'vitest';
import { authVerifier, base64ToBytes, churchNight, identityTag } from '../../shared/cloud-crypto.js';
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
});
