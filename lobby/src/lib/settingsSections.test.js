import { describe, expect, it } from 'vitest';
import { LEGACY_TABS, SECTIONS, openingSection, phaseWords, resolveSection } from './settingsSections.js';

describe('settings sections', () => {
  it('lists eight sections, everyday ones first and Setup last', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['status', 'checkins', 'slides', 'screen', 'celebrations', 'pickup', 'look', 'setup']);
    for (const s of SECTIONS) expect(s.blurb.length).toBeGreaterThan(0);
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
