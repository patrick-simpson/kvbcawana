import { describe, it, expect } from 'vitest';
import {
  CLOSE_AT_MIN, DEFAULT_HOURS, DEFAULT_MEETING_DAY, DEFAULT_TIMEZONE, OPEN_AT_MIN,
  clubNightToday, displayWindow, hoursOrDefault, isClubNight, isNoClubDate, nextClubNight, zonedParts,
} from './clubNight.js';

// The rule's one source. The KVBC Awana app (printer/electron-app) runs a
// generated copy of this file, kept honest by scripts/check-mirrors.mjs; the
// app's own tests exercise it.

describe('the shared constants', () => {
  it('are the church\'s: Eastern, Wednesday, 5 to 8 pm', () => {
    expect(DEFAULT_TIMEZONE).toBe('America/New_York');
    expect(DEFAULT_MEETING_DAY).toBe(3);
    expect(DEFAULT_HOURS).toEqual({ openMin: 17 * 60, closeMin: 20 * 60 });
  });
});

describe('isNoClubDate', () => {
  it('is true only for a strict noClub: true', () => {
    const table = { '2026-11-25': { noClub: true }, '2026-12-02': { noClub: 'yes' }, '2026-12-09': { label: 'x' } };
    expect(isNoClubDate(table, '2026-11-25')).toBe(true);
    expect(isNoClubDate(table, '2026-12-02')).toBe(false);
    expect(isNoClubDate(table, '2026-12-09')).toBe(false);
    expect(isNoClubDate(table, '2026-12-16')).toBe(false);
    expect(isNoClubDate(null, '2026-11-25')).toBe(false);
    expect(isNoClubDate(undefined, '2026-11-25')).toBe(false);
  });
});

describe('per-computer hours', () => {
  it('accept an open before its close inside one day, else fall back to the default', () => {
    expect(hoursOrDefault({ openMin: 600, closeMin: 700 })).toEqual({ openMin: 600, closeMin: 700 });
    expect(hoursOrDefault({ openMin: 700, closeMin: 600 })).toBe(DEFAULT_HOURS);
    expect(hoursOrDefault({ openMin: 0, closeMin: 25 * 60 })).toBe(DEFAULT_HOURS);
    expect(hoursOrDefault({ openMin: 1.5, closeMin: 600 })).toBe(DEFAULT_HOURS);
    expect(hoursOrDefault(undefined)).toBe(DEFAULT_HOURS);
  });

  it('move the window and the next-night cutoff', () => {
    const hours = { openMin: 16 * 60, closeMin: 21 * 60 };
    const sources = { schedule: { meeting: { day: 3 }, timezone: 'America/New_York' } };
    expect(displayWindow(new Date('2026-09-30T16:30:00-04:00'), sources, hours).inWindow).toBe(true);
    expect(displayWindow(new Date('2026-09-30T16:30:00-04:00'), sources).inWindow).toBe(false);
    expect(displayWindow(new Date('2026-09-30T20:30:00-04:00'), sources, hours).inWindow).toBe(true);
    expect(nextClubNight(new Date('2026-09-30T20:30:00-04:00'), sources, 60, hours)).toBe('2026-09-30');
    expect(nextClubNight(new Date('2026-09-30T20:30:00-04:00'), sources)).toBe('2026-10-07');
  });
});

// Eastern wall-clock time -> the real instant (EDT in fall 2026 is UTC-4).
const et = (iso) => new Date(`${iso}-04:00`);
const SCHEDULE = { meeting: { day: 3, start: '18:00' }, timezone: 'America/New_York', specialDates: {} };
const FEED = {
  generatedAt: '2026-09-24T13:34:40.993Z',
  events: [
    { date: '2026-09-30', kind: 'club', isCancelled: false },
    { date: '2026-10-07', kind: 'club', isCancelled: false },
    { date: '2026-10-14', kind: 'club', isCancelled: true },
    { date: '2026-10-21', kind: 'club', isCancelled: false },
    { date: '2026-10-24', kind: 'event', isCancelled: false },
  ],
};

describe('zonedParts', () => {
  it('reads the church clock, not the machine clock', () => {
    // 23:30 UTC on Sep 30 is 7:30 pm Eastern on Wednesday Sep 30.
    expect(zonedParts(new Date('2026-09-30T23:30:00Z'), 'America/New_York')).toEqual({ dateKey: '2026-09-30', weekday: 3, minutes: 19 * 60 + 30 });
    // 00:30 UTC Oct 1 is still Wednesday evening there.
    expect(zonedParts(new Date('2026-10-01T00:30:00Z'), 'America/New_York').dateKey).toBe('2026-09-30');
  });

  it('survives an unknown zone', () => {
    expect(zonedParts(new Date('2026-09-30T23:30:00Z'), 'Not/AZone').dateKey).toBe('2026-09-30');
  });
});

describe('isClubNight', () => {
  it('follows the feed where it covers the date', () => {
    expect(isClubNight('2026-09-30', 3, { schedule: SCHEDULE, feed: FEED })).toBe(true);
    expect(isClubNight('2026-10-14', 3, { schedule: SCHEDULE, feed: FEED })).toBe(false); // cancelled
    expect(isClubNight('2026-10-24', 6, { schedule: SCHEDULE, feed: FEED })).toBe(false); // an event, not club
  });

  it('a Wednesday the covering feed has no club on is not a club night', () => {
    const feed = { ...FEED, events: FEED.events.filter((e) => e.date !== '2026-10-07') };
    expect(isClubNight('2026-10-07', 3, { schedule: SCHEDULE, feed })).toBe(false);
  });

  it('the shared schedule\'s noClub beats everything', () => {
    const schedule = { ...SCHEDULE, specialDates: { '2026-09-30': { noClub: true, label: 'Fall break' } } };
    expect(isClubNight('2026-09-30', 3, { schedule, feed: FEED })).toBe(false);
    expect(isClubNight('2026-09-30', 3, { schedule })).toBe(false);
  });

  it('after the feed\'s last event the season is over: summer Wednesdays stay dark', () => {
    expect(isClubNight('2026-11-04', 3, { schedule: SCHEDULE, feed: FEED })).toBe(false);
    expect(isClubNight('2027-07-07', 3, { schedule: SCHEDULE, feed: FEED })).toBe(false);
  });

  it('a special meeting in the shared schedule is a club night, on any day', () => {
    const schedule = { ...SCHEDULE, specialDates: { '2026-10-01': { label: 'Special', windows: [{ kind: 'game', start: '18:00', end: '19:00' }] } } };
    expect(isClubNight('2026-10-01', 4, { schedule, feed: FEED })).toBe(true);
  });

  it('with no feed (or for a date before it was generated) falls back to the meeting day', () => {
    expect(isClubNight('2026-09-23', 3, { schedule: SCHEDULE, feed: FEED })).toBe(true); // before it was generated
    expect(isClubNight('2026-09-30', 3, {})).toBe(true);
    expect(isClubNight('2026-09-29', 2, {})).toBe(false);
    expect(isClubNight('2026-10-01', 4, { schedule: { meeting: { day: 4 } } })).toBe(true);
  });

  it('ignores junk in the files', () => {
    const feed = { generatedAt: 'nonsense', events: [null, { date: 'soon', kind: 'club' }, 7] };
    expect(isClubNight('2026-09-30', 3, { schedule: { specialDates: 'x' }, feed })).toBe(true);
  });
});

describe('displayWindow', () => {
  const sources = { schedule: SCHEDULE, feed: FEED };
  it('opens at 5:00 pm and closes at exactly 8:00 pm on a club night', () => {
    expect(displayWindow(et('2026-09-30T16:59'), sources).inWindow).toBe(false);
    expect(displayWindow(et('2026-09-30T17:00'), sources)).toMatchObject({ inWindow: true, windowKey: '2026-09-30' });
    expect(displayWindow(et('2026-09-30T19:59'), sources).inWindow).toBe(true);
    expect(displayWindow(et('2026-09-30T20:00'), sources)).toMatchObject({ inWindow: false, windowKey: null });
  });

  it('stays dark on a cancelled night and on other days', () => {
    expect(displayWindow(et('2026-10-14T18:00'), sources).inWindow).toBe(false);
    expect(displayWindow(et('2026-10-01T18:00'), sources).inWindow).toBe(false);
  });

  it('uses the schedule\'s time zone, whatever zone the PC is in', () => {
    // 21:30 UTC is 5:30 pm Eastern, but 2:30 pm Pacific.
    expect(displayWindow(new Date('2026-09-30T21:30:00Z'), sources).inWindow).toBe(true);
    const pacific = { ...sources, schedule: { ...SCHEDULE, timezone: 'America/Los_Angeles' } };
    expect(displayWindow(new Date('2026-09-30T21:30:00Z'), pacific).inWindow).toBe(false);
  });

  it('pins the hours', () => {
    expect(OPEN_AT_MIN).toBe(17 * 60);
    expect(CLOSE_AT_MIN).toBe(20 * 60);
  });
});

describe('nextClubNight', () => {
  const sources = { schedule: SCHEDULE, feed: FEED };
  it('is tonight until the window closes, then the next one', () => {
    expect(nextClubNight(et('2026-09-30T10:00'), sources)).toBe('2026-09-30');
    expect(nextClubNight(et('2026-09-30T19:00'), sources)).toBe('2026-09-30');
    expect(nextClubNight(et('2026-09-30T20:00'), sources)).toBe('2026-10-07');
  });

  it('skips a cancelled night', () => {
    expect(nextClubNight(et('2026-10-08T10:00'), sources)).toBe('2026-10-21');
  });
});

describe('clubNightToday', () => {
  it('still says yes after the 8:00 pm close, when nextClubNight has moved on', () => {
    const late = et('2026-10-07T20:15:00');
    expect(clubNightToday(late, { schedule: SCHEDULE, feed: FEED })).toBe(true);
    expect(nextClubNight(late, { schedule: SCHEDULE, feed: FEED })).not.toBe('2026-10-07');
  });

  it('says no on a cancelled night and on an ordinary Thursday', () => {
    expect(clubNightToday(et('2026-10-14T20:15:00'), { schedule: SCHEDULE, feed: FEED })).toBe(false);
    expect(clubNightToday(et('2026-10-08T20:15:00'), { schedule: SCHEDULE, feed: FEED })).toBe(false);
  });
});
