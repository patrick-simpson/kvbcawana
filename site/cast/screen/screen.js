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
// - The code screen carries a QR code of awana.kvbchurch.org/cast/#code=<code> (the
//   presenter page reads the code from it and connects) and says a laptop must join the
//   KVBC_Guest Wi-Fi to share its screen (owner 2026-11-08). The QR is drawn by
//   qrcode-generator (cdnjs), white on the black code screen; no QR when it cannot load.
// - The code and its QR are HIDDEN until asked for (owner 2026-11-08: "the pin should
//   not show up by default until it's clicked on, same with the QR code"): a click or a
//   key on this screen, the tray's "Show Cast code" or a presenter's "Display code" (the
//   Worker's `revealAt`) shows them for REVEAL_MS; anything put up hides them again.
// - Videos (owner 2026-11-08): an uploaded video (`clip`) read with the session into a
//   blob and played in a <video>; a public Facebook video in Facebook's own embedded
//   player (its SDK, connect.facebook.net). One set of controls for YouTube, clips and
//   Facebook (`media`); every one takes itself down when it ends.
// - ?configure=1 (KVBC Awana's display Settings window, coordinator 2026-11-08): a
//   short note only. No room is opened, no socket, nothing closed on pagehide.
//
// The Sparks remote's classroom TV (classroom/public/src/stage.js) is the model.

import * as R from '/cast/shared/classroomRemote.js';
import { CONNECT_WAIT_MS, answerShare } from '/cast/shared/screenShare.js';

const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
const YT_API = 'https://www.youtube.com/iframe_api';
const QR_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
const FB_SDK = 'https://connect.facebook.net/en_US/sdk.js';
const T = Object.assign({
  pollMs: 30000, reportVideoMs: 10000, timeoutMs: 10000, fadeMs: 450,
  pingMs: 25000, silentMs: 70000, retryMinMs: 2000, retryMaxMs: 60000,
  openRetryMinMs: 5000, signalPollMs: 1500, signalWaitMs: 45000,
}, window.castScreenTuning || {});
const CONFIGURE = new URLSearchParams(location.search).get('configure') === '1';
/** The code shows this long once asked for. */
const REVEAL_MS = 5 * 60 * 1000;

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
/** The video up now, whatever plays it: { play, pause, paused, seekBy, mute, unmute, muted, volume, setVolume, t, d, destroy }. */
let media = null;
let blobUrl = '';
let pdf = null; // { doc, pages }
let shownPage = 0;
let rtc = null; // { id, pc } the share being answered
let shareTries = 0;
let signalTimer = 0;
let lastReport = '';
let openRetryMs = 0;
let closed = false;
let revealTimer = 0;
let revealSeen = 0; // the Worker's last revealAt this screen has acted on

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
  $('qr').hidden = true;
}

function drawCode() {
  const c = $('code');
  const d = typeof code === 'string' && /^\d{6}$/.test(code) ? code : '';
  c.classList.toggle('is-empty', !d);
  $('code-a').textContent = d ? d.slice(0, 3) : '···';
  $('code-b').textContent = d ? d.slice(3) : '···';
  c.setAttribute('aria-label', d ? `Code ${d.split('').join(' ')}` : 'Getting a code');
  drawQr(d);
}

/* ── The QR code: the presenter page with the code in it ── */

let qrLib = null;
function qrcodeLib() {
  if (window.castQr) return Promise.resolve(window.castQr);
  if (!qrLib) {
    qrLib = new Promise((ok, no) => {
      const sc = document.createElement('script');
      sc.src = QR_LIB;
      sc.onload = () => (typeof window.qrcode === 'function' ? ok(window.qrcode) : no(new Error('qr')));
      sc.onerror = () => { qrLib = null; no(new Error('qr')); };
      document.head.append(sc);
    });
  }
  return qrLib;
}

/** Where the QR sends a phone (the code in the fragment: never sent to a server). @param {string} d */
export function qrUrl(d) {
  const origin = /^https:\/\//.test(location.origin) ? location.origin : 'https://awana.kvbchurch.org';
  return `${origin}/cast/#code=${d}`;
}

async function drawQr(d) {
  const box = $('qr');
  if (!d) { box.hidden = true; return; }
  try {
    const qrcode = await qrcodeLib();
    if (code !== d) return;
    const q = qrcode(0, 'M');
    q.addData(qrUrl(d));
    q.make();
    const n = q.getModuleCount();
    const quiet = 2;
    const canvas = $('qr-canvas');
    const px = Math.max(4, Math.floor(512 / (n + quiet * 2)));
    canvas.width = canvas.height = px * (n + quiet * 2);
    const ctx = canvas.getContext('2d');
    // White on black, like the screen around it (phone cameras read light-on-dark codes).
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#FFFFFF';
    for (let r = 0; r < n; r += 1) for (let col = 0; col < n; col += 1) if (q.isDark(r, col)) ctx.fillRect((col + quiet) * px, (r + quiet) * px, px, px);
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

/* ── Showing the code (hidden until asked for) ── */

function reveal() {
  if (CONFIGURE) return;
  $('card').classList.remove('code-hidden');
  clearTimeout(revealTimer);
  revealTimer = setTimeout(hideCode, REVEAL_MS);
}

function hideCode() {
  clearTimeout(revealTimer);
  $('card').classList.add('code-hidden');
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
  // "Show Cast code" (tray) or "Display code" (a presenter): show it, once per ask, if recent.
  const asked = Number(r.body.revealAt) || 0;
  if (asked > revealSeen) {
    const fresh = revealSeen !== 0 || Date.now() + skew - asked < REVEAL_MS;
    revealSeen = asked;
    if (fresh) reveal();
  }
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
  hideCode();
  layer.hidden = false;
  const b = show.button;
  if (b.kind === 'video') playVideo(b);
  else if (b.kind === 'clip') playClip(b, show);
  else if (b.kind === 'facebook') playFacebook(b);
  else if (b.kind === 'text') drawText(b);
  else if (b.kind === 'image') drawImage(prepared);
  else if (b.kind === 'pdf') await openPdf(prepared, show.page);
  else if (b.kind === 'screen') { status('Connecting to the presenter’s screen…', b.title !== 'Shared screen' ? b.title : '', true); trySignal(); }
  void layer.offsetWidth;
  layer.classList.add('is-in');
  report(true);
}

function clear() {
  if (media) { try { media.destroy(); } catch { /* gone */ } }
  media = null;
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

/** Words over the black; `working` = something is on its way (the breathing bar). */
function status(words, small, working) {
  layer.querySelector('.status')?.remove();
  const p = document.createElement('p');
  p.className = working ? 'status working' : 'status';
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
  // The next page fades in OVER the last one, which goes once it is covered.
  const olds = [...layer.querySelectorAll('canvas')];
  if (olds.length) {
    canvas.classList.add('is-next');
    layer.append(canvas);
    setTimeout(() => { for (const o of olds) o.remove(); }, 420);
  } else layer.append(canvas);
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
  const player = new YT.Player(host, {
    host: 'https://www.youtube-nocookie.com',
    videoId: b.youtube,
    width: '100%',
    height: '100%',
    playerVars: { autoplay: 1, controls: 0, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0, disablekb: 1, start: b.start || 0, origin: location.origin },
    events: {
      onReady: (e) => {
        if (!layer.contains(e.target.getIframe())) return;
        media = {
          play: () => player.playVideo(), pause: () => player.pauseVideo(), paused: () => player.getPlayerState() !== 1,
          seekBy: (by) => player.seekTo(Math.max(0, player.getCurrentTime() + by), true),
          mute: () => player.mute(), unmute: () => player.unMute(), muted: () => player.isMuted(),
          volume: () => player.getVolume(), setVolume: (v) => player.setVolume(v),
          t: () => player.getCurrentTime(), d: () => player.getDuration(), destroy: () => player.destroy(),
        };
        try { e.target.unMute(); e.target.playVideo(); } catch { /* blocked */ }
        report();
      },
      // Ended: black at once (never YouTube's end screen), then the TV takes it down itself
      // (POST /v1/cast/screen/back) and the code comes back, like the classroom's video.
      onStateChange: (e) => {
        if (e.data === 0) ended();
        report();
      },
    },
  });
}

/** A video ended: black at once (never an end screen), then the TV takes it down and the code comes back. */
function ended() {
  for (const el of layer.querySelectorAll('iframe, video, .fb-video')) el.style.visibility = 'hidden';
  request('/v1/cast/screen/back', { method: 'POST', body: {} }).catch(() => {});
}

/* ── An uploaded video (a clip) ── */

async function playClip(b, show) {
  status('Loading the video…', b.title && b.title !== 'Video' ? b.title : '', true);
  const blob = await fetchFile(b.file);
  if (showKey !== `${show.button.id}@${show.at}`) return;
  if (!blob) { status('The video could not be loaded.', 'Try putting it up again.'); return; }
  layer.querySelector('.status')?.remove();
  blobUrl = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.src = blobUrl;
  v.playsInline = true;
  v.autoplay = true;
  v.addEventListener('ended', ended);
  for (const ev of ['play', 'pause', 'volumechange']) v.addEventListener(ev, () => report());
  layer.append(v);
  media = {
    play: () => v.play().catch(() => {}), pause: () => v.pause(), paused: () => v.paused,
    seekBy: (by) => { v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration || 0); },
    mute: () => { v.muted = true; }, unmute: () => { v.muted = false; }, muted: () => v.muted,
    volume: () => Math.round(v.volume * 100), setVolume: (x) => { v.volume = x / 100; },
    t: () => v.currentTime, d: () => (Number.isFinite(v.duration) ? v.duration : 0),
    destroy: () => { v.pause(); v.removeAttribute('src'); v.load(); },
  };
  // Sound on when the browser allows it (KVBC Awana does); else the picture, muted.
  v.muted = false;
  v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  report(true);
}

/* ── A public Facebook video, in Facebook's own player ── */

let fbReady = null;
function facebookSdk() {
  if (window.castFacebook) return Promise.resolve(window.castFacebook);
  if (!fbReady) {
    fbReady = new Promise((ok, no) => {
      window.fbAsyncInit = () => { window.FB.init({ xfbml: false, version: 'v19.0' }); ok(window.FB); };
      const sc = document.createElement('script');
      sc.src = FB_SDK;
      sc.async = true;
      sc.onerror = () => { fbReady = null; no(new Error('facebook')); };
      document.head.append(sc);
    });
  }
  return fbReady;
}

async function playFacebook(b) {
  status('Loading the Facebook video…', b.title && b.title !== 'Facebook video' ? b.title : '', true);
  const box = document.createElement('div');
  box.className = 'fb-box';
  const el = document.createElement('div');
  el.className = 'fb-video';
  el.dataset.href = b.href;
  el.dataset.autoplay = 'true';
  el.dataset.allowfullscreen = 'false';
  el.dataset.showText = 'false';
  el.dataset.showCaptions = 'false';
  // Facebook's player takes a width; it picks the height from the video's shape.
  el.dataset.width = String(Math.round(Math.min(window.innerWidth, window.innerHeight * (16 / 9))));
  el.id = `fb-${b.id}`;
  box.append(el);
  layer.append(box);
  let FB;
  try { FB = await facebookSdk(); } catch { status('Facebook did not load.', 'The video may be private, or Facebook is blocked here.'); return; }
  if (!layer.contains(box)) return;
  const onReady = (msg) => {
    if (msg.type !== 'video' || msg.id !== el.id || !layer.contains(box)) return;
    FB.Event.unsubscribe('xfbml.ready', onReady);
    const p = msg.instance;
    layer.querySelector('.status')?.remove();
    let playing = false;
    const subs = [
      p.subscribe('startedPlaying', () => { playing = true; report(); }),
      p.subscribe('paused', () => { playing = false; report(); }),
      p.subscribe('finishedPlaying', () => { playing = false; ended(); }),
      p.subscribe('error', () => status('Facebook would not play that video.', 'Only public videos can be shown.')),
    ];
    media = {
      play: () => p.play(), pause: () => p.pause(), paused: () => !playing,
      seekBy: (by) => p.seek(Math.max(0, p.getCurrentPosition() + by)),
      mute: () => p.mute(), unmute: () => p.unmute(), muted: () => p.isMuted(),
      volume: () => Math.round(p.getVolume() * 100), setVolume: (x) => p.setVolume(x / 100),
      t: () => p.getCurrentPosition(), d: () => p.getDuration(),
      destroy: () => { for (const sub of subs) { try { sub.release(); } catch { /* gone */ } } },
    };
    try { p.unmute(); p.play(); } catch { /* blocked */ }
    report(true);
  };
  FB.Event.subscribe('xfbml.ready', onReady);
  FB.XFBML.parse(box);
}

/* ── The video presses (YouTube, a clip, Facebook) ── */

function videoCmd(d) {
  if (!media || !d) return;
  try {
    if (d.op === 'toggle') { if (media.paused()) media.play(); else media.pause(); }
    if (d.op === 'play') media.play();
    if (d.op === 'pause') media.pause();
    if (d.op === 'mute') media.mute();
    if (d.op === 'unmute') media.unmute();
    if (d.op === 'seek') media.seekBy(d.by);
    if (d.op === 'volume') {
      const v = Math.min(100, Math.max(0, Math.round((media.volume() + d.step * R.CLASSROOM_VOLUME_STEP_PCT) / 10) * 10));
      media.setVolume(v);
      if (v > 0 && media.muted()) media.unmute();
    }
    if (d.op === 'play' || d.op === 'toggle' || d.op === 'seek') for (const el of layer.querySelectorAll('iframe, video, .fb-video')) el.style.visibility = '';
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
  const entry = { id, pc: null, shown: false };
  rtc = entry;
  // The relay's servers for this share (worker/src/turn.js); none = direct only.
  const ice = await request(`/v1/cast/screen/ice?id=${encodeURIComponent(id)}`);
  const iceServers = ice.ok && ice.body && Array.isArray(ice.body.iceServers) ? ice.body.iceServers : [];
  if (rtc !== entry) return;
  // Never sit on black (owner 2026-11-08: "We got a black screen. That can't happen."):
  // no picture within CONNECT_WAIT_MS = say so, then back to the code.
  setTimeout(() => { if (rtc === entry && !entry.shown) shareFailed(entry, 'The presenter\u2019s screen did not arrive.'); }, CONNECT_WAIT_MS + 5000);
  try {
    entry.pc = await answerShare({
      iceServers,
      offerSdp: sig.sdp,
      sendAnswer: async (sdp) => {
        const a = await request('/v1/cast/screen/signal', { method: 'POST', body: { signal: { type: 'answer', id, sdp } } });
        if (!a.ok) throw new Error('answer refused');
      },
      onStream: (stream) => { if (rtc === entry) showStream(stream, entry); },
      onState: (st) => {
        if (rtc !== entry) return;
        if (st === 'failed') shareFailed(entry, 'The presenter\u2019s screen could not reach this TV.');
        if (st === 'disconnected') status('The presenter\u2019s screen paused…', 'Waiting for it to come back.', true);
      },
    });
    if (rtc !== entry) { try { entry.pc.close(); } catch { /* closed */ } }
  } catch {
    if (rtc === entry) { rtc = null; status('The presenter’s screen could not be connected.', 'They can press Share my screen again.'); }
  }
}

/** A share that will not show: words on the TV, then back to the code (never black). */
function shareFailed(entry, words) {
  if (rtc !== entry) return;
  status(words, 'Back to the code in a moment. They can press Share my screen to try again.');
  const id = entry.id;
  setTimeout(() => {
    if (stage.show && stage.show.button.id === id) request('/v1/cast/screen/back', { method: 'POST', body: {} }).catch(() => {});
  }, 6000);
}

function showStream(stream, entry) {
  let v = layer.querySelector('video');
  if (!v) {
    v = document.createElement('video');
    v.autoplay = true;
    v.playsInline = true;
    // Hidden until real picture arrives: the "Connecting…" words stay up until then.
    v.style.visibility = 'hidden';
    const shown = () => {
      if (!v.videoWidth) return;
      v.style.visibility = '';
      layer.querySelector('.status')?.remove();
      if (entry) entry.shown = true;
      report(true);
    };
    v.addEventListener('loadeddata', shown);
    v.addEventListener('resize', shown);
    v.addEventListener('playing', shown);
    layer.prepend(v);
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
  if (b && R.CLASSROOM_PLAYABLE_KINDS.includes(b.kind) && media) {
    try { out.video = { t: media.t(), d: media.d(), paused: media.paused(), muted: media.muted(), volume: media.volume() }; } catch { /* not yet */ }
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

  // A click or a key on the TV shows the code.
  document.addEventListener('pointerdown', () => { if (layer.hidden) reveal(); });
  document.addEventListener('keydown', () => { if (layer.hidden) reveal(); });
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
  setInterval(() => { if (stage.show && R.CLASSROOM_PLAYABLE_KINDS.includes(stage.show.button.kind)) report(true); }, T.reportVideoMs);
}

start();
