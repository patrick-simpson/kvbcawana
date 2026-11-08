// The presentation (owner 2026-11-01: "a new page protected by the passcode
// ... /presentation. It should full screen on click and display on the lobby
// computer screen in the app the PowerPoint esque report ... In the other
// window view it should show slide controls"; CLAUDE.md "Presentation",
// worker/src/routes.md 10.14).
//
//   ?screen=tv   the TV: the deck alone, full screen on the first click.
//                KVBC Awana's "Presentation" display screen opens this.
//   anything     the controls: the slide on the screen, the next one, every
//   else         slide, Back / Next. KVBC Awana's Settings window (?configure=1),
//                a laptop or a phone; speaker notes on a PHONE only (owner
//                2026-11-01: "On my phone I should be able to see notes but no
//                where else"; logic.js notesHere).
//
// The deck is SEALED to the church's history key by the weekly job; this page
// opens it with the passphrase (passphrase v2: the word never leaves the
// browser; the unwrapped key is non-extractable and in memory only). Windows
// of one browser hand the opened deck to each other over a BroadcastChannel,
// so on the lobby computer the passphrase typed in the Settings window is
// enough for the TV window. Every screen follows ONE slide on the sync
// Worker (POST /v1/presentation/go, polled), so a phone drives the TV too.

import { builtWords, clampSlide, deckOutline, followingNow, frameHtml, keyStep, modeOf, msToNextEdge, notesHere, tapStep } from './logic.js';

const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const CHANNEL = 'awana-presentation';
const STAGE_W = 1600;
// The slide is PUSHED (2026-11-03): the Worker rings the live channel's doorbell,
// `changed {what: 'presentation'}`, on every slide change and new deck, and the
// page reads the state then. While that socket is open the poll is only a
// safety net (livePollMs); the fast polls are for a page whose socket is down.
// Polling every 0.8 s around the clock used up the account's free daily requests.
const tuning = Object.assign({ tvPollMs: 800, deskPollMs: 1500, hiddenPollMs: 5000, livePollMs: 2 * 60 * 1000, pingMs: 25 * 1000, silentMs: 70 * 1000, retryMinMs: 2000, retryMaxMs: 60 * 1000, helloWaitMs: 700, quietMs: 2500, timeoutMs: 15000, deckTimeoutMs: 90000 }, window.presentationTuning || {});

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } },
};

let mode = modeOf(location.search);
/** The presenter view switched itself to the TV ("Show on this screen"). */
let tvFromDesk = false;
let base = '';
let memorySession = '';
/** @type {{ privateKey: CryptoKey, publicKey: string, kid: string }|null} */
let ring = null;
/** @type {{ html: string, rev: number, builtAt: string|null, outline: ReturnType<typeof deckOutline>, urls: { live: string, still: string } }|null} */
let deck = null;
let index = 0;
let seenRev = -1;
let pollTimer = 0;
let polling = false;
let loading = false;
/** Speaker notes on this device? A phone only, never the lobby computer's Settings window. */
const notesOn = notesHere({
  configure: new URLSearchParams(location.search).get('configure') === '1',
  coarse: matchMedia('(pointer: coarse)').matches,
  screenW: screen.width,
  screenH: screen.height,
});
let quietTimer = 0;
/** @type {BroadcastChannel|null} */
let bc = null;

const session = () => {
  const s = (store.get(SESSION_KEY) || memorySession || '').trim();
  return SESSION_RE.test(s) ? s : '';
};
const count = () => deck?.outline.slides.length || 0;

function request(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const s = opts.session || session();
  if (s) headers.Authorization = `Bearer ${s}`;
  return fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || tuning.timeoutMs) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

// ── what is on the page ────────────────────────────────────────────────────

function show(section) {
  for (const id of ['gate', 'wait', 'tv', 'desk']) $(id).hidden = id !== section;
  document.title = section === 'tv' && deck?.outline.title ? deck.outline.title : 'Presentation · KVBC Awana';
}

function render() {
  if (!deck) {
    if (mode === 'tv') show('wait');
    return;
  }
  if (mode === 'tv') { show('tv'); drawTv(); return; }
  show('desk');
  drawDesk();
}

function framePoint(frame, url, i) {
  const want = `${url}#${i + 1}`;
  if (frame.dataset.url !== url) {
    frame.dataset.url = url;
    frame.src = want;
    return;
  }
  frame.contentWindow?.postMessage({ type: 'awana-deck:go', index: i }, location.origin);
}

function drawTv() {
  framePoint($('tv-frame'), deck.urls.live, index);
  $('tv-hint').hidden = Boolean(document.fullscreenElement);
}

function drawDesk() {
  const n = count();
  const s = deck.outline.slides;
  $('deck-title').textContent = deck.outline.title || 'Presentation';
  $('built').textContent = builtWords(deck.builtAt);
  framePoint($('now-frame'), deck.urls.live, index);
  const last = n > 0 && index >= n - 1;
  $('next-end').hidden = !last;
  $('next-frame').hidden = last;
  if (!last) framePoint($('next-frame'), deck.urls.still, index + 1);
  $('now-title').textContent = s[index]?.title || '';
  $('notes-wrap').hidden = !notesOn;
  if (notesOn) {
    const notes = s[index]?.notes || '';
    $('notes').textContent = notes || 'No notes for this slide.';
    $('notes').classList.toggle('empty', !notes);
  }
  $('count').firstChild.nodeValue = n ? `${index + 1} / ${n}` : `${index + 1}`;
  $('back').disabled = index <= 0;
  $('next').disabled = n > 0 && index >= n - 1;
  const list = $('list');
  if (list.dataset.rev !== String(deck.rev)) {
    list.dataset.rev = String(deck.rev);
    list.replaceChildren(...s.map((x, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const num = document.createElement('span');
      num.textContent = String(i + 1);
      b.append(num, document.createTextNode(x.title || x.kicker || `Slide ${i + 1}`));
      b.addEventListener('click', () => move(i));
      li.append(b);
      return li;
    }));
  }
  list.querySelectorAll('button').forEach((b, i) => {
    const on = i === index;
    if (b.getAttribute('aria-current') !== String(on)) {
      b.setAttribute('aria-current', String(on));
      // Scroll the list only, never the page (scrollIntoView moved the whole presenter view).
      if (on && (b.offsetTop < list.scrollTop || b.offsetTop + b.offsetHeight > list.scrollTop + list.clientHeight)) {
        list.scrollTop = Math.max(0, b.offsetTop - list.clientHeight / 2);
      }
    }
  });
  fitScreens();
}

function fitScreens() {
  for (const id of ['now-screen', 'next-screen']) {
    const box = $(id);
    const f = box.querySelector('iframe');
    if (box.clientWidth) f.style.transform = `scale(${box.clientWidth / STAGE_W})`;
  }
}

function setLive(on, words) {
  const el = $('live');
  el.dataset.on = on == null ? '' : on ? '1' : '0';
  el.textContent = words;
}

function status(words) {
  $('status').textContent = words || '';
}

// ── the deck ───────────────────────────────────────────────────────────────

/** Take an opened deck (from the Worker or another window). */
function adopt(html, rev, builtAt, { tell = true } = {}) {
  if (deck && deck.rev >= rev && deck.html === html) return;
  const old = deck?.urls;
  const urls = {
    live: URL.createObjectURL(new Blob([frameHtml(html)], { type: 'text/html' })),
    still: URL.createObjectURL(new Blob([frameHtml(html, { still: true })], { type: 'text/html' })),
  };
  deck = { html, rev, builtAt, outline: deckOutline(html), urls };
  index = clampSlide(index, count());
  if (old) setTimeout(() => { URL.revokeObjectURL(old.live); URL.revokeObjectURL(old.still); }, 5000);
  if (tell) bc?.postMessage({ type: 'deck', html, rev, builtAt, index });
  render();
  schedulePoll(0);
}

async function loadDeck() {
  if (!ring || loading) return;
  loading = true;
  status('Opening the deck…');
  try {
    const res = await fetch(`${base}/v1/presentation/deck`, {
      headers: { Authorization: `Bearer ${session()}` },
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(tuning.deckTimeoutMs) : undefined,
    }).catch(() => null);
    if (!res) { status('Could not reach the sync service. Check the internet.'); return; }
    if (res.status === 401) { signedOut('The passphrase changed. Type it again.'); return; }
    if (res.status === 404) { gateNote('No deck has been sent yet. The weekly report job sends it every Thursday morning.'); return; }
    if (!res.ok) { status('The deck could not be read. Try again in a minute.'); return; }
    const wire = await res.json().catch(() => null);
    const cc = await import('./shared/cloud-crypto.js');
    const opened = wire ? await cc.openDocument(ring, wire) : null;
    if (!opened || typeof opened.html !== 'string') { gateNote('The deck would not open with this passphrase. It may have been sealed before the passphrase changed: wait for next Thursday’s report, or ask for a refresh.'); return; }
    status('');
    adopt(opened.html, Number(wire.rev) || 0, opened.builtAt || wire.builtAt || null);
  } finally {
    loading = false;
  }
}

// ── signing in ─────────────────────────────────────────────────────────────

function gateNote(words) {
  if (!deck) { show('gate'); $('signin-note').textContent = words; } else status(words);
}

function signedOut(words) {
  closeLive();
  store.set(SESSION_KEY, null);
  memorySession = '';
  if (deck) { setLive(false, 'Signed out'); status(words); return; }
  ring = null;
  show('gate');
  $('signin-note').textContent = words || '';
}

async function signIn(event) {
  event.preventDefault();
  const input = $('passphrase');
  const typed = input.value;
  const note = $('signin-note');
  if (!typed.trim()) { note.textContent = 'Type the passphrase first.'; return; }
  if (!base) { note.textContent = 'The sync service is not reachable right now. Reload in a minute.'; return; }
  $('signin-btn').disabled = true;
  note.textContent = 'Opening… (this takes a second or two)';
  try {
    const [sp, cc] = await Promise.all([import('./shared/sync-protocol.js'), import('./shared/cloud-crypto.js')]);
    const { res } = await sp.signInWithPassphrase({ request: (p, o) => request(p, o), derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) { note.textContent = `That is not the passphrase.${typeof b.triesLeft === 'number' ? ` ${b.triesLeft} tries left before a 15-minute wait.` : ''}`; return; }
    if (res.status === 429) { note.textContent = 'Too many wrong tries. Wait a little, then try again.'; return; }
    if (!res.ok || !SESSION_RE.test(b.session || '')) {
      note.textContent = res.status === 0 ? 'Could not reach the sync service. Check the internet.' : (b.error || 'Sign-in failed.');
      return;
    }
    store.set(SESSION_KEY, b.session);
    memorySession = b.session;
    let key = b.history;
    if (!key) {
      const k = await request('/v1/history/key', { session: b.session });
      key = k.ok ? k.body : null;
    }
    if (!key || !key.wrapped || !key.pub) { note.textContent = 'This church has no history key yet, so there is no deck to open.'; return; }
    const priv = await cc.unwrapPrivateKey(key.wrapped, typed, key.pub);
    if (!priv) { note.textContent = 'That passphrase did not open the deck.'; return; }
    ring = await cc.keyRing(priv, key.pub);
    input.value = '';
    note.textContent = 'Opening the deck…';
    await loadDeck();
  } catch {
    note.textContent = 'This browser could not open the deck (it may be too old).';
  } finally {
    $('signin-btn').disabled = false;
  }
}

function lock() {
  ring = null;
  if (deck) { URL.revokeObjectURL(deck.urls.live); URL.revokeObjectURL(deck.urls.still); }
  deck = null;
  for (const id of ['tv-frame', 'now-frame', 'next-frame']) { $(id).removeAttribute('src'); delete $(id).dataset.url; }
  $('list').replaceChildren();
  delete $('list').dataset.rev;
  show('gate');
  $('signin-note').textContent = 'Locked on this window.';
  $('passphrase').focus();
}

// ── moving ─────────────────────────────────────────────────────────────────

/** Go to a slide here at once, tell the other windows, then the Worker. @param {number|'first'|'last'} target */
async function move(target) {
  if (!deck) return;
  const n = count();
  const want = target === 'first' ? 0 : target === 'last' ? n - 1 : clampSlide(target, n);
  if (want === index) return;
  index = want;
  render();
  bc?.postMessage({ type: 'go', index });
  if (!session() || !followingNow()) return;   // off the air: this browser's windows only
  const res = await request('/v1/presentation/go', { method: 'POST', body: { index } });
  if (res.status === 401) { signedOut('The passphrase changed: other screens no longer follow this one.'); return; }
  if (res.ok) take(res.body);
}

/** @param {number} step */
const stepBy = (step) => move(index + step);

/** A state answer: a newer slide wins; a newer deck is fetched. @param {any} body */
function take(body) {
  const slide = body?.slide;
  if (slide && Number.isInteger(slide.rev) && slide.rev > seenRev) {
    const first = seenRev < 0;
    seenRev = slide.rev;
    if (!first || slide.rev > 0) {
      const i = clampSlide(slide.index, count());
      if (i !== index) { index = i; render(); }
    }
  }
  const d = body?.deck;
  if (d && deck && ring && d.rev > deck.rev) loadDeck();
}

function schedulePoll(ms) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(poll, ms ?? (liveOpen ? tuning.livePollMs : document.hidden ? tuning.hiddenPollMs : mode === 'tv' ? tuning.tvPollMs : tuning.deskPollMs));
}

// ── the doorbell (the live channel) ────────────────────────────────────────

/** @type {WebSocket|null} */
let liveSock = null;
let liveOpen = false;
let liveRetryMs = 0;
let liveRetryTimer = 0;
let livePingTimer = 0;
let liveHeardAt = 0;

/** Is this socket message the presentation's ring? @param {unknown} data */
const isRing = (data) => {
  if (typeof data !== 'string' || data === 'pong') return false;
  try { const f = JSON.parse(data); return f?.e === 'changed' && f?.d?.what === 'presentation'; } catch { return false; }
};

function closeLive() {
  clearTimeout(liveRetryTimer);
  liveRetryTimer = 0;
  clearInterval(livePingTimer);
  const sock = liveSock;
  liveSock = null;
  liveOpen = false;
  if (sock) { sock.onopen = sock.onmessage = sock.onclose = sock.onerror = null; try { sock.close(); } catch { /* already closed */ } }
}

function openLive() {
  clearTimeout(liveRetryTimer);
  liveRetryTimer = 0;
  if (liveSock || !session() || !followingNow() || !/^https:\/\//.test(base) || typeof WebSocket !== 'function') return;
  let sock;
  try { sock = new WebSocket(`${base.replace(/^https:/, 'wss:')}/v1/live?session=${encodeURIComponent(session())}`); } catch { return; }
  liveSock = sock;
  sock.onopen = () => {
    liveOpen = true;
    liveRetryMs = 0;
    liveHeardAt = Date.now();
    clearInterval(livePingTimer);
    livePingTimer = setInterval(() => {
      if (Date.now() - liveHeardAt > tuning.silentMs) { dropLive(); return; }
      try { sock.send('ping'); } catch { dropLive(); }
    }, tuning.pingMs);
    schedulePoll(0);   // whatever moved while it was down
  };
  sock.onmessage = (e) => {
    liveHeardAt = Date.now();
    if (isRing(e.data)) schedulePoll(0);
  };
  sock.onclose = sock.onerror = () => dropLive();
}

/** The socket went away: poll fast again, and open it again after a back-off. */
function dropLive() {
  const was = liveOpen;
  closeLive();
  if (was) schedulePoll(0);
  if (!session()) return;
  liveRetryMs = Math.min(tuning.retryMaxMs, liveRetryMs ? liveRetryMs * 2 : tuning.retryMinMs);
  liveRetryTimer = setTimeout(openLive, liveRetryMs);
}

async function poll() {
  if (polling) return;
  if (!session() || !base) { closeLive(); setLive(null, deck ? 'This screen only' : 'Not signed in'); schedulePoll(); return; }
  // Off the air (outside Sunday 5-9 PM Eastern, logic.js followingNow): no calls at
  // all; the next look is at the window's edge (or within the hour).
  if (!followingNow()) { closeLive(); setLive(null, 'Follows other devices Sunday 5–9 PM (today also 4–7 PM)'); schedulePoll(msToNextEdge()); return; }
  if (!liveSock && !liveRetryTimer) openLive();
  polling = true;
  try {
    const res = await request('/v1/presentation/state');
    if (res.status === 401) { signedOut('The passphrase changed. Type it again to follow the other screens.'); return; }
    if (!res.ok) { setLive(false, 'Reconnecting'); return; }
    setLive(true, 'Live');
    take(res.body);
  } finally {
    polling = false;
    if (session()) schedulePoll();
  }
}

// ── the TV's full screen ───────────────────────────────────────────────────

function goFull() {
  const el = document.documentElement;
  if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
}

function quiet() {
  const tv = $('tv');
  tv.classList.remove('quiet');
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => tv.classList.add('quiet'), tuning.quietMs);
}

function onKey(e) {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!deck || !(mode === 'tv' || !$('desk').hidden)) return;
  if (e.target instanceof HTMLButtonElement && (e.key === ' ' || e.key === 'Enter')) return;
  if (mode === 'tv' && (e.key === 'f' || e.key === 'F')) { goFull(); return; }
  const step = keyStep(e.key);
  if (step == null) return;
  e.preventDefault();
  if (typeof step === 'number') stepBy(step); else move(step);
}

// ── start ──────────────────────────────────────────────────────────────────

async function start() {
  $('signin').addEventListener('submit', signIn);
  $('lock').addEventListener('click', lock);
  $('back').addEventListener('click', () => stepBy(-1));
  $('next').addEventListener('click', () => stepBy(1));
  // The lobby computer's Settings window is controls only: its TV is the other window.
  if (new URLSearchParams(location.search).get('configure') === '1') $('present-here').hidden = true;
  $('present-here').addEventListener('click', () => { tvFromDesk = true; mode = 'tv'; render(); goFull(); quiet(); });
  $('wait-signin').addEventListener('click', () => { show('gate'); $('gate-tv').hidden = false; $('passphrase').focus(); });
  $('tv-tap').addEventListener('click', (e) => {
    quiet();
    if (!document.fullscreenElement) { goFull(); return; }
    const step = tapStep(e.clientX, innerWidth);
    if (step) stepBy(step);
  });
  $('tv').addEventListener('mousemove', quiet);
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && tvFromDesk && mode === 'tv') { tvFromDesk = false; mode = 'presenter'; }
    render();
  });
  addEventListener('keydown', onKey);
  addEventListener('resize', fitScreens);
  if (window.ResizeObserver) new ResizeObserver(fitScreens).observe($('now-screen'));
  document.addEventListener('visibilitychange', () => schedulePoll(document.hidden ? undefined : 0));

  if ('BroadcastChannel' in window) {
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'hello' && deck) bc.postMessage({ type: 'deck', html: deck.html, rev: deck.rev, builtAt: deck.builtAt, index });
      else if (d.type === 'deck' && typeof d.html === 'string' && (!deck || d.rev > deck.rev)) {
        if (!deck && Number.isInteger(d.index)) index = d.index;
        adopt(d.html, Number(d.rev) || 0, d.builtAt || null, { tell: false });
      } else if (d.type === 'go' && deck && Number.isInteger(d.index)) {
        const i = clampSlide(d.index, count());
        if (i !== index) { index = i; render(); }
      }
    };
    bc.postMessage({ type: 'hello' });
  }

  try {
    if (typeof window.presentationSyncBase === 'string') base = window.presentationSyncBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service named: the sign-in says so */ }

  // Give another window of this browser a moment to hand its open deck over.
  await new Promise((r) => setTimeout(r, bc ? tuning.helloWaitMs : 0));
  if (!deck) {
    if (mode === 'tv') { show('wait'); quiet(); } else { show('gate'); $('passphrase').focus(); }
    if (!base) $('signin-note').textContent = 'The sync service is not reachable right now. Reload in a minute.';
  }
  schedulePoll(0);
}

start();
