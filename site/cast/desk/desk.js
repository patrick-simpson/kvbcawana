// The Cast desk (owner 2026-11-09): KVBC Awana's back-of-house "Cast control" window on
// the lobby computer's other monitor (cast.kvbchurch.org/desk/). It shows the code, its
// QR and the join address ALWAYS (the TV's "hidden until asked" does not apply here),
// and does everything the presenter page does (controls.js, the same code), plus
// "Disconnect the presenter", alongside the one phone presenter: the Worker's
// /v1/cast/desk/* routes take the computer's own sign-in, never a presenter token, so a
// phone joining, leaving or being let go never touches this window (routes.md 10.18).
// No screen share: it is the TV's own computer.
//
// Signed in ONLY through the app: KVBC Awana's bridge (static/display/cast-preload.cjs,
// window.awanaCastHost.session()) hands over the computer's sign-in, kept in memory only
// (this page is only ever the app's window). A 401 asks the app once more (a newer
// sign-in after a passphrase change). A plain browser has no bridge: a calm note.

import { $, createControls, setText } from '../controls.js';
import { addressWords, clock, formatCode, presenterUrl } from '../logic.js';
import { drawQrCode } from '../qr.js';
import * as R from '../shared/classroomRemote.js';

// Windows 11 Mica (owner 2026-11-10): KVBC Awana's window has the real material when its
// bridge says so; then the page margins and the pane go transparent over it. Otherwise
// (a plain browser, an older app, Windows 10) the page paints its own Mica-like base.
if (window.awanaCastHost && window.awanaCastHost.material === 'mica') document.documentElement.classList.add('mica');

const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;

let session = '';
let askedAfter401 = false;
let shownCode = '';

// The Worker is this site's own /api. A test may name another (window.castBase).
let base = '';
if (typeof window.castBase === 'string') base = window.castBase;
if (!base && location.protocol === 'https:') base = `${location.origin}/api`;

const ui = createControls({
  base,
  tuning: window.castDeskTuning,
  nav: true,
  verb: 'Click', // a mouse, not a finger
  // The presenter's routes, as the desk's twins (worker/src/routes.md 10.18 "The desk").
  path: (p) => p.replace(/^\/v1\/cast\//, '/v1/cast/desk/'),
  headers: () => (session ? { Authorization: `Bearer ${session}` } : {}),
  live: () => Boolean(session),
  refused: () => { refused(); },
  onState: (body) => drawRoom(body),
});

/** The computer's sign-in from KVBC Awana's bridge, '' when there is none. */
async function sessionFromHost() {
  const host = window.awanaCastHost;
  if (!host || typeof host.session !== 'function') return '';
  try {
    const s = String((await host.session()) || '').trim();
    return SESSION_RE.test(s) ? s : '';
  } catch { return ''; }
}

/** A 401: ask the app once for a newer sign-in, else say so. */
async function refused() {
  const before = session;
  if (!askedAfter401) {
    askedAfter401 = true;
    const s = await sessionFromHost();
    if (s && s !== before) { session = s; ui.poll(); return; }
  }
  session = '';
  ui.forget();
  off('This computer is not signed in', 'Sign the lobby computer in from KVBC Awana’s Settings, then turn Cast off and on again.');
}

function off(title, words) {
  $('desk').hidden = true;
  $('desk-off').hidden = false;
  setText($('desk-off-title'), title);
  setText($('desk-off-words'), words);
}

/* ── The code, its QR, the join address, and the presenter ── */

function drawRoom(body) {
  drawTv(body);
  void refreshShot();
  const code = typeof body.code === 'string' && /^\d{6}$/.test(body.code) ? body.code : '';
  setText($('desk-code'), code ? formatCode(code) : '— — —');
  $('desk-code').setAttribute('aria-label', code ? `Code ${code.split('').join(' ')}` : 'No code yet');
  const here = body.presenter === true;
  setText($('desk-presenter'), here ? 'Presenter: connected' : 'Presenter: none connected');
  $('desk-presenter').dataset.on = String(here);
  $('presence').dataset.on = String(here);
  $('presence').title = here ? 'Presenter: connected' : 'Presenter: none connected';
  $('btn-kick').disabled = body.presenter !== true;
  if (code !== shownCode) {
    shownCode = code;
    drawQr(code);
  }
}

async function drawQr(code) {
  const box = $('desk-qr-box');
  if (!code) { box.hidden = true; return; }
  try {
    // Black on white in both themes (a phone camera reads that best; the card frames it).
    await drawQrCode($('desk-qr'), `${presenterUrl(location.href)}#code=${code}`, { dark: '#000000', light: '#FFFFFF', size: 640 });
    if (shownCode !== code) return;
    box.hidden = false;
  } catch {
    box.hidden = true;
  }
}

/* ── The TV card: the miniature, what is up, the video's progress ── */

const KIND_GLYPH = { video: 'video', clip: 'video', facebook: 'video', pdf: 'slides', image: 'picture', text: 'text', screen: 'share' };
const GLYPH_WORDS = { code: 'Showing its code', video: 'A video is playing', slides: 'Slides are up', picture: 'A picture is up', text: 'Text is up', share: 'A shared screen is up', off: 'The TV is not answering' };

function drawTv(body) {
  const stage = R.sanitizeStage(body.stage);
  const now = R.sanitizeClassroomNow(body.now);
  const shown = stage.show ? stage.show.button : null;
  const online = body.screenOnline === true;
  const glyph = !online ? 'off' : (shown ? (KIND_GLYPH[shown.kind] || 'code') : 'code');
  $('tv').dataset.kind = glyph;
  $('tv-mini').dataset.kind = glyph;
  setText($('tv-ph-label'), GLYPH_WORDS[glyph]);
  $('tv-live').hidden = !(online && shown);
  // Something up (or not): the short-window layout orders the right column by it.
  document.querySelector('.right').dataset.up = String(Boolean(online && shown));
  // The video's progress (display only; the buttons below move it).
  const video = shown && now && now.button === shown.id ? now.video : null;
  const bar = $('pg-track');
  $('tv-progress').hidden = !(video && video.d > 0);
  if (video && video.d > 0) {
    const pct = Math.max(0, Math.min(100, Math.round((video.t / video.d) * 1000) / 10));
    bar.style.setProperty('--p', `${pct}%`);
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    bar.setAttribute('aria-valuetext', `${clock(video.t)} of ${clock(video.d)}`);
    setText($('pg-t'), clock(video.t));
    setText($('pg-d'), clock(video.d));
  }
  $('btn-play').dataset.paused = String(Boolean(video && video.paused));
}

/* The live miniature: KVBC Awana's bridge hands over a JPEG of the TV's own window
   (local only, no Worker call). It is asked with each good state answer, which only
   happens while this page is visible and not idle-paused; with no bridge, or no picture,
   a designed placeholder (the glyph for what is up) stands in. */
let shotBusy = false;
let shotMisses = 0;
const SHOT_RE = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

function showShot(url) {
  const img = $('tv-shot');
  const on = Boolean(url);
  if (on && img.src !== url) img.src = url;
  img.hidden = !on;
  $('tv-mini').dataset.shot = String(on);
  $('tv').dataset.shot = String(on);
}

async function refreshShot() {
  if (document.hidden || shotBusy) return;
  const host = window.awanaCastHost;
  if (!host || typeof host.preview !== 'function') { showShot(null); return; }
  shotBusy = true;
  try {
    const url = await host.preview();
    if (typeof url === 'string' && url.length < 4_000_000 && SHOT_RE.test(url)) {
      // Decode first, so the swap never flickers.
      const probe = new Image();
      probe.src = url;
      try { await probe.decode(); } catch { throw new Error('bad picture'); }
      shotMisses = 0;
      showShot(url);
    } else if (++shotMisses >= 2) {
      showShot(null);
    }
  } catch {
    if (++shotMisses >= 2) showShot(null);
  } finally {
    shotBusy = false;
  }
}

/* ── The page header and the navigation pane's accent pill ── */

function selectedChoice() { return document.querySelector('.choice[aria-current="page"]') || document.querySelector('.choice'); }

function placePill() {
  const b = selectedChoice();
  if (b) $('nav-pill').style.setProperty('--y', `${b.offsetTop + Math.round((b.offsetHeight - 16) / 2)}px`);
}

function onNav(e) {
  const b = e.target.closest('.choice');
  if (!b) return;
  placePill();
  if ($('page-title').textContent !== b.dataset.title) {
    setText($('page-title'), b.dataset.title || '');
    setText($('page-cap'), b.dataset.cap || '');
    const head = $('pagehead');
    head.classList.remove('again');
    void head.offsetWidth;
    head.classList.add('again');
  }
}

/** Up and Down arrows move between the sources, as in a NavigationView. */
function onNavKey(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const all = [...document.querySelectorAll('.choice')];
  const i = all.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  all[(i + (e.key === 'ArrowDown' ? 1 : all.length - 1)) % all.length].focus();
}

/* ── InfoBars: a ProgressRing while a note says it is working ("Searching…"), and a
   success bar for the desk's own confirmations ── */

let deskSaid = '';
function watchNotes() {
  const seen = new MutationObserver((list) => {
    for (const m of list) {
      const note = m.target.nodeType === 1 ? m.target : m.target.parentElement;
      const el = note && note.closest ? note.closest('.note') : null;
      if (!el) continue;
      el.classList.toggle('working', /…$/.test(el.textContent || ''));
      if (el.id === 'press-note' && el.textContent !== deskSaid) delete el.dataset.sev;
    }
  });
  for (const n of document.querySelectorAll('.note')) seen.observe(n, { childList: true, characterData: true, subtree: true });
}

function say(words, ok) {
  const note = $('press-note');
  deskSaid = words;
  setText(note, words);
  if (ok) note.dataset.sev = 'ok'; else delete note.dataset.sev;
}

async function copyAddress() {
  const note = $('copy-note');
  try {
    await navigator.clipboard.writeText(presenterUrl(location.href));
    setText(note, 'Copied');
  } catch {
    setText(note, 'Could not copy');
  }
  clearTimeout(copyAddress.t);
  copyAddress.t = setTimeout(() => setText(note, ''), 1800);
}

async function reveal() {
  const r = await ui.request('/v1/cast/reveal', { method: 'POST', body: {} });
  if (r.status === 401) return;
  say(r.ok ? 'The code is showing on the TV for 5 minutes.' : 'The TV could not be asked to show its code. Try again.', r.ok);
}

/** "Disconnect the presenter": the tray's own route (POST /v1/cast/kick); what is on the TV stays. */
async function kick() {
  let r = { ok: false, status: 0 };
  try {
    const res = await fetch(`${base}/v1/cast/kick`, { method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    r = { ok: res.ok, status: res.status };
  } catch { /* offline */ }
  if (r.status === 401) { refused(); return; }
  say(r.ok ? 'The presenter was disconnected. What is on the TV stays.' : 'That did not work. Try again.', r.ok);
  ui.poll();
}

/* ── Start ── */

async function start() {
  setText($('desk-addr'), addressWords(presenterUrl(location.href)));
  session = await sessionFromHost();
  if (!session) {
    off('Open this on the lobby computer', 'This page is the lobby computer’s Cast control. It opens by itself on its second screen while Cast is on. To present from this device, go to the address below and type the code on the TV.');
    setText($('desk-off-addr'), addressWords(presenterUrl(location.href)));
    return;
  }
  $('desk-off').hidden = true;
  $('desk').hidden = false;
  ui.wire();
  $('btn-reveal').addEventListener('click', reveal);
  $('btn-kick').addEventListener('click', kick);
  $('btn-copy').addEventListener('click', copyAddress);
  document.querySelector('.choices').addEventListener('click', onNav);
  document.querySelector('.choices').addEventListener('keydown', onNavKey);
  watchNotes();
  placePill();
  addEventListener('resize', placePill);
  document.fonts && document.fonts.ready.then(placePill);
  ui.touch();
  ui.poll();
}

start();
