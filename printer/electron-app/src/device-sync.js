// This computer's row on awana.kvbchurch.org/settings (KVBC Awana v9,
// ROADMAP.md#kvbc-awana-one-app; ROADMAP.md#settings-page phase 2's screen registry, kind 'computer').
// Electron-free, like roles.js: main.js hands it the session, the request
// helper and the two halves of "what this computer is", and
// test/device-sync.test.cjs drives it with stand-ins.
//
// WHAT IT DOES, at start and every HELLO_MS (the app has no live socket, so
// the hello IS the doorbell):
//   1. POST /v1/screens/hello {id, kind: 'computer', name, pendingRoleChange?}
//      (the id is roles.json's deviceId, made once);
//   2. GET /v1/screens/<id>/settings: the four keys SCREEN_SPECS.computer
//      allows (printRole, displayRole, displayFrom, displayUntil);
//   3. reconciles them against the last copy both sides agreed on (`synced`,
//      kept in userData\device-sync.json), exactly as the lobby TV's
//      reconcileScreen does: the Worker's copy moved on (someone changed it
//      on /settings) -> applied here, through main.js's applyRoles (the path
//      the wizard and roles:set take; print off restarts the app); otherwise
//      this computer's moved on (the wizard, the display's Settings window) ->
//      PUT up. A change made here is also sent within seconds (nudge()).
//
// NEVER TURN THE PRINT SERVER OFF MID-PRINT (owner, 2026-10-11). A change
// that turns print off while the print server says it is busy (a label
// printing, or waiting to print: server.js isBusy()) is HELD: the rest of it
// (the display, the hours) applies now, print stays on, the hello carries
// `pendingRoleChange`, and the moment the server is idle the change applies.
//
// 401 means signed out (the passphrase changed): it stops asking, says so
// (status().state 'signed-out', the tray shows it), and starts again by
// itself once there is a different session (the wizard signs in again).
'use strict';

const fs = require('fs');
const path = require('path');

const KIND = 'computer';
const FILE = 'device-sync.json';
/** A hello this often (the Worker calls a screen online for 3 minutes after one). */
const HELLO_MS = 2 * 60 * 1000;
/** A change made on this computer goes up this long after the last one. */
const PUSH_DEBOUNCE_MS = 1500;
/** While a print-off is held, how often the print server is asked whether it is idle. */
const IDLE_CHECK_MS = 3000;
/** The Worker's SCREEN_NAME_MAX. */
const NAME_MAX = 40;

// SCREEN_SPECS.computer in lobby/src/lib/syncSpecs.js, written out (this app
// cannot import the lobby's ES module at run time);
// test/device-sync.test.cjs pins the two equal.
const SPEC = Object.freeze({
  printRole: 'bool',
  displayRole: 'bool',
  displayFrom: 'time',
  displayUntil: 'time',
});
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Exactly the computer allowlist, in its order. @returns {Record<string, boolean|string>} */
function cleanSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, type] of Object.entries(SPEC)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    const v = raw[key];
    if (type === 'bool' && typeof v === 'boolean') out[key] = v;
    if (type === 'time' && typeof v === 'string' && TIME.test(v)) out[key] = v;
  }
  return out;
}

/** {savedAt, settings} or null. */
function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.savedAt !== 'string' || !Number.isFinite(Date.parse(raw.savedAt))) return null;
  return { savedAt: raw.savedAt, settings: cleanSettings(raw.settings) };
}

/** The Worker's cleanScreenName: one line, at most NAME_MAX characters. */
function screenName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

const same = (a, b) => JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));

/**
 * What to do with the Worker's copy. Pure; the lobby's reconcileScreen for
 * this one kind. A key the Worker's copy lacks keeps this computer's value.
 * @returns {{do: 'apply', settings: object, synced: object} | {do: 'push', settings: object} | {do: 'none', synced: object}}
 */
function reconcileComputer({ remote, synced, local }) {
  const mine = cleanSettings(local);
  const theirs = cleanRecord(remote);
  if (!theirs) return { do: 'push', settings: mine };
  if (theirs.savedAt !== (synced && synced.savedAt)) {
    const wanted = cleanSettings({ ...mine, ...theirs.settings });
    return same(wanted, mine) ? { do: 'none', synced: theirs } : { do: 'apply', settings: wanted, synced: theirs };
  }
  return same(mine, theirs.settings) ? { do: 'none', synced: theirs } : { do: 'push', settings: mine };
}

/** Does going from `local` to `wanted` turn the print server off? */
const turnsPrintOff = (local, wanted) => local.printRole === true && wanted.printRole === false;

function readStore(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userData, FILE), 'utf8'));
    return {
      synced: cleanRecord(raw && raw.synced),
      name: raw && typeof raw.name === 'string' ? raw.name : null,
    };
  } catch {
    return { synced: null, name: null };
  }
}

function writeStore(userData, store) {
  const file = path.join(userData, FILE);
  const tmp = `${file}.tmp`;
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ synced: store.synced, name: store.name }, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * @param {{
 *   userData: string,
 *   deviceId: () => string,                     roles.json's id, made once (rolesStore.ensureDeviceId)
 *   session: () => ({url: string, session: string} | null),   null: not signed in (or setup not done)
 *   request: (base: string, path: string, opts: object) => Promise<{ok: boolean, status: number, body: any}>,
 *   name: () => string,                         what to call it (roles.name, else the computer's own name)
 *   setName: (name: string) => Promise<void> | void,   a rename made on /settings
 *   local: () => object,                        {printRole, displayRole, displayFrom, displayUntil} now
 *   apply: (settings: object) => Promise<{ok: boolean, error?: string}>,
 *   busy: () => boolean,                        the print server is printing or has a label waiting
 *   onStatus?: (status: object) => void,
 *   onSignedOut?: (session: {url: string, session: string}) => void,
 *   log?: (...args: any[]) => void,
 *   timers?: { setTimeout: Function, clearTimeout: Function },
 * }} deps
 */
function createDeviceSync(deps) {
  const log = deps.log || (() => {});
  const timers = deps.timers || { setTimeout, clearTimeout };
  const store = readStore(deps.userData);
  let running = false;
  let loop = null;
  let soon = null;
  let idleTimer = null;
  let ticking = null;
  let again = false;
  let held = null;           // a print-off waiting for the print server to finish
  let failedToken = null;    // the session the Worker said 401 to
  let lastLocal = null;      // what nudge() compares against
  let status = { state: 'off', pending: null, error: null, at: null };

  const unref = (t) => { if (t && typeof t.unref === 'function') t.unref(); return t; };
  const snapshot = () => JSON.stringify({ s: cleanSettings(deps.local()), n: screenName(deps.name()) });

  function setStatus(patch) {
    const next = { ...status, ...patch, pending: held, at: new Date().toISOString() };
    const changed = next.state !== status.state || JSON.stringify(next.pending) !== JSON.stringify(status.pending) || next.error !== status.error;
    status = next;
    if (changed && deps.onStatus) {
      try { deps.onStatus(status); } catch (e) { log('[device] status listener failed:', e && e.message); }
    }
  }

  function persist() {
    try { writeStore(deps.userData, store); } catch (e) { log('[device] could not save device-sync.json:', e && e.message); }
  }

  function schedule() {
    if (!running) return;
    if (loop) timers.clearTimeout(loop);
    loop = unref(timers.setTimeout(() => { loop = null; tick(); }, HELLO_MS));
  }

  function watchIdle() {
    if (idleTimer || !held) return;
    idleTimer = unref(timers.setTimeout(() => {
      idleTimer = null;
      if (!held || !running) return;
      let busy = true;
      try { busy = Boolean(deps.busy()); } catch { busy = false; }
      if (busy) watchIdle();
      else tick();
    }, IDLE_CHECK_MS));
  }

  /** One round; never two at once (a second ask runs once more after). */
  function tick() {
    if (!running) return Promise.resolve();
    if (ticking) { again = true; return ticking; }
    ticking = round()
      .catch((e) => { log('[device] round failed:', e && e.message); setStatus({ state: 'error', error: String(e && e.message || e) }); })
      .finally(() => {
        ticking = null;
        schedule();
        if (again) { again = false; tick(); }
      });
    return ticking;
  }

  function signedOut(s) {
    failedToken = s.session;
    held = null;
    setStatus({ state: 'signed-out', error: 'Signed out of the sync service: the passphrase may have changed.' });
    log('[device] signed out (401): waiting for a new sign-in');
    if (deps.onSignedOut) {
      try { deps.onSignedOut(s); } catch (e) { log('[device] sign-out listener failed:', e && e.message); }
    }
  }

  /** An answer that ends the round: true when the round should stop here. */
  function failed(res, s, what) {
    if (res.status === 401) { signedOut(s); return true; }
    if (res.ok) return false;
    const error = res.status === 0 ? 'The sync service could not be reached.' : (res.body && typeof res.body.error === 'string' ? res.body.error : `${what}: HTTP ${res.status}`);
    setStatus({ state: res.status === 0 ? 'offline' : 'error', error });
    return true;
  }

  function hello(s, id) {
    const body = { id, kind: KIND, name: screenName(deps.name()) || 'Computer' };
    if (held) body.pendingRoleChange = held;
    return deps.request(s.url, '/v1/screens/hello', { method: 'POST', body, session: s.session });
  }

  async function put(s, id, settings) {
    const res = await deps.request(s.url, `/v1/screens/${id}/settings`, { method: 'PUT', body: { settings }, session: s.session });
    if (failed(res, s, 'Saving this computer\'s settings')) return false;
    store.synced = cleanRecord(res.body) || { savedAt: new Date().toISOString(), settings: cleanSettings(settings) };
    persist();
    return true;
  }

  async function syncName(s, id, workerName) {
    const mine = screenName(deps.name());
    if (typeof workerName !== 'string') return;
    if (store.name === null) {
      // First contact: a new row carries this computer's name already; an
      // existing one (a reinstall, a lost device-sync.json) keeps its own.
      store.name = workerName;
      persist();
      if (workerName !== mine) await deps.setName(workerName);
      return;
    }
    if (workerName !== store.name) {
      // Renamed on /settings.
      store.name = workerName;
      persist();
      if (workerName !== mine) await deps.setName(workerName);
      return;
    }
    if (mine && mine !== store.name) {
      // Renamed here (the wizard).
      const res = await deps.request(s.url, `/v1/screens/${id}/name`, { method: 'PUT', body: { name: mine }, session: s.session });
      if (res.ok && res.body && res.body.screen && typeof res.body.screen.name === 'string') {
        store.name = res.body.screen.name;
        persist();
      } else if (res.status === 401) {
        signedOut(s);
      }
    }
  }

  async function round() {
    const s = deps.session();
    if (!s) {
      held = null;
      // Signed out stays said (the tray keeps showing it) until a new sign-in.
      if (status.state !== 'signed-out') setStatus({ state: 'off', error: null });
      return;
    }
    if (s.session === failedToken) return;   // still the session that was refused
    failedToken = null;
    const id = deps.deviceId();
    const heldBefore = JSON.stringify(held);

    const hi = await hello(s, id);
    if (failed(hi, s, 'Saying hello')) return;
    await syncName(s, id, hi.body && hi.body.screen ? hi.body.screen.name : undefined);
    if (failedToken) return;   // the rename was refused: signed out

    const got = await deps.request(s.url, `/v1/screens/${id}/settings`, { session: s.session });
    if (failed(got, s, 'Reading this computer\'s settings')) return;

    const local = cleanSettings(deps.local());
    const r = reconcileComputer({ remote: got.body ? got.body.settings : null, synced: store.synced, local });
    if (r.do === 'none') {
      held = null;
      if (JSON.stringify(store.synced) !== JSON.stringify(r.synced)) { store.synced = r.synced; persist(); }
    } else if (r.do === 'push') {
      held = null;
      if (!(await put(s, id, r.settings))) return;
    } else {
      let busy = false;
      try { busy = Boolean(deps.busy()); } catch { busy = false; }
      if (turnsPrintOff(local, r.settings) && busy) {
        // Everything but the print-off now; the print-off when the server is idle.
        held = r.settings;
        const now = cleanSettings({ ...r.settings, printRole: true });
        if (!same(now, local)) await deps.apply(now);
        log('[device] print off held: the print server is busy');
        watchIdle();
      } else {
        held = null;
        // Saved before it is applied: turning print off restarts the app.
        const before = store.synced;
        store.synced = r.synced;
        persist();
        log('[device] applying /settings:', JSON.stringify(r.settings));
        const done = await deps.apply(r.settings);
        let busyNow = false;
        try { busyNow = Boolean(deps.busy()); } catch { busyNow = false; }
        if ((!done || !done.ok) && turnsPrintOff(cleanSettings(deps.local()), r.settings) && busyNow) {
          // A label started between the look and the change: held after all.
          store.synced = before;
          persist();
          held = r.settings;
          watchIdle();
        } else if (!done || !done.ok) {
          // Refused here (no role left, say): this computer's own settings go back up.
          log('[device] not applied:', done && done.error);
          if (!(await put(s, id, cleanSettings(deps.local())))) return;
        }
      }
    }
    lastLocal = snapshot();
    setStatus({ state: 'ok', error: null });
    // /settings should see a hold start or end at once, not in two minutes.
    if (JSON.stringify(held) !== heldBefore) {
      const res = await hello(s, id);
      if (res.status === 401) signedOut(s);
    }
  }

  return {
    /** Starts the loop (a round now). Idempotent: a second start is a round now. */
    start() {
      if (!running) {
        running = true;
        lastLocal = null;
      }
      return tick();
    },
    stop() {
      running = false;
      for (const t of [loop, soon, idleTimer]) if (t) timers.clearTimeout(t);
      loop = soon = idleTimer = null;
    },
    /** Something here may have changed (the wizard, the Settings window, a tray refresh): sent up when it did. */
    nudge() {
      if (!running || status.state === 'signed-out' || status.state === 'off') return;
      let snap;
      try { snap = snapshot(); } catch { return; }
      if (snap === lastLocal) return;
      lastLocal = snap;
      if (soon) timers.clearTimeout(soon);
      soon = unref(timers.setTimeout(() => { soon = null; tick(); }, PUSH_DEBOUNCE_MS));
    },
    status: () => ({ ...status }),
    isRunning: () => running,
  };
}

module.exports = {
  KIND, FILE, HELLO_MS, PUSH_DEBOUNCE_MS, IDLE_CHECK_MS, SPEC,
  cleanSettings, reconcileComputer, screenName, createDeviceSync,
};
