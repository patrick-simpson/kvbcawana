// The trends back-fill (trendsimport.js; routes.md section 3, owner 2026-10-13):
// TwoTimTwo's Attendance Summary CSV, one season per read, into D1's
// night_summary_import, by itself from the watcher's alarm. The parser is strict
// (a changed report stores nothing), the live desk line always wins over an
// imported one, the reads keep the one 15 s clock at the lowest priority and
// never in a club night's window, and a restart resumes where it was.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildTrends } from '../../src/lib/historyTrends.js';
import { READ_INTERVAL_MS } from '../src/readbudget.js';
import {
  BACKOFF_MS, COUNT_MAX, CROSSCHECK_EXAMPLES, SEASONS_MAX, UNREADABLE_RETRY_MS, UNREADABLE_TRIES,
  crossCheckOf, importCutoff, lastClosedClubNight, meetingDate, parseAttendanceSummary, seasonLabel,
} from '../src/trendsimport.js';
import { d1Stub } from './d1stub.js';
import { everything, plainWords } from './helpers.js';
import { kid, rig } from './rig.js';

// Sunday noon Eastern: no club window. Wednesday 6 pm: the window is open.
const SUNDAY = Date.parse('2026-10-11T16:00:00Z');
const WED_6PM = Date.parse('2026-10-14T22:00:00Z');
const WED_905PM = Date.parse('2026-10-15T01:05:00Z');
const THU_0005 = Date.parse('2026-10-15T04:05:00Z');

// TwoTimTwo's header, exactly as printer/docs/TWOTIMTWO.md (sections 4 and 8.1) shows it.
const HEADER = '"Meeting","Puggles","","Cubbies","","Sparks","","T&T","","Trek","","Journey","","TOTAL",""';

// The current season (year_start=2026), newest first, the NEXT unheld meeting on
// top (all blank, TOTAL 0): the docs' own description of the live report.
const SEASON_2026 = `${HEADER}\r
"10/14/2026","","","","","","","","","","","","","0",""\r
"10/7/2026","6","","14","","22","","31","","12","","9","","94",""\r
"9/30/2026","5","","13","","20","","29","","11","","8","","86",""\r
"9/23/2026","7","","12","","21","","30","","10","","9","","89",""\r
"9/16/2026","4","","15","","19","","28","","13","","7","","86",""\r
"9/9/2026","6","","11","","18","","27","","9","","6","","77",""\r
`;

// Last season, across New Year, with the blank-headed partner column filled (a
// percent, perhaps: its meaning is not documented, so it is never read).
const SEASON_2025 = `\uFEFF${HEADER}\r
"5/13/2026","5","42%","12","55%","20","61%","28","70%","10","48%","7","39%","82","58%"\r
"1/7/2026","6","50%","13","59%","19","58%","26","65%","9","43%","8","44%","81","57%"\r
"9/10/2025","4","33%","10","45%","18","55%","25","63%","8","38%","6","33%","71","50%"\r
`;

// Two seasons back: no Puggles that year (a club the header does not list is not read).
const SEASON_2024 = `"Meeting","Cubbies","","Sparks","","T&T","","Trek","","Journey","","TOTAL",""\r
"3/5/2025","9","","15","","22","","7","","5","","58",""\r
"9/11/2024","8","","14","","20","","6","","5","","53",""\r
`;

// A season with no meetings at all: the walk back stops here.
const EMPTY = `${HEADER}\r\n`;

// The same report with a changed header: refused whole.
const CHANGED = `"Date","Puggles","","Cubbies","","Sparks","","T&T","","Trek","","Journey","","TOTAL",""\r
"10/7/2026","6","","14","","22","","31","","12","","9","","94",""\r
`;

const SEASONS = { 2026: SEASON_2026, 2025: SEASON_2025, 2024: SEASON_2024, 2023: EMPTY };

/** A whole Worker on a stand-in TwoTimTwo and D1, whose Attendance Summary the test edits. */
async function setup({ start = SUNDAY, seasons = { ...SEASONS }, env = {}, db = d1Stub(), kids = [] } = {}) {
  const asked = [];
  const r = await rig({
    start, kids,
    env: { ...(db ? { HISTORY_DB: db } : {}), ...env },
    attendance: (year, output) => {
      asked.push({ year: Number(year), output, at: r.clock.t });
      const v = seasons[year];
      return typeof v === 'function' ? v() : v ?? EMPTY;
    },
  });
  return { r, db, seasons, asked };
}

/**
 * Run the Durable Object's alarm as Cloudflare would, at the time it set, `max` times, or
 * (untilIdle) until the back-fill has nothing due or is waiting out a back-off of minutes.
 */
async function alarms(r, max = 40, { untilIdle = true } = {}) {
  for (let i = 0; i < max; i++) {
    await r.core.alarm();
    const wake = r.core.trends.wakeInMs();
    if (untilIdle && (wake === null || wake > 5 * 60 * 1000)) return i + 1;
    if (r.alarm.at > r.clock.t) r.clock.t = r.alarm.at;
  }
  return max;
}

const imported = (db) => db.query('SELECT night, club, attended FROM night_summary_import ORDER BY night, club');
const status = async (r) => (await r.call('GET', '/v1/history/import-status')).body;

describe('parseAttendanceSummary: strict', () => {
  it('reads the documented report: clubs by the club table, the unheld meeting skipped, oldest first', () => {
    const p = parseAttendanceSummary(SEASON_2026, 2026, '2026-10-11');
    expect(p.ok).toBe(true);
    expect(p.nights.map((n) => n.night)).toEqual(['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30', '2026-10-07']);
    expect(p.nights[4].counts).toEqual({ Puggles: 6, Cubbies: 14, Sparks: 22, 'T&T': 31, Trek: 12, Journey: 9 });
    expect(p.fp).toMatch(/^[0-9a-f]{8}$/);
  });

  it('ignores the partner column (number-like only) and reads a header without a club', () => {
    const p = parseAttendanceSummary(SEASON_2025, 2025, '2026-10-11');
    expect(p.ok).toBe(true);
    expect(p.nights.map((n) => n.night)).toEqual(['2025-09-10', '2026-01-07', '2026-05-13']);
    expect(p.nights[1].counts).toEqual({ Puggles: 6, Cubbies: 13, Sparks: 19, 'T&T': 26, Trek: 9, Journey: 8 });
    const old = parseAttendanceSummary(SEASON_2024, 2024, '2026-10-11');
    expect(old.ok && old.nights[0].counts).toEqual({ Cubbies: 8, Sparks: 14, 'T&T': 20, Trek: 6, Journey: 5 });
  });

  it('an empty season is an honest empty, not a refusal', () => {
    expect(parseAttendanceSummary(EMPTY, 2023, '2026-10-11')).toMatchObject({ ok: true, nights: [] });
  });

  it('refuses the whole season for a changed header', () => {
    const why = (text) => { const p = parseAttendanceSummary(text, 2026, '2026-10-11'); return p.ok ? 'ok' : p.why; };
    expect(why(CHANGED)).toBe('header');
    expect(why(SEASON_2026.replace('"TOTAL",""', '"Total",""'))).toBe('header');
    expect(why(SEASON_2026.replace('"Sparks","",', '"Sparks","%",'))).toBe('header');
    expect(why(SEASON_2026.replace('"Trek"', '"Leaders"'))).toBe('header');                  // a club the app does not know
    expect(why(SEASON_2026.replace('"Journey"', '"Sparks"'))).toBe('header');                // a club twice
    expect(why(SEASON_2026.replace(HEADER, '"Meeting","Puggles","Cubbies","Sparks","T&T","Trek","Journey","TOTAL"'))).toBe('header');
    expect(why('<html><body><form><input name="LoginForm[password]"></form></body></html>')).toBe('not-csv');
    expect(why('')).toBe('not-csv');
  });

  it('refuses a row whose clubs do not add up to its TOTAL, a bad count, a bad width, a twice-listed night', () => {
    const why = (text) => { const p = parseAttendanceSummary(text, 2026, '2026-10-11'); return p.ok ? 'ok' : p.why; };
    expect(why(SEASON_2026.replace('"94"', '"95"'))).toBe('total-mismatch');
    expect(why(SEASON_2026.replace('"22"', '"2x"'))).toBe('bad-count');
    expect(why(SEASON_2026.replace('"31",""', '"31","Ada"'))).toBe('bad-count');            // the partner column holds words
    expect(why(SEASON_2026.replace('"9","","94",""', '"9","94",""'))).toBe('row-shape');
    expect(why(SEASON_2026.replace('"9/30/2026"', '"10/7/2026"'))).toBe('duplicate-night');
    expect(why(SEASON_2026.replace('"9/9/2026"', '"Opening night"'))).toBe('bad-date');       // not a date and not a summary row
  });

  it('skips summary rows, blank lines and every night after the cutoff; clamps counts', () => {
    const withTotal = `${SEASON_2026}"Total","28","","65","","100","","145","","55","","39","","432",""\r\n\r\n`;
    expect(parseAttendanceSummary(withTotal, 2026, '2026-10-11')).toMatchObject({ ok: true });
    const p = parseAttendanceSummary(SEASON_2026, 2026, '2026-09-23');
    expect(p.ok && p.nights.map((n) => n.night)).toEqual(['2026-09-09', '2026-09-16', '2026-09-23']);
    const big = `${HEADER}\r\n"10/7/2026","","","","","2500","","","","","","","","2500",""\r\n`;
    const b = parseAttendanceSummary(big, 2026, '2026-10-11');
    expect(b.ok && b.nights[0].counts).toEqual({ Sparks: COUNT_MAX });
  });

  it('a dated meeting outside the season asked for is refused (year_start not understood)', () => {
    expect(parseAttendanceSummary(SEASON_2026, 2025, '2026-10-11')).toEqual({ ok: false, why: 'out-of-season' });
  });
});

describe('meetingDate: the Meeting column, with or without a year', () => {
  it('takes the year from the Aug-1 season boundary when the cell has none', () => {
    expect(meetingDate('Sep02', 2025)).toEqual({ iso: '2025-09-02', hasYear: false });
    expect(meetingDate('Aug 1', 2025)).toEqual({ iso: '2025-08-01', hasYear: false });
    expect(meetingDate('Jul31', 2025)).toEqual({ iso: '2026-07-31', hasYear: false });
    expect(meetingDate('Jan 7', 2025)).toEqual({ iso: '2026-01-07', hasYear: false });
    expect(meetingDate('12/31', 2025)).toEqual({ iso: '2025-12-31', hasYear: false });
    expect(meetingDate('1/7', 2025)).toEqual({ iso: '2026-01-07', hasYear: false });
    expect(meetingDate('Feb 29', 2027)).toEqual({ iso: '2028-02-29', hasYear: false });   // 2028 is a leap year
    expect(meetingDate('Feb 29', 2025)).toBeNull();
  });

  it('reads a few exact shapes with a year, and nothing looser', () => {
    expect(meetingDate('2025-09-10', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('9/10/2025', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('9/10/25', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('Wed 9/10/2025', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('Wednesday, September 10, 2025', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('Sept 10', 2025)).toEqual({ iso: '2025-09-10', hasYear: false });
    expect(meetingDate('10 Sep 2025', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    expect(meetingDate('9/10/2025 6:00 PM', 2025)).toEqual({ iso: '2025-09-10', hasYear: true });
    for (const bad of ['', 'Total', '13/40/2025', '2025/09/10', 'Sepx 10', '9-10-2025', 'Opening night', '10']) expect(meetingDate(bad, 2025)).toBeNull();
  });

  it('the cutoff and the last closed club night follow the watch window', () => {
    expect(importCutoff(SUNDAY)).toBe('2026-10-11');
    expect(importCutoff(WED_6PM)).toBe('2026-10-13');          // tonight is not over
    expect(importCutoff(WED_905PM)).toBe('2026-10-14');        // the window closed at 9 pm
    expect(lastClosedClubNight(SUNDAY)).toBe('2026-10-07');
    expect(lastClosedClubNight(WED_6PM)).toBe('2026-10-07');
    expect(lastClosedClubNight(WED_905PM)).toBe('2026-10-14');
    expect(seasonLabel(2025)).toBe('2025-26');
  });
});

describe('the back-fill, from the alarm', () => {
  it('walks back from the current season until a season has no meetings, then stops', async () => {
    const { r, db, asked } = await setup();
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023]);
    expect(asked.every((a) => a.output === 'csv')).toBe(true);
    expect(imported(db)).toHaveLength(5 * 6 + 3 * 6 + 2 * 5);
    expect(db.query("SELECT club, attended FROM night_summary_import WHERE night = '2025-01-07' OR night = '2026-01-07'"))
      .toEqual(expect.arrayContaining([{ club: 'T&T', attended: 26 }]));
    const s = await status(r);
    expect(s).toMatchObject({
      state: 'done', oldestSeason: '2024-25', ended: 'empty', lastError: null, nextDueAt: null,
      seasons: [{ season: '2026-27', nights: 5 }, { season: '2025-26', nights: 3 }, { season: '2024-25', nights: 2 }],
    });
    // Nothing more is read until a club night closes.
    r.clock.t += 2 * 3600 * 1000;
    await alarms(r, 5, { untilIdle: false });
    expect(asked).toHaveLength(4);
  });

  it('keeps the one read clock: every TwoTimTwo request 15 s apart, a booked clock waits a tick', async () => {
    const { r, asked } = await setup();
    // Another read has just taken the clock: the back-fill does not read, and wakes when it frees.
    r.core.watcher.budget.note(r.clock.t);
    await r.core.alarm();
    expect(asked).toHaveLength(0);
    expect(r.alarm.at - r.clock.t).toBeGreaterThanOrEqual(READ_INTERVAL_MS - 1000);
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023]);
    const at = r.slots.map((x) => x.at);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(READ_INTERVAL_MS);
  });

  it('never reads inside a club night\'s window (the lowest priority)', async () => {
    const { r, asked } = await setup({ start: WED_6PM, kids: [kid('11', 'Sparks')] });
    for (let i = 0; i < 30; i++) {
      await r.core.alarm();
      r.clock.t = Math.max(r.clock.t, r.alarm.at);
    }
    expect(r.reads.some((x) => x.path === '/clubber/checkin_report')).toBe(true);
    expect(asked).toEqual([]);
    // ...and the module's own guard, asked directly in the window.
    expect(await r.core.trends.step()).toBe(false);
    expect(r.core.trends.wakeInMs()).toBeNull();
    expect(asked).toEqual([]);
  });

  it('the current season is read again once after a club night closes, never during it', async () => {
    const { r, db, seasons, asked } = await setup();
    await alarms(r);
    expect(asked).toHaveLength(4);
    // Wednesday: a paper sheet is entered late for last week, and tonight happens.
    seasons[2026] = SEASON_2026
      .replace('"10/14/2026","","","","","","","","","","","","","0",""', '"10/14/2026","6","","15","","23","","30","","12","","9","","95",""')
      .replace('"10/7/2026","6","","14","","22","","31","","12","","9","","94",""', '"10/7/2026","6","","14","","24","","31","","12","","9","","96",""');
    r.clock.t = WED_6PM;
    for (let i = 0; i < 10; i++) { await r.core.alarm(); r.clock.t = Math.max(r.clock.t, r.alarm.at); }
    expect(asked).toHaveLength(4);
    r.clock.t = WED_905PM;
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023, 2026]);
    expect(db.query("SELECT attended FROM night_summary_import WHERE night = '2026-10-07' AND club = 'Sparks'")).toEqual([{ attended: 24 }]);
    expect(db.query("SELECT COUNT(*) AS n FROM night_summary_import WHERE night = '2026-10-14'")).toEqual([{ n: 6 }]);
    // Once per club night: the rest of the week reads nothing.
    r.clock.t += 3 * 24 * 3600 * 1000;
    await alarms(r, 5, { untilIdle: false });
    expect(asked).toHaveLength(5);
  });

  it('with the youth check-out on, the refresh waits for it to finish at midnight', async () => {
    const { r, asked } = await setup({ env: { YM_CHECKOUT: 'on' } });
    await alarms(r);
    r.clock.t = WED_905PM;
    await r.core.alarm();
    expect(asked).toHaveLength(4);
    r.clock.t = THU_0005;
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023, 2026]);
  });

  it('is idempotent: a second whole run stores exactly the same lines', async () => {
    const { r, db } = await setup();
    await alarms(r);
    const first = imported(db);
    await r.storage.delete('trends:import');
    r.restart();
    r.clock.t += 60 * 1000;
    await alarms(r);
    expect(imported(db)).toEqual(first);
  });

  it('a restart resumes from its stored state, never from the start', async () => {
    const { r, db, asked } = await setup();
    // Two seasons, then the object restarts (a deploy).
    for (let i = 0; i < 40 && asked.length < 2; i++) { await r.core.alarm(); r.clock.t = Math.max(r.clock.t, r.alarm.at); }
    expect(asked.map((a) => a.year)).toEqual([2026, 2025]);
    r.restart();
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023]);
    expect(imported(db)).toHaveLength(58);
  });

  it('a changed report stores nothing for that season, is tried after a day, 3 times, then skipped', async () => {
    const { r, db, asked } = await setup({ seasons: { ...SEASONS, 2025: CHANGED.replace(/2026/g, '2025') } });
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025]);
    let s = await status(r);
    expect(s).toMatchObject({ state: 'unreadable', unreadableWhy: 'header', lastError: 'unreadable' });
    expect(Date.parse(s.nextDueAt) - r.clock.t).toBeGreaterThanOrEqual(UNREADABLE_RETRY_MS - 60000);
    expect(db.query("SELECT COUNT(*) AS n FROM night_summary_import WHERE night BETWEEN '2025-08-01' AND '2026-07-31'")).toEqual([{ n: 0 }]);
    for (let day = 1; day < UNREADABLE_TRIES; day++) {
      r.clock.t += UNREADABLE_RETRY_MS;
      await alarms(r, 10);
    }
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2025, 2025, 2024, 2023]);
    s = await status(r);
    expect(s).toMatchObject({ state: 'done', skipped: ['2025-26'], oldestSeason: '2024-25', ended: 'empty' });
    expect(s.seasons.map((x) => x.season)).toEqual(['2026-27', '2024-25']);
  });

  it('TwoTimTwo answering the current season for an older one stops the walk and stores nothing', async () => {
    // The Meeting column without a year (as the grid's): only the fingerprint can tell.
    const noYear = SEASON_2026.replace(/"(\d{1,2})\/(\d{1,2})\/2026"/g, '"$1/$2"');
    const { r, db, asked } = await setup({ seasons: { 2026: noYear, 2025: noYear, 2024: noYear } });
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025]);
    expect(await status(r)).toMatchObject({ state: 'done', ended: 'year-ignored', lastError: 'year-ignored', oldestSeason: '2026-27' });
    expect(imported(db)).toHaveLength(30);
    // ...and with years in it, the dates themselves tell.
    const dated = await setup({ seasons: { 2026: SEASON_2026, 2025: SEASON_2026 } });
    await alarms(dated.r);
    expect(dated.asked.map((a) => a.year)).toEqual([2026, 2025]);
    expect((await status(dated.r)).ended).toBe('year-ignored');
  });

  it('backs off after errors: 5 minutes, 15 minutes, an hour', async () => {
    const { r, asked } = await setup();
    r.tt.down = true;
    const gaps = [];
    for (let i = 0; i < 3; i++) {
      const before = r.clock.t;
      await r.core.alarm();
      const s = await status(r);
      expect(s.lastError).toBe('twotimtwo-down');
      gaps.push(Date.parse(s.nextDueAt) - before);
      r.clock.t = Date.parse(s.nextDueAt);
    }
    expect(gaps[0]).toBeGreaterThanOrEqual(BACKOFF_MS[0]);
    expect(gaps[1]).toBeGreaterThanOrEqual(BACKOFF_MS[1]);
    expect(gaps[2]).toBeGreaterThanOrEqual(BACKOFF_MS[2]);
    expect(asked).toEqual([]);
    r.tt.down = false;
    await alarms(r);
    expect(asked.map((a) => a.year)).toEqual([2026, 2025, 2024, 2023]);
  });

  it('stops at SEASONS_MAX seasons', async () => {
    const all = {};
    for (let y = 2026; y > 2026 - SEASONS_MAX - 3; y--) {
      all[y] = `${HEADER}\r\n"9/${10 + ((2026 - y) % 15)}/${y}","1","","1","","1","","1","","1","","${2026 - y + 1}","","${2026 - y + 6}",""\r\n`;
    }
    const { r, asked } = await setup({ seasons: all });
    await alarms(r, 80);
    expect(asked).toHaveLength(SEASONS_MAX);
    expect(await status(r)).toMatchObject({ ended: 'cap', oldestSeason: seasonLabel(2026 - SEASONS_MAX + 1) });
  });

  it('a season is ONE D1 batch of a few statements, within D1\'s 100 bound parameters', async () => {
    const db = d1Stub();
    const batches = [];
    const real = db.batch.bind(db);
    db.batch = async (stmts) => { batches.push(stmts.map((s) => s.args.length)); return real(stmts); };
    const rows = [];
    for (let i = 0; i < 40; i++) {
      const d = new Date(Date.UTC(2025, 8, 3 + i * 7)).toISOString().slice(0, 10);
      const [y, m, dd] = d.split('-').map(Number);
      rows.push(`"${m}/${dd}/${y}","1","","2","","3","","4","","5","","6","","21",""`);
    }
    const big = `${HEADER}\r\n${rows.reverse().join('\r\n')}\r\n`;
    const { r } = await setup({ db, seasons: { 2026: EMPTY, 2025: big, 2024: EMPTY } });
    await alarms(r);
    const season = batches.find((b) => b.length > 1);
    expect(season.length).toBe(1 + Math.ceil(240 / 32));
    expect(Math.max(...season)).toBeLessThanOrEqual(100);
    expect(db.query("SELECT COUNT(*) AS n FROM night_summary_import")).toEqual([{ n: 240 }]);
  });
});

describe('not configured: idle, and says so', () => {
  it('no HISTORY_DB: reads nothing', async () => {
    const { r, asked } = await setup({ db: null });
    await alarms(r, 5, { untilIdle: false });
    expect(asked).toEqual([]);
    expect(await status(r)).toMatchObject({ state: 'not-configured', reason: 'history-off', nextDueAt: null });
  });

  it('no TwoTimTwo secrets, or cloud check-in off: reads nothing', async () => {
    const none = await setup({ env: { TWOTIMTWO_PASSWORD: '' } });
    await alarms(none.r, 5, { untilIdle: false });
    expect(none.asked).toEqual([]);
    expect(await status(none.r)).toMatchObject({ state: 'not-configured', reason: 'no-secrets' });
    const off = await setup({ env: { CLOUD_CHECKIN: 'off' } });
    await alarms(off.r, 5, { untilIdle: false });
    expect(off.asked).toEqual([]);
    expect(await status(off.r)).toMatchObject({ state: 'not-configured', reason: 'cloud-off' });
  });

  it('a refused sign-in: not configured until it works', async () => {
    const { r, asked } = await setup({ env: { TWOTIMTWO_PASSWORD: 'wrong-pass' } });
    await r.core.alarm();
    expect(asked).toEqual([]);
    expect(await status(r)).toMatchObject({ state: 'not-configured', reason: 'sign-in-refused' });
  });
});

describe('GET /v1/history/summary: the live line wins, never double counted', () => {
  it('answers the live line where one exists, else the imported count marked imported', async () => {
    const { r, db } = await setup();
    await alarms(r);
    // The desk counted Sparks on Oct 7 itself (live, deltas).
    db.query("INSERT INTO night_summary (night, club, checked_in, checked_out, undone, prints) VALUES ('2026-10-07', 'Sparks', 25, 20, 1, 25)");
    const res = await r.call('GET', '/v1/history/summary?from=2026-10-07&to=2026-10-07');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { night: '2026-10-07', club: 'Cubbies', checkedIn: 14, checkedOut: 0, undone: 0, prints: 0, imported: true },
      { night: '2026-10-07', club: 'Journey', checkedIn: 9, checkedOut: 0, undone: 0, prints: 0, imported: true },
      { night: '2026-10-07', club: 'Puggles', checkedIn: 6, checkedOut: 0, undone: 0, prints: 0, imported: true },
      { night: '2026-10-07', club: 'Sparks', checkedIn: 25, checkedOut: 20, undone: 1, prints: 25 },
      { night: '2026-10-07', club: 'T&T', checkedIn: 31, checkedOut: 0, undone: 0, prints: 0, imported: true },
      { night: '2026-10-07', club: 'Trek', checkedIn: 12, checkedOut: 0, undone: 0, prints: 0, imported: true },
    ]);
    // The trends page's own shaping reads it unchanged: one line per club, the live Sparks.
    const all = (await r.call('GET', '/v1/history/summary')).body;
    const t = buildTrends(all, []);
    const oct7 = t.perNight.find((p) => p.night === '2026-10-07');
    expect(oct7.byClub).toMatchObject({ Sparks: 25, 'T&T': 31 });
    expect(oct7.checkedIn).toBe(25 + 14 + 9 + 6 + 31 + 12);
    expect(t.seasons).toEqual(['2024-25', '2025-26', '2026-27']);
  });

  it('with nothing imported the answer is exactly as before', async () => {
    const { r, db } = await setup({ seasons: {} });
    db.query("INSERT INTO night_summary (night, club, checked_in, checked_out, undone, prints) VALUES ('2026-10-07', 'Sparks', 2, 0, 0, 0)");
    expect((await r.call('GET', '/v1/history/summary')).body).toEqual([{ night: '2026-10-07', club: 'Sparks', checkedIn: 2, checkedOut: 0, undone: 0, prints: 0 }]);
    // ...and before migration 0003 is applied, the live lines still answer.
    db.query('DROP TABLE night_summary_import');
    expect((await r.call('GET', '/v1/history/summary')).body).toEqual([{ night: '2026-10-07', club: 'Sparks', checkedIn: 2, checkedOut: 0, undone: 0, prints: 0 }]);
  });
});

describe('GET /v1/history/import-status', () => {
  it('needs a session', async () => {
    const { r } = await setup();
    r.session = '';
    expect((await r.call('GET', '/v1/history/import-status')).status).toBe(401);
  });

  it('answers a fixed shape: codes, seasons, times; idle before the first run', async () => {
    const { r } = await setup();
    const s = await status(r);
    expect(Object.keys(s)).toEqual(['state', 'seasons', 'oldestSeason', 'lastRunAt', 'nextDueAt', 'lastError', 'unreadableWhy', 'skipped', 'ended', 'currentSeasonLastAt', 'crosscheck']);
    expect(s).toMatchObject({ state: 'idle', seasons: [], oldestSeason: null, lastRunAt: null, lastError: null, crosscheck: null });
    await alarms(r);
    const done = await status(r);
    expect(done.seasons[0]).toEqual({ season: '2026-27', nights: 5, importedAt: expect.stringMatching(/^2026-10-11T/) });
    expect(r.core.registry.list()).toContain('GET /v1/history/import-status session');
  });

  it('asking sets the alarm sooner when a season read is due (a first deploy does not wait for the cron)', async () => {
    const { r } = await setup();
    r.alarm.at = r.clock.t + 6 * 3600 * 1000;
    await status(r);
    expect(r.alarm.at - r.clock.t).toBeLessThanOrEqual(READ_INTERVAL_MS);
  });
});

describe('what is stored', () => {
  it('counts only: no child\'s name or id in D1 or in the object\'s storage', async () => {
    const kids = [kid('7351922', 'Sparks', 'Zebedee Quillfeather'), kid('7351923', 'Trek', 'Ottoline Wrexham')];
    const { r, db } = await setup({ kids, start: WED_6PM });
    // A club night's reads happen (the report names these children), then the back-fill.
    for (let i = 0; i < 6; i++) { await r.core.alarm(); r.clock.t = Math.max(r.clock.t, r.alarm.at); }
    r.clock.t = WED_905PM;
    await alarms(r);
    expect(imported(db).length).toBeGreaterThan(0);
    const words = plainWords(['Zebedee', 'Quillfeather', 'Ottoline', 'Wrexham', '7351922', '7351923']);
    expect(db.dump()).not.toMatch(words);
    expect(JSON.stringify(await r.storage.get('trends:import'))).not.toMatch(words);
    expect(everything(r.storage)).not.toMatch(plainWords(['Zebedee', 'Quillfeather', 'Ottoline', 'Wrexham']));
    expect(Object.keys(await r.storage.get('trends:import')).sort()).toEqual([
      'crosscheck', 'currentSeasonLastAt', 'ended', 'errors', 'lastError', 'lastOkAt', 'lastRunAt', 'next', 'nextDueAt',
      'refreshedFor', 'seasons', 'skipped', 'unreadable', 'unreadableWhy', 'v', 'walkDone',
    ]);
  });

  it('the migration applies on a fresh database, and again harmlessly', () => {
    const db = d1Stub();
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'night_summary_import'")).toHaveLength(1);
    const sql = readFileSync(new URL('../migrations/0003_trends_import.sql', import.meta.url), 'utf8');
    expect(() => db.query(sql.replace(/--.*$/gm, '').trim())).not.toThrow();
    expect(() => db.query("INSERT INTO night_summary_import (night, club, attended, imported_at) VALUES ('2026-10-07', 'Sparks', 2001, 'x')")).toThrow();
  });
});

describe('the self-check: the desk beside TwoTimTwo, by itself after each import', () => {
  const desk = (db, night, club, checkedIn, undone = 0, checkedOut = 0) => db.query(
    'INSERT INTO night_summary (night, club, checked_in, checked_out, undone, prints) VALUES (?, ?, ?, ?, ?, 0)', night, club, checkedIn, checkedOut, undone);

  it('crossCheckOf counts by night: a night agrees only when every club on it agrees', () => {
    const c = crossCheckOf([
      { night: '2026-10-07', club: 'Sparks', desk: 22, twotimtwo: 22 },
      { night: '2026-10-07', club: 'T&T', desk: 31, twotimtwo: 31 },
      { night: '2026-09-30', club: 'Sparks', desk: 18, twotimtwo: 20 },
      { night: '2026-09-30', club: 'T&T', desk: 29, twotimtwo: 29 },
      { night: '2026-09-23', club: 'Trek', desk: 11, twotimtwo: 10 },
    ], 1000);
    expect(c).toEqual({
      compared: 3, matching: 1, differing: 2, deskHigher: 1, at: 1000,
      examples: [{ night: '2026-09-30', club: 'Sparks', desk: 18, twotimtwo: 20 }, { night: '2026-09-23', club: 'Trek', desk: 11, twotimtwo: 10 }],
    });
  });

  it('crossCheckOf keeps a fixed shape: at most 5 examples, junk lines dropped, nothing else copied', () => {
    const lines = [];
    for (let d = 1; d <= 9; d++) lines.push({ night: `2026-09-0${d}`, club: 'Sparks', desk: d, twotimtwo: d + 1, name: 'Zebedee' });
    lines.push({ night: 'Oct 7', club: 'Sparks', desk: 1, twotimtwo: 2 }, { night: '2026-10-07', club: 'Zebedee', desk: 1, twotimtwo: 2 },
      { night: '2026-10-07', club: 'Sparks', desk: '1.5', twotimtwo: 2 }, { night: '2026-10-07', club: 'Sparks', desk: -1, twotimtwo: 2 }, null);
    const c = crossCheckOf(lines, 5);
    expect(c).toMatchObject({ compared: 9, matching: 0, differing: 9, deskHigher: 0 });
    expect(c.examples).toHaveLength(CROSSCHECK_EXAMPLES);
    expect(Object.keys(c.examples[0])).toEqual(['night', 'club', 'desk', 'twotimtwo']);
    expect(JSON.stringify(c)).not.toMatch(/Zebedee|Oct 7/);
    expect(crossCheckOf([], 5)).toEqual({ compared: 0, matching: 0, differing: 0, deskHigher: 0, examples: [], at: 5 });
  });

  it('after the import, compares every night and club the desk also counted, and shows it in import-status', async () => {
    const { r, db } = await setup();
    desk(db, '2026-10-07', 'Sparks', 22);                // agrees
    desk(db, '2026-10-07', 'Cubbies', 15, 1);            // 15 check-ins, 1 undone: 14, agrees
    desk(db, '2026-09-30', 'Sparks', 18);                // the desk counted only some: TwoTimTwo 20
    desk(db, '2026-09-30', 'Trek', 0, 0, 3);             // check-outs only: not a desk count
    desk(db, '2026-10-14', 'Sparks', 9);                 // not imported (tonight, not held yet): nothing to compare
    const batches = db.batches;
    await alarms(r);
    // The self-check wrote nothing to D1: one batch per stored season, as before it.
    expect(db.batches - batches).toBe(3);
    const s = await status(r);
    expect(s.crosscheck).toEqual({
      compared: 2, matching: 1, differing: 1, deskHigher: 0,
      examples: [{ night: '2026-09-30', club: 'Sparks', desk: 18, twotimtwo: 20 }],
      at: expect.stringMatching(/^2026-10-11T/),
    });
    // The live line still wins in the trends: the summary answers the desk's 18.
    const sum = (await r.call('GET', '/v1/history/summary?from=2026-09-30&to=2026-09-30')).body;
    expect(sum.find((l) => l.club === 'Sparks')).toMatchObject({ checkedIn: 18 });
  });

  it('with no desk nights to set beside it: nothing compared, said as such', async () => {
    const { r } = await setup();
    await alarms(r);
    expect((await status(r)).crosscheck).toMatchObject({ compared: 0, matching: 0, differing: 0, examples: [] });
  });

  it('runs again after the club-night refresh, and a failed read keeps the last result', async () => {
    const { r, db, seasons } = await setup();
    desk(db, '2026-10-07', 'Sparks', 22);
    await alarms(r);
    const first = (await status(r)).crosscheck;
    expect(first).toMatchObject({ compared: 1, matching: 1 });
    // Tonight the desk counts Sparks; TwoTimTwo has one more (a paper sheet).
    seasons[2026] = SEASON_2026.replace('"10/14/2026","","","","","","","","","","","","","0",""', '"10/14/2026","6","","15","","23","","30","","12","","9","","95",""');
    desk(db, '2026-10-14', 'Sparks', 22);
    r.clock.t = WED_905PM;
    await alarms(r);
    const second = (await status(r)).crosscheck;
    expect(second).toMatchObject({ compared: 2, matching: 1, differing: 1, examples: [{ night: '2026-10-14', club: 'Sparks', desk: 22, twotimtwo: 23 }] });
    expect(second.at > first.at).toBe(true);
    // D1 refusing the SELECT: the import still lands, the last self-check stays.
    const prepare = db.prepare.bind(db);
    db.prepare = (text) => {
      if (/JOIN night_summary_import/.test(text)) throw new Error('D1 is busy');
      return prepare(text);
    };
    seasons[2026] = seasons[2026].replace('"10/14/2026","6","","15","","23"', '"10/14/2026","6","","15","","24"').replace('"95",""', '"96",""');
    r.clock.t = Date.parse('2026-10-22T01:05:00Z');
    await alarms(r);
    expect(db.query("SELECT attended FROM night_summary_import WHERE night = '2026-10-14' AND club = 'Sparks'")).toEqual([{ attended: 24 }]);
    expect((await status(r)).crosscheck).toEqual(second);
  });
});
