// The Wednesday health check started on time by the Worker (healthcall.js):
// GitHub's own scheduler started checkin-health.yml hours late, after club.
import { describe, expect, it } from 'vitest';
import { CALLS, HEALTH_WORKFLOW, HealthCall, LATE_MIN, TRIES } from '../src/healthcall.js';
import { DISPATCH_WORKFLOWS } from '../src/prints.js';
import { kid, rig } from './rig.js';

const at = (hm) => Date.parse(`2026-11-11T${hm}:00-05:00`);   // a Wednesday, Eastern winter time

function make({ club = true, rehearsal = false, token = true, answers = [] } = {}) {
  const clock = { t: at('16:00') };
  const store = new Map();
  const asked = [];
  const call = new HealthCall({
    storage: { get: async (k) => store.get(k), put: async (k, v) => { store.set(k, structuredClone(v)); } },
    now: () => clock.t,
    clubToday: async () => ({ club, rehearsal }),
    configured: () => token,
    dispatch: async (workflow, inputs) => {
      asked.push({ at: clock.t, workflow, inputs, marked: structuredClone(store.get('health:called')) });
      return answers.length ? answers.shift() : { ok: true, status: 204 };
    },
  });
  /** Tick every 30 s until `until`. */
  const run = async (until) => { for (; clock.t <= until; clock.t += 30000) await call.tick(); };
  return { call, clock, store, asked, run };
}

describe('the health check is started on time', () => {
  it('the workflow is one the Worker may start', () => {
    expect(DISPATCH_WORKFLOWS).toContain(HEALTH_WORKFLOW);
  });

  it('5:12, 5:47 and 6:15 pm on a club night: each once, the later ones asking for a print station', async () => {
    const h = make();
    await h.run(at('21:00'));
    expect(h.asked.map((a) => [a.at, a.workflow, a.inputs])).toEqual([
      [at('17:12'), 'checkin-health.yml', { station: 'false' }],
      [at('17:47'), 'checkin-health.yml', { station: 'true' }],
      [at('18:15'), 'checkin-health.yml', { station: 'true' }],   // during check-in
    ]);
    expect(CALLS.map((c) => c.id)).toEqual(['early', 'late', 'doors']);
  });

  it('is marked in storage before GitHub is asked, so a restarted Worker never starts it twice', async () => {
    const h = make();
    await h.run(at('17:13'));
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0].marked.calls.early.ok).toBe(true);   // already written when the dispatch ran
    // A new object (a restart) with the same storage, a minute later:
    const again = new HealthCall({
      storage: { get: async (k) => h.store.get(k), put: async (k, v) => { h.store.set(k, v); } },
      now: () => at('17:14'), clubToday: async () => ({ club: true }), configured: () => true,
      dispatch: async () => { throw new Error('asked twice'); },
    });
    expect(await again.tick()).toEqual([]);
  });

  it('GitHub refusing is tried again on later ticks, a few times, then left alone', async () => {
    const h = make({ answers: [{ ok: false, status: 502 }, { ok: false, status: 0 }] });
    await h.run(at('17:20'));
    expect(h.asked.map((a) => a.at)).toEqual([at('17:12'), at('17:12') + 30000, at('17:12') + 60000]);
    const never = make({ answers: Array.from({ length: 20 }, () => ({ ok: false, status: 401 })) });
    await never.run(at('17:40'));
    expect(never.asked).toHaveLength(TRIES);
  });

  it('never late: a Worker that only wakes after the window does not call', async () => {
    const h = make();
    h.clock.t = at('17:12') + LATE_MIN * 60000;
    await h.run(at('17:40'));
    expect(h.asked).toEqual([]);
  });

  it('nothing on a day with no club, in a rehearsal, or with no token', async () => {
    for (const opts of [{ club: false }, { rehearsal: true }, { token: false }]) {
      const h = make(opts);
      await h.run(at('21:00'));
      expect(h.asked).toEqual([]);
    }
  });

  it('a new night starts again', async () => {
    const h = make();
    await h.run(at('21:00'));
    h.clock.t += 7 * 24 * 3600 * 1000 - 5 * 3600 * 1000;   // the next Wednesday, 4 pm
    await h.run(h.clock.t + 3 * 3600 * 1000);
    expect(h.asked).toHaveLength(6);
  });

  it('a throwing dependency never breaks the alarm', async () => {
    const h = make();
    h.call.clubToday = async () => { throw new Error('boom'); };
    h.clock.t = at('17:12');
    expect(await h.call.tick()).toEqual([]);
  });

  it('the Worker alarm runs it', async () => {
    const r = await rig({ start: at('17:11'), kids: [kid('7351922', 'Sparks', 'Zebedee Quillfeather')] });
    let ticks = 0;
    r.core.healthCall.tick = async () => { ticks += 1; return []; };
    await r.core.alarm();
    expect(ticks).toBe(1);
  });
});
