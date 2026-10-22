'use strict';
// This computer's row on /settings (src/device-sync.js), against a stand-in
// of the sync Worker's screen registry (worker/src/screens.js: hello,
// GET and PUT settings, PUT name, 401 when signed out) and stand-in timers.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ds = require('../src/device-sync');
const rolesStore = require('../src/roles');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kvbc-device-'));
const URL_ = 'https://awana.kvbchurch.org/api';
const SESSION = 'v1.1760000000.1.abcdefghijklmnopqrstuvwxyz012345';

/** The Worker's screen routes, enough of them. */
function fakeWorker() {
  const w = { screens: {}, settings: {}, calls: [], token: SESSION, t: Date.parse('2026-10-11T18:00:00Z') };
  const stamp = () => new Date((w.t += 1000)).toISOString();
  w.request = async (base, p, { method = 'GET', body, session } = {}) => {
    w.calls.push({ method, path: p, body: body === undefined ? undefined : structuredClone(body) });
    if (base !== URL_) return { ok: false, status: 0, body: null };
    if (session !== w.token) return { ok: false, status: 401, body: { error: 'This screen is signed out.' } };
    const m = /^\/v1\/screens\/([^/]+)(?:\/(settings|name|log))?$/.exec(p);
    if (p === '/v1/screens/hello' && method === 'POST') {
      let r = w.screens[body.id];
      if (!r) r = w.screens[body.id] = { id: body.id, kind: body.kind, name: body.name };
      r.pendingRoleChange = body.pendingRoleChange || null;
      if (body.status) r.status = body.status;
      return { ok: true, status: 200, body: { screen: { ...r }, settings: w.settings[body.id] || null } };
    }
    if (m && m[2] === 'settings' && method === 'GET') return { ok: true, status: 200, body: { screen: w.screens[m[1]], settings: w.settings[m[1]] || null } };
    if (m && m[2] === 'settings' && method === 'PUT') {
      w.settings[m[1]] = { savedAt: stamp(), settings: ds.cleanSettings(body.settings) };
      return { ok: true, status: 200, body: { ...w.settings[m[1]], dropped: [] } };
    }
    if (m && m[2] === 'log' && method === 'PUT') {
      if (w.noLogRoute) return { ok: false, status: 404, body: { error: 'Not found.' } };
      w.logs = [...(w.logs || []), body.lines];
      return { ok: true, status: 200, body: { at: stamp(), lines: body.lines.length } };
    }
    if (m && m[2] === 'name' && method === 'PUT') {
      w.screens[m[1]].name = body.name;
      return { ok: true, status: 200, body: { screen: { ...w.screens[m[1]] } } };
    }
    return { ok: false, status: 404, body: { error: 'Not found.' } };
  };
  /** A change made on /settings. */
  w.edit = (id, settings) => { w.settings[id] = { savedAt: stamp(), settings: ds.cleanSettings(settings) }; };
  return w;
}

/** Timers that run only when told. */
function fakeTimers() {
  const pending = new Map();
  let n = 0;
  return {
    setTimeout: (fn, ms) => { n += 1; pending.set(n, { fn, ms }); return n; },
    clearTimeout: (id) => { pending.delete(id); },
    /** Runs every timer of this length that is due. */
    run(ms) {
      const due = [...pending.entries()].filter(([, t]) => t.ms === ms);
      for (const [id, t] of due) { pending.delete(id); t.fn(); }
      return due.length;
    },
    has: (ms) => [...pending.values()].some((t) => t.ms === ms),
  };
}

/** A computer: roles, hours, a print server that can be busy, main.js's apply. */
async function computer({ worker = fakeWorker(), print = true, display = false, name = 'Check-in laptop', signedIn = true, report, logTail } = {}) {
  const dir = tmp();
  const pc = {
    dir, worker, timers: fakeTimers(), busy: false, applied: [], statuses: [], signedOutWith: [],
    roles: rolesStore.normalizeRoles({ print, display, name, setupDone: true }),
    hours: { start: '17:00', end: '20:00' },
    session: signedIn ? { url: URL_, session: SESSION } : null,
    syncedAtApply: [],
  };
  pc.local = () => ({ printRole: pc.roles.print, displayRole: pc.roles.display, displayFrom: pc.hours.start, displayUntil: pc.hours.end });
  pc.sync = await ds.createDeviceSync({
    userData: dir,
    deviceId: () => { pc.roles = rolesStore.ensureDeviceId(dir, pc.roles); return pc.roles.deviceId; },
    session: () => pc.session,
    protocol: require('../../print-server/sync-protocol.js'),
    request: worker.request,
    name: () => pc.roles.name || 'DESKTOP-1',
    setName: (n) => { pc.roles = { ...pc.roles, name: n }; },
    local: pc.local,
    apply: async (s) => {
      // What main.js's applyDeviceSettings does, in short.
      pc.syncedAtApply.push(JSON.parse(fs.readFileSync(path.join(dir, ds.FILE), 'utf8')).synced);
      pc.applied.push(s);
      if (pc.busyOnApply) pc.busy = true;
      const check = rolesStore.checkRolesChange(pc.roles, { print: s.printRole, display: s.displayRole }, { printing: pc.busy });
      pc.hours = { start: s.displayFrom, end: s.displayUntil };
      if (!check.ok) return check;
      pc.roles = check.roles;
      return { ok: true };
    },
    busy: () => pc.busy,
    onStatus: (st) => pc.statuses.push(st),
    onSignedOut: (s) => pc.signedOutWith.push(s.session),
    timers: pc.timers,
    report,
    logTail,
    now: () => pc.clock,
  });
  pc.clock = Date.parse('2026-10-12T15:00:00Z');
  pc.id = () => pc.roles.deviceId;
  return pc;
}

const paths = (w) => w.calls.map((c) => `${c.method} ${c.path.replace(/\/v1\/screens\/[A-Za-z0-9_-]{16,}/, '/v1/screens/<id>')}`);

describe('the allowlist', () => {
  it('is SCREEN_SPECS.computer, key for key (lobby/src/lib/syncSpecs.js)', async () => {
    const { SCREEN_SPECS } = await import('../../../lobby/src/lib/syncSpecs.js');
    assert.deepEqual(Object.keys(ds.SPEC), Object.keys(SCREEN_SPECS.computer));
    for (const [k, rule] of Object.entries(SCREEN_SPECS.computer)) assert.equal(ds.SPEC[k], rule.type, k);
    assert.deepEqual(ds.cleanSettings({ printRole: 'yes', displayRole: false, displayFrom: '17:00', displayUntil: '25:00', audioMuted: true }),
      { displayRole: false, displayFrom: '17:00' });
  });
});

describe('reconcileComputer', () => {
  const local = { printRole: true, displayRole: false, displayFrom: '17:00', displayUntil: '20:00' };
  const rec = (savedAt, settings) => ({ savedAt, settings });
  it('nothing on the Worker: this computer goes up', () => {
    assert.deepEqual(ds.reconcileComputer({ remote: null, synced: null, local }), { do: 'push', settings: local });
  });
  it('the Worker moved on: applied, a key it lacks keeps this computer\'s value', () => {
    const r = ds.reconcileComputer({ remote: rec('2026-10-11T18:00:02.000Z', { displayRole: true }), synced: rec('2026-10-11T18:00:01.000Z', local), local });
    assert.equal(r.do, 'apply');
    assert.deepEqual(r.settings, { ...local, displayRole: true });
  });
  it('the Worker did not move, this computer did: it goes up', () => {
    const synced = rec('2026-10-11T18:00:01.000Z', local);
    const r = ds.reconcileComputer({ remote: synced, synced, local: { ...local, displayFrom: '16:30' } });
    assert.deepEqual(r, { do: 'push', settings: { ...local, displayFrom: '16:30' } });
    assert.equal(ds.reconcileComputer({ remote: synced, synced, local }).do, 'none');
  });
});

describe('the rounds', () => {
  it('first start: hello as a computer under an id kept in roles.json, then its settings go up', async () => {
    const pc = await computer();
    await pc.sync.start();
    assert.ok(rolesStore.isDeviceId(pc.id()));
    assert.equal(rolesStore.readRoles(pc.dir).deviceId, pc.id());
    assert.deepEqual(paths(pc.worker), ['POST /v1/screens/hello', 'GET /v1/screens/<id>/settings', 'PUT /v1/screens/<id>/settings']);
    assert.deepEqual(pc.worker.calls[0].body, { id: pc.id(), kind: 'computer', name: 'Check-in laptop' });
    assert.deepEqual(pc.worker.settings[pc.id()].settings, pc.local());
    assert.equal(pc.sync.status().state, 'ok');
    // Every two minutes after: hello and a read, nothing to send.
    pc.worker.calls.length = 0;
    pc.timers.run(ds.HELLO_MS);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(paths(pc.worker), ['POST /v1/screens/hello', 'GET /v1/screens/<id>/settings']);
    assert.ok(pc.timers.has(ds.HELLO_MS));
  });

  it('a change on /settings is applied, saved as agreed BEFORE it is applied (print off restarts the app)', async () => {
    const pc = await computer({ print: true, display: false });
    await pc.sync.start();
    pc.worker.edit(pc.id(), { printRole: true, displayRole: true, displayFrom: '16:30', displayUntil: '20:30' });
    await pc.sync.start();
    assert.deepEqual(pc.applied, [{ printRole: true, displayRole: true, displayFrom: '16:30', displayUntil: '20:30' }]);
    assert.deepEqual(pc.roles, { ...pc.roles, print: true, display: true });
    assert.deepEqual(pc.syncedAtApply[0], pc.worker.settings[pc.id()]);
    // Agreed now: the next round sends nothing back.
    pc.worker.calls.length = 0;
    await pc.sync.start();
    assert.deepEqual(paths(pc.worker), ['POST /v1/screens/hello', 'GET /v1/screens/<id>/settings']);
  });

  it('a change made here (the wizard, the Settings window) goes up after a nudge', async () => {
    const pc = await computer();
    await pc.sync.start();
    pc.worker.calls.length = 0;
    pc.sync.nudge();
    assert.equal(pc.timers.has(ds.PUSH_DEBOUNCE_MS), false, 'nothing changed: no round');
    pc.hours = { start: '18:00', end: '21:00' };
    pc.sync.nudge();
    pc.timers.run(ds.PUSH_DEBOUNCE_MS);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    assert.ok(paths(pc.worker).includes('PUT /v1/screens/<id>/settings'));
    assert.equal(pc.worker.settings[pc.id()].settings.displayFrom, '18:00');
    assert.deepEqual(pc.applied, []);
  });

  it('never turns the print server off mid-print: the rest applies, print-off waits for idle and says so in its hello', async () => {
    const pc = await computer({ print: true, display: false });
    await pc.sync.start();
    pc.busy = true;
    pc.worker.edit(pc.id(), { printRole: false, displayRole: true, displayFrom: '17:00', displayUntil: '20:00' });
    await pc.sync.start();
    assert.deepEqual(pc.applied, [{ printRole: true, displayRole: true, displayFrom: '17:00', displayUntil: '20:00' }], 'the display now, print kept');
    assert.equal(pc.roles.print, true);
    assert.deepEqual(pc.sync.status().pending, { printRole: false, displayRole: true, displayFrom: '17:00', displayUntil: '20:00' });
    assert.deepEqual(pc.worker.screens[pc.id()].pendingRoleChange, pc.sync.status().pending, 'a hello at once carries it');
    // Still printing: still held.
    pc.timers.run(ds.IDLE_CHECK_MS);
    assert.equal(pc.roles.print, true);
    assert.ok(pc.timers.has(ds.IDLE_CHECK_MS));
    // The last label is out: applied, and the hold is cleared on the Worker too.
    pc.busy = false;
    pc.timers.run(ds.IDLE_CHECK_MS);
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(pc.roles.print, false);
    assert.equal(pc.sync.status().pending, null);
    assert.equal(pc.worker.screens[pc.id()].pendingRoleChange, null);
  });

  it('a label that starts between the look and the change: held, never reverted on the Worker', async () => {
    const pc = await computer({ print: true, display: true });
    await pc.sync.start();
    pc.busyOnApply = true;
    pc.worker.edit(pc.id(), { printRole: false, displayRole: true, displayFrom: '17:00', displayUntil: '20:00' });
    await pc.sync.start();
    assert.equal(pc.roles.print, true);
    assert.equal(pc.worker.settings[pc.id()].settings.printRole, false, '/settings still asks for print off');
    assert.equal(pc.sync.status().pending.printRole, false);
    pc.busyOnApply = false;
    pc.busy = false;
    pc.timers.run(ds.IDLE_CHECK_MS);
    for (let i = 0; i < 8; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(pc.roles.print, false);
  });

  it('a change this computer refuses (no role left) puts its own settings back', async () => {
    const pc = await computer({ print: false, display: true });
    await pc.sync.start();
    pc.worker.edit(pc.id(), { printRole: false, displayRole: false, displayFrom: '17:00', displayUntil: '20:00' });
    await pc.sync.start();
    assert.equal(pc.roles.display, true);
    assert.equal(pc.worker.settings[pc.id()].settings.displayRole, true);
  });

  it('401 is signed out: it says so, stops asking, and starts again on a new sign-in', async () => {
    const pc = await computer();
    pc.worker.token = 'v1.1760000000.2.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    await pc.sync.start();
    assert.equal(pc.sync.status().state, 'signed-out');
    assert.deepEqual(pc.signedOutWith, [SESSION]);
    pc.worker.calls.length = 0;
    await pc.sync.start();
    assert.deepEqual(pc.worker.calls, [], 'the refused session is not tried again');
    pc.session = null;
    await pc.sync.start();
    assert.equal(pc.sync.status().state, 'signed-out', 'still said with no session at all');
    pc.session = { url: URL_, session: pc.worker.token };
    await pc.sync.start();
    assert.equal(pc.sync.status().state, 'ok');
  });

  it('not signed in, or not set up: nothing is sent', async () => {
    const pc = await computer({ signedIn: false });
    await pc.sync.start();
    assert.deepEqual(pc.worker.calls, []);
    assert.equal(pc.sync.status().state, 'off');
  });

  it('names: a rename on /settings is taken here, a rename here goes up', async () => {
    const pc = await computer({ name: 'Desk' });
    await pc.sync.start();
    pc.worker.screens[pc.id()].name = 'Welcome desk';
    await pc.sync.start();
    assert.equal(pc.roles.name, 'Welcome desk');
    pc.roles = { ...pc.roles, name: 'Front desk' };
    await pc.sync.start();
    assert.equal(pc.worker.screens[pc.id()].name, 'Front desk');
    const stored = JSON.parse(fs.readFileSync(path.join(pc.dir, ds.FILE), 'utf8'));
    assert.equal(stored.name, 'Front desk');
  });
});

describe("the app's version and update ride the hello", () => {
  const { createAppReport } = require('../src/update-progress');
  const idle = { checking: false, available: null, downloaded: null, percent: null, error: null };
  const withApp = async () => {
    const u = { ...idle };
    const rep = createAppReport({ now: () => Date.parse('2026-10-12T15:00:00Z') });
    const pc = await computer({ report: () => rep.read('9.4.0', u) });
    return { pc, u };
  };
  const helloCalls = (pc) => pc.worker.calls.filter((c) => c.path === '/v1/screens/hello');

  it('every hello carries it', async () => {
    const { pc } = await withApp();
    await pc.sync.start();
    assert.deepEqual(helloCalls(pc)[0].body.status, { app: { version: '9.4.0', update: { state: 'none', percent: null, at: '2026-10-12T15:00:00.000Z' } } });
    pc.timers.run(ds.HELLO_MS);
    await pc.sync.start();
    assert.ok(helloCalls(pc).every((c) => c.body.status && c.body.status.app.version === '9.4.0'));
  });

  it('an update moving says hello sooner: on a new state or ten points, never within a minute of the last hello', async () => {
    const { pc, u } = await withApp();
    await pc.sync.start();
    const before = helloCalls(pc).length;
    // Nothing moved: nothing extra.
    pc.sync.reportSoon();
    assert.equal(pc.timers.has(ds.REPORT_GAP_MS), false);
    // Downloading starts right after a hello: it waits out the minute.
    u.available = '9.5.0'; u.percent = 3;
    pc.clock += 1000;
    pc.sync.reportSoon();
    assert.ok(pc.timers.has(ds.REPORT_GAP_MS - 1000), 'waits the rest of the minute');
    pc.sync.reportSoon(); // a second move while waiting: still one hello
    pc.timers.run(ds.REPORT_GAP_MS - 1000);
    await pc.sync.start();
    const sent = helloCalls(pc).slice(before);
    assert.equal(sent.at(-1).body.status.app.update.state, 'downloading');
    // A few points: the two-minute hello carries them.
    u.percent = 9;
    pc.clock += 2 * 60 * 1000;
    pc.sync.reportSoon();
    assert.equal(pc.timers.has(0), false);
    // Ten points, a minute on: at once.
    u.percent = 13;
    pc.sync.reportSoon();
    assert.ok(pc.timers.has(0));
    pc.timers.run(0);
    await pc.sync.start();
    assert.equal(helloCalls(pc).at(-1).body.status.app.update.percent, 13);
    // Ready: a new state.
    u.downloaded = '9.5.0';
    pc.clock += 2 * 60 * 1000;
    pc.sync.reportSoon();
    pc.timers.run(0);
    await pc.sync.start();
    assert.equal(pc.worker.screens[pc.id()].status.app.update.state, 'ready');
  });

  it('quiet when signed out or stopped, and a report that throws only leaves the status out', async () => {
    const out = await computer({ signedIn: false, report: () => ({ app: { version: '9.4.0', update: { state: 'none', percent: null, at: null } } }) });
    await out.sync.start();
    out.sync.reportSoon();
    assert.equal(out.worker.calls.length, 0);
    const pc = await computer({ report: () => { throw new Error('no'); } });
    await pc.sync.start();
    assert.equal('status' in pc.worker.calls[0].body, false);
    pc.sync.stop();
    pc.sync.reportSoon();
    assert.equal(pc.timers.has(0), false);
  });
});

describe("the display log's tail goes up after a round (routes.md 10.7a)", () => {
  const logCalls = (pc) => pc.worker.calls.filter((c) => c.method === 'PUT' && c.path.endsWith('/log'));

  it('sent after a good round, again only when it changed', async () => {
    let lines = ['2026-10-22T22:00:00.000Z start 10.6.1'];
    const pc = await computer({ logTail: () => lines });
    await pc.sync.start();
    assert.deepEqual(pc.worker.logs, [lines]);
    pc.timers.run(ds.HELLO_MS);
    await pc.sync.start();
    assert.equal(logCalls(pc).length, 1);
    lines = [...lines, '2026-10-22T22:02:00.000Z pen watch: SMART Ink {"lifted":true}'];
    pc.timers.run(ds.HELLO_MS);
    await pc.sync.start();
    assert.equal(logCalls(pc).length, 2);
    assert.equal(pc.worker.logs[1].length, 2);
  });

  it('a Worker without the route is not asked again; no tail, nothing sent; signed out, nothing sent', async () => {
    const w = fakeWorker();
    w.noLogRoute = true;
    let n = 0;
    const pc = await computer({ worker: w, logTail: () => [`line ${n++}`] });
    await pc.sync.start();
    pc.timers.run(ds.HELLO_MS);
    await pc.sync.start();
    assert.equal(logCalls(pc).length, 1);
    const none = await computer({ logTail: () => null });
    await none.sync.start();
    assert.equal(logCalls(none).length, 0);
    const out = await computer({ signedIn: false, logTail: () => ['a'] });
    await out.sync.start();
    assert.equal(logCalls(out).length, 0);
  });
});

describe('log-tail.js', () => {
  const { readLogTail, scrubLine } = require('../src/log-tail');
  it('keeps the newest lines, reaching into the rolled-over file, and scrubs the user folder and sessions', () => {
    const dir = tmp();
    const file = path.join(dir, 'display.log');
    fs.writeFileSync(`${file}.1`, Array.from({ length: 80 }, (_, i) => `old ${i}`).join('\n') + '\n');
    fs.writeFileSync(file, Array.from({ length: 30 }, (_, i) => `new ${i}`).join('\r\n') + '\r\n');
    const tail = readLogTail(file);
    assert.equal(tail.length, 100);
    assert.equal(tail[0], 'old 10');
    assert.equal(tail[99], 'new 29');
    assert.deepEqual(readLogTail(path.join(dir, 'missing.log')), []);
    assert.equal(scrubLine('at C:\\Users\\Pat Smith\\AppData\\x.js'), 'at C:\\Users\\…\\AppData\\x.js');
    assert.equal(scrubLine('"C:\\\\Users\\\\pat\\\\x"'), '"C:\\\\Users\\\\…\\\\x"');
    assert.equal(scrubLine('wss://a/v1/live?session=v1.abc&station=9'), 'wss://a/v1/live?session=…&station=9');
    assert.equal(scrubLine('Authorization: Bearer v1.abc.def'), 'Authorization: Bearer …');
  });
  it('main.js hands device-sync the display log under userData', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
    assert.match(main, /logTail: \(\) => readLogTail\(path\.join\(userData, 'display', 'display\.log'\)\),/);
  });
});

describe('roles.json keeps the id', () => {
  it('made once, kept through every change', () => {
    const dir = tmp();
    const a = rolesStore.ensureDeviceId(dir, rolesStore.normalizeRoles({ print: true, setupDone: true }));
    assert.ok(rolesStore.isDeviceId(a.deviceId));
    assert.equal(rolesStore.ensureDeviceId(dir, a).deviceId, a.deviceId);
    const changed = rolesStore.checkRolesChange(a, { display: true, name: 'Both' });
    assert.equal(changed.roles.deviceId, a.deviceId);
    rolesStore.writeRoles(dir, changed.roles);
    assert.equal(rolesStore.readRoles(dir).deviceId, a.deviceId);
    assert.equal(rolesStore.normalizeRoles({ deviceId: 'short' }).deviceId, undefined);
  });
});

describe('main.js wiring', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  it('applies a /settings change through the wizard\'s path, and asks the print server whether it is busy', () => {
    assert.match(main, /async function applyDeviceSettings\(s\) \{[\s\S]*?rolesStore\.checkRolesChange\(roles, \{ print: s\.printRole, display: s\.displayRole \}, \{ printing: serverBusy\(\) \}\)[\s\S]*?await applyRoles\(check\.roles\);/);
    assert.match(main, /display\.configure\(\{ hours: \{ start: s\.displayFrom, end: s\.displayUntil \} \}\)/);
    assert.match(main, /busy: serverBusy,/);
    assert.match(main, /serverModule\.isBusy\(\)/);
  });
  it('registers only once setup is done, and never with the session in a log or a file of its own', () => {
    assert.match(main, /function deviceSession\(\) \{\n  if \(!roles\.setupDone \|\| !syncSession\) return null;/);
    assert.doesNotMatch(main, /console\.[a-z]+\([^\n]*\.session\b/);
  });
  it("the app's version and update ride the hello, and every updater event may send it sooner", () => {
    assert.match(main, /report: \(\) => appReport\.read\(app\.getVersion\(\), updateState\),/);
    for (const ev of ['update-available', 'update-not-available', 'download-progress', 'update-downloaded', 'error']) {
      const at = main.indexOf(`autoUpdater.on('${ev}'`);
      assert.ok(at > 0, ev);
      const body = main.slice(at, main.indexOf('\n  });', at));
      assert.match(body, /reportUpdate\(\);/, ev);
    }
  });
  it('a local change is sent up: applyRoles and the display\'s Settings window nudge it', () => {
    assert.match(main, /refreshTray\(\);\n  if \(deviceSync\) deviceSync\.nudge\(\);/);
    assert.match(main, /onChange: \(\) => \{ refreshTray\(\); if \(deviceSync\) deviceSync\.nudge\(\); \}/);
  });
});
