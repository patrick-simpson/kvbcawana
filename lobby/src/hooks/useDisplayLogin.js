// @ts-check
import { useCallback, useState } from 'react';
import { logout } from '../lib/displayLogin.js';
import { signIn, signOut, useSync } from './useSync.js';
import { useConfig } from './useConfig.js';

/**
 * This screen's display-login state, for the Settings panels and the
 * projector's menu: the church passphrase signs in through the sync service
 * (src/hooks/useSync.js), and this hook reports that sign-in in one set of
 * words. `template: false`: the "new screen" template is the lobby's.
 *
 * Deliberately NOT part of useConfig: the display key lives in its own storage
 * slot (src/lib/displayKey.js).
 */
export function useDisplayLogin() {
  const sync = useSync();
  const { config, updateConfig } = useConfig();
  const [syncResult, setSyncResult] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);

  const login = useCallback(async (/** @type {string} */ passphrase) => {
    setBusy(true);
    const res = await signIn(passphrase, { config, overrides: {}, updateConfig, template: false });
    setBusy(false);
    /** @type {any} */
    const r = res;
    const word = r.ok ? 'logged-in' : r.reason === 'storage' ? 'storage' : r.reason === 'locked' ? 'locked' : 'wrong';
    setSyncResult(r.ok ? null : (r.reason === 'locked' ? 'locked' : r.reason === 'wrong' ? 'wrong' : r.reason));
    return word;
  }, [config, updateConfig]);

  const doLogout = useCallback(() => {
    signOut();
    logout();
  }, []);

  /** @type {import('../lib/displayLogin.js').LoginStatus} */
  let loginStatus = 'logged-out';
  if (busy) loginStatus = 'busy';
  else if (sync.signedIn) loginStatus = 'logged-in';
  else if (sync.phase === 'expired') loginStatus = 'stale';
  else if (syncResult === 'wrong' || syncResult === 'locked') loginStatus = 'wrong';
  return {
    loginStatus,
    kid: sync.kid,
    hasLoginKey: sync.signedIn,
    syncProblem: syncResult,
    login,
    logout: doLogout,
  };
}
