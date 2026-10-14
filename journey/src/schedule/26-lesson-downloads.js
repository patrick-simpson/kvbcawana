/* ── Settings: "Download all lessons (full quality)" ─────────────────────
   Owner 2026-10-12: the church's internet at the kiosk is slow, so every
   lesson's ORIGINAL video can be saved onto the kiosk PC ahead of time; a
   saved lesson then plays from the disk (05-stream-first.js). Storage and
   playback: 04-lesson-store.js. This file is the downloader and its panel.

   - One video at a time, Student Videos first (from this week on, then the
     earlier weeks), then Leader Videos (a tick box, on by default).
   - fetch() streaming, so every percentage is real bytes: Content-Length /
     Content-Range from the server, bytes counted as they arrive.
   - Resumable: each finished 16 MiB piece is on disk for good; an interrupted
     video carries on from the next piece with `Range: bytes=N-` (a
     CORS-safelisted header: no preflight, which CloudFront would refuse).
     A video already saved is skipped. A reload or a restart of the PC
     carries on by itself (journey.downloads.run = 'running').
   - One failing video never stops the rest: it is tried 3 more times
     (10 s, 30 s, 1 min), then left with a plain reason, and pressing
     Download again retries it. Only "no disk space" stops the run.
   - Gives way to the room: while a lesson video plays from the internet the
     download waits (it would slow the lesson down), and carries on after.
   - Fetches nothing but lessons.json's cdnUrl / leaderCdnUrl video files
     (scripts/resolve-lesson-files.mjs). Licensing: kiosk-only caching for
     this kiosk's own playback (CLAUDE.md "licensing").
   - Configure mode (the app's Settings window) never downloads: the kiosk's
     own Settings does.
   - AUTOMATIC (owner 2026-10-12, Settings "Download lessons automatically",
     journey.downloads.auto; on by default in the KVBC Awana app, off by
     default in a plain browser, see inKioskApp()): a kiosk starts by itself a few
     minutes after the page loads, re-checks every poll (15 s) and on
     'online', and a finished pass looks again every 30 min (new lessons in
     lessons.json are picked up then). An automatic run holds while a lesson
     is on (video, intro, slides, caption question, the Trek card, a handout
     or Read Prep) and through the quiet hours around the evening
     (downloadQuietTime(): an hour before the 6:30 lesson to half an hour
     after Trek's 7:30 end, i.e. 5:30-8 PM, from the schedule constants), so
     the slow internet is free for check-in and the lesson. The button works
     any time (it only gives way to a video playing from the internet). A
     user's Pause holds automatic mode until Resume; Stop holds it until the
     page next loads.
   - Status for reporting: window.journeyDownloadStatus() and a
     'journey-download-status' CustomEvent on window when it changes (about
     once a second while downloading, at once on a saved video or an error).
   Timing is DOWNLOAD_TUNING; a test may override any of it through
   window.journeyDownloadTuning (read at each use). */
const DOWNLOADS_RUN_KEY = 'journey.downloads.run'; // 'running' | 'paused'
const DOWNLOADS_LEADERS_KEY = 'journey.downloads.leaders'; // '1' | '0'
const DOWNLOADS_AUTO_KEY = 'journey.downloads.auto'; // '1' | '0' (missing = on)
// The quiet hours, from the schedule itself: an hour before the 6:30 lesson
// to half an hour after Trek's small group time ends (5:30-8 PM).
const DOWNLOAD_QUIET_START_MINUTES = JOURNEY_START_MINUTES - 60;
const DOWNLOAD_QUIET_END_MINUTES = TREK_END_MINUTES + 30;
const DOWNLOAD_TUNING = {
  chunkBytes: LESSON_CHUNK_BYTES,
  retryMs: [10000, 30000, 60000],
  stallMs: 60000, // no byte for this long: the connection is dead, try again
  resumeAfterLoadMs: 30000, // a reload or reboot carries on after this
  yieldPollMs: 5000,
  renderMs: 400,
  rateWindowMs: 30000,
  spaceMarginBytes: 256 * 1024 * 1024,
  autoStartMs: 3 * 60 * 1000, // after page load, not in the boot rush
  autoRecheckMs: 30 * 60 * 1000, // after a finished (or failed) automatic pass
  autoTickMs: POLL_INTERVAL_MS,
  statusMs: 1000, // status events while downloading
};
function downloadTuning() {
  const override = window.journeyDownloadTuning;
  return override && typeof override === 'object' ? { ...DOWNLOAD_TUNING, ...override } : DOWNLOAD_TUNING;
}

const downloadsSection = document.getElementById('settings-downloads');
const downloadsLeadersInput = document.getElementById('downloads-leaders');
const downloadsAutoInput = document.getElementById('downloads-auto');
const downloadsStartBtn = document.getElementById('downloads-start-btn');
const downloadsPauseBtn = document.getElementById('downloads-pause-btn');
const downloadsResumeBtn = document.getElementById('downloads-resume-btn');
const downloadsStopBtn = document.getElementById('downloads-stop-btn');
const downloadsSummary = document.getElementById('downloads-summary');
const downloadsBar = document.getElementById('downloads-bar');
const downloadsBarFill = document.getElementById('downloads-bar-fill');
const downloadsStatus = document.getElementById('downloads-status');
const downloadsSpace = document.getElementById('downloads-space');
const downloadsList = document.getElementById('downloads-list');
const downloadsDeleteBtn = document.getElementById('downloads-delete-btn');
const downloadsConfirm = document.getElementById('downloads-confirm');
const downloadsConfirmText = document.getElementById('downloads-confirm-text');
const downloadsConfirmYes = document.getElementById('downloads-confirm-yes');
const downloadsConfirmNo = document.getElementById('downloads-confirm-no');

/* ── Pure pieces (unit-tested through window) ── */

const BINARY_GB = 1024 * 1024 * 1024;
const BINARY_MB = 1024 * 1024;

/* "1.2 GB" / "350 MB" (binary units, the way Windows shows disk sizes). */
function formatBytes(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= BINARY_GB) return `${(v / BINARY_GB).toFixed(1)} GB`;
  return `${Math.round(v / BINARY_MB)} MB`;
}

/* "3.1 of 7.4 GB": both in the unit of the larger. */
function formatBytePair(done, total) {
  const t = Math.max(0, Number(total) || 0);
  const d = Math.min(Math.max(0, Number(done) || 0), t);
  if (t >= BINARY_GB) return `${(d / BINARY_GB).toFixed(1)} of ${(t / BINARY_GB).toFixed(1)} GB`;
  return `${Math.round(d / BINARY_MB)} of ${Math.round(t / BINARY_MB)} MB`;
}

/* "about 25 min left", "about 2 h 10 min left", "less than a minute left". */
function formatTimeLeft(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return 'less than a minute left';
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return m ? `about ${h} h ${m} min left` : `about ${h} h left`;
}

/* Pure: is `date` (kiosk local time) inside the quiet hours, when an
   automatic download never runs? */
function downloadQuietTime(date) {
  const minutes = date.getHours() * 60 + date.getMinutes();
  return minutes >= DOWNLOAD_QUIET_START_MINUTES && minutes < DOWNLOAD_QUIET_END_MINUTES;
}

function clockText(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* Why a download must wait right now, in plain words, or null. Every run
   gives way to a video playing from the internet; an automatic run also to
   anything of the lesson on screen and to the quiet hours. Pure apart from
   the page state it is handed. */
function downloadHoldReason({ auto, videoFromInternet, lessonOnScreen, quiet }) {
  if (videoFromInternet) return 'a lesson video is playing from the internet';
  if (!auto) return null;
  if (lessonOnScreen) return 'a lesson is on screen';
  if (quiet) {
    return `it is lesson time (${clockText(DOWNLOAD_QUIET_START_MINUTES)} to ${clockText(DOWNLOAD_QUIET_END_MINUTES)}), when the internet is kept free for check-in and the lesson`;
  }
  return null;
}

function downloadLabel(item) {
  return `Week ${item.week} · ${item.role === 'leader' ? 'Leader' : 'Student'}`;
}

/* What to download, in order: Student Videos from `startWeek` on, then the
   weeks before it, then (with `leaders`) the Leader Videos in the same order.
   An item with no downloadable address keeps `url: null` (shown as such,
   never fetched, left out of the totals). */
function downloadPlan(lessons, { leaders = true, startWeek = 1 } = {}) {
  const sorted = (Array.isArray(lessons) ? lessons : [])
    .filter((l) => l && Number.isInteger(l.week))
    .slice()
    .sort((a, b) => a.week - b.week);
  const at = sorted.findIndex((l) => l.week >= startWeek);
  const ordered = at > 0 ? [...sorted.slice(at), ...sorted.slice(0, at)] : sorted;
  const items = [];
  for (const role of leaders ? ['student', 'leader'] : ['student']) {
    for (const lesson of ordered) {
      if (role === 'leader' && !lesson.leaderDownloadUrl) continue; // week 27
      const source = lessonFileSource(lesson, role);
      items.push({
        id: lessonFileId(lesson.week, role),
        week: lesson.week,
        role,
        url: source ? source.url : null,
        bytes: source ? source.bytes : null,
      });
    }
  }
  return items;
}

/* The overall numbers for the summary line. `files`: id -> { state, have,
   total } as on disk / arriving. Saved videos count as done; a partly saved
   one counts its bytes. `position` is the video being worked on, counted as
   "the n-th of the set" (saved ones first), so it reads like the owner's
   "Lesson 7 of 30". Percent is floored, so 100% means every byte is here. */
function downloadProgress(items, files, active) {
  const usable = (items || []).filter((i) => i.url);
  let done = 0;
  let total = 0;
  let saved = 0;
  let unknown = 0;
  for (const item of usable) {
    const f = (files && files[item.id]) || {};
    const size = f.total || item.bytes || 0;
    if (!size) unknown += 1;
    total += size;
    done += Math.min(f.have || 0, size);
    if (f.state === 'saved') saved += 1;
  }
  const count = usable.length;
  const lessons = new Set(usable.map((i) => i.week)).size;
  const percent = total > 0 ? (saved === count ? 100 : Math.min(99, Math.floor((done * 100) / total))) : 0;
  return {
    count,
    lessons,
    saved,
    done,
    total,
    unknown,
    percent,
    position: active ? Math.min(saved + 1, count) : 0,
  };
}

/* Bytes per second over the last `windowMs` of samples [{ t, bytes }]
   (bytes = running total received this session); null until there are at
   least 5 seconds of them. */
function downloadRate(samples, now, windowMs) {
  const recent = (samples || []).filter((s) => now - s.t <= windowMs);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const span = (last.t - first.t) / 1000;
  if (span < 5) return null;
  return (last.bytes - first.bytes) / span;
}

/* The one line under the buttons, in plain words. */
function downloadSummaryText(progress, phase, rate) {
  const pair = formatBytePair(progress.done, progress.total);
  if (!progress.count) return 'No lesson videos can be downloaded from here.';
  if (phase === 'running' || phase === 'waiting') {
    const left = progress.total - progress.done;
    const eta = rate && rate > 0 ? formatTimeLeft(left / rate) : 'working out the time left';
    return `Video ${progress.position} of ${progress.count} · ${progress.percent}% · ${pair} · ${eta}`;
  }
  if (progress.saved === progress.count) {
    const lessons = progress.lessons || progress.count;
    return `All ${lessons} lessons saved ✓ (${progress.count} videos, ${formatBytes(progress.total)}, on this computer)`;
  }
  if (phase === 'paused') return `Paused · ${progress.percent}% · ${pair} saved`;
  if (!progress.done) return `Nothing saved yet · ${progress.count} videos, ${formatBytes(progress.total)} in all`;
  return `${progress.saved} of ${progress.count} videos saved · ${progress.percent}% · ${pair}`;
}

/* "bytes 100-199/1000" -> { start: 100, end: 199, total: 1000 }, else null. */
function parseContentRange(value) {
  const m = /^\s*bytes\s+(\d+)-(\d+)\/(\d+)\s*$/i.exec(value || '');
  if (!m) return null;
  const range = { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) };
  return range.end >= range.start && range.total > range.end ? range : null;
}

/* What a failed download says, plainly. */
function plainDownloadError(err) {
  if (err && err.plain) return err.plain;
  if (err && err.name === 'QuotaExceededError') return 'this computer ran out of space for it';
  if (navigator.onLine === false) return 'there is no internet connection right now';
  return 'the internet connection dropped or Awana’s server did not answer';
}

function downloadError(plain, extra = {}) {
  const err = new Error(plain);
  err.plain = plain;
  return Object.assign(err, extra);
}

/* ── State ── */

const dl = {
  phase: 'idle', // idle | running | waiting | paused
  runId: 0,
  items: [],
  files: {}, // id -> { state, have, total }
  errors: {}, // id -> plain reason (failed this run)
  activeId: null,
  controller: null,
  abortWhy: null, // 'pause' | 'stall' | 'yield' while aborting on purpose
  samples: [],
  received: 0,
  note: '',
  tone: '',
  space: null, // { free, usage, quota, persisted }
  loop: null, // the running loop's promise
  renderTimer: null,
  rowsKey: '',
  auto: false, // the running (or last) run was automatic
  hold: null, // why the run is waiting, in plain words
  autoHeld: false, // Stop pressed: automatic mode rests until the page loads again
  nextAutoAt: 0, // no automatic pass before this (ms)
  loadedAt: Date.now(),
  inspected: false,
  lastSavedAt: null,
  lastError: null,
  statusTimer: null,
  statusSentAt: 0,
};

function downloadsLeadersWanted() {
  try {
    return localStorage.getItem(DOWNLOADS_LEADERS_KEY) !== '0';
  } catch {
    return true;
  }
}

/* Is this page running in the KVBC Awana app (Electron: the kiosk)? Only
   there is automatic downloading on by default: the same URL opens on a
   leader's Mac or phone, which must never start 8 GB by itself. */
function inKioskApp() {
  return /\bElectron\//.test(navigator.userAgent || '');
}

function downloadsAutoWanted() {
  try {
    const stored = localStorage.getItem(DOWNLOADS_AUTO_KEY);
    if (stored === '1' || stored === '0') return stored === '1';
  } catch { /* storage off: the default */ }
  return inKioskApp();
}

function setDownloadsRunMark(value) {
  try {
    if (value) localStorage.setItem(DOWNLOADS_RUN_KEY, value);
    else localStorage.removeItem(DOWNLOADS_RUN_KEY);
  } catch { /* storage off: a reload simply will not carry on by itself */ }
}

function downloadsRunMark() {
  try {
    return localStorage.getItem(DOWNLOADS_RUN_KEY);
  } catch {
    return null;
  }
}

function downloadsActive() {
  return dl.phase === 'running' || dl.phase === 'waiting';
}

function setDownloadsNote(text, tone = '') {
  dl.note = text;
  dl.tone = tone;
  scheduleDownloadsRender();
}

function planDownloads() {
  dl.items = downloadPlan(allLessons, {
    leaders: downloadsLeadersWanted(),
    startWeek: currentLesson && Number.isInteger(currentLesson.week) ? currentLesson.week : 1,
  });
}

/* Read what is on disk for every planned video. */
async function inspectDownloads() {
  const files = {};
  for (const item of dl.items) {
    if (!item.url) continue;
    if (downloadsActive() && item.id === dl.activeId && dl.files[item.id]) {
      files[item.id] = dl.files[item.id]; // arriving right now: keep the live count
      continue;
    }
    try {
      // A copy of a file Awana has since replaced is not counted as saved, so
      // the run below downloads it again (downloadOneLesson starts it over).
      const f = await inspectLessonFile(item.id, item);
      files[item.id] = { state: f.state, have: f.have, total: f.total || item.bytes || 0 };
      const at = f.state === 'saved' && f.info && f.info.savedAt;
      if (at && (!dl.lastSavedAt || at > dl.lastSavedAt)) dl.lastSavedAt = at;
    } catch {
      files[item.id] = { state: 'none', have: 0, total: item.bytes || 0 };
    }
  }
  dl.files = files;
  dl.inspected = true;
  emitDownloadStatus(true);
}

async function readStorageSpace() {
  try {
    if (!navigator.storage || typeof navigator.storage.estimate !== 'function') return null;
    const { usage, quota } = await navigator.storage.estimate();
    let persisted = null;
    if (typeof navigator.storage.persisted === 'function') {
      try { persisted = await navigator.storage.persisted(); } catch { persisted = null; }
    }
    if (!Number.isFinite(quota)) return null;
    return { usage: usage || 0, quota, free: Math.max(0, quota - (usage || 0)), persisted };
  } catch {
    return null;
  }
}

/* The newest lessons.json (its cdnUrl/bytes), else whatever is loaded. */
async function lessonsForDownloads() {
  try {
    const data = await fetchLessonsJson();
    adoptLessonsData(data);
  } catch {
    await loadAllLessons();
  }
  return allLessons;
}

/* ── The download itself ── */

function videoUsesInternet() {
  const src = journeyVideo.getAttribute('src');
  return !!src && !src.startsWith('blob:') && !journeyVideo.classList.contains('hidden');
}

function noteReceived(bytes) {
  dl.received += bytes;
  const now = Date.now();
  const last = dl.samples[dl.samples.length - 1];
  if (!last || now - last.t >= 1000) {
    dl.samples.push({ t: now, bytes: dl.received });
    const keep = downloadTuning().rateWindowMs * 2;
    while (dl.samples.length > 2 && now - dl.samples[0].t > keep) dl.samples.shift();
  }
}

function sleepWhileRun(ms, runId) {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (runId !== dl.runId || Date.now() - started >= ms) return resolve();
      setTimeout(tick, Math.min(1000, ms));
    };
    setTimeout(tick, Math.min(1000, ms));
  });
}

function currentHoldReason(auto) {
  return downloadHoldReason({
    auto,
    videoFromInternet: videoUsesInternet(),
    lessonOnScreen:
      journeyLessonRunning() ||
      !trekView.classList.contains('hidden') ||
      readerOverlayOpen(),
    quiet: downloadQuietTime(new Date()),
  });
}

async function waitForDownloadTurn(runId) {
  for (;;) {
    const hold = runId === dl.runId ? currentHoldReason(dl.auto) : null;
    if (!hold) break;
    if (dl.phase !== 'waiting' || dl.hold !== hold) {
      dl.phase = 'waiting';
      dl.hold = hold;
      setDownloadsNote(`Waiting: ${hold}. Downloading carries on after it.`);
      emitDownloadStatus(true);
    }
    await sleepWhileRun(downloadTuning().yieldPollMs, runId);
  }
  if (runId === dl.runId && dl.phase === 'waiting') {
    dl.phase = 'running';
    dl.hold = null;
    setDownloadsNote('');
    emitDownloadStatus(true);
  }
}

async function clearLessonDir(dir) {
  const names = [];
  for await (const name of dir.keys()) names.push(name);
  for (const name of names) {
    try { await dir.removeEntry(name, { recursive: true }); } catch { /* next try overwrites it */ }
  }
}

/* Pour the response body into the video's pieces, from piece have/chunk on.
   Each piece is its own file, committed when it is full. */
async function streamIntoChunks(body, dir, info, have, controller, item) {
  const tuning = downloadTuning();
  const reader = body.getReader();
  const count = Math.ceil(info.bytes / info.chunk);
  let index = Math.floor(have / info.chunk);
  let received = have;
  let writable = null;
  let fill = 0;
  let expected = 0;
  let lastByteAt = Date.now();
  const watchdog = setInterval(() => {
    if (Date.now() - lastByteAt > tuning.stallMs) {
      dl.abortWhy = dl.abortWhy || 'stall';
      controller.abort();
    } else if (currentHoldReason(dl.auto)) {
      dl.abortWhy = dl.abortWhy || 'yield';
      controller.abort();
    }
  }, 1000);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastByteAt = Date.now();
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      let offset = 0;
      while (offset < bytes.byteLength && index < count) {
        if (!writable) {
          const handle = await dir.getFileHandle(lessonChunkName(index), { create: true });
          writable = await handle.createWritable();
          fill = 0;
          expected = Math.min(info.chunk, info.bytes - index * info.chunk);
        }
        const take = Math.min(bytes.byteLength - offset, expected - fill);
        await writable.write(bytes.subarray(offset, offset + take));
        offset += take;
        fill += take;
        received += take;
        noteReceived(take);
        if (fill === expected) {
          await writable.close();
          writable = null;
          index += 1;
        }
      }
      dl.files[item.id] = { state: 'partial', have: received, total: info.bytes };
      scheduleDownloadsRender();
      emitDownloadStatus(false);
      if (index >= count) {
        // Every byte is here; anything more the server sends is not ours.
        try { await reader.cancel(); } catch { /* already finished */ }
        break;
      }
    }
    if (writable) throw downloadError('the download ended early');
  } catch (err) {
    if (writable) {
      try { await writable.abort(); } catch { /* already closed */ }
    }
    throw err;
  } finally {
    clearInterval(watchdog);
    try { reader.releaseLock(); } catch { /* still reading: the abort ends it */ }
  }
}

/* One video, from wherever it got to. Throws on failure; resolves once every
   byte is on disk and the video is marked finished. */
async function downloadOneLesson(item, restarts = 0) {
  const tuning = downloadTuning();
  const dir = await lessonFileDir(item.id, true);
  if (!dir) throw downloadError('this computer’s storage could not be opened');
  let info = await readLessonInfo(dir);
  if (info && !savedCopyMatches(info, item)) {
    // Awana moved or replaced the file: start that video again.
    await clearLessonDir(dir);
    info = null;
  }
  let have = 0;
  if (info) {
    const files = await lessonChunkFiles(dir, info);
    have = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
    if (have === info.bytes) {
      if (!info.done) await writeLessonInfo(dir, { ...info, done: true, savedAt: new Date().toISOString() });
      dl.files[item.id] = { state: 'saved', have, total: info.bytes };
      return;
    }
  } else {
    await clearLessonDir(dir); // leftovers of an unreadable info.json
  }
  const size = (info && info.bytes) || item.bytes || 0;
  const space = await readStorageSpace();
  if (space && size && size - have > space.free - tuning.spaceMarginBytes) {
    throw downloadError(
      `not enough space on this computer (this video needs ${formatBytes(size - have)}, ${formatBytes(space.free)} is free for saved lessons)`,
      { noSpace: true }
    );
  }
  dl.files[item.id] = { state: have ? 'partial' : 'none', have, total: size };
  const controller = new AbortController();
  dl.controller = controller;
  dl.abortWhy = null;
  // cache:'no-store' keeps the GBs out of the browser's HTTP cache (they go
  // to the store only). Range: bytes=N- is CORS-safelisted: no preflight.
  const res = await fetch(item.url, {
    headers: have > 0 ? { Range: `bytes=${have}-` } : {},
    signal: controller.signal,
    cache: 'no-store',
    credentials: 'omit',
  });
  let total = 0;
  let start = 0;
  if (res.status === 206) {
    const range = parseContentRange(res.headers.get('content-range'));
    if (!range || range.start !== have) {
      try { await res.body.cancel(); } catch { /* fine */ }
      if (restarts >= 1) throw downloadError('Awana’s server sent the wrong part of the file');
      await clearLessonDir(dir);
      return downloadOneLesson(item, restarts + 1);
    }
    total = range.total;
    start = range.start;
  } else if (res.status === 200) {
    total = Number(res.headers.get('content-length')) || 0;
    start = 0;
  } else {
    try { await res.body.cancel(); } catch { /* fine */ }
    throw downloadError(
      res.status === 404 ? 'Awana’s server no longer has this video (404)' : `Awana’s server answered with an error (${res.status})`
    );
  }
  if (!(total > 0)) {
    try { await res.body.cancel(); } catch { /* fine */ }
    throw downloadError('Awana’s server did not say how big the video is');
  }
  const etag = res.headers.get('etag');
  const changed = info && (info.bytes !== total || (info.etag && etag && info.etag !== etag));
  if (changed || (info && start === 0 && have > 0)) {
    // The file changed on Awana's side, or the server ignored the Range and
    // sent it whole: start this video from the beginning.
    if (changed) {
      try { await res.body.cancel(); } catch { /* fine */ }
      if (restarts >= 1) throw downloadError('the video kept changing on Awana’s server');
      await clearLessonDir(dir);
      return downloadOneLesson(item, restarts + 1);
    }
    await clearLessonDir(dir);
    info = null;
    have = 0;
  }
  if (!info) {
    info = { v: 1, url: item.url, bytes: total, etag: etag || null, chunk: tuning.chunkBytes, done: false, startedAt: new Date().toISOString() };
    await writeLessonInfo(dir, info);
  }
  dl.files[item.id] = { state: 'partial', have, total };
  await streamIntoChunks(res.body, dir, info, have, controller, item);
  const files = await lessonChunkFiles(dir, info);
  const final = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
  if (final !== info.bytes) throw downloadError('the download ended early');
  const savedAt = new Date().toISOString();
  await writeLessonInfo(dir, { ...info, done: true, savedAt });
  dl.files[item.id] = { state: 'saved', have: final, total: final };
  dl.lastSavedAt = savedAt;
  emitDownloadStatus(true);
}

async function downloadWithRetries(item, runId) {
  const retries = downloadTuning().retryMs;
  let failures = 0;
  for (;;) {
    await waitForDownloadTurn(runId);
    if (runId !== dl.runId) return;
    dl.activeId = item.id;
    try {
      await downloadOneLesson(item);
      delete dl.errors[item.id];
      setDownloadsNote('');
      return;
    } catch (err) {
      const why = dl.abortWhy;
      dl.abortWhy = null;
      dl.controller = null;
      if (runId !== dl.runId) return; // paused or stopped: not a failure
      try {
        const f = await inspectLessonFile(item.id, item);
        dl.files[item.id] = { state: f.state, have: f.have, total: f.total || item.bytes || 0 };
      } catch { /* keep the last count */ }
      if (why === 'yield') continue; // a lesson started (or quiet hours): wait, then carry on
      if (err && err.noSpace) throw err;
      const reason = why === 'stall' ? 'the download stopped moving (the connection may have dropped)' : plainDownloadError(err);
      console.warn('Journey: could not download', item.id, err);
      dl.lastError = `${downloadLabel(item)}: ${reason}`;
      emitDownloadStatus(true);
      if (failures >= retries.length) {
        dl.errors[item.id] = reason;
        setDownloadsNote('');
        return;
      }
      const wait = retries[failures];
      failures += 1;
      setDownloadsNote(`${downloadLabel(item)}: ${reason}. Trying again in ${Math.max(1, Math.round(wait / 1000))} seconds.`, 'bad');
      await sleepWhileRun(wait, runId);
      if (runId !== dl.runId) return;
    } finally {
      if (dl.activeId === item.id) dl.activeId = null;
    }
  }
}

async function runDownloadLoop(runId) {
  await lessonsForDownloads();
  if (runId !== dl.runId) return;
  planDownloads();
  await inspectDownloads();
  dl.space = await readStorageSpace();
  if (runId !== dl.runId) return;
  const before = downloadProgress(dl.items, dl.files, false);
  const needed = before.total - before.done;
  if (dl.space && needed > dl.space.free - downloadTuning().spaceMarginBytes) {
    dl.phase = 'idle';
    setDownloadsRunMark(null);
    dl.lastError = `not enough disk space (${formatBytes(needed)} needed, ${formatBytes(dl.space.free)} free)`;
    setDownloadsNote(
      `Not enough space: the videos still to download need ${formatBytes(needed)}, and this computer has ${formatBytes(dl.space.free)} free for them. ` +
        (downloadsLeadersWanted() ? 'Untick Leader Videos, or free up disk space, then try again.' : 'Free up disk space, then try again.'),
      'bad'
    );
    return;
  }
  try {
    for (const item of dl.items) {
      if (runId !== dl.runId) return;
      if (!item.url) continue;
      if (dl.files[item.id] && dl.files[item.id].state === 'saved') continue;
      await downloadWithRetries(item, runId);
    }
  } catch (err) {
    if (runId !== dl.runId) return;
    dl.phase = 'idle';
    setDownloadsRunMark(null);
    dl.lastError = plainDownloadError(err);
    setDownloadsNote(`Stopped: ${plainDownloadError(err)}. Videos already saved stay saved.`, 'bad');
    return;
  }
  if (runId !== dl.runId) return;
  dl.phase = 'idle';
  setDownloadsRunMark(null);
  const failed = Object.keys(dl.errors).length;
  const after = downloadProgress(dl.items, dl.files, false);
  if (!failed) dl.lastError = null;
  if (failed) {
    setDownloadsNote(
      `Finished, except ${failed} ${failed === 1 ? 'video' : 'videos'} that could not be downloaded (listed below). ` +
        'Press "Download all lessons" again later to retry them; the rest are saved.',
      'bad'
    );
  } else if (after.saved === after.count) {
    setDownloadsNote(dl.auto ? '' : 'Done. Every lesson now plays from this computer.', 'ok');
  } else {
    setDownloadsNote('');
  }
}

/* Start (or resume) downloading. `auto`: carrying on by itself after a
   reload; a press also asks the browser to keep the files (persist). */
async function startLessonDownloads(auto = false, carryOn = false) {
  if (CONFIGURE_MODE || !lessonStoreSupported() || downloadsActive()) return;
  const runId = ++dl.runId;
  dl.auto = !!auto;
  dl.hold = null;
  if (!auto) dl.autoHeld = false;
  dl.phase = 'running';
  dl.errors = {};
  dl.samples = [];
  dl.received = 0;
  setDownloadsRunMark('running');
  setDownloadsNote(carryOn ? 'Carrying on with the download.' : '');
  emitDownloadStatus(true);
  if (!auto && typeof navigator.storage.persist === 'function') {
    navigator.storage.persist().then(() => refreshDownloadsSpace(), () => {});
  }
  const previous = dl.loop;
  const run = async () => {
    try {
      await runDownloadLoop(runId);
    } catch (err) {
      if (runId === dl.runId) {
        dl.phase = 'idle';
        setDownloadsNote(`Stopped: ${plainDownloadError(err)}.`, 'bad');
      }
    }
  };
  const locked = async () => {
    // A paused run lets go of its file and its lock first.
    if (previous) await Promise.race([previous.catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
    if (runId !== dl.runId) return;
    if (navigator.locks && typeof navigator.locks.request === 'function') {
      // One downloader per computer, whatever windows are open on this site.
      return navigator.locks.request('journey-lesson-downloads', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          if (runId === dl.runId) {
            dl.phase = 'idle';
            setDownloadsNote('Another Journey window on this computer is already downloading.', 'bad');
          }
          return;
        }
        await run();
      });
    }
    return run();
  };
  dl.loop = locked().finally(() => {
    if (runId === dl.runId && downloadsActive()) dl.phase = 'idle';
    if (runId === dl.runId) {
      dl.hold = null;
      dl.nextAutoAt = Date.now() + downloadTuning().autoRecheckMs;
    }
    dl.controller = null;
    emitDownloadStatus(true);
    refreshDownloadsSpace();
    scheduleDownloadsRender();
  });
  scheduleDownloadsRender();
  return dl.loop;
}

/* Pause / Stop: the piece being written is dropped, every finished piece and
   every saved video stays. */
function haltLessonDownloads(phase) {
  dl.runId += 1;
  dl.phase = phase;
  dl.hold = null;
  emitDownloadStatus(true);
  if (dl.controller) {
    dl.abortWhy = 'pause';
    try { dl.controller.abort(); } catch { /* already done */ }
  }
  dl.activeId = null;
  scheduleDownloadsRender();
}

function pauseLessonDownloads() {
  if (!downloadsActive()) return;
  haltLessonDownloads('paused');
  setDownloadsRunMark('paused');
  setDownloadsNote('Paused. Press Resume to carry on from where it stopped.');
}

function stopLessonDownloads() {
  if (!downloadsActive() && dl.phase !== 'paused') return;
  haltLessonDownloads('idle');
  setDownloadsRunMark(null);
  dl.autoHeld = true;
  setDownloadsNote(
    'Stopped. Videos already saved stay saved; press "Download all lessons" to carry on later.' +
      (downloadsAutoWanted() ? ' Automatic downloading starts again the next time this page loads (untick "Download lessons automatically" to stop it for good).' : '')
  );
}

async function deleteDownloadedLessons() {
  if (downloadsActive() || dl.phase === 'paused') {
    haltLessonDownloads('idle');
    setDownloadsRunMark(null);
  }
  // Let the stopped download let go of its file first.
  if (dl.loop) {
    await Promise.race([dl.loop.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
  }
  try {
    await deleteSavedLessons();
    dl.files = {};
    dl.errors = {};
    setDownloadsNote('Deleted. Lessons play from the internet again.', 'ok');
  } catch (err) {
    console.warn('Journey: could not delete the saved lessons', err);
    setDownloadsNote('Some saved videos could not be deleted (one may be playing right now). Try again once it ends.', 'bad');
  }
  await refreshDownloadsPanel();
}

/* ── The panel ── */

function scheduleDownloadsRender() {
  if (dl.renderTimer) return;
  dl.renderTimer = setTimeout(() => {
    dl.renderTimer = null;
    renderDownloads();
  }, downloadTuning().renderMs);
}

function showOnly(el, shown) {
  el.classList.toggle('hidden', !shown);
}

/* Moves focus with a control that is about to hide, so the keyboard is never
   left on a hidden button. */
function handFocus(from, to) {
  if (from && to && document.activeElement === from) to.focus();
}

function rowState(item) {
  if (!item.url) return { state: 'unavailable', text: 'Cannot be downloaded here', pct: 0 };
  const f = dl.files[item.id] || {};
  const total = f.total || item.bytes || 0;
  const pct = total ? Math.min(100, Math.floor(((f.have || 0) * 100) / total)) : 0;
  if (savedPlaybackFailures.has(item.id)) return { state: 'failed', text: 'Would not play from this computer; delete and download again', pct };
  if (f.state === 'saved') return { state: 'saved', text: 'Saved', pct: 100 };
  if (dl.errors[item.id]) return { state: 'failed', text: `Failed: ${dl.errors[item.id]}. Will retry next time.`, pct };
  if (downloadsActive() && dl.activeId === item.id) return { state: 'active', text: `Downloading ${pct}%`, pct };
  if (f.state === 'damaged') return { state: 'failed', text: 'Damaged: will download again', pct };
  if (f.state === 'partial' && f.have) return { state: 'partial', text: `Partly saved (${pct}%)`, pct };
  return { state: 'waiting', text: total ? `Not saved (${formatBytes(total)})` : 'Not saved', pct: 0 };
}

function renderDownloadRows() {
  const key = dl.items.map((i) => i.id).join(',');
  if (key !== dl.rowsKey) {
    dl.rowsKey = key;
    downloadsList.textContent = '';
    for (const item of dl.items) {
      const li = document.createElement('li');
      li.className = 'downloads-row';
      li.dataset.id = item.id;
      const name = document.createElement('span');
      name.className = 'downloads-row-name';
      name.textContent = downloadLabel(item);
      const state = document.createElement('span');
      state.className = 'downloads-row-state';
      const bar = document.createElement('span');
      bar.className = 'downloads-row-bar';
      bar.setAttribute('aria-hidden', 'true');
      const fill = document.createElement('span');
      fill.className = 'downloads-row-fill';
      bar.appendChild(fill);
      li.append(name, state, bar);
      downloadsList.appendChild(li);
    }
  }
  for (const li of downloadsList.children) {
    const item = dl.items.find((i) => i.id === li.dataset.id);
    if (!item) continue;
    const r = rowState(item);
    li.dataset.state = r.state;
    const state = li.querySelector('.downloads-row-state');
    if (state.textContent !== r.text) state.textContent = r.text;
    li.querySelector('.downloads-row-fill').style.width = `${r.pct}%`;
  }
}

function renderDownloads() {
  // Nothing to see with Settings closed; opening it draws everything.
  if (!downloadsSection || settingsPanel.classList.contains('hidden')) return;
  if (CONFIGURE_MODE || !lessonStoreSupported()) {
    for (const el of [downloadsStartBtn, downloadsPauseBtn, downloadsResumeBtn, downloadsStopBtn, downloadsBar, downloadsDeleteBtn, downloadsConfirm]) {
      showOnly(el, false);
    }
    downloadsLeadersInput.disabled = true;
    downloadsAutoInput.disabled = true;
    downloadsSummary.textContent = CONFIGURE_MODE
      ? 'Lessons are downloaded from the Journey screen itself: open Settings there (press S or the gear).'
      : 'This browser cannot save lessons for offline playback. The Journey kiosk (the KVBC Awana app) can.';
    downloadsStatus.textContent = '';
    downloadsSpace.textContent = '';
    downloadsList.textContent = '';
    dl.rowsKey = '';
    return;
  }
  const active = downloadsActive();
  const paused = dl.phase === 'paused';
  const progress = downloadProgress(dl.items, dl.files, active);
  const rate = downloadRate(dl.samples, Date.now(), downloadTuning().rateWindowMs);
  const allSaved = progress.count > 0 && progress.saved === progress.count;

  showOnly(downloadsStartBtn, !active && !paused);
  downloadsStartBtn.disabled = progress.count === 0 || allSaved;
  showOnly(downloadsPauseBtn, active);
  showOnly(downloadsResumeBtn, paused);
  showOnly(downloadsStopBtn, active || paused);
  downloadsLeadersInput.disabled = active || paused;
  downloadsLeadersInput.checked = downloadsLeadersWanted();
  downloadsAutoInput.checked = downloadsAutoWanted();

  downloadsSummary.textContent = dl.items.length
    ? downloadSummaryText(progress, dl.phase, rate)
    : allLessons ? 'No lesson videos can be downloaded from here.' : 'Loading the lesson list…';
  showOnly(downloadsBar, progress.count > 0);
  downloadsBar.setAttribute('aria-valuenow', String(progress.percent));
  downloadsBar.setAttribute('aria-valuetext', `${progress.percent}%`);
  downloadsBarFill.style.width = `${progress.percent}%`;

  downloadsStatus.textContent = dl.note;
  if (dl.tone) downloadsStatus.dataset.tone = dl.tone;
  else delete downloadsStatus.dataset.tone;

  const s = dl.space;
  downloadsSpace.textContent = s
    ? `Space for saved lessons on this computer: ${formatBytes(s.free)} free.` +
      (s.persisted === true
        ? ' Kept until you delete them.'
        : s.persisted === false
          ? ' The browser may clear them if the disk gets nearly full.'
          : '')
    : '';

  const anything = Object.values(dl.files).some((f) => f.state !== 'none' || f.have > 0);
  showOnly(downloadsDeleteBtn, downloadsConfirm.classList.contains('hidden'));
  downloadsDeleteBtn.disabled = !anything;
  renderDownloadRows();
}

/* Opening Settings: read the disk and the space, draw. Never waits on the
   network (the lesson list is whatever is loaded; it loads if missing). */
async function refreshDownloadsPanel() {
  if (!downloadsSection) return;
  if (CONFIGURE_MODE || !lessonStoreSupported()) {
    renderDownloads();
    return;
  }
  // Every open starts from the plain buttons (an Escape may have closed the
  // panel over the delete question).
  if (!downloadsConfirm.classList.contains('hidden')) {
    downloadsConfirm.classList.add('hidden');
  }
  renderDownloads();
  if (!allLessons) await loadAllLessons();
  if (!allLessons) {
    setDownloadsNote('The lesson list couldn’t load: check the kiosk’s internet connection, then close and reopen Settings.', 'bad');
    renderDownloads();
    return;
  }
  if (!downloadsActive()) planDownloads();
  await inspectDownloads();
  dl.space = await readStorageSpace();
  renderDownloads();
}

function refreshDownloadsSpace() {
  readStorageSpace().then((space) => {
    dl.space = space;
    scheduleDownloadsRender();
  });
}

/* "Download lessons automatically", from its tick box here or from the
   settings page (27-settings-page.js): stored, then a switch on looks for
   work at once, and a switch off stops an automatic run (saved videos stay). */
function setDownloadsAuto(on) {
  try {
    localStorage.setItem(DOWNLOADS_AUTO_KEY, on ? '1' : '0');
  } catch {
    setDownloadsNote('This choice could not be saved on this device.', 'bad');
  }
  if (on) {
    dl.autoHeld = false;
    dl.nextAutoAt = 0;
    autoDownloadTick();
  } else if (downloadsActive() && dl.auto) {
    // Switched off: an automatic run stops (saved videos stay).
    haltLessonDownloads('idle');
    setDownloadsRunMark(null);
    setDownloadsNote('Automatic downloading is off. Videos already saved stay saved.');
  }
  emitDownloadStatus(true);
  renderDownloads();
}

/* "Include Leader Videos", from its tick box or from the settings page. A
   run already going keeps its list; the next one (or Resume) reads this. */
function setDownloadsLeaders(on) {
  try {
    localStorage.setItem(DOWNLOADS_LEADERS_KEY, on ? '1' : '0');
  } catch {
    setDownloadsNote('This choice could not be saved on this device.', 'bad');
  }
  if (!downloadsActive()) refreshDownloadsPanel();
  emitDownloadStatus(true);
}

function hideDownloadsConfirm() {
  handFocus(downloadsConfirmNo, downloadsDeleteBtn);
  handFocus(downloadsConfirmYes, downloadsDeleteBtn);
  downloadsConfirm.classList.add('hidden');
  renderDownloads();
}

if (downloadsSection) {
  const autoHint = document.getElementById('downloads-auto-hint');
  if (autoHint) {
    autoHint.textContent = `by itself, never during a lesson or from ${clockText(DOWNLOAD_QUIET_START_MINUTES)} to ${clockText(DOWNLOAD_QUIET_END_MINUTES)}`;
  }
  downloadsStartBtn.addEventListener('click', () => {
    startLessonDownloads(false);
    renderDownloads();
    handFocus(downloadsStartBtn, downloadsPauseBtn);
  });
  downloadsPauseBtn.addEventListener('click', () => {
    pauseLessonDownloads();
    renderDownloads();
    handFocus(downloadsPauseBtn, downloadsResumeBtn);
  });
  downloadsResumeBtn.addEventListener('click', () => {
    startLessonDownloads(false);
    renderDownloads();
    handFocus(downloadsResumeBtn, downloadsPauseBtn);
  });
  downloadsStopBtn.addEventListener('click', () => {
    stopLessonDownloads();
    renderDownloads();
    handFocus(downloadsStopBtn, downloadsStartBtn);
  });
  downloadsAutoInput.addEventListener('change', () => setDownloadsAuto(downloadsAutoInput.checked));
  downloadsLeadersInput.addEventListener('change', () => setDownloadsLeaders(downloadsLeadersInput.checked));
  downloadsDeleteBtn.addEventListener('click', () => {
    const saved = Object.values(dl.files).filter((f) => f.state === 'saved');
    const bytes = Object.values(dl.files).reduce((sum, f) => sum + (f.have || 0), 0);
    downloadsConfirmText.textContent =
      `Delete ${saved.length === 1 ? 'the 1 saved video' : `all ${saved.length} saved videos`} (${formatBytes(bytes)}) from this computer? ` +
      'Lessons then play from the internet again, and downloading them again takes hours.';
    downloadsConfirm.classList.remove('hidden');
    downloadsDeleteBtn.classList.add('hidden');
    downloadsConfirmNo.focus(); // the safe answer is the one under the keyboard
  });
  downloadsConfirmNo.addEventListener('click', hideDownloadsConfirm);
  downloadsConfirmYes.addEventListener('click', () => {
    downloadsConfirm.classList.add('hidden');
    downloadsDeleteBtn.classList.remove('hidden');
    downloadsDeleteBtn.focus();
    setDownloadsNote('Deleting…');
    deleteDownloadedLessons();
  });
  // A download that was running when the page went away (a reload, the PC
  // restarting) carries on by itself; a paused one stays paused.
  if (!CONFIGURE_MODE && lessonStoreSupported()) {
    const mark = downloadsRunMark();
    if (mark === 'paused') dl.phase = 'paused';
    // (With automatic mode on, its own first pass a few minutes in does it.)
    if (mark === 'running' && !downloadsAutoWanted()) {
      setTimeout(() => {
        if (dl.phase === 'idle') startLessonDownloads(false, true);
      }, downloadTuning().resumeAfterLoadMs);
    }
    const scheduleNextTick = () => {
      setTimeout(() => {
        if (!downloadsActive() && !dl.autoHeld) {
          autoDownloadTick();
        }
        scheduleNextTick();
      }, downloadTuning().autoTickMs);
    };
    scheduleNextTick();
    window.addEventListener('online', () => autoDownloadTick());
    setTimeout(async () => {
      await prepareDownloadStatus();
      autoDownloadTick();
    }, downloadTuning().autoStartMs);
  }
}

/* What is saved, read from the disk once after load (no network but a
   lessons.json the page may already hold), so the status is true even
   before Settings is opened or a pass runs. */
async function prepareDownloadStatus() {
  if (dl.inspected || downloadsActive()) return;
  try {
    if (!allLessons) await loadAllLessons();
    if (!allLessons || downloadsActive()) return;
    planDownloads();
    await inspectDownloads();
  } catch { /* the status stays "not known yet" */ }
}

/* The automatic pass: a few minutes after load, then on every poll and on
   'online'. Starts a run only when nothing must wait (so it never starts
   into the lesson or the quiet hours); the run itself waits if one begins.
   A finished pass looks again after autoRecheckMs, re-reading lessons.json,
   which is how a newly published lesson is picked up. */
function autoDownloadTick(now = Date.now()) {
  if (CONFIGURE_MODE || !lessonStoreSupported() || !downloadsAutoWanted()) return false;
  if (dl.autoHeld || dl.phase !== 'idle') return false;
  const tuning = downloadTuning();
  if (now - dl.loadedAt < tuning.autoStartMs) return false;
  if (now < dl.nextAutoAt) return false;
  if (navigator.onLine === false) return false;
  if (currentHoldReason(true)) return false;
  startLessonDownloads(true);
  return true;
}

/* ── Status for reporting (the owner's settings page reads it) ── */

function journeyDownloadStatus() {
  const progress = downloadProgress(dl.items, dl.files, downloadsActive());
  const active = dl.activeId ? dl.items.find((i) => i.id === dl.activeId) : null;
  return {
    total: progress.count,
    saved: progress.saved,
    bytesSaved: progress.done,
    bytesTotal: progress.total,
    downloading: dl.phase === 'running',
    waiting: dl.phase === 'waiting' ? dl.hold : null,
    paused: dl.phase === 'paused',
    percent: progress.percent,
    currentWeek: active && dl.phase === 'running' ? active.week : null,
    lastSavedAt: dl.lastSavedAt,
    error: dl.lastError,
    auto: downloadsAutoWanted(),
    leaders: downloadsLeadersWanted(),
    supported: lessonStoreSupported() && !CONFIGURE_MODE,
    known: dl.inspected,
  };
}

/* The event: at once (`now`) on a saved video, an error or a phase change,
   at most every statusMs otherwise (bytes arriving). */
function emitDownloadStatus(now) {
  const send = () => {
    dl.statusTimer = null;
    dl.statusSentAt = Date.now();
    try {
      window.dispatchEvent(new CustomEvent('journey-download-status', { detail: journeyDownloadStatus() }));
    } catch { /* no CustomEvent: the function still answers */ }
  };
  if (now) {
    clearTimeout(dl.statusTimer);
    send();
    return;
  }
  if (dl.statusTimer) return;
  const wait = Math.max(0, downloadTuning().statusMs - (Date.now() - dl.statusSentAt));
  dl.statusTimer = setTimeout(send, wait);
}

window.journeyDownloads = dl; // tests read the state
window.journeyDownloadStatus = journeyDownloadStatus;
