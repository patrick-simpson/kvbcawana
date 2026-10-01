// @ts-check
// Storage for the SYNCED slide deck — the deck published by the print server,
// cached so a screen that reboots at 5pm on club night renders it instantly
// with zero network.
//
// DELIBERATELY SEPARATE FROM useConfig.js, same reasoning as displayKey.js:
// `awanaConfig.v1` is backed by the VALIDATORS table, and that table also
// powers `?config=<url>` and Settings Export/Import. The synced deck is feed
// STATE, not a setting — routing it through config would let a remote config
// file inject a deck (bypassing the sealed transport entirely) and would drag
// a possibly-large deck into every settings export. It lives beside
// `awanaCalendar.v1` and friends instead: cached data, never configuration.

import { sanitizeSlides } from './slides.js';

const STORAGE_KEY = 'awanaSyncedSlides.v1';

/** Name of the event fired when the cached deck changes in THIS tab. */
export const SYNCED_SLIDES_CHANGE_EVENT = 'awana-synced-slides-change';

/** localStorage key, exported so tests can assert it is not `awanaConfig.v1`. */
export const SYNCED_SLIDES_STORAGE = STORAGE_KEY;

/**
 * @typedef {import('./slidesSync.js').SyncedDeck} SyncedDeck
 */

/**
 * The cached deck, or null when this screen has never received one.
 * A deck with ZERO slides is a real value — the operator published an empty
 * deck, which is a different fact from "never synced".
 * @returns {SyncedDeck | null}
 */
export function loadSyncedDeck() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const publishedAt = Number(parsed.publishedAt);
    const deckRev = Math.floor(Number(parsed.deckRev));
    if (!Number.isFinite(publishedAt) || !(deckRev >= 1)) return null;
    return { deckRev, publishedAt, slides: sanitizeSlides(parsed.slides) };
  } catch {
    return null;
  }
}

/**
 * Persist the committed deck. Best-effort: a screen with blocked storage
 * still renders the in-memory deck for the session.
 * @param {SyncedDeck} deck
 * @returns {boolean}
 */
export function saveSyncedDeck(deck) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck));
    window.dispatchEvent(new Event(SYNCED_SLIDES_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the received deck — the recovery lever for the one pathological
 * case (a publisher whose clock rolled back behind the committed stamp), and
 * the "stop following what was published" reset.
 */
export function clearSyncedDeck() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new Event(SYNCED_SLIDES_CHANGE_EVENT));
  } catch { /* storage blocked — nothing cached to clear */ }
}
