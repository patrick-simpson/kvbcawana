import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  FLEET_CONFIG_URL_CHANGE_EVENT,
  FLEET_CONFIG_URL_MAX,
  FLEET_CONFIG_URL_STORAGE,
  isValidFleetConfigUrl,
  loadFleetConfigUrl,
  resolveRemoteConfigUrl,
  saveFleetConfigUrl,
} from './fleetConfigUrl.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { parseUrlFlags } from './urlFlags.js';
import fixture from './__fixtures__/envelope-vectors.json';

// The fleet-config URL (#394) is NOT a secret — it is an address, and the
// public JSON it points at holds display preferences, never child data. It
// still gets its own storage entry, and these are the SAME three leak-path
// tests the display key, the publish token and the login key each carry,
// because the thing being protected here is the settings object's meaning:
// anything in VALIDATORS is settable by `?config=` and written out by
// Settings → Export, so putting this there would let a remote config file
// repoint the screen at a DIFFERENT remote config file with no operator in
// the loop, and would put the URL into every exported settings file.

const URL_ = fixture.provision.bundle.configUrl;

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('the URL is stored apart from every other setting', () => {
  it('does not live in awanaConfig.v1', () => {
    expect(FLEET_CONFIG_URL_STORAGE).not.toBe('awanaConfig.v1');
    saveFleetConfigUrl(URL_);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(localStorage.getItem(FLEET_CONFIG_URL_STORAGE)).toBe(URL_);
  });

  it('round-trips, trims and clears', () => {
    expect(loadFleetConfigUrl()).toBe('');
    saveFleetConfigUrl(`  ${URL_}  `);
    expect(loadFleetConfigUrl()).toBe(URL_);
    saveFleetConfigUrl('');
    expect(loadFleetConfigUrl()).toBe('');
  });

  it('survives blocked storage instead of crashing the screen', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(saveFleetConfigUrl(URL_)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(loadFleetConfigUrl()).toBe('');
  });

  it('notifies the same tab, not only other tabs', () => {
    const seen = vi.fn();
    window.addEventListener(FLEET_CONFIG_URL_CHANGE_EVENT, seen);
    saveFleetConfigUrl(URL_);
    expect(seen).toHaveBeenCalled();
    window.removeEventListener(FLEET_CONFIG_URL_CHANGE_EVENT, seen);
  });
});

describe('https only, capped, and re-validated on the way out', () => {
  it('accepts an https URL within the cap', () => {
    expect(isValidFleetConfigUrl(URL_)).toBe(true);
    expect(FLEET_CONFIG_URL_MAX).toBe(200);
  });

  it('refuses http, other schemes, credentials, control characters and over-length', () => {
    for (const bad of [
      'http://example.org/a.json',
      'ftp://example.org/a.json',
      'javascript:alert(1)',
      '//example.org/a.json',
      'https://user:pw@example.org/a.json',
      `https://example.org/${'a'.repeat(FLEET_CONFIG_URL_MAX)}`,
      // WHATWG URL silently STRIPS newlines, so the control-character check
      // has to run before parsing or this would sneak through.
      'https://example.org/a\nb.json',
      '', '   ', null, undefined, 42, {},
    ]) {
      expect(isValidFleetConfigUrl(bad)).toBe(false);
    }
  });

  it('an unusable value CLEARS the slot rather than being stored', () => {
    saveFleetConfigUrl(URL_);
    saveFleetConfigUrl('http://example.org/a.json');
    expect(loadFleetConfigUrl()).toBe('');
    expect(localStorage.getItem(FLEET_CONFIG_URL_STORAGE)).toBeNull();
  });

  it('a hand-edited storage entry pointing at http is ignored on read', () => {
    localStorage.setItem(FLEET_CONFIG_URL_STORAGE, 'http://example.org/a.json');
    expect(loadFleetConfigUrl()).toBe('');
  });
});

describe('leak path 1: a remote ?config= JSON cannot set the URL', () => {
  it('drops it from a remote config, while a real setting still applies', () => {
    // The one that matters: a remote config that could set this would be able
    // to repoint the screen at a different remote config, with no operator.
    const remote = sanitizeOverrides({ configUrl: URL_, nightTheme: 'christmas' });
    expect(remote).not.toHaveProperty('configUrl');
    expect(remote.nightTheme).toBe('christmas');
  });

  it('drops every plausible spelling', () => {
    const out = sanitizeOverrides({
      configUrl: URL_, config_url: URL_, awanaFleetConfigUrl: URL_,
      fleetConfigUrl: URL_, settingsUrl: URL_, remoteConfigUrl: URL_, config: URL_,
    });
    expect(Object.keys(out)).toEqual([]);
    expect(JSON.stringify(out)).not.toContain('example.org');
  });

  it('a full ?config= round trip never yields the URL back', () => {
    // What App.jsx does with a fetched remote config: sanitizeOverrides, then
    // it becomes the remote layer. Nothing in that layer can be the URL.
    saveFleetConfigUrl(URL_);
    const fetched = JSON.parse(JSON.stringify({ configUrl: URL_, fleetConfigUrl: URL_, showWeatherChip: false }));
    const layer = sanitizeOverrides(fetched);
    expect(JSON.stringify(layer)).not.toContain('example.org');
    expect(layer.showWeatherChip).toBe(false);
  });
});

describe('leak path 2: the settings export cannot contain the URL', () => {
  it('exports the config overrides, which the URL is not part of', () => {
    saveFleetConfigUrl(URL_);
    const overrides = sanitizeOverrides({ nightTheme: 'snowday', configUrl: URL_, fleetConfigUrl: URL_ });
    const exported = JSON.stringify(overrides, null, 2);
    expect(exported).not.toContain(URL_);
    expect(exported).not.toContain('example.org');
    expect(exported).toContain('snowday');
  });

  it('importing a file that carries one does not install it', () => {
    const imported = sanitizeOverrides(JSON.parse(JSON.stringify({ fleetConfigUrl: URL_, showWeatherChip: false })));
    expect(imported).not.toHaveProperty('fleetConfigUrl');
    expect(loadFleetConfigUrl()).toBe('');
  });
});

describe('leak path 3: URL flags never return it as a setting', () => {
  it('parseUrlFlags exposes ?config= as the flag it has always been, and nothing new', () => {
    const flags = parseUrlFlags(`?key=pk&cluster=us2&fleetConfigUrl=${encodeURIComponent(URL_)}&configUrl=${encodeURIComponent(URL_)}`);
    expect(flags).not.toHaveProperty('fleetConfigUrl');
    expect(flags.configUrl).toBeNull();
    expect(JSON.stringify(flags)).not.toContain('example.org');
  });

  it('an explicit ?config= still wins over a provisioned one — the person at the screen outranks the server', () => {
    saveFleetConfigUrl(URL_);
    // resolveRemoteConfigUrl is exactly what App.jsx calls, so this is the
    // real precedence rule and not a re-implementation of it.
    expect(resolveRemoteConfigUrl(parseUrlFlags('?config=https://typed.example/x.json').configUrl, loadFleetConfigUrl()))
      .toBe('https://typed.example/x.json');
    expect(resolveRemoteConfigUrl(parseUrlFlags('?key=pk').configUrl, loadFleetConfigUrl())).toBe(URL_);
  });
});

describe('resolveRemoteConfigUrl — the one rule App.jsx applies', () => {
  it('is null when there is neither, which is the defaults-only case', () => {
    expect(resolveRemoteConfigUrl(null, '')).toBeNull();
    expect(resolveRemoteConfigUrl(undefined, undefined)).toBeNull();
    expect(resolveRemoteConfigUrl('', '   ')).toBeNull();
  });

  it('uses the provisioned URL when no flag is present', () => {
    expect(resolveRemoteConfigUrl(null, URL_)).toBe(URL_);
  });

  it('re-checks the provisioned one — it is the half that arrived over the wire', () => {
    expect(resolveRemoteConfigUrl(null, 'http://example.org/a.json')).toBeNull();
    expect(resolveRemoteConfigUrl(null, 'javascript:alert(1)')).toBeNull();
  });

  it('honours an http ?config= flag, because that path already did and is typed by a human', () => {
    // parseUrlFlags already allows http on the flag (an OBS embed on a LAN);
    // this function must not quietly change that behaviour, only add the
    // provisioned source beneath it.
    expect(resolveRemoteConfigUrl('http://192.168.1.5/awana.json', URL_)).toBe('http://192.168.1.5/awana.json');
  });
});
