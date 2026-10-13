/* The Awana sync service, Journey's half (owner, 2026-10-01: "type kennebec
   and have it sync everything up").

   The family's screens share one always-on service (the Awana Check-in
   Display repo's worker/). This kiosk signs in to it with the church
   passphrase from Settings, and then its ROOM settings follow every other
   Journey screen: captions on/off, caption size and backdrop, the teaching
   slides' auto-advance and extras, and tonight's edited bullets. The leader
   prep transcript choice stays on this device, because it depends on the
   leader.

   - The sign-in lives in the SAME localStorage slots the lobby signage uses
     (this page and the embedded Check-in Display share an origin), so signing
     in here also sets the embedded lobby screen up, and the other way round.
   - Light on purpose: one fetch at start, one every
     ten minutes and on reconnect, and one PUT a second after a room setting
     changes here. No socket of its own.
   - Until the display site's shared/sync.json names a service, the Settings
     section stays hidden and nothing here runs.
   - Sign-in is passphrase v2 (lobby/worker/src/routes.md section 1): the
     passphrase is turned into an authKey HERE and only that is sent. The
     protocol dance is the family's one copy, lobby/shared/sync-protocol.js, and
     the derivation lobby/shared/cloud-crypto.js: both are loaded as ES modules
     at sign-in from src/shared/ (copied by scripts/family-assets.mjs, never
     edited). The derivation is 600000 PBKDF2 rounds, about a second ONCE, off
     the page's thread; nothing re-derives afterwards (every later
     request rides the session).
   - Signed in, the kiosk also says hello to the screen registry
     (POST /v1/screens/hello, kind 'journey', lobby/worker/src/routes.md 10.7)
     so awana.kvbchurch.org/settings lists it, with how saving the lessons is
     going (schedule.js's journeyDownloadStatus(), trimmed to numbers,
     switches and one short reason; also when it has not looked yet or
     cannot save lessons here). Its id is made once and kept in the
     lobby's own slot, awanaScreens.v1, under 'journey'. A hello every two
     minutes, and one when the status changes, never two within a minute.
     Silent when signed out, unreachable, or in configure mode (the app's
     Settings window is not a second kiosk).
   - The settings page can work this kiosk's "Lessons on this computer"
     (owner 2026-10-12, /settings → Journey): the hello's answer carries what
     it asked since the last hello (`actions`, each handed over once by the
     service, lobby/worker/src/routes.md 10.8), checked against
     REMOTE_ACTIONS and run through schedule.js's own buttons
     (window.journeySettingsPage); and this kiosk's two switches (automatic
     download, Leader Videos) are its own settings there, taken when the
     page changed them and sent up when they were changed here.
   - No socket of its own, so the embedded Check-in Display (which listens)
     passes the service's doorbell up with postMessage
     ({type: 'awana-display:sync-doorbell', what, id}, same origin, from that
     very iframe only): 'journey' pulls the room settings now, a 'screen' or
     'screen-action' for THIS kiosk's id says hello now (never twice in
     bellGapMs). Without it, the ten-minute pull and two-minute hello still
     carry everything.
   - The phone remote (owner 2026-10-13, awana.kvbchurch.org/journey/remote/;
     lobby/worker/src/routes.md 10.9): one press on a leader's phone goes to
     every Journey kiosk. The Worker keeps it 20 seconds and rings this kiosk's
     doorbell; the doorbell makes this page ask POST /v1/screens/now at once
     (light: no storage on the service), which hands the presses over, each
     ONCE (a press id is also never run twice here), and they run through
     schedule.js's window.journeyRemote.command (the page's own functions).
     While a phone is watching (the answer's `watch`, also in the hello's),
     the same request carries what the screen shows (journeyRemote.now()):
     on every change, never twice within nowGapMs (700 ms), and every
     playingMs (10 s) (a playing video's position; a press whose doorbell was
     missed). Nobody watching: nothing extra is sent at all. A service without the route (404) falls back to the hello.
   - A 401 on any request (the pull, a push, the hello, the phone remote's
     poll, the switches) means the service no longer knows this session: it
     is dropped as a sign-out drops it, and every remote poll and timer stops
     until a new sign-in (never a request every few seconds that can only be
     refused). */

(function () {
  'use strict';

  var SYNC_INDEX = new URL('../lobby/shared/sync.json', window.location.href).href;
  var SESSION_KEY = 'awanaSyncSession.v1';
  var DISPLAY_KEY = 'awanaDisplayKey.v1';
  var CONFIG_KEY = 'awanaConfig.v1';
  var APPLIED_KEY = 'journey.sync.savedAt';
  var POLL_MS = 10 * 60 * 1000;
  var REQUEST_TIMEOUT_MS = 8000;   // one answer or none: a hung request must not hold a pull or a push forever
  var PUSH_DELAY_MS = 1000;
  var SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
  // Where the two shared ES modules are (next to this script). A test seam may
  // hand them over directly: window.journeyAuthModules = { sp, cc }.
  var SHARED_BASE = new URL('shared/', (document.currentScript && document.currentScript.src) || new URL('src/sync.js', window.location.href)).href;

  // The room keys, in Journey's own storage formats (schedule.js owns them).
  var KEYS = {
    captions: 'journey.captions',
    captionSize: 'journey.captions.size',
    captionBackdrop: 'journey.captions.backdrop',
    slidesAutoAdvanceSec: 'journey.slides.autoAdvanceSec',
    slideExtras: 'journey.slides.extras',
    slideNotes: 'journey.slides.notesOverride',
  };
  var CAPTION_SIZES = ['0.8', '1', '1.3', '1.6'];

  // The screen registry (the lobby's lib/screenSync.js format).
  var SCREENS_KEY = 'awanaScreens.v1';
  var SCREEN_KIND = 'journey';
  var SCREEN_NAME = 'Journey kiosk';
  var SCREEN_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
  var SCREEN_TUNING = {
    helloMs: 2 * 60 * 1000, minGapMs: 60 * 1000, bellGapMs: 3000, ackMs: 4000, ackWindowMs: 30 * 1000, prefsDelayMs: 1000,
    nowGapMs: 700, playingMs: 10 * 1000, pollGapMs: 250,
  };
  // What the settings page may ask this kiosk to do: exactly the lobby's
  // SCREEN_ACTIONS.journey (lobby/src/lib/syncSpecs.js; its screenSpecs.test.js
  // reads this line and fails if the two lists differ).
  var REMOTE_ACTIONS = ['start-downloads', 'pause-downloads', 'resume-downloads', 'stop-downloads', 'delete-downloads'];
  var REMOTE_ACTIONS_MAX = 5;
  var DOORBELL_MESSAGE = 'awana-display:sync-doorbell';
  // What the phone remote may ask: exactly lobby/shared/journeyRemote.js
  // JOURNEY_REMOTE_ACTIONS (test/phone-remote.test.mjs reads this line).
  var PHONE_ACTIONS = ['slide-next', 'slide-prev', 'slides-start', 'play', 'pause', 'toggle-pause', 'seek', 'mute', 'unmute', 'begin', 'pick'];
  var PHONE_ACTIONS_MAX = 12;
  var PHONE_SEEN_MAX = 64;
  var STATUS_ERROR_MAX = 120;
  var CONFIGURE = (function () {
    try { return new URLSearchParams(window.location.search).get('configure') === '1'; } catch (e) { return false; }
  })();

  var base = '';
  var pushTimer = null;
  var lastPushed = '';
  var helloTimer = null;
  var statusTimer = null;
  var lastHelloAt = 0;
  var lastStatusSent = '';
  var screenGone = false; // a service without the registry (404): stop asking
  var ackUntil = 0; // until then, a status change says hello after ackMs (a command was just run)
  var bellTimer = null;
  var pullTimer = null;
  var prefsTimer = null;
  // The phone remote.
  var watched = false; // a phone read the room's state lately (the service says so)
  var nowGone = false; // a service without POST /v1/screens/now (404): the hello carries presses instead
  var nowTimer = null;
  var playingTimer = null;
  var remoteBellTimer = null;
  var lastNowAt = 0;
  var lastNowSent = '';
  var phoneSeen = []; // press ids already run (never twice)

  function get(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function set(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch (e) { return false; }
  }
  function session() {
    var s = (get(SESSION_KEY) || '').trim();
    return SESSION_RE.test(s) ? s : '';
  }
  function normalize(p) {
    return String(p == null ? '' : p).trim().normalize('NFKC').toLowerCase();
  }
  function parse(json) {
    try { return JSON.parse(json); } catch (e) { return null; }
  }

  /* This device's room settings, as the service stores them. */
  function readRoom() {
    var out = {};
    var cc = get(KEYS.captions);
    if (cc === 'on' || cc === 'off') out.captions = cc === 'on';
    var size = get(KEYS.captionSize);
    if (CAPTION_SIZES.indexOf(size) !== -1) out.captionSize = size;
    var backdrop = get(KEYS.captionBackdrop);
    if (backdrop === 'on' || backdrop === 'off') out.captionBackdrop = backdrop === 'on';
    var auto = get(KEYS.slidesAutoAdvanceSec);
    if (auto !== null && isFinite(Number(auto))) out.slidesAutoAdvanceSec = Number(auto);
    var extras = parse(get(KEYS.slideExtras));
    if (extras && typeof extras === 'object') out.slideExtras = extras;
    var notes = parse(get(KEYS.slideNotes));
    if (notes && typeof notes === 'object') out.slideNotes = notes;
    return out;
  }

  /* The service's room settings into this device's storage, then the live
     page brought up to date through schedule.js's own helpers. Captions
     on/off takes effect at the next video, the way a stored choice does. */
  function applyRoom(s) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.captions === 'boolean') set(KEYS.captions, s.captions ? 'on' : 'off');
    if (CAPTION_SIZES.indexOf(s.captionSize) !== -1) set(KEYS.captionSize, s.captionSize);
    if (typeof s.captionBackdrop === 'boolean') set(KEYS.captionBackdrop, s.captionBackdrop ? 'on' : 'off');
    if (typeof s.slidesAutoAdvanceSec === 'number') set(KEYS.slidesAutoAdvanceSec, String(s.slidesAutoAdvanceSec));
    if (s.slideExtras && typeof s.slideExtras === 'object') set(KEYS.slideExtras, JSON.stringify(s.slideExtras));
    if (s.slideNotes && typeof s.slideNotes === 'object') set(KEYS.slideNotes, JSON.stringify(s.slideNotes));
    lastPushed = JSON.stringify(readRoom());
    var sizeSelect = document.getElementById('captions-size');
    var backdropBox = document.getElementById('captions-backdrop');
    if (sizeSelect && s.captionSize) sizeSelect.value = s.captionSize;
    if (backdropBox && typeof s.captionBackdrop === 'boolean') backdropBox.checked = s.captionBackdrop;
    try {
      if (typeof window.applyCaptionDisplayPrefs === 'function') window.applyCaptionDisplayPrefs();
      if (typeof window.syncSlidesPrefInputs === 'function') window.syncSlidesPrefInputs();
    } catch (e) { /* the stored values still apply on the next load */ }
  }

  /* The passphrase v2 modules, loaded once, on the first sign-in. */
  var authModules = null;
  function loadAuth() {
    if (window.journeyAuthModules) return Promise.resolve(window.journeyAuthModules);
    if (authModules) return authModules;
    authModules = Promise.all([import(SHARED_BASE + 'sync-protocol.js'), import(SHARED_BASE + 'cloud-crypto.js')])
      .then(function (m) { return { sp: m[0], cc: m[1] }; }, function () { authModules = null; return null; });
    return authModules;
  }

  function request(path, opts) {
    opts = opts || {};
    var headers = {};
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.session) headers.Authorization = 'Bearer ' + opts.session;
    return fetch(base + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
    }).then(function (res) {
      return res.json().then(function (b) { return { ok: res.ok, status: res.status, body: b }; },
        function () { return { ok: res.ok, status: res.status, body: null }; });
    }, function () { return { ok: false, status: 0, body: null }; });
  }

  function note(text, tone) {
    var el = document.getElementById('sync-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone || 'muted';
  }

  function render() {
    var section = document.getElementById('settings-sync');
    if (!section) return;
    section.classList.toggle('hidden', !base);
    var signedIn = Boolean(session());
    document.getElementById('sync-signin').classList.toggle('hidden', signedIn);
    document.getElementById('sync-signed-in').classList.toggle('hidden', !signedIn);
  }

  /* The service refused this session (the passphrase was changed, or the
     session was revoked): this screen is signed out, says why, and nothing
     that rides the session keeps asking (the phone remote's polls and timers
     stop; the hello and the pull stay quiet) until a new sign-in. Only the
     session that was refused is dropped: a newer one signed in meanwhile is
     kept. */
  function sessionRefused(s) {
    if (s && session() !== s) return;
    set(SESSION_KEY, null);
    stopPhone();
    render();
    note('The passphrase was changed. Type the new one to sign this screen in again.', 'bad');
  }

  function pull() {
    var s = session();
    if (!base || !s) return Promise.resolve();
    return request('/v1/state', { session: s }).then(function (res) {
      if (res.status === 401) { sessionRefused(s); return; }
      if (!res.ok || !res.body) return;
      var journey = res.body.journey;
      if (!journey || typeof journey.savedAt !== 'string') return;
      if (journey.savedAt === get(APPLIED_KEY)) return;
      // A change made here that has not gone up yet (its push is waiting, or
      // failed) is newer than what the room holds: it is sent, not overwritten.
      if (JSON.stringify(readRoom()) !== lastPushed) { push(); return; }
      applyRoom(journey.settings);
      set(APPLIED_KEY, journey.savedAt);
    });
  }

  function push() {
    var s = session();
    if (!base || !s) return;
    var room = readRoom();
    var snapshot = JSON.stringify(room);
    if (snapshot === lastPushed) return;
    request('/v1/journey', { method: 'PUT', body: { settings: room }, session: s }).then(function (res) {
      if (res.ok && res.body && typeof res.body.savedAt === 'string') {
        lastPushed = snapshot;
        set(APPLIED_KEY, res.body.savedAt);
        note('Saved for every Journey screen.', 'ok');
      } else if (res.status === 401) {
        sessionRefused(s);
      } else {
        note('Could not reach the sync service, so this change stayed on this screen.', 'bad');
      }
    });
  }

  function schedulePush() {
    if (!base || !session()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
  }

  /* ── This kiosk on the settings page ── */

  // A test may shorten the waits (read at each use).
  function screenTuning() {
    var t = window.journeyScreenTuning || {};
    var out = {};
    Object.keys(SCREEN_TUNING).forEach(function (k) { out[k] = typeof t[k] === 'number' ? t[k] : SCREEN_TUNING[k]; });
    return out;
  }

  function screensAll() {
    var all = parse(get(SCREENS_KEY));
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  }
  function screenSlot() {
    var slot = screensAll()[SCREEN_KIND];
    return slot && typeof slot === 'object' && SCREEN_ID_RE.test(slot.id) ? slot : null;
  }
  function saveScreenSlot(patch) {
    var all = screensAll();
    all[SCREEN_KIND] = Object.assign({}, all[SCREEN_KIND] || {}, patch);
    return set(SCREENS_KEY, JSON.stringify(all));
  }
  /* This kiosk's id: 16 random bytes, url-safe, made once. '' when storage
     is blocked (a kiosk that cannot keep an id would register anew at every
     load, so it does not register). */
  function screenId() {
    var have = screenSlot();
    if (have) return have.id;
    var c = window.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return '';
    var bytes = c.getRandomValues(new Uint8Array(16));
    var id = btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (!saveScreenSlot({ id: id, synced: null })) return '';
    var check = screenSlot();
    return check && check.id === id ? id : '';
  }

  function count(v, max) {
    return typeof v === 'number' && isFinite(v) ? Math.min(max, Math.max(0, Math.floor(v))) : 0;
  }
  /* The saved lessons, trimmed to exactly what the registry keeps. Always an
     answer once schedule.js has loaded, so /settings never shows nothing:
     `known` is false until the kiosk has read its disk (a few minutes after
     load), `supported` false where this browser cannot save lessons at all
     (a Mac or a phone without the storage it needs). null only when there is
     no schedule.js to ask. */
  function lessonsStatus() {
    var fn = window.journeyDownloadStatus;
    if (typeof fn !== 'function') return null;
    var s;
    try { s = fn(); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    var supported = s.supported === true;
    return {
      saved: count(s.saved, 999),
      total: count(s.total, 999),
      bytesSaved: count(s.bytesSaved, 1e13),
      bytesTotal: count(s.bytesTotal, 1e13),
      downloading: s.downloading === true,
      waiting: Boolean(s.waiting),
      paused: s.paused === true,
      percent: count(s.percent, 100),
      currentWeek: typeof s.currentWeek === 'number' && s.currentWeek >= 1 ? count(s.currentWeek, 99) : null,
      lastSavedAt: typeof s.lastSavedAt === 'string' ? s.lastSavedAt : null,
      error: typeof s.error === 'string' && s.error ? s.error.slice(0, STATUS_ERROR_MAX) : null,
      auto: s.auto === true,
      leaders: s.leaders !== false,
      known: supported && s.known === true,
      supported: supported,
    };
  }

  function scheduleHello() {
    clearTimeout(helloTimer);
    helloTimer = setTimeout(hello, screenTuning().helloMs);
  }

  /* One hello: who this kiosk is, and how its saved lessons are going.
     The next one is two minutes after the last, whatever started it. */
  function hello() {
    if (CONFIGURE || !base || screenGone) return Promise.resolve();
    clearTimeout(statusTimer);
    statusTimer = null;
    scheduleHello();
    var s = session();
    if (!s) return Promise.resolve();
    var id = screenId();
    if (!id) return Promise.resolve();
    var slot = screenSlot() || {};
    var body = { id: id, kind: SCREEN_KIND, name: typeof slot.name === 'string' && slot.name ? slot.name : SCREEN_NAME };
    var status = lessonsStatus();
    var snapshot = status ? JSON.stringify(status) : '';
    if (status) body.status = { lessons: status };
    lastHelloAt = Date.now();
    return request('/v1/screens/hello', { method: 'POST', body: body, session: s }).then(function (res) {
      if (res.status === 404) { screenGone = true; clearTimeout(helloTimer); return; }
      if (res.status === 401) { sessionRefused(s); return; }
      if (!res.ok || !res.body || !res.body.screen) return;
      if (status) lastStatusSent = snapshot;
      var name = res.body.screen.name;
      if (typeof name === 'string' && name && name !== slot.name) saveScreenSlot({ name: name.slice(0, 40) });
      reconcilePrefs(res.body.settings);
      if (Array.isArray(res.body.actions)) runActions(res.body.actions);
      if (Array.isArray(res.body.remote)) runPhone(res.body.remote);
      if (typeof res.body.watch === 'boolean') setWatched(res.body.watch, true);
    });
  }

  /* ── The phone remote ── */

  function phone() {
    var r = window.journeyRemote;
    return r && typeof r.command === 'function' && typeof r.now === 'function' ? r : null;
  }

  /* Each press in order, each id once, only the allowlisted actions. */
  function runPhone(list) {
    var r = phone();
    if (!r || !Array.isArray(list)) return 0;
    var ran = 0;
    for (var i = 0; i < list.length && i < PHONE_ACTIONS_MAX; i++) {
      var item = list[i];
      if (!item || typeof item !== 'object' || PHONE_ACTIONS.indexOf(item.action) === -1) continue;
      if (typeof item.id === 'string') {
        if (phoneSeen.indexOf(item.id) !== -1) continue;
        phoneSeen.push(item.id);
        if (phoneSeen.length > PHONE_SEEN_MAX) phoneSeen.shift();
      }
      try { r.command({ id: item.id, action: item.action, data: item.data }); ran++; } catch (e) { /* reported as skipped by schedule.js */ }
    }
    return ran;
  }

  function currentNow() {
    var r = phone();
    if (!r) return null;
    try { return r.now(); } catch (e) { return null; }
  }

  /* The report without the moving clock: a change worth sending at once. */
  function nowKey(now) {
    if (!now) return '';
    var copy = {};
    Object.keys(now).forEach(function (k) { if (k !== 'at') copy[k] = now[k]; });
    if (copy.video) copy.video = { d: copy.video.d, paused: copy.video.paused, muted: copy.video.muted, t: copy.video.paused ? copy.video.t : null };
    return JSON.stringify(copy);
  }

  function setWatched(on, sendNow) {
    var was = watched;
    watched = on === true;
    if (!watched) {
      clearTimeout(nowTimer); nowTimer = null;
      clearTimeout(playingTimer); playingTimer = null;
      return;
    }
    if (sendNow && !was) reportSoon(true);
    armPlaying();
  }

  /* Signed out (here, elsewhere, or refused by the service): no phone is
     watching as far as this kiosk knows, and no remote timer is left to
     fire. A new sign-in's hello says again whether one watches. */
  function stopPhone() {
    setWatched(false);
    clearTimeout(remoteBellTimer);
    remoteBellTimer = null;
    lastNowSent = '';
  }

  /* While a phone watches: one poll every playingMs (10 s), carrying the
     video's position while one plays, and collecting any press whose
     doorbell was missed (the embedded display reconnecting) well inside its
     20 seconds. Nobody watching: no timer at all. */
  function armPlaying() {
    clearTimeout(playingTimer);
    playingTimer = null;
    if (!watched || !session()) return;
    playingTimer = setTimeout(function () { playingTimer = null; reportSoon(true); }, screenTuning().playingMs);
  }

  /* One POST /v1/screens/now: collect presses, and say what the screen shows
     when asked to (`withNow`). Resolves once the answer is handled. */
  function phonePoll(withNow) {
    var s = session();
    var slot = screenSlot();
    if (CONFIGURE || !base || screenGone || !s || !slot) return Promise.resolve();
    if (nowGone) return hello();
    var body = { id: slot.id };
    var now = withNow ? currentNow() : null;
    if (now) body.now = now;
    lastNowAt = Date.now();
    if (now) lastNowSent = nowKey(now);
    return request('/v1/screens/now', { method: 'POST', body: body, session: s }).then(function (res) {
      if (res.status === 404 && !(res.body && res.body.error && /Journey screen/.test(res.body.error))) {
        // An older service: the hello carries what /settings asked, as before.
        nowGone = true;
        return hello();
      }
      if (res.status === 404) return hello(); // forgotten on /settings: the hello registers it again
      if (res.status === 401) { sessionRefused(s); return; }
      if (!res.ok || !res.body) return;
      if (Array.isArray(res.body.actions)) runPhone(res.body.actions);
      if (res.body.hello === true) helloAfter(0);
      setWatched(res.body.watch === true, false);
    });
  }

  /* A change while a phone watches: sent, never twice within nowGapMs. */
  function reportSoon(force) {
    if (CONFIGURE || !base || screenGone || nowGone || !session() || !watched) return;
    if (!force && nowKey(currentNow()) === lastNowSent) return;
    if (nowTimer) return;
    var wait = Math.max(0, lastNowAt + screenTuning().nowGapMs - Date.now());
    nowTimer = setTimeout(function () {
      nowTimer = null;
      phonePoll(true).then(armPlaying, armPlaying);
    }, wait);
  }

  function onScreenChanged() {
    if (watched) reportSoon(false);
  }

  /* ── What the settings page asked (the hello's answer) ── */

  function remote() {
    var r = window.journeySettingsPage;
    return r && typeof r === 'object' ? r : null;
  }

  /* Each allowlisted command, in order, through schedule.js's own buttons;
     then a hello a few seconds later so the page sees the new state. */
  function runActions(list) {
    var r = remote();
    if (!r || typeof r.command !== 'function') return 0;
    var ran = 0;
    for (var i = 0; i < list.length && i < REMOTE_ACTIONS_MAX; i++) {
      var action = list[i] && typeof list[i] === 'object' ? list[i].action : null;
      if (REMOTE_ACTIONS.indexOf(action) === -1) continue;
      try { if (r.command(action)) ran++; } catch (e) { /* the next press tries again */ }
    }
    if (ran) {
      ackUntil = Date.now() + screenTuning().ackWindowMs;
      helloAfter(screenTuning().ackMs);
    }
    return ran;
  }

  function helloAfter(ms) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusTimer = null; hello(); }, ms);
  }

  /* The two switches, in the service's shape (only real booleans). */
  function cleanPrefs(s) {
    var out = {};
    if (s && typeof s === 'object') {
      if (typeof s.downloadsAuto === 'boolean') out.downloadsAuto = s.downloadsAuto;
      if (typeof s.downloadsLeader === 'boolean') out.downloadsLeader = s.downloadsLeader;
    }
    return out;
  }
  function localPrefs() {
    var r = remote();
    if (!r || typeof r.prefs !== 'function') return null;
    var p;
    try { p = r.prefs(); } catch (e) { return null; }
    return p && typeof p === 'object' ? { downloadsAuto: p.auto === true, downloadsLeader: p.leaders !== false } : null;
  }
  function samePrefs(a, b) {
    return a.downloadsAuto === b.downloadsAuto && a.downloadsLeader === b.downloadsLeader;
  }
  function syncedPrefs() {
    var slot = screenSlot();
    var synced = slot && slot.synced;
    return synced && typeof synced === 'object' && typeof synced.savedAt === 'string'
      ? { savedAt: synced.savedAt, settings: cleanPrefs(synced.settings) } : null;
  }

  /* The service's copy of this kiosk's switches against this computer's:
     changed there since they last agreed = take it; else a change made here
     (or a service that has none yet) goes up. */
  function reconcilePrefs(raw) {
    var local = localPrefs();
    if (!local) return;
    var there = raw && typeof raw === 'object' && typeof raw.savedAt === 'string'
      ? { savedAt: raw.savedAt, settings: cleanPrefs(raw.settings) } : null;
    var agreed = syncedPrefs();
    if (there && (!agreed || agreed.savedAt !== there.savedAt)) {
      var patch = {};
      if (typeof there.settings.downloadsAuto === 'boolean') patch.auto = there.settings.downloadsAuto;
      if (typeof there.settings.downloadsLeader === 'boolean') patch.leaders = there.settings.downloadsLeader;
      try { remote().setPrefs(patch); } catch (e) { /* the next hello tries again */ }
      saveScreenSlot({ synced: there });
      local = localPrefs() || local;
      if (!samePrefs(local, there.settings)) pushPrefs(local); // a switch the service did not have yet
      return;
    }
    if (!there || !agreed || !samePrefs(local, agreed.settings)) pushPrefs(local);
  }

  function pushPrefs(prefs) {
    var s = session();
    var slot = screenSlot();
    if (CONFIGURE || !base || screenGone || !s || !slot) return Promise.resolve();
    return request('/v1/screens/' + encodeURIComponent(slot.id) + '/settings', { method: 'PUT', body: { settings: prefs }, session: s })
      .then(function (res) {
        if (res.ok && res.body && typeof res.body.savedAt === 'string') {
          saveScreenSlot({ synced: { savedAt: res.body.savedAt, settings: cleanPrefs(res.body.settings) } });
        } else if (res.status === 401) {
          sessionRefused(s);
        }
      });
  }

  /* A tick box changed here: up a second later, if it differs from the service's. */
  function schedulePrefsPush() {
    if (CONFIGURE || !base || screenGone || !session()) return;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(function () {
      var local = localPrefs();
      var agreed = syncedPrefs();
      if (local && (!agreed || !samePrefs(local, agreed.settings))) pushPrefs(local);
    }, screenTuning().prefsDelayMs);
  }

  /* The embedded Check-in Display rang: the service has something for this kiosk. */
  function onDoorbell(event) {
    var frame = document.querySelector('#checkin-view iframe');
    if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
    var d = event.data;
    if (!d || typeof d !== 'object' || d.type !== DOORBELL_MESSAGE) return;
    if (CONFIGURE || !base || !session()) return;
    if (d.what === 'journey') {
      clearTimeout(pullTimer);
      pullTimer = setTimeout(pull, 250);
      return;
    }
    if (d.what !== 'screen' && d.what !== 'screen-action') return;
    var slot = screenSlot();
    if (!slot || d.id !== slot.id) return;
    if (d.what === 'screen-action' && !nowGone) {
      // A press from the phone (or from /settings, which the answer says): the
      // light poll, carrying what the screen shows, at once.
      if (remoteBellTimer) return;
      var soon = Math.max(0, lastNowAt + screenTuning().pollGapMs - Date.now());
      remoteBellTimer = setTimeout(function () {
        remoteBellTimer = null;
        phonePoll(true).then(armPlaying, armPlaying);
      }, soon);
      return;
    }
    if (bellTimer) return;
    var wait = Math.max(0, lastHelloAt + screenTuning().bellGapMs - Date.now());
    bellTimer = setTimeout(function () { bellTimer = null; hello(); }, wait);
  }

  /* The download status changed: a hello when it differs from the last one
     sent, never sooner than a minute after the last hello. */
  function statusChanged() {
    if (CONFIGURE || !base || screenGone || !session() || statusTimer) return;
    var status = lessonsStatus();
    if (!status || JSON.stringify(status) === lastStatusSent) return;
    var gap = Date.now() < ackUntil ? screenTuning().ackMs : screenTuning().minGapMs;
    var wait = Math.max(0, lastHelloAt + gap - Date.now());
    statusTimer = setTimeout(function () {
      statusTimer = null;
      var now = lessonsStatus();
      if (now && JSON.stringify(now) !== lastStatusSent) hello();
    }, wait);
  }

  function signIn() {
    var input = document.getElementById('sync-passphrase');
    var passphrase = normalize(input.value);
    if (!passphrase) { note('Type the passphrase first.', 'bad'); return; }
    note('Signing in… (the first time takes a few seconds)');
    loadAuth().then(function (m) {
      // The modules did not load (offline file, old browser): today's login, which a service that still has the old hash accepts.
      if (!m) return request('/v1/login', { method: 'POST', body: { passphrase: passphrase } });
      return m.sp.signInWithPassphrase({ request: request, derive: m.cc.deriveAuthKey, passphrase: passphrase })
        .then(function (out) { return out.res; });
    }).then(function (res) {
      var b = res.body || {};
      if (res.status === 401) {
        note('That is not the passphrase.' + (typeof b.triesLeft === 'number' ? ' ' + b.triesLeft + ' tries left before a 15-minute wait.' : ''), 'bad');
        return;
      }
      if (res.status === 429) { note('Too many wrong tries. Wait a little, then try again.', 'bad'); return; }
      if (!res.ok || !SESSION_RE.test(b.session || '') || typeof b.displayKey !== 'string') {
        note(res.status === 0 ? 'Could not reach the sync service. Check the internet connection.' : (b.error || 'Sign-in failed.'), 'bad');
        return;
      }
      set(SESSION_KEY, b.session);
      set(DISPLAY_KEY, b.displayKey);
      // The embedded lobby screen shares this storage: hand it the Pusher key
      // too if it has none, so it is fully set up by the same sign-in.
      var cfg = parse(get(CONFIG_KEY)) || {};
      if (b.pusher && b.pusher.key && !cfg.pusherAppKey) {
        cfg.pusherAppKey = b.pusher.key;
        if (b.pusher.cluster) cfg.pusherCluster = b.pusher.cluster;
        set(CONFIG_KEY, JSON.stringify(cfg));
      }
      input.value = '';
      render();
      note('Signed in. Room settings now follow every Journey screen.', 'ok');
      hello();
      var journey = b.state && b.state.journey;
      if (journey && typeof journey.savedAt === 'string') {
        applyRoom(journey.settings);
        set(APPLIED_KEY, journey.savedAt);
      } else {
        // First Journey screen signed in: its settings become the room's.
        lastPushed = '';
        push();
      }
      var frame = document.querySelector('#checkin-view iframe');
      if (frame && frame.contentWindow) {
        try { frame.contentWindow.location.reload(); } catch (e) { /* cross-origin: it picks the keys up on its next load */ }
      }
    });
  }

  function signOut() {
    set(SESSION_KEY, null);
    stopPhone();
    render();
    note('Signed out. This screen keeps its settings.', 'muted');
  }

  function start() {
    var btn = document.getElementById('sync-signin-btn');
    if (btn) btn.addEventListener('click', signIn);
    var input = document.getElementById('sync-passphrase');
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') signIn(); });
    var out = document.getElementById('sync-signout-btn');
    if (out) out.addEventListener('click', signOut);
    // Any change in the Settings card, or a CC press, may have changed a room
    // setting; push() sends only when the room's values actually differ.
    var card = document.getElementById('settings-card');
    if (card) {
      card.addEventListener('change', schedulePush);
      card.addEventListener('input', schedulePush);
      card.addEventListener('click', schedulePush);
      card.addEventListener('change', function (e) {
        if (e.target && (e.target.id === 'downloads-auto' || e.target.id === 'downloads-leaders')) schedulePrefsPush();
      });
    }
    window.addEventListener('message', onDoorbell);
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('#cc-btn, .cc-btn, [data-captions-toggle]')) schedulePush();
    });

    // The index names the service. One failed read used to leave sync dead
    // until the next reload (days, on a kiosk): it is retried with backoff
    // until it is read, and the index may also honestly say there is no
    // service yet (url ""), which is not a failure.
    var attempt = 0;
    function readIndex() {
      fetch(SYNC_INDEX, { cache: 'no-store', signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (d) {
          var url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
          if (!/^https:\/\/[^\s?#]+$/.test(url)) return;
          base = url;
          lastPushed = JSON.stringify(readRoom());
          render();
          pull();
          setInterval(pull, POLL_MS);
          window.addEventListener('online', pull);
          hello();
          window.addEventListener('online', function () {
            if (Date.now() - lastHelloAt >= screenTuning().minGapMs) hello();
          });
          window.addEventListener('journey-download-status', statusChanged);
          window.addEventListener('journey-remote-change', onScreenChanged);
        }, function () {
          setTimeout(readIndex, indexRetryWait(attempt++));
        });
    }
    readIndex();

    // A sign-in or sign-out made in another window of this origin (the sound
    // room app's configure page beside this kiosk, or the embedded lobby
    // screen, which shares the slot) reaches this one here: the session is
    // read from storage on every use, so the card is redrawn and, signed in,
    // the room's settings are pulled now rather than at the next ten-minute
    // tick. Every other key is ignored at the cost of one comparison.
    window.addEventListener('storage', function (e) {
      if (e.key !== SESSION_KEY && e.key !== null) return;
      render();
      if (session()) { pull(); hello(); } else stopPhone();
    });
  }
  // 15 s, 30 s, 60 s, then every five minutes.
  function indexRetryWait(n) { return Math.min(15000 * Math.pow(2, n), 5 * 60 * 1000); }

  // Test seam: the jsdom harness drives the same functions the page uses.
  window.journeySync = {
    readRoom: readRoom, applyRoom: applyRoom, pull: pull, push: push, signIn: signIn, signOut: signOut, indexRetryWait: indexRetryWait,
    hello: hello, lessonsStatus: lessonsStatus, runActions: runActions, reconcilePrefs: reconcilePrefs,
    phonePoll: phonePoll, runPhone: runPhone, watching: function () { return watched; },
  };

  start();
})();
