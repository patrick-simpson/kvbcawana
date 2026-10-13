// @ts-check
// The Journey phone remote (owner 2026-10-13: "build a way to advance slides
// for Journey on a phone ... Doing it on the phone should advance the slide
// for all"; src/routes.md 10.9). A leader's phone (awana.kvbchurch.org/journey/remote/)
// presses Next, and EVERY Journey kiosk in the registry gets that one press.
//
// NOTHING HERE IS EVER WRITTEN TO STORAGE. A remote press is worthless after
// 20 seconds, and so is a report of what a screen shows, so both live in this
// object's memory only and a restart simply forgets them (the phone then sees
// "no report yet" for a second, and the kiosks are asked again). The free
// plan's storage writes are untouched: N kiosks pressed N times is N x N
// small entries in a Map, not a single put.
//
//   presses   per kiosk id, [{id, action, data?, at}]: at most
//             JOURNEY_REMOTE_QUEUE_MAX (the oldest goes first), each dropped
//             after JOURNEY_REMOTE_TTL_MS, handed over ONCE (removed as it is
//             handed over, so a lost reply loses the press, never repeats it)
//   reports   per kiosk id, its last `now` (sanitizeJourneyNow) stamped with
//             THIS clock's receipt time (a kiosk's clock may be off)
//   seen      per kiosk id, when it last asked (memory; never moves lastSeen)
//   watchAt   when a phone last read the state; kiosks report only while this
//             is under JOURNEY_REMOTE_WATCH_MS old (`watch` in their answers)
//   buckets   presses per phone sign-in (a token bucket, keyed by the
//             session's issue stamp and a 6-character tail of it; sessionKeyOf)
//
// A kiosk has no live channel of its own, so each press also rings the
// doorbell `changed {what: 'screen-action', id, action: 'remote'}` once per
// kiosk: its embedded Check-in Display passes that up (lobby/src/lib/embed.js
// hostDoorbell, which already passes this word for a kiosk id), and the kiosk
// asks POST /v1/screens/now within about a second. The same ring goes out when
// a phone starts watching, so the kiosks report at once.

import {
  JOURNEY_REMOTE_BURST,
  JOURNEY_REMOTE_QUEUE_MAX,
  JOURNEY_REMOTE_REFILL_PER_S,
  JOURNEY_REMOTE_TTL_MS,
  JOURNEY_REMOTE_WATCH_MS,
  isScreenId,
  sanitizeJourneyNow,
  sanitizeJourneyRemote,
} from '../../src/lib/syncSpecs.js';
import { ONLINE_MS, Screens } from './screens.js';
import { fail, json } from './http.js';

/** Sign-ins whose press counts are remembered (the oldest is forgotten past this). */
export const REMOTE_BUCKETS_MAX = 64;

/**
 * @typedef {{ id: string, action: string, data?: Record<string, unknown>, at: number }} Press
 * @typedef {{ tokens: number, t: number }} Bucket
 * @typedef {{ ok: true, body: any } | { ok: false, status: number, error: string, extra?: Record<string, unknown> }} Result
 */

/**
 * One press from a bucket: refilled at JOURNEY_REMOTE_REFILL_PER_S up to
 * JOURNEY_REMOTE_BURST since `bucket.t`. Pure.
 * @param {Bucket | undefined} bucket @param {number} now
 * @returns {{ ok: boolean, bucket: Bucket, retryMs: number }}
 */
export function takeToken(bucket, now) {
  const b = bucket || { tokens: JOURNEY_REMOTE_BURST, t: now };
  const tokens = Math.min(JOURNEY_REMOTE_BURST, b.tokens + (Math.max(0, now - b.t) / 1000) * JOURNEY_REMOTE_REFILL_PER_S);
  if (tokens >= 1) return { ok: true, bucket: { tokens: tokens - 1, t: now }, retryMs: 0 };
  return { ok: false, bucket: { tokens, t: now }, retryMs: Math.ceil(((1 - tokens) / JOURNEY_REMOTE_REFILL_PER_S) * 1000) };
}

/**
 * Which sign-in a request is, for counting presses: the session's
 * `epoch.issued` part plus the last 6 characters of its 43-character
 * signature (two phones signed in the same millisecond still count apart; 6
 * characters of an HMAC reveal nothing usable). Memory only, never stored or
 * logged. '' without one.
 * @param {Request} request
 */
export function sessionKeyOf(request) {
  const header = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+v1\.(\d+)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(header.trim());
  return m ? `${m[1]}.${m[2]}.${m[3].slice(-6)}` : '';
}

export class JourneyRemote {
  /**
   * @param {{ screens: Screens, now: () => number, ring: (payload: Record<string, unknown>) => void }} deps
   */
  constructor({ screens, now, ring }) {
    this.screens = screens;
    this.now = now;
    this.ring = ring;
    /** @type {Map<string, Press[]>} */
    this.presses = new Map();
    /** @type {Map<string, import('../../src/lib/syncSpecs.js').JourneyNow & { at: string }>} */
    this.reports = new Map();
    /** @type {Map<string, number>} */
    this.seen = new Map();
    /** @type {Map<string, Bucket>} */
    this.buckets = new Map();
    this.watchAt = 0;
    this.seq = 0;
  }

  /** Is a phone watching (it read the state within JOURNEY_REMOTE_WATCH_MS)? */
  watching() {
    return this.watchAt > 0 && this.now() - this.watchAt <= JOURNEY_REMOTE_WATCH_MS;
  }

  /** Every Journey kiosk in the registry, by name. @returns {Promise<import('./screens.js').ScreenRecord[]>} */
  async kiosks() {
    return Object.values(await this.screens.index())
      .filter((r) => r && r.kind === 'journey')
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** Seen by a hello (stored lastSeen) or a remote poll (memory) within ONLINE_MS. @param {import('./screens.js').ScreenRecord} r @param {number} t */
  online(r, t) {
    const polled = this.seen.get(r.id);
    return t - r.lastSeen <= ONLINE_MS || (polled !== undefined && t - polled <= ONLINE_MS);
  }

  /** A press id: unique in this object's life, url-safe. */
  pressId() {
    this.seq += 1;
    return `r${this.now().toString(36)}${this.seq.toString(36)}`;
  }

  /** The presses still worth doing for one kiosk (expired ones dropped). @param {string} id @param {number} t */
  fresh(id, t) {
    return (this.presses.get(id) || []).filter((p) => t - p.at <= JOURNEY_REMOTE_TTL_MS && p.at - t <= 1000);
  }

  /**
   * POST /v1/journey/remote {action, data?}: one press for EVERY Journey kiosk.
   * @param {string} who the sign-in (sessionKeyOf) @param {any} body
   * @returns {Promise<Result>}
   */
  async press(who, body) {
    const clean = sanitizeJourneyRemote(body?.action, body?.data);
    if (!clean) return { ok: false, status: 400, error: 'That is not something the phone remote can ask.' };
    const t = this.now();
    const taken = takeToken(this.buckets.get(who), t);
    this.buckets.delete(who); // re-inserted last: the Map's order is oldest-used first
    this.buckets.set(who, taken.bucket);
    while (this.buckets.size > REMOTE_BUCKETS_MAX) this.buckets.delete(/** @type {string} */ (this.buckets.keys().next().value));
    if (!taken.ok) {
      return { ok: false, status: 429, error: 'Too many presses at once. Wait a moment.', extra: { retryAfterMs: taken.retryMs } };
    }
    const kiosks = await this.kiosks();
    if (!kiosks.length) return { ok: false, status: 409, error: 'No Journey screen has signed in yet.', extra: { reason: 'no-kiosks' } };
    const id = this.pressId();
    /** @type {Press} */
    const item = { id, action: clean.action, ...(clean.data ? { data: clean.data } : {}), at: t };
    const at = new Date(t).toISOString();
    for (const k of kiosks) {
      const queue = [...this.fresh(k.id, t), item].slice(-JOURNEY_REMOTE_QUEUE_MAX);
      this.presses.set(k.id, queue);
      this.ring({ what: 'screen-action', id: k.id, action: 'remote', at });
    }
    return { ok: true, body: { ok: true, id, kiosks: kiosks.length, online: kiosks.filter((k) => this.online(k, t)).length } };
  }

  /**
   * What waits for one kiosk, each press ONCE (taken out as it is handed over).
   * @param {string} id
   * @returns {{ id: string, action: string, data?: Record<string, unknown>, at: string }[]}
   */
  take(id) {
    const t = this.now();
    const list = this.fresh(id, t);
    this.presses.delete(id);
    return list.map((p) => ({ id: p.id, action: p.action, ...(p.data ? { data: p.data } : {}), at: new Date(p.at).toISOString() }));
  }

  /**
   * POST /v1/screens/now {id, now?}: a kiosk collects its presses and, while a
   * phone watches, says what its screen shows. `hello: true` when /settings
   * queued a download command for it (it says hello for those).
   * @param {any} body
   * @returns {Promise<Result>}
   */
  async kioskPoll(body) {
    const id = body?.id;
    if (!isScreenId(id)) return { ok: false, status: 400, error: 'That screen id is not right.' };
    const r = Screens.pick(await this.screens.index(), id);
    if (!r || r.kind !== 'journey') return { ok: false, status: 404, error: 'There is no such Journey screen. It may have been forgotten.' };
    const t = this.now();
    this.seen.set(id, t);
    if (body.now !== undefined) {
      const now = sanitizeJourneyNow(body.now);
      if (now) this.reports.set(id, { ...now, at: new Date(t).toISOString() });
    }
    return { ok: true, body: { actions: this.take(id), watch: this.watching(), hello: this.screens.waiting.has(id) } };
  }

  /** A hello from a Journey kiosk also hands over its presses and the watch flag. @param {string} id */
  helloExtras(id) {
    this.seen.set(id, this.now());
    return { remote: this.take(id), watch: this.watching() };
  }

  /**
   * GET /v1/journey/remote/state: every Journey kiosk with what it last said
   * it shows, and how many are online. Reading it is what "watching" means:
   * the first read after a quiet spell rings every kiosk so they report now.
   * @returns {Promise<Result>}
   */
  async state() {
    const t = this.now();
    const was = this.watching();
    this.watchAt = t;
    const kiosks = await this.kiosks();
    if (!was) for (const k of kiosks) this.ring({ what: 'screen-action', id: k.id, action: 'remote-watch', at: new Date(t).toISOString() });
    const list = kiosks.map((k) => ({ id: k.id, name: k.name, online: this.online(k, t), now: this.reports.get(k.id) || null }));
    return { ok: true, body: { kiosks: list, online: list.filter((k) => k.online).length, serverNow: new Date(t).toISOString(), watchMs: JOURNEY_REMOTE_WATCH_MS } };
  }

  /** A forgotten screen leaves nothing behind. @param {string} id */
  forget(id) {
    this.presses.delete(id);
    this.reports.delete(id);
    this.seen.delete(id);
  }
}

/**
 * The phone's two routes (src/routes.md 10.9), both behind a session. The
 * kiosk's own poll is POST /v1/screens/now, in the screen routes (sync.js).
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountJourneyRemote(registry, core) {
  /** @param {Result} res */
  const answer = (res) => (res.ok ? json(res.body) : fail(res.error, res.status, res.extra || {}));
  registry.add('POST', '/v1/journey/remote', 'session', async ({ request, body }) => answer(await core.journeyRemote.press(sessionKeyOf(request), await body())));
  registry.add('GET', '/v1/journey/remote/state', 'session', async () => answer(await core.journeyRemote.state()));
}
