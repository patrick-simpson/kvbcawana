/* The game time scoreboard, the leader's phone (owner 2026-11-05).
   awana.kvbchurch.org/lobby/scoreboard.html; on the links page and a button on
   the projector remote.

   - Signs in with the church passphrase exactly as the projector remote does
     (passphrase v2: only the derived key is sent; the session in the shared
     slot; the passphrase is never kept).
   - The toggle puts T&T, Sparks or Cubbies on the projector (POST
     /v1/scoreboard/club; switching away from a club that has points asks for a
     second tap, then the projector plays that club's winner first). Four big
     +1 plates (blue top-left, red top-right, yellow bottom-left, green
     bottom-right) and a smaller -1 under each. End game takes two taps.
   - A tap shows at once (this phone's taps still on their way are drawn on top
     of the last board) and the Worker's answer replaces it.
   - Another phone's taps: it reads the board every 3 s while visible (every
     15 s when no club is up and no clock runs), nothing while hidden, and it
     stops after 30 min with no touch (the free plan's daily requests). It
     opens no live channel of its own (src/lib/privacyGuard.test.js: only
     useSocket.js does); each read also times the clock offset.
   - The stopwatch / timer runs on the Worker's clock (shared/scoreboard.js
     createClockSync), so this phone and the wall read the same tenth. */
import '../../../shared/brand/fonts.css';
import './scoreboard.css';
import { loadSyncSession, resolveSyncUrl, saveSyncSession, syncLogin, syncRequest } from '../lib/syncService.js';
import {
  SCORE_ALL_TEAMS,
  SCORE_CLUBS,
  SCORE_CLUB_WORDS,
  SCORE_SETUPS,
  SCORE_SETUP_IDS,
  SCORE_TEAM_WORDS,
  anyPoints,
  cleanBoard,
  clockFace,
  clockReading,
  createClockSync,
  teamsFor,
} from '../../../shared/scoreboard.js';
import schedule from '../../../shared/schedule.json';
import {
  CLUB_FIELDS, CONFIRM_MS, OUTBOX_MAX, RETRY_MIN_MS, gameClockWords, liveWords, mmss, newTapId, nextRetryMs,
  retryable, sheetButtons, shownScores, stepTimer, waitingWords,
} from './logic.js';

/** A read while a game or a clock is on: another phone's taps show within this. */
const GAME_READ_MS = 3 * 1000;
/** A read while nothing is up. */
const QUIET_READ_MS = 15 * 1000;
const IDLE_STOP_MS = 30 * 60 * 1000;

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };
const wallNow = () => performance.timeOrigin + performance.now();

let base = '';
/** @type {ReturnType<typeof cleanBoard>} */
let board = null;
const sync = createClockSync();
/** This phone's taps not yet answered, per team, for the club that is up. */
let pending = /** @type {Record<string, number>} */ ({});
/** Taps a ring already counted before their own answer came back. */
let absorbed = /** @type {Record<string, number>} */ ({});
let pendingClub = /** @type {string|null} */ (null);
let lastActive = Date.now();
let paused = false;

// ── Requests ─────────────────────────────────────────────────────────────

/** One signed-in call, timed for the clock offset; a 401 signs this phone out. */
async function authed(path, opts = {}) {
  const session = loadSyncSession();
  if (!base || !session) { showSignedOut(); return { ok: false, status: -1, body: null }; }
  const sentAt = wallNow();
  const res = await syncRequest(base, path, { ...opts, session });
  const gotAt = wallNow();
  if (res.status === 401) {
    saveSyncSession('');
    showSignedOut('The passphrase was changed, or this phone was signed out. Sign in again.');
  }
  if (res.body && Number.isFinite(res.body.serverNow)) sync.add(sentAt, gotAt, res.body.serverNow);
  return res;
}

const serverNow = () => wallNow() + sync.offset();

/**
 * Keep a board when it is newer than the one drawn. `fromRead`: it came from a
 * read (it may already hold a tap of ours whose own answer is still on its way).
 */
function take(raw, fromRead = false) {
  const b = cleanBoard(raw);
  if (!b) return;
  if (board && b.rev <= board.rev) return;
  const before = board;
  board = b;
  // A ring that already holds a tap of ours still on its way: count it once.
  if (fromRead && before && b.active && b.active === before.active && b.active === pendingClub) {
    for (const t of SCORE_ALL_TEAMS) {
      const moved = b.scores[b.active][t] - before.scores[b.active][t];
      const p = pending[t] || 0;
      if (moved !== 0 && p !== 0 && Math.sign(moved) === Math.sign(p)) {
        const a = Math.sign(p) * Math.min(Math.abs(moved), Math.abs(p));
        pending[t] = p - a;
        absorbed[t] = (absorbed[t] || 0) + a;
      }
    }
  }
  if (b.active !== pendingClub) { pending = {}; absorbed = {}; pendingClub = b.active; }
  render();
  // A game or a clock just came on: the next read moves up to the game's pace.
  if (readTimer) scheduleRead();
}

async function read() {
  clearTimeout(readTimer);
  readTimer = 0;
  if (!loadSyncSession() || document.hidden) return;
  const res = await authed('/v1/scoreboard');
  if (res.status === 401) return;
  if (res.ok) {
    take(res.body.board, true);
    if (outbox.length && retryTimer) flush();
    else if ($('live').dataset.state !== 'bad') setLive('ok');
  }
  else setLive(res.status === 0 ? 'off' : 'wait');
  if (Date.now() - lastActive > IDLE_STOP_MS && !outbox.length) { paused = true; letSleep(); setText($('live'), 'Paused · tap anywhere to update'); return; }
  scheduleRead();
}
let readTimer = 0;
let readDueAt = 0;

/** The next read: soon while a game or a clock is on, slower otherwise; never pushed later than due. */
function scheduleRead() {
  if (paused || document.hidden || !loadSyncSession()) return;
  const wait = board?.active || board?.clock ? GAME_READ_MS : QUIET_READ_MS;
  const due = Date.now() + wait;
  if (readTimer && readDueAt <= due) return;
  clearTimeout(readTimer);
  readDueAt = due;
  readTimer = window.setTimeout(() => { readTimer = 0; read(); }, wait);
}

function setLive(state) {
  const el = $('live');
  el.dataset.state = state;
  setText(el, liveWords(state));
}

// ── Drawing ──────────────────────────────────────────────────────────────

function render() {
  const club = board?.active ?? null;
  document.body.style.setProperty('--sb-field', CLUB_FIELDS[club || 'none']);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CLUB_FIELDS[club || 'none']);
  for (const btn of document.querySelectorAll('.sb-club')) {
    const c = /** @type {HTMLElement} */ (btn).dataset.club;
    btn.setAttribute('aria-pressed', String(c === club));
    if (c !== armedSwitch) setText(btn, SCORE_CLUB_WORDS[c]);
  }
  const teams = $('teams');
  teams.dataset.off = club ? '0' : '1';
  const playing = teamsFor(board, club);
  buildTeams(playing);
  const shown = shownScores(board, club, pending);
  for (const t of playing) {
    const num = document.querySelector(`.sb-plus[data-team="${t}"] .sb-plus__num`);
    if (num && num.textContent !== String(shown[t])) {
      num.textContent = String(shown[t]);
    }
    /** @type {HTMLButtonElement} */ (document.querySelector(`.sb-plus[data-team="${t}"]`)).disabled = !club;
    /** @type {HTMLButtonElement} */ (document.querySelector(`.sb-minus[data-team="${t}"]`)).disabled = !club || shown[t] <= 0;
  }
  /** @type {HTMLButtonElement} */ ($('end-btn')).disabled = !club;
  const sounds = soundsPending ?? board?.sounds === true;
  $('sound-btn').setAttribute('aria-checked', String(sounds));
  setText($('sound-word'), sounds ? 'On: a chime per point, a buzzer at 0:00' : 'Off: no chime or buzzer');
  if (!$('opts').hidden) drawOpts();
  if (!club) disarmEnd();
  drawGameClock();
  drawClockButton();
  if (!$('sheet').hidden) drawSheet();
}

/** The plates for the teams in play: the 2 x 2, or two halves (owner 2026-11-05: team setups). */
let builtFor = '';
function buildTeams(playing) {
  const key = playing.join();
  if (key === builtFor) return;
  builtFor = key;
  const box = $('teams');
  box.dataset.count = String(playing.length);
  for (const el of box.querySelectorAll('.sb-team')) el.remove();
  const note = $('pick-note');
  for (const t of playing) {
    const word = SCORE_TEAM_WORDS[t];
    const name = word[0] + word.slice(1).toLowerCase();
    const wrap = document.createElement('div');
    wrap.className = 'sb-team';
    wrap.dataset.team = t;
    wrap.innerHTML = `<button type="button" class="sb-plus" data-team="${t}" aria-label="${name} plus one"><span class="sb-plus__name">${name}</span><span class="sb-plus__num">0</span><span class="sb-plus__hint">Tap +1</span></button>`
      + `<button type="button" class="sb-minus" data-team="${t}" aria-label="${name} minus one">−1</button>`;
    box.insertBefore(wrap, note);
  }
}

function drawGameClock() {
  const w = gameClockWords(schedule, board?.active ?? null, new Date());
  setText($('game-label'), w.label);
  setText($('game-left'), w.left);
}

function drawClockButton() {
  const btn = $('clock-btn');
  const r = board?.clock ? clockReading(board.clock, serverNow()) : null;
  btn.dataset.on = r ? (r.done ? 'done' : r.running ? 'running' : 'paused') : '';
  const mini = $('clock-mini');
  mini.hidden = !r;
  if (r) setText(mini, clockFace(r.ms, r.kind).main);
}

// ── The stopwatch / timer sheet ─────────────────────────────────────────

let sheetKind = /** @type {'stopwatch'|'timer'} */ ('stopwatch');
let timerSecs = 60;

function drawSheet() {
  const r = board?.clock ? clockReading(board.clock, serverNow()) : null;
  for (const b of document.querySelectorAll('.sb-seg__btn')) b.setAttribute('aria-selected', String(/** @type {HTMLElement} */ (b).dataset.kind === sheetKind));
  const mine = r && r.kind === sheetKind ? r : null;
  const ms = mine ? mine.ms : sheetKind === 'timer' ? timerSecs * 1000 : 0;
  const face = clockFace(ms, sheetKind);
  setText($('readout-main'), face.main);
  setText($('readout-tenth'), `.${face.tenth}`);
  const state = mine ? (mine.done ? "Time's up!" : mine.running ? 'Running on the projector' : 'Paused') : r ? `The ${r.kind} is on the projector` : '';
  setText($('readout-state'), state);
  $('sheet').dataset.state = mine ? (mine.done ? 'done' : mine.running ? 'running' : 'paused') : 'idle';
  const b = sheetButtons(r, sheetKind);
  setText($('clock-go'), b.go);
  $('clock-go').dataset.op = b.goOp;
  setText($('clock-reset'), b.reset);
  $('clock-reset').hidden = !b.resetShown;
  $('clock-go').style.gridColumn = b.resetShown ? '' : '1 / -1';
  $('timer-set').hidden = !(sheetKind === 'timer' && b.setting);
  setText($('step-value'), mmss(timerSecs));
  for (const p of document.querySelectorAll('.sb-pick-btn')) p.setAttribute('aria-pressed', String(Number(/** @type {HTMLElement} */ (p).dataset.secs) === timerSecs));
}

let frame = 0;
function tick() {
  if (board?.clock) {
    drawClockButton();
    if (!$('sheet').hidden) drawSheet();
  }
  frame = requestAnimationFrame(tick);
}

function openSheet() {
  if (board?.clock) sheetKind = board.clock.kind;
  $('sheet').hidden = false;
  $('sheet-scrim').hidden = false;
  drawSheet();
  /** @type {HTMLElement} */ ($('clock-go')).focus();
}
function closeSheet() {
  $('sheet').hidden = true;
  $('sheet-scrim').hidden = true;
  $('clock-btn').focus();
}

async function clockPress(body) {
  buzz();
  const res = await authed('/v1/scoreboard/clock', { method: 'POST', body });
  if (res.body?.board) take(res.body.board);
  if (!res.ok && res.status !== 401) setText($('clock-note'), res.status === 0 ? 'Offline: the projector did not get that.' : (res.body?.error || 'That did not go through. Try again.'));
  else setText($('clock-note'), 'Shows big on the projector. Closing this keeps it running.');
}

// ── Presses ──────────────────────────────────────────────────────────────

const buzz = () => { try { navigator.vibrate?.(10); } catch { /* no buzz here */ } };

async function point(team, delta) {
  const club = board?.active;
  if (!club) return;
  const shown = shownScores(board, club, pending);
  if (delta < 0 && shown[team] <= 0) return;
  if (outbox.length >= OUTBOX_MAX) { flash('Too many taps waiting. Check the Wi-Fi.'); return; }
  buzz();
  pendingClub = club;
  pending[team] = (pending[team] || 0) + delta;
  bump(team, delta);
  render();
  outbox.push({ id: newTapId(), club, team, delta });
  flush();
}

// The taps on their way (owner 2026-11-06: "don't lose taps"): sent one at a
// time in the order tapped; one that does not get through (no signal, the
// answer lost, the service busy) stays first in line and is sent again, with
// the same id so the Worker counts it once, 1 s then doubling to 8 s, at once
// when the phone is back online or a read gets through. The plates already
// show it (pending). Memory only: a reload loses taps still waiting.
/** @type {{id: string, club: string, team: string, delta: number}[]} */
const outbox = [];
let sending = false;
let retryTimer = 0;
let retryMs = RETRY_MIN_MS;

/** One answered tap leaves the pending count (or the absorbed one, if a read counted it first). */
function settle(tap) {
  if (pendingClub !== tap.club) return;
  const { team, delta } = tap;
  if ((absorbed[team] || 0) !== 0 && Math.sign(absorbed[team]) === Math.sign(delta)) absorbed[team] -= delta;
  else pending[team] = (pending[team] || 0) - delta;
}

async function flush() {
  if (sending) return;
  clearTimeout(retryTimer);
  retryTimer = 0;
  sending = true;
  try {
    while (outbox.length) {
      const tap = outbox[0];
      const res = await authed('/v1/scoreboard/point', { method: 'POST', body: tap });
      if (res.status === 401) {
        // Signed out: these taps cannot go anywhere now.
        outbox.length = 0;
        pending = {};
        absorbed = {};
        break;
      }
      if (retryable(res.status)) {
        retryTimer = window.setTimeout(flush, retryMs);
        retryMs = nextRetryMs(retryMs);
        return;
      }
      outbox.shift();
      retryMs = RETRY_MIN_MS;
      settle(tap);
      if (res.body?.board) take(res.body.board);
      if (!res.ok) flash(res.body?.reason === 'not-active' ? 'Another club is up now.' : 'That point did not go through. Tap again.');
      render();
    }
  } finally {
    sending = false;
    drawWaiting();
  }
}

/** The status line says how many taps are waiting while one has failed; back to Live when all are in. */
let wasWaiting = false;
function drawWaiting() {
  const waiting = outbox.length > 0 && retryTimer !== 0;
  if (waiting) {
    const el = $('live');
    el.dataset.state = 'queued';
    setText(el, waitingWords(outbox.length));
  } else if (wasWaiting) {
    setLive('ok');
  }
  wasWaiting = waiting;
}

function bump(team, delta) {
  const el = document.querySelector(`.sb-plus[data-team="${team}"]`);
  if (!el || delta < 0) return;
  el.classList.remove('is-bump');
  void (/** @type {HTMLElement} */ (el)).offsetWidth;
  el.classList.add('is-bump');
}

let flashTimer = 0;
function flash(words) {
  const el = $('live');
  setText(el, words);
  el.dataset.state = 'bad';
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => setLive('ok'), 4000);
}

let armedSwitch = /** @type {string|null} */ (null);
let switchTimer = 0;
function disarmSwitch() {
  clearTimeout(switchTimer);
  const was = armedSwitch;
  armedSwitch = null;
  if (was) {
    const btn = document.querySelector(`.sb-club[data-club="${was}"]`);
    if (btn) { btn.removeAttribute('data-armed'); setText(btn, SCORE_CLUB_WORDS[was]); }
  }
}

async function pickClub(club) {
  if (!SCORE_CLUBS.includes(club) || board?.active === club) return;
  const cur = board?.active;
  // Switching away from a game with points ends it (its winner plays first): a second tap.
  if (cur && anyPoints(board.scores[cur], teamsFor(board, cur)) && armedSwitch !== club) {
    disarmSwitch();
    armedSwitch = club;
    const btn = document.querySelector(`.sb-club[data-club="${club}"]`);
    if (btn) { btn.setAttribute('data-armed', '1'); setText(btn, 'Tap again'); }
    flash(`Tap ${SCORE_CLUB_WORDS[club]} again to end ${SCORE_CLUB_WORDS[cur]} and switch.`);
    switchTimer = window.setTimeout(disarmSwitch, CONFIRM_MS);
    return;
  }
  disarmSwitch();
  buzz();
  const res = await authed('/v1/scoreboard/club', { method: 'POST', body: { club } });
  if (res.body?.board) take(res.body.board);
  if (!res.ok && res.status !== 401) flash(res.status === 0 ? 'Offline: the projector did not change.' : 'That did not go through. Try again.');
}

let endTimer = 0;
function disarmEnd() {
  clearTimeout(endTimer);
  endTimer = 0;
  const btn = $('end-btn');
  btn.dataset.armed = '0';
  setText(btn, 'End game');
}
async function endGame() {
  if (!board?.active) return;
  const btn = $('end-btn');
  if (!endTimer) {
    btn.dataset.armed = '1';
    setText(btn, 'Tap again to end');
    endTimer = window.setTimeout(disarmEnd, CONFIRM_MS);
    return;
  }
  disarmEnd();
  buzz();
  const res = await authed('/v1/scoreboard/end', { method: 'POST', body: {} });
  if (res.body?.board) take(res.body.board);
  if (!res.ok && res.status !== 401) flash(res.status === 0 ? 'Offline: the game did not end.' : 'That did not go through. Try again.');
}

// ── The sound switch (owner 2026-11-05: "add the sound switch") ──────────

/** This phone's switch still on its way (drawn at once; the Worker's answer replaces it). */
let soundsPending = /** @type {boolean|null} */ (null);
async function toggleSounds() {
  const on = !(soundsPending ?? board?.sounds === true);
  buzz();
  soundsPending = on;
  render();
  const res = await authed('/v1/scoreboard/sounds', { method: 'POST', body: { on } });
  soundsPending = null;
  if (res.body?.board) take(res.body.board);
  if (!res.ok && res.status !== 401) flash(res.status === 0 ? 'Offline: the sound did not change.' : 'That did not go through. Try again.');
  render();
}

// ── Team setups (owner 2026-11-05: the Options button) ──────────────────

let askingFor = /** @type {string|null} */ (null);

function drawOpts() {
  const club = board?.active;
  // The sound switch works any time; the team setups need a club up.
  $('opts-none').hidden = Boolean(club);
  $('opts-list').hidden = !club;
  if (!club) { askingFor = null; $('opts-ask').hidden = true; setText($('opts-club'), 'the club'); return; }
  setText($('opts-club'), SCORE_CLUB_WORDS[club]);
  const list = $('opts-list');
  if (!list.childElementCount) {
    for (const id of SCORE_SETUP_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-setup';
      b.dataset.setup = id;
      b.setAttribute('role', 'radio');
      b.innerHTML = `<span class="sb-setup__swatches" aria-hidden="true">${SCORE_SETUPS[id].teams.map((t) => `<i data-team="${t}"></i>`).join('')}</span><span class="sb-setup__words">${SCORE_SETUPS[id].words}</span>`;
      b.addEventListener('click', () => chooseSetup(id));
      list.append(b);
    }
  }
  const current = board.setups[club];
  for (const b of list.querySelectorAll('.sb-setup')) {
    const on = /** @type {HTMLElement} */ (b).dataset.setup === current;
    b.setAttribute('aria-checked', String(on));
    b.dataset.asking = String(/** @type {HTMLElement} */ (b).dataset.setup === askingFor);
  }
  $('opts-ask').hidden = !askingFor;
  if (askingFor) {
    setText($('opts-ask-words'), `${SCORE_CLUB_WORDS[club]} has points. Start ${SCORE_SETUPS[askingFor].words} at 0 (the winner shows first), or keep tonight's scores?`);
  }
}

function openOpts() {
  askingFor = null;
  $('opts').hidden = false;
  $('sheet-scrim').hidden = false;
  drawOpts();
  $('sound-btn').focus();
}
function closeOpts() {
  askingFor = null;
  $('opts').hidden = true;
  if ($('sheet').hidden) $('sheet-scrim').hidden = true;
  $('opts-btn').focus();
}

/** A setup tapped: the phone asks "start at 0 or keep?" when the game has points (owner: "Ask each time"). */
function chooseSetup(id) {
  const club = board?.active;
  if (!club || board.setups[club] === id) { askingFor = null; drawOpts(); return; }
  if (anyPoints(board.scores[club], teamsFor(board, club))) { askingFor = id; drawOpts(); return; }
  sendSetup(id, false);
}

async function sendSetup(id, keep) {
  const club = board?.active;
  if (!club) return;
  buzz();
  askingFor = null;
  const res = await authed('/v1/scoreboard/setup', { method: 'POST', body: { club, setup: id, keep } });
  if (res.body?.board) take(res.body.board);
  if (!res.ok && res.status !== 401) flash(res.status === 0 ? 'Offline: the teams did not change.' : 'That did not go through. Try again.');
  else closeOpts();
}

// ── Sign in and out ──────────────────────────────────────────────────────

function showSignedOut(note = '') {
  clearTimeout(readTimer);
  cancelAnimationFrame(frame);
  $('board').hidden = true;
  $('sheet').hidden = true;
  $('sheet-scrim').hidden = true;
  $('signin').hidden = false;
  setText($('signin-note'), note);
  document.body.style.setProperty('--sb-field', CLUB_FIELDS.none);
}

function showSignedIn() {
  $('signin').hidden = true;
  $('board').hidden = false;
  setLive('wait');
  render();
  read();
  holdWake();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}

async function signIn(event) {
  event.preventDefault();
  const input = /** @type {HTMLInputElement} */ ($('passphrase'));
  if (!input.value.trim()) { setText($('signin-note'), 'Type the passphrase first.'); return; }
  if (!base) { setText($('signin-note'), 'The sync service is not set up yet, so the scoreboard cannot work.'); return; }
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

let wakeLock = null;
async function holdWake() {
  try {
    if (!wakeLock && !document.hidden && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* the phone may sleep; taps still work */ }
}

function active() {
  lastActive = Date.now();
  // A phone may let the screen lock go (a call, a notification): ask again on every touch.
  if (!$('board').hidden) holdWake();
  if (paused) { paused = false; read(); }
}

/** Let the screen sleep again (30 min with no touch: the scorekeeper put the phone away). */
function letSleep() {
  try { wakeLock?.release(); } catch { /* already gone */ }
  wakeLock = null;
}

async function start() {
  $('signin-form').addEventListener('submit', signIn);
  $('signout').addEventListener('click', () => { saveSyncSession(''); board = null; showSignedOut('Signed out on this phone.'); });
  for (const el of document.querySelectorAll('.sb-club')) el.addEventListener('click', () => pickClub(/** @type {HTMLElement} */ (el).dataset.club || ''));
  // The plates are rebuilt for each setup: one listener for them all.
  $('teams').addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.sb-plus, .sb-minus'));
    if (!btn || /** @type {HTMLButtonElement} */ (btn).disabled) return;
    point(btn.dataset.team || '', btn.classList.contains('sb-plus') ? 1 : -1);
  });
  $('opts-btn').addEventListener('click', openOpts);
  $('sound-btn').addEventListener('click', toggleSounds);
  $('opts-close').addEventListener('click', closeOpts);
  $('opts-zero').addEventListener('click', () => { if (askingFor) sendSetup(askingFor, false); });
  $('opts-keep').addEventListener('click', () => { if (askingFor) sendSetup(askingFor, true); });
  $('end-btn').addEventListener('click', endGame);
  $('clock-btn').addEventListener('click', openSheet);
  $('sheet-close').addEventListener('click', closeSheet);
  $('sheet-scrim').addEventListener('click', () => { if (!$('opts').hidden) closeOpts(); else closeSheet(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('opts').hidden) closeOpts();
    else if (!$('sheet').hidden) closeSheet();
  });
  for (const el of document.querySelectorAll('.sb-seg__btn')) {
    el.addEventListener('click', () => { sheetKind = /** @type {any} */ (el).dataset.kind; drawSheet(); });
  }
  for (const el of document.querySelectorAll('.sb-pick-btn')) {
    el.addEventListener('click', () => { timerSecs = Number(/** @type {HTMLElement} */ (el).dataset.secs); drawSheet(); });
  }
  $('step-down').addEventListener('click', () => { timerSecs = stepTimer(timerSecs, -1); drawSheet(); });
  $('step-up').addEventListener('click', () => { timerSecs = stepTimer(timerSecs, 1); drawSheet(); });
  $('clock-go').addEventListener('click', () => {
    const op = $('clock-go').dataset.op;
    if (op === 'start') clockPress(sheetKind === 'timer' ? { op: 'start', kind: 'timer', durationMs: timerSecs * 1000 } : { op: 'start', kind: 'stopwatch' });
    else clockPress({ op });
  });
  $('clock-reset').addEventListener('click', () => clockPress({ op: 'clear' }));
  window.setInterval(() => { if (!$('board').hidden) drawGameClock(); }, 1000);
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, active, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearTimeout(readTimer); return; }
    if ($('board').hidden) return;
    lastActive = Date.now();
    paused = false;
    read();
    holdWake();
  });
  window.addEventListener('online', () => { if (outbox.length) flush(); if (!$('board').hidden) read(); });
  base = await resolveSyncUrl();
  if (!base) { showSignedOut('The sync service is not set up yet, so the scoreboard cannot work.'); return; }
  if (loadSyncSession()) showSignedIn();
  else showSignedOut();
}

start();
