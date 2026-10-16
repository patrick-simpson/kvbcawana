/* The Journey phone remote (owner 2026-10-13: "build a way to advance slides
   for Journey on a phone ... Doing it on the phone should advance the slide
   for all"). awana.kvbchurch.org/journey/remote/

   - Signs in with the church passphrase the way the Journey page does
     (passphrase v2: the key is derived HERE with the family's one
     sync-protocol.js + cloud-crypto.js, only that is sent; the session goes
     in the shared slot awanaSyncSession.v1; the passphrase is never kept).
   - Every press is ONE request, POST /v1/journey/remote {action, data?}: the
     sync Worker hands it to every Journey kiosk (worker/src/routes.md
     10.9), each runs it through its own buttons' functions.
   - Polls GET /v1/journey/remote/state every 1.5 s while this page is
     visible (never while hidden), which also tells the kiosks a phone is
     watching so they report what they show. Everything the Worker returns is
     cleaned with the same rules it applies (src/shared/journeyRemote.js).
   - Sample answers for the Talk About It questions come from
     ../slide-answers.json and are shown HERE ONLY: nothing of them is ever
     sent anywhere. Lesson titles only: nothing here names or links a file.
   - Keeps the phone awake (Screen Wake Lock) while open and visible. */

const V = new URL(import.meta.url).search; // the build stamp, carried to every module this loads
const SESSION_KEY = 'awanaSyncSession.v1';
const SESSION_RE = /^v1\.\d+\.\d+\.[A-Za-z0-9_-]{20,}$/;
const SYNC_INDEX = new URL('../../lobby/shared/sync.json', location.href).href;
const LESSONS_URL = new URL('../lessons.json', location.href).href;
const ANSWERS_URL = new URL('../slide-answers.json', location.href).href;
const ANSWERS_CACHE = 'journey-remote-v1';
const REQUEST_TIMEOUT_MS = 8000;
// A test may shorten these (read at each use).
const TUNING = { pollMs: 1500, afterPressMs: 450, renderMs: 500, failuresBeforeWarning: 2, pressAnswerMs: 5000 };
const tuning = () => Object.assign({}, TUNING, window.journeyRemoteTuning || {});

const $ = (id) => document.getElementById(id);
/* Writes only a change, so a screen reader is not told the same words again each poll. */
const setText = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private window: signed in for this visit only */ } },
};

let base = '';
let rules = null; // src/shared/journeyRemote.js
let logic = null; // ./logic.js
let state = null; // the last cleaned GET /v1/journey/remote/state
let stateAt = 0; // Date.now() when it arrived
let serverSkew = 0; // server clock minus this phone's
let failures = 0;
let pollTimer = null;
let renderTimer = null;
let lessons = [];
let answersFile = null;
let pendingPick = null;
let pendingPress = null; // this phone's latest press, until the screen names it: { action, id, at }
let slidesArmedAt = 0; // the first tap of a two-tap "Skip to teaching slides" (Date.now())
let slidesArmTimer = null;
let wakeLock = null;
let memorySession = '';

function session() {
  const s = (store.get(SESSION_KEY) || memorySession || '').trim();
  return SESSION_RE.test(s) ? s : '';
}

function request(path, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.session) headers.Authorization = `Bearer ${opts.session}`;
  return fetch(base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: 'no-store',
    signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
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
    const { res } = await sp.signInWithPassphrase({ request, derive: cc.deriveAuthKey, passphrase: typed });
    const b = res.body || {};
    if (res.status === 401) {
      $('signin-note').textContent = `That is not the passphrase.${typeof b.triesLeft === 'number' ? ` ${b.triesLeft} tries left before a 15-minute wait.` : ''}`;
      return;
    }
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
  showSignedOut('Signed out. Type the passphrase to use the remote again.');
}

/* ── The state poll ── */

function startPolling() {
  stopPolling();
  poll();
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

function scheduleNextPoll(ms) {
  clearTimeout(pollTimer);
  if (document.hidden || !session()) return;
  pollTimer = setTimeout(poll, ms);
}

async function poll() {
  pollTimer = null;
  const s = session();
  if (!s || !base) return;
  const res = await request('/v1/journey/remote/state', { session: s });
  if (res.status === 401) {
    store.set(SESSION_KEY, null);
    memorySession = '';
    showSignedOut('This phone was signed out (the passphrase may have changed). Type the passphrase again.');
    return;
  }
  if (res.ok && res.body && Array.isArray(res.body.kiosks)) {
    failures = 0;
    state = cleanState(res.body);
    stateAt = Date.now();
    const server = Date.parse(res.body.serverNow || '');
    serverSkew = Number.isFinite(server) ? server - stateAt : 0;
    setConn('ok', 'Connected');
  } else {
    failures += 1;
  }
  render();
  scheduleNextPoll(tuning().pollMs);
}

/* Nothing the Worker returns is trusted: the same rules it applies. */
function cleanState(body) {
  const kiosks = body.kiosks.slice(0, 40).map((k) => ({
    id: typeof k.id === 'string' ? k.id.slice(0, 64) : '',
    name: typeof k.name === 'string' ? k.name.slice(0, 40) : 'Journey screen',
    online: k.online === true,
    now: rules.sanitizeJourneyNow(k.now),
  })).map((k) => (k.now && typeof k.now === 'object' ? k : { ...k, now: null }));
  // The report's `at` is the service's receipt time (sanitizeJourneyNow keeps it).
  const online = Number.isInteger(body.online) ? Math.max(0, Math.min(99, body.online)) : kiosks.filter((k) => k.online).length;
  return { kiosks, online };
}

/* ── Drawing ── */

function serverNowMs() {
  return Date.now() + serverSkew;
}

function render() {
  clearTimeout(renderTimer);
  renderTimer = null;
  if (!state || !logic) {
    if (failures >= tuning().failuresBeforeWarning) showProblem();
    return;
  }
  const kiosk = logic.pickKiosk(state.kiosks);
  const now = kiosk && kiosk.now;
  $('online').textContent = String(state.online);
  showProblem();

  const d = logic.describeNow(kiosk, { serverNowMs: serverNowMs() });
  // No fresh answer: what is shown is the last thing heard, and it says so.
  const stale = failures >= tuning().failuresBeforeWarning || (typeof navigator.onLine === 'boolean' && !navigator.onLine);
  $('now').classList.toggle('is-stale', stale);
  setText($('now-kicker'), stale ? 'Last heard from the screen · not live' : d.kicker);
  setText($('now-main'), d.main);
  setText($('now-sub'), d.sub);
  setText($('now-detail'), d.detail);
  const mode = logic.layoutMode(now);
  if ($('remote').dataset.mode !== mode) $('remote').dataset.mode = mode;

  const wait = now && now.wait ? logic.WAIT_WORDS[now.wait] : '';
  $('now-wait').hidden = !wait;
  setText($('now-wait'), wait || '');
  renderPressStatus(now);

  // Begin: only on the lesson's start screen, big and hot (anywhere else the screen skips it).
  $('btn-begin').hidden = !(now && now.view === 'splash');
  setText($('btn-begin'), logic.beginWords(now));

  // Slide buttons: Next reads Finish on the last slide (the kiosk's own word).
  const onSlides = now && now.view === 'slides' && now.slide;
  // Not on the slides: the pad steps back (still pressable; the screen says why it skipped).
  $('slide-pad').classList.toggle('is-quiet', !onSlides);
  setText($('next-label'), onSlides && now.slide.n === now.slide.of ? 'Finish' : 'Next');
  renderSlidesButton(now);

  // Video buttons follow the video.
  const v = now && now.view === 'video' ? now.video : null;
  setText($('btn-play'), v ? (v.paused ? 'Play' : 'Pause') : 'Play / Pause');
  $('btn-play').dataset.action = v ? (v.paused ? 'play' : 'pause') : 'toggle-pause';
  setText($('btn-mute'), v && v.muted ? 'Unmute' : 'Mute');
  $('btn-mute').dataset.action = v && v.muted ? 'unmute' : 'mute';
  // Muted in the room is easy to miss: Unmute is then the hot button.
  $('btn-mute').classList.toggle('btn-hot', Boolean(v && v.muted));
  const vol = logic.volumeView(v);
  setText($('vol-level'), vol.text);
  $('btn-vol-down').disabled = !vol.down;
  $('btn-vol-up').disabled = !vol.up;

  renderLinesAndAnswers(now);
  renderScreens();
  // A closed picker follows the screens, so it opens on their lesson.
  if (!$('picker').open && lessons.length && now && String(now.week) !== $('week').value) preselectWeek();
  if (v && !v.paused && !document.hidden) renderTimer = setTimeout(render, tuning().renderMs);
}

/* The line under the buttons: this phone's own press while it is on its way
   (sending, sent, no answer), then how the screen says it went. */
function renderPressStatus(now) {
  if (pendingPress && pendingPress.id && now && now.last && now.last.id === pendingPress.id) pendingPress = null;
  const mine = logic.pressWords(pendingPress, now, Date.now(), tuning().pressAnswerMs);
  const el = $('now-last');
  const text = mine ? mine.text : logic.lastWords(now);
  el.hidden = !text;
  setText(el, text);
  const ok = mine ? (mine.ok === null ? 'wait' : 'false') : String(Boolean(now && now.last && now.last.ok));
  if (el.dataset.ok !== ok) el.dataset.ok = ok;
}

/* "Start teaching slides": hidden on the slides; over a running lesson it
   reads "Skip to teaching slides" and its first tap only asks for a second. */
function renderSlidesButton(now) {
  const b = logic.slidesButton(now);
  const button = $('btn-slides');
  button.hidden = b.hidden;
  const armed = b.confirm && slidesArmedAt && Date.now() - slidesArmedAt < logic.SLIDES_CONFIRM_MS;
  if (!armed) slidesArmedAt = 0;
  button.classList.toggle('is-armed', Boolean(armed));
  setText(button, armed ? logic.SLIDES_CONFIRM_WORDS : b.label);
}

function showProblem() {
  const el = $('problem');
  let text = '';
  if (typeof navigator.onLine === 'boolean' && !navigator.onLine) text = 'This phone has no internet. Reconnecting…';
  else if (failures >= tuning().failuresBeforeWarning) text = 'Cannot reach the Journey screens’ service. Reconnecting…';
  else if (state && !state.kiosks.length) text = 'No Journey screen has signed in yet. Sign one in with the passphrase (its Settings → Sync).';
  else if (state && state.online === 0) text = 'No Journey screen is online right now. Presses wait 20 seconds for one.';
  el.hidden = !text;
  el.textContent = text;
  if (failures >= tuning().failuresBeforeWarning || (typeof navigator.onLine === 'boolean' && !navigator.onLine)) setConn('bad', 'Reconnecting…');
}

function renderLinesAndAnswers(now) {
  const found = logic.answersFor(answersFile, now);
  const lines = now && now.view === 'slides' && now.slide && now.slide.lines.length ? now.slide.lines : [];
  // The lines on the wall (below the buttons, so Back / Next never move): shown unless the answers list shows them already.
  const list = $('now-lines');
  const showLines = lines.length && !(found && found.items);
  $('lines').hidden = !showLines;
  const linesKey = showLines ? JSON.stringify(lines) : '';
  if (list.dataset.key !== linesKey) {
    list.dataset.key = linesKey;
    list.replaceChildren(...(showLines ? lines.map((l) => { const li = document.createElement('li'); li.textContent = l; return li; }) : []));
  }

  const box = $('answers');
  box.hidden = !found;
  if (!found) return;
  $('answers-edited').hidden = !found.edited;
  const ol = $('answers-list');
  const key = found.items ? JSON.stringify(found.items.map((a) => a.q)) : '';
  if (ol.dataset.key === key) return; // the same questions: keep what is open
  ol.dataset.key = key;
  ol.replaceChildren(...(found.items || []).map((a) => {
    const li = document.createElement('li');
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = a.q;
    const answer = document.createElement('p');
    answer.className = 'answer';
    answer.textContent = a.answer;
    details.append(summary, answer);
    if (a.scripture) {
      const look = document.createElement('p');
      look.className = 'look';
      const b = document.createElement('b');
      b.textContent = 'Look at: ';
      look.append(b, a.scripture);
      details.append(look);
    }
    if (Number.isInteger(a.at)) {
      // A hint for the leader only: it does nothing to the room.
      const when = document.createElement('p');
      when.className = 'when';
      when.textContent = `Video says this at ${logic.formatTime(a.at)}`;
      details.append(when);
    }
    li.append(details);
    return li;
  }));
}

function renderScreens() {
  const many = state.kiosks.length > 1;
  $('screens').hidden = !many;
  if (!many) return;
  $('screens-count').textContent = String(state.kiosks.length);
  const opts = { serverNowMs: serverNowMs() };
  $('screens-list').replaceChildren(...state.kiosks.map((k) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = k.name;
    const s = document.createElement('span');
    s.textContent = logic.kioskLine(k, opts);
    if (!k.online) s.className = 'off';
    li.append(b, s);
    return li;
  }));
}

/* ── Presses ── */

function flash(button) {
  if (!button) return;
  button.classList.add('is-pressed');
  setTimeout(() => button.classList.remove('is-pressed'), 120);
  try { if (navigator.vibrate) navigator.vibrate(10); } catch { /* no haptics here */ }
}

async function press(action, data, button) {
  flash(button);
  const s = session();
  if (!s) { showSignedOut('Type the passphrase to use the remote.'); return; }
  // Said at once under the buttons: on its way, then how the screen took it.
  const mine = { action, id: null, at: Date.now() };
  pendingPress = mine;
  renderPressNow();
  const res = await request('/v1/journey/remote', { method: 'POST', body: data === undefined ? { action } : { action, data }, session: s });
  if (res.status === 401) { signOut(); return; }
  if (pendingPress === mine) {
    if (res.ok && res.body && typeof res.body.id === 'string') {
      mine.id = res.body.id;
      mine.at = Date.now();
    } else {
      pendingPress = null;
    }
    renderPressNow();
  }
  const note = $('now-last');
  if (!res.ok) {
    note.hidden = false;
    note.dataset.ok = 'false';
    note.textContent = res.status === 429 ? 'Too many presses at once. Wait a moment.'
      : res.status === 0 ? 'Not sent: this phone has no connection. Press again.'
        : (res.body && res.body.error) || 'Not sent.';
  }
  // The screens act within about a second: look again sooner than usual.
  scheduleNextPoll(tuning().afterPressMs);
}

function renderPressNow() {
  const kiosk = state && logic && logic.pickKiosk(state.kiosks);
  renderPressStatus(kiosk ? kiosk.now : null);
}

function onPadClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !rules) return;
  const action = button.dataset.action;
  if (action === 'slides-start') {
    const kiosk = state && logic.pickKiosk(state.kiosks);
    const now = kiosk ? kiosk.now : null;
    // Over a running lesson this ends the video: the first tap only asks for a second.
    if (logic.slidesButton(now).confirm && !(slidesArmedAt && Date.now() - slidesArmedAt < logic.SLIDES_CONFIRM_MS)) {
      slidesArmedAt = Date.now();
      flash(button);
      renderSlidesButton(now);
      clearTimeout(slidesArmTimer);
      slidesArmTimer = setTimeout(() => { const k = state && logic.pickKiosk(state.kiosks); renderSlidesButton(k ? k.now : null); }, logic.SLIDES_CONFIRM_MS + 50);
      return;
    }
    slidesArmedAt = 0;
    clearTimeout(slidesArmTimer);
    press(action, undefined, button);
    renderSlidesButton(now);
    return;
  }
  if (action === 'seek') { press('seek', { by: Number(button.dataset.by) }, button); return; }
  if (action === 'volume') { press('volume', { step: Number(button.dataset.step) }, button); return; }
  press(action, undefined, button);
}

/* ── The lesson picker ── */

async function loadLessons() {
  try {
    const res = await fetch(LESSONS_URL, { signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
    const data = res.ok ? await res.json() : null;
    lessons = data && Array.isArray(data.lessons)
      ? data.lessons.filter((l) => l && Number.isInteger(l.week) && typeof l.title === 'string')
        .map((l) => ({ week: l.week, title: l.title.slice(0, 80), leader: Boolean(l.leaderDownloadUrl) }))
      : [];
  } catch {
    lessons = [];
  }
  const select = $('week');
  select.replaceChildren(...lessons.map((l) => {
    const o = document.createElement('option');
    o.value = String(l.week);
    o.textContent = `Week ${l.week}: ${l.title}`;
    return o;
  }));
  if (!lessons.length) $('picker-note').textContent = 'The lesson list could not load. Close this and open it again.';
  preselectWeek();
}

/* The picker opens on the lesson the screens show (whichever loads last: the list or the state). */
function preselectWeek() {
  const kiosk = state && logic.pickKiosk(state.kiosks);
  const week = kiosk && kiosk.now && Number.isInteger(kiosk.now.week) && lessons.some((l) => l.week === kiosk.now.week) ? String(kiosk.now.week) : null;
  if (week) $('week').value = week;
  renderChoices();
}

function selectedLesson() {
  const week = Number($('week').value);
  return lessons.find((l) => l.week === week) || null;
}

function renderChoices() {
  const lesson = selectedLesson();
  $('choices').replaceChildren(...logic.CHOICES.map((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = c.label;
    b.dataset.choice = c.choice;
    b.disabled = !lesson || (c.leader && !lesson.leader);
    if (c.leader && lesson && !lesson.leader) b.title = 'This week has no Leader Video';
    return b;
  }));
  $('confirm').hidden = true;
  pendingPick = null;
}

function onChoice(event) {
  const b = event.target.closest('button[data-choice]');
  if (!b || b.disabled) return;
  const lesson = selectedLesson();
  if (!lesson) return;
  const kiosk = state && logic.pickKiosk(state.kiosks);
  const label = logic.CHOICES.find((c) => c.choice === b.dataset.choice).label;
  pendingPick = { week: lesson.week, choice: b.dataset.choice };
  if (logic.needsConfirm(kiosk && kiosk.now)) {
    flash(b);
    $('confirm-text').textContent = `A lesson is on the screens now. Replace it with Week ${lesson.week}, ${label}, on every Journey screen?`;
    $('confirm').hidden = false;
    $('confirm-yes').focus();
    return;
  }
  sendPick(false, b, label);
}

function sendPick(force, button, label) {
  if (!pendingPick) return;
  const data = force ? { ...pendingPick, force: true } : pendingPick;
  $('confirm').hidden = true;
  $('picker-note').textContent = `Sent: Week ${data.week}, ${label || 'lesson'}.`;
  pendingPick = null;
  press('pick', data, button);
}

/* ── Sample answers (this phone only) ── */

async function loadAnswers() {
  let cache = null;
  try { cache = 'caches' in window ? await caches.open(ANSWERS_CACHE) : null; } catch { cache = null; }
  if (cache) {
    try {
      const hit = await cache.match(ANSWERS_URL);
      if (hit) { answersFile = logic.cleanAnswersFile(await hit.json()); render(); }
    } catch { /* fall through to the network */ }
  }
  try {
    const res = await fetch(ANSWERS_URL, { cache: 'no-cache', signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
    if (res.status === 404) {
      // Not published (yet): no answers section at all.
      answersFile = null;
      if (cache) cache.delete(ANSWERS_URL).catch(() => {});
    } else if (res.ok) {
      const text = await res.text();
      const clean = logic.cleanAnswersFile(JSON.parse(text));
      if (clean) {
        answersFile = clean;
        if (cache) cache.put(ANSWERS_URL, new Response(text, { headers: { 'content-type': 'application/json' } })).catch(() => {});
      }
    }
  } catch { /* offline: the cached copy, if any, stays */ }
  render();
}

/* ── Stay awake ── */

async function holdWake() {
  if (wakeLock || document.hidden || !session()) return;
  try {
    if (navigator.wakeLock && navigator.wakeLock.request) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; /* low battery or not allowed: the phone may dim */ }
}

function releaseWake() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

/* ── Start ── */

async function start() {
  [rules, logic] = await Promise.all([import(`../src/shared/journeyRemote.js${V}`), import(`./logic.js${V}`)]);
  $('signin-form').addEventListener('submit', signIn);
  $('signout').addEventListener('click', signOut);
  for (const id of ['btn-begin', 'btn-prev', 'btn-next', 'btn-slides']) $(id).addEventListener('click', onPadClick);
  document.querySelector('.video').addEventListener('click', onPadClick);
  $('week').addEventListener('change', renderChoices);
  $('choices').addEventListener('click', onChoice);
  $('confirm-yes').addEventListener('click', (e) => sendPick(true, e.currentTarget, logic.CHOICES.find((c) => pendingPick && c.choice === pendingPick.choice)?.label));
  $('confirm-no').addEventListener('click', () => { $('confirm').hidden = true; pendingPick = null; $('picker-note').textContent = 'Kept what is on the screens.'; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopPolling(); clearTimeout(renderTimer); return; }
    if (session()) { startPolling(); holdWake(); }
  });
  window.addEventListener('online', () => { if (session()) startPolling(); });
  window.addEventListener('offline', render);
  window.addEventListener('storage', (e) => {
    if (e.key !== SESSION_KEY && e.key !== null) return;
    if (session()) showSignedIn(); else showSignedOut('Signed out on this phone.');
  });

  try {
    const res = await fetch(SYNC_INDEX, { cache: 'no-store', signal: AbortSignal.timeout ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined });
    const d = res.ok ? await res.json() : null;
    const url = d && typeof d.url === 'string' ? d.url.trim().replace(/\/+$/, '') : '';
    if (/^https:\/\/[^\s?#]+$/.test(url)) base = url;
  } catch { /* no service named: the sign-in says so */ }

  loadLessons();
  loadAnswers();
  if (session() && base) showSignedIn();
  else showSignedOut(base ? '' : 'The sync service is not reachable right now. Reload in a minute.');
}

start();
