/* The opening-ceremony remote (owner 2026-10-19: "a remote created for opening
   ceremony on the games projector"; "The next buttons should progress through
   the existing slides. There should just be buttons as a backup").
   awana.kvbchurch.org/lobby/projector-remote.html, on the links page.

   - Signs in with the church passphrase exactly as a screen does (the lobby's
     own syncLogin: passphrase v2, only the derived key is sent; the session
     in the shared slot; the passphrase is never kept).
   - Finds the projectors on the screen list (GET /v1/screens, every 15 s
     while visible) and sends each press to every projector that is on, as
     one screen action (POST /v1/screens/<id>/action; worker/README.md): the
     Worker cleans it with the projector's own allowlist (SCREEN_ACTIONS) and
     rings that projector, which runs it (presentation/App.jsx).
   - Next / Back = the deck's arrow keys; the three backups put a flag beside
     its pledge, or the verse, over the wall until "Take the backup down". */
import '../../../shared/brand/fonts.css';
import './remote.css';
import { loadSyncSession, resolveSyncUrl, saveSyncSession, syncLogin, syncRequest } from '../lib/syncService.js';
import { COUNTDOWN_CONFIRM_MS, actionFor, pressWords, projectorsFrom, targetWords, targetsFor } from './logic.js';

const LIST_MS = 15000;
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };

let base = '';
/** @type {null | {id: string, name: string, online: boolean}[]} */
let projectors = null;
let listTimer = 0;
let wakeLock = null;

function setConn(state, text) {
  const el = $('conn');
  el.dataset.state = state;
  setText(el, text);
}

function showSignedOut(note = '') {
  clearTimeout(listTimer);
  $('remote').hidden = true;
  $('signin').hidden = false;
  setConn('off', 'Signed out');
  setText($('signin-note'), note);
}

function showSignedIn() {
  $('signin').hidden = true;
  $('remote').hidden = false;
  setConn('wait', 'Connecting…');
  refreshList();
  holdWake();
}

/** One signed-in call; a 401 signs this phone out. */
async function authed(path, opts = {}) {
  const session = loadSyncSession();
  if (!base || !session) { showSignedOut(); return { ok: false, status: -1, body: null }; }
  const res = await syncRequest(base, path, { ...opts, session });
  if (res.status === 401) {
    saveSyncSession('');
    showSignedOut('The passphrase was changed, or this phone was signed out. Sign in again.');
  }
  return res;
}

async function refreshList() {
  clearTimeout(listTimer);
  if (document.hidden || !loadSyncSession()) return;
  const res = await authed('/v1/screens');
  if (res.status === 401) return;
  if (res.ok) {
    projectors = projectorsFrom(res.body);
    setConn('ok', 'Connected');
  } else {
    setConn('bad', res.status === 0 ? 'Offline' : 'Trouble');
  }
  setText($('target'), targetWords(projectors));
  listTimer = window.setTimeout(refreshList, LIST_MS);
}

async function press(what) {
  const act = actionFor(what);
  if (!act) return;
  try { navigator.vibrate?.(12); } catch { /* no buzz here */ }
  const targets = targetsFor(projectors || []);
  if (targets.length) setText($('press-note'), 'Sending…');
  const results = await Promise.all(targets.map((p) => authed(`/v1/screens/${encodeURIComponent(p.id)}/action`, { method: 'POST', body: act })));
  if (results.some((r) => r.status === 401)) return;
  setText($('press-note'), pressWords(what, results));
}

async function signIn(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('passphrase'));
  if (!input.value.trim()) { setText($('signin-note'), 'Type the passphrase first.'); return; }
  if (!base) { setText($('signin-note'), 'The sync service is not set up yet, so the remote cannot work.'); return; }
  const btn = /** @type {HTMLButtonElement} */ ($('signin-btn'));
  btn.disabled = true;
  setText($('signin-note'), 'Signing in… (this takes a second or two)');
  try {
    const r = await syncLogin(base, input.value);
    if (!r.ok) { setText($('signin-note'), r.message); return; }
    input.value = '';
    setText($('signin-note'), '');
    showSignedIn();
  } finally {
    btn.disabled = false;
  }
}

async function holdWake() {
  try {
    if (!wakeLock && !document.hidden && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* the phone may sleep; presses still work */ }
}

async function start() {
  $('signin-form').addEventListener('submit', signIn);
  $('signout').addEventListener('click', () => { saveSyncSession(''); projectors = null; showSignedOut('Signed out on this phone.'); });
  for (const el of document.querySelectorAll('[data-step]')) el.addEventListener('click', () => press(/** @type {HTMLElement} */ (el).dataset.step || ''));
  for (const el of document.querySelectorAll('[data-backup]')) el.addEventListener('click', () => press(/** @type {HTMLElement} */ (el).dataset.backup || ''));
  $('btn-backup-end').addEventListener('click', () => press('backup-end'));
  // Back to the countdown asks twice (a mis-tap would undo a ceremony): the first tap arms it.
  let armTimer = 0;
  const countdownBtn = $('btn-countdown');
  const disarm = () => { window.clearTimeout(armTimer); armTimer = 0; countdownBtn.dataset.armed = '0'; countdownBtn.textContent = 'Back to the countdown'; };
  countdownBtn.addEventListener('click', () => {
    if (!armTimer) {
      countdownBtn.dataset.armed = '1';
      countdownBtn.textContent = 'Tap again to go back to the countdown';
      armTimer = window.setTimeout(disarm, COUNTDOWN_CONFIRM_MS);
      return;
    }
    disarm();
    press('countdown');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || $('remote').hidden) return;
    refreshList();
    holdWake();
  });
  window.addEventListener('online', () => { if (!$('remote').hidden) refreshList(); });
  base = await resolveSyncUrl();
  if (!base) { showSignedOut('The sync service is not set up yet, so the remote cannot work.'); return; }
  if (loadSyncSession()) showSignedIn();
  else showSignedOut();
}

start();
