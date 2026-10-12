import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SCREEN_ACTIONS, SCREEN_SPECS, TEMPLATE_KEYS, cleanScreenName, isScreenId, sanitizeScreenAction, sanitizeScreenSettings,
} from './syncSpecs.js';
import { sanitizeOverrides } from '../hooks/useConfig.js';
import { SHARED_KEYS } from './sharedSettings.js';
import { CORNER_CLUB_IDS } from './clubs.js';

// SCREEN_SPECS is the one allowlist for a screen's OWN settings, applied by
// the Worker (worker/src/screens.js) and by the screen (useScreenSync). The
// lobby's has to stay inside what the device layer itself accepts
// (useConfig's VALIDATORS, through sanitizeOverrides), or /settings could
// save a value the TV then drops.

/** One value per rule that the rule keeps. */
function sample(rule) {
  switch (rule.type) {
    case 'bool': return true;
    case 'int': return rule.max;
    case 'enum': return rule.values[rule.values.length - 1];
    case 'url': return 'https://onedrive.live.com/embed?x=1';
    default: throw new Error(rule.type);
  }
}

describe("the lobby's screen settings", () => {
  const spec = SCREEN_SPECS.lobby;

  it('every key is one the device layer keeps, with the same value', () => {
    const all = Object.fromEntries(Object.entries(spec).map(([k, rule]) => [k, sample(rule)]));
    const clean = sanitizeScreenSettings('lobby', all);
    expect(Object.keys(clean)).toEqual(Object.keys(spec));
    expect(sanitizeOverrides(clean)).toEqual(clean);
  });

  it('never a shared key, a Pusher key, panic mode, the deck or a fleet URL', () => {
    for (const key of Object.keys(spec)) expect(SHARED_KEYS, key).not.toContain(key);
    for (const key of ['pusherAppKey', 'pusherCluster', 'panicMode', 'manualSlides', 'sharedScheduleUrl', 'sharedThemeUrl', 'calendarUrl']) {
      expect(spec, key).not.toHaveProperty(key);
    }
  });

  it('holds the template (so a template value can always be managed) and the two per-TV corner keys', () => {
    for (const key of TEMPLATE_KEYS) expect(spec).toHaveProperty(key);
    expect(spec.cornerClub.values).toEqual(['', ...CORNER_CLUB_IDS]);
    expect(spec.showTonightTicker).toEqual({ type: 'bool' });
  });

  it('is idempotent and in spec order, so two copies of the same settings compare equal', () => {
    const a = sanitizeScreenSettings('lobby', { reduceMotion: true, audioMuted: false, junk: 1 });
    const b = sanitizeScreenSettings('lobby', { audioMuted: false, reduceMotion: true });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(sanitizeScreenSettings('lobby', a)).toEqual(a);
  });
});

describe('the other kinds', () => {
  it("Journey's playback quality is its own page's three choices", () => {
    const page = readFileSync(resolve(__dirname, '../../../journey/public/src/schedule.js'), 'utf8');
    const m = /PLAYBACK_QUALITY_CHOICES = \[([^\]]+)\]/.exec(page);
    expect(m && JSON.parse(`[${m[1].replaceAll("'", '"')}]`)).toEqual(SCREEN_SPECS.journey.playbackQuality.values);
  });

  it("the projector's actions are the configure relay's, and a wall pick is checked like the projector checks it", () => {
    const app = readFileSync(resolve(__dirname, '../presentation/App.jsx'), 'utf8');
    expect(app).toContain("listenForRelay('projector', ['select', 'resume']");
    expect(SCREEN_ACTIONS.projector).toEqual(['select', 'resume']);
    expect(sanitizeScreenAction('projector', 'select', { type: 'countdown', x: 1 })).toEqual({ action: 'select', data: { type: 'countdown' } });
    expect(sanitizeScreenAction('projector', 'select', { type: 'window', index: 1.5 })).toBeNull();
    expect(sanitizeScreenAction('lobby', 'select', { type: 'countdown' })).toBeNull();
    expect(sanitizeScreenAction('lobby', 'reset-tally', { anything: 1 })).toEqual({ action: 'reset-tally' });
  });

  it('an unknown kind keeps nothing', () => {
    expect(sanitizeScreenSettings('toaster', { audioMuted: true })).toEqual({});
    expect(sanitizeScreenSettings('lobby', null)).toEqual({});
  });
});

describe('ids and names', () => {
  it('an id is 16 to 64 url-safe characters', () => {
    expect(isScreenId('a'.repeat(16))).toBe(true);
    expect(isScreenId('a'.repeat(15))).toBe(false);
    expect(isScreenId('a'.repeat(65))).toBe(false);
    expect(isScreenId('aaaaaaaaaaaaaaa/.')).toBe(false);
    expect(isScreenId(42)).toBe(false);
  });

  it('a name is one trimmed line of at most 40 characters', () => {
    expect(cleanScreenName('  Gym\n\tprojector   ')).toBe('Gym projector');
    expect(cleanScreenName('x'.repeat(50))).toHaveLength(40);
    expect(cleanScreenName(7)).toBe('');
    // an emoji at the cut is kept whole or dropped whole, never split into a lone surrogate
    const cut = cleanScreenName(`${'x'.repeat(39)}😀tail`);
    expect(cut).toBe(`${'x'.repeat(39)}😀`);
    expect(() => encodeURIComponent(cut)).not.toThrow();
    expect([...cleanScreenName('😀'.repeat(50))]).toHaveLength(40);
  });
});
