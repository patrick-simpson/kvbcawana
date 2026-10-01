// @ts-check
import { useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';

/** The lobby's unit in px: 1% of a 16:9 stage's width (app.css --u). */
export function lobbyUnitPx() {
  return Math.min(window.innerWidth / 100, (window.innerHeight * 1.7778) / 100);
}

/**
 * Whether the element in `ref` stands taller than `maxU` lobby units, while
 * `active` (the element is mounted). Measured, not guessed from its words:
 * the status sticker's height depends on how its wording wraps in the face
 * that draws it at this screen's size. A ResizeObserver re-reads it when the
 * content or the screen changes, and applies the answer before the frame is
 * painted (flushSync), so whatever depends on it never shows a frame late.
 *
 * @param {{ current: HTMLElement | null }} ref
 * @param {number} maxU
 * @param {boolean} active
 * @returns {boolean}
 */
export function useTallerThan(ref, maxU, active) {
  const [tall, setTall] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      const u = lobbyUnitPx();
      const next = u > 0 && el.offsetHeight / u > maxU;
      flushSync(() => setTall(next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, maxU, active]);
  return active && tall;
}
