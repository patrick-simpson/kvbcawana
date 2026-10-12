// @ts-check
// Display login: what this screen forgets when it is logged out.
//
// A screen signs in through the sync service (src/hooks/useSync.js), which
// hands it the display key. The old way (a `provision` frame on the Pusher
// cache channel, opened with a passphrase-derived key) is gone with Pusher;
// what remains here is the logout, which also clears the two legacy storage
// entries an older build of this page may have left on a screen.

import { saveDisplayKey } from './displayKey.js';
import { savePublishToken } from './publishToken.js';
import { saveFleetConfigUrl } from './fleetConfigUrl.js';

/** Left behind by older builds; removed on logout, never read. */
export const LEGACY_LOGIN_KEY_STORAGE = 'awanaLoginKey.v1';
export const LEGACY_LOGIN_ISSUED_STORAGE = 'awanaLoginIssuedAt.v1';

/** @typedef {'logged-out'|'logged-in'|'stale'|'wrong'|'busy'|'unsupported'} LoginStatus */

/** Forget the display key, the publish token and the fleet-config URL on this screen. */
export function logout() {
  try {
    localStorage.removeItem(LEGACY_LOGIN_KEY_STORAGE);
    localStorage.removeItem(LEGACY_LOGIN_ISSUED_STORAGE);
  } catch {
    /* storage blocked: nothing to forget */
  }
  saveDisplayKey('');
  savePublishToken('');
  // The fleet-config URL came from the same login, so it goes with it: a
  // screen being un-provisioned must not keep following a fleet it has just
  // been removed from.
  saveFleetConfigUrl('');
}
