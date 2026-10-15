// The wake-up call (9.5.0, owner 2026-10-15: "add the instant wake-up call").
// A print station keeps one socket open to the check-in service's live channel
// (`/v1/live?session=...&station=<id>`, the same channel the lobby TVs use).
// The service rings it (`{e: 'changed', d: {what: 'print'}}`) the moment a
// label is ready, and the job puller asks for it at once instead of at its
// next poll (5 s when idle). The poll stays: a socket that drops, never opens
// or misses a ring only costs those seconds, never a label.
//
// The socket carries no names and takes nothing but the ring; the session is
// the station's own sign-in, as every other station call. A keep-alive "ping"
// every PING_MS is answered at the service's edge; nothing heard for
// SILENT_MS (two pings and a margin) means a half-open socket: closed and
// opened again, with a back-off from RETRY_MIN_MS to RETRY_MAX_MS.
'use strict';

const PING_MS = 25 * 1000;
const SILENT_MS = 70 * 1000;
const RETRY_MIN_MS = 2 * 1000;
const RETRY_MAX_MS = 60 * 1000;
const SIGNED_OUT_MS = 30 * 1000;

/** The live channel's address for this station. @param {string} base the sync URL @param {string} session @param {string} stationId */
function wakeUrl(base, session, stationId) {
  const root = String(base || '').replace(/\/+$/, '').replace(/^http(s?):\/\//i, (m, s) => `ws${s}://`);
  return `${root}/v1/live?session=${encodeURIComponent(session)}&station=${encodeURIComponent(stationId)}`;
}

/** Is this socket message the ring? @param {unknown} data */
function isWake(data) {
  if (typeof data !== 'string' || data === 'pong') return false;
  try {
    const f = JSON.parse(data);
    return !!f && f.e === 'changed' && !!f.d && f.d.what === 'print';
  } catch { return false; }
}

/**
 * @param {{ signedIn: () => ({ base: string, session: string } | null), stationId: () => string,
 *   onWake: () => void, log?: (m: string) => void, WebSocketImpl?: any,
 *   setTimeoutFn?: typeof setTimeout, clearTimeoutFn?: typeof clearTimeout, now?: () => number }} o
 */
function startStationWake(o) {
  const WS = o.WebSocketImpl || globalThis.WebSocket;
  const setT = o.setTimeoutFn || setTimeout;
  const clearT = o.clearTimeoutFn || clearTimeout;
  const now = o.now || Date.now;
  const log = o.log || (() => {});
  let stopped = false;
  let ws = null;
  let retryTimer = null;
  let pingTimer = null;
  let retryMs = RETRY_MIN_MS;
  let lastRx = 0;
  const stats = { open: false, rings: 0, opens: 0 };
  if (typeof WS !== 'function') {
    log('[jobs] no WebSocket here: labels come with the 5 s poll');
    return { stop() {}, status: () => ({ ...stats, supported: false }) };
  }
  const unref = (t) => { if (t && t.unref) t.unref(); return t; };
  const later = (ms) => { if (!stopped) retryTimer = unref(setT(connect, ms)); };
  const drop = (sock) => {
    if (ws !== sock) return;
    ws = null;
    stats.open = false;
    if (pingTimer) { clearT(pingTimer); pingTimer = null; }
    try { sock.close(); } catch { /* already closed */ }
    later(retryMs);
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
  };
  const keepAlive = (sock) => {
    pingTimer = unref(setT(() => {
      if (ws !== sock) return;
      if (now() - lastRx > SILENT_MS) { log('[jobs] the wake-up socket went quiet; opening it again'); drop(sock); return; }
      try { sock.send('ping'); } catch { drop(sock); return; }
      keepAlive(sock);
    }, PING_MS));
  };
  function connect() {
    retryTimer = null;
    if (stopped || ws) return;
    const where = o.signedIn();
    if (!where || !where.base || !where.session) { later(SIGNED_OUT_MS); return; }
    let sock;
    try { sock = new WS(wakeUrl(where.base, where.session, o.stationId())); } catch (e) { log(`[jobs] wake-up socket: ${e && e.message}`); later(retryMs); return; }
    ws = sock;
    lastRx = now();
    sock.onopen = () => { if (ws !== sock) return; stats.open = true; stats.opens += 1; retryMs = RETRY_MIN_MS; lastRx = now(); keepAlive(sock); };
    sock.onmessage = (ev) => {
      if (ws !== sock) return;
      lastRx = now();
      if (isWake(ev && ev.data)) { stats.rings += 1; try { o.onWake(); } catch (e) { log(`[jobs] wake-up: ${e && e.message}`); } }
    };
    sock.onclose = () => drop(sock);
    sock.onerror = () => drop(sock);
  }
  connect();
  return {
    stop() {
      stopped = true;
      if (retryTimer) clearT(retryTimer);
      if (pingTimer) clearT(pingTimer);
      const s = ws; ws = null;
      if (s) { try { s.close(); } catch { /* already closed */ } }
    },
    status: () => ({ ...stats, supported: true }),
  };
}

module.exports = { startStationWake, wakeUrl, isWake, PING_MS, SILENT_MS, RETRY_MIN_MS, RETRY_MAX_MS };
