'use strict';
// Tests for the display modules (electron-app/src/display/), merged from the six
// display-*.test.cjs files that each moved from lobby/desktop/src. Each module keeps
// its own describe block and its own requires.
const { describe, it } = require('node:test');
const { expect } = require('./expect.cjs');

describe('display/clubNight', () => {
  // Moved from lobby/desktop/src/clubNight.test.js (KVBC Awana v9); vitest -> node:test.
  const { CLOSE_AT_MIN, OPEN_AT_MIN, clubNightToday, displayWindow, isClubNight, nextClubNight, zonedParts } = require('../src/display/clubNight');

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

  describe('this computer\'s hours (v9)', () => {
    const sources = { schedule: SCHEDULE, feed: FEED };
    const early = { openMin: 16 * 60 + 30, closeMin: 19 * 60 };
    it('opens and closes on the hours given', () => {
      expect(displayWindow(et('2026-09-30T16:29'), sources, early).inWindow).toBe(false);
      expect(displayWindow(et('2026-09-30T16:30'), sources, early)).toMatchObject({ inWindow: true, windowKey: '2026-09-30' });
      expect(displayWindow(et('2026-09-30T18:59'), sources, early).inWindow).toBe(true);
      expect(displayWindow(et('2026-09-30T19:00'), sources, early).inWindow).toBe(false);
    });

    it('still only on club nights', () => {
      expect(displayWindow(et('2026-10-14T17:00'), sources, early).inWindow).toBe(false);
    });

    it('bad or missing hours are the old 5:00 to 8:00 pm', () => {
      for (const bad of [undefined, null, { openMin: 20 * 60, closeMin: 17 * 60 }, { openMin: 'x', closeMin: 3 }]) {
        expect(displayWindow(et('2026-09-30T16:59'), sources, bad).inWindow).toBe(false);
        expect(displayWindow(et('2026-09-30T17:00'), sources, bad).inWindow).toBe(true);
        expect(displayWindow(et('2026-09-30T20:00'), sources, bad).inWindow).toBe(false);
      }
    });

    it('nextClubNight moves on at this computer\'s close', () => {
      expect(nextClubNight(et('2026-09-30T19:30'), sources, 60, early)).toBe('2026-10-07');
      expect(nextClubNight(et('2026-09-30T19:30'), sources)).toBe('2026-09-30');
    });
  });
});

describe('display/displays', () => {
  // Moved from lobby/desktop/src/displays.test.js (KVBC Awana v9); vitest -> node:test.
  const { findDisplay, rememberDisplay } = require('../src/display/displays');

  const laptop = { id: 1, label: 'Built-in Display', bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const tv = { id: 2, label: 'SAMSUNG', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
  const booth = { id: 3, label: 'DELL P2419H', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };

  describe('findDisplay', () => {
    it('finds the same monitor by id and name', () => {
      expect(findDisplay([laptop, tv, booth], rememberDisplay(tv))).toBe(tv);
    });

    it('follows the name when Windows renumbers the id', () => {
      const moved = { ...tv, id: 9, bounds: { ...tv.bounds, x: 3840 } };
      expect(findDisplay([laptop, moved, booth], rememberDisplay(tv))).toBe(moved);
    });

    it('never takes a different monitor that inherited the id', () => {
      const other = { ...booth, id: 2 };
      expect(findDisplay([laptop, other], rememberDisplay(tv))).toBeNull();
    });

    it('tells two same-named monitors apart by where they are', () => {
      const a = { id: 5, label: 'Generic PnP Monitor', bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
      const b = { id: 6, label: 'Generic PnP Monitor', bounds: { x: 1920, y: 0, width: 1920, height: 1080 } };
      const saved = rememberDisplay(b);
      expect(findDisplay([a, { ...b, id: 7 }], saved)).toEqual({ ...b, id: 7 });
      expect(findDisplay([a, { ...b, id: 7, bounds: { ...b.bounds, x: 99 } }], saved)).toBeNull();
    });

    it('falls back to id, then to position and size, when there are no names', () => {
      const noName = (d) => ({ id: d.id, bounds: d.bounds });
      expect(findDisplay([noName(laptop), noName(tv)], rememberDisplay(noName(tv)))).toEqual(noName(tv));
      expect(findDisplay([noName(laptop), { ...noName(tv), id: 8 }], rememberDisplay(noName(tv)))).toEqual({ ...noName(tv), id: 8 });
    });

    it('is not found when unplugged, or with nothing saved', () => {
      expect(findDisplay([laptop, booth], rememberDisplay(tv))).toBeNull();
      expect(findDisplay([laptop], null)).toBeNull();
      expect(findDisplay([], rememberDisplay(tv))).toBeNull();
    });
  });
});

describe('display/screens', () => {
  // Moved from lobby/desktop/src/screens.test.js (KVBC Awana v9); vitest -> node:test.
  const { SCREENS, isScreenPage, screenFor, screenUrls } = require('../src/display/screens');

  const SITE = 'https://awana.kvbchurch.org/lobby/';

  describe('screens', () => {
    it('maps each screen to its page on the one site', () => {
      expect(screenUrls(SITE, 'lobby').page).toBe('https://awana.kvbchurch.org/lobby/index.html');
      expect(screenUrls(SITE, 'projector').page).toBe('https://awana.kvbchurch.org/lobby/countdown.html');
      expect(screenUrls(SITE, 'journey').page).toBe('https://awana.kvbchurch.org/journey/');
      expect(screenUrls(SITE, 'classroom').page).toBe('https://awana.kvbchurch.org/classroom/');
      expect(screenUrls(SITE, 'classroom').configure).toBe('https://awana.kvbchurch.org/classroom/?configure=1');
      expect(Object.keys(SCREENS)).toEqual(['lobby', 'projector', 'journey', 'classroom']);
    });

    it('gives each a configure-mode page', () => {
      expect(screenUrls(SITE, 'lobby').configure).toBe('https://awana.kvbchurch.org/lobby/index.html?configure=1');
      expect(screenUrls(SITE, 'journey').configure).toBe('https://awana.kvbchurch.org/journey/?configure=1');
    });

    it('falls back to the lobby for anything unknown', () => {
      expect(screenFor('printer')).toBe(SCREENS.lobby);
      expect(screenFor(undefined)).toBe(SCREENS.lobby);
      expect(screenFor('__proto__')).toBe(SCREENS.lobby);
    });

    it('keeps a window inside its own folder on its own origin', () => {
      const lobby = screenUrls(SITE, 'lobby').base;
      const journey = screenUrls(SITE, 'journey').base;
      expect(isScreenPage('https://awana.kvbchurch.org/lobby/countdown.html', lobby)).toBe(true);
      expect(isScreenPage('https://awana.kvbchurch.org/journey/', lobby)).toBe(false);
      expect(isScreenPage('https://awana.kvbchurch.org/journey/index.html', journey)).toBe(true);
      expect(isScreenPage('https://awana.kvbchurch.org/', journey)).toBe(false);
      expect(isScreenPage('https://evil.example/journey/', journey)).toBe(false);
      expect(isScreenPage('not a url', journey)).toBe(false);
    });
  });
});

describe('display/settings', () => {
  // Moved from lobby/desktop/src/settings.test.js (KVBC Awana v9); vitest -> node:test.
  // The hours are new in v9: per computer, default 5:00 to 8:00 pm.
  const { DEFAULT_SETTINGS, hoursMinutes, normalizeHours, normalizeSettings, parseClock, parseTime, settingsForScreen } = require('../src/display/settings');

  const HOURS = { start: '17:00', end: '20:00' };

  describe('settings', () => {
    it('reads an old state.json (no settings) as the lobby, 5 to 8 pm, with no shutdown', () => {
      expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
      expect(normalizeSettings({})).toEqual({ screen: 'lobby', hours: HOURS, shutdown: { enabled: false, at: '20:15' } });
      // The sound room app's own state.json (no hours) reads the same way.
      expect(normalizeSettings({ screen: 'projector', shutdown: { enabled: true, at: '20:30' } }))
        .toEqual({ screen: 'projector', hours: HOURS, shutdown: { enabled: true, at: '20:30' } });
    });

    it('choosing the downstairs classroom brings its 6:30-8:00 pm hours and the 8:00 pm shutdown (owner 2026-10-17)', () => {
      const lobby = normalizeSettings({});
      const classroom = settingsForScreen(lobby, 'classroom');
      expect(classroom).toEqual({ screen: 'classroom', hours: { start: '18:30', end: '20:00' }, shutdown: { enabled: true, at: '20:00' } });
      // The same screen again keeps what someone changed since.
      const changed = { ...classroom, hours: { start: '18:00', end: '20:00' }, shutdown: { enabled: false, at: '20:00' } };
      expect(settingsForScreen(changed, 'classroom')).toEqual(changed);
      // Any other screen changes the screen alone.
      expect(settingsForScreen(classroom, 'journey')).toEqual({ ...classroom, screen: 'journey' });
      expect(settingsForScreen(lobby, 'projector')).toEqual({ ...lobby, screen: 'projector' });
      expect(settingsForScreen(lobby, 'nope')).toEqual(lobby);
    });

    it('keeps good values and replaces bad ones', () => {
      expect(normalizeSettings({ screen: 'journey', hours: { start: '16:30', end: '21:00' }, shutdown: { enabled: true, at: '21:05' } }))
        .toEqual({ screen: 'journey', hours: { start: '16:30', end: '21:00' }, shutdown: { enabled: true, at: '21:05' } });
      expect(normalizeSettings({ screen: 'nope', hours: 'all night', shutdown: { enabled: 'yes', at: '25:00' } }))
        .toEqual({ screen: 'lobby', hours: HOURS, shutdown: { enabled: false, at: '20:15' } });
    });

    it('accepts only an evening time for the shutdown', () => {
      expect(parseTime('20:15')).toBe(20 * 60 + 15);
      expect(parseTime('17:00')).toBe(17 * 60);
      expect(parseTime('23:59')).toBe(23 * 60 + 59);
      expect(parseTime('09:00')).toBeNull();
      expect(parseTime('8:15')).toBeNull();
      expect(parseTime(null)).toBeNull();
    });
  });

  describe('display hours', () => {
    it('takes any start before its end, on one day', () => {
      expect(normalizeHours({ start: '09:00', end: '12:30' })).toEqual({ start: '09:00', end: '12:30' });
      expect(hoursMinutes({ start: '16:45', end: '20:30' })).toEqual({ openMin: 16 * 60 + 45, closeMin: 20 * 60 + 30 });
    });

    it('falls back to 5:00 to 8:00 pm for anything else', () => {
      expect(normalizeHours(null)).toEqual(HOURS);
      expect(normalizeHours({ start: '20:00', end: '17:00' })).toEqual(HOURS); // backwards
      expect(normalizeHours({ start: '18:00', end: '18:00' })).toEqual(HOURS); // empty
      expect(normalizeHours({ start: '18:00', end: '24:00' })).toEqual(HOURS); // not a time
      expect(normalizeHours({ start: '6pm', end: '8pm' })).toEqual(HOURS);
      expect(hoursMinutes(undefined)).toEqual({ openMin: 17 * 60, closeMin: 20 * 60 });
    });

    it('reads a clock time of any hour', () => {
      expect(parseClock('00:00')).toBe(0);
      expect(parseClock('23:59')).toBe(23 * 60 + 59);
      expect(parseClock('7:00')).toBeNull();
    });
  });
});

describe('display/shutdown', () => {
  // Moved from lobby/desktop/src/shutdown.test.js (KVBC Awana v9); vitest -> node:test.
  const { MIN_WARNING_MS, WARNING_MS, shutdownDeadline, shutdownStep } = require('../src/display/shutdown');

  const ON = { enabled: true, atMin: 20 * 60 + 15 }; // 8:15 pm
  const night = (minutes, extra = {}) => ({ dateKey: '2026-10-07', minutes, clubNight: true, armedFor: '2026-10-07', cancelledFor: null, ...extra });

  describe('shutdownStep', () => {
    it('does nothing while turned off, or on a night without club', () => {
      expect(shutdownStep({ ...ON, enabled: false }, night(20 * 60 + 13))).toBe('idle');
      expect(shutdownStep(ON, night(20 * 60 + 13, { clubNight: false }))).toBe('idle');
    });

    it('arms before the warning and warns two minutes before the time', () => {
      expect(shutdownStep(ON, night(17 * 60, { armedFor: null }))).toBe('arm');
      expect(shutdownStep(ON, night(20 * 60 + 12))).toBe('arm');
      expect(shutdownStep(ON, night(20 * 60 + 13))).toBe('warn');
      expect(shutdownStep(ON, night(20 * 60 + 15))).toBe('warn');
    });

    it('never shuts down a PC switched on, or woken, after the warning was due', () => {
      expect(shutdownStep(ON, night(20 * 60 + 14, { armedFor: null }))).toBe('idle');
      expect(shutdownStep(ON, night(20 * 60 + 14, { armedFor: '2026-09-30' }))).toBe('idle');
      expect(shutdownStep(ON, night(20 * 60 + 16))).toBe('idle');
      expect(shutdownStep(ON, night(22 * 60))).toBe('idle');
    });

    it('a Cancel holds for the rest of that night only', () => {
      expect(shutdownStep(ON, night(20 * 60 + 14, { cancelledFor: '2026-10-07' }))).toBe('idle');
      expect(shutdownStep(ON, { ...night(20 * 60 + 14), dateKey: '2026-10-14', armedFor: '2026-10-14', cancelledFor: '2026-10-07' })).toBe('warn');
    });
  });

  describe('shutdownDeadline', () => {
    const at = 20 * 60 + 15;
    it('lands on the start of the set minute', () => {
      const now = Date.UTC(2026, 9, 8, 0, 13, 0, 150); // a tick at 8:13:00.150 pm Eastern
      expect(shutdownDeadline(now, 20 * 60 + 13, at)).toBe(Date.UTC(2026, 9, 8, 0, 15, 0, 0));
      expect(shutdownDeadline(now, 20 * 60 + 13, at) - now).toBeLessThanOrEqual(WARNING_MS);
    });

    it('always leaves at least a minute to cancel', () => {
      const late = Date.UTC(2026, 9, 8, 0, 14, 50);
      expect(shutdownDeadline(late, 20 * 60 + 14, at)).toBe(late + MIN_WARNING_MS);
      const past = Date.UTC(2026, 9, 8, 0, 15, 20);
      expect(shutdownDeadline(past, 20 * 60 + 15, at)).toBe(past + MIN_WARNING_MS);
    });
  });
});

describe('display/visibility', () => {
  // Moved from lobby/desktop/src/visibility.test.js (KVBC Awana v9); vitest -> node:test.
  const { MANUAL_SHOW_MS, NO_OVERRIDES, decideVisibility, hide, showNow, tidy } = require('../src/display/visibility');

  const IN = { inWindow: true, windowKey: '2026-09-30' };
  const OUT = { inWindow: false, windowKey: null };
  const T = 1_790_000_000_000;

  describe('decideVisibility', () => {
    it('follows the schedule with no overrides', () => {
      expect(decideVisibility(IN, NO_OVERRIDES, T)).toEqual({ visible: true, reason: 'schedule' });
      expect(decideVisibility(OUT, NO_OVERRIDES, T)).toEqual({ visible: false, reason: 'off' });
    });

    it('Hide during a window lasts until that window ends, and only that one', () => {
      const o = hide(NO_OVERRIDES, IN);
      expect(decideVisibility(IN, o, T).visible).toBe(false);
      expect(decideVisibility({ inWindow: true, windowKey: '2026-10-07' }, o, T).visible).toBe(true);
    });

    it('Show now lasts three hours, through the 8 pm close, then hides itself', () => {
      const o = showNow(NO_OVERRIDES, T);
      expect(MANUAL_SHOW_MS).toBe(3 * 60 * 60 * 1000);
      expect(decideVisibility(OUT, o, T + MANUAL_SHOW_MS - 1)).toEqual({ visible: true, reason: 'manual' });
      expect(decideVisibility(OUT, o, T + MANUAL_SHOW_MS).visible).toBe(false);
      // Inside a window when it runs out: the schedule still wants it.
      expect(decideVisibility(IN, o, T + MANUAL_SHOW_MS).visible).toBe(true);
    });

    it('Show now undoes a Hide, and Hide ends a Show now', () => {
      const hidden = hide(NO_OVERRIDES, IN);
      expect(decideVisibility(IN, showNow(hidden, T), T).visible).toBe(true);
      expect(decideVisibility(OUT, hide(showNow(NO_OVERRIDES, T), OUT), T + 1).visible).toBe(false);
    });
  });

  describe('tidy', () => {
    it('drops a hide for a window that has ended and a show that has run out', () => {
      const o = { hiddenForWindow: '2026-09-30', manualUntil: T };
      expect(tidy(o, OUT, T + 1)).toEqual(NO_OVERRIDES);
      expect(tidy(o, IN, T - 1)).toBe(o);
    });
  });
});

describe('display/pen-watch (the classroom black board, owner 2026-10-18)', () => {
  const { EventEmitter } = require('node:events');
  const { createPenWatch, parseState, penLifted, READY_LINE, WATCH_PS } = require('../src/display/pen-watch');

  const fakeSpawn = () => {
    const calls = [];
    const spawn = (cmd, args) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stdout.setEncoding = () => {};
      child.stderr = new EventEmitter();
      child.killed = false;
      child.kill = () => { child.killed = true; };
      calls.push({ cmd, args, child });
      return child;
    };
    return { spawn, calls };
  };
  const state = (windows) => `STATE ${JSON.stringify({ procs: ['SMARTInk'], windows })}\n`;

  it('reads the helper\'s state lines, and nothing else', () => {
    expect(parseState(state(['Ink|Tb|200x40']))).toEqual({ procs: ['SMARTInk'], windows: ['Ink|Tb|200x40'] });
    expect(parseState('STATE {"procs":"SMARTInk","windows":"A|B|1x1"}')).toEqual({ procs: ['SMARTInk'], windows: ['A|B|1x1'] });
    expect(parseState('STATE {"procs":null}')).toEqual({ procs: [], windows: [] });
    expect(parseState('hello')).toBe(null);
    expect(parseState('STATE {')).toBe(null);
  });

  it('a pen is lifted when SMART Ink shows more windows than before', () => {
    const none = { procs: [], windows: [] };
    const one = { procs: ['SMARTInk'], windows: ['a'] };
    const two = { procs: ['SMARTInk'], windows: ['a', 'b'] };
    expect(penLifted(null, none)).toBe(false);
    expect(penLifted(none, one)).toBe(true);
    expect(penLifted(one, two)).toBe(true);
    expect(penLifted(two, one)).toBe(false);
    expect(penLifted(one, one)).toBe(false);
    expect(penLifted(one, null)).toBe(false);
  });

  it('runs one hidden PowerShell on Windows only, tells the page on a lift, and stops', () => {
    const { spawn, calls } = fakeSpawn();
    let lifts = 0;
    const logs = [];
    const w = createPenWatch({ spawn, platform: 'win32', onLift: () => { lifts += 1; }, log: (...p) => logs.push(p) });
    w.start();
    w.start();
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('powershell.exe');
    expect(calls[0].args.includes('-EncodedCommand')).toBe(true);
    const out = calls[0].child.stdout;
    out.emit('data', `${READY_LINE}\n`);
    out.emit('data', state([]));
    expect(lifts).toBe(0);
    out.emit('data', state(['SMART Ink|Toolbar|300x60']).slice(0, 10));
    out.emit('data', state(['SMART Ink|Toolbar|300x60']).slice(10));
    expect(lifts).toBe(1);
    out.emit('data', state([]));
    out.emit('data', state(['SMART Ink|Toolbar|300x60']));
    expect(lifts).toBe(2);
    w.stop();
    expect(calls[0].child.killed).toBe(true);
    expect(w.isRunning()).toBe(false);
    expect(logs.some((p) => String(p[0]).includes('SMART Ink'))).toBe(true);

    const mac = fakeSpawn();
    createPenWatch({ spawn: mac.spawn, platform: 'darwin', onLift: () => {}, log: () => {} }).start();
    expect(mac.calls.length).toBe(0);
  });

  it('the script only looks at window lists (no keys, no screen, no files)', () => {
    expect(WATCH_PS.includes('GetAsyncKeyState')).toBe(false);
    expect(WATCH_PS.includes('CopyFromScreen')).toBe(false);
    expect(/Set-Content|Out-File|Invoke-WebRequest/.test(WATCH_PS)).toBe(false);
  });

  it('display.js starts it for the classroom screen only and stops it with the screen', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/display/display.js'), 'utf8');
    expect(src.includes("if (urls().screen.id === 'classroom' && !SMOKE) penWatch.start();")).toBe(true);
    expect((src.match(/penWatch\.stop\(\)/g) || []).length).toBe(2);
    expect(src.includes("window.dispatchEvent(new Event('awana:pen-lifted'))")).toBe(true);
  });
});

describe('display/classroom-preview (a /settings preview opens a closed classroom screen, owner 2026-10-18)', () => {
  const { previewOpenUntil, PREVIEW_GRACE_MS, PREVIEW_MAX_MS } = require('../src/display/classroom-preview');
  const at = (preview, serverNow = 1000) => ({ stage: { preview }, serverNow });

  it('opens until the preview ends, on this computer\'s clock, with a little grace', () => {
    expect(previewOpenUntil(at({ look: 'cubbies', until: 61000 }), 500000)).toBe(500000 + 60000 + PREVIEW_GRACE_MS);
  });
  it('nothing for no preview, an ended one, a look it does not know, or junk', () => {
    expect(previewOpenUntil(at(null), 5)).toBe(0);
    expect(previewOpenUntil(at({ look: 'cubbies', until: 900 }), 5)).toBe(0);
    expect(previewOpenUntil(at({ look: 'journey', until: 61000 }), 5)).toBe(0);
    expect(previewOpenUntil(null, 5)).toBe(0);
    expect(previewOpenUntil({ stage: { preview: { look: 'sparks', until: 'x' } }, serverNow: 1 }, 5)).toBe(0);
  });
  it('never longer than two minutes, whatever the answer says', () => {
    expect(previewOpenUntil(at({ look: 'lobby', until: 1000 + 86400000 }), 0)).toBe(PREVIEW_MAX_MS + PREVIEW_GRACE_MS);
  });
  it('display.js asks only for the classroom screen, only while it is closed (or open for a preview), and main.js asks with its own sign-in', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(path.join(__dirname, '../src/display/display.js'), 'utf8');
    expect(src.includes("urls().screen.id !== 'classroom' || typeof opts.classroomStage !== 'function'")).toBe(true);
    expect(src.includes('if (lobby && previewUntil <= Date.now()) return;')).toBe(true);
    expect(src.includes("if (!visible && previewUntil > Date.now() && urls().screen.id === 'classroom') { visible = true; reason = 'preview'; }")).toBe(true);
    const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
    expect(main.includes("syncClient.syncRequest(s.url, '/v1/classroom/stage?from=app', { session: s.session })")).toBe(true);
  });
});
