// @ts-check
// The screen registry (ROADMAP.md#settings-page, phase 2; owner, 2026-10-11: "manage every
// screen from /settings"). Each lobby TV, projector and Journey kiosk says
// hello under an id it made once and keeps in its own storage, and the Worker
// keeps who it is and that screen's OWN settings, so awana.kvbchurch.org/settings
// can list the screens and change any one of them from any device.
//
// WHAT IT HOLDS
//   screens        one index, {[id]: {id, kind, name, createdAt, lastSeen,
//                  pending?}}, `pending` only for a computer (below),
//                  at most SCREENS_MAX entries (one key, so no storage listing)
//   screen:<id>    that screen's settings, {savedAt, settings}, through the
//                  kind's allowlist (SCREEN_SPECS in src/lib/syncSpecs.js, the
//                  file the screens apply too)
//
// A change rings the live channel's doorbell, `changed` {what: 'screen', id},
// and the screen with that id fetches its settings; an action from /settings
// rides the same doorbell as {what: 'screen-action', id, action}. Neither is
// replayed to a screen that connects later (a preview check-in an hour late
// is worse than none), and neither goes to Pusher. No child's name is ever in
// any of it: a screen's settings are its chime, motion and the like.
//
// A KVBC Awana computer (kind 'computer', ROADMAP.md#kvbc-awana-one-app) never turns its
// print server off while a label is printing or waiting: it holds that change
// and says so in each hello as `pendingRoleChange` (the settings it is
// waiting to apply), which the list shows until a hello without one.

import {
  SCREEN_DEFAULT_NAMES,
  cleanScreenName,
  isScreenId,
  isScreenKind,
  sanitizeScreenAction,
  sanitizeScreenSettings,
} from '../../src/lib/syncSpecs.js';

/** How many screens the registry keeps. A church has a handful. */
export const SCREENS_MAX = 40;
/** A full set of one screen's settings is well under this (bytes of JSON). */
export const SCREEN_SETTINGS_MAX = 2048;
/** Seen this recently (a hello every 2 minutes) or on the live channel: online. */
export const ONLINE_MS = 3 * 60 * 1000;
/** A hello moves lastSeen in storage at most this often (the answer is always fresh). */
export const SEEN_WRITE_MS = 60 * 1000;
/** A full registry makes room by forgetting the longest-silent screen, if it has been silent this long. */
export const STALE_MS = 30 * 24 * 60 * 60 * 1000;

const INDEX = 'screens';
/** @param {string} id */
export const screenSettingsKey = (id) => `screen:${id}`;

/**
 * @typedef {{id: string, kind: import('../../src/lib/syncSpecs.js').ScreenKind, name: string, createdAt: string, lastSeen: number,
 *   pending?: Record<string, unknown>}} ScreenRecord
 * @typedef {{savedAt: string, settings: Record<string, unknown>}} ScreenSettings
 * @typedef {{ok: true, body: unknown} | {ok: false, status: number, error: string}} Result
 */

/** @param {unknown} v */
const byteLength = (v) => new TextEncoder().encode(JSON.stringify(v)).length;

/** @param {number} status @param {string} error @returns {Result} */
const refuse = (status, error) => ({ ok: false, status, error });

export class Screens {
  /**
   * @param {{ storage: import('./sync.js').Store, now: () => number,
   *   liveScreens?: () => Set<string>, ring?: (payload: Record<string, unknown>) => void }} deps
   */
  constructor({ storage, now, liveScreens, ring }) {
    this.storage = storage;
    this.now = now;
    this.liveScreens = liveScreens || (() => new Set());
    this.ring = ring || (() => {});
  }

  /** @returns {Promise<Record<string, ScreenRecord>>} */
  async index() {
    const raw = await this.storage.get(INDEX);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  /**
   * One record by id: own properties only, and only a real id, so no path can
   * ever reach `__proto__` or another inherited name.
   * @param {Record<string, ScreenRecord>} index @param {unknown} id
   * @returns {ScreenRecord | null}
   */
  static pick(index, id) {
    return isScreenId(id) && Object.prototype.hasOwnProperty.call(index, id) ? index[id] : null;
  }

  /** @param {Record<string, ScreenRecord>} index */
  async saveIndex(index) {
    await this.storage.put(INDEX, index);
  }

  /** The record as /settings sees it. @param {ScreenRecord} r @param {Set<string>} live */
  view(r, live) {
    const onLive = live.has(r.id);
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      createdAt: r.createdAt,
      lastSeen: new Date(r.lastSeen).toISOString(),
      live: onLive,
      online: onLive || this.now() - r.lastSeen <= ONLINE_MS,
      ...(r.pending ? { pendingRoleChange: r.pending } : {}),
    };
  }

  /** @param {string} id @returns {Promise<ScreenSettings | null>} */
  async settingsOf(id) {
    const s = await this.storage.get(screenSettingsKey(id));
    return s && typeof s === 'object' ? s : null;
  }

  /** GET /v1/screens: every screen, by kind, then name. @returns {Promise<Result>} */
  async list() {
    const live = this.liveScreens();
    const order = { lobby: 0, projector: 1, journey: 2, computer: 3 };
    const screens = Object.values(await this.index())
      .map((r) => this.view(r, live))
      .sort((a, b) => (order[a.kind] - order[b.kind]) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return { ok: true, body: { screens, max: SCREENS_MAX } };
  }

  /**
   * POST /v1/screens/hello {id, kind, name?, pendingRoleChange?}: a screen says it is here. A new
   * screen is added (named `name`, else its kind's default); a known one only
   * moves its lastSeen (its name is changed by rename, never by a hello, so a
   * TV restarting cannot undo a name given on /settings). The answer carries
   * the screen and its settings, so a hello is also a fetch.
   * @param {any} body
   * @returns {Promise<Result>}
   */
  async hello(body) {
    const { id, kind } = body || {};
    if (!isScreenId(id)) return refuse(400, 'That screen id is not right.');
    if (!isScreenKind(kind)) return refuse(400, 'That is not a kind of screen the service knows.');
    const index = await this.index();
    const t = this.now();
    let r = Screens.pick(index, id);
    if (r && r.kind !== kind) return refuse(409, 'That id belongs to another kind of screen.');
    // A computer's held change, through its allowlist; nothing for any other kind.
    const held = kind === 'computer' ? sanitizeScreenSettings(kind, body.pendingRoleChange) : {};
    const pending = Object.keys(held).length ? held : undefined;
    if (!r) {
      if (Object.keys(index).length >= SCREENS_MAX && !(await this.makeRoom(index))) {
        return refuse(409, 'The service already knows as many screens as it keeps. Forget an old one on the settings page.');
      }
      r = { id, kind, name: cleanScreenName(body.name) || SCREEN_DEFAULT_NAMES[kind], createdAt: new Date(t).toISOString(), lastSeen: t };
      if (pending) r.pending = pending;
      index[id] = r;
      await this.saveIndex(index);
    } else if (t - r.lastSeen >= SEEN_WRITE_MS || JSON.stringify(r.pending) !== JSON.stringify(pending)) {
      r.lastSeen = t;
      if (pending) r.pending = pending;
      else delete r.pending;
      await this.saveIndex(index);
    }
    return { ok: true, body: { screen: this.view({ ...r, lastSeen: t }, this.liveScreens()), settings: await this.settingsOf(id) } };
  }

  /**
   * Drop the screen silent longest, if it has been silent STALE_MS. A full
   * registry of screens all seen this month refuses a new one instead.
   * @param {Record<string, ScreenRecord>} index
   */
  async makeRoom(index) {
    const oldest = Object.values(index).sort((a, b) => a.lastSeen - b.lastSeen)[0];
    if (!oldest || this.now() - oldest.lastSeen < STALE_MS) return false;
    delete index[oldest.id];
    await this.storage.delete(screenSettingsKey(oldest.id));
    return true;
  }

  /** @param {string} id @returns {Promise<Result>} */
  async get(id) {
    const r = Screens.pick(await this.index(), id);
    if (!r) return refuse(404, 'There is no such screen. It may have been forgotten.');
    return { ok: true, body: { screen: this.view(r, this.liveScreens()), settings: await this.settingsOf(id) } };
  }

  /**
   * PUT /v1/screens/<id>/settings {settings}: the screen's whole own layer,
   * from /settings or from the screen itself (a change made on the TV). Only
   * the kind's allowlist is kept; anything else (a shared key, a Pusher key,
   * panic mode) is dropped and named in `dropped`.
   * @param {string} id
   * @param {any} body
   * @returns {Promise<Result>}
   */
  async putSettings(id, body) {
    const r = Screens.pick(await this.index(), id);
    if (!r) return refuse(404, 'There is no such screen. It may have been forgotten.');
    const raw = body?.settings;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return refuse(400, 'No settings.');
    const settings = sanitizeScreenSettings(r.kind, raw);
    if (byteLength(settings) > SCREEN_SETTINGS_MAX) return refuse(413, 'Those settings are too long for one screen.');
    const dropped = Object.keys(raw).filter((k) => !(k in settings)).slice(0, 50);
    const prev = await this.settingsOf(id);
    const next = { savedAt: this.stampAfter(prev?.savedAt), settings };
    await this.storage.put(screenSettingsKey(id), next);
    this.ring({ what: 'screen', id, at: next.savedAt });
    return { ok: true, body: { ...next, dropped } };
  }

  /** PUT /v1/screens/<id>/name {name} @param {string} id @param {any} body @returns {Promise<Result>} */
  async rename(id, body) {
    const index = await this.index();
    const r = Screens.pick(index, id);
    if (!r) return refuse(404, 'There is no such screen. It may have been forgotten.');
    const name = cleanScreenName(body?.name);
    if (!name) return refuse(400, 'Give the screen a name.');
    r.name = name;
    await this.saveIndex(index);
    this.ring({ what: 'screen', id, at: new Date(this.now()).toISOString() });
    return { ok: true, body: { screen: this.view(r, this.liveScreens()) } };
  }

  /**
   * DELETE /v1/screens/<id>: forget it and its settings. A screen still
   * running says hello again within minutes and comes back with its own
   * settings, so this is for a screen that is gone.
   * @param {string} id
   * @returns {Promise<Result>}
   */
  async forget(id) {
    if (!isScreenId(id)) return refuse(404, 'There is no such screen.');
    const index = await this.index();
    const had = Boolean(Screens.pick(index, id));
    if (had) {
      delete index[id];
      await this.saveIndex(index);
    }
    await this.storage.delete(screenSettingsKey(id));
    return { ok: true, body: { forgotten: had } };
  }

  /**
   * POST /v1/screens/<id>/action {action, data?}: one of the kind's allowlisted
   * actions, rung on the live channel for that screen alone to act on.
   * `delivered` says whether the screen was on the channel to hear it.
   * @param {string} id
   * @param {any} body
   * @returns {Promise<Result>}
   */
  async act(id, body) {
    const r = Screens.pick(await this.index(), id);
    if (!r) return refuse(404, 'There is no such screen. It may have been forgotten.');
    const clean = sanitizeScreenAction(r.kind, body?.action, body?.data);
    if (!clean) return refuse(400, 'That is not something this screen can be asked to do.');
    this.ring({ what: 'screen-action', id, ...clean, at: new Date(this.now()).toISOString() });
    return { ok: true, body: { ok: true, delivered: this.liveScreens().has(id) } };
  }

  /** A stamp strictly after `prev`, so two quick saves still order. @param {string|undefined} prev */
  stampAfter(prev) {
    const p = prev ? Date.parse(prev) : 0;
    return new Date(Math.max(this.now(), (Number.isFinite(p) ? p : 0) + 1)).toISOString();
  }
}
