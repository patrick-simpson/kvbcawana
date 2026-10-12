// @ts-check
// The runtime switches (routes.md 10.2): the owner flips CLOUD_PRINT,
// SINGLE_PUBLISHER and YM_CHECKOUT (and three safety switches) from
// awana.kvbchurch.org/settings, no deploy. `wrangler.toml [vars]` are the
// DEFAULTS; a stored value overrides its default until "Back to default"
// deletes it. `SWITCHES_STORED = "off"` in [vars] is the deploy kill: stored
// values are ignored (defaults only) and a PUT is refused.
//
// HOW EVERY READER SEES THE EFFECTIVE VALUE: SyncCore keeps the raw env and
// hands every module `effectiveEnv()`, an object whose prototype is the raw
// env with an own getter for each of the six names, so `env.CLOUD_PRINT` in
// adopt.js, `env.SINGLE_PUBLISHER` in sync.js and `env.YM_CHECKOUT` in
// ymcheckout.js read the effective value with no edit. SyncCore awaits
// `load()` first in handle(), alarm() and cron(); a PUT changes memory and
// storage in one synchronous step (doc.js) before it answers, so the change
// holds for the rest of that request and every later one.
//
// STORAGE `switches` = {v: 1, rev, updatedAt, by, values: {NAME: 'on'|'off'}}: a
// name absent from `values` follows its default. Fixed words only.

import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { DOORBELL_EVENT, frameText } from './live.js';
import { watchWindow } from './watcher.js';
import { changedSince, changedSinceRefusal } from './changes.js';

/** @typedef {'on'|'off'} OnOff */

export const SWITCHES = Object.freeze([
  Object.freeze({ name: 'CLOUD_PRINT', group: 'online', fallback: /** @type {OnOff} */ ('off') }),
  Object.freeze({ name: 'SINGLE_PUBLISHER', group: 'online', fallback: /** @type {OnOff} */ ('off') }),
  Object.freeze({ name: 'YM_CHECKOUT', group: 'online', fallback: /** @type {OnOff} */ ('off') }),
  Object.freeze({ name: 'CHURCH_SETTINGS', group: 'safety', fallback: /** @type {OnOff} */ ('on') }),
  Object.freeze({ name: 'NOTICES', group: 'safety', fallback: /** @type {OnOff} */ ('on') }),
  Object.freeze({ name: 'CHANGE_LOG', group: 'safety', fallback: /** @type {OnOff} */ ('on') }),
]);
export const SWITCH_NAMES = Object.freeze(SWITCHES.map((s) => s.name));

/** A station older than this cannot follow a runtime SINGLE_PUBLISHER / YM_CHECKOUT change. */
export const STATION_MIN_VERSION = '9.3.0';
/** "A station is here": a heartbeat this recent. */
export const STATION_RECENT_MS = 2 * 60 * 1000;
/** The switches a 9.2.x station reads only at start (it cannot follow a runtime flip). */
const STATION_FOLLOWS = ['SINGLE_PUBLISHER', 'YM_CHECKOUT'];

/** 'on' / 'off' from a var or a stored value, else null. @param {unknown} v @returns {OnOff|null} */
function onOff(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'on' || s === 'off' ? s : null;
}

/** Is version `a` older than `b` (X.Y.Z)? A missing or odd version is older. @param {unknown} a @param {string} b */
export function olderThan(a, b) {
  const m = typeof a === 'string' ? /^(\d{1,4})\.(\d{1,5})\.(\d{1,6})$/.exec(a) : null;
  if (!m) return true;
  const want = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = Number(m[i + 1]);
    if (x !== want[i]) return x < want[i];
  }
  return false;
}

export class Switches {
  /**
   * @param {{ storage: import('./sync.js').Store, rawEnv: Record<string, any>, now: () => number }} deps
   */
  constructor({ storage, rawEnv, now }) {
    this.rawEnv = rawEnv;
    this.now = now;
    this.doc = new Doc(storage, 'switches', () => ({ v: 1, rev: 0, updatedAt: null, by: null, values: {} }));
  }

  /** Memoized: the first call reads storage, every later one is free. */
  load() {
    return this.doc.load();
  }

  /** False under the deploy kill (SWITCHES_STORED = "off"): defaults only. */
  get stored() {
    return onOff(this.rawEnv.SWITCHES_STORED) !== 'off';
  }

  get rev() {
    return this.doc.data ? this.doc.data.rev : 0;
  }

  /** @param {string} name */
  static spec(name) {
    return SWITCHES.find((s) => s.name === name) || null;
  }

  /** The wrangler.toml value, else the switch's own fallback. @param {string} name @returns {OnOff} */
  defaultOf(name) {
    const spec = Switches.spec(name);
    return onOff(this.rawEnv[name]) ?? (spec ? spec.fallback : 'off');
  }

  /** The stored override, or null (none, not loaded yet, or the deploy kill). @param {string} name @returns {OnOff|null} */
  storedOf(name) {
    if (!this.stored || !this.doc.data) return null;
    const values = this.doc.data.values || {};
    return Object.prototype.hasOwnProperty.call(values, name) ? onOff(values[name]) : null;
  }

  /** @param {string} name @returns {OnOff} */
  value(name) {
    return this.storedOf(name) ?? this.defaultOf(name);
  }

  /** Every switch's effective value. @returns {Record<string, OnOff>} */
  values() {
    return Object.fromEntries(SWITCH_NAMES.map((n) => [n, this.value(n)]));
  }

  /** The env every module reads: the raw env, with the six names effective. @returns {Record<string, any>} */
  effectiveEnv() {
    const env = Object.create(this.rawEnv);
    for (const name of SWITCH_NAMES) {
      // An assignment (a test, or code that set env.X before switches existed) sets the
      // DEFAULT, as editing wrangler.toml would; a stored value still wins over it.
      Object.defineProperty(env, name, { get: () => this.value(name), set: (v) => { this.rawEnv[name] = v; }, enumerable: true });
    }
    return env;
  }

  /** One switch as the page shows it. @param {string} name */
  view(name) {
    const spec = /** @type {any} */ (Switches.spec(name));
    return { name, group: spec.group, value: this.value(name), default: this.defaultOf(name), source: this.storedOf(name) ? 'worker' : 'default' };
  }

  list() {
    return SWITCH_NAMES.map((n) => this.view(n));
  }

  /**
   * Set or clear one stored value. Synchronous (after load()): the check of
   * `rev` and the write are one step. The caller saves.
   * @param {string} name @param {'on'|'off'|'default'} value @param {any} by
   * @returns {{ ok: true, changed: boolean, before: OnOff|null, after: OnOff|null } | { ok: false, reason: 'stored-off' }}
   */
  set(name, value, by) {
    if (!this.stored) return { ok: false, reason: 'stored-off' };
    const d = this.doc.data;
    const before = this.storedOf(name);
    const after = value === 'default' ? null : value;
    if (before === after) return { ok: true, changed: false, before, after };
    if (after === null) delete d.values[name];
    else d.values[name] = after;
    d.rev += 1;
    d.updatedAt = new Date(this.now()).toISOString();
    d.by = by;
    return { ok: true, changed: true, before, after };
  }
}

/**
 * What the page should hear before a flip (never a refusal).
 * @param {string} name @param {'on'|'off'} from @param {'on'|'off'} to
 * @param {{ lastSeenAt: string|null, version?: string|null }[]} stations @param {number} now
 * @returns {string[]}
 */
export function switchWarnings(name, from, to, stations, now) {
  if (from === to) return [];
  const spec = Switches.spec(name);
  const recent = stations.filter((s) => s.lastSeenAt && now - Date.parse(s.lastSeenAt) <= STATION_RECENT_MS);
  /** @type {string[]} */
  const out = [];
  if (spec && spec.group === 'online' && !recent.length) out.push('no-station');
  if (STATION_FOLLOWS.includes(name) && recent.some((s) => olderThan(s.version, STATION_MIN_VERSION))) out.push('station-old');
  if (watchWindow(now).open) out.push('window-open');
  // The extension's sweep stays off until its TwoTimTwo tab reloads (it reads /config/church at start).
  if (name === 'YM_CHECKOUT' && from === 'on' && to === 'off' && stations.length) out.push('ym-tab-reload');
  return out;
}

/** The stations as GET /v1/switches lists them. @param {any} core */
export async function stationsView(core) {
  return (await core.stations.list()).map((/** @type {any} */ s) => ({
    stationId: s.stationId, name: s.name, lastSeenAt: s.lastSeenAt, version: s.version ?? null, churchRev: s.churchRev ?? null,
  }));
}

/**
 * The routes (routes.md 10.2) and the `switch` undoer.
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore
 */
export function mountSwitches(registry, core) {
  /** @type {Switches} */
  const sw = core.switches;

  const answer = async () => {
    await sw.load();
    const d = sw.doc.data;
    return { rev: d.rev, updatedAt: d.updatedAt, by: d.by, stored: sw.stored, switches: sw.list(), stations: await stationsView(core) };
  };

  /**
   * The one write path (a PUT and an Undo).
   * @param {string} name @param {'on'|'off'|'default'} value @param {any} device
   * @param {{ rev?: number, dryRun?: boolean, undoOf?: number, expect?: (stored: OnOff|null) => string[] }} opts
   */
  const write = async (name, value, device, opts = {}) => {
    await sw.load();
    await core.stations.load();
    const stations = await stationsView(core);
    if (!sw.stored) return { ok: false, status: 409, reason: 'stored-off', error: 'Stored switches are off for this deploy (SWITCHES_STORED).' };
    // From here on, no await until the save: the rev check and the write are one step.
    if (opts.rev !== undefined && opts.rev !== sw.rev) return { ok: false, status: 409, reason: 'stale', rev: sw.rev, error: 'Someone else changed the switches a moment ago.' };
    if (opts.expect) {
      const moved = opts.expect(sw.storedOf(name));
      if (moved.length) return changedSinceRefusal(moved);
    }
    const from = sw.value(name);
    const to = value === 'default' ? sw.defaultOf(name) : value;
    const warnings = switchWarnings(name, from, to, stations, core.now());
    if (opts.dryRun) return { ok: true, body: { ok: true, dryRun: true, rev: sw.rev, switch: { ...sw.view(name), value: to }, warnings } };
    const r = sw.set(name, value, device);
    if (!r.ok) return { ok: false, status: 409, reason: r.reason, error: 'Stored switches are off for this deploy (SWITCHES_STORED).' };
    if (!r.changed) return { ok: true, body: { ok: true, rev: sw.rev, switch: sw.view(name), warnings: [] } };
    await sw.doc.save();
    core.broadcast(frameText(DOORBELL_EVENT, { what: 'switches', rev: sw.rev }));
    const seq = await core.logChange(null, { device, undoOf: opts.undoOf }, {
      what: 'switch', target: name, keys: [name], before: { [name]: r.before }, after: { [name]: r.after },
    });
    return { ok: true, seq, body: { ok: true, rev: sw.rev, switch: sw.view(name), warnings } };
  };

  registry.add('GET', '/v1/switches', 'session', async () => json(await answer()));

  registry.add('PUT', '/v1/switches', 'session', async ({ body, request }) => {
    const b = await body();
    if (!Switches.spec(b.name)) return fail('There is no such switch.', 400, { reason: 'bad-name' });
    if (!['on', 'off', 'default'].includes(b.value)) return fail('A switch is on, off or default.', 400, { reason: 'bad-value' });
    if (b.rev !== undefined && !Number.isInteger(b.rev)) return fail('rev is a number.', 400, { reason: 'bad-rev' });
    const device = await core.deviceOf(request);
    const r = await write(b.name, b.value, device, { rev: b.rev, dryRun: b.dryRun === true });
    if (!r.ok) return fail(r.error, r.status, { reason: r.reason, ...(r.rev !== undefined ? { rev: r.rev } : {}), ...(r.keys ? { keys: r.keys } : {}) });
    return json(r.body);
  });

  core.undoers.switch = async (/** @type {{ entry: any, before: any, device: any, undoOf: number }} */ { entry, before, device, undoOf }) => {
    const name = entry.target;
    if (!Switches.spec(name)) return { ok: false, status: 409, reason: 'not-undoable', error: 'There is no such switch.' };
    const back = before[name] === 'on' || before[name] === 'off' ? before[name] : 'default';
    const r = await write(name, back, device, { undoOf, expect: (stored) => changedSince(entry, { [name]: stored }) });
    return r.ok ? { ok: true, seq: r.seq } : r;
  };
}
