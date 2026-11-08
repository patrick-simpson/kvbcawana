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
//   answer), a YouTube video, text, pictures, slides (a PDF, PowerPoint saved as PDF,
//   or a Google Slides link the Worker copies as its PDF export). Each goes up as ONE
//   press (`item` / `screen`), cleaned by the same rules the Worker applies
//   (shared/classroomRemote.js).
// - "On the TV now": GET /v1/cast/state every 2 s while this page is visible (which
//   is also what makes the TV report), nothing while hidden, and it stops after 30
//   minutes with no touch (the free plan's daily requests).
// worker/src/routes.md 10.18.

import * as R from '/cast/shared/classroomRemote.js';
import { canShareScreen, startSharing } from '/cast/shared/screenShare.js';
import {
  TOKEN_KEY, TOKEN_RE, captureWords, cleanCode, codeReady, errorWords, filePress, fileProblem, formatCode,
  joinWords, linkToCopy, shareWords, size, textPress, titleFromName, tvWords, videoPress,
} from '/cast/logic.js';

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
  event.preventDefault();
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

function leave() {
  if (shareId) stopShare();
  tokenStore.set('');
  state = null;
  showJoin('Disconnected. Type the code again to present.');
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
  setText($('tv-main'), w.main);
  setText($('tv-sub'), w.sub);
  $('tv').dataset.online = String(w.online);
  const shown = state.stage.show ? state.stage.show.button : null;
  const kind = shown ? shown.kind : '';
  $('ctl-video').hidden = kind !== 'video';
  $('ctl-pdf').hidden = kind !== 'pdf';
  $('ctl-down').hidden = !shown;
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
  const problem = fileProblem(file, 'pdf', R);
  if (problem) { setText(note, problem); note.classList.add('bad'); return; }
  const done = await upload(file, (w) => setText(note, w));
  if (!done) { note.classList.add('bad'); return; }
  pdfReady(done, titleFromName(file.name));
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
  try {
    const s = await startSharing({
      stream,
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
      onState: (st) => { if (shareId === id) setShare(st === 'failed' ? 'failed' : st); },
    });
    if (shareId !== id) { s.stop(); return; }
    sharing = s;
  } catch (err) {
    if (shareId !== id) return;
    shareId = '';
    shareStream = null;
    setShare('failed', err && err.message ? err.message : '');
    press('back', null, 'Taken down');
  }
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
  $('leave').addEventListener('click', leave);
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
  $('ctl-pdf').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (b) press('page', { step: Number(b.dataset.step) }, Number(b.dataset.step) > 0 ? 'Next page' : 'Previous page');
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

  if (tokenStore.get() && base) showPresent();
  else showJoin('');
  if (!tokenStore.get()) $('code').focus();
}

start();
