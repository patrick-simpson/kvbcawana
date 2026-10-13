/* ── Saved lessons: Awana's original videos kept on this computer ────────
   Settings "Download all lessons (full quality)" (26-lesson-downloads.js)
   saves every lesson's original into the browser's Origin Private File
   System (OPFS: real files in the browser profile on the kiosk PC's disk,
   private to this site). A saved lesson then plays from the disk FIRST, even
   with the internet up (owner 2026-10-12: the church's internet is slow), and
   only a missing or damaged copy goes back to the network (05-stream-first.js).

   Storage design (CLAUDE.md "Saved lessons"): one folder per video,
   `journey-lessons-v1/week-07-student/`, holding `info.json` and the file cut
   into 16 MiB pieces `c00000`, `c00001`, … Each piece is written whole and
   committed on close, so an interrupted download keeps every finished piece
   and carries on from the next one with a Range request. Playback hands the
   <video> one Blob made of the pieces' File objects: those are disk-backed
   (Chromium reads them from the files as the video asks, with seeking), so a
   multi-GB lesson is never read into memory and needs no service worker.

   Nothing in this page's Cache API eviction can touch these files (a separate
   store): a saved lesson stays until someone presses "Delete downloaded
   lessons". The browser itself is asked to keep them too
   (navigator.storage.persist(), which the KVBC Awana app grants). */
const LESSON_STORE_DIR = 'journey-lessons-v1';
const LESSON_CHUNK_BYTES = 16 * 1024 * 1024;
const LESSON_ROLES = ['student', 'leader'];

/* Can this browser keep saved lessons at all? Needs OPFS with writable files
   (Chromium 86+, so the kiosk app and desktop Chrome/Edge; not every phone). */
function lessonStoreSupported() {
  try {
    return !!(
      window.isSecureContext !== false &&
      navigator.storage &&
      typeof navigator.storage.getDirectory === 'function' &&
      typeof window.FileSystemFileHandle === 'function' &&
      'createWritable' in window.FileSystemFileHandle.prototype
    );
  } catch {
    return false;
  }
}

function lessonFileId(week, role) {
  return `week-${String(week).padStart(2, '0')}-${role}`;
}

function lessonChunkName(index) {
  return `c${String(index).padStart(5, '0')}`;
}

/* The one address a lesson's original may be DOWNLOADED from, and its size:
   lessons.json `cdnUrl`/`bytes` (Student) or `leaderCdnUrl`/`leaderBytes`
   (Leader), recorded by scripts/resolve-lesson-files.mjs. That is the CORS-
   enabled CloudFront file clubs.awana.org redirects to (the redirect hop has
   no CORS header, so a browser cannot fetch the clubs.awana.org address).
   Only an https .mp4 counts: nothing but a lesson's own video is ever
   downloaded here. Null when the lesson has none. */
function lessonFileSource(lesson, role) {
  if (!lesson || !LESSON_ROLES.includes(role)) return null;
  const url = role === 'leader' ? lesson.leaderCdnUrl : lesson.cdnUrl;
  const bytes = role === 'leader' ? lesson.leaderBytes : lesson.bytes;
  if (role === 'leader' && !lesson.leaderDownloadUrl) return null;
  if (typeof url !== 'string' || !/^https:\/\/[^/]+\/.+\.mp4$/i.test(url)) return null;
  return { url, bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : null };
}

/* The current address and size of `week`'s `role` video from the loaded
   lessons.json, or null when that is not known (the list not loaded, a week
   it does not have, no downloadable address). */
function currentLessonFileSource(week, role) {
  const entry = Array.isArray(allLessons) ? allLessons.find((l) => l && l.week === week) : null;
  return entry ? lessonFileSource(entry, role) : null;
}

/* Is the copy on disk (its info.json) still the file lessons.json names?
   `source` is { url, bytes } (lessonFileSource(), or a download plan item).
   A different address, or a different size when lessons.json gives one,
   means Awana replaced the file: that copy is NOT saved (it does not play,
   it is not counted) and the downloader starts it again (downloadOneLesson).
   No source to compare with (null): the copy counts, so a kiosk that cannot
   read lessons.json still plays what it saved. */
function savedCopyMatches(info, source) {
  if (!info || !source || !source.url) return true;
  return info.url === source.url && !(source.bytes && info.bytes !== source.bytes);
}

/* Pure: how many bytes of a file of `total` bytes, cut into `chunk`-byte
   pieces, are safely on disk given the pieces' sizes in order. A piece counts
   only at its full expected size and only while every piece before it does
   (an interrupted piece, or anything after it, is downloaded again). */
function committedLessonBytes(sizes, total, chunk) {
  if (!(total > 0) || !(chunk > 0)) return 0;
  let have = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    const expected = Math.min(chunk, total - i * chunk);
    if (expected <= 0 || sizes[i] !== expected) break;
    have += expected;
  }
  return have;
}

async function lessonStoreRoot(create) {
  if (!lessonStoreSupported()) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(LESSON_STORE_DIR, { create: !!create });
  } catch {
    return null; // nothing saved yet (or storage off)
  }
}

async function lessonFileDir(id, create) {
  const root = await lessonStoreRoot(create);
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(id, { create: !!create });
  } catch {
    return null;
  }
}

async function readLessonInfo(dir) {
  try {
    const file = await (await dir.getFileHandle('info.json')).getFile();
    const info = JSON.parse(await file.text());
    return info && info.v === 1 && Number.isFinite(info.bytes) && info.bytes > 0
      && Number.isFinite(info.chunk) && info.chunk > 0 ? info : null;
  } catch {
    return null;
  }
}

async function writeLessonInfo(dir, info) {
  const handle = await dir.getFileHandle('info.json', { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(JSON.stringify(info));
    await writable.close();
  } catch (err) {
    try { await writable.abort(); } catch { /* already gone */ }
    throw err;
  }
}

/* The pieces on disk, in order, as File objects (stops at the first gap). */
async function lessonChunkFiles(dir, info) {
  const files = [];
  const count = Math.ceil(info.bytes / info.chunk);
  for (let i = 0; i < count; i += 1) {
    let file = null;
    try {
      file = await (await dir.getFileHandle(lessonChunkName(i))).getFile();
    } catch {
      break;
    }
    files.push(file);
  }
  return files;
}

/* What is on disk for one video: { state, have, total, info }.
   state: 'none' (nothing), 'partial' (some pieces, resumable), 'saved' (every
   byte), 'damaged' (marked finished but pieces missing or the wrong size:
   it is downloaded again, and plays from the internet meanwhile). A copy of
   a file lessons.json no longer names (`source`, savedCopyMatches()) is
   'none' with `stale`: the downloader starts it from the beginning. Its
   pieces stay on disk until then (only the downloader or Delete removes
   anything). */
async function inspectLessonFile(id, source) {
  const dir = await lessonFileDir(id, false);
  if (!dir) return { state: 'none', have: 0, total: 0, info: null };
  const info = await readLessonInfo(dir);
  if (!info) return { state: 'none', have: 0, total: 0, info: null };
  if (!savedCopyMatches(info, source)) return { state: 'none', have: 0, total: (source && source.bytes) || 0, info: null, stale: true };
  const files = await lessonChunkFiles(dir, info);
  const have = committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk);
  let state = 'partial';
  if (have === info.bytes) state = 'saved';
  else if (info.done) state = 'damaged';
  else if (have === 0) state = 'none';
  return { state, have, total: info.bytes, info };
}

/* The saved video as ONE disk-backed Blob of its pieces, or null when it is
   not completely saved, or is a copy of a file lessons.json no longer names
   (`source`: savedCopyMatches(); the caller then plays from the network, as
   for a missing copy, and the downloader replaces it). Never reads the bytes
   themselves, never deletes anything. */
async function savedLessonBlob(id, source) {
  const dir = await lessonFileDir(id, false);
  if (!dir) return null;
  const info = await readLessonInfo(dir);
  if (!info || !savedCopyMatches(info, source)) return null;
  const files = await lessonChunkFiles(dir, info);
  if (committedLessonBytes(files.map((f) => f.size), info.bytes, info.chunk) !== info.bytes) return null;
  return new Blob(files, { type: 'video/mp4' });
}

/* Set when a <video> src is a saved copy: { src, networkUrl, id }. The video
   error listener (13-wake-lock.js) swaps a saved copy that will not play to
   the network address once, at the same position. */
let savedPlayback = null;
// Videos that failed to play from this computer since the page loaded (the
// downloads panel names them).
const savedPlaybackFailures = new Set();

/* A playable object URL for the saved copy of `week`'s `role` video, or null
   (none, damaged, replaced by Awana since it was saved (checked against the
   loaded lessons.json), storage off, or a newer request has taken over: callers
   re-check their own token). Follows the page's object-URL rule: the old
   currentObjectUrl is revoked only once the new one is in hand. */
async function savedLessonObjectUrl(week, role, token, networkUrl) {
  if (!lessonStoreSupported()) return null;
  const id = lessonFileId(week, role);
  let blob = null;
  try {
    blob = await savedLessonBlob(id, currentLessonFileSource(week, role));
  } catch {
    blob = null;
  }
  if (!blob) return null;
  if (token !== undefined && token !== journeyRequestToken) return null;
  const url = URL.createObjectURL(blob);
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = url;
  savedPlayback = { src: url, networkUrl: networkUrl || null, id };
  return url;
}

/* The video error hook: a saved copy that will not play (damaged on disk, or
   deleted while it played) goes over to the network address once, where the
   room got to. True when it took the error. */
function fallBackFromSavedCopy() {
  const saved = savedPlayback;
  if (!saved || journeyVideo.getAttribute('src') !== saved.src) return false;
  savedPlayback = null;
  savedPlaybackFailures.add(saved.id);
  if (!saved.networkUrl) return false;
  console.warn('Journey: the saved copy would not play; using the internet copy —', saved.id);
  const at = journeyVideo.currentTime;
  pendingSeek = at > 0 ? { token: journeyRequestToken, t: at } : null;
  showVideoLoading();
  journeyVideo.src = saved.networkUrl;
  applyCaptions();
  journeyVideo.play().catch(() => {});
  return true;
}

/* Is the current week's Student Video saved (and still the file lessons.json
   names)? cacheLessonBundle() then skips its own copy of it (no second
   ~150 MB in the Cache API). */
async function lessonSavedOnDisk(week, role) {
  if (!lessonStoreSupported()) return false;
  try {
    return (await inspectLessonFile(lessonFileId(week, role), currentLessonFileSource(week, role))).state === 'saved';
  } catch {
    return false;
  }
}

/* Delete every saved lesson (the one way they ever go). */
async function deleteSavedLessons() {
  if (!lessonStoreSupported()) return;
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(LESSON_STORE_DIR, { recursive: true });
  } catch (err) {
    if (err && err.name === 'NotFoundError') return;
    throw err;
  }
}
