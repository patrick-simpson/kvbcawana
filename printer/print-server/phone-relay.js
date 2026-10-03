// The laptop's half of the phone check-in relay (7.9.0). The phone page at
// awana.kvbchurch.org/checkin cannot reach this laptop, so it leaves its
// requests with the sync service; this loop collects them, runs each one
// against this print server's own phone API (the same calls a phone on the
// church Wi-Fi makes, from loopback, so the PIN gate is not in the way), and
// hands each answer back. See lobby/worker/src/relay.js for the other half.
//
// Only while this print server is signed in to the sync service. It asks every
// RELAY_IDLE_MS, and every RELAY_BUSY_MS while a phone has been asking (the
// service says so), so a check-in from a phone lands in a second or two
// without the laptop polling hard all week.
'use strict';

// The phone page's own calls, and nothing else: the same list as the
// service's RELAY_ROUTES (test-phone-relay.cjs pins the two equal).
const RELAY_ROUTES = Object.freeze([
  ['POST', /^\/phone\/roster$/],
  ['POST', /^\/phone\/tonight$/],
  ['POST', /^\/phone\/checkin$/],
  ['GET', /^\/phone\/status\/[0-9a-f-]{8,64}$/],
  ['POST', /^\/phone\/undo$/],
  ['POST', /^\/phone\/restore$/],
  ['POST', /^\/phone\/visitor$/],
  ['POST', /^\/print-leader$/],
  ['POST', /^\/print-custom$/],
  ['POST', /^\/leaders$/],
  ['POST', /^\/leaders\/forget$/],
  ['POST', /^\/clubs$/],
  ['POST', /^\/reconcile$/],
  ['POST', /^\/jam-reprint$/],
  ['GET', /^\/touch\/jam$/],
]);

function relayAllowed(method, path) {
  return typeof method === 'string' && typeof path === 'string'
    && RELAY_ROUTES.some(([m, re]) => m === method && re.test(path));
}

const RELAY_BUSY_MS = 1000;
const RELAY_IDLE_MS = 20 * 1000;
const RELAY_SIGNED_OUT_MS = 60 * 1000;
const LOCAL_TIMEOUT_MS = 60 * 1000;   // a Printer jammed reprint of a full minute can take this long

/**
 * One round: collect, run, answer. Never throws.
 * @param {{ base: string, session: string, localBase: string, syncRequest: Function, fetchFn?: typeof fetch, log?: Function }} o
 * @returns {Promise<{ ok: boolean, status: number, busy: boolean, handled: number }>}
 */
async function relayOnce(o) {
  const log = o.log || (() => {});
  const fetchFn = o.fetchFn || fetch;
  const next = await o.syncRequest(o.base, '/v1/relay/next', { session: o.session, fetchFn: o.fetchFn });
  if (!next.ok || !next.body) return { ok: false, status: next.status, busy: false, handled: 0 };
  const requests = Array.isArray(next.body.requests) ? next.body.requests : [];
  let handled = 0;
  for (const req of requests) {
    let status = 502;
    let body = { error: 'The check-in laptop could not run that.' };
    if (!req || typeof req.id !== 'string') continue;
    if (!relayAllowed(req.method, req.path)) {
      status = 403;
      body = { error: 'Not something the phone page may ask.' };
    } else {
      try {
        const res = await fetchFn(`${o.localBase}${req.path}`, {
          method: req.method,
          headers: req.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
          body: req.method === 'GET' ? undefined : JSON.stringify(req.body || {}),
          signal: AbortSignal.timeout(LOCAL_TIMEOUT_MS),
        });
        status = res.status;
        try { body = await res.json(); } catch { body = null; }
      } catch (e) {
        log(`[relay] ${req.method} ${req.path} failed here: ${e && e.message}`);
      }
    }
    await o.syncRequest(o.base, '/v1/relay/answer', { method: 'POST', session: o.session, body: { id: req.id, status, body }, fetchFn: o.fetchFn });
    handled++;
  }
  if (handled) log(`[relay] answered ${handled} phone request(s)`);
  return { ok: true, status: next.status, busy: !!next.body.busy || handled > 0, handled };
}

/**
 * The loop. `signedIn()` returns { base, session } while this print server is
 * signed in to the sync service, else null. Returns a stop function.
 */
function startPhoneRelay({ signedIn, localBase, syncRequest, fetchFn, log, setTimeoutFn = setTimeout }) {
  let stopped = false;
  let timer = null;
  const tick = async () => {
    if (stopped) return;
    let wait = RELAY_IDLE_MS;
    try {
      const s = signedIn();
      if (!s) wait = RELAY_SIGNED_OUT_MS;
      else {
        const r = await relayOnce({ base: s.base, session: s.session, localBase, syncRequest, fetchFn, log });
        wait = r.status === 401 ? RELAY_SIGNED_OUT_MS : (r.busy ? RELAY_BUSY_MS : RELAY_IDLE_MS);
      }
    } catch (e) {
      if (log) log(`[relay] ${e && e.message}`);
    }
    if (!stopped) timer = setTimeoutFn(tick, wait);
  };
  timer = setTimeoutFn(tick, 3000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}

module.exports = { RELAY_ROUTES, relayAllowed, relayOnce, startPhoneRelay, RELAY_BUSY_MS, RELAY_IDLE_MS };
