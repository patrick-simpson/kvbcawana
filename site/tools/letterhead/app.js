// The letterhead maker (owner 2026-10-28; awana.kvbchurch.org/tools/letterhead/,
// unlisted): type or paste a letter, see it on the Awana letterhead, print it
// or save it as a PDF from the browser's print dialog. The drawing is
// shared/letterhead.js (copied beside this file by site/build.mjs), the same
// one the print job (scripts/letterhead/) emails to the downstairs Epson.
// Signed in with the church passphrase like the remotes (passphrase v2: the
// word never leaves this browser); the draft stays on this device only.
//
// The "Print to downstairs" tab (owner 2026-11-04: "a page where I can upload a
// PDF and it will send whatever quantity I specify ... a button that prints
// handbook sheets"): the PDF is scrambled HERE (AES-256-GCM, a fresh key) and
// uploaded to the sync Worker in pieces; "Send" asks the Worker to start the print
// job with the upload's id and the key (worker/src/prints.js, routes.md 10.16).
// Copies go as pages of ONE PDF (the job's repeatPdf), so it all prints at once.

import { parseLetter, letterHtml, LETTERHEAD_SVGS } from './shared/letterhead.js';

const KIT = new URL('/lobby/shared/brand', location.href).href;
const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const DRAFT_KEY = 'awanaLetterheadDraft.v1';
const TIMEOUT_MS = 10000;

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } },
};

let base = '';
let memorySession = '';
/** @type {Record<string, string>|null} */
let svgs = null;
let drawTimer = 0;

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
    signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

function showSignedOut(note) {
  $('maker').hidden = true;
  $('printer').hidden = true;
  $('tabs').hidden = true;
  $('who').hidden = true;
  $('signin').hidden = false;
  $('signin-note').textContent = note || '';
  $('passphrase').focus();
}

function showSignedIn() {
  $('signin').hidden = true;
  $('tabs').hidden = false;
  $('who').hidden = false;
  showTab(location.hash === '#print' ? 'print' : 'letter');
  draw();
}

// ── the "Print to downstairs" tab ─────────────────────────────────────────────

const PDF_MAX = 15 * 1024 * 1024;
const COPIES_MAX = 100;
const PAGES_MAX = 200;
let chosen = /** @type {{name: string, bytes: Uint8Array, pages: number|null}|null} */ (null);
let sending = false;
let hbArmed = 0;

/** @param {'letter'|'print'} tab */
function showTab(tab) {
  $('maker').hidden = tab !== 'letter';
  $('printer').hidden = tab !== 'print';
  $('tab-letter').setAttribute('aria-selected', String(tab === 'letter'));
  $('tab-print').setAttribute('aria-selected', String(tab === 'print'));
  if (tab === 'print') { history.replaceState(null, '', '#print'); checkReady(); }
  else history.replaceState(null, '', location.pathname);
}

async function checkReady() {
  const r = await request('/v1/prints');
  if (r.status === 401) { store.set(SESSION_KEY, null); showSignedOut('The passphrase changed. Sign in again.'); return; }
  $('print-setup').hidden = !(r.ok && r.body && r.body.ready === false);
}

/** Pages in a PDF, roughly (page objects, not the page tree); null when unsure. @param {Uint8Array} bytes */
function countPages(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const n = (text.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  return n > 0 ? n : null;
}

function copiesNow() {
  const n = Number($('copies').value);
  return Number.isInteger(n) && n >= 1 && n <= COPIES_MAX ? n : null;
}

function setStatus(id, words, kind = '') {
  const el = $(id);
  el.textContent = words;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

function refreshSend() {
  const copies = copiesNow();
  let total = '';
  let ok = Boolean(chosen && copies && !sending);
  if (chosen && copies && chosen.pages) {
    const pages = chosen.pages * copies;
    total = `${copies} ${copies === 1 ? 'copy' : 'copies'} of ${chosen.pages} ${chosen.pages === 1 ? 'page' : 'pages'} = ${pages} ${pages === 1 ? 'page' : 'pages'}`;
    if (pages > PAGES_MAX) { total = `${pages} pages is too many: at most ${PAGES_MAX} go in one send.`; ok = false; }
  } else if (!copies) total = `Copies: 1 to ${COPIES_MAX}.`;
  $('total').textContent = total;
  $('send').disabled = !ok;
}

/** @param {File|undefined|null} file */
async function choose(file) {
  setStatus('send-status', '');
  if (!file) return;
  if (file.size > PDF_MAX) { setStatus('send-status', 'That file is over 15 MB. Make it smaller first.', 'bad'); return; }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== '%PDF-') { setStatus('send-status', 'That is not a PDF.', 'bad'); return; }
  chosen = { name: file.name, bytes, pages: countPages(bytes) };
  $('file-name').textContent = `${file.name}${chosen.pages ? ` · ${chosen.pages} ${chosen.pages === 1 ? 'page' : 'pages'}` : ''}`;
  $('file').classList.add('on');
  $('drop').hidden = true;
  refreshSend();
}

function clearFile() {
  chosen = null;
  $('pdf').value = '';
  $('file').classList.remove('on');
  $('drop').hidden = false;
  $('progress').hidden = true;
  refreshSend();
}

/** base64 of bytes, in pieces (a 15 MB file is too big for one String.fromCharCode). @param {Uint8Array} bytes */
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}

/** @param {Uint8Array} bytes */
const toB64Url = (bytes) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** @param {string} path @param {string} text */
function putText(path, text) {
  const s = session();
  return fetch(base + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain', ...(s ? { Authorization: `Bearer ${s}` } : {}) },
    body: text,
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
  }).then((res) => res.ok ? { ok: true, status: res.status } : { ok: false, status: res.status }, () => ({ ok: false, status: 0 }));
}

/** The Worker's words for a refusal. @param {{status: number, body: any}} r @param {string} fallback */
function whyNot(r, fallback) {
  if (r.status === 0) return 'Could not reach the sync service. Check the internet and try again.';
  if (r.status === 503) return 'Printing from this page is not set up yet.';
  return (r.body && r.body.error) || fallback;
}

async function sendPdf() {
  const copies = copiesNow();
  if (!chosen || !copies || sending) return;
  sending = true;
  refreshSend();
  const progress = /** @type {HTMLProgressElement} */ ($('progress'));
  progress.hidden = false;
  progress.value = 0;
  try {
    setStatus('send-status', 'Scrambling the PDF on this device…');
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, chosen.bytes));
    const all = new Uint8Array(12 + ct.length);
    all.set(iv, 0);
    all.set(ct, 12);
    const b64 = toBase64(all);
    const start = await request('/v1/prints/pdf', { method: 'POST', body: { chars: b64.length, name: chosen.name, copies } });
    if (start.status === 401) { store.set(SESSION_KEY, null); showSignedOut('The passphrase changed. Sign in again.'); return; }
    if (!start.ok) { setStatus('send-status', whyNot(start, 'Could not start the upload.'), 'bad'); return; }
    const { id, parts, partChars } = start.body;
    for (let n = 0; n < parts; n += 1) {
      setStatus('send-status', `Uploading… ${Math.round((n / parts) * 100)}%`);
      let r = await putText(`/v1/prints/pdf/${id}/${n}`, b64.slice(n * partChars, (n + 1) * partChars));
      if (!r.ok && r.status === 0) r = await putText(`/v1/prints/pdf/${id}/${n}`, b64.slice(n * partChars, (n + 1) * partChars));
      if (!r.ok) { setStatus('send-status', 'The upload stopped part way. Try again.', 'bad'); return; }
      progress.value = (n + 1) / parts;
    }
    setStatus('send-status', 'Starting the print…');
    const sent = await request(`/v1/prints/pdf/${id}/send`, { method: 'POST', body: { key: toB64Url(raw) }, timeoutMs: 20000 });
    if (!sent.ok) { setStatus('send-status', whyNot(sent, 'The print did not start. Try again.'), 'bad'); return; }
    setStatus('send-status', `Sent: ${copies} ${copies === 1 ? 'copy' : 'copies'} of ${chosen.name}. It reaches the printer in 2 to 5 minutes.`, 'good');
    clearFile();
  } finally {
    sending = false;
    refreshSend();
  }
}

async function printHandbook() {
  const btn = $('handbook');
  if (!hbArmed) {
    btn.textContent = 'Tap again to print';
    btn.classList.add('armed');
    hbArmed = window.setTimeout(disarmHandbook, 4000);
    return;
  }
  disarmHandbook();
  btn.disabled = true;
  setStatus('hb-status', 'Starting…');
  const r = await request('/v1/prints/handbook', { method: 'POST', body: {}, timeoutMs: 20000 });
  btn.disabled = false;
  if (r.status === 401) { store.set(SESSION_KEY, null); showSignedOut('The passphrase changed. Sign in again.'); return; }
  if (!r.ok) { setStatus('hb-status', whyNot(r, 'The print did not start. Try again.'), 'bad'); return; }
  setStatus('hb-status', 'Started. The sheets reach the printer in about 5 minutes (nothing prints on a day with no club).', 'good');
}

function disarmHandbook() {
  clearTimeout(hbArmed);
  hbArmed = 0;
  $('handbook').textContent = 'Print handbook sheets';
  $('handbook').classList.remove('armed');
}

function wirePrinter() {
  $('tab-letter').addEventListener('click', () => showTab('letter'));
  $('tab-print').addEventListener('click', () => showTab('print'));
  $('pdf').addEventListener('change', () => choose(/** @type {HTMLInputElement} */ ($('pdf')).files?.[0]));
  $('file-clear').addEventListener('click', clearFile);
  $('copies').addEventListener('input', refreshSend);
  $('send').addEventListener('click', sendPdf);
  $('handbook').addEventListener('click', printHandbook);
  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); choose(e.dataTransfer?.files?.[0]); });
  refreshSend();
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

function signOut() {
  store.set(SESSION_KEY, null);
  memorySession = '';
  showSignedOut('Signed out on this device.');
}

async function loadSvgs() {
  if (svgs) return svgs;
  const entries = await Promise.all(Object.entries(LETTERHEAD_SVGS).map(async ([k, rel]) => {
    const res = await fetch(`${KIT}/${rel}`);
    if (!res.ok) throw new Error(`kit ${rel} ${res.status}`);
    return [k, await res.text()];
  }));
  svgs = Object.fromEntries(entries);
  return svgs;
}

/** Scale the 8.5 x 11 in frame to the sheet's width. */
function fitPreview() {
  const sheet = $('sheet');
  $('preview').style.transform = `scale(${sheet.clientWidth / 816})`;
}

function setFit(fit, size) {
  const el = $('fit');
  el.dataset.fit = fit || '';
  if (!fit) el.textContent = '';
  else if (fit === 'one-page') el.textContent = Number(size) < 11 ? `Fits on one page (type shrunk to ${size} pt).` : 'Fits on one page.';
  else el.textContent = `Too long for one page even at ${size} pt: it runs onto page 2. Trim a little to keep it to one sheet.`;
}

async function draw() {
  const text = $('text').value;
  store.set(DRAFT_KEY, text || null);
  const letter = parseLetter(text);
  $('print').disabled = !letter.title;
  if (!letter.title) { $('preview').srcdoc = ''; setFit(''); return; }
  let kit;
  try { kit = await loadSvgs(); } catch { $('fit').textContent = 'Could not load the brand kit. Reload the page.'; return; }
  const frame = $('preview');
  frame.srcdoc = letterHtml(letter, { kitUrl: KIT, svgs: /** @type {any} */ (kit) });
  setFit('');
  frame.onload = () => {
    const root = frame.contentDocument && frame.contentDocument.documentElement;
    if (!root) return;
    const done = () => setFit(root.dataset.fit, root.dataset.size);
    if (root.dataset.fit) { done(); return; }
    new MutationObserver((_, obs) => { if (root.dataset.fit) { obs.disconnect(); done(); } })
      .observe(root, { attributes: true, attributeFilter: ['data-fit'] });
  };
}

function printLetter() {
  const w = $('preview').contentWindow;
  if (!w) return;
  w.focus();
  w.print();
}

async function start() {
  wirePrinter();
  $('signin').addEventListener('submit', signIn);
  $('signout').addEventListener('click', signOut);
  $('print').addEventListener('click', printLetter);
  $('text').value = store.get(DRAFT_KEY) || '';
  $('text').addEventListener('input', () => { clearTimeout(drawTimer); drawTimer = setTimeout(draw, 350); });
  addEventListener('resize', fitPreview);
  new ResizeObserver(fitPreview).observe($('sheet'));
  addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== null) return;
    if (!session()) showSignedOut('Signed out on this device.');
  });
  try {
    if (typeof window.letterheadSyncBase === 'string') base = window.letterheadSyncBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service named: the sign-in says so */ }
  if (!session()) { showSignedOut(base ? '' : 'The sync service is not reachable right now. Reload in a minute.'); return; }
  // A saved session: is it still good? (A changed passphrase signs everyone out.)
  const check = await request('/v1/journey');
  if (check.status === 401) { store.set(SESSION_KEY, null); showSignedOut('The passphrase changed. Sign in again.'); return; }
  showSignedIn();
}

start();
