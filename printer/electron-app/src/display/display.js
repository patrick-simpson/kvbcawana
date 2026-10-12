// The display role of KVBC Awana (v9, ROADMAP.md#kvbc-awana-one-app): the sound room app's
// main process (lobby/desktop/main.js, Awana Lobby Display 2.0.0), moved in
// as a module that main.js starts only when this computer's display role is
// on and stops when it is turned off. Its behaviour is the sound room app's
// (lobby/CLAUDE.md, "The sound room desktop app"), with three changes:
//
// - The hours are this computer's (settings.hours, default 17:00 to 20:00),
//   not a fixed 5:00 to 8:00 pm (owner, 2026-10-11).
// - The tray, the updater, Start with Windows and the single-instance lock
//   belong to main.js, shared with the print server: this module hands
//   main.js its tray items (menuItems) and asks for a tray refresh (onChange).
//   Updates install the moment they download (the sound room's rule, now the
//   whole app's); prepareInstall() marks the relaunch quiet first.
// - Its files are in userData\display\ (state.json, sources.json,
//   display.log); the browser profile is still `persist:lobby`.
//
// It puts the LIVE screen page (the lobby, the projector or Journey; see
// screens.js) full screen on the remembered monitor on club nights, within the
// hours, and takes it down again. Everything about WHEN lives in the pure
// modules beside this file; this file only wires them to Electron.
'use strict';

const { BrowserWindow, WebContentsView, ipcMain, net, powerMonitor, powerSaveBlocker, screen, session, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { clubNightToday, displayWindow, nextClubNight } = require('./clubNight');
const { NO_OVERRIDES, decideVisibility, hide, showNow, tidy } = require('./visibility');
const { findDisplay, rememberDisplay } = require('./displays');
const { SCREENS, isScreenPage, screenUrls } = require('./screens');
const { hoursMinutes, normalizeSettings, parseTime } = require('./settings');
const { shutdownDeadline, shutdownStep } = require('./shutdown');

const APP_NAME = 'KVBC Awana';
const SOURCES_EVERY_MS = 60 * 60 * 1000; // re-read the schedule and feed hourly
const RETRY_LOAD_MS = 30 * 1000;
const CURSOR_IDLE_MS = 3000;
// What the volunteer calls the monitor it goes on, in titles and the tray.
const WHERE = { lobby: 'the lobby TV', projector: 'the projector', journey: 'the Journey screen' };
const IPC_HANDLES = ['configure:get', 'configure:set'];
const IPC_EVENTS = ['card:cancel', 'chooser:choose', 'chooser:cancel', 'configure:choose-monitor', 'configure:reload-screen',
  'configure:reload-settings', 'configure:open-log', 'configure:cancel-shutdown'];

/**
 * @param {{
 *   userData: string, staticDir: string, iconPath: string, isPackaged: boolean, version: () => string,
 *   quietStart: boolean, smoke?: boolean,
 *   getAutostart: () => boolean, setAutostart: (on: boolean) => void,
 *   onChange: () => void,
 * }} opts
 */
function createDisplay(opts) {
  const DEV = !opts.isPackaged;
  // Development runs may point at a local preview instead (AWANA_LOBBY_SITE)
  // and fake the clock (AWANA_LOBBY_NOW, an ISO time that then runs on); a
  // packaged install ignores both.
  const SITE = (DEV && process.env.AWANA_LOBBY_SITE) || 'https://awana.kvbchurch.org/lobby/';
  const SCHEDULE_URL = new URL('shared/schedule.json', SITE).href;
  const FEED_URL = new URL('calendar-feed.json', SITE).href;
  const CLOCK_OFFSET = (() => {
    const fake = DEV && process.env.AWANA_LOBBY_NOW ? Date.parse(process.env.AWANA_LOBBY_NOW) : NaN;
    return Number.isFinite(fake) ? fake - Date.now() : 0;
  })();
  const now = () => new Date(Date.now() + CLOCK_OFFSET);
  // The release pipeline's install check: open the screen at once whatever the
  // clock says, write what loaded to smoke.json, and touch nothing else.
  const SMOKE = opts.smoke === true;

  /* ── Files in userData\display ───────────────────────────────────── */

  const dir = path.join(opts.userData, 'display');
  const statePath = path.join(dir, 'state.json');
  const sourcesPath = path.join(dir, 'sources.json');
  const logPath = path.join(dir, 'display.log');
  const staticFile = (name) => path.join(opts.staticDir, name);

  function log(...parts) {
    const line = `${new Date().toISOString()} ${parts.map((p) => (p instanceof Error ? p.stack || p.message : typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) fs.renameSync(logPath, `${logPath}.1`);
      fs.appendFileSync(logPath, line);
    } catch { /* logging never breaks the display */ }
    if (DEV) process.stdout.write(`[display] ${line}`);
  }

  function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
  }

  /** Written to a temp file and renamed, so a power cut never leaves half a file. */
  function writeJson(file, value) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) { log('write failed', file, err); }
  }

  let state = { display: null, overrides: NO_OVERRIDES, settings: normalizeSettings(null) };
  const saveState = () => writeJson(statePath, state);
  let sources = { schedule: null, feed: null, fetchedAt: 0 };
  const hours = () => hoursMinutes(state.settings.hours);

  // The screen this PC shows, and where it lives. Its window stays inside that
  // screen's folder: awana.kvbchurch.org also serves the other screens and the
  // printer's site.
  const urls = () => screenUrls(SITE, state.settings.screen);
  const pageUrl = () => urls().page;
  const isSitePage = (url) => isScreenPage(url, urls().base);
  const where = () => WHERE[urls().screen.id];

  let running = false;
  const timers = new Set();
  const later = (fn, ms) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); return t; };
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; };

  /* ── The schedule and the feed ─────────────────────────────────── */

  async function fetchJson(url) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await net.fetch(`${url}?t=${Date.now()}`, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Keeps the last good copy of each file on disk: a church whose internet is
   * down at 5 pm still opens on the right night. A file that fails to load or
   * does not look like itself keeps the copy we had.
   */
  async function refreshSources() {
    const [schedule, feed] = await Promise.allSettled([fetchJson(SCHEDULE_URL), fetchJson(FEED_URL)]);
    if (!running) return;
    let changed = false;
    if (schedule.status === 'fulfilled' && schedule.value && typeof schedule.value === 'object' && schedule.value.meeting) {
      sources.schedule = schedule.value;
      changed = true;
    } else if (schedule.status === 'rejected') log('schedule fetch failed', String(schedule.reason));
    if (feed.status === 'fulfilled' && feed.value && Array.isArray(feed.value.events)) {
      sources.feed = feed.value;
      changed = true;
    } else if (feed.status === 'rejected') log('feed fetch failed', String(feed.reason));
    if (changed) {
      sources.fetchedAt = Date.now();
      writeJson(sourcesPath, sources);
    }
    evaluate();
  }

  /* ── The screen's window ────────────────────────────────────────── */

  /** @type {BrowserWindow | null} */
  let lobby = null;
  let blocker = -1;
  let retryTimer = null;
  let closingByApp = false;
  let placedAs = null; // 'fullscreen' | 'windowed'
  // "Set up on this screen": the page in a normal window on the booth's main
  // monitor, so the display login, file pickers and Save dialogs are where the
  // volunteer is sitting instead of on the lobby TV. Ends with the showing.
  let setupMode = false;

  /**
   * Where the screen goes: the remembered monitor, full screen. With nothing
   * remembered and only one monitor, that one. Otherwise (the TV is off or
   * unplugged, or nobody has picked yet) a normal window on the main screen,
   * so someone notices; it moves to the TV the moment Windows sees it.
   */
  function target() {
    if (setupMode) return { display: screen.getPrimaryDisplay(), fullscreen: false };
    const displays = screen.getAllDisplays();
    const saved = findDisplay(displays, state.display);
    if (saved) return { display: saved, fullscreen: true };
    if (!state.display && displays.length === 1) return { display: displays[0], fullscreen: true };
    return { display: screen.getPrimaryDisplay(), fullscreen: false };
  }

  /** @param {boolean} [focus]  a person asked for it; the scheduled open never steals focus from the booth */
  function place(focus = false) {
    if (!lobby || lobby.isDestroyed()) return;
    const { display, fullscreen } = target();
    const wa = display.workArea;
    if (fullscreen) {
      const b = display.bounds;
      const current = lobby.getBounds();
      const onIt = lobby.isFullScreen() && current.x === b.x && current.y === b.y && current.width === b.width && current.height === b.height;
      if (!onIt) {
        if (lobby.isFullScreen()) lobby.setFullScreen(false);
        lobby.setBounds(b);
        lobby.setFullScreen(true);
      }
      // Shown inactive, a fullscreen window is not raised above the TV's own
      // taskbar ("taskbar on all displays"), which would cover the house waves
      // all night: keep it topmost there. Only on a TV that is NOT the main
      // monitor: on a one-screen PC, topmost would lock the volunteer out of
      // every other window.
      lobby.setAlwaysOnTop(screen.getAllDisplays().length > 1 && display.id !== screen.getPrimaryDisplay().id, 'screen-saver');
      lobby.setTitle(APP_NAME);
      placedAs = 'fullscreen';
    } else {
      lobby.setAlwaysOnTop(false);
      if (placedAs !== 'windowed') {
        if (lobby.isFullScreen()) lobby.setFullScreen(false);
        const width = Math.min(1280, Math.round(wa.width * 0.8));
        const height = Math.round(width * 9 / 16);
        lobby.setBounds({ x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height });
      }
      lobby.setTitle(setupMode
        ? `${APP_NAME}: setting up (choose "Back to ${where()}" in the tray when done)`
        : state.display
          ? `${APP_NAME}: ${where()} is not connected (it will move there when it is)`
          : `${APP_NAME}: choose ${where()} from the tray icon`);
      placedAs = 'windowed';
    }
    if (!lobby.isVisible()) {
      if (focus) lobby.show(); else lobby.showInactive();
    }
    if (focus) lobby.focus();
    // A screen (re)opened while someone is in Settings, say on switching screens
    // on a one-monitor PC, must not bury the window they are working in.
    else if (config && !config.isDestroyed() && config.isVisible()) config.moveTop();
    updateTray();
  }

  const CURSOR_CSS = 'html.lobby-cursor-idle, html.lobby-cursor-idle * { cursor: none !important; }';
  // The mouse lives in the booth: it hides itself over the TV after a few
  // seconds of stillness, and comes back the moment it moves.
  const CURSOR_JS = `(() => {
    if (window.__lobbyCursor) return; window.__lobbyCursor = true;
    const root = document.documentElement; let t = 0;
    const wake = () => { root.classList.remove('lobby-cursor-idle'); clearTimeout(t); t = setTimeout(() => root.classList.add('lobby-cursor-idle'), ${CURSOR_IDLE_MS}); };
    addEventListener('mousemove', wake, true); addEventListener('mousedown', wake, true); wake();
  })();`;

  function showOffline(wc) {
    wc.loadFile(staticFile('offline.html')).catch(() => {});
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (lobby && !lobby.isDestroyed()) lobby.loadURL(pageUrl()); }, RETRY_LOAD_MS);
  }

  function openLobby() {
    if (lobby && !lobby.isDestroyed()) { place(); return; }
    placedAs = null;
    lobby = new BrowserWindow({
      show: false,
      title: APP_NAME,
      icon: opts.iconPath,
      backgroundColor: urls().screen.background,
      autoHideMenuBar: true,
      webPreferences: {
        // One persistent profile: the page's own settings (display login,
        // slides) and its offline cache survive every restart.
        partition: 'persist:lobby',
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required',
        spellcheck: false,
      },
    });
    const wc = lobby.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (isSitePage(url) || url.startsWith('file:')) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    if (SMOKE) {
      wc.once('did-finish-load', () => later(() => writeJson(path.join(dir, 'smoke.json'), {
        version: opts.version(), url: wc.getURL(), title: wc.getTitle(), fullscreen: lobby?.isFullScreen() ?? false, at: new Date().toISOString(),
      }), 3000));
    }
    wc.on('dom-ready', () => {
      if (!isSitePage(wc.getURL())) return;
      wc.insertCSS(CURSOR_CSS).catch(() => {});
      wc.executeJavaScript(CURSOR_JS).catch(() => {});
    });
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* aborted by a newer load */) return;
      log('page failed to load', code, desc, url);
      showOffline(wc);
    });
    // A 404 or 5xx from Pages is a failed load too, never a page to sit on.
    wc.on('did-navigate', (_e, url, code) => {
      if (code >= 400 && isSitePage(url)) {
        log('page answered', code, url);
        showOffline(wc);
      }
    });
    // A crashed page is reloaded after a short wait, then longer waits; after
    // three crashes in ten minutes the offline card takes the screen and its
    // 30 s retry carries on. A page that HANGS is given 20 s and then
    // reloaded the same way.
    const crashes = [];
    const reloadAfterCrash = (why, details) => {
      const t = Date.now();
      while (crashes.length && t - crashes[0] > 10 * 60 * 1000) crashes.shift();
      crashes.push(t);
      log(why, details, `(${crashes.length} in the last 10 minutes)`);
      if (crashes.length >= 3) { showOffline(wc); return; }
      later(() => { if (lobby && !lobby.isDestroyed()) lobby.loadURL(pageUrl()); }, 3000 * crashes.length);
    };
    wc.on('render-process-gone', (_e, details) => reloadAfterCrash('page crashed', details));
    let hungTimer = null;
    wc.on('unresponsive', () => {
      clearTimeout(hungTimer);
      hungTimer = setTimeout(() => {
        hungTimer = null;
        if (lobby && !lobby.isDestroyed()) reloadAfterCrash('page hung for 20 s', {});
      }, 20_000);
    });
    wc.on('responsive', () => { clearTimeout(hungTimer); hungTimer = null; });
    // The page's own double-click fullscreen can leave the window part of it
    // behind when it ends; put the screen back where it belongs.
    lobby.on('leave-html-full-screen', () => later(place, 50));
    // Closing it by hand (Alt+F4, or the window's X while it is windowed) is
    // the tray's Hide: gone until the next club night.
    lobby.on('close', (event) => {
      if (closingByApp) return;
      // The setup window's X means "done setting up", never "hide tonight".
      if (setupMode) {
        event.preventDefault();
        setupMode = false;
        placedAs = null;
        place();
        return;
      }
      state.overrides = hide(state.overrides, currentWindow());
      saveState();
      log('closed by hand: hidden until the next club night');
    });
    const thisWindow = lobby;
    lobby.on('closed', () => {
      // A stale 'closed' from a window already replaced (Hide, then Show at
      // once) must not drop the reference to the live one.
      if (lobby !== thisWindow) return;
      lobby = null;
      placedAs = null;
      updateTray();
    });
    lobby.once('ready-to-show', () => place());
    // A page that hangs before its first paint still gets a window.
    later(() => { if (lobby && !lobby.isDestroyed() && !lobby.isVisible()) place(); }, 10_000);
    lobby.loadURL(pageUrl());
    log('screen opened', urls().screen.id);
  }

  /**
   * Keeps the PC and its screens awake while the screen is up AND all through
   * a club night before the close: a PC switched on at 4:15 and left alone
   * would otherwise be asleep (or its screens off) when the hours begin, and a
   * timer cannot wake a sleeping machine. 'prevent-display-sleep' blocks
   * system sleep too.
   */
  function holdAwake(want) {
    if (want && blocker < 0) blocker = powerSaveBlocker.start('prevent-display-sleep');
    if (!want) stopBlocker();
  }

  function stopBlocker() {
    if (blocker >= 0 && powerSaveBlocker.isStarted(blocker)) powerSaveBlocker.stop(blocker);
    blocker = -1;
  }

  function closeLobby() {
    clearTimeout(retryTimer);
    setupMode = false;
    if (!lobby || lobby.isDestroyed()) return;
    // Chromium writes localStorage lazily: commit tonight's login, tally and
    // seen-set before the page goes, so a reboot or power cut loses nothing.
    try { lobby.webContents.session.flushStorageData(); } catch { /* best effort */ }
    closingByApp = true;
    try { lobby.destroy(); } finally { closingByApp = false; }
    lobby = null;
    placedAs = null;
    log('screen closed');
  }

  /* ── The clock ──────────────────────────────────────────────────── */

  const currentWindow = () => displayWindow(now(), sources, hours());
  let lastReason = null;

  /**
   * The schedule itself has the screen up right now (inside the window and
   * not hidden for it), whatever a manual Show also says. Judged WITHOUT the
   * manual override on purpose: a Show from before the open is still running
   * an hour in, and a second click then must not stretch the showing past the
   * close.
   */
  function scheduledNow(t = now()) {
    const win = displayWindow(t, sources, hours());
    return win.inWindow && state.overrides.hiddenForWindow !== win.windowKey;
  }

  /**
   * "Show it" from a person (the tray, or opening the app again). Already up
   * for club night, it only brings the window back where it belongs.
   */
  function requestShow() {
    if (!running) return;
    const t = now();
    if (!scheduledNow(t)) {
      state.overrides = showNow(state.overrides, t.getTime());
      saveState();
    }
    evaluate();
    if (lobby && !lobby.isDestroyed()) place(true);
  }

  /** The whole rule, re-asked every minute on the minute and after anything changes. */
  function evaluate() {
    if (!running) return;
    const t = now();
    const win = displayWindow(t, sources, hours());
    const tidied = tidy(state.overrides, win, t.getTime());
    if (tidied !== state.overrides) { state.overrides = tidied; saveState(); }
    const { visible, reason } = SMOKE ? { visible: true, reason: 'manual' } : decideVisibility(win, state.overrides, t.getTime());
    if (reason !== lastReason) { log('state', reason, win.dateKey); lastReason = reason; }
    if (visible) openLobby(); else closeLobby();
    const clubNightAhead = nextClubNight(t, sources, 60, hours()) === win.dateKey && win.minutes < hours().closeMin;
    // A PC asleep at the shutdown time never shuts down: an armed shutdown
    // keeps it awake past the close until its time comes.
    const shutdownAhead = checkShutdown(t, win);
    holdAwake(visible || clubNightAhead || shutdownAhead);
    updateTray();
  }

  let tickTimer = null;
  function scheduleTick() {
    clearTimeout(tickTimer);
    if (!running) return;
    // On the minute (plus a hair), so the open and the close land on time.
    // The next tick is armed BEFORE the rule runs: a throw inside evaluate()
    // must not end the schedule for good.
    const ms = 60_000 - (now().getTime() % 60_000) + 150;
    tickTimer = setTimeout(() => {
      scheduleTick();
      try { evaluate(); } catch (err) { log('evaluate failed', err); }
    }, ms);
  }

  /* ── The optional club-night shutdown ───────────────────────────── */

  // In memory on purpose (shutdown.js): a restart disarms tonight's.
  let armedFor = null;
  let cancelledFor = null;
  /** @type {{ dateKey: string, deadline: number, timer: NodeJS.Timeout, card: BrowserWindow | null } | null} */
  let warning = null;

  /**
   * Re-asked with the schedule every minute. Starts the two-minute warning
   * when it is due; turning the setting off stops one already running.
   * Returns whether a shutdown is still ahead tonight (to keep the PC awake).
   */
  function checkShutdown(t, win) {
    const { enabled, at } = state.settings.shutdown;
    const atMin = parseTime(at);
    const on = enabled && atMin != null && !SMOKE;
    if (!on) { if (warning) stopWarning('turned off'); return false; }
    const clubNight = clubNightToday(t, sources);
    const step = shutdownStep({ enabled: on, atMin }, { dateKey: win.dateKey, minutes: win.minutes, clubNight, armedFor, cancelledFor });
    if (step === 'arm') armedFor = win.dateKey;
    // Once running, a warning runs to its end (or a Cancel).
    if (step === 'warn' && !warning) startWarning(win.dateKey, shutdownDeadline(t.getTime(), win.minutes, atMin));
    return Boolean(warning) || step === 'arm';
  }

  /** The warning: a small card in the corner of the main monitor, never a dialog. */
  function startWarning(dateKey, deadline) {
    log('shutdown warning', { dateKey, at: new Date(deadline).toISOString() });
    const timer = setTimeout(shutDownNow, Math.max(0, deadline - now().getTime()));
    warning = { dateKey, deadline, timer, card: null };
    const wa = screen.getPrimaryDisplay().workArea;
    const width = 380;
    const height = 96;
    const card = new BrowserWindow({
      x: wa.x + wa.width - width - 20,
      y: wa.y + wa.height - height - 20,
      width, height,
      frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, focusable: true, backgroundColor: '#1E2230',
      title: `${APP_NAME}: shutting down`,
      webPreferences: { preload: staticFile('card-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    warning.card = card;
    card.on('closed', () => { if (warning?.card === card) warning.card = null; });
    card.loadFile(staticFile('shutdown.html'), {
      query: { deadline: String(deadline - CLOCK_OFFSET), at: fmtTime(deadline) },
    });
    // Above a full-screen screen on a one-monitor PC, without taking the focus.
    card.once('ready-to-show', () => { card.setAlwaysOnTop(true, 'screen-saver'); card.showInactive(); });
    updateTray();
  }

  function stopWarning(why) {
    if (!warning) return;
    log('shutdown stopped:', why);
    clearTimeout(warning.timer);
    if (warning.card && !warning.card.isDestroyed()) warning.card.destroy();
    warning = null;
    updateTray();
  }

  /** "Not tonight": the card's Cancel, or the tray's. Holds for this night only. */
  function cancelShutdown() {
    if (!warning) return;
    cancelledFor = warning.dateKey;
    stopWarning('cancelled for tonight');
  }

  function shutDownNow() {
    if (!warning) return;
    // A timer that fires long after its time (the PC slept through the
    // countdown after all) is not a warning anyone saw: stand down.
    if (now().getTime() - warning.deadline > 60_000) { stopWarning('missed its time (asleep?)'); return; }
    log('shutting down the PC');
    try { session.fromPartition('persist:lobby').flushStorageData(); } catch { /* best effort */ }
    warning.card?.webContents.send('card:shutting-down');
    if (DEV || process.platform !== 'win32') {
      log('(development run: not shutting down)');
      later(() => stopWarning('development run'), 5000);
      return;
    }
    // No /f: an app holding unsaved work (a sermon file in the booth) gets to
    // ask, rather than lose it.
    execFile('shutdown.exe', ['/s', '/t', '0'], (err) => {
      if (err) { log('shutdown failed', err); stopWarning('shutdown.exe failed'); }
    });
  }

  /* ── Choosing the monitor ──────────────────────────────────────── */

  /** @type {Map<number, { win: BrowserWindow, display: Electron.Display }>} */
  const choosers = new Map();

  function closeChoosers() {
    for (const { win } of choosers.values()) if (!win.isDestroyed()) win.destroy();
    choosers.clear();
  }

  /** One numbered card on every monitor; the one clicked becomes the screen's monitor. */
  function openChooser() {
    if (!running) return;
    closeChoosers();
    const displays = screen.getAllDisplays();
    const savedHere = findDisplay(displays, state.display);
    displays.forEach((display, i) => {
      const wa = display.workArea;
      const width = Math.min(620, wa.width - 40);
      const height = Math.min(420, wa.height - 40);
      const win = new BrowserWindow({
        x: wa.x + Math.round((wa.width - width) / 2),
        y: wa.y + Math.round((wa.height - height) / 2),
        width, height,
        frame: false, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
        alwaysOnTop: true, skipTaskbar: true, show: false, backgroundColor: '#FAA41D',
        title: `${APP_NAME}: choose ${where()}`,
        webPreferences: { preload: staticFile('chooser-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
      });
      const id = win.webContents.id;
      choosers.set(id, { win, display });
      win.on('closed', () => choosers.delete(id));
      win.loadFile(staticFile('chooser.html'), {
        query: {
          n: String(i + 1),
          label: display.label || `Monitor ${i + 1}`,
          size: `${display.size.width} x ${display.size.height}`,
          current: savedHere && savedHere.id === display.id ? '1' : '',
          what: urls().screen.short,
        },
      });
      // Above the topmost screen on the TV.
      win.once('ready-to-show', () => { win.setAlwaysOnTop(true, 'screen-saver'); win.show(); win.moveTop(); });
    });
  }

  function chooseDisplay(display) {
    state.display = rememberDisplay(display);
    saveState();
    log('monitor chosen', state.display);
    closeChoosers();
    place();
    evaluate();
  }

  /* ── The screen it shows ────────────────────────────────────────── */

  /** Switches the screen. One that is up is replaced at once, on the same monitor. */
  function setScreen(id) {
    const next = normalizeSettings({ ...state.settings, screen: id });
    if (next.screen === state.settings.screen) return;
    const wasUp = Boolean(lobby);
    state.settings = next;
    saveState();
    log('screen chosen', next.screen);
    if (wasUp) closeLobby();
    evaluate();
    loadConfigScreen();
  }

  /** New hours apply at once: the screen opens or closes on the next evaluate. */
  function setHours(h) {
    const next = normalizeSettings({ ...state.settings, hours: h });
    state.settings = next;
    saveState();
    log('hours', next.hours);
    evaluate();
  }

  /* ── The configurator (Settings, from the tray) ────────────────── */

  // A normal window on the booth's main monitor. Its left column is the
  // display's own settings (static/display/configure.html, a small preload
  // bridge); the rest is the chosen screen's own settings page (its
  // `?configure=1` mode) in the same browser profile, so every change there
  // reaches the live screen through the profile's shared storage, and the
  // screen-side buttons are relayed to it over a BroadcastChannel
  // (lobby/CLAUDE.md, "Configure mode"). The screen is never reloaded.

  /** @type {BrowserWindow | null} */
  let config = null;
  /** @type {WebContentsView | null} */
  let configView = null;
  // The left column and the header of configure.html: change both together.
  const CONFIG_HEADER = 64;
  const CONFIG_SIDE = 360;
  let configRetry = null;

  function layoutConfig() {
    if (!config || config.isDestroyed() || !configView) return;
    const [width, height] = config.getContentSize();
    configView.setBounds({ x: CONFIG_SIDE, y: CONFIG_HEADER, width: Math.max(0, width - CONFIG_SIDE), height: Math.max(0, height - CONFIG_HEADER) });
  }

  function loadConfigScreen() {
    if (!configView) return;
    configView.webContents.loadURL(urls().configure).catch(() => {});
  }

  function openConfigurator() {
    if (!running) return;
    if (config && !config.isDestroyed()) {
      if (config.isMinimized()) config.restore();
      config.show();
      config.focus();
      return;
    }
    const wa = screen.getPrimaryDisplay().workArea;
    const width = Math.min(1280, wa.width - 40);
    const height = Math.min(820, wa.height - 40);
    config = new BrowserWindow({
      x: wa.x + Math.round((wa.width - width) / 2),
      y: wa.y + Math.round((wa.height - height) / 2),
      width, height, minWidth: 900, minHeight: 560,
      show: false,
      title: `${APP_NAME}: Display settings`,
      icon: opts.iconPath,
      backgroundColor: '#F6F4EF',
      autoHideMenuBar: true,
      webPreferences: { preload: staticFile('configure-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    configView = new WebContentsView({
      webPreferences: { partition: 'persist:lobby', contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
    });
    configView.setBackgroundColor('#F6F4EF');
    config.contentView.addChildView(configView);
    const vc = configView.webContents;
    vc.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    vc.on('will-navigate', (event, url) => {
      if (isSitePage(url) || url.startsWith('file:')) return;
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    });
    vc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      log('settings page failed to load', code, url);
      vc.loadFile(staticFile('settings-offline.html')).catch(() => {});
      clearTimeout(configRetry);
      configRetry = setTimeout(loadConfigScreen, RETRY_LOAD_MS);
    });
    config.on('resize', layoutConfig);
    const thisWindow = config;
    config.on('closed', () => {
      clearTimeout(configRetry);
      if (config !== thisWindow) return;
      config = null;
      configView = null;
    });
    config.loadFile(staticFile('configure.html'));
    config.once('ready-to-show', () => { layoutConfig(); config?.show(); });
    layoutConfig();
    loadConfigScreen();
    log('settings opened');
  }

  function configState() {
    const displays = screen.getAllDisplays();
    const saved = findDisplay(displays, state.display);
    return {
      version: opts.version(),
      dev: DEV,
      settings: state.settings,
      screens: Object.values(SCREENS).map(({ id, name }) => ({ id, name })),
      monitor: saved ? (saved.label || `${saved.size.width} x ${saved.size.height}`) : null,
      monitors: displays.length,
      where: where(),
      status: statusLine(),
      autostart: opts.getAutostart(),
      warning: warning ? { at: fmtTime(warning.deadline) } : null,
    };
  }

  function pushConfigState() {
    if (config && !config.isDestroyed()) config.webContents.send('configure:state', configState());
  }

  function applyPatch(patch) {
    if (!patch || typeof patch !== 'object') return;
    if (typeof patch.screen === 'string') setScreen(patch.screen);
    if (patch.hours && typeof patch.hours === 'object') setHours({ ...state.settings.hours, ...patch.hours });
    if (patch.shutdown && typeof patch.shutdown === 'object') {
      state.settings = normalizeSettings({ ...state.settings, shutdown: { ...state.settings.shutdown, ...patch.shutdown } });
      saveState();
      log('shutdown settings', state.settings.shutdown);
      evaluate();
    }
    if (typeof patch.autostart === 'boolean') opts.setAutostart(patch.autostart);
  }

  function wireIpc() {
    ipcMain.on('card:cancel', cancelShutdown);
    ipcMain.on('chooser:choose', (event) => {
      const picked = choosers.get(event.sender.id);
      if (picked) chooseDisplay(picked.display);
    });
    ipcMain.on('chooser:cancel', () => closeChoosers());
    ipcMain.handle('configure:get', () => configState());
    ipcMain.handle('configure:set', (_e, patch) => {
      applyPatch(patch);
      updateTray();
      return configState();
    });
    ipcMain.on('configure:choose-monitor', () => openChooser());
    ipcMain.on('configure:reload-screen', () => { if (lobby && !lobby.isDestroyed()) lobby.loadURL(pageUrl()); });
    ipcMain.on('configure:reload-settings', () => loadConfigScreen());
    ipcMain.on('configure:open-log', () => shell.openPath(logPath));
    ipcMain.on('configure:cancel-shutdown', cancelShutdown);
  }

  function unwireIpc() {
    for (const ch of IPC_HANDLES) ipcMain.removeHandler(ch);
    for (const ch of IPC_EVENTS) ipcMain.removeAllListeners(ch);
  }

  /* ── The tray (main.js builds it; these are the display's lines) ── */

  const churchZone = () => sources.schedule?.timezone || 'America/New_York';
  const fmtTime = (ms) => {
    try { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: churchZone() }); }
    catch { return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  };
  const clock = (min) => {
    const h = Math.floor(min / 60) % 24; const m = min % 60;
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  };

  function statusLine() {
    const t = now();
    const win = displayWindow(t, sources, hours());
    const { reason } = decideVisibility(win, state.overrides, t.getTime());
    if (reason === 'schedule') return `On screen for club night, until ${clock(hours().closeMin)}`;
    if (reason === 'manual') return `Shown by hand, until ${fmtTime(state.overrides.manualUntil)}`;
    if (reason === 'hidden') return 'Hidden until the next club night';
    const next = nextClubNight(t, sources, 60, hours());
    if (!next) return 'No club night in the next two months';
    const [y, m, d] = next.split('-').map(Number);
    const day = new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `Next club night: ${day}, ${clock(hours().openMin)}`;
  }

  function updateTray() {
    if (!running) return;
    try { opts.onChange(); } catch (err) { log('tray refresh failed', err); }
    pushConfigState();
  }

  /** The display's part of the tray menu (Electron MenuItem templates). */
  function menuItems() {
    if (!running) return [];
    const t = now();
    const win = displayWindow(t, sources, hours());
    const { visible } = decideVisibility(win, state.overrides, t.getTime());
    const overridden = state.overrides.manualUntil > t.getTime() || state.overrides.hiddenForWindow != null;
    const items = [{ label: `Display: ${statusLine()}`, enabled: false }];
    if (lobby && placedAs === 'windowed') {
      const w = where();
      items.push({ label: state.display ? `${w[0].toUpperCase()}${w.slice(1)} not found: showing in a window` : `No monitor chosen for ${w} yet`, enabled: false });
    }
    if (warning) {
      items.push({ label: `Shutting down at ${fmtTime(warning.deadline)}`, enabled: false });
      items.push({ label: 'Cancel tonight’s shutdown', click: cancelShutdown });
    }
    items.push(
      { label: 'Display settings...', click: openConfigurator },
      {
        label: 'Screen',
        submenu: Object.values(SCREENS).map(({ id, name }) => ({
          label: name, type: 'radio', checked: state.settings.screen === id, click: () => setScreen(id),
        })),
      },
      { label: 'Show now (for 3 hours)', enabled: !scheduledNow(t), click: requestShow },
      { label: 'Hide until the next club night', enabled: visible, click: () => { state.overrides = hide(state.overrides, currentWindow()); saveState(); evaluate(); } },
      { label: 'Resume schedule', enabled: overridden, click: () => { state.overrides = NO_OVERRIDES; saveState(); evaluate(); } },
      setupMode
        ? { label: `Back to ${where()}`, click: () => { setupMode = false; placedAs = null; place(true); } }
        : { label: 'Set up on this screen (in a window)', click: () => { setupMode = true; requestShow(); place(true); } },
      { label: `Choose ${where()}...`, click: openChooser },
      { label: 'Reload the screen', enabled: Boolean(lobby), click: () => lobby?.loadURL(pageUrl()) },
      { label: 'Open the display log', click: () => shell.openPath(logPath) },
    );
    return items;
  }

  /* ── Start and stop ─────────────────────────────────────────────── */

  const onDisplaysChanged = (ev) => () => {
    log('displays changed', ev);
    place();
    if (!state.display && screen.getAllDisplays().length > 1 && !choosers.size) openChooser();
  };
  const screenListeners = ['display-added', 'display-removed', 'display-metrics-changed'].map((ev) => [ev, onDisplaysChanged(ev)]);
  const onResume = () => { evaluate(); scheduleTick(); refreshSources(); };
  const onUnlock = () => evaluate();

  let sessionWired = false;
  let uncaughtWired = false;
  function wireSession() {
    if (sessionWired) return;
    sessionWired = true;
    // Deny by default what the remote page may ask for: in Chrome each of
    // these would prompt, and Electron's default is to grant them all
    // silently (the booth microphone, the clipboard, OS protocol handlers from
    // an iframe). The screens use fullscreen (double-click), the screen wake
    // lock and persistent storage; nothing else.
    const lobbySession = session.fromPartition('persist:lobby');
    const ALLOWED = new Set(['fullscreen', 'screen-wake-lock', 'persistent-storage', 'clipboard-sanitized-write']);
    lobbySession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED.has(permission)));
    lobbySession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
    // Settings and slide exports are <a download> links: save them straight
    // to Downloads and show the file, instead of a Save dialog on the TV.
    lobbySession.on('will-download', (_e, item) => {
      const { app } = require('electron');
      const file = path.join(app.getPath('downloads'), item.getFilename());
      item.setSavePath(file);
      item.once('done', (_ev, st) => { if (st === 'completed') shell.showItemInFolder(file); log('download', st, file); });
    });
  }

  function loadState() {
    const saved = readJson(statePath, {});
    state = { display: null, overrides: NO_OVERRIDES, ...(saved && typeof saved === 'object' ? saved : {}) };
    if (!state.overrides || typeof state.overrides !== 'object') state.overrides = NO_OVERRIDES;
    state.settings = normalizeSettings(state.settings);
    sources = { schedule: null, feed: null, fetchedAt: 0, ...readJson(sourcesPath, {}) };
  }

  /** @param {{ firstRun?: boolean }} [how]  firstRun: the role was just turned on (the wizard) */
  function start(how = {}) {
    if (running) return;
    running = true;
    // An uncaught error in the main process would otherwise put Electron's
    // modal error dialog on the lobby TV. Log it and carry on; the schedule
    // and the window's own reload path do the recovering. Installed once, the
    // first time the display role runs (a print-only computer keeps
    // Electron's default).
    if (!uncaughtWired) {
      uncaughtWired = true;
      process.on('uncaughtException', (err) => { log('uncaught exception', err); });
      process.on('unhandledRejection', (reason) => { log('unhandled rejection', reason instanceof Error ? reason : new Error(String(reason))); });
    }
    loadState();
    wireSession();
    wireIpc();
    log(`start ${opts.version()}`, { site: SITE, argv: process.argv.slice(1), clockOffset: CLOCK_OFFSET });
    // The app keeps the church's clock (schedule.json's timezone); the page
    // keeps the PC's. They only disagree if Windows is set to the wrong zone.
    const pcZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (pcZone !== churchZone()) log(`warning: this PC's time zone is ${pcZone}, the church's is ${churchZone()}`);

    // Started by hand rather than by Windows at sign-in, or just turned on in
    // the wizard: the person wants to see it (and to sign the screen in). An
    // update's relaunch (quietRelaunch, set by prepareInstall or the sound
    // room's hand-off) is not a person.
    const quiet = SMOKE || (opts.quietStart && !how.firstRun) || state.quietRelaunch === true;
    if (state.quietRelaunch) { delete state.quietRelaunch; saveState(); }
    if (!quiet && !scheduledNow()) {
      state.overrides = showNow(state.overrides, now().getTime());
      saveState();
    }

    evaluate();
    scheduleTick();
    refreshSources();
    every(refreshSources, SOURCES_EVERY_MS);

    // First run with more than one monitor and none chosen: ask which one.
    if (!SMOKE && !state.display && screen.getAllDisplays().length > 1) openChooser();

    for (const [ev, fn] of screenListeners) screen.on(ev, fn);
    powerMonitor.on('resume', onResume);
    powerMonitor.on('unlock-screen', onUnlock);
  }

  /** Turns the display role off: every window it owns closes, every timer stops. */
  function stop() {
    if (!running) return;
    log('stop');
    stopWarning('display turned off');
    closeChoosers();
    closeLobby();
    if (config && !config.isDestroyed()) config.destroy();
    config = null;
    configView = null;
    clearTimeout(tickTimer);
    clearTimeout(retryTimer);
    clearTimeout(configRetry);
    for (const t of timers) { clearTimeout(t); clearInterval(t); }
    timers.clear();
    stopBlocker();
    for (const [ev, fn] of screenListeners) screen.removeListener(ev, fn);
    powerMonitor.removeListener('resume', onResume);
    powerMonitor.removeListener('unlock-screen', onUnlock);
    unwireIpc();
    running = false;
  }

  /** The installer's relaunch has no --auto-start: mark it quiet first. */
  function prepareInstall() {
    if (!running) return;
    state.quietRelaunch = true;
    saveState();
    closingByApp = true;
  }

  /** The install did not happen after all: the next launch is a person's again. */
  function cancelInstall() {
    if (!running) return;
    state.quietRelaunch = false;
    saveState();
    closingByApp = false;
  }

  function beforeQuit() {
    closingByApp = true;
    try { if (lobby && !lobby.isDestroyed()) lobby.webContents.session.flushStorageData(); } catch { /* best effort */ }
  }

  /**
   * The wizard's choices (and, later, /settings'): screen, hours, and a
   * monitor by its Electron display id. Works whether or not the role is
   * running yet (state.json is the record).
   */
  function configure({ screen: screenId, hours: h, monitorId } = {}) {
    if (!running) loadState();
    if (typeof screenId === 'string') state.settings = normalizeSettings({ ...state.settings, screen: screenId });
    if (h && typeof h === 'object') state.settings = normalizeSettings({ ...state.settings, hours: h });
    if (monitorId != null) {
      const d = screen.getAllDisplays().find((x) => x.id === monitorId);
      if (d) state.display = rememberDisplay(d);
    }
    saveState();
    if (running) {
      // A new screen or monitor reopens it; new hours alone (from /settings)
      // only open or close it on the next evaluate, like setHours.
      if (typeof screenId === 'string' || monitorId != null) { closeLobby(); evaluate(); loadConfigScreen(); }
      else { evaluate(); pushConfigState(); }
    }
    return state.settings;
  }

  /** For the tray tooltip and the /settings hook. */
  function info() {
    if (!running) loadState();
    return { running, settings: state.settings, monitor: state.display, status: running ? statusLine() : null };
  }

  return {
    start, stop, isRunning: () => running,
    menuItems, statusLine, requestShow, openConfigurator, openChooser,
    prepareInstall, cancelInstall, beforeQuit, configure, info, log,
  };
}

module.exports = { createDisplay, APP_NAME };
