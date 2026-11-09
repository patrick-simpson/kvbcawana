// Security, 2026-11-09: what a screen may frame, and where ?config= may point.
import { describe, it, expect } from 'vitest';
import { isHttpsUrl, isHttpsUrlOrEmpty, sameSiteConfigUrl } from './safeUrl.js';
import { parseUrlFlags } from './urlFlags.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';

describe('isHttpsUrl', () => {
  it('takes an https address and nothing else', () => {
    expect(isHttpsUrl('https://onedrive.live.com/embed?resid=1&em=2')).toBe(true);
    for (const bad of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>1</script>',
      'http://onedrive.live.com/embed', 'blob:https://awana.kvbchurch.org/x', '//evil.example/x', '/lobby/x',
      'https://user:pw@onedrive.live.com/', 'https://a b.com/', 'https://x.com/"onload="', '', null, 42,
    ]) expect(isHttpsUrl(bad), String(bad)).toBe(false);
    expect(isHttpsUrlOrEmpty('')).toBe(true);
    expect(isHttpsUrlOrEmpty('javascript:alert(1)')).toBe(false);
  });
});

describe('the PowerPoint address a screen frames', () => {
  it('keeps an https one and drops javascript:, data: and http: from saved settings and ?config=', () => {
    expect(sanitizeOverrides({ powerpointEmbedUrl: 'https://onedrive.live.com/embed?x' })).toEqual({ powerpointEmbedUrl: 'https://onedrive.live.com/embed?x' });
    expect(sanitizeOverrides({ powerpointEmbedUrl: '' })).toEqual({ powerpointEmbedUrl: '' });
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'http://onedrive.live.com/embed']) {
      expect(sanitizeOverrides({ powerpointEmbedUrl: bad, showClock: true })).toEqual({ showClock: true });
    }
  });
});

describe('?config= points only at this site', () => {
  const page = 'https://awana.kvbchurch.org/lobby/?config=x';
  it('takes the page\'s own origin (a path too) and awana.kvbchurch.org', () => {
    expect(sameSiteConfigUrl('https://awana.kvbchurch.org/lobby/fleet.json', page)).toBe('https://awana.kvbchurch.org/lobby/fleet.json');
    expect(sameSiteConfigUrl('/lobby/fleet.json', page)).toBe('https://awana.kvbchurch.org/lobby/fleet.json');
    expect(sameSiteConfigUrl('fleet.json', page)).toBe('https://awana.kvbchurch.org/lobby/fleet.json');
    expect(sameSiteConfigUrl('/x.json', 'http://127.0.0.1:5173/lobby/')).toBe('http://127.0.0.1:5173/x.json');
    expect(sameSiteConfigUrl('https://awana.kvbchurch.org/x.json', 'https://kvbcawana.pages.dev/lobby/')).toBe('https://awana.kvbchurch.org/x.json');
  });
  it('refuses anyone else\'s server, http on the public site, credentials and other schemes', () => {
    for (const bad of [
      'https://evil.example/config.json', '//evil.example/config.json', 'http://awana.kvbchurch.org/x.json',
      'https://awana.kvbchurch.org.evil.example/x.json', 'https://u:p@awana.kvbchurch.org/x.json',
      'javascript:alert(1)', 'data:application/json,{}', '',
    ]) expect(sameSiteConfigUrl(bad, page), bad).toBe(null);
  });
  it('is what parseUrlFlags hands back', () => {
    expect(parseUrlFlags('?config=https://evil.example/c.json', page).configUrl).toBe(null);
    expect(parseUrlFlags('?config=/lobby/fleet.json', page).configUrl).toBe('https://awana.kvbchurch.org/lobby/fleet.json');
  });
});
