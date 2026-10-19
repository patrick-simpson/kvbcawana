/* The Sparks remote (owner 2026-10-18: "Similar to the journey remote, we
   need a sparks remote. The Sparks remote needs to be more configurable").
   awana.kvbchurch.org/classroom/remote/

   - Signs in with the church passphrase the way the Journey remote does
     (passphrase v2: the key is derived HERE with the family's one
     sync-protocol.js + cloud-crypto.js, only that is sent; the session goes in
     the shared slot awanaSyncSession.v1; the passphrase is never kept).
   - The buttons are ONE shared list (GET/PUT /v1/classroom/buttons): up to 4
     YouTube videos and 8 pictures, PDFs or text. Anyone signed in edits it
     here; a picture or PDF is uploaded in parts or copied by the Worker from
     a link (worker/src/routes.md 10.13).
   - A press is ONE request, POST /v1/classroom/remote; the classroom TV
     sweeps it on and keeps it until someone presses Back to schedule.
   - Polls GET /v1/classroom/remote/state every 1.5 s while visible (which
     also tells the TV to report what it shows). Everything the Worker returns
     is cleaned with the same rules it applies (src/shared/classroomRemote.js).
   - A long press on the Sparks mark sends Sparky across the TV (easter egg).
   - Keeps the phone awake (Screen Wake Lock) while open and visible. */

const V = new URL(import.meta.url).search; // the build stamp, carried to every module this loads
const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const SYNC_INDEX = new URL('../../lobby/shared/sync.json', location.href).href;
const REQUEST_TIMEOUT_MS = 10000;
const TUNING = { pollMs: 1500, failuresBeforeWarning: 2, holdMs: 650 };
const tuning = () => Object.assign({}, TUNING, window.sparksRemoteTuning || {});

const $ = (id) => document.getElementById(id);
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } },
};

let base = '';
let R = null; // src/shared/classroomRemote.js
let logic = null; // ./logic.js
let state = null; // the last cleaned state
let failures = 0;
let pollTimer = null;
let wakeLock = null;
let memorySession = '';
let editing = null; // { rev, rows } while the editor is open

function session() {
  const s = (store.get(SESSION_KEY) || memorySession || '').trim();
  return SESSION_RE.test(s) ? s : '';
}

function request(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined && !(opts.body instanceof Uint8Array)) headers['Content-Type'] = 'application/json';
  if (opts.body instanceof Uint8Array) headers['Content-Type'] = 'application/octet-stream';
  const s = opts.session || session();
  if (s) headers.Authorization = `Bearer ${s}`;
  return fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : (opts.body instanceof Uint8Array ? opts.body : JSON.stringify(opts.body)),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || REQUEST_TIMEOUT_MS) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

/* ── Signed out / signed in ── */

function showSignedOut(note) {
  stopPolling();
  releaseWake();
  $('remote').hidden = true;
  $('signin').hidden = false;
  setConn('off', 'Signed out');
  $('signin-note').textContent = note || '';
}

function showSignedIn() {
  $('signin').hidden = true;
  $('remote').hidden = false;
  setConn('wait', 'Connecting…');
  startPolling();
  holdWake();
}

function setConn(kind, text) {
  const el = $('conn');
  if (el.dataset.state !== kind) el.dataset.state = kind;
  setText(el, text);
}

async function signIn(event) {
  event.preventDefault();
  const input = $('passphrase');
  const typed = input.value;
  if (!typed.trim()) { $('signin-note').textContent = 'Type the passphrase first.'; return; }
  if (!base) { $('signin-note').textContent = 'The sync service is not set up yet, so the remote cannot work.'; return; }
  $('signin-btn').disabled = true;
  $('signin-note').textContent = 'Signing in… (this takes a second or two)';
  try {
    const [sp, cc] = await Promise.all([import(`../src/shared/sync-protocol.js${V}`), import(`../src/shared/cloud-crypto.js${V}`)]);
    const { res } = await sp.signInWithPassphrase({ request: (p, o) => request(p, o), derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) { $('signin-note').textContent = `That is not the passphrase.${typeof b.triesLeft === 'number' ? ` ${b.triesLeft} tries left before a 15-minute wait.` : ''}`; return; }
    if (res.status === 429) { $('signin-note').textContent = 'Too many wrong tries. Wait a little, then try again.'; return; }
    if (!res.ok || !SESSION_RE.test(b.session || '')) {
      $('signin-note').textContent = res.status === 0 ? 'Could not reach the sync service. Check this phone’s internet.' : (b.error || 'Sign-in failed.');
      return;
    }
    store.set(SESSION_KEY, b.session);
    memorySession = b.session;
    input.value = '';
    showSignedIn();
  } catch {
    $('signin-note').textContent = 'This phone could not sign in (its browser may be too old).';
  } finally {
    $('signin-btn').disabled = false;
  }
}

function signOut() {
  store.set(SESSION_KEY, null);
  memorySession = '';
  state = null;
  closeEditor();
  showSignedOut('Signed out on this phone.');
}

/* ── The state ── */

function startPolling() { stopPolling(); poll(); }
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

async function poll() {
  clearTimeout(pollTimer);
  if (!session() || document.hidden) return;
  const r = await request('/v1/classroom/remote/state');
  if (r.status === 401) { store.set(SESSION_KEY, null); memorySession = ''; showSignedOut('The passphrase was changed, or this phone was signed out. Sign in again.'); return; }
  if (r.ok && r.body) {
    failures = 0;
    state = {
      buttons: R.sanitizeButtons(r.body.buttons),
      rev: Number.isInteger(r.body.rev) ? r.body.rev : 0,
      stage: R.sanitizeStage(r.body.stage),
      now: R.sanitizeClassroomNow(r.body.now),
      screenOnline: r.body.screenOnline === true,
    };
    setConn('ok', 'Connected');
  } else {
    failures += 1;
    if (failures >= tuning().failuresBeforeWarning) setConn('bad', navigator.onLine === false ? 'Offline' : 'Not reaching it');
  }
  render();
  pollTimer = setTimeout(poll, tuning().pollMs);
}

function render() {
  if (!state) return;
  const offline = failures >= tuning().failuresBeforeWarning;
  const w = logic.nowWords({ now: state.now, stage: state.stage, screenOnline: state.screenOnline, offline });
  setText($('now-kicker'), w.kicker);
  setText($('now-main'), w.main);
  setText($('now-sub'), w.sub);
  $('now').dataset.live = String(w.live);
  const shown = state.stage.show ? state.stage.show.button : null;
  $('btn-back').hidden = !shown;
  $('video').hidden = !shown || shown.kind !== 'video';
  $('pdf').hidden = !shown || shown.kind !== 'pdf';
  const video = state.now && shown && state.now.button === shown.id ? state.now.video : null;
  setText($('btn-play'), video && video.paused ? 'Play' : 'Pause');
  setText($('btn-mute'), video && video.muted ? 'Unmute' : 'Mute');
  $('btn-mute').dataset.op = video && video.muted ? 'unmute' : 'mute';
  drawTiles($('video-tiles'), state.buttons.videos.map((v) => ({ ...v, kind: 'video' })), shown);
  drawTiles($('item-tiles'), state.buttons.items, shown);
  $('empty').hidden = state.buttons.videos.length + state.buttons.items.length > 0;
}

const KIND = { video: 'Video', image: 'Picture', pdf: 'PDF', text: 'Text' };
// The handbook's round badges: one drawn mark per kind (24 grid, stroked; fixed markup, never data).
const ICONS = {
  video: '<svg viewBox="0 0 24 24"><path d="M9 7l8 5-8 5z" fill="currentColor"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M5 17l5-5 4 4 2-2 3 3"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 15h5M10 18h3"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 18L9.5 6h1L15 18M6.8 14h6.4"/><path d="M17 11.5c1.5-1 4-.6 4 1.5V18m0-3c-2-.5-4 0-4 1.6 0 1.4 2.2 1.8 4 .2"/></svg>',
};
function drawTiles(box, list, shown) {
  const key = JSON.stringify([list.map((b) => [b.id, b.title, b.kind]), shown && shown.id]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...list.map((b) => {
    const t = document.createElement('button');
    t.type = 'button';
    t.className = 'tile';
    t.dataset.kind = b.kind;
    t.dataset.button = b.id;
    t.setAttribute('aria-pressed', String(Boolean(shown && shown.id === b.id)));
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = b.title;
    const badge = document.createElement('span');
    badge.className = 'tile-badge';
    badge.setAttribute('aria-hidden', 'true');
    badge.innerHTML = ICONS[b.kind] || '';
    const kind = document.createElement('span');
    kind.className = 'tile-kind';
    kind.textContent = KIND[b.kind] || '';
    t.append(name, badge, kind);
    return t;
  }));
  box.hidden = list.length === 0;
}

/* ── Presses ── */

async function press(action, data, label) {
  setText($('press-note'), 'Sending…');
  const r = await request('/v1/classroom/remote', { method: 'POST', body: { action, ...(data ? { data } : {}) } });
  if (r.ok) setText($('press-note'), r.body && r.body.screenOnline === false ? `${label || 'Sent'}: the classroom TV is not on, so it will show when it comes on.` : `${label || 'Sent'} ✓`);
  else if (r.status === 429) setText($('press-note'), 'Too many presses at once. Wait a moment.');
  else setText($('press-note'), (r.body && r.body.error) || 'That did not reach the service. Try again.');
  poll();
}

function onTile(e) {
  const t = e.target.closest('.tile');
  if (!t) return;
  press('show', { button: t.dataset.button }, `“${t.firstChild.textContent}” is going up`);
}

/* ── Sparky (a long press on the mark) ── */
function wireMark() {
  const mark = $('mark');
  let timer = null;
  const start = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    mark.classList.add('is-holding');
    timer = setTimeout(() => { timer = null; mark.classList.remove('is-holding'); press('sparky', null, 'Whoosh! Sparky is on his way'); }, tuning().holdMs);
  };
  const stop = () => { mark.classList.remove('is-holding'); clearTimeout(timer); timer = null; };
  mark.addEventListener('pointerdown', start);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) mark.addEventListener(ev, stop);
  mark.addEventListener('contextmenu', (e) => e.preventDefault());
}

/* ── The editor ── */

async function openEditor() {
  setText($('edit-note'), 'Loading the buttons…');
  const r = await request('/v1/classroom/buttons');
  if (!r.ok || !r.body) { setText($('edit-note'), 'Could not load the buttons. Try again.'); return; }
  editing = { rev: r.body.rev, rows: logic.rowsFromButtons(R.sanitizeButtons(r.body.buttons)) };
  $('buttons').hidden = true;
  $('editor').hidden = false;
  setText($('edit-note'), '');
  drawEditor();
}

function closeEditor() {
  editing = null;
  $('editor').hidden = true;
  $('buttons').hidden = false;
}

function drawEditor() {
  const vbox = $('edit-videos');
  vbox.replaceChildren(...editing.rows.videos.map((row, i) => videoRow(row, i)));
  const ibox = $('edit-items');
  ibox.replaceChildren(...editing.rows.items.map((row, i) => (row.kind === 'text' ? textRow(row, i) : fileRow(row, i))));
  $('add-video').hidden = editing.rows.videos.length >= R.CLASSROOM_VIDEOS_MAX;
  const full = editing.rows.items.length >= R.CLASSROOM_ITEMS_MAX;
  $('add-file').disabled = full;
  $('add-text').disabled = full;
}

const fromTemplate = (id) => /** @type {HTMLElement} */ ($(id).content.firstElementChild.cloneNode(true));
function bindInput(el, sel, row, key) {
  const input = el.querySelector(sel);
  input.value = row[key] || '';
  input.addEventListener('input', () => { row[key] = input.value; });
  return input;
}
function removable(el, list, row) {
  el.querySelector('.f-remove').addEventListener('click', () => { list.splice(list.indexOf(row), 1); drawEditor(); });
}

function videoRow(row, i) {
  const el = fromTemplate('video-row');
  el.dataset.at = `video-${i}`;
  bindInput(el, '.f-title', row, 'title');
  bindInput(el, '.f-link', row, 'link');
  removable(el, editing.rows.videos, row);
  return el;
}

function textRow(row, i) {
  const el = fromTemplate('text-row');
  el.dataset.at = `item-${i}`;
  bindInput(el, '.f-title', row, 'title');
  bindInput(el, '.f-heading', row, 'heading');
  bindInput(el, '.f-text', row, 'text');
  for (const r of el.querySelectorAll('.f-look input')) {
    r.name = `look-${row.id}`;
    r.checked = (row.look || 'page') === r.value;
    r.addEventListener('change', () => { if (r.checked) row.look = r.value; });
  }
  removable(el, editing.rows.items, row);
  return el;
}

function fileRow(row, i) {
  const el = fromTemplate('file-row');
  el.dataset.at = `item-${i}`;
  bindInput(el, '.f-title', row, 'title');
  const link = el.querySelector('.f-link');
  const fileWords = () => setText(el.querySelector('.f-file'), row.file ? `${row.fileKind === 'pdf' ? 'PDF' : 'Picture'} ready${row.name ? `: ${row.name}` : ''} ✓` : 'No picture or PDF yet.');
  fileWords();
  const progress = el.querySelector('.f-progress');
  const done = (b, name) => {
    row.file = b.id; row.type = b.type; row.fileKind = b.kind; row.name = name || b.name || '';
    if (!row.title) { row.title = (row.name || '').replace(/\.[a-z0-9]+$/i, '').slice(0, 60); el.querySelector('.f-title').value = row.title; }
    fileWords();
  };
  el.querySelector('.f-input').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const b = await upload(file, (words) => setText(progress, words));
    if (b) { done(b, file.name); setText(progress, ''); }
  });
  el.querySelector('.f-copy').addEventListener('click', async () => {
    const url = link.value.trim();
    if (!url) { setText(progress, 'Paste a link first.'); return; }
    setText(progress, 'Copying it from that link…');
    const r = await request('/v1/classroom/files', { method: 'POST', body: { url, name: '' }, timeoutMs: 40000 });
    if (r.ok && r.body) { done(r.body, r.body.name); setText(progress, `Copied (${logic.size(r.body.bytes)}).`); link.value = ''; }
    else setText(progress, (r.body && r.body.error) || 'That link could not be copied. Try again, or upload the file.');
  });
  removable(el, editing.rows.items, row);
  return el;
}

/** Sends a file in parts; answers the finished file, or null (words said). */
async function upload(file, say) {
  const type = file.type;
  if (!R.CLASSROOM_FILE_TYPES.includes(type)) { say('Only a picture (JPEG, PNG, GIF, WebP) or a PDF can go on the screen.'); return null; }
  if (file.size > R.CLASSROOM_FILE_MAX_BYTES) { say(`That file is ${logic.size(file.size)}; 20 MB at most.`); return null; }
  say(`Sending ${logic.size(file.size)}…`);
  const start = await request('/v1/classroom/files', { method: 'POST', body: { type, bytes: file.size, name: file.name } });
  if (!start.ok || !start.body) { say((start.body && start.body.error) || 'Could not start the upload.'); return null; }
  const { id, parts, partBytes } = start.body;
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (let n = 0; n < parts; n += 1) {
    let r = null;
    for (let tries = 0; tries < 3; tries += 1) {
      r = await request(`/v1/classroom/files/${id}/${n}`, { method: 'PUT', body: bytes.subarray(n * partBytes, (n + 1) * partBytes), timeoutMs: 30000 });
      if (r.ok) break;
    }
    if (!r || !r.ok) { say('The upload stopped (the internet?). Try again.'); return null; }
    say(`Sending… ${Math.round(((n + 1) / parts) * 100)}%`);
  }
  const fin = await request(`/v1/classroom/files/${id}/done`, { method: 'POST', body: {} });
  if (!fin.ok || !fin.body) { say((fin.body && fin.body.error) || 'The upload did not finish. Try again.'); return null; }
  return fin.body;
}

function addRow(kind) {
  if (!editing) return;
  if (kind === 'video') editing.rows.videos.push({ id: logic.newButtonId(), title: '', link: '' });
  else if (kind === 'text') editing.rows.items.push({ id: logic.newButtonId(), kind: 'text', title: '', heading: '', text: '', look: 'page' });
  else editing.rows.items.push({ id: logic.newButtonId(), kind: 'file', title: '' });
  drawEditor();
}

async function saveEditor() {
  if (!editing) return;
  for (const el of document.querySelectorAll('.edit-row.is-bad')) el.classList.remove('is-bad');
  const out = logic.buttonsFromRows(editing.rows, R);
  if (!out.ok) {
    setText($('edit-note'), out.error);
    const bad = out.at && document.querySelector(`.edit-row[data-at="${out.at}"]`);
    if (bad) { bad.classList.add('is-bad'); bad.scrollIntoView({ block: 'center' }); }
    return;
  }
  $('edit-save').disabled = true;
  setText($('edit-note'), 'Saving…');
  const r = await request('/v1/classroom/buttons', { method: 'PUT', body: { baseRev: editing.rev, buttons: out.buttons } });
  $('edit-save').disabled = false;
  if (r.status === 409 && r.body && r.body.reason === 'stale') {
    editing = { rev: r.body.rev, rows: logic.rowsFromButtons(R.sanitizeButtons(r.body.buttons)) };
    drawEditor();
    setText($('edit-note'), 'Someone else changed the buttons just now. Here is their list; make your change again.');
    return;
  }
  if (!r.ok) { setText($('edit-note'), (r.body && r.body.error) || 'Could not save. Try again.'); return; }
  closeEditor();
  setText($('press-note'), 'Buttons saved for every leader ✓');
  poll();
}

/* ── Wake lock ── */
async function holdWake() {
  try { if ('wakeLock' in navigator && !wakeLock && !document.hidden) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch { wakeLock = null; }
}
function releaseWake() { if (wakeLock) wakeLock.release().catch(() => {}); wakeLock = null; }

/* ── Start ── */
async function start() {
  [R, logic] = await Promise.all([import(`../src/shared/classroomRemote.js${V}`), import(`./logic.js${V}`)]);
  $('signin-form').addEventListener('submit', signIn);
  $('signout').addEventListener('click', signOut);
  $('video-tiles').addEventListener('click', onTile);
  $('item-tiles').addEventListener('click', onTile);
  $('btn-back').addEventListener('click', () => press('back', null, 'Back to the schedule'));
  $('video').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const data = { op: b.dataset.op };
    if (b.dataset.by) data.by = Number(b.dataset.by);
    if (b.dataset.step) data.step = Number(b.dataset.step);
    press('video', data, b.textContent.trim());
  });
  $('pdf').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) press('page', { step: Number(b.dataset.step) }, Number(b.dataset.step) > 0 ? 'Next page' : 'Page back');
  });
  $('btn-edit').addEventListener('click', openEditor);
  $('add-video').addEventListener('click', () => addRow('video'));
  $('add-file').addEventListener('click', () => addRow('file'));
  $('add-text').addEventListener('click', () => addRow('text'));
  $('edit-cancel').addEventListener('click', closeEditor);
  $('edit-save').addEventListener('click', saveEditor);
  wireMark();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPolling(); return; }
    if (session()) { startPolling(); holdWake(); }
  });
  window.addEventListener('online', () => { if (session()) startPolling(); });
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== null) return;
    if (session()) showSignedIn(); else showSignedOut('Signed out on this phone.');
  });
  try {
    if (typeof window.sparksRemoteBase === 'string') base = window.sparksRemoteBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service named: the sign-in says so */ }
  if (session() && base) showSignedIn();
  else showSignedOut(base ? '' : 'The sync service is not reachable right now. Reload in a minute.');
}

start();
