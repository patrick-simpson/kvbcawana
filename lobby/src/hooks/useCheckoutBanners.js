// @ts-check
import { useCallback, useEffect, useRef, useState } from 'react';
import { LEAVE_BANNER_MS, enqueueLeaves } from '../lib/checkoutLeaves.js';

/** @typedef {import('../lib/checkoutLeaves.js').LeaveItem & { id: number }} QueuedLeave */

/**
 * The "has checked out" banners, one at a time (src/lib/checkoutLeaves.js
 * says WHAT may be said; this only takes turns). Each banner holds for
 * `holdMs`; while `held` (a child's check-in moment is up, which outranks
 * everything) the head waits, unseen, and gets its full time once the name has
 * gone. The queue is held to LEAVE_QUEUE_CAP banners by enqueueLeaves, so a
 * rush never keeps the foot for minutes. `clear()` empties it (pickup time is
 * over).
 *
 * @param {{ held?: boolean, holdMs?: number }} [opts]
 * @returns {{ current: QueuedLeave | null, add: (items: import('../lib/checkoutLeaves.js').LeaveItem[]) => void, clear: () => void }}
 */
export function useCheckoutBanners({ held = false, holdMs = LEAVE_BANNER_MS } = {}) {
  const [queue, setQueue] = useState(/** @type {QueuedLeave[]} */ ([]));
  const nextId = useRef(1);

  const add = useCallback((/** @type {import('../lib/checkoutLeaves.js').LeaveItem[]} */ items) => {
    if (!items?.length) return;
    setQueue((q) => enqueueLeaves(q, items).map((item) => (
      'id' in item ? /** @type {QueuedLeave} */ (item) : { ...item, id: nextId.current++ }
    )));
  }, []);
  const clear = useCallback(() => setQueue((q) => (q.length ? [] : q)), []);

  const head = queue[0] ?? null;
  // The head's own clock, restarted whenever it is shown again.
  useEffect(() => {
    if (!head || held) return undefined;
    const t = setTimeout(() => setQueue((q) => (q[0] === head ? q.slice(1) : q)), holdMs);
    return () => clearTimeout(t);
  }, [head, held, holdMs]);

  return { current: held ? null : head, add, clear };
}
