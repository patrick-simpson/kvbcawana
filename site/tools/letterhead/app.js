// The letterhead maker (owner 2026-10-28; awana.kvbchurch.org/tools/letterhead/,
// unlisted): type or paste a letter, see it on the Awana letterhead, print it
// or save it as a PDF from the browser's print dialog. The drawing is
// shared/letterhead.js (copied beside this file by site/build.mjs), the same
// one the print job (scripts/letterhead/) emails to the downstairs Epson.
// Signed in with the church passphrase like the remotes (passphrase v2: the
// word never leaves this browser); the draft stays on this device only.

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
  $('who').hidden = true;
  $('signin').hidden = false;
  $('signin-note').textContent = note || '';
  $('passphrase').focus();
}

function showSignedIn() {
  $('signin').hidden = true;
  $('maker').hidden = false;
  $('who').hidden = false;
  draw();
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
