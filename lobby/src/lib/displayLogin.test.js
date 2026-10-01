import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  LOGIN_KEY_STORAGE,
  LOGIN_ISSUED_STORAGE,
  PROVISION_CHANNEL,
  PROVISION_EVENT,
  applyProvisionBundle,
  deriveLoginKey,
  getSnapshot,
  isProvisionBundle,
  isProvisionFrame,
  loadLoginKey,
  loginWithPassphrase,
  logout,
  noteCacheMiss,
  normalizePassphrase,
  openProvisionFrame,
  receiveProvisionFrame,
  saveLoginKey,
  subscribe,
  _resetForTest,
  _settleForTest,
} from './displayLogin.js';
import { DISPLAY_KEY_STORAGE, loadDisplayKey } from './displayKey.js';
import { PUBLISH_TOKEN_STORAGE, loadPublishToken } from './publishToken.js';
import { FLEET_CONFIG_URL_STORAGE, loadFleetConfigUrl, saveFleetConfigUrl } from './fleetConfigUrl.js';
import { importDisplayKey, sealForTest, fromBase64 } from './envelope.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { parseUrlFlags } from './urlFlags.js';
import fixture from './__fixtures__/envelope-vectors.json';

// THIS FILE GUARDS THE SAME THREE LEAK PATHS displayKey.test.js DOES, plus the
// interop with the print server's KDF. The login key unlocks the display key,
// so it is stored apart from every other setting for the same reasons — and
// the derivation must match the Node implementation byte for byte or no screen
// can ever log in. The fixture's `provision` section pins that.

const P = fixture.provision;
const REAL_KEY = fixture.testKey;

beforeEach(() => {
  localStorage.clear();
  _resetForTest();
  vi.restoreAllMocks();
});
afterEach(async () => { await _settleForTest(); });

describe('the login key is stored apart from every other setting', () => {
  it('does not live in awanaConfig.v1 (neither does the issuedAt stamp)', () => {
    expect(LOGIN_KEY_STORAGE).not.toBe('awanaConfig.v1');
    expect(LOGIN_ISSUED_STORAGE).not.toBe('awanaConfig.v1');
    saveLoginKey(P.derivedKey);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(localStorage.getItem(LOGIN_KEY_STORAGE)).toBe(P.derivedKey);
  });

  it('round-trips, trims and clears', () => {
    expect(loadLoginKey()).toBe('');
    saveLoginKey(`  ${P.derivedKey}\n`);
    expect(loadLoginKey()).toBe(P.derivedKey);
    saveLoginKey('');
    expect(localStorage.getItem(LOGIN_KEY_STORAGE)).toBeNull();
  });

  it('survives blocked storage instead of crashing the screen', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveLoginKey(P.derivedKey)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadLoginKey()).toBe('');
  });

  it('notifies the same tab', () => {
    const seen = vi.fn();
    window.addEventListener('awana-login-key-change', seen);
    saveLoginKey(P.derivedKey);
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('awana-login-key-change', seen);
  });
});

describe('leak path 1: a remote ?config= JSON cannot carry a login key or passphrase', () => {
  it('drops every plausible spelling', () => {
    const out = sanitizeOverrides({
      loginKey: 'x', awanaLoginKey: 'x', displayLoginKey: 'x', displayLoginPassphrase: 'x',
      passphrase: 'x', displayLogin: 'x', loginPassphrase: 'x',
    });
    expect(Object.keys(out)).toEqual([]);
  });

  // ...nor the NON-secret third thing the same bundle now carries (#394). It
  // is an address, not a credential, but a remote config able to set it could
  // repoint the screen at a different remote config with no operator in the
  // loop — so it stays out of VALIDATORS for the same structural reason.
  it('drops the fleet-config URL the bundle delivers, however it is spelled', () => {
    const out = sanitizeOverrides({
      configUrl: P.bundle.configUrl, fleetConfigUrl: P.bundle.configUrl,
      awanaFleetConfigUrl: P.bundle.configUrl, settingsUrl: P.bundle.configUrl,
    });
    expect(Object.keys(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('example.org');
  });
});

describe('leak path 2: Settings export/import never sees it', () => {
  it('saving a login key adds nothing to the config object', () => {
    saveLoginKey(P.derivedKey);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(sanitizeOverrides({ awanaLoginKey: P.derivedKey })).toEqual({});
  });

  it('applying a whole bundle leaves the config object untouched, URL included', () => {
    applyProvisionBundle(P.bundle);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    // What exportSettings() actually writes out is this object.
    const exported = JSON.stringify(sanitizeOverrides({ nightTheme: 'snowday' }), null, 2);
    expect(exported).not.toContain(P.bundle.displayKey);
    expect(exported).not.toContain(P.bundle.slidesPublishToken);
    expect(exported).not.toContain(P.bundle.configUrl);
    expect(exported).toContain('snowday');
  });
});

describe('leak path 3: URL flags never carry it', () => {
  it('parseUrlFlags ignores ?passphrase= and ?loginKey=', () => {
    const flags = parseUrlFlags('?key=pk&cluster=us2&passphrase=abcd-efgh-ijkm-npqr&loginKey=zzz&displayKey=zzz');
    expect(JSON.stringify(flags)).not.toMatch(/abcd-efgh|zzz/);
  });

  it('a provisioned settings URL is not a URL flag, and an explicit ?config= outranks it', () => {
    applyProvisionBundle(P.bundle);
    expect(parseUrlFlags('?key=pk').configUrl).toBeNull();
    // App.jsx resolves FLAGS.configUrl || the provisioned one, in that order:
    // the person standing at the screen outranks the print server.
    expect(parseUrlFlags('?key=pk').configUrl || loadFleetConfigUrl()).toBe(P.bundle.configUrl);
    expect(parseUrlFlags('?config=https://typed.example/x.json').configUrl || loadFleetConfigUrl())
      .toBe('https://typed.example/x.json');
  });
});

describe('interop with the print server (fixture.provision)', () => {
  it('names the channel and event the server publishes on', () => {
    expect(PROVISION_EVENT).toBe(P.event);
    expect(PROVISION_CHANNEL).toBe(P.channel.replace('<pusherChannel>', 'awana-channel'));
  });

  it('derives the same key as Node PBKDF2-SHA256, byte for byte', async () => {
    const derived = await deriveLoginKey(P.testPassphrase, P.testSalt, P.kdf.iterations);
    expect(derived).toBe(P.derivedKey);
    const imported = await importDisplayKey(derived);
    expect(imported.kid).toBe(P.kid);
    expect(P.frame.envelope.kid).toBe(P.kid);
  });

  it('normalises like the server: trim, then NFKC', async () => {
    expect(normalizePassphrase('  ａbcd \n')).toBe('abcd');
    const fw = await deriveLoginKey(P.testPassphrase.replace('a', 'ａ'), P.testSalt, P.kdf.iterations);
    const ws = await deriveLoginKey(`  ${P.testPassphrase}\n`, P.testSalt, P.kdf.iterations);
    expect(fw).toBe(P.derivedKey);
    expect(ws).toBe(P.derivedKey);
  });

  it('opens the fixture frame to the fixture bundle', async () => {
    const res = await openProvisionFrame(P.frame, P.derivedKey);
    expect(res.ok).toBe(true);
    expect(res.bundle).toEqual(P.bundle);
  });

  it('a wrong passphrase presents as kid-mismatch', async () => {
    const wrong = await deriveLoginKey('definitely-not-the-passphrase', P.testSalt, P.kdf.iterations);
    const res = await openProvisionFrame(P.frame, wrong);
    expect(res).toEqual({ ok: false, reason: 'kid-mismatch' });
  });

  it('a tampered ciphertext presents as auth-failed', async () => {
    const ct = fromBase64(P.frame.envelope.ct);
    ct[5] ^= 0xff;
    const tampered = { ...P.frame, envelope: { ...P.frame.envelope, ct: btoa(String.fromCharCode(...ct)) } };
    const res = await openProvisionFrame(tampered, P.derivedKey);
    expect(res).toEqual({ ok: false, reason: 'auth-failed' });
  });
});

describe('strict shapes', () => {
  it('accepts the fixture frame and rejects malformed ones', () => {
    expect(isProvisionFrame(P.frame)).toBe(true);
    expect(isProvisionFrame(null)).toBe(false);
    expect(isProvisionFrame({ ...P.frame, v: 2 })).toBe(false);
    expect(isProvisionFrame({ ...P.frame, kdf: undefined })).toBe(false);
    expect(isProvisionFrame({ ...P.frame, kdf: { ...P.frame.kdf, name: 'scrypt' } })).toBe(false);
    expect(isProvisionFrame({ ...P.frame, kdf: { ...P.frame.kdf, iterations: 1000 } })).toBe(false);
    expect(isProvisionFrame({ ...P.frame, kdf: { ...P.frame.kdf, iterations: 5e6 } })).toBe(false);
    expect(isProvisionFrame({ ...P.frame, kdf: { ...P.frame.kdf, salt: 'AAAAAAAAAAA=' } })).toBe(false); // 8 bytes
    expect(isProvisionFrame({ ...P.frame, envelope: { v: 1, kid: 'x' } })).toBe(false);
    expect(isProvisionFrame({ v: 1, displayKey: REAL_KEY, slidesPublishToken: '', issuedAt: 'x' })).toBe(false); // a plaintext bundle
  });

  it('accepts the fixture bundle and rejects implausible ones', () => {
    expect(isProvisionBundle(P.bundle)).toBe(true);
    expect(isProvisionBundle({ ...P.bundle, displayKey: 'nope' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, displayKey: '' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, slidesPublishToken: 'too short' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, slidesPublishToken: '' })).toBe(true);
    expect(isProvisionBundle({ ...P.bundle, issuedAt: 'yesterday-ish' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, v: 2 })).toBe(false);
  });

  it('a bundle with an implausible key is rejected whole — nothing is written', async () => {
    const bad = await sealForTest(fromBase64(P.derivedKey), PROVISION_EVENT, { ...P.bundle, displayKey: 'nope' });
    const res = await openProvisionFrame({ ...P.frame, envelope: bad }, P.derivedKey);
    expect(res).toEqual({ ok: false, reason: 'malformed' });
    expect(loadDisplayKey()).toBe('');
    expect(loadPublishToken()).toBe('');
  });
});

describe('applying a bundle', () => {
  it('writes exactly the display key + publish token + settings-URL slots, never config', () => {
    expect(applyProvisionBundle(P.bundle)).toBe(true);
    expect(localStorage.getItem(DISPLAY_KEY_STORAGE)).toBe(P.bundle.displayKey);
    expect(localStorage.getItem(PUBLISH_TOKEN_STORAGE)).toBe(P.bundle.slidesPublishToken);
    expect(localStorage.getItem(FLEET_CONFIG_URL_STORAGE)).toBe(P.bundle.configUrl);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(Number(localStorage.getItem(LOGIN_ISSUED_STORAGE))).toBe(Date.parse(P.bundle.issuedAt));
    // Exactly four entries, all of them named here — no fifth slot appeared.
    expect(Object.keys(localStorage).sort()).toEqual(
      [DISPLAY_KEY_STORAGE, PUBLISH_TOKEN_STORAGE, FLEET_CONFIG_URL_STORAGE, LOGIN_ISSUED_STORAGE].sort());
  });

  // The fleet-config URL (#394). Non-secret, own slot, and deploy-order safe:
  // ABSENT means "this publisher predates the field" (keep what we have),
  // '' means "the operator cleared it" (drop it).
  it('an ABSENT configUrl is no news — a screen keeps the URL it already had', () => {
    saveFleetConfigUrl(P.bundle.configUrl);
    const { configUrl, ...older } = P.bundle;
    expect(configUrl).toBeTruthy();
    applyProvisionBundle(older);
    expect(loadFleetConfigUrl()).toBe(P.bundle.configUrl);
  });

  it('an EMPTY configUrl clears it — that is how a cleared URL propagates', () => {
    saveFleetConfigUrl(P.bundle.configUrl);
    applyProvisionBundle({ ...P.bundle, configUrl: '' });
    expect(loadFleetConfigUrl()).toBe('');
    // ...and the secrets still landed.
    expect(loadDisplayKey()).toBe(P.bundle.displayKey);
  });

  it('a bundle with a non-https configUrl is rejected WHOLE — nothing is written', () => {
    expect(isProvisionBundle({ ...P.bundle, configUrl: 'http://example.org/a.json' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, configUrl: 'javascript:alert(1)' })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, configUrl: 42 })).toBe(false);
    expect(isProvisionBundle({ ...P.bundle, configUrl: '' })).toBe(true);
    expect(loadDisplayKey()).toBe('');
    expect(loadFleetConfigUrl()).toBe('');
  });

  it('logout forgets the settings URL along with the secrets', () => {
    applyProvisionBundle(P.bundle);
    logout();
    expect(loadFleetConfigUrl()).toBe('');
  });

  it('an empty token clears the slot (a revoked token must not linger)', () => {
    localStorage.setItem(PUBLISH_TOKEN_STORAGE, 'tok_AbCdEfGhIjKlMnOpQrStUvWx');
    applyProvisionBundle({ ...P.bundle, slidesPublishToken: '' });
    expect(loadPublishToken()).toBe('');
  });

  it('ignores a replayed (older) bundle on the automatic path', async () => {
    localStorage.setItem(LOGIN_ISSUED_STORAGE, String(Date.parse(P.bundle.issuedAt) + 60000));
    const res = await openProvisionFrame(P.frame, P.derivedKey);
    expect(res).toEqual({ ok: false, reason: 'stale' });
  });
});

describe('the store: frames, login, logout', () => {
  it('starts waiting, notes a cache miss, and a good frame makes it received', () => {
    expect(getSnapshot().frameStatus).toBe('waiting');
    noteCacheMiss();
    expect(getSnapshot().frameStatus).toBe('miss');
    receiveProvisionFrame({ junk: true });
    expect(getSnapshot().frameStatus).toBe('miss');
    receiveProvisionFrame(P.frame);
    expect(getSnapshot().frameStatus).toBe('received');
    noteCacheMiss(); // a late miss never demotes a received frame
    expect(getSnapshot().frameStatus).toBe('received');
  });

  it('a frame with no login key stored writes nothing', async () => {
    receiveProvisionFrame(P.frame);
    await _settleForTest();
    expect(loadDisplayKey()).toBe('');
    expect(getSnapshot().loginStatus).toBe('logged-out');
  });

  it('logging in with the right passphrase stores the login key and applies the bundle', async () => {
    const seen = vi.fn();
    const unsub = subscribe(seen);
    receiveProvisionFrame(P.frame);
    const result = await loginWithPassphrase(P.testPassphrase);
    expect(result).toBe('logged-in');
    expect(loadLoginKey()).toBe(P.derivedKey);
    expect(loadDisplayKey()).toBe(P.bundle.displayKey);
    expect(loadPublishToken()).toBe(P.bundle.slidesPublishToken);
    expect(getSnapshot().loginStatus).toBe('logged-in');
    expect(getSnapshot().kid).toBe(P.kid);
    expect(seen).toHaveBeenCalled();
    unsub();
  });

  it('the wrong passphrase writes nothing and says so', async () => {
    receiveProvisionFrame(P.frame);
    expect(await loginWithPassphrase('wrong-wrong-wrong')).toBe('wrong');
    expect(getSnapshot().loginStatus).toBe('wrong');
    expect(loadLoginKey()).toBe('');
    expect(loadDisplayKey()).toBe('');
  });

  it('no frame yet → no-frame, and the passphrase is parked for when one lands', async () => {
    expect(await loginWithPassphrase(P.testPassphrase)).toBe('no-frame');
    expect(getSnapshot().pendingLogin).toBe(true);
    expect(getSnapshot().loginStatus).toBe('logged-out');
    // Parked in MEMORY: nothing about it reaches storage (leak paths stay closed).
    expect(JSON.stringify(localStorage)).not.toContain(P.testPassphrase);
    receiveProvisionFrame(P.frame);
    await _settleForTest();
    expect(getSnapshot().loginStatus).toBe('logged-in');
    expect(getSnapshot().pendingLogin).toBe(false);
    expect(loadDisplayKey()).toBe(P.bundle.displayKey);
  });

  it('a wrong parked passphrase ends as wrong and writes nothing', async () => {
    expect(await loginWithPassphrase('wrong-wrong-wrong')).toBe('no-frame');
    receiveProvisionFrame(P.frame);
    await _settleForTest();
    expect(getSnapshot().loginStatus).toBe('wrong');
    expect(getSnapshot().pendingLogin).toBe(false);
    expect(loadLoginKey()).toBe('');
    expect(loadDisplayKey()).toBe('');
  });

  it('logout clears a parked passphrase', async () => {
    await loginWithPassphrase(P.testPassphrase);
    logout();
    expect(getSnapshot().pendingLogin).toBe(false);
    receiveProvisionFrame(P.frame);
    await _settleForTest();
    expect(getSnapshot().loginStatus).toBe('logged-out');
    expect(loadDisplayKey()).toBe('');
  });

  it('a logged-in screen applies the next frame automatically (rotation follows)', async () => {
    saveLoginKey(P.derivedKey);
    _resetForTest();
    expect(getSnapshot().loginStatus).toBe('logged-in');
    receiveProvisionFrame(P.frame);
    await _settleForTest();
    expect(loadDisplayKey()).toBe(P.bundle.displayKey);
    expect(getSnapshot().loginStatus).toBe('logged-in');
  });

  it('a frame the stored key cannot open marks the login stale, and keeps the keys', async () => {
    saveLoginKey(P.derivedKey);
    localStorage.setItem(DISPLAY_KEY_STORAGE, REAL_KEY);
    _resetForTest();
    const other = await deriveLoginKey('some-other-passphrase', P.testSalt, P.kdf.iterations);
    const env = await sealForTest(fromBase64(other), PROVISION_EVENT, P.bundle);
    receiveProvisionFrame({ ...P.frame, envelope: env });
    await _settleForTest();
    expect(getSnapshot().loginStatus).toBe('stale');
    expect(loadDisplayKey()).toBe(REAL_KEY);
  });

  it('logout forgets the login key AND both provisioned secrets', async () => {
    receiveProvisionFrame(P.frame);
    await loginWithPassphrase(P.testPassphrase);
    logout();
    expect(loadLoginKey()).toBe('');
    expect(loadDisplayKey()).toBe('');
    expect(loadPublishToken()).toBe('');
    expect(localStorage.getItem(LOGIN_ISSUED_STORAGE)).toBeNull();
    expect(getSnapshot().loginStatus).toBe('logged-out');
  });
});
