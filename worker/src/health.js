// @ts-check
// Is check-in ready for tonight? (routes.md 10.10; owner 2026-10-17: "warn the
// owner BEFORE club night if check-in is broken, for free, without the owner
// opening a page".) A scheduled GitHub Actions run
// (.github/workflows/checkin-health.yml) asks this at about 5:15 pm and 5:50 pm
// Eastern on Wednesdays and FAILS when something is wrong, and a failed
// scheduled run is an email to the repository's owner: the alert costs nothing.
//
// PUBLIC (no passphrase: the Action holds no secret), so the answer is only
// booleans, counts, times and the fixed codes below: never a name, an id, a
// station's name, TwoTimTwo's own words or anything from a secret. Stored state
// and memory only: NO TwoTimTwo read (the read clock, readbudget.js, is not
// touched) and no seal, a few storage gets (free plan: 10 ms CPU).

import { json } from './http.js';
import { CLUB_NIGHTS, LEAD_MIN, localTime, watchWindow } from './watcher.js';

/** A print station counts as "on now" when it was heard from this recently (it polls every 5 s, writes lastSeenAt at most once a minute). */
export const STATION_NOW_MS = 10 * 60 * 1000;
/** ...and as "in use" when heard from this week (stationfeeds.js STALE_STATION_MS is the same week). */
export const STATION_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** The report is read every 30 s in the window: a last good read older than this is a problem. */
export const STALE_READ_MS = 5 * 60 * 1000;
/** How long after the window opens the first sign-in and reads may take before their absence is a problem. */
export const READ_GRACE_MS = 10 * 60 * 1000;
/** A club day's evening (local minutes): the watcher should be watching by now. */
const EVENING = { from: 17 * 60, until: 20 * 60 };

/** The codes a read may fail with (twotimtwo.js), passed through; anything else is 'other'. */
const READ_ERRORS = new Set([
  'login-refused', 'login-backoff', 'twotimtwo-down', 'signed-out', 'report-unreadable',
  'checkin-page-unreadable', 'no-meeting', 'not-configured',
]);

/** @param {unknown} code */
const readError = (code) => (code == null ? null : READ_ERRORS.has(String(code)) ? String(code) : 'other');

/** @param {string} hm */
const minutesOf = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** @param {string|null|undefined} iso @param {number} now */
const ageMs = (iso, now) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
};

/**
 * Minutes the watch window has been open tonight (null while it is closed).
 * @param {number} now
 */
export function openForMin(now) {
  if (!watchWindow(now).open) return null;
  const t = localTime(now);
  const night = CLUB_NIGHTS.find((n) => n.dow === t.dow);
  if (!night) return null;
  return Math.max(0, t.minutes - Math.max(minutesOf(night.start) - LEAD_MIN, 0));
}

/**
 * What is wrong for tonight, as fixed codes. Pure.
 * @param {any} f what facts() answers
 * @returns {string[]}
 */
export function problemsOf(f) {
  if (!f.clubTonight) return [];
  /** @type {string[]} */
  const out = [];
  if (f.cloudCheckin === 'off') out.push('cloud-checkin-off');
  if (!f.configured) out.push('not-configured');
  if (f.cloudPrint === 'off') out.push('cloud-print-off');
  if (!f.window.open && f.localMinutes >= EVENING.from && f.localMinutes < EVENING.until) out.push('not-watching');
  const t = f.twotimtwo;
  if (t.loginBackoff || t.lastError === 'login-refused' || t.lastError === 'login-backoff') out.push('signin-refused');
  if (t.down || t.lastError === 'twotimtwo-down') out.push('twotimtwo-down');
  const settled = f.window.open && f.window.openForMin !== null && f.window.openForMin * 60000 >= READ_GRACE_MS;
  if (settled && (t.lastOkAgeSec === null || !t.lastOkTonight || t.lastOkAgeSec * 1000 > STALE_READ_MS)) out.push('no-good-read');
  if (f.checkinPage.ok === false) out.push('checkin-page-unreadable');
  else if (settled && f.checkinPage.ok === null) out.push('checkin-page-not-read');
  if (f.stations.registered === 0) out.push('no-station-registered');
  else if (f.stations.seenNow === 0) out.push('no-station-now');
  return out;
}

/** @param {any} core the SyncCore */
export async function facts(core) {
  const now = core.now();
  const t = localTime(now);
  const w = watchWindow(now);
  const watcher = core.watcher;
  // The shared club-day rule (clubday.js via watcher.clubToday): the whole local
  // day, cancellations and extra nights from the calendar. A rehearsal is not a club night here.
  const day = await watcher.clubToday();
  const status = await watcher.loadStatus();
  const tonight = status.date === t.date;
  const client = watcher.client;
  const okAge = ageMs(status.lastOkAt, now);
  await core.stations.load();
  const stations = core.stations.all();
  const seenWithin = (/** @type {number} */ ms) => stations.filter((/** @type {any} */ s) => {
    const a = ageMs(s.lastSeenAt, now);
    return a !== null && a <= ms;
  }).length;
  const page = tonight && status.checkinPage ? status.checkinPage : null;
  return {
    night: t.date,
    localMinutes: t.minutes,
    clubTonight: !!day.club && !day.rehearsal,
    nextClubNight: day.club && !day.rehearsal ? day.today : day.next,
    window: { open: w.open, opensInMin: w.open ? 0 : Math.round(w.untilMs / 60000), openForMin: openForMin(now) },
    cloudCheckin: watcher.mode,
    configured: !!watcher.creds(),
    cloudPrint: core.switches.value('CLOUD_PRINT') === 'off' ? 'off' : 'on',
    twotimtwo: {
      // In memory: a restarted object reads false until its next read signs in again.
      signedIn: !!(client && client.cookies && client.cookies.size),
      loginBackoff: !!(client && client.loginBlockedUntil > now),
      down: !!(client && client.downUntil > now),
      lastReadAt: status.lastReadAt || null,
      lastOkAt: status.lastOkAt || null,
      lastOkTonight: okAge !== null && localTime(Date.parse(status.lastOkAt)).date === t.date,
      lastOkAgeSec: okAge === null ? null : Math.round(okAge / 1000),
      lastError: tonight ? readError(status.lastError) : null,
    },
    checkinPage: { ok: page ? !!page.ok : null, at: page ? page.at || null : null },
    stations: { registered: stations.length, seenNow: seenWithin(STATION_NOW_MS), seenThisWeek: seenWithin(STATION_WEEK_MS) },
  };
}

/** The answer. @param {any} core */
export async function checkinHealth(core) {
  // The safety net the cron and GET /v1/cloud/status use too: the watcher's alarm is set.
  try { await core.watcher.arm(); } catch (err) { console.error('[health] arming the watcher failed', err); }
  const f = await facts(core);
  const problems = problemsOf(f);
  const { localMinutes: _m, ...shown } = f;
  return { v: 1, at: new Date(core.now()).toISOString(), ok: problems.length === 0, problems, ...shown };
}

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountHealth(registry, core) {
  registry.add('GET', '/v1/health/checkin', 'public', async () => json(await checkinHealth(core)));
}
