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
import { addressWords, formatCode, presenterUrl } from '../logic.js';
import { drawQrCode } from '../qr.js';

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
  const code = typeof body.code === 'string' && /^\d{6}$/.test(body.code) ? body.code : '';
  setText($('desk-code'), code ? formatCode(code) : '— — —');
  $('desk-code').setAttribute('aria-label', code ? `Code ${code.split('').join(' ')}` : 'No code yet');
  setText($('desk-presenter'), body.presenter === true ? 'A presenter is connected.' : 'No presenter is connected.');
  $('desk-presenter').dataset.on = String(body.presenter === true);
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

async function reveal() {
  const r = await ui.request('/v1/cast/reveal', { method: 'POST', body: {} });
  if (r.status === 401) return;
  setText($('press-note'), r.ok ? 'The code is showing on the TV for 5 minutes.' : 'The TV could not be asked to show its code. Try again.');
}

/** "Disconnect the presenter": the tray's own route (POST /v1/cast/kick); what is on the TV stays. */
async function kick() {
  let r = { ok: false, status: 0 };
  try {
    const res = await fetch(`${base}/v1/cast/kick`, { method: 'POST', headers: { Authorization: `Bearer ${session}`, 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    r = { ok: res.ok, status: res.status };
  } catch { /* offline */ }
  if (r.status === 401) { refused(); return; }
  setText($('press-note'), r.ok ? 'The presenter was disconnected. What is on the TV stays.' : 'That did not work. Try again.');
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
  ui.touch();
  ui.poll();
}

start();
