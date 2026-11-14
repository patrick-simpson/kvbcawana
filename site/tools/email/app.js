// Club email (owner 2026-11-13; awana.kvbchurch.org/tools/email/, unlisted): a
// director signs in with their own code, writes to the parents of their own
// club, adds pictures and files, sends a test to themselves, then sends. The
// Worker (worker/src/clubmail.js, routes.md 10.19) reads the parents' addresses
// from TwoTimTwo itself and sends from the Awana mailbox: this page never sees
// an address, only how many there are.
//
// The owner signs in with the church passphrase AND the owner's code, and gets
// the Directors card too. The owner's code is kept in memory only.
//
// Sending is a row of small steps the page asks for one at a time (`/step`),
// so a big file never rides one long request. A send whose answer never came
// is NOT tried again: the page says to look in the mailbox's Sent folder.

import {
  FILE_ACCEPT, INLINE_TYPES, PICTURE_KEEP_BYTES, PICTURE_MAX_PX, hasWords, parseMessage, pictureLine,
  previewHtml, problemWords, recipientWords, sizeWords, stepRetryable, totalWords,
  blocksToText, boldEdit, bounceWords, cleanLink, linesEdit, linkEdit,
} from './logic.js';

const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const TOKEN_KEY = 'awanaMailToken.v1';
const DRAFT_KEY = 'awanaClubMailDraft.v1';
const TIMEOUT_MS = 30000;
const CONFIRM_MS = 4000;
const BOUNCE_LOOK_MS = 7 * 24 * 60 * 60 * 1000;
const STEP_TRIES = 5;
const STEP_WAIT_MS = 3000;

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window */ } },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let base = '';
let ownerCode = '';          // memory only
let ownerSession = '';       // used only together with ownerCode
/** @type {any} */
let me = null;
/** @type {{ name: string, type: string, size: number, inline: boolean, bytes: Uint8Array, url: string }[]} */
let files = [];
/** @type {any} */
let toCount = null;
let busy = false;
let armed = 0;
/** A message on its way: `/step` goes on from here after a problem. @type {{ id: string, test: boolean }|null} */
let running = null;
/** The message as last uploaded, until anything in it changes (a test, then the real send, upload once). */
let uploadedId = '';
let drawTimer = 0;
/** Anything in the message changed: what was uploaded or on its way no longer matches. */
const changed = () => { running = null; uploadedId = ''; };

const token = () => (store.get(TOKEN_KEY) || '').trim();

function request(path, opts = {}) {
  const headers = {};
  const raw = opts.raw !== undefined;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (raw) headers['Content-Type'] = typeof opts.raw === 'string' ? 'text/plain' : 'application/octet-stream';
  if (ownerCode && ownerSession) { headers.Authorization = `Bearer ${ownerSession}`; headers['X-Mail-Owner'] = ownerCode; }
  else if (opts.session) headers.Authorization = `Bearer ${opts.session}`;
  else if (token()) headers['X-Mail-Token'] = token();
  return fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: raw ? opts.raw : (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || TIMEOUT_MS) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  );
}

function setStatus(id, words, kind = '') {
  const el = $(id);
  el.textContent = words;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

// ── signing in ────────────────────────────────────────────────────────────────

function showSignedOut(note = '', owner = false) {
  me = null;
  $('app').hidden = true;
  $('who').hidden = true;
  $('signin').hidden = owner;
  $('owner-signin').hidden = !owner;
  $('swap').hidden = false;
  $('swap-btn').textContent = owner ? 'Director sign-in' : 'Owner sign-in';
  $(owner ? 'owner-note' : 'signin-note').textContent = note;
  $(owner ? 'passphrase' : 'code').focus();
}

async function signIn(event) {
  event.preventDefault();
  const code = $('code').value.trim();
  if (!code) { $('signin-note').textContent = 'Type your code first.'; return; }
  if (!base) { $('signin-note').textContent = 'The service is not reachable right now. Reload in a minute.'; return; }
  $('signin-btn').disabled = true;
  $('signin-note').textContent = 'Signing in…';
  const res = await request('/v1/mail/login', { method: 'POST', body: { code } });
  $('signin-btn').disabled = false;
  if (!res.ok || !res.body || !res.body.token) {
    $('signin-note').textContent = res.status === 401 ? 'That code is not right. Check the email it came in.' : problemWords(res);
    return;
  }
  store.set(TOKEN_KEY, res.body.token);
  $('code').value = '';
  await enter();
}

async function ownerSignIn(event) {
  event.preventDefault();
  const note = $('owner-note');
  const typed = $('passphrase').value, code = $('owner-code').value.trim();
  if (!typed.trim() || !code) { note.textContent = 'Type the passphrase and the owner\'s code.'; return; }
  if (!base) { note.textContent = 'The service is not reachable right now. Reload in a minute.'; return; }
  $('owner-btn').disabled = true;
  note.textContent = 'Signing in… (this takes a second or two)';
  try {
    const plain = (p, o = {}) => fetch(base + p, { method: o.method || 'GET', headers: o.body === undefined ? {} : { 'Content-Type': 'application/json' }, body: o.body === undefined ? undefined : JSON.stringify(o.body), cache: 'no-store' })
      .then((r) => r.json().then((b) => ({ ok: r.ok, status: r.status, body: b }), () => ({ ok: r.ok, status: r.status, body: null })), () => ({ ok: false, status: 0, body: null }));
    const [sp, cc] = await Promise.all([import('./shared/sync-protocol.js'), import('./shared/cloud-crypto.js')]);
    const { res } = await sp.signInWithPassphrase({ request: plain, derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) { note.textContent = 'That is not the passphrase.'; return; }
    if (res.status === 429) { note.textContent = 'Too many wrong tries. Wait a little, then try again.'; return; }
    if (!res.ok || !SESSION_RE.test(b.session || '')) { note.textContent = res.status === 0 ? 'Could not reach the service. Check the internet.' : (b.error || 'Sign-in failed.'); return; }
    ownerSession = b.session; ownerCode = code;
    const check = await request('/v1/mail/directors');
    if (!check.ok) {
      ownerSession = ''; ownerCode = '';
      note.textContent = check.status === 403 ? 'That is not the owner\'s code.' : problemWords(check);
      return;
    }
    $('passphrase').value = ''; $('owner-code').value = '';
    await enter(check.body);
  } catch {
    note.textContent = 'This browser could not sign in (it may be too old).';
  } finally {
    $('owner-btn').disabled = false;
  }
}

async function signOut() {
  if (!ownerCode && token()) await request('/v1/mail/logout', { method: 'POST', body: {} });
  store.set(TOKEN_KEY, null);
  ownerCode = ''; ownerSession = '';
  showSignedOut('Signed out on this device.');
}

/** Signed in: who am I, then the page. @param {any} [directors] the owner's list, already read */
async function enter(directors) {
  const res = await request('/v1/mail/me');
  if (!res.ok || !res.body) {
    if (res.status === 401) { store.set(TOKEN_KEY, null); showSignedOut('Your sign-in ended. Type your code again.'); } else showSignedOut(problemWords(res));
    return;
  }
  me = res.body;
  $('signin').hidden = true; $('owner-signin').hidden = true; $('swap').hidden = true;
  $('app').hidden = false; $('who').hidden = false;
  $('who-name').textContent = me.name;
  $('club').replaceChildren(...clubChoices().map((c) => new Option(c.name, c.id)));
  $('club-field').hidden = me.clubs.length < 2;
  const saved = readDraft();
  if (saved.club && clubChoices().some((c) => c.id === saved.club)) $('club').value = saved.club;
  $('subject').value = saved.subject; $('text').value = saved.text;
  $('pick-file').accept = FILE_ACCEPT;
  $('setup').hidden = me.ready;
  $('setup').textContent = me.ready ? '' : 'Sending is not set up yet: the Microsoft app for the Awana mailbox has not been added (worker/README.md, "Club email"). You can write, but not send.';
  $('env-reply').textContent = `${me.name} <${me.replyTo}>`;
  $('directors-card').hidden = !me.office;
  if (me.office) drawDirectors(directors || (await request('/v1/mail/directors')).body);
  draw();
  loadCount();
  loadLog();
}

// ── the message ───────────────────────────────────────────────────────────────

function readDraft() {
  try { const d = JSON.parse(store.get(DRAFT_KEY) || '{}'); return { club: String(d.club || ''), subject: String(d.subject || ''), text: String(d.text || '') }; } catch { return { club: '', subject: '', text: '' }; }
}
/** The clubs to choose from: each of the sender's, then all of them at once when there is more than one. */
const clubChoices = () => (me ? [...me.clubs, ...(me.all ? [me.all] : [])] : []);
const clubNow = () => (me ? clubChoices().find((c) => c.id === $('club').value) || me.clubs[0] : null);
/** The mailbox the chosen club's email is sent from: its own when it has one (Puggles), else the Awana one. */
const fromNow = () => clubNow()?.from || me.from;

function draw() {
  if (!me) return;
  const subject = $('subject').value.trim(), text = $('text').value;
  store.set(DRAFT_KEY, subject || text.trim() ? JSON.stringify({ club: $('club').value, subject, text }) : null);
  const blocks = parseMessage(text, files);
  $('env-from').textContent = `KVBC Awana <${fromNow()}>`;
  $('env-subject').textContent = subject || '(no subject yet)';
  $('preview').innerHTML = hasWords(blocks)
    ? previewHtml(blocks, files, { sender: me.name, club: clubNow().label || clubNow().name })
    : '<p class="empty">Your message shows here as you type.</p>';
  const t = totalWords(files, me.limits.totalBytes);
  $('total').textContent = t.words;
  $('total').className = `total${t.over ? ' bad' : ''}`;
  $('files').replaceChildren(...files.map((f, i) => {
    const li = document.createElement('li');
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: f.name });
    const kind = Object.assign(document.createElement('span'), { className: 'kind', textContent: `${f.inline ? 'picture in the message' : 'attached'} · ${sizeWords(f.size)}` });
    const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Remove' });
    rm.setAttribute('aria-label', `Remove ${f.name}`);
    rm.addEventListener('click', () => removeFile(i));
    li.append(name, kind, rm);
    return li;
  }));
  refreshButtons();
}

function refreshButtons() {
  const blocks = parseMessage($('text').value, files);
  const ready = Boolean(me && me.ready && $('subject').value.trim() && hasWords(blocks) && !totalWords(files, me.limits.totalBytes).over);
  $('test').disabled = busy || !ready;
  $('send').disabled = busy || !ready || !(toCount && toCount.addresses > 0);
  if (!armed) $('send').textContent = running && !running.test ? 'Carry on sending' : (toCount && toCount.addresses ? `Send to ${toCount.addresses} ${toCount.addresses === 1 ? 'address' : 'addresses'}` : 'Send to parents');
}

async function loadCount() {
  toCount = null;
  const line = $('to-line');
  line.className = '';
  line.textContent = 'Counting the parents on TwoTimTwo…';
  refreshButtons();
  const club = $('club').value;
  const res = await request(`/v1/mail/recipients?club=${encodeURIComponent(club)}`, { timeoutMs: 70000 });
  if (club !== $('club').value) return;
  if (res.status === 401) { store.set(TOKEN_KEY, null); showSignedOut('Your sign-in ended. Type your code again.'); return; }
  if (!res.ok || !res.body) { line.className = 'bad'; line.textContent = `${problemWords(res)} Reload to count again.`; return; }
  toCount = res.body;
  line.className = toCount.addresses ? '' : 'bad';
  line.textContent = recipientWords(toCount);
  refreshButtons();
}

async function loadLog() {
  const res = await request('/v1/mail/log');
  const sends = res.ok && res.body ? res.body.sends : [];
  $('log-card').hidden = !sends.length;
  $('log').replaceChildren(...sends.slice(0, 8).map((s, i) => {
    const li = document.createElement('li');
    const when = new Date(s.at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const words = Object.assign(document.createElement('div'), { className: 'id' });
    const back = Object.assign(document.createElement('span'), { className: 'back' });
    words.append(Object.assign(document.createElement('b'), { textContent: s.subject }),
      Object.assign(document.createElement('span'), { textContent: `${when} · ${s.clubName} · ${s.recipients} addresses${me.office ? ` · ${s.name}` : ''}` }), back);
    li.append(words);
    if (s.id) {
      const again = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Use again' });
      again.addEventListener('click', () => useAgain(s.id, again));
      li.append(again);
      // The newest few, for a week: did any come back? (One small question each; the Worker keeps the answer ten minutes.)
      if (i < 3 && Date.now() - Date.parse(s.at) < BOUNCE_LOOK_MS) {
        request(`/v1/mail/log/${s.id}/bounces`).then((res) => { if (res.ok && res.body) back.textContent = bounceWords(res.body.bounced, res.body.mailbox); });
      }
    }
    return li;
  }));
}

/** Start a new message from a sent one: its club, subject and words (no pictures or files). */
async function useAgain(id, button) {
  if (busy) return;
  if (($('subject').value.trim() || $('text').value.trim()) && button.dataset.armed !== '1') {
    // What is being written would be replaced: ask with a second tap.
    button.dataset.armed = '1'; button.classList.add('armed'); button.textContent = 'Tap again: replaces your draft';
    setTimeout(() => { button.dataset.armed = ''; button.classList.remove('armed'); button.textContent = 'Use again'; }, CONFIRM_MS);
    return;
  }
  const res = await request(`/v1/mail/log/${id}`);
  if (!res.ok || !res.body) { setStatus('status', problemWords(res), 'bad'); return; }
  for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
  files = [];
  if (clubChoices().some((c) => c.id === res.body.club)) $('club').value = res.body.club;
  $('subject').value = res.body.subject;
  $('text').value = blocksToText(res.body.blocks);
  changed();
  draw();
  loadCount();
  setStatus('status', 'Copied into the message. Pictures and files are not copied.');
  $('subject').focus();
}

// ── formatting ────────────────────────────────────────────────────────────────

/** Run one of logic.js's text edits on the message and keep the cursor where the edit put it. */
function format(edit) {
  const ta = $('text');
  const r = edit(ta.value, ta.selectionStart ?? ta.value.length, ta.selectionEnd ?? ta.value.length);
  if (!r) return;
  ta.value = r.value;
  ta.focus();
  ta.setSelectionRange(r.start, r.end);
  changed();
  draw();
}

function addLink() {
  const url = cleanLink(window.prompt('Web address for the link', 'https://'));
  if (!url) { setStatus('status', 'That is not a web address, so no link was added.', 'bad'); return; }
  setStatus('status', '');
  format((v, s, e) => linkEdit(v, s, e, url));
}

// ── pictures and files ────────────────────────────────────────────────────────

/** A big picture made smaller (a JPEG at most PICTURE_MAX_PX wide); a small one as it is. @param {File} file */
async function shrink(file) {
  const asIs = async () => ({ type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (file.type === 'image/gif') return asIs();
  try {
    const bmp = await createImageBitmap(file);
    if (file.size <= PICTURE_KEEP_BYTES && bmp.width <= PICTURE_MAX_PX) { bmp.close(); return asIs(); }
    const scale = Math.min(1, PICTURE_MAX_PX / bmp.width);
    const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    if (!blob || blob.size >= file.size) return asIs();
    return { type: 'image/jpeg', bytes: new Uint8Array(await blob.arrayBuffer()) };
  } catch { return asIs(); }
}

/** @param {FileList|null} list @param {boolean} inline */
async function addFiles(list, inline) {
  for (const file of Array.from(list || [])) {
    if (files.length >= me.limits.files) { setStatus('status', `An email takes at most ${me.limits.files} pictures and files.`, 'bad'); break; }
    const picture = inline && INLINE_TYPES.includes(file.type);
    const made = picture ? await shrink(file) : { type: file.type || 'application/octet-stream', bytes: new Uint8Array(await file.arrayBuffer()) };
    let name = file.name || 'file';
    if (picture && made.type === 'image/jpeg' && !/\.jpe?g$/i.test(name)) name = `${name.replace(/\.[^.]+$/, '')}.jpg`;
    while (files.some((f) => f.name.toLowerCase() === name.toLowerCase())) name = name.replace(/(\.[^.]+)?$/, (ext) => ` (2)${ext || ''}`);
    if (!made.bytes.length) continue;
    files.push({ name, type: made.type, size: made.bytes.length, inline: picture, bytes: made.bytes, url: picture ? URL.createObjectURL(new Blob([made.bytes], { type: made.type })) : '' });
    if (picture) {
      // The picture goes where the cursor is, on a line of its own.
      const ta = $('text');
      const at = ta.selectionStart ?? ta.value.length;
      const before = ta.value.slice(0, at).replace(/[ \t]+$/, ''), after = ta.value.slice(at).replace(/^[ \t]+/, '');
      ta.value = `${before}${before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : ''}${pictureLine(name)}${after.startsWith('\n\n') ? '' : (after.startsWith('\n') ? '\n' : '\n\n')}${after}`;
    }
  }
  setStatus('status', '');
  draw();
}

function removeFile(i) {
  const f = files[i];
  if (!f || busy) return;
  if (f.url) URL.revokeObjectURL(f.url);
  files.splice(i, 1);
  if (f.inline) $('text').value = $('text').value.split('\n').filter((l) => l.trim().toLowerCase() !== pictureLine(f.name).toLowerCase()).join('\n').replace(/\n{3,}/g, '\n\n');
  changed();
  draw();
}

/** Bytes as base64, in pieces (a small file goes to Microsoft as base64). @param {Uint8Array} bytes */
function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ── sending ───────────────────────────────────────────────────────────────────

/** Upload the message and its files; answers the draft's id or null (the status says why). */
async function upload() {
  const blocks = parseMessage($('text').value, files);
  const start = await request('/v1/mail/drafts', { method: 'POST', body: { club: $('club').value, subject: $('subject').value, blocks, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size, inline: f.inline })) } });
  if (!start.ok || !start.body) { setStatus('status', problemWords(start), 'bad'); return null; }
  const { id, part } = start.body;
  const pieces = start.body.files.reduce((a, f) => a + f.parts, 0);
  let done = 0;
  for (let fi = 0; fi < files.length; fi += 1) {
    const plan = start.body.files[fi];
    const data = plan.enc === 'b64' ? toBase64(files[fi].bytes) : files[fi].bytes;
    for (let n = 0; n < plan.parts; n += 1) {
      const raw = data.slice(n * part, (n + 1) * part);
      let res = null;
      for (let tries = 0; tries < 3; tries += 1) {
        res = await request(`/v1/mail/drafts/${id}/files/${fi}/${n}`, { method: 'PUT', raw });
        if (res.ok || !stepRetryable(res)) break;
        await sleep(1500);
      }
      if (!res.ok) { setStatus('status', `${files[fi].name} did not upload. ${problemWords(res)}`, 'bad'); return null; }
      done += 1;
      $('progress').value = Math.round((60 * done) / pieces);
    }
  }
  return id;
}

/** Ask for steps until the message is sent, unknown, or stuck. */
async function steps() {
  const { id, test } = running;
  let tries = 0;
  for (;;) {
    const res = await request(`/v1/mail/drafts/${id}/step`, { method: 'POST', body: {}, timeoutMs: 90000 });
    if (res.ok && res.body) {
      tries = 0;
      $('progress').value = 60 + Math.round(res.body.percent * 0.4);
      if (res.body.stage === 'unknown') {
        running = null;
        setStatus('status', `Microsoft did not answer when the email was sent, so it may or may not have gone out. Do NOT send it again yet: look in the Sent folder of ${fromNow()} first.`, 'bad');
        return;
      }
      if (res.body.done) {
        running = null;
        if (test) setStatus('status', `Test sent to ${me.replyTo}.`, 'good');
        else finished(res.body.recipients);
        return;
      }
      setStatus('status', res.body.stage === 'files' ? 'Adding the pictures and files…' : (test ? 'Sending the test…' : 'Sending…'));
      continue;
    }
    if (res.status === 404 || res.status === 401) { running = null; setStatus('status', problemWords(res), 'bad'); return; }
    tries += 1;
    if (!stepRetryable(res) || tries >= STEP_TRIES) {
      setStatus('status', `${problemWords(res)} Nothing has been sent${test ? '' : ' to parents'} yet. Press the button to carry on.`, 'bad');
      return;
    }
    setStatus('status', 'Waiting a moment, then trying again…');
    await sleep(STEP_WAIT_MS);
  }
}

function finished(count) {
  const when = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  setStatus('status', `Sent to ${count} ${count === 1 ? 'address' : 'addresses'} at ${when}. A copy came to you.`, 'good');
  for (const f of files) if (f.url) URL.revokeObjectURL(f.url);
  files = [];
  uploadedId = '';
  $('subject').value = ''; $('text').value = '';
  draw();
  loadLog();
}

/** @param {boolean} test */
async function go(test) {
  if (busy || !me) return;
  busy = true; armed = 0;
  $('progress').hidden = false;
  refreshButtons();
  try {
    if (!(running && running.test === test)) {
      $('progress').value = 0;
      setStatus('status', files.length ? 'Uploading the pictures and files…' : 'Getting it ready…');
      const id = uploadedId || await upload();
      if (!id) return;
      uploadedId = id;
      const begin = await request(`/v1/mail/drafts/${id}/send`, { method: 'POST', body: { test } });
      if (!begin.ok) {
        if (begin.status === 404) uploadedId = '';
        setStatus('status', begin.status === 404 ? 'That took too long and the upload was cleared. Press the button again.' : problemWords(begin), 'bad');
        return;
      }
      running = { id, test };
    }
    await steps();
  } finally {
    busy = false;
    $('progress').hidden = true;
    refreshButtons();
  }
}

function sendPressed() {
  if (busy) return;
  if (running && !running.test) { go(false); return; }
  const now = Date.now();
  if (now - armed > CONFIRM_MS) {
    // The first tap only asks: a second within four seconds sends.
    armed = now;
    $('send').classList.add('armed');
    $('send').textContent = `Tap again to send to ${toCount.addresses} ${toCount.addresses === 1 ? 'address' : 'addresses'}`;
    setTimeout(() => { if (Date.now() - armed >= CONFIRM_MS) { armed = 0; $('send').classList.remove('armed'); refreshButtons(); } }, CONFIRM_MS + 50);
    return;
  }
  $('send').classList.remove('armed');
  go(false);
}

// ── the owner's directors ─────────────────────────────────────────────────────

/** @param {any} d the Worker's list answer */
function drawDirectors(d) {
  if (!d) return;
  $('d-clubs').replaceChildren(Object.assign(document.createElement('legend'), { textContent: 'Clubs' }), ...d.clubs.map((c) => {
    const label = document.createElement('label');
    label.append(Object.assign(document.createElement('input'), { type: 'checkbox', value: c.id }), c.name);
    return label;
  }));
  const names = Object.fromEntries(d.clubs.map((c) => [c.id, c.name]));
  $('directors').replaceChildren(...d.directors.map((p) => {
    const li = document.createElement('li');
    const id = Object.assign(document.createElement('div'), { className: 'id' });
    id.append(Object.assign(document.createElement('b'), { textContent: p.name }), Object.assign(document.createElement('span'), { textContent: `${p.clubs.map((c) => names[c] || c).join(', ')} · ${p.replyTo}` }));
    const code = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Email a new code' });
    const rm = Object.assign(document.createElement('button'), { type: 'button', className: 'quiet', textContent: 'Remove' });
    twoTaps(code, 'Tap again: the old code stops', async () => {
      const res = await request(`/v1/mail/directors/${p.id}/code`, { method: 'POST', body: {} });
      setStatus('d-status', res.ok ? `A new code was emailed to ${p.name}. The old one no longer works.` : problemWords(res), res.ok ? 'good' : 'bad');
    });
    twoTaps(rm, 'Tap again to remove', async () => {
      const res = await request(`/v1/mail/directors/${p.id}`, { method: 'DELETE' });
      setStatus('d-status', res.ok ? `${p.name} was removed and can no longer sign in.` : problemWords(res), res.ok ? 'good' : 'bad');
      if (res.ok) drawDirectors((await request('/v1/mail/directors')).body);
    });
    li.append(id, code, rm);
    return li;
  }));
}

/** A button that needs a second tap within four seconds. */
function twoTaps(button, askWords, run) {
  const words = button.textContent;
  let at = 0;
  button.addEventListener('click', async () => {
    if (Date.now() - at > CONFIRM_MS) {
      at = Date.now();
      button.classList.add('armed'); button.textContent = askWords;
      setTimeout(() => { if (Date.now() - at >= CONFIRM_MS) { button.classList.remove('armed'); button.textContent = words; } }, CONFIRM_MS + 50);
      return;
    }
    at = 0;
    button.classList.remove('armed'); button.textContent = words;
    button.disabled = true;
    await run();
    button.disabled = false;
  });
}

async function addDirector(event) {
  event.preventDefault();
  const clubs = Array.from($('d-clubs').querySelectorAll('input:checked'), (i) => i.value);
  const name = $('d-name').value.trim(), replyTo = $('d-email').value.trim();
  if (!name || !replyTo || !clubs.length) { setStatus('d-status', 'A director needs a name, an email address and at least one club.', 'bad'); return; }
  $('d-add').disabled = true;
  setStatus('d-status', 'Emailing their code…');
  const res = await request('/v1/mail/directors', { method: 'POST', body: { name, replyTo, clubs } });
  $('d-add').disabled = false;
  if (!res.ok) { setStatus('d-status', problemWords(res), 'bad'); return; }
  setStatus('d-status', `${name} added. Their code has been emailed.`, 'good');
  $('d-name').value = ''; $('d-email').value = '';
  drawDirectors((await request('/v1/mail/directors')).body);
}

// ── start ─────────────────────────────────────────────────────────────────────

async function start() {
  $('signin').addEventListener('submit', signIn);
  $('owner-signin').addEventListener('submit', ownerSignIn);
  $('swap-btn').addEventListener('click', () => showSignedOut('', $('owner-signin').hidden));
  $('signout').addEventListener('click', signOut);
  $('add-director').addEventListener('submit', addDirector);
  $('club').addEventListener('change', () => { changed(); draw(); loadCount(); });
  for (const id of ['subject', 'text']) $(id).addEventListener('input', () => { changed(); clearTimeout(drawTimer); drawTimer = setTimeout(draw, 250); });
  $('fmt-bold').addEventListener('click', () => format(boldEdit));
  $('fmt-heading').addEventListener('click', () => format((v, s, e) => linesEdit(v, s, e, 'heading')));
  $('fmt-list').addEventListener('click', () => format((v, s, e) => linesEdit(v, s, e, 'list')));
  $('fmt-link').addEventListener('click', addLink);
  $('add-picture').addEventListener('click', () => $('pick-picture').click());
  $('add-file').addEventListener('click', () => $('pick-file').click());
  $('pick-picture').addEventListener('change', (e) => { changed(); addFiles(e.target.files, true).then(() => { e.target.value = ''; }); });
  $('pick-file').addEventListener('change', (e) => { changed(); addFiles(e.target.files, false).then(() => { e.target.value = ''; }); });
  $('test').addEventListener('click', () => go(true));
  $('send').addEventListener('click', sendPressed);
  try {
    if (typeof window.clubMailBase === 'string') base = window.clubMailBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* no service named: the sign-in says so */ }
  if (!token()) { showSignedOut(base ? '' : 'The service is not reachable right now. Reload in a minute.'); return; }
  await enter();
}

start();
