import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIRROR_EARLY_MS, MIRROR_MESSAGE, MIRROR_PRELOAD_MS, mirrorEarly, mirrorWanted, mirrorWord } from './ceremonyMirror.js';
import { DEFAULT_SCHEDULE } from './schedule.js';

// The lobby mirrors the game time projector during the opening ceremony
// (owner 2026-10-19): loaded hidden a little before 6:00, shown while the
// mirror says its ceremony is on.

const wed = (hm) => new Date(`2026-09-16T${hm}`); // a Wednesday
const wanted = (now, extra = {}) => mirrorWanted({ schedule: DEFAULT_SCHEDULE, now, ...extra });

describe('the ceremony mirror', () => {
  it('loads two minutes before the ceremony and stays loaded through it', () => {
    expect(MIRROR_PRELOAD_MS).toBe(2 * 60 * 1000);
    expect(wanted(wed('17:57:59'))).toBe(false);
    expect(wanted(wed('17:58:00'))).toBe(true);
    expect(wanted(wed('18:00:00'))).toBe(true);
    expect(wanted(wed('18:04:59'))).toBe(true);
    expect(wanted(wed('18:05:00'))).toBe(false);
  });

  it('turns over ten seconds before the start (owner 2026-10-19), and no longer once it has started', () => {
    expect(MIRROR_EARLY_MS).toBe(10 * 1000);
    const early = (hms) => mirrorEarly({ schedule: DEFAULT_SCHEDULE, now: wed(hms) });
    expect(early('17:59:49')).toBe(false);
    expect(early('17:59:50')).toBe(true);
    expect(early('17:59:59')).toBe(true);
    expect(early('18:00:00')).toBe(false);
    expect(early('18:04:55')).toBe(false);
    expect(mirrorEarly({ schedule: DEFAULT_SCHEDULE, now: new Date('2026-09-17T17:59:55') })).toBe(false);
  });

  it('a framed lobby runs it too (the Journey kiosk, the downstairs classroom; owner 2026-10-19)', () => {
    expect(wanted(wed('18:01:00'), { embedded: true })).toBe(true);
  });

  it('never on another night, a cancelled night, or a page that is not a screen', () => {
    expect(wanted(new Date('2026-09-17T18:01:00'))).toBe(false); // a Thursday
    const off = { ...DEFAULT_SCHEDULE, specialDates: { '2026-09-16': { noClub: true } } };
    expect(mirrorWanted({ schedule: off, now: wed('18:01:00') })).toBe(false);
    for (const flag of ['showcase', 'configure', 'settingsPage', 'overlay']) {
      expect(wanted(wed('18:01:00'), { [flag]: true })).toBe(false);
    }
  });

  it("takes the mirror's word only from its own frame at our own origin", () => {
    const frame = /** @type {any} */ ({});
    const ev = (over) => /** @type {any} */ ({ source: frame, origin: 'https://awana.kvbchurch.org', data: { type: MIRROR_MESSAGE, ceremony: true }, ...over });
    expect(mirrorWord(ev({}), frame, 'https://awana.kvbchurch.org')).toBe(true);
    expect(mirrorWord(ev({ data: { type: MIRROR_MESSAGE, ceremony: false } }), frame, 'https://awana.kvbchurch.org')).toBe(false);
    expect(mirrorWord(ev({ source: {} }), frame, 'https://awana.kvbchurch.org')).toBeNull();
    expect(mirrorWord(ev({ origin: 'https://evil.example' }), frame, 'https://awana.kvbchurch.org')).toBeNull();
    expect(mirrorWord(ev({ data: { type: 'other', ceremony: true } }), frame, 'https://awana.kvbchurch.org')).toBeNull();
    expect(mirrorWord(ev({ data: { type: MIRROR_MESSAGE, ceremony: 'yes' } }), frame, 'https://awana.kvbchurch.org')).toBeNull();
    expect(mirrorWord(ev({}), null, 'https://awana.kvbchurch.org')).toBeNull();
  });

  it('the projector speaks the same message, only from ?mirror=1', () => {
    const app = readFileSync(resolve(__dirname, '../presentation/App.jsx'), 'utf8');
    expect(app).toContain(`export const MIRROR_MESSAGE = '${MIRROR_MESSAGE}';`);
    expect(app).toContain('window.parent.postMessage({ type: MIRROR_MESSAGE, ceremony }, window.location.origin)');
    const flags = readFileSync(resolve(__dirname, '../presentation/lib/flags.js'), 'utf8');
    expect(flags).toContain("mirror: params.get('mirror') === '1'");
  });
});
