// @ts-check
// A notice to every screen (routes.md 10.4): the owner writes one line on the
// settings page ("Pickup is in the gym tonight"), every screen shows it for as
// long as the owner chose, and "Take it down" clears it.
//
// It rides the live channel as the contract's plaintext `notice` frame
// (church-authored copy, never child data; the screens' sanitizeNotice still
// checks every frame) with the additive optional `durationSec`: a screen hides
// it that long after it RECEIVED it; 0 takes it down; an older screen ignores
// the field (its 4 h ceiling as before).
//
// While the owner's notice is up, the check-in laptop's TwoTimTwo /msg/admin
// mirror (POST /v1/publish event 'notice') is dropped, so it never overwrites
// the owner's. A screen that connects late is handed the owner's notice with
// `durationSec` cut to the seconds left; an expired one is never replayed.
//
// STORAGE `notice:current` = {payload: {level, message, at, durationSec}, until, by}
// (the owner's notice; a laptop notice has none), beside the live channel's own
// replay copy `live:notice`.

import { plainText } from '../../lobby/shared/text.js';
import { Doc } from './doc.js';
import { fail, json } from './http.js';
import { frameText, replayKey } from './live.js';
import { changedSince, changedSinceRefusal } from './changes.js';

export const NOTICE_LEVELS = Object.freeze(['info', 'warn', 'critical']);
export const NOTICE_MESSAGE_MAX = 200;
export const NOTICE_MIN_MIN = 5;
export const NOTICE_MAX_MIN = 240;
/**
 * How far back a take-down frame's `at` is stamped. A screen that predates
 * `durationSec` ignores the field and ages a notice from its ARRIVAL unless its
 * `at` is more than CLOCK_SKEW_TOLERANCE_MS (2 h) behind its clock, then from
 * `at`, hiding it after NOTICE_MAX_AGE_MS (4 h). A take-down stamped `at: now`
 * (or with the original, still recent `at`) therefore SHOWED the notice for
 * another 4 h, and revived a laptop notice those screens had already dropped.
 * Stamped 7 h back (4 h ceiling + 2 h skew tolerance + 1 h spare), an old
 * screen reads it as stale and drops it even with its clock 2 h slow; a newer
 * screen takes it down on `durationSec: 0`. Pinned against the lobby's own
 * constants in test/notice.test.js.
 */
export const TAKEDOWN_AGE_MS = 7 * 60 * 60 * 1000;
const LIVE = replayKey('notice');

export class Notices {
  /** @param {{ storage: import('./sync.js').Store, now: () => number }} deps */
  constructor({ storage, now }) {
    this.storage = storage;
    this.now = now;
    this.doc = new Doc(storage, 'notice:current', () => null);
  }

  load() {
    return this.doc.load();
  }

  /** The owner's notice while it is up, else null (after load). */
  current() {
    const d = this.doc.data;
    return d && Date.parse(d.until) > this.now() ? d : null;
  }

  /** What the page shows: the notice, until and by, or null. */
  async view() {
    await this.load();
    const c = this.current();
    return c ? { ...c.payload, until: c.until, by: c.by } : null;
  }

  /**
   * The /v1/publish gate: a notice from anyone else while the owner's is up is
   * dropped. An expired owner's notice is forgotten here, so it can never hide
   * the laptop's later.
   * @param {string} event
   * @returns {Promise<Record<string, unknown>|null>} the answer instead of relaying, or null
   */
  async gate(event) {
    if (event !== 'notice') return null;
    await this.load();
    if (this.current()) return { ok: true, screens: 0, dropped: true, reason: 'owner-notice' };
    if (this.doc.data) await this.doc.drop();
    return null;
  }

  /**
   * The replay copy for a screen that connects now: the owner's notice with the
   * seconds left, nothing once it expired (both copies deleted), else the
   * laptop's frame as it was.
   * @param {string|undefined} text the stored live:notice frame
   * @returns {Promise<string|null>}
   */
  async replay(text) {
    await this.load();
    const d = this.doc.data;
    if (!d) return typeof text === 'string' ? text : null;
    const c = this.current();
    if (!c) {
      const owners = typeof text === 'string' && text === frameText('notice', d.payload);
      await this.doc.drop();
      if (owners) { await this.storage.delete(LIVE); return null; }
      return typeof text === 'string' ? text : null;
    }
    const left = Math.max(1, Math.ceil((Date.parse(c.until) - this.now()) / 1000));
    return frameText('notice', { ...c.payload, durationSec: Math.min(left, c.payload.durationSec) });
  }
}

/**
 * The routes (routes.md 10.4) and the `notice` undoer (undo = take it down).
 * @param {import('./registry.js').Registry} registry @param {any} core the SyncCore
 */
export function mountNotice(registry, core) {
  /** @type {Notices} */
  const notices = core.notices;
  const off = () => core.switches.value('NOTICES') === 'off';
  /** @param {any} p */
  const shown = (p) => (p ? { level: p.level, message: p.message, at: p.at } : null);

  /**
   * Take down whatever notice the screens hold (the owner's, or the laptop's
   * replayed one): the SAME text with durationSec 0 and an `at` no newer than
   * TAKEDOWN_AGE_MS ago (the original `at` when that is older still), so a
   * screen that ignores durationSec reads it as stale and drops it; then both
   * copies go.
   * @param {any} device @param {number} [undoOf]
   */
  const takeDown = async (device, undoOf) => {
    await notices.load();
    const owner = notices.doc.data;
    let payload = owner ? owner.payload : null;
    if (!payload) {
      const text = await core.storage.get(LIVE);
      try { payload = typeof text === 'string' ? JSON.parse(text).d : null; } catch { payload = null; }
    }
    if (!payload || typeof payload.message !== 'string') return { cleared: false, seq: null, screens: 0 };
    const was = typeof payload.at === 'number' ? payload.at : typeof payload.at === 'string' ? Date.parse(payload.at) : NaN;
    const stale = core.now() - TAKEDOWN_AGE_MS;
    const at = new Date(Number.isFinite(was) ? Math.min(was, stale) : stale).toISOString();
    const down = { level: payload.level, message: payload.message, at, durationSec: 0 };
    const screens = core.broadcast(frameText('notice', down));
    await core.storage.delete(LIVE);
    await notices.doc.drop();
    const seq = await core.logChange(null, { device, undoOf }, {
      what: 'notice', keys: ['notice'], before: { notice: shown(payload) }, after: { notice: null }, undoable: false,
    });
    return { cleared: true, seq, screens };
  };

  registry.add('GET', '/v1/notice', 'session', async () => json({ notice: await notices.view() }));

  registry.add('POST', '/v1/notice', 'session', async ({ body, request }) => {
    if (off()) return fail('Notices are switched off.', 503, { reason: 'notices-off' });
    const b = await body();
    if (!NOTICE_LEVELS.includes(b.level)) return fail('The level is info, warn or critical.', 400, { reason: 'bad-level' });
    const message = plainText(b.message, NOTICE_MESSAGE_MAX);
    if (!message) return fail('Write the notice first.', 400, { reason: 'no-message' });
    if (!Number.isInteger(b.durationMin) || b.durationMin < NOTICE_MIN_MIN || b.durationMin > NOTICE_MAX_MIN) {
      return fail(`How long is ${NOTICE_MIN_MIN} to ${NOTICE_MAX_MIN} minutes.`, 400, { reason: 'bad-duration' });
    }
    const device = await core.deviceOf(request);
    await notices.load();
    const t = core.now();
    const durationSec = b.durationMin * 60;
    const payload = { level: b.level, message, at: new Date(t).toISOString(), durationSec };
    const until = new Date(t + durationSec * 1000).toISOString();
    const before = notices.current();
    // One step: the replacing notice is the current one before anything is sent.
    notices.doc.data = { payload, until, by: device };
    await notices.doc.save();
    const screens = await core.relay('notice', payload);
    await core.logChange(null, { device }, {
      what: 'notice', keys: ['notice'], before: { notice: before ? shown(before.payload) : null }, after: { notice: shown(payload) },
    });
    return json({ ok: true, notice: payload, until, screens });
  });

  registry.add('DELETE', '/v1/notice', 'session', async ({ request }) => {
    const r = await takeDown(await core.deviceOf(request));
    return json({ ok: true, cleared: r.cleared });
  });

  core.undoers.notice = async (/** @type {{ entry: any, device: any, undoOf: number }} */ { entry, device, undoOf }) => {
    await notices.load();
    const c = notices.current();
    const moved = changedSince(entry, { notice: c ? shown(c.payload) : null });
    if (moved.length) return changedSinceRefusal(moved);
    const r = await takeDown(device, undoOf);
    return { ok: true, seq: r.seq };
  };
}
