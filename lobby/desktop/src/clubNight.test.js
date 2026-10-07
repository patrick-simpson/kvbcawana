import { describe, it, expect } from 'vitest';
import { CLOSE_AT_MIN, OPEN_AT_MIN, clubNightToday, displayWindow, isClubNight, nextClubNight, zonedParts } from './clubNight.js';

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
