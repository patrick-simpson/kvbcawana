// Hand out shares (owner 2026-11-23; awana.kvbchurch.org/tools/shares/,
// unlisted, owner only): tonight's checked-in children by club; tick some,
// pick how many shares, Give. Each child is one request to the Worker
// (worker/src/givershares.js, routes.md 10.23), which gives them through
// TwoTimTwo's Special Share Awards form and never twice for one Give.
//
// Sign-in: the church passphrase AND the owner's code (the club email page's),
// the code kept in memory only; or the owner's kept email sign-in on this
// device (awanaMailToken.v1, made by the email page's "Stay signed in").

import { batchKey, byClub, confirmWords, defaultWhy, resultWords } from './logic.js';

const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const TOKEN_KEY = 'awanaMailToken.v1';
const TIMEOUT_MS = 60000;
const TRIES = 3;

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let base = '';
let ownerCode = '';
let ownerSession = '';
let night = { backwards: false, kids: [] };
const picked = new Set();
let amount = 1;
let giving = false;

function request(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (ownerCode && ownerSession) { headers.Authorization = `Bearer ${ownerSession}`; headers['X-Mail-Owner'] = ownerCode; }
  else if (store.get(TOKEN_KEY)) headers['X-Mail-Token'] = store.get(TOKEN_KEY).trim();
  return fetch(base + path, {
    method: opts.method || 'GET', headers, cache: 'no-store',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout ? AbortSignal.timeout(TIMEOUT_MS) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

function showSignIn(note = '') {
  $('signin').hidden = false;
  $('app').hidden = true;
  $('note').textContent = note;
}

async function signIn(event) {
  event.preventDefault();
  const typed = $('passphrase').value, code = $('owner-code').value.trim();
  if (!typed.trim() || !code) { $('note').textContent = 'Type the passphrase and the owner\'s code.'; return; }
  if (!base) { $('note').textContent = 'The service is not reachable right now. Reload in a minute.'; return; }
  $('signin-btn').disabled = true;
  $('note').textContent = 'Signing in… (a second or two)';
  try {
    const plain = (p, o = {}) => fetch(base + p, { method: o.method || 'GET', headers: o.body === undefined ? {} : { 'Content-Type': 'application/json' }, body: o.body === undefined ? undefined : JSON.stringify(o.body), cache: 'no-store' })
      .then((r) => r.json().then((b) => ({ ok: r.ok, status: r.status, body: b }), () => ({ ok: r.ok, status: r.status, body: null })), () => ({ ok: false, status: 0, body: null }));
    const [sp, cc] = await Promise.all([import('./shared/sync-protocol.js'), import('./shared/cloud-crypto.js')]);
    const { res } = await sp.signInWithPassphrase({ request: plain, derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) { $('note').textContent = 'That is not the passphrase.'; return; }
    if (!res.ok || !SESSION_RE.test(b.session || '')) { $('note').textContent = res.status === 0 ? 'Could not reach the service. Check the internet.' : (b.error || 'Sign-in failed.'); return; }
    ownerSession = b.session; ownerCode = code;
    $('passphrase').value = ''; $('owner-code').value = '';
    await load();
  } catch {
    $('note').textContent = 'This browser could not sign in (it may be too old).';
  } finally {
    $('signin-btn').disabled = false;
  }
}

async function load() {
  $('list-note').textContent = 'Reading tonight\'s check-ins…';
  const res = await request('/v1/shares/tonight');
  if (res.status === 403 || res.status === 401) {
    ownerSession = ''; ownerCode = '';
    showSignIn(res.status === 403 && ($('owner-code').value || ownerCode) ? 'That is not the owner\'s code.' : '');
    return;
  }
  $('signin').hidden = true;
  $('app').hidden = false;
  if (!res.ok || !res.body) { $('list-note').textContent = 'Could not read tonight\'s check-ins. Try again in a minute.'; return; }
  night = res.body;
  if (!$('why').value || $('why').dataset.auto === '1') { $('why').value = defaultWhy(night); $('why').dataset.auto = '1'; }
  draw();
}

function draw() {
  const groups = byClub(night.kids || []);
  $('list-note').textContent = night.noClub ? 'No club tonight.' : groups.length ? '' : 'Nobody is checked in yet.';
  const list = $('list');
  list.textContent = '';
  for (const g of groups) {
    const sec = document.createElement('section');
    sec.className = 'club';
    if (g.key) sec.dataset.club = g.key;
    const h = document.createElement('h2');
    const title = document.createElement('span');
    title.textContent = `${g.club} · ${g.kids.length}`;
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'quiet';
    const every = g.kids.every((k) => picked.has(k.id));
    all.textContent = every ? 'Clear' : 'All';
    all.addEventListener('click', () => { for (const k of g.kids) (every ? picked.delete(k.id) : picked.add(k.id)); draw(); });
    h.append(title, all);
    sec.append(h);
    for (const k of g.kids) {
      const row = document.createElement('label');
      row.className = 'kid';
      row.dataset.id = k.id;
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = picked.has(k.id);
      box.disabled = giving;
      box.addEventListener('change', () => { if (box.checked) picked.add(k.id); else picked.delete(k.id); drawBar(); });
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = `${k.first} ${k.last}`.trim();
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = k.given ? `+${k.given} tonight` : '';
      const out = document.createElement('span');
      out.className = 'out';
      row.append(box, name, tag, out);
      sec.append(row);
    }
    list.append(sec);
  }
  drawBar();
}

function drawBar() {
  $('count').textContent = picked.size ? `${picked.size} picked` : 'Pick children';
  for (const b of document.querySelectorAll('[data-amount]')) b.setAttribute('aria-pressed', String(Number(b.dataset.amount) === amount));
  $('give').disabled = giving || !picked.size;
  $('give').textContent = giving ? 'Giving…' : `Give ${amount}`;
}

async function give() {
  if (giving || !picked.size) return;
  const why = $('why').value.trim().slice(0, 75);
  if (!why) { $('why').focus(); return; }
  if (!window.confirm(confirmWords(picked.size, amount))) return;
  giving = true;
  drawBar();
  const key = batchKey();
  const ids = [...picked];
  for (const id of ids) {
    const row = document.querySelector(`.kid[data-id="${id}"]`);
    const out = row && row.querySelector('.out');
    if (out) { out.textContent = 'Giving…'; out.className = 'out'; }
    let res = null;
    for (let i = 0; i < TRIES; i++) {
      res = await request('/v1/shares/give', { method: 'POST', body: { id, shares: amount, why, key } });
      // Nothing was asked of TwoTimTwo yet (busy, no answer): safe to ask again, same key.
      if (res.body && res.body.outcome) break;
      if (res.status !== 429 && res.status !== 0 && res.status !== 502) break;
      await sleep(4000);
    }
    const r = (res && res.body) || {};
    if (out) {
      out.textContent = resultWords(r);
      out.className = `out ${r.outcome === 'given' ? 'good' : r.outcome === 'unknown' ? 'warn' : 'bad'}`;
    }
    if (r.outcome === 'given' || r.outcome === 'unknown') picked.delete(id);
  }
  giving = false;
  drawBar();
  // Fresh "+N tonight" tags, keeping each row's result line.
  const lines = new Map([...document.querySelectorAll('.kid')].map((row) => [row.dataset.id, row.querySelector('.out').outerHTML]));
  const res = await request('/v1/shares/tonight');
  if (res.ok && res.body) { night = res.body; draw(); }
  for (const [id, html] of lines) {
    const row = document.querySelector(`.kid[data-id="${id}"] .out`);
    if (row) row.outerHTML = html;
  }
}

async function start() {
  $('signin').addEventListener('submit', signIn);
  $('give').addEventListener('click', give);
  $('reload').addEventListener('click', load);
  $('why').addEventListener('input', () => { $('why').dataset.auto = '0'; });
  for (const b of document.querySelectorAll('[data-amount]')) b.addEventListener('click', () => { amount = Number(b.dataset.amount); drawBar(); });
  try {
    const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
    const d = res.ok ? await res.json() : null;
    const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
    if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
  } catch { /* no service: the sign-in says so */ }
  if (base && store.get(TOKEN_KEY)) await load();
  else showSignIn();
}

start();
