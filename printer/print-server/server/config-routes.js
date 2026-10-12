'use strict';
// Config, schedule, rehearsal, label template endpoints.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const security = require('../security');
const pickup = require('../pickup');
const cups = require('../cups');
const crypto = require('crypto');
const fs    = require('fs');
const $config = lazy('./config');
const $eligibility = lazy('./eligibility');
const $images = lazy('./images');
const $tunes = lazy('./tunes');
const $ledger = lazy('./ledger');
const $tags = lazy('./tags');
const $http = lazy('./http');
const $customPdf = lazy('./custom-pdf');
const $publishers = lazy('./publishers');
const $spooler = lazy('./spooler');
const $station = lazy('./station');
const churchSettings = require('../churchSettings');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  applySavedConfig: { enumerable: true, get: () => applySavedConfig },
  cleanChurchPatch: { enumerable: true, get: () => cleanChurchPatch },
  cleanScheduleRows: { enumerable: true, get: () => cleanScheduleRows },
  CONFIG_POST_CHURCH_KEYS: { enumerable: true, get: () => CONFIG_POST_CHURCH_KEYS },
  isRehearsalActive: { enumerable: true, get: () => isRehearsalActive },
  isTrustedConfigOrigin: { enumerable: true, get: () => isTrustedConfigOrigin },
  isTrustedOrSettingsPage: { enumerable: true, get: () => isTrustedOrSettingsPage },
});

// ── Config endpoints ─────────────────────────────────────────────────────────

// The display key and the sync session are among the values that must never
// leave this machine: the key and session let anyone publish to the church's
// screens. (A phone PIN from an old install is redacted the same way.)
//
// The previous version of this check had two holes, both closed here:
//   • `origin.endsWith(':3456')` accepted ANY host on that port, so a page
//     served from http://evil.example:3456 read both secrets cross-origin.
//   • `if (!origin) return true` trusted every request without an Origin
//     header — including a plain `curl` from any phone on the church WiFi
//     (back when the server listened there).
//
// Now: the request must come from the loopback interface, AND its Origin (when
// present) must be the extension or one of this server's own loopback pages.
// A LAN caller never reaches this server at all.
// pusherSecret and displayLoginPassphrase: an old config.json may still hold one; neither is ever read, but both stay redacted.
const SECRET_CONFIG_KEYS = ['pusherSecret', 'phonePin', 'displayKey', 'slidesPublishToken', 'displayLoginPassphrase', 'syncSession'];

// Operator text that ends up printed on a label (labelFooter, the connect-card
// greeting). Not secrets, but they go onto paper and into config.json, so only
// a single bounded printable line is ever persisted: control characters become
// spaces, whitespace collapses, and the length is capped.
function printableConfigLine(value, maxLen) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// Make the live `config` object exactly mirror what was just written to disk.
//
// Object.assign() alone was NOT enough, and the gap was security-relevant. Both
// POST /config paths can DELETE a key — `delete next.phonePin` when the operator
// clears the PIN, `delete next.displayKey` when they clear the display key — and
// Object.assign copies properties but never removes them. So the file said the
// PIN was gone while the live auth gate, which reads config.phonePin per
// request, kept accepting the OLD one until someone restarted the server. An
// operator clearing a leaked PIN had every reason to believe it was revoked.
// Same for the display key: clearing it left the publisher still sealing with
// the key it was supposed to have forgotten.
function applySavedConfig(next) {
  for (const key of Object.keys($config.config)) {
    if (!(key in next)) delete $config.config[key];
  }
  Object.assign($config.config, next);
  // Sealing is per-publish, so a key change takes effect immediately — a
  // volunteer fixing a name outage mid-event must not have to restart the server
  // that is currently printing labels.
  events.setDisplayKey($config.config.displayKey);
}

function isTrustedConfigOrigin(req) {
  if (!security.isLoopbackRequest(req)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;                                   // same-origin GET, curl on this machine, tests
  if (origin.startsWith('chrome-extension://')) return true;   // the extension's options page
  if (origin.startsWith('moz-extension://')) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'http:'
      && String(url.port) === String($config.PORT)
      && (url.hostname === 'localhost' || security.isLoopbackAddress(url.hostname));
  } catch {
    return false;
  }
}

// The dashboard on this computer, or the settings page that corsPolicy let in
// with the publish token. For the routes that change what the PRINTER does;
// never for a secret (those stay on isTrustedConfigOrigin alone).
function isTrustedOrSettingsPage(req) {
  return isTrustedConfigOrigin(req) || req.settingsPage === true;
}

// ── The church-wide printing settings: one per-key cleaner ───────────────────
// POST /config, /config/schedule, /config/label-templates and the church sync's
// apply (church-sync.js: the Worker's church settings, routes.md 10.3) all write
// these keys through cleanChurchPatch, so a value the Worker sends is held to
// exactly the rules a value typed at this computer is.
// The church keys POST /config takes (labelTemplates, schedule and barfNights
// have their own routes, or none: barfNights only ever arrives from the Worker).
const CONFIG_POST_CHURCH_KEYS = [
  'labelFooter', 'firstTimerInverted', 'trophyBand', 'connectCard', 'connectCardAutoFirstTimer',
  'connectCardGreeting', 'enableDrivenCheckin', 'lateGraceMin', 'pickupClubs', 'seasonTheme',
];

// One writer (docs/SETTINGS-OVERHAUL.md section 4): while this computer applies the
// Worker's church settings (signed in, CHURCH_SETTINGS on, a doc applied), the settings
// page changes them under Printing, through the Worker; its direct write of a church key
// here would be undone by the next apply, so it is refused. The extension's and the
// app's own writes are unaffected (the offline fallback; config.json is theirs too).
function refuseChurchManaged(req, res, keys) {
  if (req.settingsPage !== true) return false;
  if (!keys.some(k => churchSettings.CHURCH_KEYS.includes(k))) return false;
  if (!$station.churchSync.managed()) return false;
  res.status(409).json({ reason: 'church-managed', error: 'This is a church-wide setting now: change it under Printing.' });
  return true;
}

function pickKeys(body, keys) {
  const out = {};
  for (const k of keys) if (body && body[k] !== undefined) out[k] = body[k];
  return out;
}

function cleanLateGrace(value) {
  return Math.max(0, Math.min(120, Number(value) || 0));
}

// The schedule rows, as POST /config/schedule always kept them.
function cleanScheduleRows(schedule) {
  return schedule.slice(0, $ledger.SCHEDULE_MAX_ROWS).map(r => ({
    club: String(r && r.club || '').slice(0, 30),
    startTime: /^\d{1,2}:\d{2}$/.test(String(r && r.startTime || '')) ? String(r.startTime) : '',
    location: String(r && r.location || '').slice(0, 40),
    room: String(r && r.room || '').slice(0, 40),
  })).filter(r => r.club);
}

/**
 * Write the church keys `body` names into `next` (a config.json object), each
 * through its own rule. A key the rule refuses is left as it was and named in
 * `errors` ({key, error}); the caller decides whether that refuses the whole
 * write (POST /config) or only that key (the church sync).
 * @returns {{ errors: {key: string, error: string}[], changed: string[], pickupChanged: boolean, seasonChanged: boolean }}
 */
function cleanChurchPatch(next, body) {
  const errors = [];
  const before = JSON.stringify(pickup.pickupClubsOf(next));
  const seasonBefore = next.seasonTheme;
  const snapshot = {};
  for (const k of Object.keys(body || {})) snapshot[k] = JSON.stringify(next[k]);
  const b = body || {};
  if (b.firstTimerInverted !== undefined) next.firstTimerInverted = !!b.firstTimerInverted;
  // Trophy band (#293): the finished-handbook banner on a child's next
  // label. Default ON (read as `config.trophyBand !== false` at the call
  // site), so an operator who never opens Settings still gets it.
  if (b.trophyBand !== undefined) next.trophyBand = !!b.trophyBand;
  if (b.connectCard !== undefined) next.connectCard = !!b.connectCard;
  // Label footer (#8): one short operator line (church name, a verse, service
  // times) rendered along the bottom of every label. Clearing it deletes the
  // key so config.json stays clean.
  if (b.labelFooter !== undefined) {
    const lf = printableConfigLine(b.labelFooter, 60);
    if (lf === '') delete next.labelFooter;
    else next.labelFooter = lf;
  }
  // Connect card auto-trigger + greeting (#10). An empty greeting deletes the
  // key and the printed card falls back to the built-in default.
  if (b.connectCardAutoFirstTimer !== undefined) next.connectCardAutoFirstTimer = !!b.connectCardAutoFirstTimer;
  if (b.connectCardGreeting !== undefined) {
    const cg = printableConfigLine(b.connectCardGreeting, 60);
    if (cg === '') delete next.connectCardGreeting;
    else next.connectCardGreeting = cg;
  }
  // Screen season (#16/#18; the key keeps its old name, seasonTheme): 'auto'
  // is the default (and deletes the key), 'off' stops the broadcast so each
  // screen follows its own skin setting, a known season pins it. Anything
  // else is refused so a typo can't silently mean 'auto'.
  if (b.seasonTheme !== undefined) {
    const st = String(b.seasonTheme || 'auto');
    if (st === 'auto') delete next.seasonTheme;
    else if (st === 'off' || $eligibility.SEASON_KEYS.includes(st)) next.seasonTheme = st;
    else errors.push({ key: 'seasonTheme', error: 'unknown seasonTheme' });
  }
  if (b.enableDrivenCheckin !== undefined) next.enableDrivenCheckin = !!b.enableDrivenCheckin;
  // "Clubs on the pickup list" (7.16.0): the one setting every lobby
  // screen's still-here list follows. null puts it back to the default
  // (every club but Trek and Journey); a club name we do not know is refused.
  if (b.pickupClubs !== undefined) {
    const pc = pickup.normalizePickupClubs(b.pickupClubs);
    if (!pc.ok) errors.push({ key: 'pickupClubs', error: pc.reason });
    else if (pc.value === null) delete next.pickupClubs;
    else next.pickupClubs = pc.value;
  }
  if (b.lateGraceMin !== undefined) next.lateGraceMin = cleanLateGrace(b.lateGraceMin);
  // Per-club label templates (#1): overrides only; none at all deletes the key.
  if (b.labelTemplates !== undefined) {
    const cleaned = $tags.sanitizeLabelTemplates(b.labelTemplates);
    if (!cleaned.ok) errors.push({ key: 'labelTemplates', error: cleaned.error });
    else if (Object.keys(cleaned.value).length === 0) delete next.labelTemplates;
    else next.labelTemplates = cleaned.value;
  }
  // The group schedule (#28).
  if (b.schedule !== undefined) {
    if (!Array.isArray(b.schedule)) errors.push({ key: 'schedule', error: 'schedule must be an array' });
    else next.schedule = cleanScheduleRows(b.schedule);
  }
  // BARF Nights: config.json's list wins over church-config.json's (tags.js isBarfNight).
  if (b.barfNights !== undefined) {
    const ok = Array.isArray(b.barfNights) && b.barfNights.length <= 20
      && b.barfNights.every(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!ok) errors.push({ key: 'barfNights', error: 'barfNights must be a list of dates (YYYY-MM-DD)' });
    else next.barfNights = [...new Set(b.barfNights)].sort();
  }
  const changed = Object.keys(snapshot).filter(k => JSON.stringify(next[k]) !== snapshot[k]);
  return {
    errors,
    changed,
    pickupChanged: JSON.stringify(pickup.pickupClubsOf(next)) !== before,
    seasonChanged: next.seasonTheme !== seasonBefore,
  };
}

app.get('/config', (req, res) => {
  let saved;
  try {
    saved = fs.existsSync($config.CONFIG_FILE)
      ? $config.loadConfigFile()
      : { printerName: $config.PRINTER_NAME, checkinUrl: '' };
  } catch (e) {
    saved = { printerName: $config.PRINTER_NAME, checkinUrl: '' };
  }
  if (!isTrustedConfigOrigin(req)) {
    saved = { ...saved };
    SECRET_CONFIG_KEYS.forEach(k => { delete saved[k]; });
  }
  // The dashboard's schedule table shows the club schedule this computer
  // actually routes by, the default included when it has none of its own.
  if (!Array.isArray(saved.schedule) || !saved.schedule.length) saved = { ...saved, schedule: $ledger.scheduleRows() };
  res.json(saved);
});

// Generate a fresh display key for the dashboard's button. Loopback-only via
// isTrustedConfigOrigin: a phone on the venue Wi-Fi must never be able to mint
// the key that reads children's names, PIN or no PIN. Deliberately does NOT save
// it — the operator copies it, pastes it into the screens, and only then commits
// it here, so a mistyped paste cannot leave the screens keyed to a key the
// server has already replaced.
app.post('/config/display-key/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The display key can only be generated from this computer’s own app' });
  }
  const key = events.generateDisplayKey();
  console.log('[realtime] Generated a new display key (not yet saved)');
  res.json({ key });
});

// The lobby-slides publish token: what the display app's slide editor must
// present to POST /api/lobby-slides from its https origin. Same loopback-only
// mint rule as the display key — a phone on the venue Wi-Fi must not be able
// to create the credential that writes to every lobby screen.
const SLIDES_TOKEN_RE = events.SLIDES_TOKEN_RE;

app.post('/config/slides-token/generate', (req, res) => {
  if (!isTrustedConfigOrigin(req)) {
    return res.status(403).json({ error: 'The publish token can only be generated from this computer’s own app' });
  }
  const token = crypto.randomBytes(24).toString('base64url');
  console.log('[slides] Generated a new publish token (not yet saved)');
  res.json({ token });
});

app.post('/config', (req, res) => {
  const {
    printerName, checkinUrl,
    worksheetPrinter, historyRetentionDays, displayKey,
    musicalPrinter, updateBeacon, slidesPublishToken,
    fleetConfigUrl,
    backupPrinterName, cupsMedia,
  } = req.body || {};
  if (!isTrustedConfigOrigin(req) && SECRET_CONFIG_KEYS.some(k => (req.body || {})[k] !== undefined)) {
    return res.status(403).json({ error: 'Keys and tokens can only be changed from this computer’s own app, never from a web page' });
  }
  if (req.settingsPage) {
    const refused = security.settingsPageConfigRefusals(req.body);
    if (refused.length) {
      return res.status(403).json({ error: `The settings page can change the printer's own settings only; ${refused.join(', ')} cannot be changed from a web page` });
    }
  }
  if (refuseChurchManaged(req, res, Object.keys(req.body || {}).filter(k => req.body[k] !== undefined))) return;
  try {
    const next = $config.loadConfigFile();
    if (printerName !== undefined) next.printerName = printerName;
    // checkinUrl is handed to shell.openExternal() (Electron), so an unvalidated value was an arbitrary URI aimed at
    // the Windows shell — and this route accepts writes from the extension's
    // origin. Same reasoning as worksheetPrinter below: refuse to PERSIST
    // anything unsafe, so it can never be poisoned once and fire later.
    if (checkinUrl !== undefined) {
      if (!security.isSafeExternalUrl(checkinUrl)) {
        return res.status(400).json({ error: 'checkinUrl must be a plain http(s) URL' });
      }
      next.checkinUrl = String(checkinUrl).trim();
    }
    // The AES key that lets the church's own screens read children's names off
    // the live channel. Clearing it stops the three name-bearing events
    // from being published at all (they fail closed rather than reverting to
    // plaintext) — which is the whole-system rollback lever, no deploy needed.
    if (displayKey !== undefined) {
      const wanted = String(displayKey).trim();
      if (wanted === '') {
        delete next.displayKey;
      } else if (!events.isValidDisplayKey(wanted)) {
        return res.status(400).json({
          error: 'Display key must be 32 bytes of base64 — use the Generate button rather than typing one',
        });
      } else {
        next.displayKey = wanted;
      }
    }
    // The lobby-slides publish token (see /api/lobby-slides). Clearing it
    // revokes the display app's publish path immediately; the dashboard's own
    // paste flow keeps working either way.
    if (slidesPublishToken !== undefined) {
      const wanted = String(slidesPublishToken).trim();
      if (wanted === '') {
        delete next.slidesPublishToken;
      } else if (!SLIDES_TOKEN_RE.test(wanted)) {
        return res.status(400).json({
          error: 'Publish token must come from the Generate button (24–64 URL-safe base64 characters)',
        });
      } else {
        next.slidesPublishToken = wanted;
      }
    }
    // The retired display-login passphrase and salt: an old config.json may
    // still hold them. Nothing reads them; any save scrubs them from disk.
    delete next.displayLoginPassphrase;
    delete next.displayLoginSalt;
    // The fleet-config URL (#394). NOT a secret: it is the same address an
    // operator can already put in a screen's `?config=`. It is https-only and
    // length-capped here, at the point it is PERSISTED, so a bad value is
    // never stored. Clearing it deletes the key.
    if (fleetConfigUrl !== undefined) {
      const wanted = String(fleetConfigUrl).trim();
      if (wanted === '') {
        delete next.fleetConfigUrl;
      } else if (!events.isValidFleetConfigUrl(wanted)) {
        return res.status(400).json({
          error: `Settings URL must be an https:// link of at most ${events.FLEET_CONFIG_URL_MAX} characters`,
        });
      } else {
        next.fleetConfigUrl = wanted;
      }
    }
    // (phonePin, lanAccess and allowedOrigins are gone with the Wi-Fi phone
    // page: an old config.json may still hold them, and nothing reads them.)
    if (historyRetentionDays !== undefined) {
      next.historyRetentionDays = security.normalizeRetentionDays(historyRetentionDays);
    }
    // The church-wide printing settings (labels, connect card, season, pickup
    // list, late grace): one cleaner, shared with the church sync's apply.
    const churchResult = cleanChurchPatch(next, pickKeys(req.body || {}, CONFIG_POST_CHURCH_KEYS));
    if (churchResult.errors.length) return res.status(400).json({ error: churchResult.errors[0].error });
    // `collectibleIcons` (the retired collectible of the week) is no longer
    // read from the body: a dashboard page cached from an older version that
    // still posts it saves fine, and the value goes nowhere.
    // Musical printer (#11/#12): OFF by default - raw TSPL bytes at an unknown
    // printer model are a party trick, not a guarantee.
    if (musicalPrinter !== undefined) next.musicalPrinter = !!musicalPrinter;
    if (updateBeacon !== undefined) next.updateBeacon = !!updateBeacon;
    // "If it fails, print on" (6.26.0). Kept even when empty: '' is a choice
    // (no backup), unlike a missing key, which means a config from before it.
    if (backupPrinterName !== undefined) {
      const bp = String(backupPrinterName || '').trim();
      if (!$customPdf.isSafePrinterName(bp)) return res.status(400).json({ error: 'backupPrinterName contains unsupported characters' });
      next.backupPrinterName = bp;
    }
    // The label roll on a Linux print station (cups.js): a CUPS media keyword,
    // '' for the DYMO 30256 default.
    if (cupsMedia !== undefined) {
      const m = String(cupsMedia || '').trim();
      if (m && !cups.isMediaKeyword(m)) return res.status(400).json({ error: 'cupsMedia is not a CUPS media name' });
      if (m) next.cupsMedia = m; else delete next.cupsMedia;
    }
    // Worksheets (POST /print-pdf) are letter-size, not 4x2 labels, so a
    // church running two printers can route them separately.
    if (worksheetPrinter !== undefined) {
      // This value reaches a shell via printPdf(); refuse to persist anything
      // that isn't a plain printer label so it can never be poisoned once and
      // fire later during a legitimate worksheet print.
      const wp = String(worksheetPrinter || '').trim();
      if (!$customPdf.isSafePrinterName(wp)) {
        return res.status(400).json({ error: 'worksheetPrinter contains unsupported characters' });
      }
      next.worksheetPrinter = wp;
    }

    $config.writeConfigFile(next);
    // Keep the live process in sync so schedule/PIN/toggle/key changes apply
    // without a restart.
    applySavedConfig(next);
    if (churchResult.pickupChanged) $publishers.stillHereChanged();
    console.log('[config] Saved');
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Group schedule (#28) ──────────────────────────────────────────────────────
app.get('/config/schedule', (req, res) => {
  res.json({ schedule: $ledger.scheduleRows(), lateGraceMin: Number.isFinite(Number($config.config.lateGraceMin)) ? Number($config.config.lateGraceMin) : 10 });
});

app.post('/config/schedule', (req, res) => {
  const { schedule, lateGraceMin } = req.body || {};
  if (refuseChurchManaged(req, res, ['schedule'])) return;
  if (!Array.isArray(schedule)) return res.status(400).json({ error: 'schedule must be an array' });
  const rows = cleanScheduleRows(schedule);
  try {
    const next = $config.loadConfigFile();
    next.schedule = rows;
    if (lateGraceMin !== undefined) next.lateGraceMin = cleanLateGrace(lateGraceMin);
    $config.writeConfigFile(next);
    applySavedConfig(next);
    res.json({ ok: true, schedule: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Musical printer (#11/#12) — endpoint ──────────────────────────────────────
// Loopback/trusted-origin only: feeding paper is a physical act, and a phone
// on the venue Wi-Fi has no business making the printer sing mid-club.
// ── Rehearsal mode (#19) ──────────────────────────────────────────────────────
// One dashboard button arms a fake club night across BOTH apps: while armed,
// EVERY print is treated as a demo (real label, diagonal TEST band, zero
// persistent side effects — no history, no ledger, no publish, no tally), and
// every tally broadcast carries the contract's optional `rehearsal: true`
// flag (staged in v5.20.0) so the displays watermark themselves. In-memory
// only, and it auto-disarms after 2 hours: a rehearsal armed at Tuesday
// training and forgotten must never turn Wednesday's real check-ins into
// TEST labels. /health carries both the state and a loud warning while armed.
const REHEARSAL_AUTO_DISARM_MS = 2 * 60 * 60 * 1000;
let rehearsalState = { on: false, armedAt: 0 };

function isRehearsalActive(now = Date.now()) {
  if (!rehearsalState.on) return false;
  if (now - rehearsalState.armedAt > REHEARSAL_AUTO_DISARM_MS) {
    rehearsalState = { on: false, armedAt: 0 };
    console.log('[rehearsal] Auto-disarmed after 2h — rehearsal mode never outlives a training session');
    // Broadcast the disarm, or displays keep the TEST watermark until the
    // next club night's first interval tally. Deferred a tick: this getter
    // is called from inside publishTally itself, and the state above is
    // already cleared, so the deferred tally reads rehearsal=false.
    setTimeout(() => { try { $publishers.publishTally(); } catch (e) { /* best-effort */ } }, 0);
    return false;
  }
  return true;
}

app.post('/rehearsal', (req, res) => {
  // This computer's own app, or the settings page proven by its sync sign-in.
  if (!isTrustedOrSettingsPage(req)) {
    return res.status(403).json({ error: 'Rehearsal mode can only be toggled from the settings page on this computer' });
  }
  const on = (req.body || {}).on === true;
  rehearsalState = on ? { on: true, armedAt: Date.now() } : { on: false, armedAt: 0 };
  console.log('[rehearsal] ' + (on ? 'ARMED — every print is a TEST label, nothing is recorded, displays watermark' : 'disarmed — back to real check-ins'));
  // Broadcast immediately so screens flip their watermark within seconds,
  // not at the next 60s tally tick (and drop it just as fast on disarm).
  $publishers.publishTally();
  res.json({ ok: true, rehearsal: rehearsalState.on });
});

app.post('/play-tune', async (req, res) => {
  if (!isTrustedOrSettingsPage(req)) {
    return res.status(403).json({ error: 'The tune button only works from this computer' });
  }
  if ($config.config.musicalPrinter !== true) {
    return res.status(409).json({ error: 'Musical printer is off — enable it in Settings first' });
  }
  const wanted = String((req.body || {}).printerName || '').trim();
  if (wanted && !$customPdf.isSafePrinterName(wanted)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  const tune = String((req.body || {}).tune || '') || undefined;
  const ok = await $tunes.playTuneIfEnabled(wanted || $config.PRINTER_NAME, tune);
  res.json({ ok, tune: $tunes.lastTune ? $tunes.lastTune.tune : null, error: !ok && $tunes.lastTune ? $tunes.lastTune.error : undefined });
});

// Clear a jammed printer's backlog (#256). Gated the way /play-tune and
// /rehearsal are — trusted origin only, NOT merely the phone PIN: a volunteer's
// phone on the venue Wi-Fi must not be able to bin labels that are about to
// print. Confirm-gated too, and never invoked automatically by anything.
//
// The body is validated BEFORE the platform short-circuit, exactly as
// POST /print-pdf does, so the 400s stay observable from Linux CI.
app.post('/printer/clear-queue', async (req, res) => {
  if (!isTrustedOrSettingsPage(req)) {
    return res.status(403).json({ error: 'The print queue can only be cleared from this computer' });
  }
  const wanted = String((req.body || {}).printerName || '').trim();
  if (wanted && !$customPdf.isSafePrinterName(wanted)) {
    return res.status(400).json({ error: 'printerName contains unsupported characters' });
  }
  if ((req.body || {}).confirm !== true) {
    return res.status(400).json({ error: 'confirm:true is required' });
  }
  const target = wanted || $config.PRINTER_NAME;
  if (!target || !$customPdf.isSafePrinterName(target)) {
    return res.status(400).json({ error: 'No usable printer is configured' });
  }
  if (process.platform !== 'win32') {
    return res.status(501).json({ error: 'Clearing the print queue requires Windows' });
  }
  try {
    const result = await $spooler.clearPrintQueue(target);
    if (!result) return res.status(500).json({ error: 'Could not clear the print queue' });
    // So the next /health tells the truth instead of a 60s-stale backlog.
    $spooler.cachedPrinterCheck.checkedAt = 0;
    console.log(`[queue] Cleared ${result.removed} job(s) on ${target}${result.failed ? `, ${result.failed} refused` : ''}`);
    return res.json({ ok: true, printer: target, removed: result.removed, failed: result.failed });
  } catch (e) {
    console.error('[queue] clear failed:', e.message);
    return res.status(500).json({ error: 'Could not clear the print queue' });
  }
});

// ── Per-club label templates (#1) — endpoints ─────────────────────────────────
app.get('/config/label-templates', (req, res) => {
  res.json({
    templates: ($config.config.labelTemplates && typeof $config.config.labelTemplates === 'object' && !Array.isArray($config.config.labelTemplates))
      ? $config.config.labelTemplates : {},
    knownClubs: Object.keys($images.CLUB_MONOGRAM),
    fields: $tags.LABEL_TEMPLATE_BOOLEANS,
  });
});

// Writes are gated on isTrustedConfigOrigin — stricter than the other
// non-secret keys, deliberately: a template changes what gets PRINTED for a
// whole club, and the phone PIN is a LAN-trust credential, not authorization
// to restyle every label. The dashboard and extension options page (both
// loopback) are the only writers.
app.post('/config/label-templates', (req, res) => {
  if (!isTrustedOrSettingsPage(req)) {
    return res.status(403).json({ error: 'Label templates can only be changed from this computer' });
  }
  if (refuseChurchManaged(req, res, ['labelTemplates'])) return;
  const cleaned = $tags.sanitizeLabelTemplates((req.body || {}).templates);
  if (!cleaned.ok) return res.status(400).json({ error: cleaned.error });
  try {
    const next = $config.loadConfigFile();
    if (Object.keys(cleaned.value).length === 0) delete next.labelTemplates;
    else next.labelTemplates = cleaned.value;
    $config.writeConfigFile(next);
    applySavedConfig(next);
    console.log('[config] Label templates saved:', Object.keys(cleaned.value).join(', ') || '(none)');
    res.json({ ok: true, templates: cleaned.value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
