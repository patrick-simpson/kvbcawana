// @ts-check
// The sync service's wire protocol, in one place: how a client validates the
// service's address and a session, builds a request, signs in and reads the
// answer. DEPENDENCY-FREE on purpose (no imports, no DOM, no Node, no storage,
// no fetch): every client brings its own transport, its own storage
// (browser localStorage, Electron safeStorage, config.json) and its own
// offline cache, and calls these pure functions around them.
//
// CANONICAL COPY. Clients:
//   lobby/src/lib/syncService.js               imports this file (ES module)
//   printer/print-server/sync-protocol.js      GENERATED CommonJS copy of this
//       file (`node scripts/gen-sync-protocol.mjs`), checked by
//       scripts/check-mirrors.mjs. The print server, and through it the
//       Electron app's sign-in and its /settings row (electron-app/src/
//       sync-session.js, device-sync.js), load that copy at run time:
//       the packaged Windows app ships print-server/*.js as a resource and
//       has no lobby/ folder, and an ES module cannot be require()d there.
//
// Keep this file to top-level `export function` / `export const` declarations
// and plain JavaScript: the generator turns them into `exports` by a simple
// text transform, and refuses anything it cannot.
//
// Served by the Worker (lobby/worker/src/sync.js); what it answers is the
// contract these functions read, so change them together.

/**
 * The longest sync-service address a client accepts, in characters. ONE limit
 * for every client (the lobby's URL_MAX and the print server's literal 200
 * were already the same number; the stricter of any two would still be this
 * one). A real address (`https://awana-sync.<account>.workers.dev`,
 * `https://awana.kvbchurch.org/api`) is under 60.
 */
export const SYNC_URL_MAX = 200;

/** A session token: `v1.<epoch>.<issuedAt>.<signature>`. */
export const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;

/** A display key: 32 bytes as padded base64 (44 characters). */
export const DISPLAY_KEY_RE = /^[A-Za-z0-9+/]{43}=$/;

/** How long a client should wait for the service before calling it unreachable. */
export const SYNC_TIMEOUT_MS = 15000;

/**
 * https only, no query, fragment or credentials, at most SYNC_URL_MAX characters.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSyncUrl(value) {
  if (typeof value !== 'string' || !value || value.length > SYNC_URL_MAX) return false;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.search && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidSession(value) {
  return typeof value === 'string' && SESSION_RE.test(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isPlausibleDisplayKey(value) {
  return typeof value === 'string' && DISPLAY_KEY_RE.test(value.trim());
}

/**
 * Exactly what every screen and the service apply before comparing.
 * @param {unknown} p
 * @returns {string}
 */
export function normalizeSyncPassphrase(p) {
  return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
}

/**
 * Read the site's `shared/sync.json` ({url}). The service's address, '' for
 * "no service yet", or null when the file is unusable (the caller keeps the
 * address it already knew).
 * @param {unknown} body
 * @returns {string|null}
 */
export function parseSyncIndex(body) {
  const raw = body && typeof body === 'object' ? /** @type {any} */ (body).url : undefined;
  const url = typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';
  if (url === '') return '';
  return isValidSyncUrl(url) ? url : null;
}

/**
 * One request to the service, as the arguments a fetch takes. The caller adds
 * its own transport options (a timeout signal, `cache: 'no-store'`).
 * @param {string} base
 * @param {string} path
 * @param {{method?: string, body?: unknown, session?: string}} [opts]
 * @returns {{url: string, init: {method: string, headers: Record<string, string>, body: string|undefined}}}
 */
export function buildRequest(base, path, opts = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.session) headers.Authorization = `Bearer ${opts.session}`;
  return {
    url: `${base}${path}`,
    init: {
      method: opts.method || 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
  };
}

/**
 * Read a fetch Response into {ok, status, body}. Never throws; a body that is
 * not JSON is null.
 * @param {{ok: boolean, status: number, json: () => Promise<any>}} res
 * @returns {Promise<{ok: boolean, status: number, body: any}>}
 */
export async function readResponse(res) {
  /** @type {any} */
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { ok: res.ok, status: res.status, body };
}

/** What a client reports when the service could not be reached at all. */
export const UNREACHABLE = Object.freeze({ ok: false, status: 0, body: null });

/**
 * The body of POST /v1/login. `seedKey` is the display key the caller already
 * seals with; the service adopts it only if it has none yet.
 * @param {string} passphrase
 * @param {string} [seedKey]
 * @returns {{passphrase: string, seedKey?: string}}
 */
export function buildLoginBody(passphrase, seedKey) {
  /** @type {{passphrase: string, seedKey?: string}} */
  const body = { passphrase: normalizeSyncPassphrase(passphrase) };
  if (seedKey) body.seedKey = String(seedKey).trim();
  return body;
}

/**
 * Read the answer to POST /v1/login.
 * @param {{ok: boolean, status: number, body: any}} res
 * @param {{who?: string}} [opts] what to call this client in the words ("screen", "computer")
 * @returns {{ok: true, session: string, displayKey: string, state: any}
 *   | {ok: false, status: number, reason: 'unreachable'|'wrong'|'locked'|'not-set-up'|'rejected', message: string, triesLeft?: number, retryAfterSec?: number}}
 */
export function parseLoginResponse(res, opts = {}) {
  const who = opts.who || 'screen';
  if (res.status === 0) {
    return { ok: false, status: 0, reason: 'unreachable', message: `Could not reach the sync service. Check this ${who}'s internet connection.` };
  }
  if (res.status === 401) {
    const triesLeft = Number(res.body?.triesLeft);
    return { ok: false, status: 401, reason: 'wrong', message: 'That is not the passphrase.', ...(Number.isFinite(triesLeft) ? { triesLeft } : {}) };
  }
  if (res.status === 429) {
    return { ok: false, status: 429, reason: 'locked', message: 'Too many wrong tries. Wait a little, then try again.', retryAfterSec: Number(res.body?.retryAfterSec) || 900 };
  }
  if (res.status === 503) {
    return { ok: false, status: 503, reason: 'not-set-up', message: 'The sync service has no passphrase yet. Finish its setup (lobby/worker/README.md).' };
  }
  const b = res.body && typeof res.body === 'object' ? res.body : {};
  if (!res.ok || !isValidSession(b.session) || !isPlausibleDisplayKey(b.displayKey)) {
    return { ok: false, status: res.status, reason: 'rejected', message: typeof b.error === 'string' ? b.error : `The sync service answered HTTP ${res.status}.` };
  }
  return { ok: true, session: b.session, displayKey: b.displayKey.trim(), state: b.state || null };
}

/**
 * Is this session still good? 'ok' | 'signed-out' | 'unreachable', from the
 * answer to GET /v1/state.
 * @param {{ok: boolean, status: number}} res
 * @returns {'ok'|'signed-out'|'unreachable'}
 */
export function parseSessionCheck(res) {
  if (res.status === 401) return 'signed-out';
  return res.ok ? 'ok' : 'unreachable';
}

/**
 * The route and body that publish the shared settings or the slide deck.
 * @param {'settings'|'slides'} kind
 * @param {unknown} payload
 * @returns {{path: string, method: 'PUT', body: {settings: unknown} | {slides: unknown}}}
 */
export function publishRequest(kind, payload) {
  return {
    path: `/v1/${kind}`,
    method: 'PUT',
    body: kind === 'settings' ? { settings: payload } : { slides: payload },
  };
}

/** The screen registry's routes (a computer, a TV, the projector, Journey). */
export const SCREEN_HELLO_PATH = '/v1/screens/hello';
/** @param {string} id */
export function screenSettingsPath(id) {
  return `/v1/screens/${id}/settings`;
}
/** @param {string} id */
export function screenNamePath(id) {
  return `/v1/screens/${id}/name`;
}
