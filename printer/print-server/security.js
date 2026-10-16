'use strict';

// ── Security policy for the print server ──────────────────────────────────────
//
// This module is the ONE place the server's trust model lives. It is pure —
// no I/O, no Express, no timers — so scripts/test-server-helpers.cjs can
// exercise every rule directly.
//
// THE TRUST MODEL, in one sentence: the loopback interface is trusted, and
// nothing else is: not the LAN, not the open internet.
//
//   • Loopback (127.0.0.1 / ::1) — trusted. This is the KVBC Awana app's
//     windows and its own loops (the station's job puller posting the jobs it
//     leased to its own routes). No credential is required; these callers
//     already run as the volunteer on the volunteer's own machine.
//
//   • The LAN — not served. Online only (owner, 2026-10-11): the Wi-Fi phone
//     page and its PIN are gone, the server binds 127.0.0.1 and refuses any
//     non-loopback socket. Phones use awana.kvbchurch.org/checkin.
//
//   • Any web page the volunteer has open — untrusted. It shares the loopback
//     interface with the app, so the socket address cannot tell them apart;
//     the Origin header is what distinguishes them. Hence
//     the origin allowlist below, applied to reads AND writes. The one public
//     page that may reach this server is awana.kvbchurch.org/settings, through
//     SETTINGS_PAGE_ROUTES below.
//
// Why this shape: before v5.3.0 the server bound 0.0.0.0 with `cors()` wide
// open and no authentication on the roster endpoints, so a child's name and
// allergy list were readable by anyone on the venue network and by any
// website open in the volunteer's browser.

const crypto = require('crypto');
// The text cleaner every trust-boundary caller shares (shared/text.js,
// through its generated copy).
const { isControlCharCode, stripControlChars, cleanText } = require('./textClean');

// ── Control characters ────────────────────────────────────────────────────────
// isControlCharCode and stripControlChars are textClean.js's (char-code checks
// rather than regex escapes: a mangled \x1f in a character class fails
// silently in the direction of accepting too much).

function hasControlChars(value) {
  const s = String(value == null ? '' : value);
  for (let i = 0; i < s.length; i++) {
    if (isControlCharCode(s.charCodeAt(i))) return true;
  }
  return false;
}

// ── Loopback detection ────────────────────────────────────────────────────────
// Deliberately reads the raw socket address and NEVER X-Forwarded-For or
// req.ip: a forwarded header is attacker-supplied, and treating it as the peer
// address would let any LAN caller claim to be loopback and be trusted. If
// this server is ever put behind a real proxy, that proxy has to be modelled
// explicitly — not inferred from a header.

const LOOPBACK_RE = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;

function isLoopbackAddress(addr) {
  if (!addr) return false;
  // Node hands back IPv6-mapped IPv4 ("::ffff:127.0.0.1") on dual-stack binds,
  // and may append a zone id ("::1%lo0").
  const s = String(addr).trim().split('%')[0];
  return LOOPBACK_RE.test(s);
}

function isLoopbackRequest(req) {
  const sock = req && req.socket;
  return isLoopbackAddress(sock && sock.remoteAddress);
}

// ── Origin allowlist ──────────────────────────────────────────────────────────
// Replaces `app.use(cors())`. That set `Access-Control-Allow-Origin: *`, which
// let ANY website the volunteer had open read the response body of
// /stats/tonight — names plus allergy tokens — with a single fetch().
//
// Allowed origins, and why each is needed:
//   (Until 10.0.0 also chrome-extension://…, moz-extension://… and
//   https://*.twotimtwo.com, for the Chrome extension's options page and its
//   content script. The extension is gone; so are they: no extension and no
//   TwoTimTwo page may read this server's roster or write to it any more.)
//   • http://<loopback-or-private-host>:<our port>   a page this server
//                               itself serves (the tiny GET / page; the
//                               dashboard and Wi-Fi phone page are retired).
//                               Same-origin fetches need no CORS header, but
//                               browsers do send Origin on them and the
//                               mutating-request check below inspects it.
//   • anything in config.allowedOrigins (validated, opt-in)

// A host that is this computer (Online only: the server listens on loopback and
// serves no page to the LAN, so only a loopback host on our port is "our own
// page"; a private LAN address on port 3456 is somebody else's server).
function isLoopbackHostname(hostname) {
  if (!hostname) return false;
  const h = String(hostname).toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  return h === 'localhost' || h.endsWith('.localhost') || isLoopbackAddress(h);
}

// `extraOrigins` are exact, case-insensitive origin strings (nothing passes
// any since Online only: config.allowedOrigins is no longer read). Wildcards
// are NOT accepted: one pasted "*" would silently restore the hole this
// function exists to close.
function isAllowedOrigin(origin, opts) {
  if (!origin || typeof origin !== 'string') return false;
  const { port = 3456, extraOrigins = [] } = opts || {};
  const o = origin.trim();
  if (!o || o === 'null') return false;                // sandboxed iframe / file://

  let url;
  try { url = new URL(o); } catch { return false; }

  // Our own pages. Requires BOTH our port and a loopback host, so a hostile
  // site merely served on port 3456 (or a LAN machine's) does not qualify — the
  // old `origin.endsWith(':3456')` check accepted http://evil.example:3456.
  if (url.protocol === 'http:' && String(url.port) === String(port) && isLoopbackHostname(url.hostname)) {
    return true;
  }

  const normalized = `${url.protocol}//${url.host}`.toLowerCase();
  return extraOrigins.some((e) => {
    if (typeof e !== 'string' || e.includes('*')) return false;
    let candidate;
    try { candidate = new URL(e.trim()); } catch { return false; }
    return `${candidate.protocol}//${candidate.host}`.toLowerCase() === normalized;
  });
}

// Exact-match origin check for narrowly-scoped route exceptions (the lobby
// slides publish endpoint admits the display app's own https origin, nothing
// else). Deliberately NOT isAllowedOrigin: that list grants roster reads, and
// widening it for one route would widen it for every route. No wildcards, and
// the browser-facing rule stays "exact origin or nothing".
function isExactAllowedOrigin(origin, origins) {
  if (!origin || typeof origin !== 'string' || !Array.isArray(origins)) return false;
  let url;
  try { url = new URL(origin.trim()); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const normalized = `${url.protocol}//${url.host}`.toLowerCase();
  return origins.some((e) => {
    if (typeof e !== 'string' || e.includes('*') || hasControlChars(e)) return false;
    let candidate;
    try { candidate = new URL(e.trim()); } catch { return false; }
    return `${candidate.protocol}//${candidate.host}`.toLowerCase() === normalized;
  });
}

// ── The settings page (awana.kvbchurch.org/settings) ──────────────────────────
// Owner, 2026-10-11: the print dashboard's settings and tools live on the one
// settings page (the dashboard is retired), opened in the laptop's own
// browser, which reaches this server on
// http://localhost (an https page may call it). That is a PUBLIC https origin
// talking to a loopback server, so the rule is the slides publish's, widened by
// as little as it can be:
//   • ONE exact origin (never churchConfig.displayOrigins, which still names the
//     archived github.io site, and never a wildcard);
//   • a short table of paths and methods, not "the whole server";
//   • every path but /health needs the page's sync sign-in (confirmed with the
//     sync service) or a publish token already on the laptop, AND a loopback
//     socket;
//   • POST /config takes only the printer's own keys: nothing that holds a
//     secret, opens the network or widens CORS can be changed from the page.
// No key or token is ever read, minted or set by the page: those routes are
// not in the table, and only this computer's own app (no Origin, loopback)
// reaches them.
const SETTINGS_PAGE_ORIGIN = 'https://awana.kvbchurch.org';

// `open` routes answer without the token: the page probes /health to learn
// whether this is the check-in laptop at all (it holds no names; the check-in
// site's own scripts already read it).
const SETTINGS_PAGE_ROUTES = {
  '/health': { methods: ['GET'], open: true },
  '/printers': { methods: ['GET'] },
  '/config': { methods: ['GET', 'POST'] },
  '/config/label-templates': { methods: ['GET', 'POST'] },
  '/config/schedule': { methods: ['GET', 'POST'] },
  '/clubs': { methods: ['GET'] },
  '/history/today': { methods: ['GET'] },
  '/reprint': { methods: ['POST'] },
  '/diagnostics': { methods: ['GET'] },
  '/failures': { methods: ['GET'] },
  '/preview': { methods: ['GET'] },
  '/canary': { methods: ['POST'] },
  '/printer/clear-queue': { methods: ['POST'] },
  '/play-tune': { methods: ['POST'] },
  // The tools that moved here when the print dashboard was retired (Online
  // only, 2026-10-12). The label ones print on this computer's printer;
  // rehearsal arms a TEST night (2 hours at most); sync-login signs THIS computer in again to
  // the service it already uses (server.js never takes an address from the
  // page). Never here: the display key, the publish token, the display login
  // and sync-logout, which mint, read or drop a secret.
  '/leaders': { methods: ['GET'] },
  '/leaders/forget': { methods: ['POST'] },
  '/print-leader': { methods: ['POST'] },
  '/print-oneoff': { methods: ['POST'] },
  '/print-custom': { methods: ['POST'] },
  '/reprint-range': { methods: ['POST'] },
  '/rehearsal': { methods: ['POST'] },
  '/config/sync-login': { methods: ['POST'] },
  // Online check-in, P2: this computer as a print station. The status shows
  // the print jobs' outcome (and CHECK THE PRINTER); clear says the printer
  // was looked at; the import seals this laptop's history once and posts it.
  // None of them returns or takes a key.
  '/cloud/print-status': { methods: ['GET'] },
  '/cloud/print-status/clear': { methods: ['POST'] },
  '/cloud/import-history': { methods: ['POST'] },
};

const SETTINGS_PAGE_CONFIG_KEYS = [
  'printerName', 'backupPrinterName', 'cupsMedia', 'pickupClubs',
  'labelFooter', 'lateGraceMin', 'seasonTheme', 'firstTimerInverted', 'trophyBand',
  'connectCard', 'connectCardAutoFirstTimer', 'connectCardGreeting', 'musicalPrinter',
  'updateBeacon', 'enableDrivenCheckin',
];

// The route this origin may use for `method` on `pathname`, or null. `method`
// is the one the page asked for: a preflight names it in
// Access-Control-Request-Method, so the caller passes that for OPTIONS.
function settingsPageRoute(origin, pathname, method) {
  if (!isExactAllowedOrigin(origin, [SETTINGS_PAGE_ORIGIN])) return null;
  if (!Object.prototype.hasOwnProperty.call(SETTINGS_PAGE_ROUTES, pathname)) return null;
  const route = SETTINGS_PAGE_ROUTES[pathname];
  const m = String(method || 'GET').toUpperCase();
  return route.methods.includes(m) ? route : null;
}

// The keys of a POST /config body the settings page may not set (empty means
// the body is fine). A body that is not a plain object has nothing to allow.
function settingsPageConfigRefusals(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return ['(body)'];
  return Object.keys(body).filter((k) => !SETTINGS_PAGE_CONFIG_KEYS.includes(k));
}

function sanitizeAllowedOrigins(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && !v.includes('*') && !hasControlChars(v))
    .map((v) => v.trim())
    .filter((v) => {
      try {
        const u = new URL(v);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch { return false; }
    })
    .slice(0, 10);
}

// ── Cross-origin writes ───────────────────────────────────────────────────────
// A cross-origin fetch with Content-Type: application/json is preflighted, and
// a strict allowlist already fails that preflight. But a form POST (text/plain,
// no preflight) still reaches the handler, and the old code's own comment
// acknowledged that "any page the volunteer has open can POST here" — which is
// how a crafted child name could get into print-history.json and from there
// into the dashboard's innerHTML. So a mutating request carrying a
// non-allowlisted Origin is refused outright. A request with NO Origin (curl,
// the Electron shell, a same-origin navigation) is unaffected.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isMutatingMethod(method) {
  return MUTATING_METHODS.has(String(method || '').toUpperCase());
}

// ── Constant-time compare ─────────────────────────────────────────────────────
// For the publish token: a constant-time compare, so response timing does not
// leak its prefix.

function timingSafeStringEqual(a, b) {
  const ab = Buffer.from(String(a == null ? '' : a), 'utf8');
  const bb = Buffer.from(String(b == null ? '' : b), 'utf8');
  if (ab.length !== bb.length) {
    // Compare something of equal length anyway so the mismatched-length path is
    // not measurably faster than the mismatched-content path.
    crypto.timingSafeEqual(ab, ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// ── Outbound URL validation ───────────────────────────────────────────────────
// config.checkinUrl reaches shell.openExternal() in the Electron shell, and POST /config accepted it from any
// caller with no validation at all — so a poisoned config turned into an
// arbitrary URI handed to the Windows shell. Only http(s) is ever legitimate
// here (it is a check-in web page).
function isSafeExternalUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > 2048) return false;
  if (hasControlChars(s)) return false;
  let url;
  try { url = new URL(s); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;      // no credentials-in-URL
  return true;
}

// ── Stored field hygiene ──────────────────────────────────────────────────────
// Names arrive from the request body and are persisted to print-history.json,
// which the settings page renders. The pages escape on output (that is the
// actual fix for the stored-XSS chain); this caps length and strips control
// characters so an unbounded or terminal-escape-laden value cannot bloat the
// history file or mangle a console log. It deliberately does NOT strip angle
// brackets — silently corrupting a child's name is worse than escaping it at
// the point of display, which is where correctness belongs.
const STORED_NAME_MAX = 80;

function sanitizeStoredText(value, max) {
  const limit = Number.isFinite(max) ? max : STORED_NAME_MAX;
  return cleanText(value, limit, { coerce: true, control: ' ' });
}

// ── History retention ─────────────────────────────────────────────────────────
// MAX_HISTORY bounds the row COUNT but not the age, so a quiet church kept
// every child's name and check-in time indefinitely. Prune by age too: the
// dashboard only ever shows today, and tonight's stats only need today.
const DEFAULT_HISTORY_RETENTION_DAYS = 60;

function normalizeRetentionDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_RETENTION_DAYS;
  return Math.max(1, Math.min(730, Math.round(n)));
}

function pruneHistoryByAge(history, retentionDays, now) {
  if (!Array.isArray(history)) return [];
  const days = normalizeRetentionDays(retentionDays);
  const cutoff = (typeof now === 'number' ? now : Date.now()) - days * 24 * 60 * 60 * 1000;
  return history.filter((e) => {
    if (!e || !e.timestamp) return false;              // undateable row — drop it
    const t = Date.parse(e.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
}

module.exports = {
  hasControlChars,
  stripControlChars,
  isLoopbackAddress,
  isLoopbackRequest,
  isLoopbackHostname,
  isAllowedOrigin,
  isExactAllowedOrigin,
  sanitizeAllowedOrigins,
  SETTINGS_PAGE_ORIGIN,
  SETTINGS_PAGE_ROUTES,
  SETTINGS_PAGE_CONFIG_KEYS,
  settingsPageRoute,
  settingsPageConfigRefusals,
  isMutatingMethod,
  timingSafeStringEqual,
  isSafeExternalUrl,
  sanitizeStoredText,
  pruneHistoryByAge,
  normalizeRetentionDays,
  STORED_NAME_MAX,
  DEFAULT_HISTORY_RETENTION_DAYS,
};
