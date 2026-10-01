// @ts-check
// Storage for the FLEET-CONFIG URL — where this screen fetches its display
// settings JSON from, delivered by the display login (#394).
//
// NOT A SECRET, and it is important to be exact about why it still lives here
// rather than in `awanaConfig.v1`:
//
// It is an address, not a credential — the same URL an operator can already
// put in a screen's `?config=` — and it points at a public JSON file of
// display preferences that never contains child data. Nothing is protected by
// keeping it out of the settings object.
//
// What IS protected is the settings object's meaning. `VALIDATORS` in
// useConfig.js is the table of things `?config=` may set and Settings → Export
// may write out. Putting `configUrl` in it would make a remote config file
// able to REPOINT the screen at a different remote config file — a redirect
// hop with no operator in it, on the very path an operator uses to manage a
// fleet — and would put the URL into every exported settings file, where it
// reads as just another preference someone may edit or copy onto a screen that
// should not follow it. So this gets its own entry for the same structural
// reason the display key, the publish token and the login key do: there is no
// deny-list to forget. fleetConfigUrl.test.js pins the three paths shut.
//
// Precedence, deliberately: an explicit `?config=` on the URL WINS over the
// provisioned one. Someone standing at the screen with a URL in their hand
// outranks what the print server last handed it — the same rule the display
// login itself already follows for a typed passphrase over the replay guard.

/** localStorage key, exported so tests can assert it is not `awanaConfig.v1`. */
export const FLEET_CONFIG_URL_STORAGE = 'awanaFleetConfigUrl.v1';

/** Name of the event fired when the URL changes in THIS tab. */
export const FLEET_CONFIG_URL_CHANGE_EVENT = 'awana-fleet-config-url-change';

/** The provision contract's cap — pinned in envelope-vectors.json. */
export const FLEET_CONFIG_URL_MAX = 200;

/**
 * https only, length-capped, no credentials in the URL — the same rule the
 * publisher applies before sealing. Re-checked HERE too: a screen must not
 * fetch its settings over plain http (a lobby network can rewrite that, and a
 * page served over https cannot load it at all).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidFleetConfigUrl(value) {
  const s = String(value == null ? '' : value).trim();
  if (!s || s.length > FLEET_CONFIG_URL_MAX) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(s)) return false;
  let url;
  try {
    url = new URL(s);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  return true;
}

/** @returns {string} The stored URL, or '' when this screen has none. */
export function loadFleetConfigUrl() {
  try {
    const s = String(localStorage.getItem(FLEET_CONFIG_URL_STORAGE) || '').trim();
    // Re-validated on the way OUT as well as in: a hand-edited storage entry
    // must not be able to point the screen at http, or at nothing.
    return isValidFleetConfigUrl(s) ? s : '';
  } catch {
    return '';
  }
}

/**
 * Persist (or clear) this screen's fleet-config URL. An invalid value CLEARS
 * rather than being stored — the same "refuse to persist anything unusable"
 * rule the print server applies at its end.
 * @param {string} value Empty string clears it.
 * @returns {boolean} false when storage is unavailable.
 */
export function saveFleetConfigUrl(value) {
  const next = String(value == null ? '' : value).trim();
  try {
    if (isValidFleetConfigUrl(next)) localStorage.setItem(FLEET_CONFIG_URL_STORAGE, next);
    else localStorage.removeItem(FLEET_CONFIG_URL_STORAGE);
    window.dispatchEvent(new Event(FLEET_CONFIG_URL_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

/**
 * Which remote-config URL this page should actually fetch, given the URL flag
 * and what the display login provisioned. App.jsx calls exactly this — the
 * precedence rule lives here so it is testable rather than inline in a
 * component: an explicit `?config=` WINS, because someone standing at the
 * screen with a URL in their hand outranks what the print server last handed
 * it. Returns null when there is no remote config at all, which is the
 * "baked defaults + this device's overrides" case.
 * @param {string|null|undefined} flagUrl parseUrlFlags().configUrl
 * @param {string|null|undefined} provisionedUrl loadFleetConfigUrl()
 * @returns {string|null}
 */
export function resolveRemoteConfigUrl(flagUrl, provisionedUrl) {
  const flag = String(flagUrl == null ? '' : flagUrl).trim();
  if (flag) return flag;
  const provisioned = String(provisionedUrl == null ? '' : provisionedUrl).trim();
  // The provisioned one is re-checked here too: it is the only one of the two
  // that arrived over the wire, and it is about to be fetched.
  return isValidFleetConfigUrl(provisioned) ? provisioned : null;
}
