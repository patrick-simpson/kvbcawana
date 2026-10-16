// @ts-check
// The screen registry (ROADMAP.md#settings-page, phase 2; owner, 2026-10-11: "manage every
// screen from /settings"). Each lobby TV, projector and Journey kiosk says
// hello under an id it made once and keeps in its own storage, and the Worker
// keeps who it is and that screen's OWN settings, so awana.kvbchurch.org/settings
// can list the screens and change any one of them from any device.
//
// WHAT IT HOLDS
//   screens        one index, {[id]: {id, kind, name, createdAt, lastSeen,
//                  pending?, status?}}, `pending` only for a computer,
//                  `status` in its kind's own shape (below),
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
// A Journey kiosk has no live channel of its own (CLAUDE.md "room
// sync"), so ITS actions (the lesson-download buttons, src/routes.md 10.8)
// also wait here, in `screenq:<id>` {items: [{action, at}]}: at most
// SCREEN_ACTION_QUEUE_MAX, each dropped after SCREEN_ACTION_TTL_MS, and handed
// over in the kiosk's next hello's answer (`actions`), each one ONCE (the key
// is deleted as it is read). The doorbell still rings, so the kiosk's embedded
// Check-in Display (which does listen) can tell its host page to say hello at
// once; with no doorbell the next two-minute hello carries it.
//
// A KVBC Awana computer (kind 'computer', ROADMAP.md#kvbc-awana-one-app) never turns its
// print server off while a label is printing or waiting: it holds that change
// and says so in each hello as `pendingRoleChange` (the settings it is
// waiting to apply), which the list shows until a hello without one.
//
// Every screen's hello may carry `status` (src/routes.md 10.7), through
// sanitizeScreenStatus's one fixed shape for its kind: a Journey kiosk's saved
// lessons, a computer's app version and update, a lobby TV's or projector's
// page build. Another kind's status, or junk, is ignored. The newest is kept
// in memory for the list; storage takes it with the once-a-minute lastSeen
// write, or at once when it moved enough to matter (screenStatusMoved). A
// hello without one keeps the last.

import {
  SCREEN_ACTION_QUEUED_KINDS,
  SCREEN_ACTION_QUEUE_MAX,
  SCREEN_ACTION_TTL_MS,
  SCREEN_DEFAULT_NAMES,
  cleanScreenName,
  isScreenId,
  isScreenKind,
  sanitizeScreenAction,
  sanitizeScreenSettings,
  sanitizeScreenStatus,
  screenStatusMoved,
} from '../../lobby/src/lib/syncSpecs.js';

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
/** @param {string} id */
export const screenQueueKey = (id) => `screenq:${id}`;

/** @param {unknown} kind */
const queuesActions = (kind) => /** @type {readonly unknown[]} */ (SCREEN_ACTION_QUEUED_KINDS).includes(kind);

/**
 * The actions still worth doing, in the order they were asked: each through
 * the kind's allowlist again (a stored item is not trusted), none older than
 * SCREEN_ACTION_TTL_MS, at most SCREEN_ACTION_QUEUE_MAX. Pure.
 * @param {unknown} items @param {unknown} kind @param {number} now
 * @returns {{action: string, at: string}[]}
 */
export function freshActions(items, kind, now) {
  if (!Array.isArray(items)) return [];
  /** @type {{action: string, at: string}[]} */
  const out = [];
  for (const item of items) {
    const clean = sanitizeScreenAction(kind, item?.action);
    const t = typeof item?.at === 'string' ? Date.parse(item.at) : NaN;
    if (!clean || !Number.isFinite(t) || now - t > SCREEN_ACTION_TTL_MS || t - now > 60 * 1000) continue;
    out.push({ action: clean.action, at: new Date(t).toISOString() });
  }
  return out.slice(-SCREEN_ACTION_QUEUE_MAX);
}

/**
 * @typedef {{id: string, kind: import('../../lobby/src/lib/syncSpecs.js').ScreenKind, name: string, createdAt: string, lastSeen: number,
 *   pending?: Record<string, unknown>, status?: import('../../lobby/src/lib/syncSpecs.js').ScreenStatus}} ScreenRecord
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
    /** The newest status each screen reported, ahead of storage (at most one per known screen). @type {Map<string, NonNullable<ScreenRecord['status']>>} */
    this.fresh = new Map();
    /** Journey kiosks with a download command waiting in storage (memory: a restart forgets, the two-minute hello still collects). @type {Set<string>} */
    this.waiting = new Set();
    /** Told each index this object writes, after the write (journeyRemote.js keeps its kiosk list by it). @type {((index: Record<string, ScreenRecord>) => void)[]} */
    this.indexWatchers = [];
  }

  /**
   * Hear every index this object writes (saveIndex is the ONLY writer of the
   * `screens` key), so a reader polled every second or two keeps what it needs
   * in memory instead of reading the index each time.
   * @param {(index: Record<string, ScreenRecord>) => void} fn
   */
  onIndex(fn) {
    this.indexWatchers.push(fn);
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

  /** The one writer of the index; its watchers hear it once stored. @param {Record<string, ScreenRecord>} index */
  async saveIndex(index) {
    await this.storage.put(INDEX, index);
    for (const fn of this.indexWatchers) {
      try { fn(index); } catch (err) { console.error('[screens] an index watcher failed', err); }
    }
  }

  /** The record as /settings sees it. @param {ScreenRecord} r @param {Set<string>} live */
  view(r, live) {
    const onLive = live.has(r.id);
    const status = this.fresh.get(r.id) || r.status;
    return {
      id: r.id,
      kind: r.kind,
      name: r.name,
      createdAt: r.createdAt,
      lastSeen: new Date(r.lastSeen).toISOString(),
      live: onLive,
      online: onLive || this.now() - r.lastSeen <= ONLINE_MS,
      ...(r.pending ? { pendingRoleChange: r.pending } : {}),
      ...(status ? { status } : {}),
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
   * POST /v1/screens/hello {id, kind, name?, pendingRoleChange?, status?}: a screen says it is here. A new
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
    // Its report, in its kind's shape; none (or junk, or another kind's) keeps the last one.
    const status = sanitizeScreenStatus(kind, body.status);
    if (!r) {
      if (Object.keys(index).length >= SCREENS_MAX && !(await this.makeRoom(index))) {
        return refuse(409, 'The service already knows as many screens as it keeps. Forget an old one on the settings page.');
      }
      r = { id, kind, name: cleanScreenName(body.name) || SCREEN_DEFAULT_NAMES[kind], createdAt: new Date(t).toISOString(), lastSeen: t };
      if (pending) r.pending = pending;
      if (status) r.status = status;
      index[id] = r;
      await this.saveIndex(index);
    } else if (t - r.lastSeen >= SEEN_WRITE_MS || JSON.stringify(r.pending) !== JSON.stringify(pending)
      || (status && screenStatusMoved(r.status, status))) {
      r.lastSeen = t;
      if (pending) r.pending = pending;
      else delete r.pending;
      if (status) r.status = status;
      await this.saveIndex(index);
    }
    if (status) this.fresh.set(id, status);
    const answer = { screen: this.view({ ...r, lastSeen: t }, this.liveScreens()), settings: await this.settingsOf(id) };
    if (!queuesActions(kind)) return { ok: true, body: answer };
    // What /settings asked of it since its last hello: handed over once.
    const q = await this.storage.get(screenQueueKey(id));
    this.waiting.delete(id);
    if (q === undefined || q === null) return { ok: true, body: { ...answer, actions: [] } };
    await this.storage.delete(screenQueueKey(id));
    return { ok: true, body: { ...answer, actions: freshActions(q?.items, kind, t) } };
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
    this.fresh.delete(oldest.id);
    this.waiting.delete(oldest.id);
    await this.storage.delete(screenSettingsKey(oldest.id));
    await this.storage.delete(screenQueueKey(oldest.id));
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
    this.fresh.delete(id);
    this.waiting.delete(id);
    if (had) {
      delete index[id];
      await this.saveIndex(index);
    }
    await this.storage.delete(screenSettingsKey(id));
    await this.storage.delete(screenQueueKey(id));
    return { ok: true, body: { forgotten: had } };
  }

  /**
   * POST /v1/screens/<id>/action {action, data?}: one of the kind's allowlisted
   * actions, rung on the live channel for that screen alone to act on.
   * `delivered` says whether the screen was on the channel to hear it. A kind
   * without a live channel of its own (a Journey kiosk) gets it queued for its
   * next hello instead (`queued: true`); a full queue is refused (429).
   * @param {string} id
   * @param {any} body
   * @returns {Promise<Result>}
   */
  async act(id, body) {
    const r = Screens.pick(await this.index(), id);
    if (!r) return refuse(404, 'There is no such screen. It may have been forgotten.');
    const clean = sanitizeScreenAction(r.kind, body?.action, body?.data);
    if (!clean) return refuse(400, 'That is not something this screen can be asked to do.');
    const t = this.now();
    const at = new Date(t).toISOString();
    if (queuesActions(r.kind)) {
      const waiting = freshActions((await this.storage.get(screenQueueKey(id)))?.items, r.kind, t);
      if (waiting.length >= SCREEN_ACTION_QUEUE_MAX) {
        return refuse(429, `${r.name} has not picked up the last ${SCREEN_ACTION_QUEUE_MAX} requests yet. Give it a minute, then try again.`);
      }
      await this.storage.put(screenQueueKey(id), { items: [...waiting, { action: clean.action, at }] });
      this.waiting.add(id);
      this.ring({ what: 'screen-action', id, action: clean.action, at });
      return { ok: true, body: { ok: true, delivered: false, queued: true } };
    }
    this.ring({ what: 'screen-action', id, ...clean, at });
    return { ok: true, body: { ok: true, delivered: this.liveScreens().has(id) } };
  }

  /** A stamp strictly after `prev`, so two quick saves still order. @param {string|undefined} prev */
  stampAfter(prev) {
    const p = prev ? Date.parse(prev) : 0;
    return new Date(Math.max(this.now(), (Number.isFinite(p) ? p : 0) + 1)).toISOString();
  }
}
