// KVBC Awana (v9, UNIFIED-APP.md): one app for every KVBC Awana computer.
// It was the Club Label Printer; it keeps that app's appId and "name", so the
// check-in laptop upgrades in place from the printer feed and keeps its data.
// Each computer has roles (src/roles.js, roles.json in userData): the PRINT
// SERVER (everything that was the printer app; it runs only while print is
// on) and the DISPLAY (the sound room app's main process,
// src/display/display.js; it runs only while display is on). The first-run
// wizard (src/setup-wizard.js) sets them; the tray reopens it.
const { app, BrowserWindow, Tray, Menu, ipcMain, shell, nativeImage, dialog, Notification, safeStorage, net: electronNet } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const os = require('os');
const { execFile, execFileSync, spawn } = require('child_process');
const { runMigration, removeShortcuts, findOldBrandShortcuts } = require('./src/migrate');
const configStore = require('./src/config-store');
const extensionSync = require('./src/extension-sync');
const updatePush = require('./src/update-push');
const chromeRestart = require('./src/chrome-restart');
const rolesStore = require('./src/roles');
const handoff = require('./src/handoff');
const oldApp = require('./src/old-app');
const { createDisplay } = require('./src/display/display');
const { createSetupWizard } = require('./src/setup-wizard');
const { createSyncSession } = require('./src/sync-session');
const { findDisplay } = require('./src/display/displays');
const { SCREENS } = require('./src/display/screens');

// Every user-visible name (windows, tray, notifications, dialogs).
const APP_NAME = 'KVBC Awana';

// ── Safe external opens ───────────────────────────────────────────────────────
// shell.openExternal() hands its argument to the OS handler, so on Windows a
// non-http scheme can launch a local program. config.checkinUrl reaches it from
// three call sites below, and POST /config used to accept that value from any
// caller with no validation — a poisoned config.json was therefore an arbitrary
// URI aimed at the shell.
//
// The server now refuses to PERSIST an unsafe checkinUrl (see
// security.isSafeExternalUrl in print-server/security.js). This is the second
// half of that fix: validate again at the sink, because a config.json can also
// be edited by hand or arrive from an older install. Deliberately implemented
// locally rather than requiring the server module — these calls can run before
// the server has loaded (or when it failed to start entirely).
function isSafeExternalUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > 2048) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return false;
  }
  try {
    const url = new URL(s);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return true;
  } catch {
    return false;
  }
}

function openExternalSafely(value, context) {
  if (!isSafeExternalUrl(value)) {
    console.error(`[security] Refusing to open unsafe URL from ${context}:`, value);
    dialog.showErrorBox(
      `${APP_NAME}: blocked link`,
      'The configured check-in address is not a valid web address, so it was not opened.\n\n'
      + 'Open Settings and set the check-in page URL (it should start with https://).'
    );
    return false;
  }
  shell.openExternal(value);
  return true;
}

// Single instance lock — prevent two copies of the server running on port 3456
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// The print server writes its data (config.json, clubbers.csv, history…) to
// AWANA_DATA_DIR. A packaged app must never write inside resources/, so point
// it at userData BEFORE the server module is ever required.
process.env.AWANA_DATA_DIR = app.getPath('userData');

const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const PORT = 3456;
const isDev = process.env.NODE_ENV === 'development';
const isAutoStart = process.argv.includes('--auto-start');
// Renamed from 'Awana Print Server (TCP 3456)' in v5.9.0 (trademark
// compliance rebrand). The rule-add below is idempotent on this new name, so
// an already-updated machine simply gets a second, harmlessly redundant
// allow rule under the old name rather than losing connectivity — removing
// it would need an elevated prompt on every launch, which isn't worth it for
// a leftover firewall rule nobody sees day to day.
const FIREWALL_RULE = 'Club Print Server (TCP 3456)';

let tray = null;
// What this computer is (src/roles.js). Read before anything starts, in
// app.whenReady below; until then nothing runs.
let roles = rolesStore.normalizeRoles(null);
let display = null;       // src/display/display.js, created once; runs only while roles.display
let wizard = null;        // src/setup-wizard.js
let syncSession = null;   // src/sync-session.js
let setupWindow = null;   // the print server's status window (renderer/), print role only
let pdfWindow = null;  // hidden window used for printer enumeration
let serverInstance = null;
let serverModule = null;
let currentConfig = null;
// Surfaced in the tray and settings window — a broken server must be SEEN,
// never silently degraded (the old slim-fallback path hid exactly this).
let serverState = { status: 'starting', error: null };
// Full update lifecycle, surfaced in the tray AND the settings window so
// "is this thing updating itself?" is answerable at a glance:
//   checking → available (downloading, percent) → downloaded (restart to apply)
// upToDate is set by an explicit check that found nothing, so the UI can say
// "✓ up to date" instead of silently doing nothing.
let updateState = { checking: false, available: null, downloaded: null, percent: null, upToDate: false };
// The managed copy of the Chrome extension — see src/extension-sync.js. Filled
// in once at startup and then reported verbatim to the tray, the settings
// window and /health, so the folder the operator must load unpacked is never
// something they have to go hunting for.
let extensionState = { action: 'skipped', version: null, targetDir: null };

// ─── Chrome extension ────────────────────────────────────────────────────────

// One stable path, deliberately NOT inside resources/: an app update replaces
// resources/ wholesale, and Chrome would be left pointing at a folder that
// vanished. userData survives every update and every uninstall-reinstall.
const EXTENSION_DIR = path.join(app.getPath('userData'), 'chrome-extension');

function syncBundledExtension() {
  const sourceDir = app.isPackaged
    ? path.join(process.resourcesPath, 'chrome-extension')
    : path.join(__dirname, '..', 'chrome-extension');
  extensionState = extensionSync.syncExtension({ sourceDir, targetDir: EXTENSION_DIR });
  const { action, version, error } = extensionState;
  if (error) {
    console.warn(`[extension] ${action}: ${error}`);
  } else {
    console.log(`[extension] ${action} v${version} at ${EXTENSION_DIR}`);
  }
  return extensionState;
}

// ─── Config helpers ─────────────────────────────────────────────────────────

// Both delegate to src/config-store.js — see the long comment there for why a
// write MUST be a merge rather than a whole-file replace. Kept as thin local
// wrappers so the many call sites don't each have to thread CONFIG_PATH.
const loadConfig = () => configStore.loadConfig(CONFIG_PATH);
const saveConfig = (patch) => configStore.saveConfig(CONFIG_PATH, patch);

// ─── Auto-launch on boot ─────────────────────────────────────────────────────

function applyLoginItemSettings(config) {
  // Skip in dev — it would register the bare electron.exe as a login item.
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: config.launchOnBoot !== false,
    args: ['--auto-start'],
  });
}

// ─── Auto-update (electron-updater + GitHub Releases) ────────────────────────

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (e) {
  console.warn('[update] electron-updater unavailable:', e.message);
}

// Rebuild the tray to reflect current server/update state. Safe to call from
// any event handler: no-ops until the initial buildTray has run.
function refreshTray() {
  if (tray && currentConfig) buildTray(currentConfig);
}

// The operator's reversed policy: a mid-club release only ever happens
// because they shipped an urgent fix, so the app quits and re-installs the
// MOMENT a download finishes — no more "Restart to update" waiting for a
// human. A label mid-print should still get to finish, though:
// print-server/server.js exposes no "printing/queue busy" signal today (see
// its module.exports — no isBusy()/queue getter of any kind), and this
// deliberately does not add one (see the goal doc — no new plumbing for
// this). If that ever changes, prefer polling it below, capped at
// AUTO_INSTALL_BUSY_CAP_MS. Until then, a short fixed grace gives an
// in-flight /print HTTP response time to flush before the process exits.
const AUTO_INSTALL_GRACE_MS = 5000;
const UPDATE_EVERY_MS = 10 * 60 * 1000;
const AUTO_INSTALL_BUSY_CAP_MS = 60000;
const AUTO_INSTALL_POLL_MS = 1000;

let installInFlight = false;
function performQuitAndInstall(reason) {
  if (!autoUpdater) return;
  // Once an install has been handed to NSIS, every further trigger (the
  // push event, the 24h poll, a manual click, a second release landing
  // mid-install) must be ignored: two installers interleaving over the same
  // directory is exactly how an install ends up with half a node_modules.
  if (installInFlight) {
    console.log(`[update] Ignoring "${reason}" — an install is already in flight`);
    return;
  }
  installInFlight = true;
  console.log(`[update] ${reason}`);
  app.isQuitting = true;
  // The installer relaunches the app with no arguments, which the display
  // would read as a person opening it (a three-hour Show at 2 am).
  if (display) display.prepareInstall();
  // isSilent=true: this is an unattended kiosk box, nobody is at the
  // keyboard mid-club-night to click through an installer window.
  // isForceRunAfter=true: electron-updater only relaunches the app
  // automatically after a NON-silent install unless this is set — and the
  // entire point of this change is that the print server comes back up on
  // its own with no one there to double-click the shortcut.
  //
  // A way back (7.11.1): quitAndInstall normally never returns, but when it
  // throws, or returns and the app is still here two minutes later, the
  // in-flight flag used to stay set for the life of the process and every
  // later update was ignored until someone killed the app. Now the flag is
  // dropped and the app goes on serving; the next update gets a fresh try.
  const giveUp = (why) => {
    console.warn(`[update] The install did not happen (${why}); the app goes on serving and will try the next update.`);
    installInFlight = false;
    app.isQuitting = false;
    if (display) display.cancelInstall();
  };
  try {
    autoUpdater.quitAndInstall(true, true);
    const t = setTimeout(() => { if (installInFlight) giveUp('still running two minutes after quitAndInstall'); }, 2 * 60 * 1000);
    if (t && typeof t.unref === 'function') t.unref();
  } catch (e) {
    giveUp(e && e.message ? e.message : String(e));
  }
}

// KVBC Awana v9: updates install right away whatever the roles (the sound
// room's rule, owner 2026-10-11). The print role adds no idle gate: the only
// wait is the fixed grace above, or, if the server ever exports isBusy(), at
// most AUTO_INSTALL_BUSY_CAP_MS. A display-only computer has no print server,
// so it takes the grace alone.
function scheduleAutoInstall(info) {
  if (roles.print && serverModule && typeof serverModule.isBusy === 'function') {
    const startedAt = Date.now();
    const poll = () => {
      let stillBusy = false;
      try { stillBusy = !!serverModule.isBusy(); } catch { stillBusy = false; }
      if (!stillBusy || Date.now() - startedAt >= AUTO_INSTALL_BUSY_CAP_MS) {
        performQuitAndInstall(`Installing v${info.version} now (${stillBusy ? 'busy-cap reached' : 'server idle'})`);
      } else {
        setTimeout(poll, AUTO_INSTALL_POLL_MS);
      }
    };
    poll();
  } else {
    setTimeout(
      () => performQuitAndInstall(`Installing v${info.version} after ${AUTO_INSTALL_GRACE_MS}ms grace period`),
      AUTO_INSTALL_GRACE_MS
    );
  }
}

function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  // Safety net only: performQuitAndInstall() above is what actually drives
  // the restart now. This just means "if the app quits before that timer
  // fires for any reason, install on the way out" rather than silently
  // discarding an already-downloaded update.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.disableWebInstaller = true;

  autoUpdater.on('checking-for-update', () => {
    updateState.checking = true;
    refreshTray();
  });
  autoUpdater.on('update-available', (info) => {
    updateState.checking = false;
    updateState.available = info.version;
    updateState.upToDate = false;
    if (serverModule && serverModule.setLatestVersion) serverModule.setLatestVersion(info.version);
    refreshTray();  // shows "Downloading update vX…"
  });
  autoUpdater.on('update-not-available', () => {
    updateState.checking = false;
    updateState.available = null;
    updateState.upToDate = true;
    refreshTray();  // shows "✓ Up to date"
  });
  autoUpdater.on('download-progress', (p) => {
    // Settings window polls this via get-server-state; no tray rebuild per tick.
    updateState.percent = Math.round(p.percent || 0);
  });
  autoUpdater.on('update-downloaded', (info) => {
    updateState.checking = false;
    updateState.downloaded = info.version;
    refreshTray();  // shows "Updating to vX… restarting"
    scheduleAutoInstall(info);
  });
  autoUpdater.on('error', (e) => {
    updateState.checking = false;
    console.warn('[update] ', e && e.message);
    refreshTray();
  });

  const check = () => autoUpdater.checkForUpdates().catch(() => { /* offline is fine */ });
  check();
  // Every ten minutes, the sound room app's rhythm (v9). The Pusher release
  // ping (setupUpdatePush) was the laptop's fast path, and the Pusher keys are
  // cleared since 2026-10-03, so the old daily poll was in practice the only
  // one: a release reached the check-in laptop up to a day late. The feed is a
  // static file on the site, so asking often costs nothing.
  setInterval(check, UPDATE_EVERY_MS);
}

function installUpdateNow() {
  if (!autoUpdater) return;
  if (updateState.downloaded) {
    // An explicit human/operator ask — install immediately, no grace.
    performQuitAndInstall(`Manual install requested for v${updateState.downloaded}`);
  } else {
    // Not downloaded yet — kick a check; install the moment it lands.
    autoUpdater.once('update-downloaded', () => {
      performQuitAndInstall('Manual install requested — download just finished');
    });
    autoUpdater.checkForUpdates().catch(() => { /* offline */ });
  }
}

// ─── Push notification of new releases (Pusher) ─────────────────────────────
// The release workflow (.github/workflows/build-electron.yml) pings the
// SAME public Pusher channel the print server already publishes
// checkin/tally/etc. on, with an `update` event carrying nothing but
// `{ version, at }` — see CONTRACT.md's "`update` event (laptop-internal)"
// section. This is the primary path to a fast auto-update; the 24h poll in
// setupAutoUpdater() above is only the safety net for a laptop that was
// offline (or never relaunched) when the ping fired.
//
// This subscribes with the SAME app key + cluster + channel the server-side
// `pusher` package already publishes with (config.json's
// pusherKey/pusherCluster, church-config.json's pusherChannel) — no new
// config is invented for this. The server holds the Pusher SECRET and is the
// only thing that can ever publish; this is a subscribe-only client using the
// public key, exactly like the display app.
let pusherClient = null;
let lastUpdatePushVersion = null;
let lastUpdatePushAt = 0;
const UPDATE_PUSH_DEBOUNCE_MS = 30000;

// Mirrors print-server/server.js's own CHURCH_CONFIG_FILE resolution (prefer
// a church-config.json in the data dir so it survives app updates; fall back
// to the copy shipped next to the print server) so a fork that has
// customised its channel via that file is honoured here too, without this
// module needing to require the full server (which starts side effects of
// its own — see startServer()).
function resolveUpdateChannel() {
  const DEFAULT_CHANNEL = 'awana-channel'; // print-server/church-config.json's baked default
  const dataDirFile = path.join(app.getPath('userData'), 'church-config.json');
  const bundledFile = app.isPackaged
    ? path.join(process.resourcesPath, 'print-server', 'church-config.json')
    : path.join(__dirname, '..', 'print-server', 'church-config.json');
  const file = fs.existsSync(dataDirFile) ? dataDirFile : bundledFile;
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.pusherChannel === 'string' && parsed.pusherChannel) {
        return parsed.pusherChannel;
      }
    }
  } catch { /* malformed church-config.json — fall through to the baked default */ }
  return DEFAULT_CHANNEL;
}

function handleUpdatePushEvent(payload) {
  const decision = updatePush.decideOnUpdateEvent(payload, {
    now: Date.now(),
    lastVersion: lastUpdatePushVersion,
    lastAt: lastUpdatePushAt,
    debounceMs: UPDATE_PUSH_DEBOUNCE_MS,
  });
  if (!decision.act) {
    console.log(`[update-push] Ignoring event: ${decision.reason}`);
    return;
  }
  lastUpdatePushVersion = decision.version;
  lastUpdatePushAt = Date.now();
  console.log(`[update-push] Release ping received for v${decision.version} — checking for updates.`);
  if (autoUpdater && app.isPackaged) {
    // This is the ONLY thing a ping ever does. A spoofed event (the channel
    // is public) cannot forge a release: it can only make the app ask
    // electron-updater to look at the real GitHub release feed, which it
    // verifies independently — worst case is a harmless extra check.
    autoUpdater.checkForUpdates().catch(() => { /* offline is fine — the poll covers it */ });
  }
}

// Must never throw or crash the app: a dev install with no Pusher configured
// (or one that fails to reach Pusher entirely) is expected to fall back to
// the periodic poll silently, exactly like the display app's own connection
// handling.
function setupUpdatePush() {
  if (!app.isPackaged) return;  // dev install — the periodic poll is enough
  let PusherClient;
  try {
    PusherClient = require('pusher-js');
  } catch (e) {
    console.warn('[update-push] pusher-js unavailable — falling back to periodic checks:', e.message);
    return;
  }
  const config = currentConfig || loadConfig() || {};
  if (!config.pusherKey) {
    console.log('[update-push] No Pusher key configured — relying on periodic update checks only.');
    return;
  }
  try {
    pusherClient = new PusherClient(config.pusherKey, {
      cluster: config.pusherCluster || 'us2',
    });
    pusherClient.connection.bind('error', (err) => {
      console.warn('[update-push] Pusher connection error (periodic checks still cover this):', err && err.message);
    });
    const channel = pusherClient.subscribe(resolveUpdateChannel());
    channel.bind('update', handleUpdatePushEvent);
  } catch (e) {
    console.warn('[update-push] Failed to subscribe — falling back to periodic checks:', e && e.message);
    pusherClient = null;
  }
}

// ─── Windows ─────────────────────────────────────────────────────────────────

function getIconPath() {
  const p = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(p) ? p : null;
}

function createPdfWindow() {
  pdfWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 200,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  pdfWindow.loadURL('about:blank');
}

function createSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520,
    height: 560,
    resizable: false,
    title: `${APP_NAME}: print server`,
    icon: getIconPath() || undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    setupWindow.loadURL('http://localhost:5173');
  } else {
    setupWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  setupWindow.on('closed', () => { setupWindow = null; });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function buildTray(config) {
  const iconPath = getIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  if (!tray) {
    tray = new Tray(icon);
    // One click: the print server's status window, or (a display-only
    // computer) the menu; a double-click on a display opens its Settings, as
    // the sound room app did. A computer not yet set up opens the wizard.
    tray.on('click', () => {
      if (!roles.setupDone) openWizard();
      else if (roles.print) createSetupWindow();
      else tray.popUpContextMenu();
    });
    tray.on('double-click', () => {
      if (roles.display && !roles.print && display) display.openConfigurator();
    });
  } else {
    tray.setImage(icon);
  }

  const failed = roles.print && serverState.status === 'failed';
  const named = roles.name ? `${APP_NAME}: ${roles.name}` : APP_NAME;
  const tip = [named];
  if (failed) tip.push('PRINT SERVER NOT RUNNING: click to start it');
  else if (roles.print) tip.push(`Printing to ${config.printerName || 'the system default printer'}`);
  if (roles.display && display && display.isRunning()) tip.push(display.statusLine());
  if (!roles.setupDone) tip.push('Not set up yet: click to set it up');
  // Windows cuts a tray tooltip at 127 characters.
  tray.setToolTip(tip.join('\n').slice(0, 127));

  const template = [
    { label: `${named}  v${app.getVersion()}`, enabled: false },
  ];
  if (!roles.setupDone) {
    template.push({ label: 'Set up this computer...', click: () => openWizard() });
  }

  if (roles.print) {
    template.push({ type: 'separator' });
    template.push(failed
      ? { label: '⚠ Print server NOT RUNNING — open its status', click: () => createSetupWindow() }
      : { label: `Printer: ${config.printerName || '(system default)'}`, enabled: false });
    template.push({ label: `Print server: http://localhost:${PORT}`, enabled: false });
    template.push({
      // The easy button. When the server is down this (re)starts it in one
      // click; when it's up, it's a harmless restart for "when in doubt".
      label: failed ? '▶ Start print server' : 'Restart print server',
      click: () => startServer(currentConfig || loadConfig() || {})
    });
    if (config.checkinUrl) {
      template.push({
        label: 'Open Check-in Page',
        click: () => openExternalSafely(config.checkinUrl, 'tray menu')
      });
    }
    template.push({
      label: config.printerName ? 'Print server status...' : 'Finish print server setup…',
      click: () => createSetupWindow()
    });
    if (extensionState.targetDir && extensionState.action !== 'skipped') {
      template.push({
        // "Load unpacked" wants a folder, and a folder is exactly the thing a
        // file dialog is worst at finding. Open it in Explorer so the operator
        // can drag it onto the dialog or paste the path from the title bar.
        label: 'Open Chrome extension folder',
        click: () => shell.openPath(extensionState.targetDir)
      });
    }
  }

  if (roles.display && display && display.isRunning()) {
    template.push({ type: 'separator' });
    template.push(...display.menuItems());
  }

  template.push({ type: 'separator' });
  if (roles.setupDone) template.push({ label: 'Set up this computer...', click: () => openWizard() });
  template.push({
    label: 'Start with Windows', type: 'checkbox', checked: autostartOn(), enabled: app.isPackaged,
    click: (item) => setAutostart(item.checked),
  });

  // Update status: always show exactly where the auto-updater is.
  if (autoUpdater && app.isPackaged) {
    template.push({ type: 'separator' });
    if (updateState.downloaded) {
      // Automatic now (see scheduleAutoInstall) — this is no longer a click
      // target, just a status line for "yes, it's about to restart itself".
      template.push({
        label: `⬇ Updating to v${updateState.downloaded}… restarting`,
        enabled: false
      });
    } else if (updateState.available) {
      template.push({ label: `Downloading update v${updateState.available}…`, enabled: false });
    } else if (updateState.checking) {
      template.push({ label: 'Checking for updates…', enabled: false });
    } else {
      template.push({
        label: updateState.upToDate ? `✓ Up to date — check again` : 'Check for updates',
        click: () => autoUpdater.checkForUpdates().catch(() => { /* offline */ })
      });
    }
  }

  template.push({ type: 'separator' });
  template.push({
    label: 'Quit',
    click: () => {
      app.isQuitting = true;
      app.quit();
    }
  });

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

// ─── Start with Windows (both roles) ─────────────────────────────────────────
// One login item for the whole app: config.json's launchOnBoot (default on),
// the key the printer's wizard always owned. The display's "Start with
// Windows" switch and the tray's checkbox write the same key.

function autostartOn() {
  if (!app.isPackaged) return false;
  return (currentConfig || loadConfig() || {}).launchOnBoot !== false;
}

function setAutostart(on) {
  if (!app.isPackaged) return;
  currentConfig = saveConfig({ launchOnBoot: on === true });
  applyLoginItemSettings(currentConfig);
  refreshTray();
}

// ─── Port conflict handling ──────────────────────────────────────────────────
// A legacy script install's Startup shortcut (launch-awana.bat) races this app
// for port 3456 on boot. Detect the squatter, name it, and offer a one-click
// stop — the old behaviour was five silent retries and then nothing.

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

function findPortOwner(port) {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', `
      $c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($c) {
        $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
        $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue).ParentProcessId
        @{ pid = $c.OwningProcess; name = $p.ProcessName; parentPid = $parent } | ConvertTo-Json -Compress
      }
    `], { timeout: 10000, windowsHide: true }).toString().trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

function stopPortOwner(owner) {
  try {
    // Kill the process tree. If the parent is the legacy launch-awana.bat
    // restart loop (cmd.exe), kill that tree instead or it respawns the
    // server three seconds later.
    let rootPid = owner.pid;
    if (owner.parentPid) {
      try {
        const parentName = execFileSync('powershell', ['-NoProfile', '-Command',
          `(Get-Process -Id ${owner.parentPid} -ErrorAction SilentlyContinue).ProcessName`
        ], { timeout: 10000, windowsHide: true }).toString().trim();
        if (parentName === 'cmd') rootPid = owner.parentPid;
      } catch { /* parent gone — kill the node pid */ }
    }
    execFileSync('taskkill', ['/PID', String(rootPid), '/T', '/F'], { timeout: 10000, windowsHide: true });
    return true;
  } catch (e) {
    console.warn('[port] Could not stop process:', e.message);
    return false;
  }
}

async function resolvePortConflict() {
  if (process.platform !== 'win32') return;
  if (await isPortFree(PORT)) return;
  const owner = findPortOwner(PORT);
  const desc = owner ? `${owner.name} (PID ${owner.pid})` : 'another program';
  if (isAutoStart) {
    // Nobody is at the keyboard on a login-item auto-start: a modal here held
    // the whole boot, server included, until someone clicked. Say so in a
    // notification and go on; the server's own start fails on the busy port,
    // the tray shows it, and the watchdog retries every minute until the
    // port is free or a person opens the app and resolves it.
    console.warn(`[port] Port ${PORT} is in use by ${desc}; auto-start continues without the dialog.`);
    try {
      if (Notification.isSupported()) new Notification({ title: `${APP_NAME}: port in use`, body: `Port ${PORT} is being used by ${desc}. Open the app from the tray to stop it; labels cannot print until then.` }).show();
    } catch { /* no notifications here */ }
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Port 3456 is in use',
    message: `The print server's port is being used by ${desc}.`,
    detail: 'This is usually a previous Club print server still running (for example the old desktop shortcut\'s auto-start). Stop it so this app can take over?',
    buttons: ['Stop it and continue', 'Continue anyway'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0 && owner) {
    stopPortOwner(owner);
    // Give the OS a moment to release the socket; the server also retries.
    await new Promise((r) => setTimeout(r, 1500));
  }
}

// ─── Print server ─────────────────────────────────────────────────────────────

function startServer(config) {
  if (!roles.print) return;  // a display-only computer runs no print server
  if (serverInstance) {
    // The server that is really bound, whichever listen attempt got there
    // (the object startListening() returns is only the first attempt's).
    if (serverModule && serverModule.stopListening) serverModule.stopListening();
    else serverInstance.close();
    serverInstance = null;
  }
  // The FULL print server (roster enrichment, dedup, history, Pusher event
  // bus, phone check-in) is the ONLY server. @napi-rs/canvas ships prebuilt
  // N-API binaries, so the old "native module didn't load" failure mode is
  // gone — and if the server still fails, we show it loudly instead of
  // silently degrading to a feature-poor fallback like pre-5.0 builds did.
  try {
    const fullServerDir = app.isPackaged
      ? path.join(process.resourcesPath, 'print-server')
      : path.join(__dirname, '..', 'print-server');
    const fullServerPath = path.join(fullServerDir, 'server.js');
    if (config.printerName) process.env.PRINTER_NAME = config.printerName;
    serverModule = require(fullServerPath);
    // The require cache keeps this module alive across restarts, so its
    // load-time state (printer name from env, config.json snapshot) goes
    // stale the moment settings change — and is EMPTY when the server starts
    // before first-time setup. Push the current truth into the live module.
    if (serverModule.setPrinterName) serverModule.setPrinterName(config.printerName || '');
    if (serverModule.applySavedConfig) serverModule.applySavedConfig(loadConfig() || {});
    serverModule.setUpdateHandler(() => installUpdateNow());
    // Operator alerts (#3 contract drift, etc.): the server decides WHEN,
    // this shell decides HOW — a system notification, so it lands even when
    // no dashboard tab is open. Guarded: notifications are best-effort.
    if (serverModule.setOpsAlertHandler) {
      serverModule.setOpsAlertHandler(({ title, body }) => {
        try {
          if (Notification.isSupported()) new Notification({ title, body }).show();
        } catch (e) { console.warn('[alert] Notification failed:', e.message); }
      });
    }
    if (updateState.available) serverModule.setLatestVersion(updateState.available);
    if (serverModule.setExtensionInfo) serverModule.setExtensionInfo(extensionState);
    serverInstance = serverModule.startListening();
    // The bind is asynchronous and retries a busy port for about 20 s, so
    // "running" is said only once it is true. Until 7.11.1 the tray said
    // Running the moment the module loaded, and a port still held by a
    // previous instance left labels unprintable behind a green tray icon,
    // with the failure on a console no packaged app shows.
    serverState = { status: 'starting', error: null };
    console.log('[server] Print server starting from', fullServerDir);
    const started = serverInstance;
    (started.ready || Promise.resolve(started)).then(() => {
      if (serverInstance !== started) return;   // restarted meanwhile
      serverState = { status: 'running', error: null };
      console.log('[server] Print server is listening on port', PORT);
      if (currentConfig) buildTray(currentConfig);
    }, (err) => {
      if (serverInstance !== started) return;
      serverState = { status: 'failed', error: err && err.message ? err.message : String(err) };
      console.error('[server] Print server could not listen:', serverState.error);
      if (currentConfig) buildTray(currentConfig);
      try {
        if (Notification.isSupported()) {
          new Notification({ title: `${APP_NAME}: labels cannot print`, body: serverState.error }).show();
        }
      } catch (e) { console.warn('[alert] Notification failed:', e.message); }
    });
  } catch (e) {
    serverState = { status: 'failed', error: `${e.message}\n${e.stack || ''}` };
    console.error('[server] Print server failed to start:', e);
    // A missing module inside resources/ is the signature of an interrupted
    // or interleaved update (a half-copied node_modules) — not a bug the
    // operator can screenshot their way out of. Offer the actual fix: pull
    // the full installer from the latest release and run it. Settings,
    // roster and history live in userData and survive the reinstall.
    if (/cannot find module/i.test(e.message || '')) {
      offerRepairInstall(e.message);
    } else {
      dialog.showErrorBox(
        `${APP_NAME}: the print server failed to start`,
        'Labels canNOT print until this is fixed.\n\n' + e.message +
        '\n\nPlease send a screenshot of this message to your administrator.'
      );
    }
  }
  if (currentConfig) buildTray(currentConfig);
}

// ─── Self-repair for a broken install ────────────────────────────────────────
const REPAIR_INSTALLER_URL =
  'https://awana.kvbchurch.org/download/club-label-printer';

function offerRepairInstall(errMessage) {
  dialog.showMessageBox({
    type: 'error',
    title: `${APP_NAME}: the update needs repair`,
    message: 'The last update looks interrupted — part of the app is missing, and labels canNOT print until it is repaired.',
    detail: 'Fix: reinstall from the latest full installer. Your settings, roster and history are kept.\n\nTechnical detail: ' + errMessage,
    buttons: ['Repair now (download installer)', 'Open releases page', 'Close'],
    defaultId: 0,
    cancelId: 2,
  }).then(({ response }) => {
    if (response === 0) downloadAndRunRepairInstaller();
    else if (response === 1) shell.openExternal('https://github.com/patrick-simpson/kvbcawana/releases');
  }).catch(() => { /* dialog dismissed */ });
}

// Downloads the full installer (Electron's net follows GitHub's redirects,
// plain https.get does not) to temp and launches it VISIBLY — the operator
// clicks through it, so nothing installs behind their back — then quits so
// NSIS can replace the app files.
function downloadAndRunRepairInstaller() {
  const dest = path.join(os.tmpdir(), 'KVBC-Awana-Setup.exe');
  const file = fs.createWriteStream(dest);
  const request = electronNet.request(REPAIR_INSTALLER_URL);
  const fail = (why) => {
    try { file.close(); } catch { /* ignore */ }
    dialog.showErrorBox(
      'Repair download failed',
      why + '\n\nDownload it manually instead:\n' + REPAIR_INSTALLER_URL
    );
  };
  request.on('response', (response) => {
    if (response.statusCode !== 200) { fail('HTTP ' + response.statusCode); return; }
    response.on('data', (chunk) => file.write(chunk));
    response.on('end', () => {
      file.end(() => {
        shell.openPath(dest).then((openErr) => {
          if (openErr) { fail(openErr); return; }
          app.isQuitting = true;
          app.quit();
        });
      });
    });
    response.on('error', () => fail('download interrupted'));
  });
  request.on('error', (err) => fail(err.message || 'network error'));
  request.end();
}

// True when something is actually answering on the server port — the ground
// truth "is it running?", regardless of what this process thinks it started.
function probeServer(timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/health', timeout: timeoutMs },
      (res) => { res.resume(); resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

// The tray's word is checked against the port once a minute. Two misses in
// a row (the server died, or hung) restart it and say so; a server still
// starting, or one the shell already knows has failed, is left to its own
// retries. Until 7.11.1 nothing probed after launch, so a dead server kept
// its green tray icon all evening.
let healthMisses = 0;
async function watchServer() {
  if (!roles.print || serverState.status !== 'running') { healthMisses = 0; return; }
  if (await probeServer(5000)) { healthMisses = 0; return; }
  healthMisses += 1;
  console.warn(`[server] /health did not answer (${healthMisses} in a row)`);
  if (healthMisses < 2) return;
  healthMisses = 0;
  serverState = { status: 'failed', error: 'The print server stopped answering and is being restarted.' };
  if (currentConfig) buildTray(currentConfig);
  try {
    if (Notification.isSupported()) new Notification({ title: APP_NAME, body: 'The print server stopped answering; restarting it.' }).show();
  } catch (e) { console.warn('[alert] Notification failed:', e.message); }
  startServer(currentConfig || loadConfig() || {});
}
setInterval(() => { watchServer().catch((e) => console.warn('[server] health probe failed:', e.message)); }, 60_000).unref?.();

// Launching the app is the operator's "make it work" gesture — every entry
// point (fresh launch, second launch via the desktop shortcut, the Start
// Server button) funnels through here: if nothing answers on the port, start
// the server.
async function ensureServerRunning(context) {
  if (!roles.print) return false;
  if (await probeServer()) return true;
  console.log(`[server] Nothing answering on port ${PORT} (${context}) — starting the print server.`);
  startServer(currentConfig || loadConfig() || {});
  return false;
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-printers', async () => {
  try {
    // Use Electron's built-in printer enumeration — no subprocess, always works
    const printers = await pdfWindow.webContents.getPrintersAsync();
    return printers.map(p => ({ name: p.name, isDefault: p.isDefault }));
  } catch {
    return [];
  }
});

ipcMain.handle('get-config', () => loadConfig());

ipcMain.handle('save-config', (event, patch) => {
  // Act on the MERGED config, not the renderer's patch — startServer needs the
  // Pusher credentials and the PIN, and buildTray needs the printer name, none
  // of which the setup wizard sends.
  const config = saveConfig(patch);
  currentConfig = config;
  applyLoginItemSettings(config);
  startServer(config);
  buildTray(config);
  // Close wizard shortly after so the renderer can show a success state
  setTimeout(() => {
    if (setupWindow) setupWindow.close();
    openExternalSafely(config.checkinUrl, 'setup wizard');
  }, 600);
  // Hand back the merged config so the renderer's state matches what is on
  // disk rather than the partial patch it sent.
  return { success: true, config };
});

ipcMain.handle('open-checkin-page', (event, url) => {
  // Renderer-supplied URL: same validation, same reason.
  openExternalSafely(url, 'open-checkin-page IPC');
});

ipcMain.handle('get-server-state', () => ({
  ...serverState,
  version: app.getVersion(),
  update: updateState,
}));

ipcMain.handle('get-lan-address', () => {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
});

// Phone check-in needs inbound TCP 3456 open. The per-user installer can't
// add a firewall rule silently; this runs the (idempotent) rule add with a
// UAC prompt when the user asks for it from Settings.
ipcMain.handle('enable-phone-checkin', async () => {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows only' };
  const cmd = `if (-not (Get-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName '${FIREWALL_RULE}' -Direction Inbound -Protocol TCP -LocalPort ${PORT} -Action Allow -Profile Private,Domain | Out-Null }`;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-Command',"${cmd.replace(/"/g, '\\"')}"`
    ], { timeout: 60000, windowsHide: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Firewall rule was not added (administrator approval declined?)' };
  }
});

ipcMain.handle('install-update', () => { installUpdateNow(); return { ok: true }; });

ipcMain.handle('get-extension-info', () => ({ ...extensionState }));

ipcMain.handle('open-extension-folder', () => {
  if (!extensionState.targetDir) return { ok: false, error: 'no managed extension folder' };
  shell.openPath(extensionState.targetDir);
  return { ok: true, path: extensionState.targetDir };
});

// The Settings window's "Start Server" button. Unconditional restart rather
// than probe-first: the person clicking it believes the server is down, and a
// restart of a healthy server is cheap and harmless.
ipcMain.handle('start-server', () => {
  startServer(currentConfig || loadConfig() || {});
  return { ...serverState };
});

// Explicit update check with a real answer. checkForUpdates() resolves after
// the feed is fetched, so the event handlers above have already stamped
// updateState by the time we return it.
ipcMain.handle('check-for-updates', async () => {
  if (!autoUpdater || !app.isPackaged) {
    return { supported: false, ...updateState };
  }
  updateState.upToDate = false;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    updateState.checking = false;  // offline — leave upToDate false, no lie
  }
  return { supported: true, ...updateState };
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

// Deliberately NOT renamed alongside the v5.9.0 "Club Label Printer" rebrand
// (see changes.md), same as package.json's "name"/"appId" — this is the
// Windows taskbar-grouping/registry identity electron-builder's install and
// update machinery keys off, invisible to the operator either way. Changing
// it would make Windows treat the rebrand as a different app: a new install
// directory, a broken electron-updater upgrade path, and a stranded old copy
// nobody asked for. Only user-visible strings (window titles, tray text,
// shortcuts) changed.
app.setAppUserModelId('com.kvbc.awana-label-printer');

// ─── Roles: what runs on this computer ──────────────────────────────────────

const printServerDir = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'print-server')
  : path.join(__dirname, '..', 'print-server'));

// The passphrase typed in the wizard, held in memory only from a good
// sign-in until the wizard closes, so finishing it can sign the print server
// in too (its own /config/sync-login, which keeps its session in config.json
// as the dashboard's sign-in always has). Never written anywhere by this app.
let pendingPassphrase = null;
let printRoleStarted = false;

/**
 * Everything the printer app did at launch, now only when the print role is
 * on: the legacy import, the port check, the Chrome extension, the server,
 * the release ping, the check-in page, the old-shortcut offers.
 * `fromWizard`: the role was just turned on (the printer is already chosen).
 */
async function startPrintRole({ fromWizard = false } = {}) {
  if (printRoleStarted) return;
  printRoleStarted = true;

  // Import data from a legacy script install (C:\output) before anything
  // reads config — makes .exe-over-script upgrades seamless.
  const migration = runMigration(app.getPath('userData'));
  const oldBrandShortcuts = findOldBrandShortcuts();

  await resolvePortConflict();

  // Before the server starts, so the very first /health already reports the
  // folder and version. An update landed this launch; the operator should be
  // told about the owed Chrome restart from the moment the page loads.
  syncBundledExtension();

  const config = loadConfig() || {};
  currentConfig = config;

  // The server starts on EVERY launch of a print server — including the very
  // first one, before its printer is chosen. Without a configured printer it
  // prints to the system default until the setup save restarts it with the
  // chosen one.
  startServer(config);
  buildTray(config);

  // After currentConfig is populated (needs pusherKey/pusherCluster) and the
  // server has started (which is what would normally hold the Pusher config
  // fresh from a just-completed setup save, though this reads config.json
  // directly and does not depend on the server module at all).
  setupUpdatePush();

  // A new version landed this launch (the app wrote a newer extension to its
  // folder): restart Chrome so it loads it, on the check-in page only, at any
  // hour (owner, 7.4.1). Packaged builds only; it replaces the startup open.
  const restartChromeNow = app.isPackaged && extensionState.action === 'updated'
    && !!config.printerName && isSafeExternalUrl(config.checkinUrl);

  if (!config.printerName) {
    // A print server with no printer yet (the wizard was left before its
    // printer step, or an old config without one): the print server's own
    // setup, prefilled from a legacy config if one was migrated.
    if (roles.setupDone) createSetupWindow();
  } else if (restartChromeNow) {
    chromeRestart.restartChrome({
      url: String(config.checkinUrl).trim(),
      execFileSync, spawn, existsSync: fs.existsSync,
      openExternal: (u) => shell.openExternal(u),
      sleep: (ms) => new Promise(r => setTimeout(r, ms)),
      log: (m) => console.log(m),
    }).catch((e) => console.warn('[chrome] restart failed:', e && e.message));
  } else if (!isAutoStart || fromWizard) {
    // On login-item auto-start stay silent; only open the browser when a
    // person launched the app (or just finished setting it up).
    openExternalSafely(config.checkinUrl, fromWizard ? 'setup' : 'startup');
  }

  // Legacy shortcuts re-launch the old script install on every boot and fight
  // this app for port 3456 — offer to remove them once.
  if (migration.shortcuts.length && (migration.migrated || migration.legacyDir)) {
    const { response } = await dialog.showMessageBox({
      type: 'question',
      title: 'Old install found',
      message: 'Remove the old "Awana Check In" shortcuts?',
      detail: 'Your roster and settings were imported. The old desktop/startup shortcuts still point at the previous script-based install and can cause port conflicts:\n\n' + migration.shortcuts.join('\n'),
      buttons: ['Remove old shortcuts', 'Keep them'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) removeShortcuts(migration.shortcuts);
  }

  // The app was renamed ("Awana Label Printer" until 5.9.0, "Club Label
  // Printer" until 9.0.0). The installer renames the shortcuts it made
  // itself, but not copies a person made; offer once, same pattern as the
  // legacy-shortcut cleanup above.
  if (oldBrandShortcuts.length) {
    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: 'App renamed',
      message: `This app is now called "${APP_NAME}" (same app, same settings — just the name).`,
      detail: 'Remove the shortcut(s) with its old name?\n\n' + oldBrandShortcuts.join('\n'),
      buttons: ['Remove old shortcut(s)', 'Keep them'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) removeShortcuts(oldBrandShortcuts);
  }
}

/** Never throws: the print server's own sign-in, with the wizard's passphrase. */
function signPrintServerIn(passphrase) {
  const started = serverInstance;
  const ready = started && started.ready ? started.ready : Promise.resolve();
  Promise.race([ready, new Promise((_, no) => setTimeout(() => no(new Error('the print server did not start')), 30000))])
    .then(() => syncSession.syncUrl())
    .then((url) => new Promise((resolve, reject) => {
      if (!url) { reject(new Error('the sync service could not be found')); return; }
      const body = JSON.stringify({ passphrase, url });
      // No Origin header: the server trusts a loopback request without one
      // (isTrustedConfigOrigin), as it does curl on this machine.
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/config/sync-login', method: 'POST', timeout: 20000,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let text = '';
        res.on('data', (c) => { text += c; });
        res.on('end', () => (res.statusCode === 200 ? resolve() : reject(new Error(`HTTP ${res.statusCode} ${text.slice(0, 200)}`))));
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('timed out')));
      req.end(body);
    }))
    .then(() => console.log('[setup] The print server is signed in to the sync service.'))
    .catch((e) => {
      console.warn('[setup] The print server could not sign in:', e && e.message);
      try {
        if (Notification.isSupported()) new Notification({ title: APP_NAME, body: 'The print server could not sign in to the sync service. Sign it in from its dashboard (Settings, Sync service).' }).show();
      } catch { /* best effort */ }
    });
}

/**
 * Applies a checked roles change (rolesStore.checkRolesChange) and starts or
 * stops what it switches. The ONE path for a role change: the wizard today,
 * /settings' computer device (UNIFIED-APP.md) later, through 'roles:set'.
 * Turning print OFF restarts the app: the print server module, once loaded,
 * keeps club-night timers of its own that only a fresh process is rid of.
 */
async function applyRoles(next, { fromWizard = false } = {}) {
  const before = roles;
  roles = rolesStore.writeRoles(app.getPath('userData'), next);
  console.log('[roles] now', JSON.stringify(roles));
  const relaunch = before.print && !roles.print;
  if (!relaunch) {
    if (roles.print && !printRoleStarted) await startPrintRole({ fromWizard });
    if (roles.display && !display.isRunning()) display.start({ firstRun: fromWizard });
  }
  if (!roles.display && display.isRunning()) display.stop();
  refreshTray();
  if (relaunch) {
    setTimeout(() => {
      app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--auto-start') });
      app.isQuitting = true;
      app.quit();
    }, 1500);
  }
  return { relaunch };
}

const serverBusy = () => {
  try { return Boolean(serverModule && typeof serverModule.isBusy === 'function' && serverModule.isBusy()); } catch { return false; }
};

/** The wizard's Finish. Returns { ok, error? }; the wizard shows the error. */
async function finishSetup(choices) {
  const c = choices && typeof choices === 'object' ? choices : {};
  const check = rolesStore.checkRolesChange(roles, {
    print: c.print === true, display: c.display === true, name: typeof c.name === 'string' ? c.name : roles.name, setupDone: true,
  }, { printing: serverBusy() });
  if (!check.ok) return check;
  const next = check.roles;
  const launchOnBoot = c.launchOnBoot !== false;
  let printerChanged = false;
  try {
    if (next.print) {
      const printerName = typeof c.printerName === 'string' ? c.printerName.trim() : '';
      const checkinUrl = typeof c.checkinUrl === 'string' ? c.checkinUrl.trim() : '';
      if (!printerName) return { ok: false, error: 'Choose the label printer.' };
      if (!isSafeExternalUrl(checkinUrl)) return { ok: false, error: 'The check-in page has to be a web address (https://...).' };
      // A legacy script install's data first, so the wizard's keys merge over
      // it rather than the other way round (runMigration never overwrites).
      if (!roles.print) runMigration(app.getPath('userData'));
      printerChanged = roles.print && (loadConfig() || {}).printerName !== printerName;
      currentConfig = saveConfig({ printerName, checkinUrl, launchOnBoot });
    } else {
      currentConfig = saveConfig({ launchOnBoot });
    }
    applyLoginItemSettings(currentConfig);
    if (next.display) {
      display.configure({
        screen: c.screen,
        hours: c.hours,
        monitorId: Number.isInteger(c.monitorId) ? c.monitorId : undefined,
      });
    }
    await applyRoles(next, { fromWizard: true });
  } catch (e) {
    return { ok: false, error: `It could not be saved: ${e && e.message ? e.message : e}` };
  }
  if (roles.print && printerChanged) startServer(currentConfig);
  if (roles.print && pendingPassphrase) signPrintServerIn(pendingPassphrase);
  pendingPassphrase = null;
  return { ok: true, roles };
}

function openWizard() {
  if (!wizard) return;
  wizard.open();
  wizard.onClosed(() => {
    pendingPassphrase = null;
    refreshTray();
  });
}

// The hook for /settings' computer device (UNIFIED-APP.md; not wired to any
// page yet): what this computer is, and a change to it, through the same
// check and the same applyRoles() the wizard uses. Answered only to this
// app's own file:// windows, never to the remote screens in persist:lobby.
function deviceSnapshot() {
  const d = display.info();
  return {
    kind: 'computer',
    name: roles.name,
    roles: { print: roles.print, display: roles.display },
    setupDone: roles.setupDone,
    display: { screen: d.settings.screen, hours: d.settings.hours },
    version: app.getVersion(),
    sync: syncSession ? syncSession.status() : { signedIn: false },
  };
}
const fromOwnPage = (event) => String(event.senderFrame && event.senderFrame.url || event.sender.getURL()).startsWith('file:');
ipcMain.handle('roles:get', (event) => (fromOwnPage(event) ? deviceSnapshot() : null));
ipcMain.handle('roles:set', async (event, patch) => {
  if (!fromOwnPage(event)) return { ok: false, error: 'not allowed' };
  const check = rolesStore.checkRolesChange(roles, patch, { printing: serverBusy() });
  if (!check.ok) return check;
  await applyRoles(check.roles);
  return { ok: true, device: deviceSnapshot() };
});

/** Awana Lobby Display goes once its hand-off is applied; tried each start until it is gone. */
function removeOldAppIfHandedOff() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const userData = app.getPath('userData');
  const rec = handoff.readHandoffDone(userData);
  if (!rec || rec.oldAppRemoved === true) return;
  const run = (cmd, args) => new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 120000 }, (err, stdout) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || '') });
    });
  });
  oldApp.removeOldApp({
    run,
    exists: (p) => { try { return fs.existsSync(p); } catch { return false; } },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    fromExe: rec.from && typeof rec.from.exe === 'string' ? rec.from.exe : null,
    log: (m) => console.log(m),
  }).then((r) => {
    console.log('[old-app]', JSON.stringify(r));
    handoff.markOldAppRemoved(userData, r);
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  createPdfWindow();
  setupAutoUpdater();

  // 1. What this computer is (src/roles.js), decided before anything writes
  // to userData: a roles.json, else the sound room's hand-off, else printer
  // data from Club Label Printer 8.x (a print server, never the wizard or
  // the display), else a new install (the wizard).
  const pendingHandoff = handoff.readHandoff(userData);
  const decided = rolesStore.decideStartRoles({
    saved: rolesStore.readRoles(userData),
    handoff: pendingHandoff,
    printerData: rolesStore.hasPrinterData(userData),
  });
  roles = decided.roles;
  if (pendingHandoff) {
    const applied = handoff.applyHandoff(userData, pendingHandoff);
    console.log('[handoff] Awana Lobby Display handed over:', JSON.stringify(applied));
    if (applied.applied) saveConfig({ launchOnBoot: pendingHandoff.startWithWindows });
  }
  if (decided.write) {
    try { roles = rolesStore.writeRoles(userData, roles); } catch (e) { console.warn('[roles] could not save:', e.message); }
  }
  console.log(`[roles] ${decided.source}:`, JSON.stringify(roles));

  // 2. The pieces both roles share.
  display = createDisplay({
    userData,
    staticDir: path.join(__dirname, 'static', 'display'),
    iconPath: getIconPath() || undefined,
    isPackaged: app.isPackaged,
    version: () => app.getVersion(),
    // Windows' sign-in start (the login item passes --auto-start; the sound
    // room app's own passed --autostart) is quiet: no three-hour Show.
    quietStart: isAutoStart || process.argv.includes('--autostart'),
    smoke: process.argv.includes('--display-smoke-test'),
    getAutostart: autostartOn,
    setAutostart,
    onChange: refreshTray,
  });
  syncSession = createSyncSession({
    userData,
    safeStorage,
    syncClient: require(path.join(printServerDir(), 'sync-client.js')),
  });
  wizard = createSetupWizard({
    staticDir: path.join(__dirname, 'static'),
    iconPath: getIconPath() || undefined,
    state: () => {
      const cfg = loadConfig() || {};
      const d = display.info();
      const { screen } = require('electron');
      const here = findDisplay(screen.getAllDisplays(), d.monitor);
      return {
        version: app.getVersion(),
        hostname: os.hostname(),
        roles,
        config: { printerName: cfg.printerName || '', checkinUrl: cfg.checkinUrl || '', launchOnBoot: cfg.launchOnBoot !== false },
        display: { settings: d.settings, monitorId: here ? here.id : null },
        screens: Object.values(SCREENS).map(({ id, name }) => ({ id, name })),
        sync: syncSession.status(),
      };
    },
    printers: async () => {
      try {
        const list = await pdfWindow.webContents.getPrintersAsync();
        return list.map((p) => ({ name: p.name, isDefault: p.isDefault }));
      } catch { return []; }
    },
    signIn: async (passphrase) => {
      const r = await syncSession.signIn(passphrase);
      if (r.ok) pendingPassphrase = passphrase;
      return r;
    },
    finish: finishSetup,
  });

  const config = loadConfig() || {};
  currentConfig = config;
  applyLoginItemSettings(config);
  buildTray(config);

  // 3. The roles.
  if (roles.print) await startPrintRole();
  if (roles.display) display.start();
  refreshTray();

  if (!roles.setupDone) openWizard();
  removeOldAppIfHandedOff();
});

app.on('second-instance', () => {
  // Opening the app again (the Start menu or the desktop icon) while it runs
  // in the tray. A print server: almost always "it isn't printing", so make
  // sure the server is actually up, then show its window. A display: "show
  // it" (the sound room app's rule).
  if (!roles.setupDone) { openWizard(); return; }
  if (roles.print) {
    ensureServerRunning('app relaunched');
    createSetupWindow();
  }
  if (roles.display && display) display.requestShow();
});

// Keep process alive for the tray when all windows are closed
app.on('window-all-closed', () => {
  if (!app.isQuitting) {
    // intentionally do nothing — app lives in tray
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (display) display.beforeQuit();
  if (serverModule && serverModule.stopListening) serverModule.stopListening();
  else if (serverInstance) serverInstance.close();
  if (pdfWindow && !pdfWindow.isDestroyed()) pdfWindow.destroy();
  if (pusherClient) { try { pusherClient.disconnect(); } catch { /* quitting anyway */ } }
});
