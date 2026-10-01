// ─────────────────────────────────────────────────────────────
// Local .pptx storage (cloned from videoStore.js). The deck bytes
// live in IndexedDB on THIS device only — never uploaded anywhere.
// Upload is the PRIMARY input path for the local slideshow because
// OneDrive download URLs usually lack CORS headers in a browser.
//
// Every read path degrades gracefully: getDeck() never rejects — a
// missing blob, cleared site data, or blocked IndexedDB all come
// back as null and the caller falls back to the iframe embed.
// ─────────────────────────────────────────────────────────────

const DB_NAME = 'awanaPptx';
// v2 adds the 'models' store: the parsed slide model is cached beside
// the deck bytes so the display doesn't re-unzip the deck every boot.
const DB_VERSION = 2;
const STORE = 'decks';
const MODEL_STORE = 'models';
const KEY = 'current';

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
    req.onupgradeneeded = () => {
      // Guarded creates: a fresh install makes both stores; a v1→v2
      // upgrade only adds 'models' and leaves the saved deck intact.
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(MODEL_STORE)) db.createObjectStore(MODEL_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // Let a later call retry instead of caching the failure forever.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function withStore(mode, fn, storeName = STORE) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const req = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  }));
}

/** Save the uploaded deck. Resolves true on success, false on failure. */
export function putDeck(blob, name = '') {
  return withStore('readwrite', (store) => store.put({ blob, name, savedAt: Date.now() }, KEY))
    .then(() => true)
    .catch(() => false);
}

/** The stored deck ({ blob, name, savedAt }) or null — never rejects. */
export function getDeck() {
  return withStore('readonly', (store) => store.get(KEY))
    .then((v) => (v && v.blob instanceof Blob ? v : null))
    .catch(() => null);
}

/** Remove the stored deck (and its cached model). Never rejects. */
export function deleteDeck() {
  return withStore('readwrite', (store) => store.delete(KEY))
    .then(() => deleteModel().then(() => true))
    .catch(() => false);
}

/**
 * Cache the parsed slide model ({ parserVersion, deckSavedAt, model }).
 * Best-effort: resolves true on success, false on failure — a display
 * that can't cache just re-parses on the next boot.
 */
export function putModel(record) {
  return withStore('readwrite', (store) => store.put(record, KEY), MODEL_STORE)
    .then(() => true)
    .catch(() => false);
}

/** The cached model record or null — never rejects. */
export function getModel() {
  return withStore('readonly', (store) => store.get(KEY), MODEL_STORE)
    .then((v) => (v && typeof v === 'object' ? v : null))
    .catch(() => null);
}

/** Remove the cached model. Never rejects. */
export function deleteModel() {
  return withStore('readwrite', (store) => store.delete(KEY), MODEL_STORE)
    .then(() => true)
    .catch(() => false);
}
