import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  APP_UPDATE_STATES, SCREEN_ACTIONS, SCREEN_SPECS, SCREEN_STATUS_ERROR_MAX, SCREEN_STATUS_VERSION_MAX, TEMPLATE_KEYS, cleanScreenName,
  isScreenId, sanitizeScreenAction, sanitizeScreenSettings, sanitizeScreenStatus, screenStatusMoved,
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
  it('Journey keeps only its two lesson-download switches (the Pi mode is gone)', () => {
    expect(SCREEN_SPECS.journey).toEqual({ downloadsAuto: { type: 'bool' }, downloadsLeader: { type: 'bool' } });
    expect(sanitizeScreenSettings('journey', { downloadsAuto: false, downloadsLeader: 'yes', playbackQuality: 'low' })).toEqual({ downloadsAuto: false });
  });

  it("Journey's actions are exactly its five download buttons, with no data, and the kiosk page knows the same five", () => {
    expect(SCREEN_ACTIONS.journey).toEqual(['start-downloads', 'pause-downloads', 'resume-downloads', 'stop-downloads', 'delete-downloads']);
    expect(sanitizeScreenAction('journey', 'delete-downloads', { all: true })).toEqual({ action: 'delete-downloads' });
    expect(sanitizeScreenAction('journey', 'pick')).toBeNull();
    expect(sanitizeScreenAction('lobby', 'start-downloads')).toBeNull();
    const sync = readFileSync(resolve(__dirname, '../../../journey/public/src/sync.js'), 'utf8');
    const listed = /var REMOTE_ACTIONS = \[([^\]]*)\]/.exec(sync)?.[1].match(/'[a-z-]+'/g)?.map((x) => x.slice(1, -1));
    expect(listed).toEqual([...SCREEN_ACTIONS.journey]);
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

describe("a Journey kiosk's status (its saved lessons)", () => {
  const good = {
    saved: 24, total: 63, bytesSaved: 12e9, bytesTotal: 13e9, downloading: true, waiting: false, paused: false,
    percent: 42, currentWeek: 7, lastSavedAt: '2026-10-12T14:00:00.000Z', error: null, auto: true,
  };

  it('keeps exactly the fixed shape, nothing else', () => {
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, url: 'https://x', names: ['Ada'] }, other: 1 }))
      .toEqual({ lessons: { ...good, leaders: true, known: true, supported: true } });
  });

  it('an older kiosk page (no known/supported) reads as knowing; a new one says when it does not', () => {
    expect(sanitizeScreenStatus('journey', { lessons: good })?.lessons).toMatchObject({ known: true, supported: true });
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, saved: 0, total: 0, known: false, supported: false } })?.lessons)
      .toMatchObject({ saved: 0, total: 0, known: false, supported: false });
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, known: 'no', supported: 0 } })?.lessons).toMatchObject({ known: true, supported: true });
  });

  it('lessons only from a Journey kiosk, and junk is no status', () => {
    expect(sanitizeScreenStatus('lobby', { lessons: good })).toBeNull();
    expect(sanitizeScreenStatus('journey', null)).toBeNull();
    expect(sanitizeScreenStatus('journey', { lessons: [] })).toBeNull();
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, total: '63' } })).toBeNull();
  });

  it('clamps every number and makes every switch a real boolean', () => {
    const out = sanitizeScreenStatus('journey', {
      lessons: { saved: 99, total: 63.9, bytesSaved: -5, bytesTotal: Infinity, downloading: 1, waiting: 'yes', paused: true,
        percent: 250, currentWeek: 0, lastSavedAt: 'yesterday', auto: 'on' },
    })?.lessons;
    expect(out).toEqual({ saved: 63, total: 63, bytesSaved: 0, bytesTotal: 0, downloading: false, waiting: false, paused: true,
      percent: 100, currentWeek: null, lastSavedAt: null, error: null, auto: false, leaders: true, known: true, supported: true });
  });

  it('the error is one short line of plain words', () => {
    const error = sanitizeScreenStatus('journey', { lessons: { ...good, error: `Week 7\u0000\u2028Leader Video:\n\t${'ü'.repeat(300)}` } })?.lessons.error;
    expect(error?.startsWith('Week 7 Leader Video: üüü')).toBe(true);
    expect([...(error || '')]).toHaveLength(SCREEN_STATUS_ERROR_MAX);
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, error: '  \n ' } })?.lessons.error).toBeNull();
  });

  it('moved enough to write at once: a lesson saved, an error, a pause, a start, knowing, or ten points', () => {
    const clean = sanitizeScreenStatus('journey', { lessons: good });
    expect(screenStatusMoved(clean, sanitizeScreenStatus('journey', { lessons: { ...good, known: false } }))).toBe(true);
    expect(screenStatusMoved(clean, sanitizeScreenStatus('journey', { lessons: { ...good, supported: false } }))).toBe(true);
    expect(screenStatusMoved(clean, sanitizeScreenStatus('journey', { lessons: { ...good, percent: 51 } }))).toBe(false);
    expect(screenStatusMoved(clean, sanitizeScreenStatus('journey', { lessons: { ...good, leaders: false } }))).toBe(true);
    expect(sanitizeScreenStatus('journey', { lessons: { ...good, leaders: 'no' } })?.lessons.leaders).toBe(true);
    const a = { lessons: good };
    expect(screenStatusMoved(a, { lessons: { ...good, percent: 51, bytesSaved: 13e9 } })).toBe(false);
    expect(screenStatusMoved(a, { lessons: { ...good, percent: 52 } })).toBe(true);
    expect(screenStatusMoved(a, { lessons: { ...good, saved: 25 } })).toBe(true);
    expect(screenStatusMoved(a, { lessons: { ...good, error: 'x' } })).toBe(true);
    expect(screenStatusMoved(a, { lessons: { ...good, paused: true } })).toBe(true);
    expect(screenStatusMoved(undefined, a)).toBe(true);
    expect(screenStatusMoved(undefined, null)).toBe(false);
  });
});

describe("a computer's status (its KVBC Awana app and update)", () => {
  const app = (update, version = '9.4.0') => ({ app: { version, update } });

  it('keeps exactly the fixed shape; percent only while downloading', () => {
    expect(sanitizeScreenStatus('computer', { ...app({ state: 'downloading', percent: 42.7, at: '2026-10-12T15:00:00Z', speed: 9 }), names: ['Ada'] }))
      .toEqual(app({ state: 'downloading', percent: 42, at: '2026-10-12T15:00:00.000Z' }));
    expect(sanitizeScreenStatus('computer', app({ state: 'ready', percent: 100, at: 'soon' })))
      .toEqual(app({ state: 'ready', percent: null, at: null }));
    expect(sanitizeScreenStatus('computer', app({ state: 'downloading', percent: 250 }))?.app.update.percent).toBe(100);
    expect(sanitizeScreenStatus('computer', app({ state: 'downloading', percent: '42' }))?.app.update.percent).toBe(0);
  });

  it('the version is one short clean line', () => {
    expect(sanitizeScreenStatus('computer', app({ state: 'none' }, '  9.4.0\u0000\n'))?.app.version).toBe('9.4.0');
    expect([...(sanitizeScreenStatus('computer', app({ state: 'none' }, 'v'.repeat(300)))?.app.version || '')]).toHaveLength(SCREEN_STATUS_VERSION_MAX);
  });

  it('junk is no status: no version, an unknown state, no update, or another kind', () => {
    expect(sanitizeScreenStatus('computer', app({ state: 'none' }, ''))).toBeNull();
    expect(sanitizeScreenStatus('computer', app({ state: 'installing' }))).toBeNull();
    expect(sanitizeScreenStatus('computer', { app: { version: '9.4.0' } })).toBeNull();
    expect(sanitizeScreenStatus('lobby', app({ state: 'none' }))).toBeNull();
    expect(sanitizeScreenStatus('computer', { lessons: { saved: 1, total: 2 } })).toBeNull();
    expect(APP_UPDATE_STATES).toEqual(['none', 'downloading', 'ready', 'error']);
  });

  it('moved enough to write at once: a new version, a new state, or ten points', () => {
    const at = (update, version) => sanitizeScreenStatus('computer', app(update, version));
    const a = at({ state: 'downloading', percent: 40 });
    expect(screenStatusMoved(a, at({ state: 'downloading', percent: 49 }))).toBe(false);
    expect(screenStatusMoved(a, at({ state: 'downloading', percent: 50 }))).toBe(true);
    expect(screenStatusMoved(a, at({ state: 'ready' }))).toBe(true);
    expect(screenStatusMoved(at({ state: 'none' }), at({ state: 'none' }, '9.5.0'))).toBe(true);
    expect(screenStatusMoved(at({ state: 'none', at: '2026-10-12T15:00:00Z' }), at({ state: 'none', at: '2026-10-12T16:00:00Z' }))).toBe(false);
  });
});

describe("a TV's or projector's status (its page build)", () => {
  it('the first 7 hex of its build, or null for no stamp; anything else is junk', () => {
    expect(sanitizeScreenStatus('lobby', { page: { build: 'A1B2C3D4E5F6', url: 'x' }, other: 1 })).toEqual({ page: { build: 'a1b2c3d' } });
    expect(sanitizeScreenStatus('projector', { page: { build: ' a1b2c3d ' } })).toEqual({ page: { build: 'a1b2c3d' } });
    expect(sanitizeScreenStatus('projector', { page: { build: null } })).toEqual({ page: { build: null } });
    expect(sanitizeScreenStatus('lobby', { page: { build: 'a1b2c3' } })).toBeNull();
    expect(sanitizeScreenStatus('lobby', { page: { build: '<script>' } })).toBeNull();
    expect(sanitizeScreenStatus('lobby', { page: {} })).toBeNull();
    expect(sanitizeScreenStatus('journey', { page: { build: 'a1b2c3d' } })).toBeNull();
  });

  it('moved only with a new build', () => {
    expect(screenStatusMoved({ page: { build: 'a1b2c3d' } }, { page: { build: 'a1b2c3d' } })).toBe(false);
    expect(screenStatusMoved({ page: { build: 'a1b2c3d' } }, { page: { build: 'b2c3d4e' } })).toBe(true);
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
