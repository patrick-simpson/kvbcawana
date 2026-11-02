// The grand welcome film (owner 2026-11-01; video/grand-welcome/, BRIEF.md):
// a 20-second 3D film, 1080p60, silent, made in Blender on the laptop. Its
// first frames ARE the countdown's "0:00" alone on black (the countdown's
// last seconds show only its figures, views/CountdownView.jsx FINAL_SEC), so
// the cut at 6:00 is invisible; it ends on black, the US Pledge slide's own
// first frame. Pure helpers plus the one preload; views/GrandWelcome.jsx
// plays it.
//
// Files (lobby/public/welcome/, written by video/grand-welcome/grand_welcome.py
// --final; streamed with Range like the lobby's intro, site/lib/largeFiles.js
// REPO_FOLDERS['/lobby/welcome/']):
//   grand-welcome.mp4        the film (~8 Mbps, index at the front)
//   grand-welcome-first.png  its first frame: shown the instant the slide
//                            lands, until the video plays
//   grand-welcome-still.jpg  its landed frame (WELCOME TO, the church's full
//                            logo, the six club marks): the low-power switch's
//                            finished frame, and the stand-in if the video
//                            can't play

export const FILM = Object.freeze({
  src: './welcome/grand-welcome.mp4',
  first: './welcome/grand-welcome-first.png',
  still: './welcome/grand-welcome-still.jpg',
  /** How long it runs (config.js `welcome` duration). */
  sec: 20,
  /** The slide's own timer waits this much longer than `sec`: the film's end moves the deck on, the timer is only a cap. */
  grace: 3,
  /** Not playing this long after the slide lands, or stalled this long: the still instead. */
  waitMs: 4000,
  stallMs: 4000,
  /** The countdown fetches the whole film this long before 6:00 (it is then played from memory). */
  preloadSec: 120,
});

let blobUrl = /** @type {string | null} */ (null);
let loading = /** @type {Promise<string | null> | null} */ (null);

/**
 * Fetch the whole film once, into memory, so 6:00 is not a download: the
 * countdown calls this in its last FILM.preloadSec. Never throws; a failure
 * just leaves the film to stream (filmSrc).
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<string | null>}
 */
export function preloadFilm(fetchImpl = globalThis.fetch) {
  if (blobUrl) return Promise.resolve(blobUrl);
  if (loading) return loading;
  if (typeof fetchImpl !== 'function' || typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  loading = fetchImpl(FILM.src)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => {
      if (b && b.size > 0) blobUrl = URL.createObjectURL(b);
      return blobUrl;
    })
    .catch(() => null)
    .finally(() => { loading = null; });
  return loading;
}

/** The film's address: from memory once preloaded, else streamed. */
export function filmSrc() {
  return blobUrl ?? FILM.src;
}

/** Test seam: forget the preload. */
export function resetFilmForTests() {
  if (blobUrl && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(blobUrl);
  blobUrl = null;
  loading = null;
}
