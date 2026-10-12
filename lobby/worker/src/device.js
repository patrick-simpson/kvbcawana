// @ts-check
// Who made a change (routes.md 10.1), for the change log (changes.js). Read from
// two optional headers the settings page and the screens send on every call:
//
//   X-Device        16..64 of A-Za-z0-9_-: the page's awanaDevice.v1 id, a screen's
//                   awanaScreens.v1 id
//   X-Device-Name   encodeURIComponent(name), cleaned like a screen's name (40)
//
// A registered station (X-Station) wins: {kind: 'station', id, name} from the
// station registry. An X-Device that is a registered screen is {kind: 'screen'}
// with the registry's name. Anything else that names itself is {kind: 'page'};
// neither header is {kind: 'unknown', name: 'Unknown device'}. Never an IP, a
// user agent or a session: nothing here identifies a person.

import { cleanScreenName, isScreenId } from '../../src/lib/syncSpecs.js';

/** @typedef {{ kind: 'page'|'screen'|'station'|'unknown', id?: string, name: string }} Device */

export const UNKNOWN_DEVICE = Object.freeze({ kind: 'unknown', name: 'Unknown device' });

/** The X-Device-Name header, decoded and cleaned ('' for none or a bad escape). @param {string|null} raw */
export function deviceName(raw) {
  if (!raw) return '';
  try {
    return cleanScreenName(decodeURIComponent(raw));
  } catch {
    return '';
  }
}

/**
 * The device a request came from.
 * @param {Request} request
 * @param {{ station: (id: string) => Promise<{ name: string }|null>, screen: (id: string) => Promise<{ name: string }|null> }} lookup
 * @returns {Promise<Device>}
 */
export async function deviceOf(request, lookup) {
  const stationId = request.headers.get('X-Station') || '';
  if (stationId) {
    const s = await lookup.station(stationId);
    if (s) return { kind: 'station', id: stationId, name: s.name };
  }
  const rawId = request.headers.get('X-Device') || '';
  const id = isScreenId(rawId) ? rawId : '';
  const name = deviceName(request.headers.get('X-Device-Name'));
  if (id) {
    const screen = await lookup.screen(id);
    if (screen) return { kind: 'screen', id, name: screen.name };
  }
  if (!id && !name) return { ...UNKNOWN_DEVICE };
  return { kind: 'page', ...(id ? { id } : {}), name: name || 'Unnamed device' };
}
