import { beforeEach, describe, expect, it } from 'vitest';
import {
  CLASSIC_SECTIONS, LEGACY_TABS, RAIL_STORAGE, SECTIONS, classicOpeningSection, classicSectionsFor, openingSection, phaseWords, railMode,
  resolveClassicSection, resolveSection, sectionsFor,
} from './settingsSections.js';

describe('the new rail (docs/SETTINGS-OVERHAUL.md section 1)', () => {
  it('is eight sections since the reorganize, in club-night order: Tonight, Printing … Account & app', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['tonight', 'printing', 'screens', 'show', 'look', 'journey', 'history', 'account']);
    expect(SECTIONS.map((s) => s.label)).toEqual(['Tonight', 'Printing', 'Screens', 'What screens show', 'Slides & look', 'Journey', 'History', 'Account & app']);
    for (const s of SECTIONS) {
      expect(s.blurb.length).toBeGreaterThan(0);
      // Plain words: no jargon in a blurb, and no blurb longer than the rail can show.
      expect(s.blurb, s.id).not.toMatch(/phase|sync|config|dashboard|print server|shared settings/i);
      expect(s.blurb.length, s.id).toBeLessThanOrEqual(42);
    }
  });

  it('shows the page all eight, a TV four, and a screen opened from the page three', () => {
    expect(sectionsFor(true).map((s) => s.id)).toEqual(['tonight', 'printing', 'screens', 'show', 'look', 'journey', 'history', 'account']);
    expect(sectionsFor(false).map((s) => s.id)).toEqual(['tonight', 'show', 'look', 'account']);
    expect(sectionsFor(true, { remote: true }).map((s) => s.id)).toEqual(['tonight', 'show', 'look']);
    expect(sectionsFor(false, { remote: true }).map((s) => s.id)).toEqual(['tonight', 'show', 'look']);
  });

  it('keeps the page-only sections off a TV', () => {
    for (const remote of [false, true]) {
      const ids = sectionsFor(false, { remote }).map((s) => s.id);
      for (const only of ['screens', 'printing', 'journey', 'history']) expect(ids).not.toContain(only);
    }
  });

  it('resolves every old id to the section that holds its controls', () => {
    expect(LEGACY_TABS).toEqual({
      status: 'tonight', checkins: 'show', slides: 'look', screen: 'show', celebrations: 'show', pickup: 'show',
      setup: 'account', laptop: 'printing', connection: 'account', background: 'look', banners: 'show', display: 'show', calendar: 'look',
    });
    for (const [old, now] of Object.entries(LEGACY_TABS)) expect(resolveSection(old)).toBe(now);
    for (const s of SECTIONS) expect(resolveSection(s.id)).toBe(s.id);
    expect(resolveSection('journey')).toBe('journey');
    expect(resolveSection('nope')).toBeNull();
    expect(resolveSection(null)).toBeNull();
  });

  it('opens where the owner needs to be', () => {
    // the page: Account & app until signed in, else Tonight
    expect(openingSection(null, { page: true, signedIn: false })).toBe('account');
    expect(openingSection(null, { page: true, signedIn: true })).toBe('tonight');
    // a TV: account when it cannot work, tonight when anything is wrong, else show
    expect(openingSection(null, { status: 'off' })).toBe('account');
    expect(openingSection(null, { status: 'connected', keyed: false })).toBe('account');
    expect(openingSection(null, { status: 'disconnected', keyed: true })).toBe('tonight');
    expect(openingSection(null, { status: 'connected', keyed: true, problems: 2 })).toBe('tonight');
    expect(openingSection(null, { status: 'connected', keyed: true })).toBe('show');
    expect(openingSection(null, { status: 'connecting', keyed: true })).toBe('show');
    // an explicit request wins, old ids included
    expect(openingSection('setup', { status: 'connected', keyed: true })).toBe('account');
    expect(openingSection('slides', { page: true, signedIn: false })).toBe('look');
  });

  it('says the program phase in plain words', () => {
    expect(phaseWords('game-time')).toBe('Game time');
    expect(phaseWords('shutdown')).toBe('After club (pickup)');
    expect(phaseWords('something-new')).toBe('something-new');
    expect(phaseWords(null)).toBe('');
  });
});

describe('the classic rail (?rail=classic)', () => {
  beforeEach(() => localStorage.clear());

  it('is today\'s eight, and the page adds Screens, Laptop and History', () => {
    expect(classicSectionsFor(false)).toBe(CLASSIC_SECTIONS);
    expect(classicSectionsFor(true).map((s) => s.id)).toEqual(['status', 'screens', 'checkins', 'slides', 'screen', 'celebrations', 'pickup', 'look', 'laptop', 'history', 'setup']);
    expect(classicSectionsFor(true, { remote: true })).toBe(CLASSIC_SECTIONS);
    expect(resolveClassicSection('connection')).toBe('setup');
    expect(resolveClassicSection('laptop')).toBe('laptop');
    expect(resolveClassicSection('tonight')).toBe('status');
    expect(resolveClassicSection('account')).toBe('setup');
    expect(resolveClassicSection('nope')).toBeNull();
  });

  it('opens as it always did', () => {
    expect(classicOpeningSection(null, { status: 'off' })).toBe('setup');
    expect(classicOpeningSection(null, { status: 'disconnected', keyed: true })).toBe('status');
    expect(classicOpeningSection(null, { status: 'connected', keyed: true })).toBe('checkins');
  });

  it('is chosen by ?rail=classic, remembered, and left with ?rail=new', () => {
    expect(railMode('')).toBe('new');
    expect(railMode('?rail=classic')).toBe('classic');
    expect(localStorage.getItem(RAIL_STORAGE)).toBe('classic');
    expect(railMode('')).toBe('classic');
    expect(railMode('?rail=new')).toBe('new');
    expect(railMode('')).toBe('new');
  });

  it('falls back to the new rail when storage throws', () => {
    const real = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('blocked'); };
    try { expect(railMode('')).toBe('new'); } finally { Storage.prototype.getItem = real; }
  });
});

describe('the preview focus', () => {
  it('keeps the same state object when the focus did not change, so a pointer move re-renders nothing', async () => {
    const { nextFocusState } = await import('./settingsSections.js');
    const prev = { section: 'look', focus: 'slide' };
    expect(nextFocusState(prev, 'look', 'slide')).toBe(prev);
    expect(nextFocusState(prev, 'look', 'name')).toEqual({ section: 'look', focus: 'name' });
    expect(nextFocusState(prev, 'show', 'slide')).toEqual({ section: 'show', focus: 'slide' });
  });
});
