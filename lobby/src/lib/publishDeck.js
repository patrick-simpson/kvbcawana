// @ts-check
// The write half of slide sync: POST the typed deck to the print server,
// which seals and broadcasts it to every screen.
//
// This only works from a browser on the check-in machine itself —
// http://localhost is exempt from mixed-content blocking, and the print
// server's CORS carve-out plus the bearer token do the authenticating. From
// anywhere else the fetch fails fast and the editor shows the paste-into-
// dashboard fallback instead, which is the primary documented path.

import { isVideoSlide, sanitizeSlides } from './slides.js';

/** Where the print server listens on the machine it runs on. */
export const PRINT_SERVER_SLIDES_URL = 'http://localhost:3456/api/lobby-slides';

/**
 * @typedef {{ok: true, deckRev: number, publishedAt: string, slideCount: number, droppedCount: number}} PublishOk
 * @typedef {{ok: false, reason: 'no-token'|'unreachable'|'auth'|'rejected', message: string}} PublishErr
 */

/**
 * Publish the deck. Strips video slides first (their bytes live only on this
 * device — the caller confirms that with the operator before calling).
 *
 * @param {Array<object>} slides The deck as edited (may include video slides).
 * @param {string} token The publish token from the printer dashboard.
 * @param {{url?: string, fetchFn?: typeof fetch}} [opts] Test seams.
 * @returns {Promise<PublishOk | PublishErr>} Never throws.
 */
export async function publishDeck(slides, token, opts) {
  const url = opts?.url || PRINT_SERVER_SLIDES_URL;
  const fetchFn = opts?.fetchFn || fetch;
  const cleanToken = String(token == null ? '' : token).trim();
  if (!cleanToken) {
    return {
      ok: false,
      reason: 'no-token',
      message: 'No publish token on this machine. Get one from the print server dashboard → Lobby Slides → Generate, and paste it below.',
    };
  }
  const textSlides = sanitizeSlides(slides).filter((s) => !isVideoSlide(s));

  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanToken}`,
      },
      body: JSON.stringify({ slides: textSlides }),
    });
  } catch {
    return {
      ok: false,
      reason: 'unreachable',
      message: 'Could not reach the print server. One-click publish only works in a browser on the check-in computer while the printer app is running — from anywhere else, use Export and paste the file into the printer dashboard → Lobby Slides.',
    };
  }

  /** @type {any} */
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }

  if (!res.ok) {
    const serverSays = body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    return {
      ok: false,
      reason: res.status === 401 || res.status === 403 ? 'auth' : 'rejected',
      message: serverSays,
    };
  }
  return {
    ok: true,
    deckRev: Number(body?.deckRev) || 0,
    publishedAt: String(body?.publishedAt || ''),
    slideCount: Number(body?.slideCount) || 0,
    droppedCount: Number(body?.droppedCount) || 0,
  };
}
