// The Cast screen (owner 2026-11-08: "set it up kind of like an air server";
// worker/src/routes.md 10.18): what KVBC Awana shows on the lobby TV while Cast is on.
//
// - Signed in like every screen: the session in the shared slot awanaSyncSession.v1
//   (same origin), sent as Authorization: Bearer. No session = a calm card.
// - On load it OPENS a room (POST /v1/cast/open): a fresh six-digit code, whatever a
//   last presenter left gone. On pagehide it CLOSES it (keepalive), so turning Cast
//   off clears the room.
// - What to show comes from GET /v1/cast/screen: read when the live channel rings
//   `changed {what: 'cast'}` (/v1/live, the presentation page's socket: ping, 2 s
//   doubling to 60 s back-off) and every 30 s as the safety net (also what keeps the
//   presenter's "the TV is on" true: the Worker's 45 s online window).
// - A shared screen: the presenter's OFFER (GET /v1/cast/screen/signal), our ANSWER
//   (POST), then the picture comes laptop to TV over the church network
//   (shared/screenShare.js; no ICE servers: KVBC Awana turns Chromium's mDNS hiding
//   off, so the answer carries this computer's real local address).
// - YouTube through YouTube's IFrame API on youtube-nocookie.com, sound on; pictures
//   and PDFs read with the session into blob URLs; PDFs drawn by pdf.js (cdnjs, on the
//   first PDF). Video commands run once by id, never ones from before this page loaded.
// - Reports what it shows (POST /v1/cast/screen/now) only while a presenter watches
//   (the Worker's `watch`): on a change, and every 10 s in a video.
// - ?configure=1 (KVBC Awana's display Settings window, coordinator 2026-11-08): a
//   short note only. No room is opened, no socket, nothing closed on pagehide.
//
// The Sparks remote's classroom TV (classroom/public/src/stage.js) is the model.

import * as R from '/cast/shared/classroomRemote.js';
import { answerShare } from '/cast/shared/screenShare.js';

const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const YT_API = 'https://www.youtube.com/iframe_api';
const T = Object.assign({
  pollMs: 30000, reportVideoMs: 10000, timeoutMs: 10000, fadeMs: 450,
  pingMs: 25000, silentMs: 70000, retryMinMs: 2000, retryMaxMs: 60000,
  openRetryMinMs: 5000, signalPollMs: 1500, signalWaitMs: 45000,
}, window.castScreenTuning || {});
const CONFIGURE = new URLSearchParams(location.search).get('configure') === '1';

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const layer = $('show');
const loadedAt = Date.now();

let base = '';
let code = null;
let stage = R.sanitizeStage(null);
let skew = 0;
let watch = false;
let showKey = '';
let busy = Promise.resolve();
const ran = new Set();
let player = null;
let playerReady = false;
let blobUrl = '';
let pdf = null; // { doc, pages }
let shownPage = 0;
let rtc = null; // { id, pc } the share being answered
let shareTries = 0;
let signalTimer = 0;
let lastReport = '';
let openRetryMs = 0;
let closed = false;

const session = () => {
  let s = '';
  try { s = (localStorage.getItem(SESSION_KEY) || '').trim(); } catch { /* none */ }
  return SESSION_RE.test(s) ? s : '';
};

async function request(path, opts = {}) {
  const s = session();
  if (!base || !s) return { ok: false, status: s ? 0 : 401, body: null };
  try {
    const res = await fetch(base + path, {
      method: opts.method || 'GET',
      headers: { Authorization: `Bearer ${s}`, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
      signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || T.timeoutMs) : undefined,
    });
    if (opts.raw) return { ok: res.ok, status: res.status, res };
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch { return { ok: false, status: 0, body: null }; }
}

/* ── The waiting card ── */

function calm(title, words) {
  $('card').classList.add('calm');
  $('card-title').textContent = title;
  $('card-go').textContent = words;
  $('code').hidden = true;
  $('card-foot').hidden = true;
}

function drawCode() {
  const c = $('code');
  const d = typeof code === 'string' && /^\d{6}$/.test(code) ? code : '';
  c.classList.toggle('is-empty', !d);
  $('code-a').textContent = d ? d.slice(0, 3) : '···';
  $('code-b').textContent = d ? d.slice(3) : '···';
  c.setAttribute('aria-label', d ? `Code ${d.split('').join(' ')}` : 'Getting a code');
}

/* ── The room ── */

async function openRoom() {
  const r = await request('/v1/cast/open', { method: 'POST', body: {} });
  if (r.status === 401) { signedOut(); return; }
  if (!r.ok || !r.body || !/^\d{6}$/.test(r.body.code || '')) {
    openRetryMs = Math.min(T.retryMaxMs, openRetryMs ? openRetryMs * 2 : T.openRetryMinMs);
    setTimeout(openRoom, openRetryMs);
    return;
  }
  openRetryMs = 0;
  code = r.body.code;
  drawCode();
  read();
}

function signedOut() {
  calm('This screen needs to be signed in', 'Sign the lobby computer in from KVBC Awana’s Settings, then Cast will show a code here.');
  closeLive();
}

async function read() {
  if (closed) return;
  const r = await request('/v1/cast/screen');
  if (r.status === 401) { signedOut(); return; }
  if (!r.ok || !r.body) return;
  if (typeof r.body.serverNow === 'number') skew = r.body.serverNow - Date.now();
  watch = r.body.watch === true;
  // The room was closed from elsewhere while this screen is up: open a new one.
  if (r.body.code === null && code) { code = null; drawCode(); openRoom(); return; }
  if (typeof r.body.code === 'string' && r.body.code !== code) { code = r.body.code; drawCode(); }
  apply(R.sanitizeStage(r.body.stage));
}

function apply(next) {
  stage = next;
  const key = next.show ? `${next.show.button.id}@${next.show.at}` : '';
  if (key !== showKey) {
    showKey = key;
    busy = busy.then(() => change(next.show)).catch(() => {});
  } else if (next.show && next.show.button.kind === 'pdf' && next.show.page !== shownPage) {
    busy = busy.then(() => drawPdfPage(next.show.page)).catch(() => {});
  } else if (next.show && next.show.button.kind === 'screen' && !rtc) {
    trySignal();
  }
  for (const c of next.cmds) {
    if (ran.has(c.id)) continue;
    ran.add(c.id);
    // A command from before this page loaded (a reload) is not run again.
    if (c.at - skew < loadedAt - 1000) continue;
    if (c.action === 'video') videoCmd(c.data);
  }
  report();
}

/* ── Changing what is up: a short fade through black ── */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function change(show) {
  let prepared = null;
  if (show && (show.button.kind === 'image' || show.button.kind === 'pdf')) prepared = await fetchFile(show.button.file);
  if (show && showKey !== `${show.button.id}@${show.at}`) return; // replaced while fetching
  if (!layer.hidden) { layer.classList.remove('is-in'); await wait(T.fadeMs); }
  clear();
  if (!show) {
    layer.hidden = true;
    $('card').classList.remove('is-away');
    report(true);
    return;
  }
  $('card').classList.add('is-away');
  layer.hidden = false;
  const b = show.button;
  if (b.kind === 'video') playVideo(b);
  else if (b.kind === 'text') drawText(b);
  else if (b.kind === 'image') drawImage(prepared);
  else if (b.kind === 'pdf') await openPdf(prepared, show.page);
  else if (b.kind === 'screen') { status('Connecting to the presenter’s screen…', b.title !== 'Shared screen' ? b.title : ''); trySignal(); }
  void layer.offsetWidth;
  layer.classList.add('is-in');
  report(true);
}

function clear() {
  if (player) { try { player.destroy(); } catch { /* gone */ } }
  player = null;
  playerReady = false;
  if (rtc) { try { rtc.pc.close(); } catch { /* closed */ } }
  rtc = null;
  shareTries = 0;
  clearTimeout(signalTimer);
  for (const v of layer.querySelectorAll('video')) { v.srcObject = null; }
  layer.replaceChildren();
  if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = ''; }
  pdf = null;
  shownPage = 0;
}

function status(words, small) {
  layer.querySelector('.status')?.remove();
  const p = document.createElement('p');
  p.className = 'status';
  p.textContent = words;
  if (small) { const s = document.createElement('small'); s.textContent = small; p.append(s); }
  layer.append(p);
}

async function fetchFile(file) {
  const r = await request(`/v1/cast/screen/files/${encodeURIComponent(file)}`, { raw: true, timeoutMs: 60000 });
  if (!r.ok) return null;
  try { return await r.res.blob(); } catch { return null; }
}

/* ── Text: a light page or white on dark, as big as fits ── */

function drawText(b) {
  const box = document.createElement('div');
  box.className = `text text--${b.look === 'board' ? 'board' : 'page'}`;
  if (b.heading) {
    const h = document.createElement('p');
    h.className = 'heading';
    h.textContent = b.heading;
    box.append(h);
  }
  const words = document.createElement('p');
  words.className = 'words';
  words.textContent = b.text;
  box.append(words);
  layer.append(box);
  fitText();
}

function fitText() {
  const el = layer.querySelector('.text .words');
  if (!el) return;
  // Judged on the page box (the words never shrink): a line's ink may reach a pixel
  // or two past its own box, so the words' own scrollHeight always says "too big".
  const box = el.parentElement;
  let lo = 2;
  let hi = 8; // restraint: a short line never shouts
  for (let i = 0; i < 14; i += 1) {
    const mid = (lo + hi) / 2;
    el.style.setProperty('--words-size', String(mid));
    if (box.scrollHeight <= box.clientHeight + 2 && el.scrollWidth <= el.clientWidth + 1) lo = mid; else hi = mid;
  }
  el.style.setProperty('--words-size', String(lo));
}

/* ── A picture ── */

function drawImage(blob) {
  if (!blob) { status('The picture could not be loaded.'); return; }
  blobUrl = URL.createObjectURL(blob);
  const img = document.createElement('img');
  img.alt = '';
  img.src = blobUrl;
  layer.append(img);
}

/* ── A PDF, one page at a time, fitted to the screen ── */

async function pdfLib() {
  if (window.castPdfLib) return window.castPdfLib;
  if (window.pdfjsLib) return window.pdfjsLib;
  await new Promise((ok, no) => {
    const s = document.createElement('script');
    s.src = `${PDFJS}pdf.min.js`;
    s.onload = ok;
    s.onerror = no;
    document.head.append(s);
  });
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.js`;
  return window.pdfjsLib;
}

async function openPdf(blob, page) {
  if (!blob) { status('The slides could not be loaded.'); return; }
  try {
    const lib = await pdfLib();
    const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    pdf = { doc, pages: doc.numPages };
    await drawPdfPage(page);
  } catch { status('The slides could not be opened.'); }
}

async function drawPdfPage(page) {
  if (!pdf) return;
  const n = Math.min(Math.max(1, page), pdf.pages);
  const p = await pdf.doc.getPage(n);
  const ratio = window.devicePixelRatio || 1;
  const v1 = p.getViewport({ scale: 1 });
  const fit = Math.min(window.innerWidth / v1.width, window.innerHeight / v1.height);
  const viewport = p.getViewport({ scale: fit * ratio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(v1.width * fit)}px`;
  canvas.style.height = `${Math.floor(v1.height * fit)}px`;
  await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  if (!pdf) return;
  const old = layer.querySelector('canvas');
  if (old) old.replaceWith(canvas); else layer.append(canvas);
  shownPage = n;
  report();
}

/* ── YouTube ── */

function ytApi() {
  if (window.castYouTube) return Promise.resolve(window.castYouTube);
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  return new Promise((ok) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof prev === 'function') prev(); ok(window.YT); };
    if (!document.querySelector(`script[src="${YT_API}"]`)) {
      const s = document.createElement('script');
      s.src = YT_API;
      document.head.append(s);
    }
  });
}

async function playVideo(b) {
  const host = document.createElement('div');
  layer.append(host);
  const YT = await ytApi();
  if (!layer.contains(host)) return;
  player = new YT.Player(host, {
    host: 'https://www.youtube-nocookie.com',
    videoId: b.youtube,
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, start: b.start || 0, origin: location.origin },
    events: {
      onReady: (e) => { playerReady = true; try { e.target.unMute(); e.target.playVideo(); } catch { /* blocked */ } report(); },
      // Ended: black at once (never YouTube's end screen), then the TV takes it down itself
      // (POST /v1/cast/screen/back) and the code comes back, like the classroom's video.
      onStateChange: (e) => {
        if (e.data === 0) {
          const f = layer.querySelector('iframe');
          if (f) f.style.visibility = 'hidden';
          request('/v1/cast/screen/back', { method: 'POST', body: {} }).catch(() => {});
        }
        report();
      },
    },
  });
}

function videoCmd(d) {
  if (!player || !playerReady || !d) return;
  try {
    const paused = player.getPlayerState() !== 1;
    if (d.op === 'toggle') { if (paused) player.playVideo(); else player.pauseVideo(); }
    if (d.op === 'play') player.playVideo();
    if (d.op === 'pause') player.pauseVideo();
    if (d.op === 'mute') player.mute();
    if (d.op === 'unmute') player.unMute();
    if (d.op === 'seek') player.seekTo(Math.max(0, player.getCurrentTime() + d.by), true);
    if (d.op === 'volume') {
      const v = Math.min(100, Math.max(0, Math.round((player.getVolume() + d.step * R.CLASSROOM_VOLUME_STEP_PCT) / 10) * 10));
      player.setVolume(v);
      if (v > 0 && player.isMuted()) player.unMute();
    }
    if (d.op === 'play' || d.op === 'toggle' || d.op === 'seek') { const f = layer.querySelector('iframe'); if (f) f.style.visibility = ''; }
  } catch { /* the player is not ready */ }
  setTimeout(() => report(), 250);
}

/* ── A shared screen: answer the presenter's offer ── */

async function trySignal() {
  clearTimeout(signalTimer);
  const show = stage.show;
  if (!show || show.button.kind !== 'screen' || rtc) return;
  const id = show.button.id;
  const r = await request('/v1/cast/screen/signal');
  const sig = r.ok && r.body ? R.sanitizeSignal(r.body.signal) : null;
  if (!stage.show || stage.show.button.id !== id || rtc) return;
  if (!sig || sig.type !== 'offer' || sig.id !== id) {
    // The doorbell brings the offer; this is its safety net while we wait.
    shareTries += 1;
    if (shareTries * T.signalPollMs < T.signalWaitMs) signalTimer = setTimeout(trySignal, T.signalPollMs);
    else status('The presenter’s screen did not arrive.', 'They can press Share my screen again.');
    return;
  }
  const entry = { id, pc: null };
  rtc = entry;
  try {
    entry.pc = await answerShare({
      offerSdp: sig.sdp,
      sendAnswer: async (sdp) => {
        const a = await request('/v1/cast/screen/signal', { method: 'POST', body: { signal: { type: 'answer', id, sdp } } });
        if (!a.ok) throw new Error('answer refused');
      },
      onStream: (stream) => { if (rtc === entry) showStream(stream); },
      onState: (st) => {
        if (rtc !== entry) return;
        if (st === 'failed') status('The presenter’s screen could not reach this TV.', 'The laptop must be on the church Wi-Fi.');
        if (st === 'disconnected') status('The presenter’s screen paused…');
      },
    });
    if (rtc !== entry) { try { entry.pc.close(); } catch { /* closed */ } }
  } catch {
    if (rtc === entry) { rtc = null; status('The presenter’s screen could not be connected.', 'They can press Share my screen again.'); }
  }
}

function showStream(stream) {
  layer.querySelector('.status')?.remove();
  let v = layer.querySelector('video');
  if (!v) {
    v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    layer.append(v);
  }
  v.srcObject = stream;
  // Sound on when the browser allows it (KVBC Awana does); else the picture, muted.
  v.muted = false;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  report(true);
}

/* ── The report (only while a presenter watches) ── */

function nowReport() {
  const b = stage.show && stage.show.button;
  const out = { view: b ? b.kind : 'waiting' };
  if (b) { out.button = b.id; out.title = b.title; }
  if (b && b.kind === 'pdf' && pdf) { out.page = shownPage || 1; out.pages = pdf.pages; }
  if (b && b.kind === 'video' && player && playerReady) {
    try { out.video = { t: player.getCurrentTime(), d: player.getDuration(), paused: player.getPlayerState() !== 1, muted: player.isMuted(), volume: player.getVolume() }; } catch { /* not yet */ }
  }
  return R.sanitizeClassroomNow(out);
}

function report(force) {
  if (!watch) return;
  const now = nowReport();
  if (!now) return;
  const text = JSON.stringify(now);
  if (!force && text === lastReport) return;
  lastReport = text;
  request('/v1/cast/screen/now', { method: 'POST', body: { now } }).then((r) => { if (r.ok && r.body) watch = r.body.watch === true; });
}

/* ── The doorbell (the live channel) ── */

let sock = null;
let retryMs = 0;
let retryTimer = 0;
let pingTimer = 0;
let heardAt = 0;

const isRing = (data) => {
  if (typeof data !== 'string' || data === 'pong') return false;
  try { const f = JSON.parse(data); return f?.e === 'changed' && f?.d?.what === 'cast'; } catch { return false; }
};

function closeLive() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  clearInterval(pingTimer);
  const s = sock;
  sock = null;
  if (s) { s.onopen = s.onmessage = s.onclose = s.onerror = null; try { s.close(); } catch { /* closed */ } }
}

function openLive() {
  clearTimeout(retryTimer);
  retryTimer = 0;
  if (sock || closed || !session() || !/^https:\/\//.test(base) || typeof WebSocket !== 'function') return;
  let s;
  try { s = new WebSocket(`${base.replace(/^https:/, 'wss:')}/v1/live?session=${encodeURIComponent(session())}`); } catch { return; }
  sock = s;
  s.onopen = () => {
    retryMs = 0;
    heardAt = Date.now();
    clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (Date.now() - heardAt > T.silentMs) { dropLive(); return; }
      try { s.send('ping'); } catch { dropLive(); }
    }, T.pingMs);
    read(); // whatever moved while it was down
  };
  s.onmessage = (e) => {
    heardAt = Date.now();
    if (!isRing(e.data)) return;
    read().then(() => {
      try { if (JSON.parse(e.data).d.rtc === 'offer') trySignal(); } catch { /* fine */ }
    });
  };
  s.onclose = s.onerror = () => dropLive();
}

function dropLive() {
  closeLive();
  if (!session() || closed) return;
  retryMs = Math.min(T.retryMaxMs, retryMs ? retryMs * 2 : T.retryMinMs);
  retryTimer = setTimeout(openLive, retryMs);
}

/* ── Start ── */

async function start() {
  if (CONFIGURE) {
    // KVBC Awana's display Settings window: a note only. Never a room, socket or close.
    document.body.classList.add('configure');
    calm('Cast is on.', 'The TV shows a code; presenters go to awana.kvbchurch.org/cast and type it. Turn Cast off from the KVBC Awana icon in the taskbar.');
    return;
  }
  drawCode();
  try {
    if (typeof window.castBase === 'string') base = window.castBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* falls back below */ }
  if (!base && location.protocol === 'https:') base = `${location.origin}/api`;
  if (!session()) { signedOut(); }
  else { await openRoom(); openLive(); }

  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY) return;
    if (session() && !code) { location.reload(); }
  });
  // Turning Cast off (KVBC Awana closes this window): close the room, so nothing a
  // guest put up, and no code or token, outlives the screen.
  window.addEventListener('pagehide', () => {
    if (closed || !session() || !base) return;
    closed = true;
    closeLive();
    try { fetch(`${base}/v1/cast/close`, { method: 'POST', keepalive: true, headers: { Authorization: `Bearer ${session()}`, 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* best effort */ }
  });
  window.addEventListener('resize', () => {
    fitText();
    if (pdf && shownPage) busy = busy.then(() => drawPdfPage(shownPage)).catch(() => {});
  });
  setInterval(() => { if (session() && code) read(); }, T.pollMs);
  setInterval(() => { if (stage.show && stage.show.button.kind === 'video') report(true); }, T.reportVideoMs);
}

start();
