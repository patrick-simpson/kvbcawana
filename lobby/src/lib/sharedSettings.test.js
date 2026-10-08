import { describe, expect, it } from 'vitest';
import vectors from './__fixtures__/contract-vectors.json';
import { RETIRED_SHARED, SHARED_KEYS, SHARED_SPEC, isSharedKey, pickShared, sanitizeSettingsPayload, sanitizeSharedValues } from './sharedSettings.js';
import defaults from '../config.js';

describe('the shared settings table', () => {
  it('is the contract’s, key for key and rule for rule', () => {
    expect(SHARED_SPEC).toEqual(vectors.events.settings.keys);
  });

  it('every shared key is a real config key with a default, but the retired ones, which are not keys at all', () => {
    for (const key of SHARED_KEYS) {
      expect(Object.prototype.hasOwnProperty.call(defaults, key), key).toBe(!RETIRED_SHARED.includes(key));
    }
    // Retired keys are still the contract's (printer first), so still accepted.
    for (const key of RETIRED_SHARED) expect(SHARED_KEYS, key).toContain(key);
  });

  it('a frame carrying a retired key is accepted, and the value reaches no setting', async () => {
    const { resolveStoredConfig, sanitizeOverrides } = await import('../hooks/useConfig.js');
    const out = sanitizeSettingsPayload({ rev: 3, publishedAt: '2026-10-08T18:00:00.000Z', settings: { checkoutBoardMode: 'off', checkoutBoardFrom: '19:00', checkoutBoardNamesAbove: 5 } });
    expect(out.settings).toEqual({ checkoutBoardMode: 'off', checkoutBoardFrom: '19:00', checkoutBoardNamesAbove: 5 });
    const resolved = resolveStoredConfig({}, {}, out);
    expect(resolved.checkoutBoardNamesAbove).toBe(5);
    for (const key of RETIRED_SHARED) expect(resolved, key).not.toHaveProperty(key);
    // An old screen's saved values are dropped the same way.
    expect(sanitizeOverrides({ checkoutBoardMode: 'off', checkoutBoardFrom: '19:35', checkoutBoardUntil: '20:30', cornerStillHere: false }))
      .toEqual({ cornerStillHere: false });
  });

  it('keeps every per-screen and secret thing off the wire (owner, 2026-10-01: hardware and location stay put)', () => {
    for (const key of [
      'backgroundSource', 'powerpointEmbedUrl', 'slideshowDelaySec', 'useLocalSlideshow', 'manualSlides',
      'audioMuted', 'keepScreenAwake', 'reduceMotion', 'confettiLevel', 'panicMode', 'showConnectionStatus',
      'pusherAppKey', 'pusherCluster', 'followPublishedSlides', 'followSharedSettings',
      'sharedScheduleUrl', 'sharedThemeUrl', 'watchdogReloadMin', 'displayKey', 'slidesPublishToken',
    ]) {
      expect(isSharedKey(key), key).toBe(false);
    }
  });
});

describe('sanitizeSettingsPayload', () => {
  it('keeps a valid payload exactly', () => {
    for (const v of vectors.events.settings.valid) expect(sanitizeSettingsPayload(v)).toEqual(v);
  });

  it('a club line loses its markup and keeps its words', () => {
    const out = sanitizeSettingsPayload(vectors.events.settings.dirty[0].payload);
    expect(out.settings).toEqual({ clubPhrases: { sparks: 'alert(1) Go!' }, milestoneEvery: 25 });
  });

  it('drops values outside their rule rather than coercing them', () => {
    expect(sanitizeSettingsPayload(vectors.events.settings.dirty[1].payload).settings).toEqual({});
  });

  it('repairs lists and clamps numbers the way the printer does', () => {
    expect(sanitizeSharedValues({ bookMilestones: [25, 5, 5, 0, 2.4, 'x'], standardDisplayMs: 1, weatherLon: -999 }))
      .toEqual({ bookMilestones: [2, 5, 25], standardDisplayMs: 2000, weatherLon: -180 });
  });

  it('cannot be ordered without a real publishedAt', () => {
    expect(sanitizeSettingsPayload({ rev: 1, publishedAt: 'soon', settings: {} })).toBeNull();
  });
});

describe('pickShared', () => {
  it('takes this screen’s shared values, and only those', () => {
    const picked = pickShared({ ...defaults, backgroundSource: 'video', milestoneEvery: 30 });
    expect(picked.milestoneEvery).toBe(30);
    expect(Object.keys(picked).every(isSharedKey)).toBe(true);
    expect('backgroundSource' in picked).toBe(false);
    // The defaults themselves are all publishable; a retired key is never published.
    expect(Object.keys(pickShared(defaults)).sort()).toEqual(SHARED_KEYS.filter((k) => !RETIRED_SHARED.includes(k)).sort());
  });
});
