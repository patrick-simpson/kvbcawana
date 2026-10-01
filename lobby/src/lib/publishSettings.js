// @ts-check
// The write half of shared settings (contract v6): POST this screen's shared
// settings to the print server, which seals and broadcasts them to every
// screen. Same path, same token and the same limits as slide sync
// (src/lib/publishDeck.js): it works from a browser on the check-in computer
// itself, because http://localhost is exempt from mixed-content blocking. From
// any other screen the browser blocks the request, and Settings says so.

import { pickShared } from './sharedSettings.js';

/** Where the print server listens on the machine it runs on. */
export const PRINT_SERVER_SETTINGS_URL = 'http://localhost:3456/api/display-settings';

/**
 * @typedef {{ok: true, rev: number, publishedAt: string, keyCount: number}} SettingsPublishOk
 * @typedef {{ok: false, reason: 'no-token'|'unreachable'|'auth'|'rejected', message: string}} SettingsPublishErr
 */

/**
 * @param {Record<string, unknown>} config  this screen's settings (only the shared keys are sent)
 * @param {string} token  the publish token (the display login fills it in)
 * @param {{url?: string, fetchFn?: typeof fetch}} [opts] Test seams.
 * @returns {Promise<SettingsPublishOk | SettingsPublishErr>} Never throws.
 */
export async function publishSettings(config, token, opts) {
  const url = opts?.url || PRINT_SERVER_SETTINGS_URL;
  const fetchFn = opts?.fetchFn || fetch;
  const cleanToken = String(token == null ? '' : token).trim();
  if (!cleanToken) {
    return {
      ok: false,
      reason: 'no-token',
      message: 'This screen has no publish token, so it cannot send settings to the other screens. Log it in (Settings → Setup → Connect this screen).',
    };
  }
  let res;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanToken}` },
      body: JSON.stringify({ settings: pickShared(config) }),
    });
  } catch {
    return {
      ok: false,
      reason: 'unreachable',
      message: 'Could not reach the print server from this screen, so this change stayed on this screen. To change every screen, make it in Settings on the check-in computer while the printer app is running.',
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
      message: res.status === 404
        ? 'The print server is too old to share settings. Update the printer app, then try again.'
        : serverSays,
    };
  }
  return {
    ok: true,
    rev: Number(body?.rev) || 0,
    publishedAt: String(body?.publishedAt || ''),
    keyCount: Number(body?.keyCount) || 0,
  };
}
