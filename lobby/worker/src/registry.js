// The route registry. A module that owns routes adds them here with ONE line
// in SyncCore's constructor (`mountXxx(this.registry, this)`), and sync.js
// stays the one place that checks the session and the station. That is how the
// print role (P2), the desk page (P3) and history (P6) add their routes
// without editing each other's code.
//
//   registry.add('GET', '/v1/stations', 'session', async (ctx) => json(...));
//
// Auth levels (routes.md "Rules every route keeps"):
//   public    no session
//   session   Authorization: Bearer <session>
//   station   a session plus X-Station: <stationId> naming a registered station
//
// A pattern is a path with `:name` segments (`/v1/stations/:id`); each matches
// one path segment and arrives in ctx.params. A method + pattern may be added
// once: a second add of the same pair throws, so two modules cannot silently
// claim one route.
//
// A handler gets ctx = { core, request, url, params, ip, stationId, body }:
// `body()` reads the JSON object (BODY_MAX, 400 on anything unreadable) and a
// thrown BadRequest answers 400. It returns a Response (json() / fail()).

/** @typedef {'public'|'session'|'station'} Auth */
/**
 * @typedef {{ core: any, request: Request, url: URL, params: Record<string, string>, ip: string,
 *   stationId: string|null, body: () => Promise<Record<string, any>> }} RouteContext
 */

const AUTH = ['public', 'session', 'station'];

export class Registry {
  constructor() {
    /** @type {{ method: string, pattern: string, auth: Auth, re: RegExp, names: string[], handler: (ctx: RouteContext) => Promise<Response> }[]} */
    this.routes = [];
  }

  /**
   * @param {string} method @param {string} pattern @param {Auth} auth
   * @param {(ctx: RouteContext) => Promise<Response>} handler
   */
  add(method, pattern, auth, handler) {
    if (!AUTH.includes(auth)) throw new Error(`route ${method} ${pattern}: unknown auth "${auth}"`);
    if (!pattern.startsWith('/v1/')) throw new Error(`route ${method} ${pattern}: a route lives under /v1/`);
    if (this.routes.some((r) => r.method === method && r.pattern === pattern)) {
      throw new Error(`route ${method} ${pattern} is already registered`);
    }
    /** @type {string[]} */
    const names = [];
    const re = new RegExp(`^${pattern.split('/').map((seg) => {
      if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }).join('/')}$`);
    this.routes.push({ method, pattern, auth, re, names, handler });
  }

  /** @param {string} method @param {string} path */
  match(method, path) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.re.exec(path);
      if (!m) continue;
      /** @type {Record<string, string>} */
      const params = {};
      try {
        route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      } catch {
        return null;   // a malformed %-escape is no route
      }
      return { route, params };
    }
    return null;
  }

  /** Every route as `METHOD pattern auth`, for the docs test. */
  list() {
    return this.routes.map((r) => `${r.method} ${r.pattern} ${r.auth}`);
  }
}
