// ─────────────────────────────────────────────────────────────
// Local video storage for video slides. The video bytes live in
// IndexedDB on THIS device only — they are never uploaded anywhere.
// The slide deck in localStorage keeps just a small videoId
// reference (localStorage's ~5MB cap can't hold video, and its
// quota failures are silent).
//
// Every read path degrades gracefully: getVideo() never rejects —
// a missing blob, cleared site data, or a browser with IndexedDB
// blocked all come back as null, which callers render as a
// "video not on this device" skip. The show must never wedge.
// ─────────────────────────────────────────────────────────────

const DB_NAME = 'awanaVideos';
const DB_VERSION = 1;
const STORE = 'videos';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      // Firefox private mode throws synchronously.
      reject(err);
      return;
    }
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // Let a later call retry instead of caching the failure forever.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function withStore(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

// The full-screen video background (#25) lives in the same store under one
// well-known id — a single slot, like pptxStore's deck. Slide decks never
// reference this id, so collectGarbage() below shields it explicitly.
export const BACKGROUND_VIDEO_ID = 'v_background';

export function makeVideoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return 'v_' + crypto.randomUUID();
  }
  return 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// Ask the browser not to evict our storage under pressure — a kiosk
// that sits unattended all week must not lose its videos. Best-effort.
let persistenceRequested = false;
function requestPersistence() {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    navigator.storage?.persist?.().catch(() => {});
  } catch { /* older browsers */ }
}

// Rejects on failure so the editor can tell the user the video could
// not be stored (private window, storage full, IDB blocked).
export function putVideo(id, blob) {
  return withStore('readwrite', (store) => store.put(blob, id)).then(() => {
    requestPersistence();
    return id;
  });
}

// Never rejects — null means "not available on this device".
export function getVideo(id) {
  return withStore('readonly', (store) => store.get(id))
    .then((value) => (value instanceof Blob ? value : null))
    .catch(() => null);
}

export function deleteVideo(id) {
  return withStore('readwrite', (store) => store.delete(id)).catch(() => {});
}

export function listVideoIds() {
  return withStore('readonly', (store) => store.getAllKeys()).catch(() => []);
}

// Removes blobs no longer referenced by any slide. Called when the
// editor closes (against whichever deck is actually persisted), so a
// cancelled session's abandoned uploads get reaped too. Never throws.
// The background-video slot is always kept — it belongs to Settings,
// not the slide deck, so no deck can ever "orphan" it.
export async function collectGarbage(referencedIds) {
  try {
    const keep = new Set([...referencedIds, BACKGROUND_VIDEO_ID]);
    const ids = await listVideoIds();
    await Promise.all(ids.filter((id) => !keep.has(id)).map((id) => deleteVideo(id)));
  } catch { /* best-effort cleanup */ }
}
