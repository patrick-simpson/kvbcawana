// The poster contest vote tally (owner 2026-11-04; awana.kvbchurch.org/tools/tally/,
// unlisted, noindex): count paper ballots by tapping, two divisions, posters 1-3
// each, by number only. The counts are SHARED (owner: "access it from any
// device"): they live in the sync Worker (GET/POST /v1/tally, worker/src/routes.md
// 10.15), so every signed-in phone or laptop adds into the same totals.
// Signed in with the church passphrase like the letterhead tool (passphrase v2:
// the word never leaves this browser). Undo takes back THIS device's last taps.
// The page reads the totals every READ_MS while it is visible (and after each
// tap); nothing at all while hidden.

const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const TIMEOUT_MS = 10000;
const READ_MS = 4000;
/** Nobody has touched this page for this long: stop reading until the next touch (the free plan's daily requests). */
const IDLE_STOP_MS = 15 * 60 * 1000;
const MAX_UNDO = 50;
const RESET_WINDOW_MS = 4000;
const DIV = { o: 'older', y: 'younger' };
const KEYS = { 1: ['o', 0], 2: ['o', 1], 3: ['o', 2], q: ['y', 0], w: ['y', 1], e: ['y', 2] };

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } },
};

let base = '';
let memorySession = '';
let counts = { o: [0, 0, 0], y: [0, 0, 0] };
let rev = -1;
/** This device's taps, newest last: {d, i, s}. */
const history = [];
let pending = 0;
let readTimer = 0;
let armed = false;
let resetTimer = 0;
let lastActive = Date.now();
let paused = false;

const cards = { o: [], y: [] };
document.querySelectorAll('.poster').forEach((el) => { cards[el.dataset.div][Number(el.dataset.i)] = el; });

const session = () => {
  const s = (store.get(SESSION_KEY) || memorySession || '').trim();
  return SESSION_RE.test(s) ? s : '';
};

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
    signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

function status(words) { $('saved-label').textContent = words; }

/** Take the Worker's totals (a newer rev wins; none while a tap of ours is in flight). @param {any} body */
function take(body, force) {
  if (!body || !body.counts || !Number.isInteger(body.rev)) return;
  if (!force && (pending > 0 || body.rev < rev)) return;
  const ok = (a) => Array.isArray(a) && a.length === 3 && a.every((n) => Number.isInteger(n) && n >= 0);
  if (!ok(body.counts.older) || !ok(body.counts.younger)) return;
  counts = { o: body.counts.older.slice(), y: body.counts.younger.slice() };
  rev = body.rev;
  render();
}

function render() {
  const totals = {};
  for (const d of ['o', 'y']) {
    const arr = counts[d];
    const total = arr[0] + arr[1] + arr[2];
    const top = Math.max(...arr);
    const leaders = arr.filter((c) => c === top).length;
    totals[d] = total;
    $(`total-${d}`).textContent = `${total} ${total === 1 ? 'vote' : 'votes'}`;
    arr.forEach((c, i) => {
      const card = cards[d][i];
      const lead = top > 0 && c === top;
      card.querySelector('.count').textContent = c;
      card.querySelector('.pct').textContent = `${total ? Math.round((c * 100) / total) : 0}%`;
      card.querySelector('.bar span').style.width = `${total ? (c * 100) / total : 0}%`;
      const pill = card.querySelector('.pill');
      pill.hidden = !lead;
      pill.textContent = leaders > 1 ? 'Tied' : 'Leading';
      card.classList.toggle('leading', lead);
      card.querySelector('.minus').disabled = c === 0;
    });
  }
  $('ballots').textContent = Math.max(totals.o, totals.y);
  $('undo').disabled = history.length === 0;
}

function bump(el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }

/** One tap: shown at once, then sent; the Worker's answer is the truth. */
async function change(d, i, s, fromUndo = false) {
  if (s < 0 && counts[d][i] === 0) return;
  counts[d][i] += s;
  if (!fromUndo) { history.push({ d, i, s }); if (history.length > MAX_UNDO) history.shift(); }
  render();
  if (s > 0) bump(cards[d][i].querySelector('.count'));
  pending += 1;
  const res = await request('/v1/tally', { method: 'POST', body: { division: DIV[d], poster: i + 1, delta: s } });
  pending -= 1;
  if (res.status === 401) { signedOut('The passphrase changed. Sign in again.'); return; }
  if (!res.ok) {
    // Not counted: put the number back and say so.
    counts[d][i] -= s;
    if (!fromUndo) history.pop();
    render();
    status(res.status === 0 ? 'Not counted: no internet. Tap again.' : 'Not counted. Tap again.');
    return;
  }
  status('Live · counts shared on every device');
  if (pending === 0) take(res.body, true);
}

function undo() {
  const e = history.pop();
  if (!e) return;
  change(e.d, e.i, -e.s, true);
}

function disarm() {
  clearTimeout(resetTimer);
  armed = false;
  $('reset').textContent = 'Reset all';
  $('reset').classList.remove('armed');
}

async function onReset() {
  if (!armed) {
    armed = true;
    $('reset').textContent = 'Tap again to reset';
    $('reset').classList.add('armed');
    resetTimer = setTimeout(disarm, RESET_WINDOW_MS);
    return;
  }
  disarm();
  const res = await request('/v1/tally/reset', { method: 'POST', body: {} });
  if (res.status === 401) { signedOut('The passphrase changed. Sign in again.'); return; }
  if (!res.ok) { status('Could not reset. Try again.'); return; }
  history.length = 0;
  take(res.body, true);
}

async function read() {
  clearTimeout(readTimer);
  if (!session() || document.hidden) return;
  const res = await request('/v1/tally');
  if (res.status === 401) { signedOut('The passphrase changed. Sign in again.'); return; }
  if (res.ok) { status('Live · counts shared on every device'); take(res.body, false); }
  else status(res.status === 0 ? 'Offline: showing the last totals' : 'Reconnecting…');
  if (Date.now() - lastActive > IDLE_STOP_MS) { paused = true; status('Paused · tap anywhere to update'); return; }
  readTimer = setTimeout(read, READ_MS);
}

/** Any touch or key: this device is in use again. */
function active() {
  lastActive = Date.now();
  if (paused) { paused = false; read(); }
}

function showSignedIn() {
  $('signin').hidden = true;
  $('tally').hidden = false;
  render();
  read();
}

function signedOut(note) {
  clearTimeout(readTimer);
  store.set(SESSION_KEY, null);
  memorySession = '';
  $('tally').hidden = true;
  $('signin').hidden = false;
  $('signin-note').textContent = note || '';
  $('passphrase').focus();
}

async function signIn(event) {
  event.preventDefault();
  const input = $('passphrase');
  const typed = input.value;
  if (!typed.trim()) { $('signin-note').textContent = 'Type the passphrase first.'; return; }
  if (!base) { $('signin-note').textContent = 'The sync service is not reachable right now. Reload in a minute.'; return; }
  $('signin-btn').disabled = true;
  $('signin-note').textContent = 'Signing in… (this takes a second or two)';
  try {
    const [sp, cc] = await Promise.all([import('./shared/sync-protocol.js'), import('./shared/cloud-crypto.js')]);
    const { res } = await sp.signInWithPassphrase({ request: (p, o) => request(p, o), derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) { $('signin-note').textContent = `That is not the passphrase.${typeof b.triesLeft === 'number' ? ` ${b.triesLeft} tries left before a 15-minute wait.` : ''}`; return; }
    if (res.status === 429) { $('signin-note').textContent = 'Too many wrong tries. Wait a little, then try again.'; return; }
    if (!res.ok || !SESSION_RE.test(b.session || '')) {
      $('signin-note').textContent = res.status === 0 ? 'Could not reach the sync service. Check the internet.' : (b.error || 'Sign-in failed.');
      return;
    }
    store.set(SESSION_KEY, b.session);
    memorySession = b.session;
    input.value = '';
    showSignedIn();
  } catch {
    $('signin-note').textContent = 'This browser could not sign in (it may be too old).';
  } finally {
    $('signin-btn').disabled = false;
  }
}

async function start() {
  $('signin').addEventListener('submit', signIn);
  $('signout').addEventListener('click', () => signedOut('Signed out on this device.'));
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || $('tally').hidden) return;
    const card = btn.closest('.poster');
    if (card) {
      const d = card.dataset.div;
      const i = Number(card.dataset.i);
      if (btn.classList.contains('plus')) change(d, i, 1);
      else if (btn.classList.contains('minus')) change(d, i, -1);
      return;
    }
    if (btn.id === 'undo') undo();
    else if (btn.id === 'reset') onReset();
  });
  document.addEventListener('keydown', (e) => {
    if ($('tally').hidden || e.repeat || e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLInputElement) return;
    const m = KEYS[String(e.key).toLowerCase()];
    if (m) change(m[0], m[1], 1);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { lastActive = Date.now(); paused = false; read(); } });
  document.addEventListener('pointerdown', active, true);
  document.addEventListener('keydown', active, true);
  addEventListener('storage', (e) => { if ((e.key === SESSION_KEY || e.key === null) && !session()) signedOut('Signed out on this device.'); });
  try {
    if (typeof window.tallySyncBase === 'string') base = window.tallySyncBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service named: the sign-in says so */ }
  if (!session()) { signedOut(base ? '' : 'The sync service is not reachable right now. Reload in a minute.'); return; }
  showSignedIn();
}

start();
