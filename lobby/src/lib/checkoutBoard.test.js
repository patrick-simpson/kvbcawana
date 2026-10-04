import { describe, it, expect } from 'vitest';
import {
  BOARD_ANONYMOUS,
  BOARD_EMPTY,
  BOARD_HIDDEN,
  BOARD_NAMES,
  BOARD_STALE,
  EMPTY_HOLD_MS,
  decideBoard,
  demoCheckout,
  groupByClub,
  inPickupWindow,
  parseHHMM,
  pickupNow,
  stillHereCount,
} from './checkoutBoard.js';

// These are safeguarding assertions, not UI polish.
//
// The board lists children who are not yet with a parent. Three of the tests
// below exist because a reviewer found a specific way this feature could be
// actively harmful, and each one is the guard against it:
//
//   - off by default, so it never appears because someone updated the app
//   - names suppressed once the list is short, because two names at 8:15pm is a
//     statement about two specific unattended children rather than a roster
//   - a missing payload renders NOTHING, never an empty board, because "I have
//     no data" and "everyone has been picked up" are opposite facts

const NOW = Date.UTC(2026, 8, 16, 23, 45);
const base = {
  mode: 'always',
  namesAbove: 3,
  staleMin: 8,
  now: NOW,
};
const payload = (n, atOffsetMin = 0, printed = 43) => ({
  entries: Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}`, club: 'Sparks' })),
  at: NOW - atOffsetMin * 60000,
  printed,
});

describe('the board is off unless the operator turned it on', () => {
  it('is hidden in every mode but pickup and always', () => {
    for (const mode of ['off', '', undefined, null, 'on', 'true', 'yes']) {
      const d = decideBoard({ ...base, mode, checkout: payload(10) });
      expect(d.state, `mode=${String(mode)}`).toBe(BOARD_HIDDEN);
    }
  });

  it('shows in always mode with fresh data', () => {
    expect(decideBoard({ ...base, mode: 'always', checkout: payload(10) }).state).toBe(BOARD_NAMES);
  });
});

describe('no data is never an empty board', () => {
  it('hides rather than claiming everyone has gone home', () => {
    for (const checkout of [null, undefined, {}, { entries: [] }, { entries: [], at: NaN }]) {
      const d = decideBoard({ ...base, checkout });
      expect(d.state, JSON.stringify(checkout)).toBe(BOARD_HIDDEN);
    }
  });

  it('but a REAL empty board is shown, because that is good news', () => {
    const d = decideBoard({ ...base, checkout: payload(0) });
    expect(d.state).toBe(BOARD_EMPTY);
  });
});

describe('names are suppressed once the list identifies individuals', () => {
  it('names a long list', () => {
    expect(decideBoard({ ...base, checkout: payload(12) }).state).toBe(BOARD_NAMES);
  });

  it('stops naming at or below the threshold', () => {
    for (const n of [1, 2, 3]) {
      const d = decideBoard({ ...base, namesAbove: 3, checkout: payload(n) });
      expect(d.state, `${n} children`).toBe(BOARD_ANONYMOUS);
    }
    expect(decideBoard({ ...base, namesAbove: 3, checkout: payload(4) }).state).toBe(BOARD_NAMES);
  });

  it('honours a raised threshold', () => {
    expect(decideBoard({ ...base, namesAbove: 10, checkout: payload(9) }).state).toBe(BOARD_ANONYMOUS);
    expect(decideBoard({ ...base, namesAbove: 10, checkout: payload(11) }).state).toBe(BOARD_NAMES);
  });

  it('allows the guard to be switched off entirely, explicitly', () => {
    // Not recommended, but it must be the operator's decision rather than
    // something the code quietly overrides.
    expect(decideBoard({ ...base, namesAbove: 0, checkout: payload(1) }).state).toBe(BOARD_NAMES);
  });

  it('says WHY it went anonymous, so the operator does not think it broke', () => {
    const d = decideBoard({ ...base, checkout: payload(2) });
    expect(d.reason).toMatch(/unattended/i);
  });
});

describe('going quiet shows as age, not as a frozen list', () => {
  it('is stale past the budget', () => {
    const d = decideBoard({ ...base, staleMin: 8, checkout: payload(10, 20) });
    expect(d.state).toBe(BOARD_STALE);
    expect(d.ageMin).toBe(20);
  });

  it('is fresh inside the budget', () => {
    expect(decideBoard({ ...base, staleMin: 8, checkout: payload(10, 5) }).state).toBe(BOARD_NAMES);
  });

  it('treats a FUTURE timestamp as age zero, not as fresh forever', () => {
    // Two unsynchronized clocks. A producer running fast must not be able to pin
    // the board open indefinitely — which is what a naive `now - at < budget`
    // comparison does with a negative age.
    const d = decideBoard({ ...base, checkout: payload(10, -600) });
    expect(d.state).toBe(BOARD_NAMES);
    expect(d.ageMin).toBe(0);
  });

  it('staleness wins over name suppression', () => {
    // A stale short list must not render as the anonymous message, which would
    // imply live knowledge that almost everyone had gone.
    expect(decideBoard({ ...base, checkout: payload(2, 30) }).state).toBe(BOARD_STALE);
  });
});

describe('pickup mode restricts it to the pickup window the church sets', () => {
  // Local wall-clock times, as the screen reads them (a Wednesday).
  const at = (h, m) => new Date(2026, 9, 7, h, m).getTime();
  const pickupBase = (now, extra = {}) => ({ ...base, mode: 'pickup', now, checkout: { ...payload(10), at: now }, ...extra });

  it('is hidden before the window: during arrival, the lesson and game time', () => {
    for (const [h, m] of [[18, 0], [18, 40], [19, 29], [19, 34]]) {
      expect(decideBoard(pickupBase(at(h, m))).state, `${h}:${m}`).toBe(BOARD_HIDDEN);
    }
  });

  it('is up from 7:35 pm by default — the old phase rule took it DOWN at 7:35', () => {
    for (const [h, m] of [[19, 35], [19, 50], [20, 15], [20, 29]]) {
      expect(decideBoard(pickupBase(at(h, m))).state, `${h}:${m}`).toBe(BOARD_NAMES);
    }
  });

  it('is gone by the end of the window, whatever the list says', () => {
    expect(decideBoard(pickupBase(at(20, 30))).state).toBe(BOARD_HIDDEN);
    expect(decideBoard(pickupBase(at(21, 0))).reason).toMatch(/outside the pickup window/);
  });

  it('follows the times set in Settings, including a window past midnight', () => {
    expect(decideBoard(pickupBase(at(19, 10), { from: '19:00', until: '19:30' })).state).toBe(BOARD_NAMES);
    expect(decideBoard(pickupBase(at(19, 40), { from: '19:00', until: '19:30' })).state).toBe(BOARD_HIDDEN);
    expect(inPickupWindow(at(23, 50), '23:00', '00:30')).toBe(true);
    expect(inPickupWindow(at(0, 10), '23:00', '00:30')).toBe(true);
    expect(inPickupWindow(at(1, 0), '23:00', '00:30')).toBe(false);
    expect(inPickupWindow(at(19, 40), '19:00', '19:00')).toBe(false);
    // A malformed time falls back to the default.
    expect(inPickupWindow(at(19, 40), 'soon', 'later')).toBe(true);
  });

  it('once the list empties it says so for a minute, then steps away', () => {
    const now = at(20, 5);
    const empty = { ...base, mode: 'pickup', now, checkout: { ...payload(0), at: now } };
    expect(decideBoard({ ...empty, emptySince: null }).state).toBe(BOARD_EMPTY);
    expect(decideBoard({ ...empty, emptySince: now - EMPTY_HOLD_MS + 1000 }).state).toBe(BOARD_EMPTY);
    const gone = decideBoard({ ...empty, emptySince: now - EMPTY_HOLD_MS });
    expect(gone.state).toBe(BOARD_HIDDEN);
    expect(gone.reason).toMatch(/everyone has been checked out/);
  });

  it('always mode ignores the window, and keeps its empty card', () => {
    expect(decideBoard({ ...base, mode: 'always', now: at(18, 30), checkout: { ...payload(10), at: at(18, 30) } }).state)
      .toBe(BOARD_NAMES);
    const now = at(20, 5);
    expect(decideBoard({ ...base, mode: 'always', now, checkout: { ...payload(0), at: now }, emptySince: now - 10 * EMPTY_HOLD_MS }).state)
      .toBe(BOARD_EMPTY);
  });

  it('a demo shows on any mode and clock, and still withholds names when told to', () => {
    const now = at(14, 0);
    const demo = { ...base, mode: 'off', now, demo: true };
    expect(decideBoard({ ...demo, checkout: { ...payload(10), at: now } }).state).toBe(BOARD_NAMES);
    expect(decideBoard({ ...demo, namesAbove: 20, checkout: { ...payload(10), at: now } }).state).toBe(BOARD_ANONYMOUS);
    expect(decideBoard({ ...demo, checkout: null }).state).toBe(BOARD_HIDDEN);
  });

  it('pickupNow: the window for either mode that is on, always for a demo', () => {
    expect(pickupNow({ mode: 'pickup', now: at(19, 40) })).toBe(true);
    expect(pickupNow({ mode: 'always', now: at(19, 40) })).toBe(true);
    expect(pickupNow({ mode: 'always', now: at(18, 40) })).toBe(false);
    expect(pickupNow({ mode: 'off', now: at(19, 40) })).toBe(false);
    expect(pickupNow({ mode: 'off', now: at(9, 0), demo: true })).toBe(true);
  });

  it('parseHHMM reads 24-hour times only', () => {
    expect(parseHHMM('19:35')).toBe(19 * 60 + 35);
    expect(parseHHMM('00:00')).toBe(0);
    for (const bad of ['7:35', '24:00', '19:60', '', null, 1935]) expect(parseHHMM(bad)).toBeNull();
  });
});

describe('the corner counts down only what the board itself would say', () => {
  const names = { state: BOARD_NAMES };
  it('counts the list while the board names children, in pickup time', () => {
    expect(stillHereCount(names, payload(12), true)).toBe(12);
  });
  it('never outside pickup time', () => {
    expect(stillHereCount(names, payload(12), false)).toBeNull();
  });
  it('never a small number the board withholds, and never from a stale or empty board', () => {
    for (const state of [BOARD_ANONYMOUS, BOARD_STALE, BOARD_EMPTY, BOARD_HIDDEN]) {
      expect(stillHereCount({ state }, payload(2), true), state).toBeNull();
    }
    expect(stillHereCount(names, null, true)).toBeNull();
  });
});

describe('the demo board', () => {
  it('fills every club with made-up names, deterministically', () => {
    const clubs = ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'];
    const a = demoCheckout(clubs, ['A', 'B', 'C'], 5);
    expect(a.at).toBe(5);
    expect(new Set(a.entries.map((e) => e.club))).toEqual(new Set(clubs));
    expect(a.entries.length).toBe(17);
    expect(demoCheckout(clubs, ['A', 'B', 'C'], 5)).toEqual(a);
  });
});

describe('grouping is deterministic', () => {
  const entries = [
    { firstName: 'Zoe', club: 'Sparks' },
    { firstName: 'Amy', club: 'Sparks' },
    { firstName: 'Ben', club: 'T&T' },
    { firstName: 'Cal', club: '' },
  ];

  it('groups by club, largest first, names sorted', () => {
    expect(groupByClub(entries)).toEqual([
      { club: 'Sparks', names: ['Amy', 'Zoe'] },
      { club: 'Other', names: ['Cal'] },
      { club: 'T&T', names: ['Ben'] },
    ]);
  });

  it('with an order, clubs stand in it (youngest to oldest) and the rest come after', () => {
    expect(groupByClub(entries, ['Puggles', 't&t', 'Sparks']).map((g) => g.club)).toEqual(['T&T', 'Sparks', 'Other']);
  });

  it('produces the same order every time — the wall must not reshuffle', () => {
    const a = JSON.stringify(groupByClub(entries));
    const b = JSON.stringify(groupByClub([...entries].reverse()));
    expect(a).toBe(b);
  });

  it('survives junk', () => {
    expect(groupByClub([])).toEqual([]);
    expect(groupByClub(null)).toEqual([]);
    expect(groupByClub(undefined)).toEqual([]);
  });
});

describe('decideBoard ages the data by this screen\'s clock when App stamped it', () => {
  it('a payload stamped fresh here is live, however far off the printer\'s own at is', () => {
    const now = 1_700_000_000_000;
    const d = decideBoard({
      checkout: { entries: [{ firstName: 'Ava', club: 'Sparks' }], printed: 10, at: now - 90 * 60 * 1000, receivedAt: now - 1000 },
      mode: 'always', namesAbove: 0, staleMin: 15, now,
    });
    expect(d.state).not.toBe(BOARD_STALE);
  });
  it('a payload the printer stamped hours ago is old whatever its arrival says (a replayed frame)', () => {
    const now = 1_700_000_000_000;
    const d = decideBoard({
      checkout: { entries: [{ firstName: 'Ava', club: 'Sparks' }], printed: 10, at: now - 26 * 60 * 60 * 1000, receivedAt: now - 1000 },
      mode: 'always', namesAbove: 0, staleMin: 15, now,
    });
    expect(d.state).toBe(BOARD_STALE);
  });
  it('an unstamped payload is aged by its own at, as before', () => {
    const now = 1_700_000_000_000;
    const d = decideBoard({
      checkout: { entries: [{ firstName: 'Ava', club: 'Sparks' }], printed: 10, at: now - 2 * 60 * 60 * 1000 },
      mode: 'always', namesAbove: 0, staleMin: 15, now,
    });
    expect(d.state).toBe(BOARD_STALE);
  });
});
