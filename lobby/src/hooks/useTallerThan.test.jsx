import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { act, useRef } from 'react';
import { useTallerThan } from './useTallerThan.js';

let observers;
let height;
beforeEach(() => {
  observers = [];
  height = 80;
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(el) { this.targets.push(el); }
    disconnect() { this.disconnected = true; }
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1080 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Probe({ active, maxU }) {
  const ref = useRef(null);
  const tall = useTallerThan(ref, maxU, active);
  return (
    <div>
      {active && <div ref={ref} className="box" />}
      <span data-tall={String(tall)} />
    </div>
  );
}

describe('useTallerThan', () => {
  it('measures the element in lobby units, and follows it as it grows and shrinks', () => {
    const box = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('box') ? height : 0; } });
    try {
      const { container } = render(<Probe active maxU={5.2} />);
      const tall = () => container.querySelector('[data-tall]').dataset.tall;
      expect(observers).toHaveLength(1);
      expect(observers[0].targets[0]).toBe(container.querySelector('.box'));
      // u is 19.2px at 1920x1080: 80px is 4.2u, 120px is 6.3u.
      act(() => observers[0].cb([]));
      expect(tall()).toBe('false');
      height = 120;
      act(() => observers[0].cb([]));
      expect(tall()).toBe('true');
      height = 90;
      act(() => observers[0].cb([]));
      expect(tall()).toBe('false');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', box);
    }
  });

  it('is never tall while the element is not there, and lets go of it', () => {
    const { container, rerender } = render(<Probe active maxU={5.2} />);
    height = 500;
    const box = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return this.classList.contains('box') ? height : 0; } });
    try {
      act(() => observers[0].cb([]));
      expect(container.querySelector('[data-tall]').dataset.tall).toBe('true');
      rerender(<Probe active={false} maxU={5.2} />);
      expect(observers[0].disconnected).toBe(true);
      expect(container.querySelector('[data-tall]').dataset.tall).toBe('false');
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', box);
    }
  });
});
