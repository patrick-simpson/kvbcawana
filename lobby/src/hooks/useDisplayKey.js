// @ts-check
import { useCallback, useEffect, useState } from 'react';
import {
  DISPLAY_KEY_CHANGE_EVENT,
  loadDisplayKey,
  saveDisplayKey,
} from '../lib/displayKey.js';

/**
 * This screen's display key, kept in sync across tabs.
 *
 * Deliberately NOT part of useConfig: the key must never travel through
 * `sanitizeOverrides`, because that same table backs `?config=<url>` and the
 * Settings export file. See the long comment in src/lib/displayKey.js.
 *
 * Two listeners, not one: the `storage` event only fires in OTHER tabs, so
 * without the custom event, saving a key in Settings would not re-key the
 * socket in the tab you are looking at.
 *
 * @returns {{displayKey: string, setDisplayKey: (v: string) => boolean}}
 */
export function useDisplayKey() {
  const [displayKey, setKey] = useState(loadDisplayKey);

  useEffect(() => {
    const refresh = () => setKey(loadDisplayKey());
    const onStorage = (/** @type {StorageEvent} */ e) => {
      if (e.key === null || e.key === 'awanaDisplayKey.v1') refresh();
    };
    window.addEventListener(DISPLAY_KEY_CHANGE_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DISPLAY_KEY_CHANGE_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const set = useCallback((/** @type {string} */ value) => {
    const ok = saveDisplayKey(value);
    // saveDisplayKey fires the change event, but do not depend on that for the
    // local update: if localStorage is blocked the event still fires and
    // loadDisplayKey still returns '', which would silently discard the paste.
    if (ok) setKey(String(value == null ? '' : value).trim());
    return ok;
  }, []);

  return { displayKey, setDisplayKey: set };
}
