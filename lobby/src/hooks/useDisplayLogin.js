// @ts-check
import { useCallback, useState, useSyncExternalStore } from 'react';
import {
  getSnapshot,
  loadLoginKey,
  loginWithPassphrase,
  logout,
  subscribe,
} from '../lib/displayLogin.js';
import { signIn, signOut, useSync } from './useSync.js';
import { useConfig } from './useConfig.js';

/**
 * This screen's display-login state, for the Settings panels.
 *
 * Deliberately NOT part of useConfig: the login key lives in its own storage
 * slot for the same reasons the display key does. See src/lib/displayLogin.js.
 *
 * Once the site names a sync service (shared/sync.json), the passphrase signs
 * in through it instead (src/hooks/useSync.js), and this hook reports that
 * sign-in in the same words, so the projector page's menu and setup note work
 * unchanged. `template: false`: the "new screen" template is the lobby's.
 */
export function useDisplayLogin() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const sync = useSync();
  const { config, updateConfig } = useConfig();
  const [syncResult, setSyncResult] = useState(/** @type {string|null} */ (null));
  const [busy, setBusy] = useState(false);
  const viaSync = Boolean(sync.url);

  const login = useCallback(async (/** @type {string} */ passphrase) => {
    if (!viaSync) return loginWithPassphrase(passphrase);
    setBusy(true);
    const res = await signIn(passphrase, { config, overrides: {}, updateConfig, template: false });
    setBusy(false);
    /** @type {any} */
    const r = res;
    const word = r.ok ? 'logged-in' : r.reason === 'storage' ? 'storage' : r.reason === 'locked' ? 'locked' : 'wrong';
    setSyncResult(r.ok ? null : (r.reason === 'locked' ? 'locked' : r.reason === 'wrong' ? 'wrong' : r.reason));
    return word;
  }, [viaSync, config, updateConfig]);

  const doLogout = useCallback(() => {
    if (viaSync) signOut();
    logout();
  }, [viaSync]);

  if (viaSync) {
    /** @type {import('../lib/displayLogin.js').LoginStatus} */
    let loginStatus = 'logged-out';
    if (busy) loginStatus = 'busy';
    else if (sync.signedIn) loginStatus = 'logged-in';
    else if (sync.phase === 'expired') loginStatus = 'stale';
    else if (syncResult === 'wrong' || syncResult === 'locked') loginStatus = 'wrong';
    return {
      ...snap,
      frameStatus: 'received',
      loginStatus,
      kid: sync.kid,
      pendingLogin: false,
      hasLoginKey: sync.signedIn,
      viaSync: true,
      syncProblem: syncResult,
      login,
      logout: doLogout,
    };
  }
  return { ...snap, hasLoginKey: Boolean(loadLoginKey()), viaSync: false, syncProblem: null, login, logout: doLogout };
}
