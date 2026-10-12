import { describe, it, expect, beforeEach } from 'vitest';
import { LEGACY_LOGIN_ISSUED_STORAGE, LEGACY_LOGIN_KEY_STORAGE, logout } from './displayLogin.js';
import { DISPLAY_KEY_STORAGE, loadDisplayKey, saveDisplayKey } from './displayKey.js';
import { PUBLISH_TOKEN_STORAGE, loadPublishToken, savePublishToken } from './publishToken.js';
import { loadFleetConfigUrl, saveFleetConfigUrl } from './fleetConfigUrl.js';
import fixture from './__fixtures__/envelope-vectors.json';

beforeEach(() => localStorage.clear());

describe('logout', () => {
  it('forgets the display key, the publish token, the fleet-config URL and the legacy login entries', () => {
    saveDisplayKey(fixture.testKey);
    savePublishToken('abcdefghijklmnopqrstuvwxyz012345');
    saveFleetConfigUrl('https://example.org/screens.json');
    localStorage.setItem(LEGACY_LOGIN_KEY_STORAGE, 'old');
    localStorage.setItem(LEGACY_LOGIN_ISSUED_STORAGE, '123');
    expect(loadDisplayKey()).toBe(fixture.testKey);

    logout();

    expect(loadDisplayKey()).toBe('');
    expect(loadPublishToken()).toBe('');
    expect(loadFleetConfigUrl()).toBe('');
    expect(localStorage.getItem(DISPLAY_KEY_STORAGE)).toBeNull();
    expect(localStorage.getItem(PUBLISH_TOKEN_STORAGE)).toBeNull();
    expect(localStorage.getItem(LEGACY_LOGIN_KEY_STORAGE)).toBeNull();
    expect(localStorage.getItem(LEGACY_LOGIN_ISSUED_STORAGE)).toBeNull();
  });
});
