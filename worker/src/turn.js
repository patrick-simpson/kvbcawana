// @ts-check
// The screen share's relay (owner 2026-11-08: a laptop on the church network "didn't
// connect. We got a black screen. That can't happen. Any way to make this work over the
// Web?"; picked: Cloudflare's relay). A shared screen goes laptop to TV by WebRTC; when
// the two cannot reach each other directly (the lobby computer's firewall, guest Wi-Fi,
// a laptop off-site) the picture goes through Cloudflare Realtime TURN instead. Both
// ends ask here for their ICE servers before the offer/answer (routes.md 10.18):
//   - always Cloudflare's free STUN (stun.cloudflare.com), no key;
//   - TURN credentials when the Worker secrets CF_TURN_KEY_ID and CF_TURN_API_TOKEN are
//     set: short-lived (TURN_TTL_S), made by Cloudflare's API from here, the API token
//     never leaves the Worker.
// FREE, always (CLAUDE.md "Costs"): Cloudflare gives 1,000 GB a month free (TURN and SFU
// together), $0.05/GB after. A share is capped at MAX_BITRATE 6 Mbps (shared/screenShare.js),
// at most ~2.7 GB an hour each way, so TURN_HOURS_PER_MONTH relay-hours (each share
// counts its whole TTL, twice for both ends) stays far under it. Past the cap a share
// gets STUN only and the pages say the relay is resting until next month.
// One set of credentials per share (its button id), kept in memory and handed to both
// ends, so a share costs its hours once; the month's count is stored (`turn:month`).

import { fail, json } from './http.js';

export const STUN_URL = 'stun:stun.cloudflare.com:3478';
export const TURN_TTL_S = 2 * 60 * 60;
/** Relay-hours a month (each share books TTL x 2 ends). 120 h x ~5.4 GB worst case < 1,000 GB. */
export const TURN_HOURS_PER_MONTH = 120;
const MONTH_KEY = 'turn:month';
const API = 'https://rtc.live.cloudflare.com/v1/turn/keys';

/**
 * Cloudflare's answer, cleaned: entries with stun:/turn:/turns: urls (never port 53,
 * which browsers block), a username and credential only for turn.
 * @param {unknown} v
 * @returns {{ urls: string[], username?: string, credential?: string }[]}
 */
export function cleanIceServers(v) {
  const list = Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : []);
  const out = [];
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    const raw = Array.isArray(s.urls) ? s.urls : [s.urls];
    const urls = raw.filter((u) => typeof u === 'string' && /^(stun|turns?):[^\s]{3,200}$/.test(u) && !/:53(\?|$)/.test(u));
    if (!urls.length) continue;
    const turn = urls.some((u) => u.startsWith('turn'));
    if (turn && (typeof s.username !== 'string' || typeof s.credential !== 'string')) continue;
    out.push(turn ? { urls, username: s.username.slice(0, 400), credential: s.credential.slice(0, 400) } : { urls });
  }
  return out.slice(0, 6);
}

export class Turn {
  /** @param {{ storage: any, now: () => number, env: () => Record<string, any>, fetchFn: typeof fetch }} deps */
  constructor({ storage, now, env, fetchFn }) {
    this.storage = storage;
    this.now = now;
    this.env = env;
    this.fetchFn = fetchFn;
    /** Credentials per share id, memory only. @type {Map<string, { at: number, servers: any[] }>} */
    this.byShare = new Map();
  }

  configured() {
    const e = this.env() || {};
    return Boolean(e.CF_TURN_KEY_ID && e.CF_TURN_API_TOKEN);
  }

  monthOf() { return new Date(this.now()).toISOString().slice(0, 7); }

  /** The ICE servers for one share (its button id). */
  async iceFor(/** @type {string} */ shareId) {
    const stun = { urls: [STUN_URL] };
    if (!this.configured()) return { iceServers: [stun], relay: false, reason: 'not-configured' };
    const t = this.now();
    const kept = this.byShare.get(shareId);
    if (kept && t - kept.at < (TURN_TTL_S - 600) * 1000) return { iceServers: [stun, ...kept.servers], relay: true };
    const month = this.monthOf();
    const doc = await this.storage.get(MONTH_KEY);
    const used = doc?.month === month ? Number(doc.hours) || 0 : 0;
    const cost = (TURN_TTL_S / 3600) * 2;
    if (used + cost > TURN_HOURS_PER_MONTH) return { iceServers: [stun], relay: false, reason: 'month-cap' };
    let servers;
    try {
      const e = this.env();
      const res = await this.fetchFn(`${API}/${encodeURIComponent(e.CF_TURN_KEY_ID)}/credentials/generate-ice-servers`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.CF_TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_S }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return { iceServers: [stun], relay: false, reason: 'cloudflare', status: res.status };
      const body = await res.json();
      servers = cleanIceServers(body?.iceServers).filter((s) => s.urls.some((u) => u.startsWith('turn')));
    } catch {
      return { iceServers: [stun], relay: false, reason: 'cloudflare' };
    }
    if (!servers.length) return { iceServers: [stun], relay: false, reason: 'cloudflare' };
    await this.storage.put(MONTH_KEY, { month, hours: used + cost });
    this.byShare.set(shareId, { at: t, servers });
    // Old shares' credentials expire anyway; keep the map small.
    for (const [id, v] of this.byShare) if (t - v.at > TURN_TTL_S * 1000) this.byShare.delete(id);
    return { iceServers: [stun, ...servers], relay: true };
  }

  /** GET .../ice?id= for a share that is up now (the room's rtc id). @param {string | null} id @param {{ id: string } | null} rtc */
  async answer(id, rtc) {
    if (!rtc || !id || rtc.id !== id) return fail('That screen share is not on the screen.', 409, { reason: 'ended' });
    return json({ ok: true, ...(await this.iceFor(id)) });
  }
}

/**
 * The routes (routes.md 10.18): the Cast presenter (token) and TV (session), and the
 * classroom's remote and TV (session), each for the share now up in its room.
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountTurn(registry, core) {
  const t = () => /** @type {Turn} */ (core.turn);
  registry.add('GET', '/v1/cast/screen/ice', 'session', async ({ url }) => t().answer(url.searchParams.get('id'), core.cast.engine.rtc));
  registry.add('GET', '/v1/cast/ice', 'public', async ({ url, request }) => {
    if (!(await core.cast.tokenOf(request))) return fail('This page is no longer connected to the TV. Type the code on the TV again.', 401, { reason: 'token' });
    return t().answer(url.searchParams.get('id'), core.cast.engine.rtc);
  });
  registry.add('GET', '/v1/classroom/ice', 'session', async ({ url }) => t().answer(url.searchParams.get('id'), core.classroom.rtc));
}
