import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCHEDULE, isLatePhase, isNoClubDate, resolvePhase, sanitizeSchedule,
  sanitizeSpecialDates, specialDateFor,
} from './schedule.js';

// Wed Sep 16 2026 is a Wednesday (meeting day 3).
const wed = (h, m) => new Date(2026, 8, 16, h, m);
const thu = (h, m) => new Date(2026, 8, 17, h, m);

// The real shared/schedule.json shape from the countdown repo.
const SHARED = {
  version: 1,
  timezone: 'America/New_York',
  meeting: { day: 3, start: '18:00' },
  windows: [
    { kind: 'slideshow', deck: 'opening', title: 'Opening Ceremony', start: '18:00', end: '18:05' },
    { kind: 'game', clubs: ['tnt'], title: 'T&T Game Time', start: '18:05', end: '18:30' },
    { kind: 'game', clubs: ['sparks'], title: 'Sparks Game Time', start: '18:30', end: '19:00' },
    { kind: 'game', clubs: ['cubbies', 'puggles'], title: 'Puggles & Cubbies', start: '19:00', end: '19:30' },
    { kind: 'slideshow', deck: 'closing', title: 'Closing', start: '19:30', end: '19:35' },
    { kind: 'shutdown', title: 'Shutdown', start: '19:35', end: '24:00' },
  ],
  specialDates: {},
};

describe('sanitizeSchedule', () => {
  it('parses the real shared schedule into phases', () => {
    const s = sanitizeSchedule(SHARED);
    expect(s.meetingDay).toBe(3);
    expect(s.windows.map((w) => w.phase)).toEqual([
      'ceremony', 'game-time', 'game-time', 'game-time', 'closing', 'shutdown',
    ]);
  });

  it('rejects malformed inputs instead of half-parsing them', () => {
    expect(sanitizeSchedule(null)).toBeNull();
    expect(sanitizeSchedule({})).toBeNull();
    expect(sanitizeSchedule({ meeting: { day: 9 }, windows: SHARED.windows })).toBeNull();
    expect(sanitizeSchedule({ meeting: { day: 3 }, windows: [] })).toBeNull();
    expect(sanitizeSchedule({ meeting: { day: 3 }, windows: [{ kind: 'game', start: 'six', end: '19:00' }] })).toBeNull();
    expect(sanitizeSchedule({ meeting: { day: 3 }, windows: [{ kind: 'mystery', start: '18:00', end: '19:00' }] })).toBeNull();
    expect(sanitizeSchedule({ meeting: { day: 3 }, windows: [{ kind: 'game', start: '19:00', end: '18:00' }] })).toBeNull();
  });
});

// ── specialDates (#342) ─────────────────────────────────────────────────────
// The signage side's OWN parser for the shared file's break weeks. The
// presentation page has its own (src/presentation/lib/shared-config.js) and
// the isolation rule forbids importing across that line, so the two agree by
// test rather than by shared code.
describe('sanitizeSpecialDates', () => {
  it('keeps a well-formed no-club entry, label and all', () => {
    expect(sanitizeSpecialDates({
      '2026-11-25': { noClub: true, label: 'Thanksgiving Break' },
    })).toEqual({ '2026-11-25': { noClub: true, label: 'Thanksgiving Break' } });
  });

  it('keeps a no-club entry with NO label — a break week is still a break week', () => {
    expect(sanitizeSpecialDates({ '2026-12-23': { noClub: true } }))
      .toEqual({ '2026-12-23': { noClub: true } });
  });

  it('keeps a label-only or windows-only entry as a non-cancelled note', () => {
    // The presentation page's other variant ({label, windows}) — accepted so
    // the two readers do not disagree about what the file means; the windows
    // themselves are the projector's business.
    expect(sanitizeSpecialDates({
      '2026-10-28': { label: 'Fall Festival', windows: [{ kind: 'game', start: '18:00', end: '19:00' }] },
    })).toEqual({ '2026-10-28': { noClub: false, label: 'Fall Festival' } });
  });

  it('drops a bad key without taking the good entries with it', () => {
    // The whole reason this reader is forgiving where the projector's is
    // strict: a lobby TV that forgets one break week beats a lobby TV that
    // refuses its entire schedule.
    expect(sanitizeSpecialDates({
      'next wednesday': { noClub: true },
      // Right shape, impossible day — a typo nobody should have to hunt for
      // on a club night.
      '2026-13-45': { noClub: true },
      '2027-02-30': { noClub: true },
      '26-11-25': { noClub: true },
      '2026-11-25': { noClub: true, label: 'Thanksgiving Break' },
    })).toEqual({ '2026-11-25': { noClub: true, label: 'Thanksgiving Break' } });
  });

  it('drops junk values and non-string labels', () => {
    expect(sanitizeSpecialDates({
      '2026-01-07': 'cancelled',
      '2026-01-14': null,
      '2026-01-21': [],
      '2026-01-28': { noClub: true, label: 42 },
    })).toEqual({ '2026-01-28': { noClub: true } });
  });

  it('treats a non-true noClub as "not cancelled", never as truthy', () => {
    // 'true', 1 and 'yes' are exactly the kinds of thing a hand-edited JSON
    // file grows; none of them may cancel a club night.
    for (const value of ['true', 1, 'yes', {}]) {
      expect(sanitizeSpecialDates({ '2026-02-04': { noClub: value } }))
        .toEqual({ '2026-02-04': { noClub: false } });
    }
  });

  it('returns an empty table for a missing or malformed specialDates', () => {
    expect(sanitizeSpecialDates(undefined)).toEqual({});
    expect(sanitizeSpecialDates(null)).toEqual({});
    expect(sanitizeSpecialDates([])).toEqual({});
    expect(sanitizeSpecialDates('2026-11-25')).toEqual({});
  });

  it('caps a runaway table rather than caching thousands of entries', () => {
    const many = {};
    for (let i = 0; i < 500; i++) {
      many[`2026-01-${String((i % 28) + 1).padStart(2, '0')}`] = { noClub: true };
      many[`20${String(30 + i).slice(0, 2)}-01-01`] = { noClub: true };
    }
    expect(Object.keys(sanitizeSpecialDates(many)).length).toBeLessThanOrEqual(400);
  });

  it('rides through sanitizeSchedule, and a bad table never fails the schedule', () => {
    const withDates = sanitizeSchedule({
      ...SHARED,
      specialDates: { '2026-11-25': { noClub: true, label: 'Thanksgiving Break' }, oops: 1 },
    });
    expect(withDates.specialDates).toEqual({
      '2026-11-25': { noClub: true, label: 'Thanksgiving Break' },
    });
    // A specialDates the parser cannot use at all is NOT grounds to reject the
    // whole file — the windows still have to drive tonight's program.
    const junk = sanitizeSchedule({ ...SHARED, specialDates: 'nope' });
    expect(junk).not.toBeNull();
    expect(junk.specialDates).toEqual({});
    // …and a file with no specialDates key at all parses exactly as before.
    const bare = sanitizeSchedule({ ...SHARED, specialDates: undefined });
    expect(bare.specialDates).toEqual({});
  });

  it('accepts every entry the checked-in shared/schedule.json actually contains', () => {
    // Drift guard: the two parsers must not disagree about the real file. If
    // someone adds a break week the projector accepts and this reader drops,
    // this fails — the whole point of #342 is one file, one answer.
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = JSON.parse(readFileSync(resolve(here, '../../shared/schedule.json'), 'utf8'));
    const parsed = sanitizeSchedule(raw);
    expect(parsed).not.toBeNull();
    const source = raw.specialDates ?? {};
    expect(Object.keys(parsed.specialDates).sort()).toEqual(Object.keys(source).sort());
    for (const [date, entry] of Object.entries(source)) {
      expect(parsed.specialDates[date].noClub, date).toBe(entry.noClub === true);
    }
  });

  it('answers the two lookup helpers the app actually calls', () => {
    const s = sanitizeSchedule({
      ...SHARED,
      specialDates: {
        '2026-11-25': { noClub: true, label: 'Thanksgiving Break' },
        '2026-10-28': { label: 'Fall Festival' },
      },
    });
    expect(isNoClubDate(s, '2026-11-25')).toBe(true);
    expect(isNoClubDate(s, '2026-10-28')).toBe(false);
    expect(isNoClubDate(s, '2026-09-16')).toBe(false);
    expect(isNoClubDate(null, '2026-11-25')).toBe(false);
    expect(specialDateFor(s, '2026-10-28')).toEqual({ noClub: false, label: 'Fall Festival' });
    expect(specialDateFor(s, '2026-09-16')).toBeNull();
    expect(specialDateFor(undefined, '2026-11-25')).toBeNull();
  });
});

describe('resolvePhase', () => {
  const s = sanitizeSchedule(SHARED);

  it('walks the whole Wednesday program', () => {
    expect(resolvePhase(s, wed(17, 0))).toBe('countdown');
    expect(resolvePhase(s, wed(18, 0))).toBe('ceremony');
    expect(resolvePhase(s, wed(18, 4))).toBe('ceremony');
    expect(resolvePhase(s, wed(18, 5))).toBe('game-time');
    expect(resolvePhase(s, wed(19, 29))).toBe('game-time');
    expect(resolvePhase(s, wed(19, 30))).toBe('closing');
    expect(resolvePhase(s, wed(19, 35))).toBe('shutdown');
    expect(resolvePhase(s, wed(23, 59))).toBe('shutdown');
  });

  it('is off on non-meeting days', () => {
    expect(resolvePhase(s, thu(18, 30))).toBe('off');
  });

  // #342 — a cancelled Wednesday is 'off' at every hour of the program, so the
  // calm late-phase banner treatment and the checkout board's pickup window
  // behave as they do on any other night with no club.
  it('is off all evening on a date the shared file marks no-club', () => {
    const cancelled = sanitizeSchedule({
      ...SHARED,
      // Wed Sep 16 2026 — the meeting day every other case here uses.
      specialDates: { '2026-09-16': { noClub: true, label: 'Snow day' } },
    });
    for (const at of [wed(17, 0), wed(18, 0), wed(18, 30), wed(19, 30), wed(19, 40), wed(23, 59)]) {
      expect(resolvePhase(cancelled, at)).toBe('off');
    }
    // The following Wednesday is untouched.
    expect(resolvePhase(cancelled, new Date(2026, 8, 23, 18, 30))).toBe('game-time');
  });

  it('runs the program normally on a special date that is NOT no-club', () => {
    const festival = sanitizeSchedule({
      ...SHARED,
      specialDates: { '2026-09-16': { label: 'Fall Festival' } },
    });
    expect(resolvePhase(festival, wed(18, 30))).toBe('game-time');
  });

  it('uses the LOCAL date, so a late-evening club night is not yesterday or tomorrow', () => {
    // The recurring trap in this repo: toISOString() in a US-Eastern evening
    // has already rolled to the next day — which is exactly club hours.
    const cancelled = sanitizeSchedule({
      ...SHARED,
      specialDates: { '2026-09-16': { noClub: true } },
    });
    expect(resolvePhase(cancelled, wed(23, 30))).toBe('off');
    const tomorrowOnly = sanitizeSchedule({
      ...SHARED,
      specialDates: { '2026-09-17': { noClub: true } },
    });
    expect(resolvePhase(tomorrowOnly, wed(23, 30))).toBe('shutdown');
  });

  it('falls back to the baked default on null schedule', () => {
    expect(resolvePhase(null, wed(18, 30))).toBe('game-time');
    expect(resolvePhase(undefined, thu(18, 30))).toBe('off');
    expect(DEFAULT_SCHEDULE.meetingDay).toBe(3);
  });
});

describe('isLatePhase', () => {
  it('is calm during the program, loud before it', () => {
    expect(isLatePhase('countdown')).toBe(false);
    expect(isLatePhase('off')).toBe(false);
    expect(isLatePhase('ceremony')).toBe(true);
    expect(isLatePhase('game-time')).toBe(true);
    expect(isLatePhase('closing')).toBe(true);
    expect(isLatePhase('shutdown')).toBe(false);
  });
});
