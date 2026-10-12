// The print server's half of the Awana sync service (the Cloudflare Worker in
// lobby/worker/). Request helpers, no state: server.js owns when they run and
// what is persisted. The PROTOCOL (address and session validation, request
// building, sign-in and answer parsing) lives in ./sync-protocol.js, a
// generated copy of lobby/shared/sync-protocol.js that the lobby's screens use
// too; this file adds only Node's fetch and its timeout.
//
// Owner, 2026-10-01: one passphrase ("kennebec") sets up every screen through
// the sync service, and that includes this computer. Signed in, the print
// server:
//   - seals check-ins with the service's display key (handing the service the
//     key it already had, on its very first sign-in, so screens set up before
//     keep reading names);
//   - stops rebroadcasting the lobby deck and the shared settings, and
//     forwards a publish made on this computer to the service, which is now
//     their one home.
// Check-ins never pass through the service.
//
// Where the service is: shared/sync.json on the display site, written by the
// root ci.yml's deploy. `url: ""` means "no service yet", and then nothing
// here changes how this server behaves.

'use strict';

const protocol = require('./sync-protocol');

const DEFAULT_SYNC_INDEX = 'https://awana.kvbchurch.org/lobby/shared/sync.json';
const { isValidSyncUrl, isValidSession, normalizeSyncPassphrase } = protocol;

function fetcher(fetchFn) {
  const f = fetchFn || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('fetch is not available in this Node');
  return f;
}

/**
 * The service's address, or '' for "none yet". null when the index could not
 * be read at all (offline): the caller keeps whatever it knew.
 */
async function resolveSyncUrl({ fetchFn, indexUrl = DEFAULT_SYNC_INDEX } = {}) {
  try {
    const res = await fetcher(fetchFn)(indexUrl, { signal: AbortSignal.timeout(protocol.SYNC_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) return null;
    return protocol.parseSyncIndex(await res.json());
  } catch {
    return null;
  }
}

/** One request. Never throws; status 0 means unreachable. */
async function syncRequest(base, path, { method, body, session, fetchFn } = {}) {
  const req = protocol.buildRequest(base, path, { method, body, session });
  try {
    const res = await fetcher(fetchFn)(req.url, { ...req.init, signal: AbortSignal.timeout(protocol.SYNC_TIMEOUT_MS) });
    return await protocol.readResponse(res);
  } catch {
    return { ...protocol.UNREACHABLE };
  }
}

/**
 * Sign in. `seedKey` is the display key this server already seals with; the
 * service adopts it only if it has none yet.
 * @returns {Promise<{ok: true, session: string, displayKey: string}
 *   | {ok: false, status: number, reason: string, error: string, triesLeft?: number, retryAfterSec?: number}>}
 */
async function syncLogin(base, passphrase, { seedKey, fetchFn } = {}) {
  const res = await syncRequest(base, '/v1/login', { method: 'POST', body: protocol.buildLoginBody(passphrase, seedKey), fetchFn });
  const r = protocol.parseLoginResponse(res, { who: 'computer' });
  if (r.ok) return { ok: true, session: r.session, displayKey: r.displayKey };
  const { message, ...rest } = r;
  return { ...rest, error: message };
}

/** Is this sign-in still good? 'ok' | 'signed-out' | 'unreachable'. */
async function syncCheck(base, session, { fetchFn } = {}) {
  return protocol.parseSessionCheck(await syncRequest(base, '/v1/state', { session, fetchFn }));
}

/** Forward a lobby deck or the shared settings to the service. */
async function syncPublish(base, session, kind, payload, { fetchFn } = {}) {
  const { path, method, body } = protocol.publishRequest(kind, payload);
  return syncRequest(base, path, { method, body, session, fetchFn });
}

module.exports = {
  DEFAULT_SYNC_INDEX,
  protocol,
  isValidSyncUrl,
  isValidSession,
  normalizeSyncPassphrase,
  resolveSyncUrl,
  syncRequest,
  syncLogin,
  syncCheck,
  syncPublish,
};
