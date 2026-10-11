import { describe, it, expect } from 'vitest';
import { KVBC_FEED_URL, RETRY_AFTER_MS, buildHandoff, isAtLeast, parseFeed, shouldHandOff } from './handoff.js';

const SHA = 'mpwK8cNUcL6ZyyvXWkUxwK2nSoXI4VqLj01eJ8Orkgs/Jic0c0FL2uV6+i1T5F6p2OsRkuR7HFFgNaRnQpLtPQ==';
// The printer feed exactly as printer-release.yml writes it (site/updates/printer/latest.yml).
const FEED = `version: 9.0.0
files:
  - url: https://github.com/patrick-simpson/kvbcawana/releases/download/printer-v9.0.0/KVBC-Awana-Setup.exe
    sha512: ${SHA}
    size: 245760585
path: https://github.com/patrick-simpson/kvbcawana/releases/download/printer-v9.0.0/KVBC-Awana-Setup.exe
sha512: ${SHA}
releaseDate: '2026-10-12T21:02:15.881Z'
`;

describe('the KVBC Awana feed', () => {
  it('reads the installer, its version and its sha512', () => {
    expect(parseFeed(FEED)).toEqual({
      version: '9.0.0',
      url: 'https://github.com/patrick-simpson/kvbcawana/releases/download/printer-v9.0.0/KVBC-Awana-Setup.exe',
      sha512: SHA,
    });
  });

  it('resolves a bare file name against the feed, and refuses other hosts and http', () => {
    expect(parseFeed(FEED.replace(/path: .*/, 'path: KVBC-Awana-Setup.exe'))?.url).toBe('https://awana.kvbchurch.org/updates/printer/KVBC-Awana-Setup.exe');
    expect(parseFeed(FEED.replace(/path: .*/, 'path: https://evil.example/x.exe'))).toBeNull();
    expect(parseFeed(FEED.replace(/path: .*/, 'path: http://github.com/x.exe'))).toBeNull();
    expect(parseFeed(FEED.replace(/^sha512: .*/m, 'sha512: short'))).toBeNull();
    expect(parseFeed('nonsense')).toBeNull();
    expect(KVBC_FEED_URL).toBe('https://awana.kvbchurch.org/updates/printer/latest.yml');
  });
});

describe('when to hand over', () => {
  const feed = (version) => ({ version, url: 'https://github.com/x', sha512: SHA });
  it('only once the printer feed is KVBC Awana 9 or later', () => {
    expect(isAtLeast('9.0.0', '9.0.0')).toBe(true);
    expect(isAtLeast('10.0.0', '9.0.0')).toBe(true);
    expect(isAtLeast('8.12.3', '9.0.0')).toBe(false);
    expect(isAtLeast('9.0.0-beta', '9.0.0')).toBe(false);
    expect(shouldHandOff(feed('8.2.0'), null, 0)).toBe(false);
    expect(shouldHandOff(feed('9.0.0'), null, 0)).toBe(true);
    expect(shouldHandOff(null, null, 0)).toBe(false);
  });

  it('tries the same version once a day, a newer one at once', () => {
    const t = 1_790_000_000_000;
    expect(shouldHandOff(feed('9.0.0'), { version: '9.0.0', at: t }, t + 60_000)).toBe(false);
    expect(shouldHandOff(feed('9.0.0'), { version: '9.0.0', at: t }, t + RETRY_AFTER_MS)).toBe(true);
    expect(shouldHandOff(feed('9.0.1'), { version: '9.0.0', at: t }, t + 60_000)).toBe(true);
  });
});

describe('the hand-off', () => {
  it('carries the screen, monitor, shutdown and Start with Windows, as a display', () => {
    const state = {
      display: { id: 2, label: 'SAMSUNG', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } },
      overrides: { hiddenForWindow: null, manualUntil: 0 },
      settings: { screen: 'projector', shutdown: { enabled: true, at: '20:30' } },
    };
    const h = buildHandoff(state, { version: '2.1.0', userData: 'C:\\Users\\b\\AppData\\Roaming\\Awana Lobby Display', exe: 'C:\\x\\Awana Lobby Display.exe', startWithWindows: true, at: '2026-10-12T00:00:00.000Z' });
    expect(h).toMatchObject({
      kind: 'kvbc-awana-handoff',
      version: 1,
      roles: { print: false, display: true },
      name: 'Sound room',
      display: { settings: state.settings, monitor: state.display },
      startWithWindows: true,
      from: { appId: 'org.kvbc.awana-lobby-display', version: '2.1.0' },
    });
  });

  it('an old state.json with nothing chosen still hands over', () => {
    const h = buildHandoff({}, { version: '2.1.0', userData: 'C:\\u', exe: 'C:\\e.exe', startWithWindows: false, at: 'x' });
    expect(h.display).toEqual({ settings: null, monitor: null });
    expect(h.startWithWindows).toBe(false);
  });
});
