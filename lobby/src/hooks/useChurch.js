// @ts-check
// The church-wide printing settings document (routes.md 10.3), as one small
// shared store: every Printing card reads the same document, saves against the
// same revision, and a stale 409 puts the NEWER document in for all of them
// (each card keeps its own unsaved typing and re-applies it, churchClient.js).

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { churchState, fetchChurch, saveChurch, startFromDefaults } from '../lib/churchClient.js';
import { useSync } from './useSync.js';

/** @typedef {import('../lib/churchClient.js').ChurchDoc} ChurchDoc */

/** @type {{ doc: ChurchDoc | null, loading: boolean, error: string }} */
let snapshot = { doc: null, loading: false, error: '' };
/** @type {Set<() => void>} */
const listeners = new Set();
/** @param {Partial<typeof snapshot>} patch */
function set(patch) { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); }

export async function reloadChurch() {
  set({ loading: true });
  const r = await fetchChurch();
  if (r.ok) set({ doc: r.doc, loading: false, error: '' });
  else set({ loading: false, error: r.message });
}

/** Put a newer document in for every card (a stale 409 handed it back). @param {ChurchDoc} doc */
export function adoptChurch(doc) { set({ doc, error: '' }); }

/** @returns {{ doc: ChurchDoc | null, state: 'loading' | 'unseeded' | 'paused' | 'ready', loading: boolean, error: string,
 *   save: (changes: Record<string, any>) => ReturnType<typeof saveChurch>, reload: () => void, seedFromDefaults: () => Promise<{ok: boolean, message?: string}> }} */
export function useChurch({ load = true } = {}) {
  const { signedIn } = useSync();
  const s = useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => snapshot, () => snapshot);
  useEffect(() => { if (load && signedIn && !snapshot.doc && !snapshot.loading) reloadChurch(); }, [load, signedIn]);

  const save = useCallback(
    /** @param {Record<string, any>} changes */
    async (changes) => {
      const cur = snapshot.doc;
      if (!cur) return { ok: /** @type {const} */ (false), kind: /** @type {const} */ ('error'), message: 'The settings have not loaded yet.' };
      const r = await saveChurch(cur, changes);
      if (r.ok) adoptChurch(r.doc);
      else if (r.kind === 'stale') adoptChurch(r.doc);
      return r;
    }, []);

  const seedFromDefaults = useCallback(async () => {
    const r = await startFromDefaults();
    if (r.ok) { await reloadChurch(); return { ok: true }; }
    return { ok: false, message: r.message };
  }, []);

  return { doc: s.doc, state: churchState(s.doc), loading: s.loading, error: s.error, save, reload: reloadChurch, seedFromDefaults };
}

/** Test seam. */
export function _resetChurchForTest() { snapshot = { doc: null, loading: false, error: '' }; listeners.forEach((fn) => fn()); }
