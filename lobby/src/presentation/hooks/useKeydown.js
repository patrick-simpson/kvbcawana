import { useEffect, useRef } from 'react';

/**
 * Shared window keydown listener with a stable subscription — the
 * handler ref is swapped per render, so callers never re-attach
 * listeners (and never leak them).
 */
export function useKeydown(handler) {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  }, [handler]);

  useEffect(() => {
    const listen = (e) => ref.current(e);
    window.addEventListener('keydown', listen);
    return () => window.removeEventListener('keydown', listen);
  }, []);
}
