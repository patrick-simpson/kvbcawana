// Cast, the presenter's page (owner 2026-11-08: "set it up kind of like an air
// server ... present from their laptop but through a webpage that is controlling
// that computer"; "TV code only"). awana.kvbchurch.org/cast
//
// - The code on the TV is the only way in (POST /v1/cast/join): the Worker answers a
//   TOKEN, kept in sessionStorage only (this tab, gone when it closes), carried as
//   X-Cast-Token on every call. A 401 means the room moved on (a new code, Cast off,
//   the token's 8 hours up): the token is dropped and the code asked again.
// - Five things to show: the laptop's screen, live (WebRTC laptop to TV over the
//   church network, shared/screenShare.js; the Worker only passes the offer and the
//   answer), a YouTube video, text, pictures, slides (a PDF, a PowerPoint, or a Google
//   Slides link the Worker copies as its PDF export). Each goes up as ONE
//   press (`item` / `screen`), cleaned by the same rules the Worker applies
//   (shared/classroomRemote.js).
// - A PowerPoint (owner 2026-11-08, the exact copy): scrambled HERE (AES-256-GCM, a
//   fresh key), sent in parts to /v1/cast/convert, then "start" hands the key on to the
//   GitHub job that turns it into a PDF with LibreOffice (about a minute); this page asks
//   for the status every CONVERT_POLL_MS and puts the PDF up when it is ready.
// - Slides on the TV: the phone's preview (preview.js): this slide, the next, every slide.
// - ONE presenter at a time (owner 2026-11-08): a join while someone else presents is
//   refused (the Worker's 409 `busy`, its own words); Disconnect frees the room
//   (POST /v1/cast/leave) and "Display code" also puts the TV back to its code.
// - The TV's QR code opens this page as /cast/#code=123456: the code is read from the
//   fragment, the address cleaned, and it connects.
// - YouTube: search (GET /v1/cast/youtube, the Worker's key) or a link; a public
//   Facebook video's link; a video file (a clip, up to 200 MB, sent in ~1 MB parts).
// - "On the TV now": GET /v1/cast/state every 2 s while this page is visible (which
//   is also what makes the TV report), nothing while hidden, and it stops after 30
//   minutes with no touch (the free plan's daily requests).
// worker/src/routes.md 10.18.

import * as R from '/cast/shared/classroomRemote.js';
import { CONNECT_WAIT_MS, canShareScreen, startSharing } from '/cast/shared/screenShare.js';
import {
  TOKEN_KEY, TOKEN_RE, captureWords, cleanCode, codeReady, errorWords, filePress, fileProblem, formatCode,
  joinWords, linkToCopy, shareWords, size, textPress, titleFromName, tvWords, videoPress,
  CONVERT_GIVE_UP_MS, CONVERT_POLL_MS, SLIDES_ACCEPT, convertWords, slidesChoice,
  clock, codeFromHash, facebookPress, resultPress,
} from '/cast/logic.js';
import { createPreview } from '/cast/preview.js';

const SYNC_INDEX = new URL('/lobby/shared/sync.json', location.href).href;
const TUNING = Object.assign({ pollMs: 2000, idleMs: 30 * 60 * 1000, timeoutMs: 12000, failuresBeforeWarning: 2 }, window.castTuning || {});

const $ = (id) => /** @type {any} */ (document.getElementById(id));
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
// The token lives in THIS tab only (sessionStorage), never localStorage: a guest's
// laptop keeps nothing once the tab is closed.
const tokenStore = {
  get() { try { const t = sessionStorage.getItem(TOKEN_KEY) || ''; return TOKEN_RE.test(t) ? t : ''; } catch { return memToken; } },
  set(v) { memToken = v || ''; try { if (v) sessionStorage.setItem(TOKEN_KEY, v); else sessionStorage.removeItem(TOKEN_KEY); } catch { /* private window: memory only */ } },
};

let memToken = '';
let base = '';
let state = null; // { stage, now, screenOnline }
let failures = 0;
let pollTimer = 0;
let lastTouch = Date.now();
let sharing = null; // { pc, stop } while this page shares its screen
let shareId = ''; // the stage button id of this page's share
let shareStream = null;
let pdfFile = null; // { file, title } the last PDF sent
let converting = ''; // the id of the PowerPoint being made into slides
let clipFile = null; // { file, title } the last video sent
let preview = null;
const pictures = []; // { file, url, title }

/* ── Requests ── */

function request(path, opts = {}) {
  const headers = {};
  const bytes = opts.body instanceof Uint8Array;
  if (opts.body !== undefined) headers['Content-Type'] = bytes ? 'application/octet-stream' : 'application/json';
  const token = tokenStore.get();
  if (token) headers['X-Cast-Token'] = token;
  return fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : (bytes ? opts.body : JSON.stringify(opts.body)),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(opts.timeoutMs || TUNING.timeoutMs) : undefined,
  }).then(
    (res) => res.json().then((b) => ({ ok: res.ok, status: res.status, body: b }), () => ({ ok: res.ok, status: res.status, body: null })),
    () => ({ ok: false, status: 0, body: null }),
  ).then((r) => {
    // Any 401 on a presenter call: this page is no longer connected to the TV.
    if (r.status === 401 && path !== '/v1/cast/join') disconnected((r.body && r.body.error) || 'This page is no longer connected to the TV. Type the code on the TV again.');
    return r;
  });
}

/* ── Step 1: the code ── */

function showJoin(note, bad) {
  clearTimeout(pollTimer);
  $('present').hidden = true;
  $('leave').hidden = true;
  $('join').hidden = false;
  setText($('join-note'), note || '');
  $('join-note').classList.toggle('bad', Boolean(bad));
}

function showPresent() {
  $('join').hidden = true;
  $('present').hidden = false;
  $('leave').hidden = false;
  touch();
  poll();
}

function disconnected(words) {
  if (!tokenStore.get() && $('present').hidden) return;
  tokenStore.set('');
  endShareHere();
  state = null;
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
  const r = await request('/v1/cast/join', { method: 'POST', body: { code } });
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
  if (shareId) { const id = shareId; endShareHere(); setShare('stopped'); if (!takeDown && state && state.stage.show && state.stage.show.button.id === id) await press('back', null, 'Your screen is off the TV'); }
  converting = '';
  if (tokenStore.get()) await request('/v1/cast/leave', { method: 'POST', body: takeDown ? { takeDown: true } : {} });
  tokenStore.set('');
  state = null;
  showJoin(takeDown ? 'The code is back on the TV, ready for the next person. Thanks!' : 'Disconnected. Type the code again to present.');
}

/* ── What's on the TV ── */

function touch() {
  const wasIdle = Date.now() - lastTouch > TUNING.idleMs;
  lastTouch = Date.now();
  if (wasIdle && tokenStore.get() && !document.hidden) poll();
}

async function poll() {
  clearTimeout(pollTimer);
  if (!tokenStore.get() || document.hidden) return;
  if (Date.now() - lastTouch > TUNING.idleMs) {
    setText($('tv-sub'), 'Paused while you were away. Tap anywhere to see the TV again.');
    return;
  }
  const r = await request('/v1/cast/state');
  if (!tokenStore.get()) return;
  if (r.ok && r.body) {
    failures = 0;
    state = { stage: R.sanitizeStage(r.body.stage), now: R.sanitizeClassroomNow(r.body.now), screenOnline: r.body.screenOnline === true };
    // Someone else put something up over this page's share: stop sending the picture.
    if (shareId && !(state.stage.show && state.stage.show.button.id === shareId)) endShareHere('Your screen was replaced by something else on the TV.');
  } else if (r.status !== 401) {
    failures += 1;
  }
  render();
  pollTimer = setTimeout(poll, TUNING.pollMs);
}

function render() {
  if (!state) return;
  const offline = failures >= TUNING.failuresBeforeWarning;
  const w = offline
    ? { main: 'Not reaching the TV right now.', sub: navigator.onLine === false ? 'This device is offline.' : 'Trying again…', online: false }
    : tvWords(state);
  // Slides: the preview says which slide (no second "Page 2 of 9" line above it).
  if (!offline && w.online && state.stage.show && state.stage.show.button.kind === 'pdf') w.sub = '';
  setText($('tv-main'), w.main);
  setText($('tv-sub'), w.sub);
  $('tv').dataset.online = String(w.online);
  const shown = state.stage.show ? state.stage.show.button : null;
  const kind = shown ? shown.kind : '';
  $('ctl-video').hidden = !R.CLASSROOM_PLAYABLE_KINDS.includes(kind);
  if (preview) {
    if (kind === 'pdf') preview.show(shown.file, state.stage.show.page, state.now && state.now.button === shown.id ? state.now.pages || 0 : 0);
    else preview.hide();
  }
  $('btn-down').hidden = !shown;
  setText($('btn-down'), shown && shown.id === shareId ? 'Stop sharing' : 'Take it down');
  const video = state.now && shown && state.now.button === shown.id ? state.now.video : null;
  setText($('btn-play'), video && video.paused ? 'Play' : 'Pause');
  setText($('btn-mute'), video && video.muted ? 'Unmute' : 'Mute');
  $('btn-mute').dataset.op = video && video.muted ? 'unmute' : 'mute';
  for (const t of document.querySelectorAll('.thumb')) t.setAttribute('aria-pressed', String(Boolean(shown && shown.file && shown.file === t.dataset.file)));
}

/* ── Presses ── */

async function press(action, data, said) {
  touch();
  setText($('press-note'), 'Sending…');
  const r = await request('/v1/cast/press', { method: 'POST', body: { action, ...(data ? { data } : {}) } });
  if (r.status === 401) return null;
  if (r.ok) setText($('press-note'), r.body && r.body.screenOnline === false ? `${said}. The TV will show it when it answers.` : said);
  else setText($('press-note'), errorWords(r.status, r.body));
  poll();
  return r;
}

/** The choices list: one open at a time. */
function onChoice(e) {
  const btn = e.target.closest('.choice');
  if (!btn) return;
  const open = btn.getAttribute('aria-expanded') !== 'true';
  for (const b of document.querySelectorAll('.choice')) {
    const mine = b === btn && open;
    b.setAttribute('aria-expanded', String(mine));
    $(b.getAttribute('aria-controls')).hidden = !mine;
  }
}

function sendVideo(e) {
  e.preventDefault();
  const out = videoPress({ link: $('video-link').value, title: $('video-title').value }, R);
  if (!out.ok) { setText($('press-note'), out.error); return; }
  press(out.press.action, out.press.data, 'The video is going up').then((r) => { if (r && r.ok) { $('video-link').value = ''; $('video-title').value = ''; } });
}

/* ── YouTube search (the Worker asks YouTube with the church's key) ── */

async function searchYouTube(e) {
  e.preventDefault();
  touch();
  const q = $('yt-q').value.trim();
  const note = $('yt-note');
  const list = $('yt-results');
  note.classList.remove('bad');
  if (!q) { setText(note, 'Type something to search for.'); return; }
  setText(note, 'Searching…');
  const r = await request(`/v1/cast/youtube?q=${encodeURIComponent(q)}`, { timeoutMs: 15000 });
  if (r.status === 401) return;
  if (!r.ok || !r.body) { setText(note, errorWords(r.status, r.body)); note.classList.add('bad'); return; }
  const results = Array.isArray(r.body.results) ? r.body.results : [];
  list.textContent = '';
  setText(note, results.length ? 'Tap one to play it on the TV.' : 'Nothing found. Try other words.');
  for (const v of results) {
    if (!R.youtubeIdFrom(v.youtube)) continue;
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'result';
    const img = document.createElement('img');
    img.src = `https://i.ytimg.com/vi/${v.youtube}/mqdefault.jpg`;
    img.alt = '';
    img.loading = 'lazy';
    const words = document.createElement('div');
    const t = document.createElement('b');
    t.textContent = String(v.title || 'YouTube video');
    const sub = document.createElement('span');
    sub.textContent = [String(v.channel || ''), v.seconds ? clock(v.seconds) : ''].filter(Boolean).join(' · ');
    words.append(t, sub);
    b.append(img, words);
    b.addEventListener('click', () => {
      const out = resultPress({ youtube: v.youtube, title: String(v.title || '').slice(0, R.CLASSROOM_TITLE_MAX) }, R);
      if (!out.ok) { setText($('press-note'), out.error); return; }
      press(out.press.action, out.press.data, 'The video is going up');
    });
    li.append(b);
    list.append(li);
  }
}

function sendFacebook(e) {
  e.preventDefault();
  const out = facebookPress({ link: $('fb-link').value, title: $('fb-title').value }, R);
  if (!out.ok) { setText($('press-note'), out.error); return; }
  press(out.press.action, out.press.data, 'The Facebook video is going up').then((r) => { if (r && r.ok) { $('fb-link').value = ''; $('fb-title').value = ''; } });
}

/* ── A video file: sent in ~1 MB parts, then played ── */

async function sendClip(e) {
  touch();
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const note = $('clip-note');
  note.classList.remove('bad');
  // A phone may report no type for a .mov: go by the name.
  const type = file.type || (/\.mov$/i.test(file.name) ? 'video/quicktime' : /\.webm$/i.test(file.name) ? 'video/webm' : /\.(mp4|m4v)$/i.test(file.name) ? 'video/mp4' : '');
  const typed = type === file.type ? file : new File([file], file.name, { type });
  const problem = fileProblem(typed, 'clip', R);
  if (problem) { setText(note, problem); note.classList.add('bad'); return; }
  const done = await upload(typed, (w) => setText(note, w));
  if (!done) { note.classList.add('bad'); return; }
  clipFile = { file: done, title: titleFromName(file.name) };
  setText(note, '');
  setText($('clip-ready-words'), `${clipFile.title || 'Video'} · ${size(done.bytes || file.size)}`);
  $('clip-ready').hidden = false;
  showClip();
}

function showClip() {
  if (!clipFile) return;
  const out = filePress(clipFile.file, clipFile.title, R);
  if (!out.ok) { setText($('press-note'), out.error); return; }
  press(out.press.action, out.press.data, 'The video is going up');
}

function sendText(e) {
  e.preventDefault();
  const look = document.querySelector('input[name="look"]:checked');
  const out = textPress({ heading: $('text-heading').value, text: $('text-body').value, look: look ? look.value : 'page' }, R);
  if (!out.ok) { setText($('press-note'), out.error); return; }
  press(out.press.action, out.press.data, 'The text is going up');
}

/* ── Files: sent in parts, then put up with one press ── */

async function upload(file, say) {
  say(`Sending ${size(file.size)}…`);
  const start = await request('/v1/cast/files', { method: 'POST', body: { type: file.type, bytes: file.size, name: file.name } });
  if (!start.ok || !start.body) { say(errorWords(start.status, start.body)); return null; }
  const { id, parts, partBytes } = start.body;
  const bytes = new Uint8Array(await file.arrayBuffer());
  for (let n = 0; n < parts; n += 1) {
    let r = null;
    for (let tries = 0; tries < 3; tries += 1) {
      r = await request(`/v1/cast/files/${id}/${n}`, { method: 'PUT', body: bytes.subarray(n * partBytes, (n + 1) * partBytes), timeoutMs: 30000 });
      if (r.ok || r.status === 401) break;
    }
    if (!r || !r.ok) { if (r && r.status !== 401) say('The upload stopped (the internet?). Try again.'); return null; }
    if (parts > 1) say(`Sending… ${Math.round(((n + 1) / parts) * 100)}%`);
  }
  const fin = await request(`/v1/cast/files/${id}/done`, { method: 'POST', body: {} });
  if (!fin.ok || !fin.body) { say(errorWords(fin.status, fin.body)); return null; }
  return fin.body;
}

async function addPictures(e) {
  touch();
  const files = [...(e.target.files || [])];
  e.target.value = '';
  const note = $('pic-note');
  const say = (w) => setText(note, w);
  note.classList.remove('bad');
  let added = 0;
  for (const [i, file] of files.entries()) {
    const problem = fileProblem(file, 'image', R);
    if (problem) { say(`${file.name}: ${problem}`); note.classList.add('bad'); continue; }
    const done = await upload(file, (w) => say(files.length > 1 ? `Picture ${i + 1} of ${files.length}. ${w}` : w));
    if (!done) { note.classList.add('bad'); if (!tokenStore.get()) return; continue; }
    const pic = { file: done, url: URL.createObjectURL(file), title: titleFromName(file.name) };
    pictures.push(pic);
    $('thumbs').append(thumb(pic));
    added += 1;
  }
  if (added && !note.classList.contains('bad')) say(added === 1 ? 'Ready. Tap it to show it on the TV.' : `${added} ready. Tap one to show it on the TV.`);
  render();
}

function thumb(pic) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'thumb';
  b.dataset.file = pic.file.id;
  b.setAttribute('aria-pressed', 'false');
  b.setAttribute('aria-label', `Show ${pic.title || 'this picture'} on the TV`);
  const img = document.createElement('img');
  img.src = pic.url;
  img.alt = '';
  b.append(img);
  b.addEventListener('click', () => {
    const out = filePress(pic.file, pic.title, R);
    if (!out.ok) { setText($('press-note'), out.error); return; }
    press(out.press.action, out.press.data, 'The picture is going up');
  });
  return b;
}

async function sendPdfFile(e) {
  touch();
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const note = $('pdf-note');
  note.classList.remove('bad');
  const choice = slidesChoice(file, R);
  if (!choice.ok) { setText(note, choice.error); note.classList.add('bad'); return; }
  if (choice.kind === 'pptx') { await convertPptx(file); return; }
  const done = await upload(file, (w) => setText(note, w));
  if (!done) { note.classList.add('bad'); return; }
  if (preview) preview.remember(done.id, file);
  pdfReady(done, titleFromName(file.name));
}

/* ── A PowerPoint: scrambled here, made into slides by the GitHub job ── */

/** The file scrambled with a fresh key: 12-byte IV + AES-256-GCM ciphertext, and the key (base64url). @param {File} file */
async function scramble(file) {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, await file.arrayBuffer()));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  const b64 = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { bytes: out, key: b64 };
}

async function convertPptx(file) {
  const note = $('pdf-note');
  const say = (w, bad) => { setText(note, w); note.classList.toggle('bad', Boolean(bad)); };
  if (converting) { say('Slides are already being made from another file. Wait for them first.', true); return; }
  say(convertWords('uploading'));
  const { bytes, key } = await scramble(file);
  const start = await request('/v1/cast/convert', { method: 'POST', body: { bytes: bytes.length, name: file.name } });
  if (!start.ok || !start.body) { if (start.status !== 401) say(errorWords(start.status, start.body), true); return; }
  const { id, parts, partBytes } = start.body;
  converting = id;
  try {
    for (let n = 0; n < parts; n += 1) {
      let r = null;
      for (let tries = 0; tries < 3; tries += 1) {
        r = await request(`/v1/cast/convert/${id}/${n}`, { method: 'PUT', body: bytes.subarray(n * partBytes, (n + 1) * partBytes), timeoutMs: 30000 });
        if (r.ok || r.status === 401) break;
      }
      if (!r || !r.ok) { if (r && r.status !== 401) say('The upload stopped (the internet?). Try again.', true); return; }
      if (parts > 1) say(`Sending the PowerPoint… ${Math.round(((n + 1) / parts) * 100)}%`);
    }
    const go = await request(`/v1/cast/convert/${id}/start`, { method: 'POST', body: { key } });
    if (!go.ok) { if (go.status !== 401) say(errorWords(go.status, go.body), true); return; }
    const began = Date.now();
    say(convertWords('converting', '', 0));
    for (;;) {
      await new Promise((r) => setTimeout(r, CONVERT_POLL_MS));
      if (!tokenStore.get() || converting !== id) return;
      const seconds = Math.round((Date.now() - began) / 1000);
      if (Date.now() - began > CONVERT_GIVE_UP_MS) { say(convertWords('gave-up'), true); return; }
      const st = await request(`/v1/cast/convert/${id}`);
      if (st.status === 401) return;
      if (!st.ok || !st.body) { if (st.status === 404) { say(convertWords('failed', 'convert'), true); return; } continue; }
      if (st.body.status === 'done' && st.body.file) { pdfReady(st.body.file, titleFromName(file.name)); return; }
      if (st.body.status === 'failed') { say(convertWords('failed', st.body.error), true); return; }
      say(convertWords(st.body.status, '', seconds));
    }
  } finally {
    if (converting === id) converting = '';
  }
}

/** The room's PDF for the phone's preview (this page's token). @param {string} id */
async function fetchPdf(id) {
  try {
    const res = await fetch(`${base}/v1/cast/files/${encodeURIComponent(id)}`, { headers: { 'X-Cast-Token': tokenStore.get() }, cache: 'no-store' });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

async function copyPdfLink() {
  touch();
  const note = $('pdf-note');
  note.classList.remove('bad');
  const link = linkToCopy($('pdf-link').value, R);
  if (!link.ok) { setText(note, link.error); note.classList.add('bad'); return; }
  setText(note, link.google ? 'Getting the slides from Google…' : 'Getting it from that link…');
  const r = await request('/v1/cast/files', { method: 'POST', body: { url: link.url }, timeoutMs: 40000 });
  if (!r.ok || !r.body) {
    if (r.status === 401) return;
    setText(note, link.google && r.status >= 400 && r.status < 500 && r.status !== 429
      ? 'Google would not hand the slides over. In Slides, press Share and set it to “Anyone with the link”, then try again.'
      : errorWords(r.status, r.body));
    note.classList.add('bad');
    return;
  }
  if (r.body.kind !== 'pdf' && r.body.kind !== 'image') { setText(note, 'That link was not a PDF or a picture.'); note.classList.add('bad'); return; }
  $('pdf-link').value = '';
  pdfReady(r.body, titleFromName(r.body.name || '') || (link.google ? 'Google Slides' : ''));
}

/** A PDF is stored in the room: put it up now, and keep a Show button for later. */
function pdfReady(file, title) {
  pdfFile = { file, title };
  setText($('pdf-note'), '');
  setText($('pdf-ready-words'), `${title || 'Slides'} · ${size(file.bytes || 0)}`);
  $('pdf-ready').hidden = false;
  showPdf();
}

function showPdf() {
  if (!pdfFile) return;
  const out = filePress(pdfFile.file, pdfFile.title, R);
  if (!out.ok) { setText($('press-note'), out.error); return; }
  press(out.press.action, out.press.data, 'The slides are going up');
}

/* ── Screen share ── */

function setShare(kind, error) {
  const el = $('share-state');
  el.hidden = !kind;
  setText(el, shareWords(kind, error));
  el.classList.toggle('bad', kind === 'failed');
}

async function shareScreen() {
  touch();
  if (shareId) return;
  setShare('choosing');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (err) { setShare('failed', captureWords(err)); return; }
  const r = await press('screen', { title: $('share-title').value }, 'Your screen is going up');
  if (!r || !r.ok || !r.body || !R.isButtonId(r.body.button)) {
    for (const t of stream.getTracks()) t.stop();
    setShare(r && r.status !== 401 ? 'failed' : '', r ? errorWords(r.status, r.body) : '');
    return;
  }
  const id = r.body.button;
  shareId = id;
  shareStream = stream;
  // The browser's own "Stop sharing" bar ends the track: take it off the TV too.
  for (const t of stream.getVideoTracks()) t.addEventListener('ended', () => { if (shareId === id) stopShare(); });
  setShare('connecting');
  // The relay (worker/src/turn.js): Cloudflare STUN always, TURN when set up, so the
  // picture reaches the TV from any Wi-Fi. Without an answer, try the direct way only.
  const ice = await request(`/v1/cast/ice?id=${encodeURIComponent(id)}`);
  const iceServers = ice.ok && ice.body && Array.isArray(ice.body.iceServers) ? ice.body.iceServers : [];
  let connected = false;
  try {
    const s = await startSharing({
      stream,
      iceServers,
      sendOffer: async (sdp) => {
        const o = await request('/v1/cast/signal', { method: 'POST', body: { signal: { type: 'offer', id, sdp } } });
        if (!o.ok) throw new Error(errorWords(o.status, o.body));
      },
      readAnswer: async () => {
        if (shareId !== id) throw new Error('Sharing stopped.');
        const a = await request(`/v1/cast/signal?id=${encodeURIComponent(id)}`);
        if (a.status === 401) throw new Error('This page is no longer connected to the TV.');
        const sig = a.ok && a.body ? R.sanitizeSignal(a.body.signal) : null;
        return sig && sig.type === 'answer' && sig.id === id ? sig.sdp : null;
      },
      onState: (st) => {
        if (shareId !== id) return;
        if (st === 'connected') connected = true;
        if (st === 'failed') { giveUp(id, 'The TV could not receive your screen. Check this laptop\u2019s internet, then press Share my screen again.'); return; }
        setShare(st);
      },
    });
    if (shareId !== id) { s.stop(); return; }
    sharing = s;
    // Never leave the TV on black: no picture within CONNECT_WAIT_MS = take it down and say so.
    setTimeout(() => { if (shareId === id && !connected) giveUp(id, 'Your screen did not reach the TV. Press Share my screen to try again.'); }, CONNECT_WAIT_MS);
  } catch (err) {
    if (shareId !== id) return;
    shareId = '';
    shareStream = null;
    setShare('failed', err && err.message ? err.message : '');
    press('back', null, 'Taken down');
  }
}

/** A share that failed: stop sending, take it off the TV, say why. @param {string} id @param {string} words */
function giveUp(id, words) {
  if (shareId !== id) return;
  endShareHere();
  setShare('failed', words);
  if (!state || (state.stage.show && state.stage.show.button.id === id)) press('back', null, 'Taken down');
}

/** Stop this page's share and take it off the TV. */
function stopShare() {
  const id = shareId;
  endShareHere();
  setShare('stopped');
  // Only take the TV down when it still shows this share (never someone else's item).
  if (id && (!state || (state.stage.show && state.stage.show.button.id === id))) press('back', null, 'Your screen is off the TV');
}

/** Stop sending the picture (tracks and connection), without a press. */
function endShareHere(words) {
  if (!shareId && !sharing) return;
  shareId = '';
  if (sharing) sharing.stop();
  sharing = null;
  if (shareStream) for (const t of shareStream.getTracks()) t.stop();
  shareStream = null;
  if (words) setShare('failed', words);
}

/* ── Start ── */

async function start() {
  $('join-form').addEventListener('submit', join);
  $('code').addEventListener('input', onCodeInput);
  $('leave').addEventListener('click', () => leave(false));
  $('btn-code').addEventListener('click', () => leave(true));
  $('yt-search-form').addEventListener('submit', searchYouTube);
  $('fb-form').addEventListener('submit', sendFacebook);
  $('clip-input').addEventListener('change', sendClip);
  $('clip-show').addEventListener('click', showClip);
  document.querySelector('.choices').addEventListener('click', onChoice);
  $('video-form').addEventListener('submit', sendVideo);
  $('text-form').addEventListener('submit', sendText);
  $('pic-input').addEventListener('change', addPictures);
  $('pdf-input').addEventListener('change', sendPdfFile);
  $('pdf-copy').addEventListener('click', copyPdfLink);
  $('pdf-show').addEventListener('click', showPdf);
  $('btn-share').addEventListener('click', shareScreen);
  $('btn-down').addEventListener('click', () => {
    const shown = state && state.stage.show ? state.stage.show.button : null;
    if (shown && shown.id === shareId) stopShare();
    else press('back', null, 'Taken down');
  });
  $('ctl-video').addEventListener('click', (e) => {
    const b = e.target.closest('[data-op]');
    if (!b) return;
    const data = { op: b.dataset.op };
    if (b.dataset.by) data.by = Number(b.dataset.by);
    if (b.dataset.step) data.step = Number(b.dataset.step);
    const p = R.sanitizeClassroomPress('video', data);
    if (p) press('video', p.data, b.textContent.trim());
  });
  $('pdf-input').setAttribute('accept', SLIDES_ACCEPT);
  // The slides on the TV: the preview's Back / Next and its strip are presses.
  preview = createPreview({
    root: $('ctl-pdf'),
    fetchPdf,
    go: (to, step) => {
      touch();
      if (to) press('page', { to }, `Slide ${to} is going up`);
      else press('page', { step }, step > 0 ? 'Next slide' : 'Previous slide');
    },
  });
  // iPhones and iPads (and most phones) cannot share a screen from a web page: say so instead.
  if (!canShareScreen()) { $('li-screen').hidden = true; $('li-noshare').hidden = false; }
  for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, touch, { passive: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && tokenStore.get()) { touch(); poll(); } });
  window.addEventListener('online', () => { if (tokenStore.get()) poll(); });
  window.addEventListener('pagehide', () => { if (shareId) endShareHere(); });

  try {
    if (typeof window.castBase === 'string') base = window.castBase;
    else {
      const res = await fetch(SYNC_INDEX, { cache: 'no-store' });
      const d = res.ok ? await res.json() : null;
      const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
      if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
    }
  } catch { /* the code step says so */ }
  // The Worker is this site's /api: same origin whatever sync.json said.
  if (!base && location.protocol === 'https:') base = `${location.origin}/api`;

  // The TV's QR code: /cast/#code=123456. The code leaves the address bar at once.
  const fromQr = codeFromHash(location.hash);
  if (fromQr) { try { history.replaceState(null, '', location.pathname + location.search); } catch { /* fine */ } }
  if (tokenStore.get() && base) showPresent();
  else if (fromQr && base) { showJoin(''); $('code').value = formatCode(fromQr); join(null); }
  else showJoin('');
  if (!tokenStore.get() && !fromQr) $('code').focus();
}

start();
