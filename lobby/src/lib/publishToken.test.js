import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PUBLISH_TOKEN_STORAGE,
  loadPublishToken,
  maskPublishToken,
  savePublishToken,
} from './publishToken.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { parseUrlFlags } from './urlFlags.js';

// THIS FILE GUARDS THE SAME THREE LEAK PATHS displayKey.test.js DOES, for the
// slide publish token. The token lets its holder put text on every lobby TV
// (given loopback access to the print server), so it must never ride the
// settings export, a ?config= file, or a URL — and the fix is the same
// structural one: it is simply not part of the object those paths touch.

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const TOKEN = 'tok_AbCdEfGhIjKlMnOpQrStUvWx';

describe('the token is stored apart from every other setting', () => {
  it('does not live in awanaConfig.v1', () => {
    expect(PUBLISH_TOKEN_STORAGE).not.toBe('awanaConfig.v1');
    savePublishToken(TOKEN);
    expect(localStorage.getItem('awanaConfig.v1')).toBeNull();
    expect(localStorage.getItem(PUBLISH_TOKEN_STORAGE)).toBe(TOKEN);
  });

  it('round-trips, trims, and clears', () => {
    expect(loadPublishToken()).toBe('');
    savePublishToken(`  ${TOKEN}\n`);
    expect(loadPublishToken()).toBe(TOKEN);
    savePublishToken('');
    expect(loadPublishToken()).toBe('');
    expect(localStorage.getItem(PUBLISH_TOKEN_STORAGE)).toBeNull();
  });

  it('survives blocked storage instead of crashing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(savePublishToken(TOKEN)).toBe(false);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(loadPublishToken()).toBe('');
  });

  it('notifies the same tab on change', () => {
    const seen = vi.fn();
    window.addEventListener('awana-publish-token-change', seen);
    savePublishToken(TOKEN);
    expect(seen).toHaveBeenCalled();
    window.removeEventListener('awana-publish-token-change', seen);
  });
});

describe('leak path 1: a remote ?config= JSON cannot set the token', () => {
  it('drops every plausible spelling', () => {
    const out = sanitizeOverrides({
      slidesPublishToken: TOKEN,
      publishToken: TOKEN,
      publish_token: TOKEN,
      awanaPublishToken: TOKEN,
      nightTheme: 'christmas',
    });
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    // A legitimate key in the same file still applies — the sanitizer ran.
    expect(out.nightTheme).toBe('christmas');
  });
});

describe('leak path 2: the settings export cannot contain the token', () => {
  it('exports the overrides object, which the token is not part of', () => {
    savePublishToken(TOKEN);
    const exported = JSON.stringify(sanitizeOverrides({ nightTheme: 'snowday', slidesPublishToken: TOKEN }));
    expect(exported).not.toContain(TOKEN);
    expect(exported).toContain('snowday');
  });

  it('importing a file that carries a token does not install it', () => {
    const imported = sanitizeOverrides({ slidesPublishToken: TOKEN, showWeatherChip: false });
    expect(imported).not.toHaveProperty('slidesPublishToken');
    expect(loadPublishToken()).toBe('');
  });
});

describe('leak path 3: the token never travels in a URL', () => {
  it('parseUrlFlags never returns a publish token', () => {
    const flags = parseUrlFlags(
      '?key=abc123&cluster=us2&slidesPublishToken=' + encodeURIComponent(TOKEN)
      + '&publishToken=' + encodeURIComponent(TOKEN));
    expect(JSON.stringify(flags)).not.toContain(TOKEN);
    expect(flags.pusherAppKey ?? flags.key).toBeTruthy();
  });
});

describe('masking keeps the token off the screen', () => {
  it('shows only the ends', () => {
    const masked = maskPublishToken(TOKEN);
    expect(masked.startsWith('tok_')).toBe(true);
    expect(masked.endsWith(TOKEN.slice(-4))).toBe(true);
    expect(masked).toContain('•');
    expect(masked).not.toBe(TOKEN);
  });

  it('handles short and empty values', () => {
    expect(maskPublishToken('abc')).toBe('•••');
    expect(maskPublishToken('')).toBe('');
    expect(maskPublishToken(null)).toBe('');
  });
});
