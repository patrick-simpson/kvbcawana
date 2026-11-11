// @ts-check
// The health check, started ON TIME (owner 2026-11-10, after the project
// survey: the Wednesday "Check-in ready tonight?" job, checkin-health.yml, is
// meant to warn the owner BEFORE club, but GitHub's own scheduler started it
// three to four hours late, after club, on 2026-10-28 and 2026-11-04).
//
// So the Worker starts that job itself. Its alarm already ticks at least every
// 30 s from 4:30 pm on a club night (watcher.js); at each time in CALLS it
// asks GitHub to run checkin-health.yml now (the print tool's dispatch,
// prints.js, the PRINT_DISPATCH_TOKEN secret). The job then asks
// GET /v1/health/checkin as before and FAILS when something is wrong; GitHub
// emails a failed run to the person whose token started it (the owner).
//
// - Club days only (the shared rule, watcher.clubToday; never a rehearsal).
// - Each call once a night: marked in storage BEFORE GitHub is asked (a
//   restart or a second tick never starts it twice); a refusal is tried again
//   on a later tick, at most TRIES times, only within LATE_MIN of its time (a
//   late warning is no warning).
// - No token, or GitHub down: nothing happens here. The job's own schedule
//   stays as the backup (it now skips a run that starts too late).
// - If the Worker itself is dead it cannot call; that backup run still says
//   "could not reach the sync service", whenever it starts.
// - Never throws, never reads TwoTimTwo, never on the print path.
//
// STORAGE `health:called` = {date, calls: {<id>: {n, ok}}}: today's only.

import { localTime } from './watcher.js';

export const HEALTH_WORKFLOW = 'checkin-health.yml';

/** When to call (Eastern, minutes after midnight) and whether a print station must be on by then. */
export const CALLS = Object.freeze([
  Object.freeze({ id: 'early', at: 17 * 60 + 12, station: false }),
  Object.freeze({ id: 'late', at: 17 * 60 + 47, station: true }),
]);
/** A call is made only within this many minutes after its time. */
export const LATE_MIN = 15;
/** Tries per call per night. */
export const TRIES = 3;
const KEY = 'health:called';

export class HealthCall {
  /**
   * @param {{ storage: any, now: () => number, clubToday: () => Promise<any>,
   *   configured: () => boolean,
   *   dispatch: (workflow: string, inputs: Record<string, string>) => Promise<{ok: boolean, status: number}> }} deps
   */
  constructor({ storage, now, clubToday, configured, dispatch }) {
    this.storage = storage;
    this.now = now;
    this.clubToday = clubToday;
    this.configured = configured;
    this.dispatch = dispatch;
    /** @type {any} */
    this.state = null;
  }

  /** The call due at this local minute, if any. Pure. @param {number} minutes */
  static due(minutes) {
    return CALLS.filter((c) => minutes >= c.at && minutes < c.at + LATE_MIN);
  }

  /** From the alarm. Never throws. @returns {Promise<string[]>} the calls started now */
  async tick() {
    /** @type {string[]} */
    const started = [];
    try {
      const t = localTime(this.now());
      const due = HealthCall.due(t.minutes);
      if (!due.length || !this.configured()) return started;
      if (!this.state || this.state.date !== t.date) {
        const stored = await this.storage.get(KEY);
        this.state = stored && stored.date === t.date ? stored : { date: t.date, calls: {} };
      }
      for (const call of due) {
        const seen = this.state.calls[call.id] || { n: 0, ok: false };
        if (seen.ok || seen.n >= TRIES) continue;
        const day = await this.clubToday();
        if (!day || !day.club || day.rehearsal) return started;
        // Marked before GitHub is asked: one synchronous step, written through.
        this.state.calls[call.id] = { n: seen.n + 1, ok: true };
        await this.storage.put(KEY, this.state);
        const r = await this.dispatch(HEALTH_WORKFLOW, { station: call.station ? 'true' : 'false' });
        if (r && r.ok) { started.push(call.id); continue; }
        console.error(`[health] GitHub did not start the ${call.id} check (status ${r ? r.status : 0}); try ${seen.n + 1} of ${TRIES}`);
        this.state.calls[call.id] = { n: seen.n + 1, ok: false };
        await this.storage.put(KEY, this.state);
      }
    } catch (err) { console.error('[health] starting the check failed', err); }
    return started;
  }
}
