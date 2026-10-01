import { describe, expect, it } from 'vitest';
import vectors from './__fixtures__/contract-vectors.json';
import { SHARED_KEYS, SHARED_SPEC, isSharedKey, pickShared, sanitizeSettingsPayload, sanitizeSharedValues } from './sharedSettings.js';
import defaults from '../config.js';

describe('the shared settings table', () => {
  it('is the contract’s, key for key and rule for rule', () => {
    expect(SHARED_SPEC).toEqual(vectors.events.settings.keys);
  });

  it('every shared key is a real config key with a default', () => {
    for (const key of SHARED_KEYS) expect(Object.prototype.hasOwnProperty.call(defaults, key), key).toBe(true);
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
    // The defaults themselves are all publishable.
    expect(Object.keys(pickShared(defaults)).sort()).toEqual([...SHARED_KEYS].sort());
  });
});
