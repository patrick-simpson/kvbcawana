'use strict';
// Auto-update check, health, one-click update.
// One of the modules server.js was split into (server.js loads them in the order the old
// file ran them). Another module's names are reached as $module.name.

const lazy = require('./lazy');
const events  = require('../events');
const brand = require('../brand');
const syncClient = require('../sync-client');
const tonightRules = require('../tonight');
const {
  REPORT_FRESH_MS, normalizedName, displayClub, splitFullName, historyIdentityKey, reportEntryIdentityKey,
  identityKeysOfRow, identityKeysOfReportEntry, distinctReportChildren, reportIsPartial, massUndoRefused,
} = tonightRules;
const https = require('https');
const fs    = require('fs');
const $config = lazy('./config');
const $eventBuffer = lazy('./event-buffer');
const $clubbers = lazy('./clubbers');
const $printing = lazy('./printing');
const $tunes = lazy('./tunes');
const $http = lazy('./http');
const $tonightCount = lazy('./tonight-count');
const $publishers = lazy('./publishers');
const $relay = lazy('./relay');
const $spooler = lazy('./spooler');
const $configRoutes = lazy('./config-routes');
const $station = lazy('./station');
const app = $http.app;

// What other modules (and server.js) read from this one; live bindings, so cycles are safe.
Object.defineProperties(exports, {
  checkForUpdates: { enumerable: true, get: () => checkForUpdates },
  extensionSkew: { enumerable: true, get: () => extensionSkew },
  isNewerVersion: { enumerable: true, get: () => isNewerVersion },
  setExtensionInfo: { enumerable: true, get: () => setExtensionInfo },
  setLatestVersion: { enumerable: true, get: () => setLatestVersion },
  setUpdateHandler: { enumerable: true, get: () => setUpdateHandler },
  UPDATE_CHECK_INTERVAL: { enumerable: true, get: () => UPDATE_CHECK_INTERVAL },
});

// ── Auto-update check ────────────────────────────────────────────────────────
let latestVersion = null;
const UPDATE_CHECK_INTERVAL = 6 * 3600000; // 6 hours

// Embedders (the Electron shell) own the update lifecycle: they register a
// handler that /update-now calls, and
// they feed electron-updater's state into /health via setLatestVersion().
let updateHandler = null;
function setUpdateHandler(fn) { updateHandler = fn; }
// "Newer" is a numeric compare of the three parts, never a string compare
// (7.10.0 sorts before 7.9.0 as strings) and never "different": an older
// version in the feed (a release pulled back, a stale mirror) used to read as
// an update and /update-now would have installed it over this one.
function isNewerVersion(candidate, current) {
  const parts = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parts(candidate), b = parts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function setLatestVersion(ver) {
  if (isNewerVersion(ver, $config.SERVER_VERSION)) latestVersion = String(ver).trim();
}

// Where the Electron shell keeps the managed copy of the Chrome extension, and
// which version is sitting there. Pushed in rather than guessed from the
// filesystem: only the shell knows whether it actually synced, and /health
// reporting a folder the app never wrote would be worse than reporting none.
// Stays null under a standalone `node server.js`, which is the truth there.
let extensionInfo = null;
// Version skew (#7), pure half: warn only when the synced folder and the
// running extension genuinely disagree AND the running-version report is
// fresh. A report from before the sync (or from last week's session) must
// not shout "restart Chrome" at an operator whose Chrome is already fine —
// the extension reports every 10 minutes while a check-in page is open, so
// 30 minutes of freshness covers a slow tab without covering a stale one.
const EXTENSION_REPORT_FRESH_MS = 30 * 60 * 1000;
function extensionSkew(syncedVersion, report, now = Date.now()) {
  if (!syncedVersion || !report || !report.version) return null;
  if (now - report.at > EXTENSION_REPORT_FRESH_MS) return null;
  if (report.version === syncedVersion) return null;
  return { running: report.version, synced: syncedVersion };
}

function setExtensionInfo(info) {
  if (!info || !info.targetDir) { extensionInfo = null; return; }
  extensionInfo = {
    dir: String(info.targetDir),
    version: info.version ? String(info.version) : null,
    action: info.action ? String(info.action) : null,
  };
}

function checkForUpdates() {
  const url = 'https://raw.githubusercontent.com/patrick-simpson/Print-TwoTimTwo-Labels/main/VERSION';
  https.get(url, { timeout: 5000 }, (res) => {
    if (res.statusCode !== 200) return;
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      const ver = data.trim();
      if (isNewerVersion(ver, $config.SERVER_VERSION)) {
        latestVersion = ver;
        console.log(`[update] New version available: ${ver} (current: ${$config.SERVER_VERSION})`);
      }
    });
  }).on('error', () => { /* ignore */ });
}

// Override health endpoint with enhanced version
app.get('/health', async (req, res) => {
  // Copy: checkPrinterWarnings() hands back its CACHED array, so appending in
  // place would re-append on every poll until the cache expired.
  const warnings = [...await $spooler.checkPrinterWarnings()];
  // config.json could not be read at some point since this server started
  // (loadConfigFile): what was done about it, until a restart, so it is seen.
  if ($config.configFileDamaged) warnings.push({ type: 'configDamaged', message: $config.configFileDamaged });
  // A data file whose last save failed (saveFileAtomic), until one succeeds.
  const saveWarning = $config.dataSaveWarning();
  if (saveWarning) warnings.push(saveWarning);
  // A church setting from the Worker this computer's cleaner refused (it keeps its own value).
  warnings.push(...$station.churchSync.warnings());
  // The live-channel relay's breaker is open: frames to the sync service are
  // being dropped, and it is the only pipe, so the operator should know.
  if ($relay.signedInToSync() && Date.now() < $relay.relayBrokenUntil) {
    warnings.push({
      type: 'syncRelay',
      message: `The sync service is not answering, so live frames are not reaching screens through it (next try in ${Math.max(1, Math.ceil(($relay.relayBrokenUntil - Date.now()) / 1000))} s). Labels still print. Check the internet connection.`,
    });
  }
  // Every entry must be a {type, message} OBJECT. The settings page and the
  // status window render `w.message`, so a bare string arrived as `undefined`
  // and painted an EMPTY yellow box — the loudest warnings in the file were
  // the invisible ones, and that is exactly why nobody found the display key.
  // Surface the realtime privacy mode where the operator already looks. An
  // unencrypted channel is not broken, so it cannot be an error — but it must
  // never be INVISIBLE, or "we set that up" becomes a belief rather than a fact.
  const keyState = events.getDisplayKeyState();
  if ($relay.signedInToSync() && !keyState.configured) {
    warnings.push({
      type: 'displayKeyMissing',
      message: "No display key is set, so children's first names are published unencrypted. Sign this computer in to the sync service (awana.kvbchurch.org/settings → Printing → At the laptop → This laptop’s sign-in): it installs the church's key.",
    });
  }
  if ($config.config.displayKey && !keyState.configured) {
    warnings.push({
      type: 'displayKeyInvalid',
      message: 'The saved display key is invalid, so names are going out in the clear. Sign this computer in to the sync service again (awana.kvbchurch.org/settings → Printing → At the laptop → This laptop’s sign-in): it installs the church\'s key.',
    });
  }
  // Version skew (#7): the app synced a new extension to disk, but Chrome is
  // still running the old code until it restarts. The widget already shows
  // its own "restart Chrome" banner; this is the dashboard half, driven by
  // what the extension itself last reported it was running.
  const skew = extensionSkew(extensionInfo && extensionInfo.version, $eventBuffer.lastExtensionReport);
  if (skew) {
    warnings.push({
      type: 'extensionSkew',
      message: `Chrome is running extension v${skew.running}, but v${skew.synced} is already installed on disk. Restart Chrome to load it — until then the browser keeps the old behavior.`,
    });
  }
  // Contract drift (#3): the daily sweep's latest verdict. A failing sweep is
  // exactly the "warn before club night" moment, so it belongs in the same
  // yellow box the operator already reads.
  if ($eventBuffer.lastContractCanary && $eventBuffer.lastContractCanary.ok === false) {
    const failing = $eventBuffer.lastContractCanary.results.filter(r => !r.passed && !r.soft).map(r => r.check);
    warnings.push({
      type: 'contractDrift',
      message: `The TwoTimTwo site no longer matches what this printer expects (${failing.join(', ') || 'unknown check'}). Automatic printing may be broken — run the widget's "Check site" after any fix.`,
    });
  }
  // Rehearsal mode is never an error, but it must never be INVISIBLE either:
  // an armed rehearsal turns every print into a TEST label, so the dashboard
  // has to shout it until it's turned off (or the 2h auto-disarm fires).
  if ($configRoutes.isRehearsalActive()) {
    warnings.push({
      type: 'rehearsalArmed',
      message: 'Rehearsal mode is ON: every label prints with a TEST band and nothing is recorded or broadcast as real. Turn it off before real check-ins (it auto-disarms 2 hours after arming).',
    });
  }
  // Tonight's count is this printer's own history since 10.0.0 (the Chrome
  // extension posted TwoTimTwo's report until then; on a station the Worker
  // publishes the count from it). No warning about that: it would be up every
  // club night. `tallySource` below still says which, as data.
  const tallyNow = $tonightCount.authoritativeTonight();
  // The label's brand kit (fonts + official club marks). A failed piece never
  // stops a print — the renderer falls back to the old font or the letter
  // monogram — but it must not be invisible either: a broken install would
  // otherwise just print plainer labels and nobody would know why.
  const brandKit = brand.status();
  warnings.push(...brand.warnings());
  warnings.push(...$printing.printerFallbackWarnings());
  let csvUpdatedAt = null;
  try {
    csvUpdatedAt = fs.statSync($config.CSV_FILE).mtime.toISOString();
  } catch { /* no CSV yet */ }
  res.json({
    status: 'ok',
    printer: $config.PRINTER_NAME || '(default)',
    rehearsal: $configRoutes.isRehearsalActive(),
    version: $config.SERVER_VERSION,
    latestVersion: latestVersion,
    uptime: Math.round(process.uptime()),
    warnings,
    clubNight: events.isClubNightNow($config.churchConfig.clubNights),
    // Which measurement tonight's number came from, as data rather than prose,
    // so the dashboard can label the Tonight card without parsing a sentence.
    tallySource: {
      source: tallyNow.source,
      at: tallyNow.at ? new Date(tallyNow.at).toISOString() : null,
      ageMs: tallyNow.ageMs,
    },
    // The live channel (the sync service): `configured` means signed in.
    live: { ...events.getPublishState(), configured: $relay.signedInToSync() },
    // Never the key itself — only whether one is installed, plus its public
    // `kid` fingerprint, which is what lets a screen confirm it holds the SAME
    // key rather than merely some key. "Are we actually encrypted?" has to be
    // answerable from the dashboard, not a belief.
    displayKeyConfigured: keyState.configured,
    displayKeyId: keyState.kid,
    encryptingNames: keyState.configured,
    // Managed Chrome extension folder + the version sitting in it. Null under a
    // standalone server. The VERSION is safe for anyone (the extension itself
    // reads it to know a restart is owed); the PATH is not, because it contains
    // the operator's Windows username and /health is CORS-reachable from the
    // check-in site. So the folder is loopback-only, like the display key.
    extension: extensionInfo && ($configRoutes.isTrustedConfigOrigin(req)
      ? extensionInfo
      : { version: extensionInfo.version, action: extensionInfo.action }),
    selectorSelfTest: $eventBuffer.lastSelfTest,
    contractCanary: $eventBuffer.lastContractCanary,
    // Musical printer observability: the last tune attempt's outcome, with
    // the exact Win32 error when the RAW path fails — "it just prints
    // normal" must be diagnosable from the dashboard.
    musicalTune: { enabled: $config.config.musicalPrinter === true, last: $tunes.lastTune },
    // Windows spooler backlog (#256), as NUMBERS rather than prose, so the
    // Night Status card and any future UI don't have to parse a sentence.
    // Counts, ages and spooler status tokens only — deliberately never a
    // DocumentName or a UserName: /health is CORS-readable from the check-in
    // site, which is exactly why the extension folder path is loopback-gated
    // just above. `unknown: true` means the queue could not be read; it is
    // never a zero.
    spooler: $spooler.cachedPrinterCheck.spooler || $spooler.SPOOLER_UNKNOWN,
    extensionRunning: $eventBuffer.lastExtensionReport,
    lastCanary: $eventBuffer.lastCanary,
    printFailures: $eventBuffer.printFailures.length,
    csv: { count: $clubbers.clubbers.length, updatedAt: csvUpdatedAt },
    // Which label fonts and club marks loaded: family names / club keys and a
    // short reason for each failure, never a file path (the packaged kit sits
    // under the operator's Windows profile and /health is CORS-readable).
    fonts: brandKit.fonts,
    clubMarks: brandKit.marks,
    // The published lobby deck — rev/stamp/count only, never the slide text
    // (that is one GET away on the dashboard, and /health is CORS-reachable
    // from the check-in site).
    lobbySlides: {
      deckRev: $publishers.lobbySlides.deckRev,
      publishedAt: $publishers.lobbySlides.publishedAt || null,
      slideCount: $publishers.lobbySlides.slides.length,
      tokenConfigured: Boolean($config.config.slidesPublishToken),
    },
    // Shared display settings (contract v6): which rev the screens are on.
    // Never the values themselves.
    displaySettings: {
      rev: $publishers.displaySettings.rev,
      publishedAt: $publishers.displaySettings.publishedAt || null,
      keyCount: Object.keys($publishers.displaySettings.settings).length,
    },
    // The sync service: whether this computer is signed in, never the session.
    sync: {
      signedIn: $relay.signedInToSync(),
      url: syncClient.isValidSyncUrl($config.config.syncUrl) ? $config.config.syncUrl : null,
      state: $relay.signedInToSync() ? $relay.syncStatus.state : ($relay.syncStatus.state === 'signed-out' ? 'signed-out' : 'none'),
      checkedAt: $relay.syncStatus.checkedAt,
      error: $relay.syncStatus.error,
    },
    // The church-wide settings (church-sync.js): the rev applied, when, and whether
    // the Worker or config.json alone decides them right now. Never the values.
    church: $station.churchSync.status(),
  });
});

// Recent print failures for the dashboard (names stay local — never on the channel)
app.get('/failures', (req, res) => {
  res.json($eventBuffer.printFailures);
});

// ── One-click update ──────────────────────────────────────────────────────────
// Hands the update to the embedding app (electron-updater). Guarded so a stray
// call when no update exists can't bounce the server mid-event for nothing.
app.post('/update-now', (req, res) => {
  if (!isNewerVersion(latestVersion, $config.SERVER_VERSION)) {
    return res.status(409).json({ error: 'Already on the latest version', version: $config.SERVER_VERSION });
  }
  if (!updateHandler) {
    // A standalone `node server.js` has no updater of its own.
    return res.status(409).json({ error: 'This server has no updater; update the app instead', version: $config.SERVER_VERSION });
  }
  res.json({ ok: true, updatingTo: latestVersion });
  // Embedded in the Electron shell: hand the update to electron-updater.
  console.log(`[update] Update to v${latestVersion} requested — delegating to the app shell`);
  setTimeout(() => { try { updateHandler(latestVersion); } catch (e) { console.error('[update] Handler failed:', e.message); } }, 500);
});
