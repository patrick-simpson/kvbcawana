// The downstairs classroom screen (CLAUDE.md "App: classroom/"). Rules in
// logic.js; this file is the clock, the page and the lobby frame.
//
// One live connection only: the embedded lobby's (../lobby/?club=sparks).
// It leaves tonight's per-club counts in localStorage (awanaClubCounts.v1,
// numbers only) and, because this page asked with ?club=, hands each
// sanitized check-in UP to this page (lobby/src/lib/embed.js hostCheckin:
// id, first name, club, oneOff; nothing else). Names live in memory only.

const own = new URL(import.meta.url);
const L = await import(new URL(`./logic.js${own.search}`, own).href);

const params = new URLSearchParams(window.location.search);
const CONFIGURE = params.get('configure') === '1';
// ?preview=<state> draws one fixed moment (mock-ups, the layout test); ?now=<ISO> runs the clock from then.
const PREVIEW = params.get('preview') || '';
const NOW_FROM = Date.parse(params.get('now') || '');
const CLOCK_OFFSET = Number.isFinite(NOW_FROM) ? NOW_FROM - Date.now() : 0;
const now = () => new Date(Date.now() + CLOCK_OFFSET);

const LOBBY = new URL('../lobby/', window.location.href);
const SCHEDULE_URL = new URL('shared/schedule.json', LOBBY).href;
const FEED_URL = new URL('calendar-feed.json', LOBBY).href;
// The rule sits beside this script (src/shared/clubNight.js, a generated copy
// of shared/clubNight.js) and is asked for with this script's own ?v=.
const RULE_URL = new URL(`./shared/clubNight.js${own.search}`, own).href;
const NIGHT_REFRESH_MS = 6 * 60 * 60 * 1000;
const BEAR_KEY = 'awanaClassroomBear.v1';
const CHALK_KEY = 'awanaClassroomChalk.v1';
// KVBC Awana's display (printer/electron-app/src/display/pen-watch.js) fires
// this on the page when SMART Ink's toolbar comes up: a pen left the tray.
export const PEN_LIFTED_EVENT = 'awana:pen-lifted';
export const CHECKIN_MESSAGE = 'awana-display:checkin';

const root = document.documentElement;
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const frame = /** @type {HTMLIFrameElement | null} */ (document.getElementById('lobby'));
const cards = { cubbies: $('cubbies'), sparks: $('sparks') };
const welcomeEls = { cubbies: $('welcome-cubbies'), sparks: $('welcome-sparks') };
const boardEl = $('board');
const boardChip = /** @type {HTMLElement} */ (boardEl.querySelector('.cr-chip'));
const undoBtn = /** @type {HTMLButtonElement} */ (boardEl.querySelector('.cr-board-undo'));
const penBtn = /** @type {HTMLButtonElement} */ ($('pen-btn'));
const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const motionOk = () => !(motionQuery && motionQuery.matches);
root.classList.toggle('cr-motion', motionOk());
motionQuery?.addEventListener?.('change', () => root.classList.toggle('cr-motion', motionOk()));

// Each doodle its own beat in the arrival and the ambient drift.
document.querySelectorAll('.cr-d').forEach((d, i) => /** @type {HTMLElement} */ (d).style.setProperty('--i', String(i % 9)));

/* ── Is tonight a club night? The lobby's own rule and files. ────── */
const night = { rule: null, schedule: null, feed: null, ready: false };
async function loadJson(url) {
  try {
    const r = await fetch(`${url}?b=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
async function loadNight() {
  try { night.rule = night.rule || await import(RULE_URL); } catch { /* not a club night until it loads */ }
  const [schedule, feed] = await Promise.all([loadJson(SCHEDULE_URL), loadJson(FEED_URL)]);
  if (schedule) night.schedule = schedule;
  if (feed) night.feed = feed;
  night.ready = Boolean(night.rule);
  tick();
}

function church(at) {
  const zone = night.schedule && typeof night.schedule.timezone === 'string' ? night.schedule.timezone : 'America/New_York';
  if (night.rule) {
    try {
      const p = night.rule.zonedParts(at, zone);
      return { ...p, seconds: p.minutes * 60 + at.getSeconds(), clubNight: night.rule.clubNightToday(at, { schedule: night.schedule, feed: night.feed }) === true };
    } catch { /* below */ }
  }
  return { dateKey: '', minutes: NaN, seconds: NaN, clubNight: false };
}

/* ── The count chips: the kit's stepped chip, built around its text ── */
const PLATE = { cubbies: '#2F4F8A', sparks: '#B82B32' };
const CHIP_LABEL = 'CHECKED IN';
let measure = null;
function em(text) {
  try {
    measure = measure || document.createElement('canvas').getContext('2d');
    measure.font = "100px 'Paytone One'";
    const w = measure.measureText(text).width / 100;
    if (w > 0) return w;
  } catch { /* the estimate below */ }
  return [...text].reduce((s, ch) => s + (ch === ' ' ? 0.3 : 0.64), 0);
}
function chipSvg(club, value) {
  const g = L.chipGeometry(em(CHIP_LABEL), em(value));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `-0.04 -0.04 ${g.width.toFixed(3)} ${g.height.toFixed(3)}`);
  svg.setAttribute('aria-hidden', 'true');
  const path = (attrs) => { const p = document.createElementNS(ns, 'path'); for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v); svg.append(p); };
  path({ d: g.d, fill: PLATE[club], transform: 'translate(0.12 0.07)' });
  path({ d: g.d, fill: 'none', stroke: '#fff', 'stroke-width': '0.045' });
  for (const [t, at] of [[CHIP_LABEL, g.label], [value, g.value]]) {
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', String(at.x));
    text.setAttribute('y', String(at.y));
    text.setAttribute('font-size', String(at.size));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    text.setAttribute('textLength', at.width.toFixed(3));
    text.textContent = t;
    svg.append(text);
  }
  return { svg, width: g.width, height: g.height };
}
function readCounts() { try { return localStorage.getItem(L.CLUB_COUNTS_KEY); } catch { return null; } }
function drawChips(nowMs, forced) {
  for (const chip of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.cr-chip'))) {
    const club = chip.dataset.club;
    if (club !== 'cubbies' && club !== 'sparks') { chip.hidden = true; continue; }
    const n = forced != null ? forced : L.clubCountFrom(readCounts(), nowMs, club);
    chip.hidden = n == null;
    if (n == null || chip.dataset.value === `${club}:${n}`) continue;
    chip.dataset.value = `${club}:${n}`;
    const { svg, width, height } = chipSvg(club, String(n));
    chip.replaceChildren(svg);
    chip.style.width = `${width.toFixed(3)}em`;
    chip.style.height = `${height.toFixed(3)}em`;
    chip.setAttribute('aria-label', `${club === 'cubbies' ? 'Cubbies' : 'Sparks'} checked in: ${n}`);
  }
}
document.fonts?.ready?.then(() => { for (const el of document.querySelectorAll('.cr-chip')) delete /** @type {HTMLElement} */ (el).dataset.value; drawChips(now().getTime(), PREVIEW ? previewCount() : null); });
window.addEventListener('storage', (e) => { if (e.key === L.CLUB_COUNTS_KEY) drawChips(now().getTime()); });

/* ── The phase, and the hand-offs through black ────────────────── */
// Into a black gap the card animates OUT first; out of one, the next card (or
// the lobby) animates IN. Gaps come from shared/transitionGap.js via logic.js.
let phase = /** @type {string} */ ('');
let clubs = /** @type {string[]} */ ([]);
const SWAP_MS = 2400;
function setPhase(next, first) {
  if (next === phase) return;
  const was = phase;
  phase = next;
  if (L.cardClub(/** @type {any} */ (was)) && next === 'black' && motionOk() && !first) {
    const card = cards[/** @type {'cubbies' | 'sparks'} */ (was)];
    card.classList.remove('is-arriving', 'is-calm');
    card.classList.add('is-leaving');
    root.dataset.phase = was;
    setTimeout(() => { card.classList.remove('is-leaving'); if (phase === 'black') show('black'); }, SWAP_MS);
    return;
  }
  show(next, was === 'black' && !first ? 'is-entering' : 'is-arriving');
}
function show(next, how = 'is-arriving') {
  root.dataset.phase = next;
  for (const [club, el] of Object.entries(cards)) {
    const on = club === next;
    el.hidden = !on;
    el.classList.remove('is-arriving', 'is-calm', 'is-leaving', 'is-entering');
    if (on && motionOk()) {
      el.classList.add(how);
      if (how === 'is-entering') el.classList.add('is-arriving');
      setTimeout(() => { el.classList.remove('is-arriving', 'is-entering'); el.classList.add('is-calm'); }, 3200);
    }
  }
  if (frame) {
    frame.classList.remove('is-entering');
    if (next === 'lobby' && how === 'is-entering' && motionOk()) {
      frame.classList.add('is-entering');
      setTimeout(() => frame.classList.remove('is-entering'), SWAP_MS + 100);
    }
  }
  drawWelcomes();
}

/* ── Easter eggs ────────────────────────────────────────────────── */
function drawHoney(seconds, ms) {
  const honey = /** @type {HTMLElement} */ (cards.cubbies.querySelector('.cr-honey'));
  const p = L.honeyProgress(seconds + (ms % 1000) / 1000);
  if (p == null || !motionOk()) { honey.style.opacity = '0'; return; }
  // Runs slowly, a drop gathering at its tip; the last tenth it lets go.
  const run = Math.min(1, p / 0.9);
  honey.style.opacity = p > 0.97 ? String((1 - p) / 0.03) : '1';
  honey.style.setProperty('--drip', `calc(${(run * 15).toFixed(2)} * var(--u))`);
  honey.style.setProperty('--drop', (1.6 + run * 1.6).toFixed(2));
}
let bearDoneFor = '';
try { bearDoneFor = localStorage.getItem(BEAR_KEY) || ''; } catch { /* memory only */ }
function maybeBear(dateKey, minutes) {
  if (!dateKey || bearDoneFor === dateKey || phase !== 'cubbies' || board || !motionOk()) return;
  if (minutes !== L.bearMinute(dateKey) || welcomingNow().length) return;
  bearDoneFor = dateKey;
  try { localStorage.setItem(BEAR_KEY, dateKey); } catch { /* memory only */ }
  const bear = /** @type {HTMLElement} */ (cards.cubbies.querySelector('.cr-bear'));
  bear.classList.remove('is-peeking');
  void bear.offsetWidth;
  bear.classList.add('is-peeking');
  setTimeout(() => bear.classList.remove('is-peeking'), L.BEAR_MS + 200);
}

/* ── The black board (a leader lifted a pen) ─────────────────────── */
// Memory only: { from, view, at }. It lasts for the period it started in
// (logic.js boardUp); the next scheduled screen takes over.
let board = /** @type {{ from: number, view: string, at: number } | null} */ (null);
let undoTimer = 0;
let spillTimer = 0;
/** @param {string} how  @param {{ x: number, y: number }} [from]  where the ink comes from (default: the pen tray, bottom centre) */
function startBoard(how, from) {
  if (board || CONFIGURE || PREVIEW) return;
  const c = church(now());
  const p = L.boardPeriod(c.minutes, night.ready && c.clubNight);
  if (!p) return;
  board = { from: p.from, view: p.view, at: Date.now() };
  stageApi?.pauseVideo();
  clubs = L.boardClubs(p.view);
  console.info(`classroom: black board (${how}) until ${Math.floor(p.until / 60)}:${String(p.until % 60).padStart(2, '0')}`);
  clearTimeout(undoTimer);
  undoTimer = window.setTimeout(drawBoard, L.BOARD_UNDO_MS + 50);
  drawBoard();
  spill(from || { x: window.innerWidth / 2, y: window.innerHeight });
  drawChips(now().getTime());
  drawWelcomes();
}
/** The ink spill (style.css cr-spill): black floods the screen from `from`. */
function spill(from) {
  clearTimeout(spillTimer);
  boardEl.classList.remove('is-spilling', 'is-spilled');
  if (!motionOk()) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const size = Math.min(w, h) * 0.4;
  boardEl.style.setProperty('--spill-x', `${from.x}px`);
  boardEl.style.setProperty('--spill-y', `${from.y}px`);
  boardEl.style.setProperty('--spill-size', `${size}px`);
  boardEl.style.setProperty('--spill-scale', L.spillScale(from.x, from.y, w, h, size).toFixed(3));
  void boardEl.offsetWidth;
  boardEl.classList.add('is-spilling');
  spillTimer = window.setTimeout(() => {
    boardEl.classList.remove('is-spilling');
    boardEl.classList.add('is-spilled');
  }, L.SPILL_MS);
}
function endBoard() {
  board = null;
  clearTimeout(undoTimer);
  clearTimeout(spillTimer);
  boardEl.classList.remove('is-spilling', 'is-spilled');
  clearInk();
  drawBoard();
}
function drawBoard() {
  const up = Boolean(board);
  boardEl.hidden = !up;
  root.classList.toggle('cr-board-up', up);
  boardChip.dataset.club = up ? L.boardClubs(board.view)[0] : '';
  undoBtn.hidden = !(up && (PREVIEW || Date.now() - board.at < L.BOARD_UNDO_MS));
  penBtn.hidden = up || CONFIGURE || !['cubbies', 'sparks', 'lobby'].includes(phase) || Boolean(stageApi && stageApi.showing());
  if (up) sizeInk();
}
window.addEventListener(PEN_LIFTED_EVENT, () => startBoard('pen lifted'));
penBtn.addEventListener('click', () => {
  const r = penBtn.getBoundingClientRect();
  startBoard('pen button', { x: r.left + r.width / 2, y: r.top + r.height / 2 });
});
// A pen touching a card is the backup for a computer that cannot see SMART
// Ink's toolbar (the lobby frame takes no pointer events: style.css).
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'pen' && !board && e.target !== penBtn && !penBtn.contains(/** @type {Node} */ (e.target))) startBoard('pen touch', { x: e.clientX, y: e.clientY });
});
undoBtn.addEventListener('click', () => {
  if (!board) return;
  const view = board.view;
  endBoard();
  clubs = L.welcomeClubsAt(church(now()).minutes, night.ready && church(now()).clubNight);
  show(view, 'none');
  drawChips(now().getTime());
});

// Ink, only where SMART Ink is not running (it draws on a layer of its own,
// above this window, and keeps the pen from reaching the page): white lines.
const ink = /** @type {HTMLCanvasElement} */ (boardEl.querySelector('.cr-board-ink'));
const inkCtx = ink.getContext('2d');
let stroke = /** @type {{ id: number, x: number, y: number } | null} */ (null);
function sizeInk() {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(window.innerWidth * ratio);
  const h = Math.round(window.innerHeight * ratio);
  if (ink.width === w && ink.height === h) return;
  ink.width = w;
  ink.height = h;
}
function clearInk() { inkCtx?.clearRect(0, 0, ink.width, ink.height); }
function inkAt(e) { const r = ink.getBoundingClientRect(); const k = ink.width / (r.width || 1); return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; }
ink.addEventListener('pointerdown', (e) => {
  if (!inkCtx) return;
  ink.setPointerCapture?.(e.pointerId);
  stroke = { id: e.pointerId, ...inkAt(e) };
});
ink.addEventListener('pointermove', (e) => {
  if (!inkCtx || !stroke || stroke.id !== e.pointerId) return;
  const p = inkAt(e);
  inkCtx.strokeStyle = '#ffffff';
  inkCtx.lineCap = 'round';
  inkCtx.lineJoin = 'round';
  inkCtx.lineWidth = Math.max(3, ink.width / 400);
  inkCtx.beginPath();
  inkCtx.moveTo(stroke.x, stroke.y);
  inkCtx.lineTo(p.x, p.y);
  inkCtx.stroke();
  stroke = { id: e.pointerId, ...p };
});
for (const ev of ['pointerup', 'pointercancel']) ink.addEventListener(ev, () => { stroke = null; });
window.addEventListener('resize', () => { if (board) sizeInk(); });

/* The chalk Cubbie (easter egg): once a night, CHALK_AFTER_MS into a board. */
let chalkDoneFor = '';
try { chalkDoneFor = localStorage.getItem(CHALK_KEY) || ''; } catch { /* memory only */ }
function maybeChalk(dateKey) {
  if (!board || !dateKey || chalkDoneFor === dateKey || !motionOk()) return;
  if (Date.now() - board.at < L.CHALK_AFTER_MS || welcomingNow().length) return;
  chalkDoneFor = dateKey;
  try { localStorage.setItem(CHALK_KEY, dateKey); } catch { /* memory only */ }
  const chalk = /** @type {HTMLElement} */ (boardEl.querySelector('.cr-chalk'));
  chalk.classList.remove('is-drawing');
  void chalk.offsetWidth;
  chalk.classList.add('is-drawing');
  setTimeout(() => chalk.classList.remove('is-drawing'), L.CHALK_MS + 200);
}

/* ── Welcomes: one card per club, for the clubs of the moment ──── */
let welcomes = L.emptyWelcomes();
// No welcome over a video the remote put up (owner 2026-10-18); over a picture or text, yes.
const welcomingNow = () => (stageApi && stageApi.showing() === 'video' ? [] : L.welcomesUp(welcomes, clubs, now().getTime()));
function drawWelcomes() {
  const up = welcomingNow();
  for (const [club, el] of Object.entries(welcomeEls)) {
    const on = up.includes(club);
    if (!on) {
      if (!el.hidden && !el.classList.contains('is-out')) {
        if (!motionOk()) el.hidden = true;
        else {
          el.classList.remove('is-in');
          el.classList.add('is-out');
          setTimeout(() => { if (el.classList.contains('is-out')) { el.hidden = true; el.classList.remove('is-out'); } }, 600);
        }
      }
      continue;
    }
    // On its own card the welcome sits in the card's place; on the black,
    // centred, or side by side when both clubs have one.
    el.dataset.slot = board ? 'center' : L.cardClub(/** @type {any} */ (phase)) ? 'card' : up.length > 1 ? (club === 'cubbies' ? 'left' : 'right') : 'center';
    const names = /** @type {HTMLElement} */ (el.querySelector('.cr-welcome-names'));
    const words = L.welcomeWords(welcomes.cards[club].names);
    const size = words.length > 34 ? 4 : words.length > 20 ? 5 : 6.4;
    names.style.setProperty('--names-size', String(el.dataset.slot === 'left' || el.dataset.slot === 'right' ? Math.min(size, words.length > 14 ? 3.4 : 4.4) : size));
    if (names.textContent !== words) {
      const wasUp = !el.hidden && !el.classList.contains('is-out');
      names.textContent = words;
      if (wasUp && motionOk()) { names.classList.remove('is-more'); void names.offsetWidth; names.classList.add('is-more'); }
    }
    if (el.hidden || el.classList.contains('is-out')) {
      el.hidden = false;
      el.classList.remove('is-out');
      el.classList.add('is-in');
    }
  }
  root.classList.toggle('cr-welcoming', up.length > 0);
}

let audio = null;
/** A soft two-note ding, made here (no sound file). */
function ding() {
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime + 0.02;
    for (const [freq, at, gain] of [[1318.5, 0, 0.16], [1760, 0.12, 0.12]]) {
      const osc = audio.createOscillator();
      const g = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(gain, t + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 1.1);
      osc.connect(g).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 1.2);
    }
  } catch { /* no sound here */ }
}

window.addEventListener('message', (event) => {
  if (!frame || event.source !== frame.contentWindow || event.origin !== window.location.origin) return;
  const d = event.data;
  if (!d || typeof d !== 'object' || d.type !== CHECKIN_MESSAGE) return;
  if (stageApi && stageApi.showing() === 'video') return;
  const r = L.welcomeFor(welcomes, d, clubs, now().getTime());
  if (!r.ding) return;
  welcomes = r.state;
  drawWelcomes();
  ding();
});

/* ── The clock ──────────────────────────────────────────────────── */
let first = true;
function tick() {
  if (PREVIEW) return;
  const at = now();
  const c = church(at);
  const clubNight = night.ready && c.clubNight;
  // A board goes when its period does: the next screen comes straight up
  // (no card fading out from under the black).
  const boardEnded = Boolean(board) && !L.boardUp(board, c.minutes, clubNight);
  if (boardEnded) endBoard();
  // A /settings preview shows one look for its minute, whatever the clock says.
  const look = stageApi ? stageApi.previewLook() : '';
  const lookClubs = look ? (L.VIEWS.find((v) => v.view === look)?.clubs || []) : null;
  clubs = board ? L.boardClubs(board.view) : lookClubs || L.welcomeClubsAt(c.minutes, clubNight);
  setPhase(look || L.phaseAt(c.minutes, clubNight), first || boardEnded);
  first = false;
  drawBoard();
  drawWelcomes();
  drawChips(at.getTime());
  if (phase === 'cubbies' && !board) { drawHoney(c.seconds, at.getMilliseconds()); maybeBear(c.dateKey, c.minutes); }
  maybeChalk(c.dateKey);
  stageApi?.report();
}

/* ── A new build: reload when nothing is on screen for someone ──── */
const BUILD = document.querySelector('meta[name="classroom-build"]')?.getAttribute('content') || 'dev';
async function checkBuild() {
  if (BUILD === 'dev' || PREVIEW) return;
  try {
    const r = await fetch(`version.json?b=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const v = await r.json();
    if (!v || typeof v.build !== 'string' || v.build === BUILD) return;
    const page = await fetch(`${window.location.pathname}?b=${Date.now()}`, { cache: 'no-store' });
    if (!page.ok || !(await page.text()).includes(v.build)) return;
    if (welcomingNow().length || phase === 'cubbies' || phase === 'sparks' || phase === 'lobby') return; // only while black, no welcome up
    if (stageApi && (stageApi.showing() || stageApi.previewLook())) return; // nor under something the remote put up
    window.location.reload();
  } catch { /* no news */ }
}

function previewCount() { return Number(params.get('count') || (PREVIEW.includes('sparks') ? 18 : 12)); }

/* ── Preview: one fixed moment, for the mock-ups and the layout test ── */
function preview(what) {
  root.classList.add('cr-preview');
  const NAMES = { cubbies: ['Ava', 'Ben', 'Cara'], sparks: ['Micah'] };
  const club = what === 'welcome-gap' ? 'black' : what.includes('sparks') ? 'sparks' : what.includes('lobby') || what === 'black' ? (what === 'black' ? 'black' : 'lobby') : 'cubbies';
  phase = club;
  show(club, 'none');
  // ?preview=board-cubbies|board-sparks|board-lobby|board-welcome: the black board.
  if (what.startsWith('board')) {
    board = { from: 0, view: club, at: Date.now() };
    clubs = L.boardClubs(club);
  }
  drawBoard();
  for (const el of Object.values(cards)) el.classList.remove('is-calm');
  drawChips(0, previewCount());
  if (what === 'honey') {
    const honey = /** @type {HTMLElement} */ (cards.cubbies.querySelector('.cr-honey'));
    honey.style.opacity = '1';
    honey.style.setProperty('--drip', 'calc(10 * var(--u))');
    honey.style.setProperty('--drop', '2.7');
  }
  if (what === 'bear') {
    const bear = /** @type {HTMLElement} */ (cards.cubbies.querySelector('.cr-bear'));
    bear.style.translate = '0 calc(-20 * var(--u))';
    bear.style.rotate = '-3deg';
  }
  const welcomed = { 'welcome-cubbies': ['cubbies'], 'welcome-sparks': ['sparks'], 'welcome-gap': ['cubbies', 'sparks'], 'board-welcome': ['cubbies'] }[what];
  if (welcomed) {
    clubs = welcomed;
    for (const c of welcomed) welcomes.cards[c] = { names: NAMES[c], until: Number.MAX_SAFE_INTEGER };
    drawWelcomes();
  }
}

/* ── The Sparks remote (src/stage.js; worker/src/routes.md 10.13) ── */
let stageApi = /** @type {null | { previewLook: () => string, showing: () => string, pauseVideo: () => void, report: () => void }} */ (null);
async function startStage() {
  try {
    const [rules, mod] = await Promise.all([
      import(new URL(`./shared/classroomRemote.js${own.search}`, own).href),
      import(new URL(`./stage.js${own.search}`, own).href),
    ]);
    stageApi = await mod.createStage({
      rules, root, frame, motionOk,
      screen: () => ({ phase, board: Boolean(board) }),
      onChange: () => tick(),
      // Something new went up: the black board steps aside for it.
      onShow: () => { if (board) endBoard(); drawWelcomes(); },
    });
  } catch { /* the remote's half only; the schedule runs without it */ }
}

if (CONFIGURE) {
  root.dataset.phase = 'configure';
} else if (PREVIEW) {
  preview(PREVIEW);
} else {
  tick();
  startStage();
  loadNight();
  setInterval(tick, 250);
  setInterval(loadNight, NIGHT_REFRESH_MS);
  setInterval(checkBuild, 3 * 60 * 1000);
  window.addEventListener('online', () => { loadNight(); checkBuild(); });
}
