import { describe, expect, it } from 'vitest';
import {
  activeFaults, checkInsHeldNow, cornerFallbackMs, cornerSlots, cornerSources, flagTabs, isAprilFools,
  nameFaultWords, posterIsHeld, reloadIsBusy, roomFor, shortcutFor, shouldShowStatus, stageClassName,
  statusAriaLabel, tickerIsActive, visibleCornerItem,
} from './lobbyDirector.js';
import { BOARD_NAMES } from './checkoutBoard.js';

describe('checkInsHeldNow', () => {
  it('holds for a special slide or a preview, never on an overlay feed', () => {
    expect(checkInsHeldNow({ overlay: false, slideSpecial: true, previewUp: false })).toBe(true);
    expect(checkInsHeldNow({ overlay: false, slideSpecial: false, previewUp: true })).toBe(true);
    expect(checkInsHeldNow({ overlay: false, slideSpecial: false, previewUp: false })).toBe(false);
    expect(checkInsHeldNow({ overlay: true, slideSpecial: true, previewUp: true })).toBe(false);
  });
});

describe('roomFor', () => {
  it('hands a live critical notice to lobbyRoom, and nothing else', () => {
    const base = { overlay: false, boardState: 'hidden', checkInUp: false, leaveUp: false };
    expect(roomFor({ ...base, notice: { level: 'critical' }, noticeUp: true }).critical).toBe('centre');
    expect(roomFor({ ...base, notice: { level: 'critical' }, noticeUp: false }).critical).not.toBe('centre');
    expect(roomFor({ ...base, notice: { level: 'info' }, noticeUp: true }).critical).not.toBe('centre');
    expect(roomFor({ ...base, notice: null, noticeUp: false }).critical).not.toBe('centre');
  });
  it('keeps a critical notice to the band on an overlay feed', () => {
    const room = roomFor({
      overlay: true, notice: { level: 'critical' }, noticeUp: true, boardState: 'hidden', checkInUp: false, leaveUp: false,
    });
    expect(room.critical).toBe('band');
  });
});

describe('tickerIsActive', () => {
  const room = { board: null, banner: null };
  it('is up only when nothing else holds the foot', () => {
    expect(tickerIsActive({ checkInUp: false, held: false, room })).toBe(true);
    expect(tickerIsActive({ checkInUp: true, held: false, room })).toBe(false);
    expect(tickerIsActive({ checkInUp: false, held: true, room })).toBe(false);
    expect(tickerIsActive({ checkInUp: false, held: false, room: { board: {}, banner: null } })).toBe(false);
    expect(tickerIsActive({ checkInUp: false, held: false, room: { board: null, banner: {} } })).toBe(false);
  });
});

describe('cornerSlots', () => {
  const counts = { sparks: 7 };
  const q = { overlay: false, cornerClub: 'sparks', tallyCounts: counts, stickerTall: false };
  it('shows the club chip and takes the top slot when the club has a count', () => {
    expect(cornerSlots(q)).toEqual({ count: 7, chipUp: true, topTaken: true });
  });
  it('a tall sticker outranks the chip but still takes the slot', () => {
    expect(cornerSlots({ ...q, stickerTall: true })).toEqual({ count: 7, chipUp: false, topTaken: true });
  });
  it('is quiet with no club chosen, no tally for it, or on an overlay feed', () => {
    expect(cornerSlots({ ...q, cornerClub: '' })).toEqual({ count: null, chipUp: false, topTaken: false });
    expect(cornerSlots({ ...q, tallyCounts: null })).toEqual({ count: null, chipUp: false, topTaken: false });
    expect(cornerSlots({ ...q, overlay: true }).chipUp).toBe(false);
  });
});

describe('cornerSources', () => {
  const q = {
    config: { showClock: true, showTally: true, cornerStillHere: true },
    count: 12,
    weather: { temp: 50 },
    showWeatherChip: true,
    topTaken: false,
    tallySync: { from: 1, to: 9 },
    boardDecision: { state: BOARD_NAMES },
    boardData: { entries: [1, 2, 3] },
    pickup: true,
  };
  it('offers what the settings allow', () => {
    expect(cornerSources(q)).toEqual({
      clock: true, tally: 12, stillHere: 3, weather: { temp: 50 }, correction: { from: 1, to: 9 },
    });
  });
  it('drops the tally, the count-down and the correction with the tally off', () => {
    expect(cornerSources({ ...q, config: { showClock: false, showTally: false } })).toEqual({
      clock: false, tally: 0, stillHere: null, weather: { temp: 50 }, correction: null,
    });
  });
  it('drops the count-down when switched off, and the weather when the slot is taken', () => {
    const got = cornerSources({ ...q, config: { ...q.config, cornerStillHere: false }, topTaken: true });
    expect(got.stillHere).toBeNull();
    expect(got.weather).toBeNull();
  });
  it('shows no weather with the chip off', () => {
    expect(cornerSources({ ...q, showWeatherChip: false }).weather).toBeNull();
  });
});

describe('cornerFallbackMs / visibleCornerItem', () => {
  it('is null when the slideshow drives, else the slide delay with a 5 s floor', () => {
    expect(cornerFallbackMs(true, 8)).toBeNull();
    expect(cornerFallbackMs(false, 12)).toBe(12000);
    expect(cornerFallbackMs(false, 1)).toBe(5000);
    expect(cornerFallbackMs(false, undefined)).toBe(8000);
  });
  it('sends a top item away while the top slot is taken', () => {
    const top = { corner: 'top' };
    const bottom = { corner: 'bottom' };
    expect(visibleCornerItem(top, true)).toBeNull();
    expect(visibleCornerItem(top, false)).toBe(top);
    expect(visibleCornerItem(bottom, true)).toBe(bottom);
    expect(visibleCornerItem(null, true)).toBeNull();
  });
});

describe('flagTabs / posterIsHeld / stageClassName', () => {
  it('counts the tabs that hang, and hides simplified mode on an overlay feed', () => {
    expect(flagTabs({ overlay: false, panicMode: true, demoActive: true, rehearsalActive: true }))
      .toEqual({ panicUp: true, flagCount: 3, flagsUp: true });
    expect(flagTabs({ overlay: true, panicMode: true, demoActive: false, rehearsalActive: false }))
      .toEqual({ panicUp: false, flagCount: 0, flagsUp: false });
  });
  it('a poster is held only while check-ins are', () => {
    expect(posterIsHeld({ checkInsHeld: true, slidePoster: true, previewUp: false })).toBe(true);
    expect(posterIsHeld({ checkInsHeld: true, slidePoster: false, previewUp: true })).toBe(true);
    expect(posterIsHeld({ checkInsHeld: false, slidePoster: true, previewUp: true })).toBe(false);
    expect(posterIsHeld({ checkInsHeld: true, slidePoster: false, previewUp: false })).toBe(false);
  });
  it('builds the stage class list in order', () => {
    expect(stageClassName({ overlay: false, aprilFools: false, checkInUp: false, critical: null, flagsUp: false })).toBe('stage');
    expect(stageClassName({ overlay: false, aprilFools: true, checkInUp: true, critical: 'centre', flagsUp: true }))
      .toBe('stage april-fools checkin-active notice-takeover has-flags');
    expect(stageClassName({ overlay: true, aprilFools: false, checkInUp: true, critical: 'band', flagsUp: false }))
      .toBe('stage overlay');
  });
});

describe('isAprilFools', () => {
  it('is on only on April 1st and only when enabled', () => {
    expect(isAprilFools(true, '2027-04-01')).toBe(true);
    expect(isAprilFools(true, '2027-04-02')).toBe(false);
    expect(isAprilFools(true, '2027-03-01')).toBe(false);
    expect(isAprilFools(false, '2027-04-01')).toBe(false);
  });
});

describe('name faults and layer faults', () => {
  it('words each name fault and nothing else', () => {
    expect(nameFaultWords('no-key')).toBe('DISPLAY KEY NOT SET');
    expect(nameFaultWords('bad-key')).toContain('UNREADABLE');
    expect(nameFaultWords('downgraded')).toContain('UNENCRYPTED');
    expect(nameFaultWords('ok')).toBeNull();
    expect(nameFaultWords(undefined)).toBeNull();
    expect(nameFaultWords(null)).toBeNull();
  });
  it('keeps a layer fault for its window after the last crash', () => {
    const faults = { background: { lastAt: 1000 }, corner: { lastAt: 100 } };
    expect(activeFaults(faults, 1500, 1000)).toEqual(['background']);
    expect(activeFaults(faults, 2000, 1000)).toEqual([]);
    expect(activeFaults({}, 5, 1)).toEqual([]);
  });
});

describe('shouldShowStatus', () => {
  const quiet = {
    configured: false, status: 'connected', layerFaults: 0, droppedLong: false, opsFailures: 0, nameFault: false, countsWithoutNames: false,
  };
  it('is hidden on a healthy screen that switched it off', () => {
    expect(shouldShowStatus(quiet)).toBe(false);
  });
  it('shows when configured, or for any problem, whatever the setting', () => {
    expect(shouldShowStatus({ ...quiet, configured: true })).toBe(true);
    expect(shouldShowStatus({ ...quiet, status: 'off' })).toBe(true);
    expect(shouldShowStatus({ ...quiet, layerFaults: 1 })).toBe(true);
    expect(shouldShowStatus({ ...quiet, opsFailures: 2 })).toBe(true);
    expect(shouldShowStatus({ ...quiet, nameFault: true })).toBe(true);
    expect(shouldShowStatus({ ...quiet, countsWithoutNames: true })).toBe(true);
  });
  it('shows a dropped pipe only once it has dropped for long', () => {
    expect(shouldShowStatus({ ...quiet, status: 'disconnected', droppedLong: false })).toBe(false);
    expect(shouldShowStatus({ ...quiet, status: 'disconnected', droppedLong: true })).toBe(true);
    expect(shouldShowStatus({ ...quiet, status: 'connected', droppedLong: true })).toBe(false);
  });
  it('words its label', () => {
    expect(statusAriaLabel('connected', 0)).toBe('Connection status: connected');
    expect(statusAriaLabel('connected', 2)).toBe('Connection status: connected, 2 printer problem(s)');
  });
});

describe('reloadIsBusy', () => {
  const idle = {
    checkInUp: false, pending: 0, celebrationUp: false, celebrationsQueued: 0, settingsOpen: false,
    previewUp: false, slideEditorOpen: false, debugOpen: false, boardVisible: false, leaveUp: false,
    lastEventAt: null, now: 100_000, quietMs: 5000,
  };
  it('is free with nothing on screen', () => {
    expect(reloadIsBusy(idle)).toBe(false);
    expect(reloadIsBusy({ ...idle, lastEventAt: 1 })).toBe(false);
  });
  it.each([
    ['checkInUp', true], ['pending', 1], ['celebrationUp', true], ['celebrationsQueued', 1], ['settingsOpen', true],
    ['previewUp', true], ['slideEditorOpen', true], ['debugOpen', true], ['boardVisible', true], ['leaveUp', true],
  ])('waits for %s', (key, value) => {
    expect(reloadIsBusy({ ...idle, [key]: value })).toBe(true);
  });
  it('waits out the quiet time after an event, to the millisecond', () => {
    expect(reloadIsBusy({ ...idle, lastEventAt: 100_000 - 4999 })).toBe(true);
    expect(reloadIsBusy({ ...idle, lastEventAt: 100_000 - 5000 })).toBe(false);
  });
});

describe('shortcutFor', () => {
  const press = (key, extra = {}) => ({ ctrlKey: true, shiftKey: true, key, target: document.body, ...extra });
  it('maps the four chords, in either case', () => {
    expect(shortcutFor(press('d'))).toBe('debug');
    expect(shortcutFor(press('S'))).toBe('settings');
    expect(shortcutFor(press('e'))).toBe('editor');
    expect(shortcutFor(press('X'))).toBe('panic');
  });
  it('needs both modifiers and a known key', () => {
    expect(shortcutFor(press('d', { shiftKey: false }))).toBeNull();
    expect(shortcutFor(press('d', { ctrlKey: false }))).toBeNull();
    expect(shortcutFor(press('q'))).toBeNull();
    expect(shortcutFor(press('constructor'))).toBeNull();
  });
  it('never fires while typing in a field', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(shortcutFor(press('x', { target: document.createElement(tag) }))).toBeNull();
    }
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(shortcutFor(press('x', { target: editable }))).toBeNull();
    expect(shortcutFor(press('x', { target: document.createElement('button') }))).toBe('panic');
  });
});
