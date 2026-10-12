// @ts-check
// Tonight's overview (routes.md 10.6): mission control's ONE poll, every 10 s
// while the settings page's Tonight is open. Counts, codes, times and station
// names only: never a child's name or id (the live channel, opened in the
// browser, is where first names come from). No TwoTimTwo read and no seal:
// storage reads and memory, each part on its own (a part that fails is null,
// never the whole answer).

import { json } from './http.js';
import { CLUB_NIGHTS, GRACE_MIN, localTime, watchWindow } from './watcher.js';

/** @param {string} hm */
const minutesOf = (hm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

/** The club night's window, now. @param {number} now */
export function windowNow(now) {
  const t = localTime(now);
  const w = watchWindow(now);
  const tonight = CLUB_NIGHTS.find((n) => n.dow === t.dow) || null;
  const close = tonight ? Math.min(minutesOf(tonight.end) + GRACE_MIN, 24 * 60) : null;
  return {
    night: t.date,
    clubNight: !!tonight,
    window: {
      open: w.open,
      opensInMin: w.open ? 0 : Math.round(w.untilMs / 60000),
      closesInMin: w.open && close !== null ? Math.max(0, close - t.minutes) : null,
    },
  };
}

/** @template T @param {() => Promise<T>} fn @returns {Promise<T|null>} */
async function part(fn) {
  try {
    return await fn();
  } catch (err) {
    console.error('[overview] a part failed', err);
    return null;
  }
}

/** @param {any} core the SyncCore */
export async function overview(core) {
  const now = core.now();
  const when = windowNow(now);
  const [count, read, print, ym, notice, church, history, changes] = await Promise.all([
    part(async () => {
      const s = await core.publisher.status();
      return { source: s.source, checkedIn: s.checkedIn, checkedOut: s.checkedOut, byClub: s.byClub, reportAgeMs: s.reportAgeMs, enabled: s.enabled };
    }),
    part(async () => {
      const s = await core.watcher.status();
      return {
        mode: s.mode, configured: s.configured, signedIn: s.signedIn, lastReadAt: s.lastReadAt, lastOkAt: s.lastOkAt,
        lastError: s.lastError, loginBlockedForSec: s.loginBlockedForSec, watchIntervalSec: s.watchIntervalSec,
      };
    }),
    part(async () => {
      await Promise.all([core.printq.load(), core.ledger.load(), core.stations.load(), core.adopt.load()]);
      const q = await core.printq.status();
      return {
        queued: q.queued, leased: q.leased, dead: q.dead, checkThePrinter: q.checkThePrinter.length,
        claims: await core.ledger.counts(when.night), pendingToSeal: core.adopt.pending(),
        stations: (await core.stations.list()).map((/** @type {any} */ s) => ({
          stationId: s.stationId, name: s.name, lastSeenAt: s.lastSeenAt, printer: s.printer, version: s.version ?? null, churchRev: s.churchRev ?? null,
        })),
      };
    }),
    part(async () => {
      const y = await core.ym.statusView();
      return { enabled: y.enabled, due: y.due, checkedOut: y.checkedOut, failed: y.failed, gaveUp: y.gaveUp, pending: y.pending, lastError: y.lastError };
    }),
    part(async () => {
      const n = await core.notices.view();
      return n ? { level: n.level, message: n.message, at: n.at, until: n.until, by: n.by } : null;
    }),
    part(() => core.church.summary(core.switches.value('CHURCH_SETTINGS') === 'off')),
    part(() => core.history.status()),
    part(async () => ({ head: await core.changes.head(), last: await core.changes.last() })),
  ]);
  return {
    at: new Date(now).toISOString(),
    ...when,
    count, read, print, ym,
    switches: core.switches.list(),
    notice, church, history, changes,
  };
}

/** @param {import('./registry.js').Registry} registry @param {any} core the SyncCore */
export function mountOverview(registry, core) {
  registry.add('GET', '/v1/tonight/overview', 'session', async () => json(await overview(core)));
}
