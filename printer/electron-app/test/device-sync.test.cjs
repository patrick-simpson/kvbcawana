'use strict';
// This computer's row on /settings (src/device-sync.js), against a stand-in
// of the sync Worker's screen registry (lobby/worker/src/screens.js: hello,
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
    const m = /^\/v1\/screens\/([^/]+)(?:\/(settings|name))?$/.exec(p);
    if (p === '/v1/screens/hello' && method === 'POST') {
      let r = w.screens[body.id];
      if (!r) r = w.screens[body.id] = { id: body.id, kind: body.kind, name: body.name };
      r.pendingRoleChange = body.pendingRoleChange || null;
      return { ok: true, status: 200, body: { screen: { ...r }, settings: w.settings[body.id] || null } };
    }
    if (m && m[2] === 'settings' && method === 'GET') return { ok: true, status: 200, body: { screen: w.screens[m[1]], settings: w.settings[m[1]] || null } };
    if (m && m[2] === 'settings' && method === 'PUT') {
      w.settings[m[1]] = { savedAt: stamp(), settings: ds.cleanSettings(body.settings) };
      return { ok: true, status: 200, body: { ...w.settings[m[1]], dropped: [] } };
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
function computer({ worker = fakeWorker(), print = true, display = false, name = 'Check-in laptop', signedIn = true } = {}) {
  const dir = tmp();
  const pc = {
    dir, worker, timers: fakeTimers(), busy: false, applied: [], statuses: [], signedOutWith: [],
    roles: rolesStore.normalizeRoles({ print, display, name, setupDone: true }),
    hours: { start: '17:00', end: '20:00' },
    session: signedIn ? { url: URL_, session: SESSION } : null,
    syncedAtApply: [],
  };
  pc.local = () => ({ printRole: pc.roles.print, displayRole: pc.roles.display, displayFrom: pc.hours.start, displayUntil: pc.hours.end });
  pc.sync = ds.createDeviceSync({
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
  });
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
    const pc = computer();
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
    const pc = computer({ print: true, display: false });
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
    const pc = computer();
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
    const pc = computer({ print: true, display: false });
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
    const pc = computer({ print: true, display: true });
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
    const pc = computer({ print: false, display: true });
    await pc.sync.start();
    pc.worker.edit(pc.id(), { printRole: false, displayRole: false, displayFrom: '17:00', displayUntil: '20:00' });
    await pc.sync.start();
    assert.equal(pc.roles.display, true);
    assert.equal(pc.worker.settings[pc.id()].settings.displayRole, true);
  });

  it('401 is signed out: it says so, stops asking, and starts again on a new sign-in', async () => {
    const pc = computer();
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
    const pc = computer({ signedIn: false });
    await pc.sync.start();
    assert.deepEqual(pc.worker.calls, []);
    assert.equal(pc.sync.status().state, 'off');
  });

  it('names: a rename on /settings is taken here, a rename here goes up', async () => {
    const pc = computer({ name: 'Desk' });
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
  it('a local change is sent up: applyRoles and the display\'s Settings window nudge it', () => {
    assert.match(main, /refreshTray\(\);\n  if \(deviceSync\) deviceSync\.nudge\(\);/);
    assert.match(main, /onChange: \(\) => \{ refreshTray\(\); if \(deviceSync\) deviceSync\.nudge\(\); \}/);
  });
});
