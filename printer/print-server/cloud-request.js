// One request to the sync Worker's online check-in routes (worker/src/
// routes.md): the shared protocol's request building (sync-protocol.js) plus
// the `X-Station` header the station routes name the registered computer by.
// Never throws; status 0 means unreachable. Tests hand the modules that take
// a `request` their own stand-in with this same signature.
'use strict';

const protocol = require('./sync-protocol');

/**
 * @param {string} base the Worker's address
 * @param {string} path e.g. '/v1/print/lease'
 * @param {{ method?: string, body?: any, session?: string, station?: string, headers?: Record<string, string>, fetchFn?: typeof fetch }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, body: any }>}
 */
async function cloudRequest(base, path, { method, body, session, station, headers, fetchFn } = {}) {
  const req = protocol.buildRequest(base, path, { method, body, session });
  if (station) req.init.headers['X-Station'] = station;
  // Extra headers a route names (the greeting's `X-Job`); never a credential.
  if (headers) for (const [k, v] of Object.entries(headers)) req.init.headers[k] = String(v);
  try {
    const f = fetchFn || globalThis.fetch;
    const res = await f(req.url, { ...req.init, signal: AbortSignal.timeout(protocol.SYNC_TIMEOUT_MS) });
    return await protocol.readResponse(res);
  } catch {
    return { ...protocol.UNREACHABLE };
  }
}

module.exports = { cloudRequest };
