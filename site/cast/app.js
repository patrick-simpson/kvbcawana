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
// worker/src/routes.md 10.18.

import { TOKEN_KEY, TOKEN_RE, cleanCode, codeReady, formatCode, joinWords, codeFromHash } from './logic.js';
import { $, createControls, replay, setText } from './controls.js';

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
  refused: (words) => disconnected(words),
});

/* ── Step 1: the code ── */

function showJoin(note, bad) {
  ui.stopPolling();
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

function disconnected(words) {
  if (!tokenStore.get() && $('present').hidden) return;
  tokenStore.set('');
  ui.forget();
  showJoin(words, true);
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
  ui.wire();

  // The TV's QR code: cast.kvbchurch.org/#code=123456. The code leaves the address bar at once.
  const fromQr = codeFromHash(location.hash);
  if (fromQr) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* fine */ } }
  if (tokenStore.get() && base) showPresent();
  else if (fromQr && base) { showJoin(''); $('code').value = formatCode(fromQr); join(null); }
  else showJoin('');
  if (!tokenStore.get() && !fromQr) $('code').focus();
}

start();
