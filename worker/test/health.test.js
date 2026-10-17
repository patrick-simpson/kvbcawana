// Is check-in ready for tonight? (health.js, routes.md 10.10): the public answer
// the scheduled GitHub Action reads at 5:15 and 5:50 pm on Wednesdays. Booleans,
// counts, times and fixed codes only; no TwoTimTwo read of its own.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { problemsOf } from '../src/health.js';
import { kid, rig } from './rig.js';

const WED_4PM = Date.parse('2026-10-14T20:00:00Z');    // 4:00 pm EDT, before the window (4:30)
const WED_515 = Date.parse('2026-10-14T21:15:00Z');    // 5:15 pm EDT, the first check
const SUNDAY = Date.parse('2026-10-11T21:15:00Z');
const KIDS = [kid('7351922', 'Sparks', 'Zebedee Quillfeather'), kid('7351923', 'Trek', 'Ottoline Wrexham')];
const KEYS = ['v', 'at', 'ok', 'problems', 'night', 'clubTonight', 'nextClubNight', 'window', 'cloudCheckin', 'configured', 'cloudPrint', 'twotimtwo', 'checkinPage', 'stations'];

/** Run the Durable Object's alarm, as Cloudflare would, until `until`; the station heartbeats every minute while `beat`. */
async function runUntil(r, until, { st = null, beat = () => true } = {}) {
  let lastBeat = -Infinity;
  for (let i = 0; i < 5000 && r.clock.t < until; i++) {
    if (st && beat(r.clock.t) && r.clock.t - lastBeat >= 60000) {
      await st.call('POST', '/v1/print/heartbeat', { printer: { state: 'ok' }, version: '10.0.0' });
      lastBeat = r.clock.t;
    }
    if (r.alarm.at === null || r.alarm.at <= r.clock.t) await r.core.alarm();
    r.clock.t = Math.min(until, r.clock.t + 60000, Math.max(r.clock.t + 1, r.alarm.at ?? until));
  }
  r.clock.t = until;
}

/** The route as the Action calls it: no Authorization header at all. */
async function ask(r) {
  const res = await r.core.handle(new Request('https://sync.test/v1/health/checkin'));
  return { status: res.status, body: await res.json() };
}

describe('GET /v1/health/checkin', () => {
  it('5:15 on a club night after the watcher ran from 4:30: everything ready, no passphrase needed', async () => {
    const r = await rig({ start: WED_4PM, kids: KIDS });
    const st = await r.station();
    await runUntil(r, WED_515, { st });
    // The watcher read the report on its own from the window's opening (4:30 pm), nobody asking.
    const reports = r.reads.filter((x) => x.path === '/clubber/checkin_report').map((x) => x.at);
    expect(Math.min(...reports)).toBeGreaterThanOrEqual(WED_4PM + 30 * 60000);
    expect(Math.min(...reports)).toBeLessThanOrEqual(WED_4PM + 31 * 60000);   // after the sign-in's own slots
    expect(reports.length).toBeGreaterThan(60);   // about every 30 s for 45 minutes
    const readsBefore = r.slots.length;
    const res = await ask(r);
    expect(res.status).toBe(200);
    const h = res.body;
    expect(Object.keys(h)).toEqual(KEYS);
    expect(h).toMatchObject({
      v: 1, at: new Date(WED_515).toISOString(), ok: true, problems: [], night: '2026-10-14', clubTonight: true, nextClubNight: '2026-10-14',
      window: { open: true, opensInMin: 0, openForMin: 45 }, cloudCheckin: 'shadow', configured: true, cloudPrint: 'on',
      twotimtwo: { signedIn: true, loginBackoff: false, down: false, lastOkTonight: true, lastError: null },
      checkinPage: { ok: true },
      stations: { registered: 1, seenNow: 1, seenThisWeek: 1 },
    });
    expect(h.twotimtwo.lastOkAgeSec).toBeLessThanOrEqual(35);
    expect(Object.keys(h.twotimtwo)).toEqual(['signedIn', 'loginBackoff', 'down', 'lastReadAt', 'lastOkAt', 'lastOkTonight', 'lastOkAgeSec', 'lastError']);
    // Asking reads nothing from TwoTimTwo (the one read clock is not touched).
    expect(r.slots.length).toBe(readsBefore);
    // Nothing that names a child, a station or the TwoTimTwo account.
    const text = JSON.stringify(h);
    for (const word of ['Zebedee', 'Quillfeather', 'Ottoline', '7351922', 'Desk laptop', 'station-aaaaaaaa', 'checkin@example.org', 'right-pass', 'Kit Tester']) {
      expect(text).not.toContain(word);
    }
  });

  it('a sign-in TwoTimTwo refuses: signin-refused and no-good-read by 5:15', async () => {
    const r = await rig({ start: WED_4PM, kids: KIDS, env: { TWOTIMTWO_PASSWORD: 'wrong-pass' } });
    const st = await r.station();
    await runUntil(r, WED_515, { st });
    const h = (await ask(r)).body;
    expect(h.ok).toBe(false);
    expect(h.problems).toEqual(expect.arrayContaining(['signin-refused', 'no-good-read']));
    expect(h.problems).not.toContain('no-station-now');
    expect(h.twotimtwo.lastOkAt).toBeNull();
    expect(h.twotimtwo.lastError).toBe('login-refused');
  });

  it('the check-in laptop not on: no-station-now; never registered: no-station-registered', async () => {
    const r = await rig({ start: WED_4PM, kids: KIDS });
    const st = await r.station();
    // Heard from at 4 pm, then switched off.
    await runUntil(r, WED_515, { st, beat: (t) => t < WED_4PM + 60000 });
    expect((await ask(r)).body.problems).toEqual(['no-station-now']);
    expect((await ask(r)).body.stations).toEqual({ registered: 1, seenNow: 0, seenThisWeek: 1 });

    const bare = await rig({ start: WED_4PM, kids: KIDS });
    await runUntil(bare, WED_515);
    expect((await ask(bare)).body.problems).toEqual(['no-station-registered']);
  });

  it('cloud check-in switched off on a club night says so', async () => {
    const r = await rig({ start: WED_515, env: { CLOUD_CHECKIN: 'off' } });
    await r.station();
    const h = (await ask(r)).body;
    expect(h.cloudCheckin).toBe('off');
    expect(h.problems).toContain('cloud-checkin-off');
  });

  it('before the window opens nothing is due yet; the route arms the watcher', async () => {
    const r = await rig({ start: WED_4PM });
    const st = await r.station();
    await st.call('POST', '/v1/print/heartbeat', { printer: { state: 'ok' } });
    r.alarm.at = null;
    const h = (await ask(r)).body;
    expect(h).toMatchObject({ ok: true, problems: [], clubTonight: true, window: { open: false, opensInMin: 30, openForMin: null } });
    expect(r.alarm.at).not.toBeNull();
  });

  it('not a club night: ok, quietly, whatever else is true', async () => {
    const r = await rig({ start: SUNDAY, env: { TWOTIMTWO_PASSWORD: 'wrong-pass' } });
    const h = (await ask(r)).body;
    expect(h).toMatchObject({ ok: true, problems: [], clubTonight: false, nextClubNight: '2026-10-14', stations: { registered: 0 } });
  });

  it('problemsOf: each fixed code, and none on a night with no club', () => {
    const base = {
      clubTonight: true, localMinutes: 1035, cloudCheckin: 'shadow', configured: true, cloudPrint: 'on',
      window: { open: true, openForMin: 45 },
      twotimtwo: { loginBackoff: false, down: false, lastOkTonight: true, lastOkAgeSec: 20, lastError: null },
      checkinPage: { ok: true }, stations: { registered: 1, seenNow: 1 },
    };
    expect(problemsOf(base)).toEqual([]);
    expect(problemsOf({ ...base, twotimtwo: { ...base.twotimtwo, lastOkAgeSec: 600 } })).toEqual(['no-good-read']);
    expect(problemsOf({ ...base, cloudPrint: 'off' })).toEqual(['cloud-print-off']);
    // A club day (an extra night on the calendar) the watcher does not watch.
    expect(problemsOf({ ...base, window: { open: false, openForMin: null } })).toEqual(['not-watching']);
    expect(problemsOf({ ...base, checkinPage: { ok: false } })).toEqual(['checkin-page-unreadable']);
    expect(problemsOf({ ...base, clubTonight: false, cloudPrint: 'off' })).toEqual([]);
  });

  it('free plan: no key work and no TwoTimTwo client in the module', () => {
    const src = readFileSync(new URL('../src/health.js', import.meta.url), 'utf8');
    expect(src).not.toMatch(/crypto\.subtle|subtle\.|from '\.\/crypto\.js'|cloud-crypto|sealState|openState|\.report\(|\.checkinPage\(|\.budget\b/);
  });
});
