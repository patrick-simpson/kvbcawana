'use strict';
// The Express app: CORS, busy, the loopback gate, CSV receive, printers.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const express = require('express');
const security = require('../security');
const syncClient = require('../sync-client');
const path  = require('path');
const SERVER_DIR = path.join(__dirname, '..'); // print-server/, where server.js lives
const $config = lazy('./config');
const $clubbers = lazy('./clubbers');
const $eligibility = lazy('./eligibility');
const $printing = lazy('./printing');
const $reprint = lazy('./reprint');
const $feedRoutes = lazy('./feed-routes');

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  app: { enumerable: true, get: () => app },
  isBusy: { enumerable: true, get: () => isBusy },
  SETTINGS_URL: { enumerable: true, get: () => SETTINGS_URL },
});

// ── Express server ────────────────────────────────────────────────────────────
const app = express();

// Express 4 does not catch a rejected async handler: the request hung until
// the client's own timeout, and the client's retry hit the same throw. Every
// async route registered on `app` is wrapped here, once, so a rejection reaches
// the JSON error handler at the bottom of this file and the client hears
// "500" at once instead of nothing.
for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
  const register = app[method].bind(app);
  app[method] = (route, ...handlers) => register(route, ...handlers.map((h) => (
    typeof h === 'function' && h.constructor && h.constructor.name === 'AsyncFunction'
      ? (req, res, next) => h(req, res, next).catch(next)
      : h
  )));
}

// ── CORS: an allowlist, not `*` ───────────────────────────────────────────────
// This used to be `app.use(cors())`, i.e. `Access-Control-Allow-Origin: *` on
// every response. Because the browser lets a page READ a response bearing that
// header, any website open in the volunteer's browser could fetch
// /stats/tonight and walk away with tonight's children plus their allergy
// tokens. The allowlist (security.isAllowedOrigin) admits only this server's
// own pages (and the settings page, for its own table of routes below).
//
// Two rules, both necessary:
//   • Reads  — no ACAO header for a stranger, so the browser blocks the read.
//   • Writes — a mutating request carrying a non-allowlisted Origin is refused
//     outright (403). A form POST with text/plain is never preflighted, so
//     without this a hostile tab could still WRITE (that is how a crafted name
//     reached print-history.json and then the dashboard's innerHTML).
// The two paths the deployed display app may POST to (with the publish token).
const DISPLAY_PUBLISH_PATHS = new Set(['/api/lobby-slides', '/api/display-settings']);

function corsPolicy(req, res, next) {
  const origin = req.headers.origin;
  // The lobby-slides publish endpoint admits ONE extra caller: the deployed
  // display app's exact origin (churchConfig.displayOrigins), scoped to this
  // single path so the display site never gains cross-origin access to the
  // roster or any other endpoint. The bearer publish token — checked in the
  // route — is the actual credential; the origin gate is browser hygiene.
  // Contract v6 adds the shared display settings, published the same way from
  // the same app with the same token.
  const isSlidesPath = DISPLAY_PUBLISH_PATHS.has(req.path);
  const slidesOrigin = isSlidesPath && security.isExactAllowedOrigin(
    origin, security.sanitizeAllowedOrigins($config.churchConfig.displayOrigins));
  // The settings page (awana.kvbchurch.org/settings, ROADMAP.md#settings-page phase 3): one
  // exact origin, a short table of routes (security.SETTINGS_PAGE_ROUTES).
  // For a preflight the method is the one being asked for.
  const settingsRoute = security.settingsPageRoute(
    origin, req.path,
    req.method === 'OPTIONS' ? req.headers['access-control-request-method'] : req.method);
  const allowed = slidesOrigin || Boolean(settingsRoute) || security.isAllowedOrigin(origin, {
    port: $config.PORT,
  });

  // Vary so a proxy or the browser cache never reuses one origin's answer for
  // another origin's request.
  res.setHeader('Vary', 'Origin');

  if (origin && allowed) {
    // Echo the exact origin — never '*'. No Allow-Credentials: these endpoints
    // are authenticated by PIN (or by being loopback), never by cookie.
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    // Authorization is only ever needed (or granted) on the slides path and the
    // settings page's routes: it carries the publish token.
    res.setHeader('Access-Control-Allow-Headers',
      (isSlidesPath || settingsRoute) ? 'Content-Type,Authorization' : 'Content-Type,X-Awana-Pin');
    res.setHeader('Access-Control-Max-Age', '600');
    // Chrome's Private Network Access: a public https page fetching a local
    // server preflights with this request header, and the fetch is blocked
    // unless we opt in. Scoped to the slides path and the settings page's
    // routes — nothing else on this server is meant to be reachable from a
    // public origin.
    if ((isSlidesPath || settingsRoute) && req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    // Answer the preflight before the auth gate: a rejected preflight must look
    // like a CORS failure, not a PIN failure.
    return res.sendStatus(origin && allowed ? 204 : 403);
  }

  if (origin && !allowed && security.isMutatingMethod(req.method)) {
    console.warn(`[security] Refused ${req.method} ${req.path} from disallowed origin ${origin}`);
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // The settings page proves itself like the slides editor does: the publish
  // token, on top of a loopback socket (this computer's own browser). Only
  // /health is open. What passes is marked on the request, so a route that
  // accepts "the dashboard on this computer" can accept the page too
  // (isTrustedOrSettingsPage), and the secret-holding routes, which never
  // look at the mark, cannot.
  if (settingsRoute && !settingsRoute.open) {
    if (!security.isLoopbackRequest(req)) {
      return res.status(403).json({ error: 'The settings page can only reach the print server on the computer it runs on' });
    }
    // Signed in to /settings with the church passphrase is enough (owner,
    // 2026-10-11): the page sends its sync session, which the sync service
    // confirms (settingsPageSessionOk). The publish token still works.
    if (/^Sync\s/i.test(String(req.headers.authorization || ''))) {
      return $feedRoutes.settingsPageSessionOk(req).then((ok) => {
        if (!ok) {
          console.warn(`[security] Refused settings-page ${req.method} ${req.path}: the sync service did not confirm the sign-in`);
          return res.status(403).json({ error: syncClient.isValidSyncUrl($config.config.syncUrl)
            ? 'Sign in to the settings page again: the sync service did not accept its sign-in.'
            : 'This computer has no sync service on record. Open the KVBC Awana app on it (tray icon, Set up this computer) and sign in there.' });
        }
        req.settingsPage = true;
        return next();
      }, () => res.status(403).json({ error: 'Could not check the sign-in with the sync service. Try again.' }));
    }
    if (!$config.config.slidesPublishToken) {
      return res.status(403).json({ error: 'Sign in to the settings page with the church passphrase first (Setup), then try again.' });
    }
    if (!$feedRoutes.slidesTokenOk(req)) {
      console.warn(`[security] Refused settings-page ${req.method} ${req.path}: wrong or missing publish token`);
      return res.status(403).json({ error: 'Wrong publish token. Sign in to the settings page with the church passphrase instead.' });
    }
    req.settingsPage = true;
  }

  return next();
}
app.use(corsPolicy);

// ── Busy: a label printing, or waiting to print (KVBC Awana 9.0.0) ──────────
// The Electron shell asks isBusy() before it turns the print role off (a
// change made on awana.kvbchurch.org/settings is held until this says no) and
// before an update installs (capped there at a minute). Busy is: a request on
// a printing route still being answered (its label is still being drawn, or a
// stretch reprint is between labels) or a job on the printer chain. (Until
// 10.0.0 also a phone check-in the Chrome extension had not driven yet.)
// Internal only: /health does not carry it.
const PRINTING_ROUTE = /^\/(print|reprint|canary|play-tune)(\/|-|$)/;
let printRequests = 0;
app.use((req, res, next) => {
  if (req.method !== 'POST' || !PRINTING_ROUTE.test(req.path)) return next();
  printRequests += 1;
  let open = true;
  const end = () => { if (open) { open = false; printRequests -= 1; } };
  res.on('finish', end);
  res.on('close', end);
  return next();
});

function isBusy() {
  return printRequests > 0 || $printing.printerJobs > 0 || Boolean($reprint.reprintRun);
}

// Keep the body limit small so a hostile or buggy tab can't push megabytes of
// JSON through a laptop that is mid-event. (Until 10.0.0 one route, the
// extension's /print-pdf worksheets, carried a larger body of its own.)
app.use(express.json({ limit: '2mb' }));

// ── The loopback gate ────────────────────────────────────────────────────────
// Online only (owner, 2026-10-11): this server answers the computer it runs on
// and nobody else. startListening() binds 127.0.0.1, so no other machine can
// open a socket here at all; this refuses a non-loopback caller anyway, at the
// one place every route passes through, so a later change to the bind can never
// quietly expose the roster to the church Wi-Fi. There is no PIN and no LAN
// page any more: phones use awana.kvbchurch.org/checkin, which talks to the
// sync Worker; this computer prints the jobs it leases from there.
app.use((req, res, next) => {
  if (security.isLoopbackRequest(req)) return next();
  const addr = (req.socket && req.socket.remoteAddress) || 'unknown';
  console.warn(`[security] Refused ${req.method} ${req.path} from ${addr}: this server only answers the computer it runs on`);
  return res.status(403).json({ error: 'This server only answers on the computer it runs on.' });
});

// The brand kit mirror (public/brand/) is the only folder served over HTTP, to
// loopback. Nothing here serves a page of its own: the print dashboard and the
// Wi-Fi phone page are gone (settings live at awana.kvbchurch.org/settings;
// phone.html stays in the repo only because site/build.mjs makes /checkin from
// it). Only stylesheets, fonts and SVGs with plain paths.
const BRAND_PUBLIC_PATH = /^\/[A-Za-z0-9_\-/]+\.(css|woff2|ttf|svg)$/;
const brandStatic = express.static(path.join(SERVER_DIR, 'public', 'brand'), {
  index: false, redirect: false, dotfiles: 'ignore', fallthrough: true,
});
app.use('/brand', (req, res, next) => {
  if (!BRAND_PUBLIC_PATH.test(req.path)) return next();
  return brandStatic(req, res, next);
});

// GET / answers a tiny page that says where the settings went, for anyone who
// opens http://localhost:3456 from habit (the old dashboard's address).
const SETTINGS_URL = 'https://awana.kvbchurch.org/settings';
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>KVBC Awana print server</title>
<style>body{font:18px/1.5 system-ui,sans-serif;max-width:34rem;margin:12vh auto;padding:0 1.25rem;color:#1b2a3a}a{color:#0a5bd8}small{color:#566}</style></head>
<body><h1>The print server is running</h1>
<p>Its settings moved. Open <a href="${SETTINGS_URL}">awana.kvbchurch.org/settings</a> in Chrome on this computer: it finds this printer by itself.</p>
<p><small>KVBC Awana ${$config.SERVER_VERSION}. With no internet, check-in still prints at the desk; the settings wait until it is back.</small></p></body></html>`);
});

// Health endpoint defined below with enhanced warnings

app.get('/roster-status', (req, res) => {
  // `consent` is counts of distinct release values and how many rows flag
  // no-photo: never a name, so it is as safe to read as the count itself.
  res.json({ count: $clubbers.clubbers.length, consent: $eligibility.rosterConsentSummary($clubbers.clubbers) });
});

app.get('/printers', async (req, res) => {
  if ($config.CUPS_BACKEND) {
    const rows = await $printing.cupsPrinterRows();
    if (!rows) {
      res.status(500).json({ error: 'Failed to list printers', printers: [], inUse: $printing.printingTarget() });
      return;
    }
    const printers = rows.map((p) => ({ name: p.Name, isWindowsDefault: !!p.Default }));
    res.json({ printers, serverDefault: $config.PRINTER_NAME || null, autoDetected: printers.length === 1 ? printers[0].name : null, inUse: $printing.printingTarget() });
    return;
  }
  try {
    const raw = (await $printing.runPowerShell(['-Command', 'Get-Printer | Select-Object Name, Default | ConvertTo-Json -Compress'], { timeout: 8000 })).trim();
    let parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) parsed = [parsed];  // PowerShell returns bare object for single printer
    const printers = parsed.map(p => ({ name: p.Name, isWindowsDefault: !!p.Default }));
    const autoDetected = printers.length === 1 ? printers[0].name : null;
    res.json({ printers, serverDefault: $config.PRINTER_NAME || null, autoDetected, inUse: $printing.printingTarget() });
  } catch (err) {
    console.error('[printers] Failed to list printers:', err.message);
    res.status(500).json({ error: 'Failed to list printers', printers: [], inUse: $printing.printingTarget() });
  }
});

// ── Receive CSV from the extension (authenticated browser session) ───────────
// The extension fetches /clubber/csv from the same origin (which has the
// user's session cookies) and POSTs the raw CSV text here so the server can
// write it to clubbers.csv for enriched label data.
app.post('/update-csv', (req, res) => {
  const { csv } = req.body || {};
  if (!csv || typeof csv !== 'string' || !csv.trim()) {
    return res.status(400).json({ error: 'csv field is required (string)' });
  }
  const csvPath = $config.CSV_FILE;

  // Parse BEFORE writing. A sync that yields zero rows (login redirect, an
  // export format change, a truncated download) must not overwrite a roster
  // we know is good — that would blank enrichment for the rest of the night
  // and persist the damage to disk.
  const rows = $clubbers.parseCSV(csv);
  if (rows.length === 0 && $clubbers.clubbers.length > 0) {
    console.warn(`[csv] Rejected roster sync: posted CSV parsed to 0 rows — keeping the ${$clubbers.clubbers.length} clubber(s) already loaded`);
    return res.status(422).json({ error: 'CSV parsed to 0 rows — roster not replaced', count: $clubbers.clubbers.length });
  }

  // Atomic write: write to a temp file then rename over the target, so a
  // crash or concurrent reader mid-write can never observe a truncated CSV.
  if (!$config.saveFileAtomic(csvPath, csv)) {
    return res.status(500).json({ error: 'Failed to write CSV' });
  }
  $clubbers.clubbers = rows;
  console.log(`[csv] Updated clubbers.csv from browser (${rows.length} clubber(s))`);
  res.json({ ok: true, count: rows.length });
});
