// Cast, the presenter's page (owner 2026-11-08: "set it up kind of like an air
// server ... present from their laptop but through a webpage that is controlling
// that computer"; "TV code only"). cast.kvbchurch.org (awana.kvbchurch.org/cast before 2026-11-09)
//
// This file is the presenter's way IN; what they can put up is controls.js (shared with
// the lobby computer's desk, desk/desk.js, owner 2026-11-09).
// - The code on the TV is the only way in (POST /v1/cast/join): the Worker answers a
//   TOKEN, kept in sessionStorage only (this tab, gone when it closes), carried as
//   X-Cast-Token on every call. A 401 means the room moved on (a new code, Cast off,
//   the token's 8 hours up): the token is dropped and the code asked again.
// - ONE presenter at a time (owner 2026-11-08): a join while someone else presents is
//   refused (the Worker's 409 `busy`, its own words); Disconnect frees the room
//   (POST /v1/cast/leave) and "Display code" also puts the TV back to its code.
// - The TV's QR code opens this page as cast.kvbchurch.org/#code=123456: the code is read from the
//   fragment, the address cleaned, and it connects.
// - Pass the remote (owner 2026-11-15: "Hand the presenter spot to a second person with one
//   tap"): the presenter asks for a one-time pass code (POST /v1/cast/pass, good 2 minutes)
//   and shows it big with a QR of cast.kvbchurch.org/#pass=<code>. The next person scans it
//   (or types the code on this join screen: one field takes either) and takes the spot; this
//   page's next read is 401 `passed`, and it says calmly "You passed the remote". The card's
//   time left is counted HERE (a one-second redraw while it is open, never a request).
// worker/src/routes.md 10.18.

import { TOKEN_KEY, TOKEN_RE, cleanCode, codeReady, formatCode, joinWords, codeFromHash, errorWords, passFromHash, passUrl, passWords } from './logic.js';
import { $, createControls, replay, setText } from './controls.js';
import { drawQrCode } from './qr.js';

// The token lives in THIS tab only (sessionStorage), never localStorage: a guest's
// laptop keeps nothing once the tab is closed.
let memToken = '';
const tokenStore = {
  get() { try { const t = sessionStorage.getItem(TOKEN_KEY) || ''; return TOKEN_RE.test(t) ? t : ''; } catch { return memToken; } },
  set(v) { memToken = v || ''; try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private window: memory only */ } },
};

// The Worker is this site's own /api (cast.kvbchurch.org and the old /cast/ copy alike:
// each site answers /api through the sync service), so the page asks nothing first. A
// test may name another (window.castBase).
let base = '';
if (typeof window.castBase === 'string') base = window.castBase;
if (!base && location.protocol === 'https:') base = `${location.origin}/api`;

const ui = createControls({
  base,
  tuning: window.castTuning,
  path: (p) => p,
  headers: () => {
    const headers = {};
    const token = tokenStore.get();
    if (token) headers['X-Cast-Token'] = token;
    return headers;
  },
  live: () => Boolean(tokenStore.get()),
  refused: (words, body) => disconnected(words, body),
});

/* ── Step 1: the code ── */

const JOIN_TITLE = 'Present on the TV';
const JOIN_LEDE = 'Type the code shown on the TV.';

function showJoin(note, bad, passed = false) {
  ui.stopPolling();
  closePass(false);
  // Passed on (Pass the remote): the same screen, said calmly; the code field is the way back in.
  $('join').dataset.passed = String(passed);
  setText($('join-title'), passed ? 'You passed the remote' : JOIN_TITLE);
  setText($('join-lede'), passed ? 'Someone else is presenting now. To present again, ask them to pass it back, or type the code on the TV once they disconnect.' : JOIN_LEDE);
  const was = $('join').hidden;
  $('present').hidden = true;
  $('leave').hidden = true;
  $('join').hidden = false;
  if (was) replay($('join'), 'm-enter');
  setText($('join-note'), note || '');
  $('join-note').classList.toggle('bad', Boolean(bad));
}

function showPresent() {
  $('join').hidden = true;
  $('present').hidden = false;
  replay($('present'), 'm-enter');
  $('leave').hidden = false;
  ui.touch();
  ui.poll();
}

function disconnected(words, body) {
  if (!tokenStore.get() && $('present').hidden) return;
  tokenStore.set('');
  ui.forget();
  if (body && body.reason === 'passed') showJoin('', false, true);
  else showJoin(words, true);
}

/* ── Pass the remote ── */

let passTimer = 0;
let passUntil = 0;

/** The card's time left (this device's clock); once it runs out, the card says so. */
function tickPass() {
  const w = passWords(passUntil, Date.now());
  $('pass-card').dataset.live = String(w.live);
  setText($('pass-note'), w.words);
  $('pass-again').hidden = w.live;
  setText($('pass-cancel'), w.live ? 'Cancel' : 'Close');
  if (!w.live) { clearInterval(passTimer); passTimer = 0; }
}

async function makePass() {
  ui.touch();
  const btn = $('btn-pass');
  btn.disabled = true;
  $('pass-again').disabled = true;
  const r = await ui.request('/v1/cast/pass', { method: 'POST', body: {} });
  btn.disabled = false;
  $('pass-again').disabled = false;
  if (r.status === 401) return;
  if (!r.ok || !r.body || !codeReady(r.body.code)) { setText($('press-note'), errorWords(r.status, r.body)); return; }
  const card = $('pass-card');
  passUntil = Date.now() + (Number(r.body.ttlMs) || 0);
  $('pass-code').textContent = formatCode(r.body.code);
  card.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  card.dataset.qr = 'loading';
  // Charcoal on white: a phone's camera reads it off another phone's screen.
  drawQrCode($('pass-qr'), passUrl(location.origin, r.body.code), { dark: '#3A332A', light: '#FFFFFF', size: 264 })
    .then(() => { card.dataset.qr = 'ready'; }, () => { card.dataset.qr = 'none'; });
  clearInterval(passTimer);
  tickPass();
  passTimer = setInterval(tickPass, 1000);
}

/** The card away; `cancel` (the presenter changed their mind) takes the pass back too. */
function closePass(cancel) {
  const live = $('pass-card').dataset.live === 'true' && !$('pass-card').hidden;
  clearInterval(passTimer);
  passTimer = 0;
  $('pass-card').hidden = true;
  $('pass-card').dataset.live = 'false';
  $('btn-pass').setAttribute('aria-expanded', 'false');
  if (cancel && live && tokenStore.get()) ui.request('/v1/cast/pass', { method: 'POST', body: { cancel: true } });
}

async function join(event) {
  if (event) event.preventDefault();
  const code = cleanCode($('code').value);
  if (!codeReady(code)) { showJoin('The code is six numbers, shown on the TV.', true); $('code').focus(); return; }
  if (!base) { showJoin('Cast cannot reach the church’s service right now. Reload in a minute.', true); return; }
  $('join-btn').disabled = true;
  setText($('join-note'), 'Connecting…');
  $('join-note').classList.remove('bad');
  const r = await ui.request('/v1/cast/join', { method: 'POST', body: { code } });
  $('join-btn').disabled = false;
  if (!r.ok || !r.body || !TOKEN_RE.test(r.body.token || '')) { showJoin(joinWords(r.status, r.body), true); return; }
  tokenStore.set(r.body.token);
  $('code').value = '';
  showPresent();
  if (r.body.passed === true) setText($('press-note'), 'The remote is yours now.');
}

/** The code field: digits only, grouped as the TV shows them ("123 456"); a paste of six digits connects. */
function onCodeInput() {
  const el = $('code');
  const d = cleanCode(el.value);
  const shown = formatCode(d);
  if (el.value !== shown) el.value = shown;
  if (d.length === 6 && $('join-note').classList.contains('bad')) setText($('join-note'), '');
}

/** Free the room (the Worker drops this page's token); takeDown puts the TV back to its code. */
async function leave(takeDown) {
  await ui.letGo(takeDown);
  if (tokenStore.get()) await ui.request('/v1/cast/leave', { method: 'POST', body: takeDown ? { takeDown: true } : {} });
  tokenStore.set('');
  showJoin(takeDown ? 'The code is back on the TV, ready for the next person. Thanks!' : 'Disconnected. Type the code again to present.');
}

/* ── Start ── */

function start() {
  $('join-form').addEventListener('submit', join);
  $('code').addEventListener('input', onCodeInput);
  $('leave').addEventListener('click', () => leave(false));
  $('btn-code').addEventListener('click', () => leave(true));
  $('btn-pass').addEventListener('click', () => { if ($('pass-card').hidden) makePass(); else closePass(true); });
  $('pass-again').addEventListener('click', makePass);
  $('pass-cancel').addEventListener('click', () => closePass(true));
  ui.wire();

  // The TV's QR code: cast.kvbchurch.org/#code=123456 (a pass: #pass=123456, the same
  // field takes it). The code leaves the address bar at once.
  const fromPass = passFromHash(location.hash);
  const fromQr = codeFromHash(location.hash) || fromPass;
  if (fromQr) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* fine */ } }
  // A pass is taken even by a tab that still holds a token (its own spot is moot).
  if (tokenStore.get() && base && !fromPass) showPresent();
  else if (fromQr && base) { showJoin(''); $('code').value = formatCode(fromQr); join(null); }
  else showJoin('');
  if (!tokenStore.get() && !fromQr) $('code').focus();
}

start();
