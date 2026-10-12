import { describe, expect, it } from 'vitest';
import { LAPTOP_SECTION, LEGACY_TABS, SCREENS_SECTION, SECTIONS, openingSection, phaseWords, resolveSection, sectionsFor } from './settingsSections.js';

describe('settings sections', () => {
  it('lists eight sections, everyday ones first and Setup last', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['status', 'checkins', 'slides', 'screen', 'celebrations', 'pickup', 'look', 'setup']);
    for (const s of SECTIONS) expect(s.blurb.length).toBeGreaterThan(0);
  });

  it('lists the Laptop section on the settings page only, just before Setup', () => {
    expect(sectionsFor(false)).toBe(SECTIONS);
    const ids = sectionsFor(true).map((s) => s.id);
    expect(ids).toEqual(['status', 'screens', 'checkins', 'slides', 'screen', 'celebrations', 'pickup', 'look', 'laptop', 'history', 'setup']);
    expect(LAPTOP_SECTION.blurb.length).toBeGreaterThan(0);
    expect(resolveSection('laptop')).toBe('laptop');
    expect(resolveSection('history')).toBe('history');
  });

  it('maps every old tab id to the section that now holds its controls', () => {
    for (const [old, now] of Object.entries(LEGACY_TABS)) expect(resolveSection(old)).toBe(now);
    expect(resolveSection('pickup')).toBe('pickup');
    expect(resolveSection('nope')).toBeNull();
    expect(resolveSection(null)).toBeNull();
  });

  it('opens where the volunteer needs to be', () => {
    expect(openingSection('connection', { status: 'connected', keyed: true })).toBe('setup');
    expect(openingSection(null, { status: 'off' })).toBe('setup');
    expect(openingSection(null, { status: 'connected', keyed: false })).toBe('setup');
    expect(openingSection(null, { status: 'disconnected', keyed: true })).toBe('status');
    expect(openingSection(null, { status: 'connected', keyed: true, problems: 2 })).toBe('status');
    expect(openingSection(null, { status: 'connected', keyed: true })).toBe('checkins');
    expect(openingSection(null, { status: 'connecting', keyed: true })).toBe('checkins');
  });

  it('says the program phase in plain words', () => {
    expect(phaseWords('game-time')).toBe('Game time');
    expect(phaseWords('shutdown')).toBe('After club (pickup)');
    expect(phaseWords('something-new')).toBe('something-new');
    expect(phaseWords(null)).toBe('');
  });
});

describe('the settings page\'s own sections', () => {
  it('Screens comes after Status on the page only, never on a screen or a screen opened from the page', () => {
    expect(sectionsFor(true).map((s) => s.id).slice(0, 2)).toEqual(['status', 'screens']);
    expect(sectionsFor(false, { remote: false })).toBe(SECTIONS);
    expect(sectionsFor(true, { remote: true })).toBe(SECTIONS);
    expect(SCREENS_SECTION.blurb.length).toBeGreaterThan(0);
    expect(resolveSection('screens')).toBe('screens');
  });
});
