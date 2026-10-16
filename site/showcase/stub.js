// The showcase stand-in: the first script of every showcase twin page
// (lobby/showcase.html, lobby/countdown-showcase.html, lobby/settings-showcase.html,
// journey/showcase.html, checkin/showcase.html), which site/build.mjs makes from the
// real built page by putting this file INLINE at the top of its <head>. The home
// page frames the twins and plays a club night on them.
//
// The screens' own code is untouched: everything still arrives the way it does on a
// club night (the one live socket, every frame through its allowlist sanitizer), only
// the far end is this file instead of the sync Worker. It stands in for:
//   storage      localStorage and sessionStorage live in memory, seeded per screen;
//                IndexedDB, BroadcastChannel and service workers are switched off.
//                A volunteer who opens the home page on a signed-in phone keeps
//                their real session, settings and saved roster untouched.
//   the clock    Date runs from the time the home page sets (a Wednesday club night).
//   the Worker   shared/sync.json names a stand-in address; its routes answer from a
//                made-up roster; /v1/live is a socket the home page feeds.
//   the network  weather, TwoTimTwo and the laptop's print server are refused.
// Every name is made up. Nothing here is a secret: the session is a placeholder and
// the history key's private half was thrown away when it was made.
(function showcaseStandIn() {
  'use strict';
  var KIND = (window.__SHOWCASE__ && window.__SHOWCASE__.kind) || 'lobby';
  var BASE = 'https://showcase.invalid/api';
  var SESSION = 'v1.1.1790839331729.oWr6n92IJW5ldPGmtiyjPHAZpca-QGToNlKGXlKI6vc';
  // A public key made once for the showcase (cloud-crypto generateKeyPair); rows the
  // check-in page seals to it can never be opened by anyone.
  var HISTORY_PIN = { pub: 'BMFi1fA8lnjaktxFD7bC8JAAQEX00s965ROv4JvS41Vl39JSGsnwFiG1ZKZwRcRLuh2rSHZDXMcv4M/Buvq8kzc=', kid: '7dd195ba46640b8a' };
  var parentOrigin = location.origin;
  var tell = function (what, data) {
    try { if (window.parent !== window) window.parent.postMessage({ type: 'showcase:event', kind: KIND, what: what, data: data }, parentOrigin); } catch (e) { /* not framed */ }
  };

  // ── storage, in memory ─────────────────────────────────────────────────────
  function memoryStorage(seed) {
    var map = new Map(Object.entries(seed || {}));
    var store = {
      get length() { return map.size; },
      key: function (i) { return Array.from(map.keys())[i] ?? null; },
      getItem: function (k) { k = String(k); return map.has(k) ? map.get(k) : null; },
      setItem: function (k, v) { map.set(String(k), String(v)); },
      removeItem: function (k) { map.delete(String(k)); },
      clear: function () { map.clear(); },
    };
    return store;
  }
  var LOBBY_CONFIG = JSON.stringify({ calendarEnabled: false, seasonPromos: false, standardDisplayMs: 3600, specialDisplayMs: 4200 });
  var SEED = {
    lobby: { 'awanaSyncSession.v1': SESSION, 'awanaSetupCardDismissed.v1': '1', 'awanaConfig.v1': LOBBY_CONFIG },
    projector: { 'awanaSetupChecklistDismissed.v1': '1' },
    settings: { 'awanaSyncSession.v1': SESSION },
    journey: { 'journey.captions': 'on' },
    checkin: { 'awanaSyncSession.v1': SESSION, 'awanaDeskHistoryKey.v1': JSON.stringify(HISTORY_PIN) },
  };
  var define = function (name, value) {
    try { Object.defineProperty(window, name, { value: value, configurable: true, enumerable: true, writable: false }); } catch (e) { /* kept */ }
  };
  define('localStorage', memoryStorage(SEED[KIND]));
  define('sessionStorage', memoryStorage({}));
  define('indexedDB', undefined);
  // The configure relay (another window's Settings) and other tabs never reach a twin.
  define('BroadcastChannel', function BroadcastChannel() {
    return { postMessage: function () {}, close: function () {}, addEventListener: function () {}, removeEventListener: function () {}, onmessage: null };
  });
  try {
    if (navigator.serviceWorker) {
      Object.defineProperty(navigator.serviceWorker, 'register', { value: function () { return new Promise(function () {}); }, configurable: true });
    }
  } catch (e) { /* kept */ }
  // A real tab's storage change says nothing to a twin.
  window.addEventListener('storage', function (e) { e.stopImmediatePropagation(); }, true);

  // ── the clock ──────────────────────────────────────────────────────────────
  var RealDate = Date;
  var offset = 0;
  var setClock = function (iso) {
    var t = RealDate.parse(iso);
    if (Number.isFinite(t)) offset = t - RealDate.now();
  };
  var start = new URLSearchParams(location.search).get('at');
  setClock(start || '2026-10-14T17:58:00');
  function ShowcaseDate() {
    var args = Array.prototype.slice.call(arguments);
    if (!(this instanceof ShowcaseDate)) return new RealDate(RealDate.now() + offset).toString();
    var d = args.length ? new (Function.prototype.bind.apply(RealDate, [null].concat(args)))() : new RealDate(RealDate.now() + offset);
    Object.setPrototypeOf(d, ShowcaseDate.prototype);
    return d;
  }
  ShowcaseDate.prototype = Object.create(RealDate.prototype, { constructor: { value: ShowcaseDate } });
  ShowcaseDate.now = function () { return RealDate.now() + offset; };
  ShowcaseDate.parse = RealDate.parse;
  ShowcaseDate.UTC = RealDate.UTC;
  Object.setPrototypeOf(ShowcaseDate, RealDate);
  window.Date = ShowcaseDate;
  var iso = function () { return new RealDate(RealDate.now() + offset).toISOString(); };

  // ── the made-up club ───────────────────────────────────────────────────────
  var KIDS = [
    ['Ava', 'Linden', 'Puggles'], ['Mia', 'Rourke', 'Puggles'], ['Ella', 'Marchetti', 'Puggles'],
    ['Leo', 'Castellan', 'Cubbies'], ['Ezra', 'Holloway', 'Cubbies'], ['Ruby', 'Ashford', 'Cubbies'],
    ['Maya', 'Brightwater', 'Sparks'], ['Owen', 'Pemberly', 'Sparks'], ['Ivy', 'Calloway', 'Sparks'], ['Jude', 'Winslow', 'Sparks'],
    ['Noah', 'Fairbanks', 'T&T'], ['Lucy', 'Ambrose', 'T&T'], ['Eli', 'Thornbury', 'T&T'], ['Nora', 'Whitcombe', 'T&T'],
    ['Sophia', 'Hartwell', 'Trek'], ['Caleb', 'Moreland', 'Trek'],
  ].map(function (k, i) { return { clubberId: String(100 + i), first: k[0], last: k[1], club: k[2], clubId: '', checkedIn: false }; });
  var count = 38;
  var seen = new Date(RealDate.now() + offset).toISOString();
  var SCREENS = [
    { id: 'scr-lobby-1', kind: 'lobby', name: 'Lobby TV', online: true, lastSeen: seen },
    { id: 'scr-lobby-2', kind: 'lobby', name: 'Gym door TV', online: true, lastSeen: seen },
    { id: 'scr-proj-1', kind: 'projector', name: 'Projector', online: true, lastSeen: seen },
    { id: 'scr-jr-1', kind: 'journey', name: 'Journey kiosk', online: true, lastSeen: seen },
    { id: 'scr-pc-1', kind: 'computer', name: 'Check-in laptop', online: true, lastSeen: seen },
  ];

  /** The stand-in Worker: a JSON answer, or null for 404. */
  function answer(path, method, body) {
    var now = iso();
    switch (path) {
      case '/v1/state': return {};
      case '/v1/screens/hello': return { ok: true, id: (body && body.id) || 'scr-showcase', name: KIND === 'projector' ? 'Projector' : 'Lobby TV', actions: [] };
      case '/v1/screens': return { max: 40, screens: SCREENS };
      case '/v1/desk/roster':
        return { readAt: now, kids: KIDS, items: { bible: ['Puggles', 'Cubbies', 'Sparks', 'T&T'], friend: ['Puggles', 'Cubbies', 'Sparks', 'T&T', 'Trek', 'Journey'] } };
      case '/v1/desk/families': return { households: [] };
      case '/v1/desk/tonight': return { checkedIn: count, checkedOut: 0, byClub: { Puggles: 6, Cubbies: 9, Sparks: 11, 'T&T': 12 } };
      case '/v1/stations': return [];
      case '/v1/print/status':
        return { queued: 0, leased: 0, done: count, dead: 0, checkThePrinter: [], pendingToSeal: 0, claims: { printed: count }, stations: [{ stationId: 'showcase', name: 'Check-in laptop', lastSeenAt: now, printer: { state: 'ok' } }] };
      case '/v1/desk/checkin': {
        var kid = KIDS.find(function (k) { return body && k.clubberId === String(body.clubberId); });
        if (kid && !kid.checkedIn) { kid.checkedIn = true; count += 1; tell('checkin', { firstName: kid.first, lastName: kid.last, club: kid.club, count: count }); }
        return { ok: true, already: false, jobId: null, gen: 1, history: 'hooked' };
      }
      case '/v1/desk/undo': {
        var k2 = KIDS.find(function (k) { return body && k.clubberId === String(body.clubberId); });
        if (k2 && k2.checkedIn) { k2.checkedIn = false; count -= 1; tell('undo', { firstName: k2.first, club: k2.club }); }
        return { ok: true };
      }
      case '/v1/tonight/overview':
        return {
          at: now, night: '2026-10-14', clubNight: true, window: { open: true, opensInMin: 0, closesInMin: 90 },
          count: { source: 'report', checkedIn: count, checkedOut: 0, byClub: { Puggles: 6, Cubbies: 9, Sparks: 11, 'T&T': 12 }, reportAgeMs: 4000, enabled: true },
          read: { mode: 'watch', configured: true, signedIn: true, lastReadAt: now, lastOkAt: now, lastError: null, loginBlockedForSec: 0, watchIntervalSec: 5 },
          print: { queued: 0, leased: 0, dead: 0, checkThePrinter: 0, claims: {}, pendingToSeal: 0, stations: [{ stationId: 'st1', name: 'Check-in laptop', lastSeenAt: now, printer: { state: 'ok' }, version: '10.0.0', churchRev: 2 }] },
          ym: { enabled: true, due: false, checkedOut: 0, failed: 0, gaveUp: 0, pending: 0, lastError: null },
          switches: [], notice: null, church: { rev: 2, savedAt: now, seeded: true, paused: false },
          history: { db: true, pending: 0 }, changes: { head: 0, last: null },
        };
      case '/v1/changes': return { head: 0, changes: [] };
      default: return null;
    }
  }

  // ── fetch ──────────────────────────────────────────────────────────────────
  var realFetch = window.fetch.bind(window);
  var json = function (status, body) {
    return new Response(JSON.stringify(body), { status: status, headers: { 'Content-Type': 'application/json' } });
  };
  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href); } catch (e) { return realFetch(input, init); }
    var method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (/\/shared\/sync\.json$/.test(url.pathname)) return Promise.resolve(json(200, { url: BASE }));
    // The stand-in address, and this site's own /api (the check-in page's DESK_API):
    // a twin never reaches the real Worker.
    var own = url.origin === location.origin && /^\/api(\/|$)/.test(url.pathname);
    if (url.href.indexOf(BASE) === 0 || own) {
      var body = null;
      try { body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null; } catch (e) { body = null; }
      var out = answer(url.pathname.replace(/^\/api/, ''), method, body);
      return Promise.resolve(out === null ? json(404, { error: 'Not found.' }) : json(200, out));
    }
    if (/open-meteo|twotimtwo/.test(url.hostname) || (url.origin !== location.origin && /^(localhost|127\.0\.0\.1)$/.test(url.hostname))) {
      return Promise.reject(new TypeError('Not part of the showcase.'));
    }
    return realFetch(input, init);
  };

  // ── the live socket ────────────────────────────────────────────────────────
  var RealWebSocket = window.WebSocket;
  var sockets = [];
  function ShowcaseSocket(url) {
    if (String(url).indexOf('/v1/live') < 0) return new RealWebSocket(url);
    var target = new EventTarget();
    var sock = {
      url: String(url), readyState: 0, protocol: '', extensions: '', bufferedAmount: 0, binaryType: 'blob',
      onopen: null, onmessage: null, onclose: null, onerror: null,
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      send: function (data) { if (String(data) === 'ping') setTimeout(function () { sock._fire('message', { data: 'pong' }); }, 20); },
      close: function () {
        if (sock.readyState === 3) return;
        sock.readyState = 3;
        sockets = sockets.filter(function (s) { return s !== sock; });
        sock._fire('close', { code: 1000, reason: '', wasClean: true });
      },
      _fire: function (type, init) {
        var ev = type === 'message' ? new MessageEvent('message', init) : type === 'close' ? new CloseEvent('close', init) : new Event(type);
        var h = sock['on' + type];
        if (typeof h === 'function') h.call(sock, ev);
        target.dispatchEvent(ev);
      },
    };
    sockets.push(sock);
    setTimeout(function () { if (sock.readyState === 0) { sock.readyState = 1; sock._fire('open'); tell('live', { open: true }); } }, 30);
    return sock;
  }
  ShowcaseSocket.CONNECTING = 0; ShowcaseSocket.OPEN = 1; ShowcaseSocket.CLOSING = 2; ShowcaseSocket.CLOSED = 3;
  window.WebSocket = ShowcaseSocket;

  // ── the home page's direction ──────────────────────────────────────────────
  window.addEventListener('message', function (e) {
    if (e.origin !== parentOrigin || e.source !== window.parent) return;
    var m = e.data;
    if (!m || typeof m !== 'object' || typeof m.type !== 'string' || m.type.indexOf('showcase:') !== 0) return;
    if (m.type === 'showcase:clock' && typeof m.at === 'string') setClock(m.at);
    else if (m.type === 'showcase:frame' && typeof m.e === 'string') {
      var data = JSON.stringify({ e: m.e, d: m.d });
      sockets.forEach(function (s) { if (s.readyState === 1) s._fire('message', { data: data }); });
    } else if (m.type === 'showcase:click' && typeof m.selector === 'string') {
      var el = document.querySelector(m.selector);
      if (el) el.click();
    } else if (m.type === 'showcase:key' && typeof m.key === 'string') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: m.key, code: m.code || '', bubbles: true }));
    }
  });
  tell('ready', { at: iso() });
}());
