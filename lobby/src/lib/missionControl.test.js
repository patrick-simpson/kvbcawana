import { describe, expect, it } from 'vitest';
import {
  MISSION_RING, agoWords, alertsFrom, initialMission, readWords, reduceMission, runningCount, ymWords,
} from './missionControl.js';

const seen = (n, extra = {}) => ({ id: `id${n}`, firstName: `Kid${n}`, club: 'Sparks', at: 1000 + n, ...extra });

describe('mission control: the last check-ins', () => {
  it('keeps a first name, a club, a time and an id, nothing else', () => {
    const s = reduceMission(initialMission(), {
      type: 'checkin',
      payload: { ...seen(1), lastName: 'Smith', allergies: 'nuts', phone: '555', isBirthday: true, milestone: 5 },
    });
    expect(s.recent).toEqual([{ id: 'id1', firstName: 'Kid1', club: 'Sparks', at: 1001, oneOff: false }]);
    expect(JSON.stringify(s)).not.toMatch(/Smith|nuts|555/);
  });

  it('is a ring of five, newest first', () => {
    let s = initialMission();
    for (let i = 1; i <= 8; i += 1) s = reduceMission(s, { type: 'checkin', payload: seen(i) });
    expect(s.recent).toHaveLength(MISSION_RING);
    expect(s.recent.map((r) => r.firstName)).toEqual(['Kid8', 'Kid7', 'Kid6', 'Kid5', 'Kid4']);
  });

  it('dedupes by id, whether it arrives live or replayed in a recap', () => {
    let s = reduceMission(initialMission(), { type: 'checkin', payload: seen(1) });
    s = reduceMission(s, { type: 'recap', payload: { entries: [seen(1), seen(2)], at: 5 } });
    s = reduceMission(s, { type: 'checkin', payload: seen(2) });
    expect(s.recent.map((r) => r.id)).toEqual(['id2', 'id1']);
  });

  it('marks a one-off tag', () => {
    const s = reduceMission(initialMission(), { type: 'checkin', payload: seen(1, { oneOff: true }) });
    expect(s.recent[0].oneOff).toBe(true);
  });

  it('ignores a frame with no first name', () => {
    const s = reduceMission(initialMission(), { type: 'checkin', payload: { id: 'x', club: 'Sparks' } });
    expect(s).toEqual(initialMission());
  });

  it('is cleared on demand (sign-out, a long hidden page)', () => {
    let s = reduceMission(initialMission(), { type: 'checkin', payload: seen(1) });
    s = reduceMission(s, { type: 'tally', payload: { counts: { Sparks: 3 }, total: 3, at: 5 } });
    expect(reduceMission(s, { type: 'clear' })).toEqual(initialMission());
  });

  it('holds nothing in browser storage', () => {
    localStorage.clear();
    sessionStorage.clear();
    let s = initialMission();
    for (let i = 1; i <= 3; i += 1) s = reduceMission(s, { type: 'checkin', payload: seen(i) });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('mission control: the running count', () => {
  const overview = { at: '2026-10-14T23:00:00.000Z', count: { source: 'report', checkedIn: 40, byClub: { Sparks: 25, Cubbies: 15 }, reportAgeMs: 4000 } };
  const t = Date.parse('2026-10-14T23:00:00.000Z');

  it('shows the overview count', () => {
    expect(runningCount(overview, null)).toEqual({ total: 40, byClub: { Sparks: 25, Cubbies: 15 }, source: 'report', reportAgeMs: 4000 });
  });

  it('a newer live tally ticks it between polls; an older one does not', () => {
    const newer = runningCount(overview, { counts: { Sparks: 26, Cubbies: 15 }, total: 41, at: t + 3000 });
    expect(newer.total).toBe(41);
    const older = runningCount(overview, { counts: { Sparks: 1 }, total: 1, at: t - 3000 });
    expect(older.total).toBe(40);
  });

  it('tally alone is enough before the first poll; nothing is null', () => {
    expect(runningCount(null, { counts: { Sparks: 2 }, total: 2, at: 1 }).total).toBe(2);
    expect(runningCount(null, null)).toBeNull();
  });

  it('the tally reducer keeps the newest and only numbers', () => {
    let s = reduceMission(initialMission(), { type: 'tally', payload: { counts: { Sparks: 2, Bad: 'Maya' }, total: 2, at: 10 } });
    expect(s.tally.counts).toEqual({ Sparks: 2 });
    s = reduceMission(s, { type: 'tally', payload: { counts: { Sparks: 1 }, total: 1, at: 5 } });
    expect(s.tally.total).toBe(2);
  });
});

describe('mission control: alerts', () => {
  const now = Date.parse('2026-10-14T23:00:00.000Z');
  const ok = {
    window: { open: true }, read: { configured: true, signedIn: true, lastOkAt: now - 4000 },
    print: { checkThePrinter: 0, dead: 0, stations: [{ stationId: 'a', name: 'Laptop', lastSeenAt: new Date(now - 20000).toISOString(), churchRev: 3 }] },
    ym: null, history: { pending: 0 }, church: { rev: 3, savedAt: new Date(now - 600000).toISOString() },
  };
  const ids = (o) => alertsFrom(o, now).map((a) => a.id);

  it('a healthy night has none', () => expect(ids(ok)).toEqual([]));
  it('CHECK THE PRINTER', () => expect(ids({ ...ok, print: { ...ok.print, checkThePrinter: 2 } })).toContain('check-printer'));
  it('no station for 2 minutes while the window is open', () => {
    const stale = { ...ok, print: { ...ok.print, stations: [{ ...ok.print.stations[0], lastSeenAt: new Date(now - 180000).toISOString() }] } };
    expect(ids(stale)).toContain('no-station');
    expect(ids({ ...stale, window: { open: false } })).not.toContain('no-station');
  });
  it('TwoTimTwo read error and a blocked login', () => {
    expect(ids({ ...ok, read: { ...ok.read, lastError: 'timeout' } })).toContain('ttt-error');
    expect(ids({ ...ok, read: { ...ok.read, loginBlockedForSec: 300 } })).toContain('ttt-blocked');
  });
  it('dead jobs, YM failures, history outbox', () => {
    expect(ids({ ...ok, print: { ...ok.print, dead: 1 } })).toContain('dead-jobs');
    expect(ids({ ...ok, ym: { enabled: true, failed: 1 } })).toContain('ym');
    expect(ids({ ...ok, history: { pending: 2 } })).toContain('history');
  });
  it('a station behind on the church settings for over 2 minutes', () => {
    const behind = { ...ok, church: { rev: 4, savedAt: new Date(now - 300000).toISOString() } };
    expect(ids(behind)).toContain('church-behind');
    expect(ids({ ...ok, church: { rev: 4, savedAt: new Date(now - 30000).toISOString() } })).not.toContain('church-behind');
  });
  it('award slips held for a station on an old app, named', () => {
    const held = { ...ok, feeds: { slipsHeld: 2, oldStations: [{ name: 'Gym laptop', version: '9.4.9' }] } };
    const a = alertsFrom(held, now).find((x) => x.id === 'slips-held');
    expect(a).toMatchObject({ tone: 'warn' });
    expect(a.text).toContain('Award slips are waiting: station Gym laptop is on an old app');
    expect(ids({ ...ok, feeds: { slipsHeld: 0, oldStations: [] } })).not.toContain('slips-held');
    expect(ids({ ...ok, feeds: null })).not.toContain('slips-held');
    const two = alertsFrom({ ...ok, feeds: { slipsHeld: 1, oldStations: [{ name: 'A' }, { name: 'B' }] } }, now).find((x) => x.id === 'slips-held');
    expect(two.text).toContain('stations A, B are on an old app');
  });
  it('nothing in a missing overview', () => expect(alertsFrom(null, now)).toEqual([]));
});

describe('mission control: words', () => {
  it('ages', () => {
    const now = 1_000_000_000;
    expect(agoWords(now - 10_000, now)).toBe('just now');
    expect(agoWords(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(agoWords(null, now)).toBe('never');
  });
  it('the TwoTimTwo read', () => {
    expect(readWords({ configured: false }).tone).toBe('warn');
    expect(readWords({ configured: true, signedIn: true, lastOkAt: Date.now() }).tone).toBe('ok');
    expect(readWords({ configured: true, signedIn: false }).text).toMatch(/Signed out/);
    expect(readWords({ configured: true, loginBlockedForSec: 60 }).text).toMatch(/Blocked/);
  });

  it('a failed read says when, in plain words, and an earlier night\'s failure is history, not a problem now', () => {
    const now = Date.parse('2026-10-13T22:15:00Z');
    const recent = { configured: true, signedIn: true, lastError: 'report-unreadable', lastReadAt: new Date(now - 5 * 60000).toISOString() };
    expect(readWords(recent, now)).toEqual({ tone: 'warn', text: 'The read 5 min ago failed: the report page did not look like the report.' });
    const old = { ...recent, lastReadAt: new Date(now - 6 * 86400000).toISOString() };
    expect(readWords(old, now)).toEqual({ tone: 'ok', text: 'No read since 6 days ago (that one failed: the report page did not look like the report). It reads again on the next club night.' });
    expect(readWords({ ...recent, lastError: 'something-new' }, now).text).toMatch(/failed: something-new\.$/);
    const base = { read: recent, print: {}, window: { open: false } };
    expect(alertsFrom(base, now).map((a) => a.id)).toContain('ttt-error');
    expect(alertsFrom({ ...base, read: old }, now).map((a) => a.id)).not.toContain('ttt-error');
  });
  it('the check-out line', () => {
    expect(ymWords(null)).toBeNull();
    expect(ymWords({ enabled: false })).toMatch(/Off/);
    expect(ymWords({ enabled: true, checkedOut: 4, pending: 1, failed: 0, gaveUp: 0 })).toBe('4 checked out, 1 pending');
  });
});
