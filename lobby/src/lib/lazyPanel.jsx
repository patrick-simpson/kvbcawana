import { useEffect, useState } from 'react';

// Operator-only code on demand (code splitting, owner 2026-10-12): a panel no
// TV shows until a volunteer opens it lives in its own chunk, so the signage,
// the Pi's ?lowPower=1 embed and the OBS feeds never download, parse or run it
// on boot. The service worker precaches every emitted chunk (vite.config.js
// serviceWorker()), so an offline screen still opens its panels.
//
// lazyPanel(load) returns a component that renders the panel itself once its
// chunk is in hand, and its `fallback` prop (the panel's own chrome with a
// one-line "Opening…") until then:
// - `preload()` starts the import early (the gear's hover/focus/press, a
//   shortcut, Settings opening for the editor and debug panel, the settings
//   page at boot). A panel mounted after its chunk landed is the real panel
//   from its first render: no loading card, and a test that awaited
//   `preload()` mounts it in the same act() as before the split.
// - Not React.lazy/Suspense on purpose: Suspense holds a revealed panel back
//   behind its fallback for a throttle measured on timers (300 ms), which a
//   paused test clock never lets pass. Here the swap is one state update the
//   moment the import settles.
// - A failed import (deploy mid-session, offline with a cold cache) is thrown
//   from render into the panel's ErrorBoundary, which closes it exactly like a
//   panel that crashed. The failure is not kept: the next open asks again.

/**
 * @template P
 * @param {() => Promise<{ default: (props: P) => any }>} load
 */
export function lazyPanel(load) {
  /** @type {any} */
  let pending = null;

  function preload() {
    if (pending && pending.status !== 'rejected') return pending;
    const p = /** @type {any} */ (load());
    p.status = 'pending';
    p.then(
      (/** @type {any} */ mod) => { p.status = 'fulfilled'; p.value = mod; },
      (/** @type {any} */ err) => { p.status = 'rejected'; p.reason = err; },
    );
    pending = p;
    return p;
  }

  /** @param {P & { fallback?: any }} props */
  function LazyPanel({ fallback = null, ...props }) {
    const [state, setState] = useState(() => (pending?.status === 'fulfilled' ? { mod: pending.value } : {}));
    useEffect(() => {
      if (state.mod || state.error) return undefined;
      let live = true;
      preload().then(
        (/** @type {any} */ mod) => { if (live) setState({ mod }); },
        (/** @type {any} */ error) => { if (live) setState({ error }); },
      );
      return () => { live = false; };
    }, [state]);
    if (state.error) throw state.error;
    if (!state.mod) return fallback;
    const Panel = state.mod.default;
    return <Panel {...props} />;
  }
  LazyPanel.preload = () => preload().then(() => undefined, () => undefined);
  return LazyPanel;
}
