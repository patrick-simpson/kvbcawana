import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DISPLAY_KEY_STORAGE,
  loadDisplayKey,
  maskDisplayKey,
  saveDisplayKey,
} from './displayKey.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { parseUrlFlags } from './urlFlags.js';

// THIS FILE GUARDS THREE LEAK PATHS, NOT A STORAGE HELPER.
//
// The display key decrypts children's names. Every other setting in this app
// lives in `awanaConfig.v1` and flows through `sanitizeOverrides`, and each of
// the three consumers of that object is a documented, encouraged workflow that
// would have published the key:
//
//   1. `?config=<url>` merges a remote JSON through sanitizeOverrides, so
//      anything in VALIDATORS is settable from a file at a public URL.
//   2. Settings → Export serialises the overrides to a JSON file that gets
//      emailed and dropped in shared drives.
//   3. `?key=` already carries the Pusher app key on the query string, so a URL
//      is an established place for credentials here — and URLs end up in
//      browser history, screenshots and the shortcut taped to the wall.
//
// The fix is structural rather than three deny-lists: the key lives in its own
// localStorage entry and is simply not part of the object those paths touch.
// These tests assert that stays true, because the failure mode is silent.

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const REAL_KEY = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=';

describe('the key is stored apart from every other setting', () => {
  it('does not live in awanaConfig.v1', () => {
    expect(DISPLAY_KEY_STORAGE).not.toBe('awanaConfig.v1');
    saveDisplayKey(REAL_KEY);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(localStorage.getItem(DISPLAY_KEY_STORAGE)).toBe(REAL_KEY);
  });

  it('round-trips and clears', () => {
    expect(loadDisplayKey()).toBe('');
    saveDisplayKey(REAL_KEY);
    expect(loadDisplayKey()).toBe(REAL_KEY);
    saveDisplayKey('');
    expect(loadDisplayKey()).toBe('');
    expect(localStorage.getItem(DISPLAY_KEY_STORAGE)).toBeNull();
  });

  it('trims a pasted key, because paste picks up whitespace', () => {
    saveDisplayKey(`  ${REAL_KEY}\n`);
    expect(loadDisplayKey()).toBe(REAL_KEY);
  });

  it('survives localStorage being blocked instead of crashing the screen', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(saveDisplayKey(REAL_KEY)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadDisplayKey()).toBe('');
  });

  it('notifies the same tab, not only other tabs', () => {
    const seen = vi.fn();
    window.addEventListener('awana-display-key-change', seen);
    saveDisplayKey(REAL_KEY);
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('awana-display-key-change', seen);
  });
});

describe('leak path 1: a remote ?config= JSON cannot set the key', () => {
  it('drops displayKey from a remote config', () => {
    // A volunteer following the documented fleet-management pattern publishes a
    // JSON at a public URL. If the key were in VALIDATORS, this is the moment
    // the decryption key for children's names went on the open internet.
    const remote = sanitizeOverrides({
      displayKey: REAL_KEY,
      nightTheme: 'christmas',
    });
    expect(remote).not.toHaveProperty('displayKey');
    // ...and a legitimate setting in the same file still applies, so the test
    // fails for the right reason rather than because sanitizeOverrides is inert.
    expect(remote.nightTheme).toBe('christmas');
  });

  it('drops every plausible spelling of it', () => {
    const out = sanitizeOverrides({
      displayKey: REAL_KEY,
      display_key: REAL_KEY,
      awanaDisplayKey: REAL_KEY,
      envelopeKey: REAL_KEY,
      aesKey: REAL_KEY,
    });
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(REAL_KEY);
  });
});

describe('leak path 2: the settings export cannot contain the key', () => {
  it('exports the config overrides, which the key is not part of', () => {
    // exportSettings() serialises exactly the object sanitizeOverrides produces.
    // Reproducing that here rather than mounting the panel keeps the assertion
    // about the DATA, which is what leaks.
    saveDisplayKey(REAL_KEY);
    const overrides = sanitizeOverrides({ nightTheme: 'snowday', displayKey: REAL_KEY });
    const exported = JSON.stringify(overrides, null, 2);
    expect(exported).not.toContain(REAL_KEY);
    expect(exported).toContain('snowday');
  });

  it('importing a file that carries a key does not install it', () => {
    // The reverse direction: someone hand-edits an export to add the key, or a
    // future version exports it. Importing must not honour it.
    const imported = sanitizeOverrides(JSON.parse(
      JSON.stringify({ displayKey: REAL_KEY, showWeatherChip: false })));
    expect(imported).not.toHaveProperty('displayKey');
    expect(loadDisplayKey()).toBe('');
  });
});

describe('leak path 3: the key never travels in a URL', () => {
  it('parseUrlFlags never returns a display key', () => {
    const flags = parseUrlFlags(
      '?key=abc123&cluster=us2&displayKey=' + encodeURIComponent(REAL_KEY)
      + '&display_key=' + encodeURIComponent(REAL_KEY));
    expect(JSON.stringify(flags)).not.toContain(REAL_KEY);
    expect(flags).not.toHaveProperty('displayKey');
    // The Pusher app key IS accepted from the URL — that is deliberate, it is
    // public — so this assertion proves the parser ran rather than no-oped.
    expect(flags.pusherAppKey ?? flags.key).toBeTruthy();
  });
});

describe('masking keeps the key off the screen during setup', () => {
  it('shows only the ends', () => {
    const masked = maskDisplayKey(REAL_KEY);
    expect(masked.startsWith('AQID')).toBe(true);
    expect(masked.endsWith('HyA=')).toBe(true);
    expect(masked).not.toBe(REAL_KEY);
    expect(masked).toContain('•');
  });

  it('does not reveal a short value either', () => {
    expect(maskDisplayKey('abc')).toBe('•••');
    expect(maskDisplayKey('')).toBe('');
    expect(maskDisplayKey(null)).toBe('');
  });
});
