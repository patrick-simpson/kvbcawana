import { describe, it, expect, afterEach, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import StepPlate from './StepPlate.jsx';

// jsdom has no layout, so every box measures 0 and the plate draws nothing.
// Give elements a size for the drawing test, the way a browser would.
const sizes = { 'step-plate': [400, 120], 'step-plate__label': [80, 30], 'step-plate__body': [340, 95] };
const pick = (el, i) => {
  const key = Object.keys(sizes).find((k) => el.classList?.contains(k));
  return key ? sizes[key][i] : 0;
};
let saved;

describe('StepPlate', () => {
  afterEach(cleanup);

  it('renders the label on the pill and the content on the block', () => {
    const { container } = render(
      <StepPlate label="Signal" labelClassName="x-label" labelProps={{ 'aria-hidden': true }} bodyClassName="x-body">
        <span>connected</span>
      </StepPlate>
    );
    const label = container.querySelector('.step-plate__label.x-label');
    expect(label.textContent).toBe('Signal');
    expect(label.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('.step-plate__body.x-body').textContent).toBe('connected');
  });

  it('with no label is a bare block', () => {
    const { container } = render(<StepPlate>hi</StepPlate>);
    expect(container.querySelector('.step-plate--bare')).not.toBeNull();
    expect(container.querySelector('.step-plate__label')).toBeNull();
  });

  describe('with layout', () => {
    beforeAll(() => {
      saved = {
        w: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth'),
        h: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
        l: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft'),
        t: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
      };
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return pick(this, 0); } });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return pick(this, 1); } });
      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', { configurable: true, get() { return this.classList.contains('step-plate__body') ? 22 : 0; } });
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', { configurable: true, get() { return this.classList.contains('step-plate__body') ? 27 : 0; } });
    });
    afterAll(() => {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', saved.w);
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', saved.h);
      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', saved.l);
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', saved.t);
    });

    it('draws the plate, its keyline and a hidden seasonal echo behind the text, sized to the boxes', () => {
      const { container } = render(<StepPlate label="FYI" plate="var(--brand-hot)">A notice</StepPlate>);
      const svg = container.querySelector('svg.step-plate__shape');
      expect(svg).not.toBeNull();
      expect(svg.getAttribute('viewBox')).toBe('0 0 400 120');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      const fill = svg.querySelector('.step-plate__fill');
      expect(fill.style.fill).toBe('var(--brand-hot)');
      // Printed out of register: the fill is offset, the keyline is not.
      expect(fill.getAttribute('transform')).toMatch(/^translate\(\d/);
      expect(svg.querySelector('.step-plate__keyline').getAttribute('transform')).toBeNull();
      expect(svg.querySelector('.step-plate__echo')).not.toBeNull();
      // The SVG comes first, so the words paint over it.
      expect(container.querySelector('.step-plate').firstElementChild).toBe(svg);
    });

    describe('when its content resizes', () => {
      // jsdom has no ResizeObserver: a fake one that records what it watches
      // and lets the test deliver the browser's callback.
      let observers;
      let reads;
      beforeEach(() => {
        observers = [];
        reads = 0;
        vi.stubGlobal('ResizeObserver', class {
          constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
          observe(el) { this.targets.push(el); }
          unobserve() {}
          disconnect() { this.disconnected = true; }
        });
        const w = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
          configurable: true,
          get() { if (this.classList.contains('step-plate')) reads += 1; return w.get.call(this); },
        });
      });
      afterEach(() => {
        vi.unstubAllGlobals();
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return pick(this, 0); } });
        sizes['step-plate'] = [400, 120];
      });

      it('watches the plate, its pill and its block, and lets go when it leaves', () => {
        const { container, unmount } = render(<StepPlate label="Signal">connected</StepPlate>);
        expect(observers).toHaveLength(1);
        const [ro] = observers;
        expect(ro.targets).toEqual([
          container.querySelector('.step-plate'),
          container.querySelector('.step-plate__label'),
          container.querySelector('.step-plate__body'),
        ]);
        unmount();
        expect(ro.disconnected).toBe(true);
      });

      it('redraws in the same frame as the new words, never a frame late', () => {
        const { container } = render(<StepPlate label="Signal">connected</StepPlate>);
        const svg = () => container.querySelector('svg.step-plate__shape');
        expect(svg().getAttribute('viewBox')).toBe('0 0 400 120');
        sizes['step-plate'] = [640, 120];
        // The browser delivers the observer after layout and before paint,
        // outside any React batch: the outline must be redrawn by the time
        // the callback returns, or that frame paints the words off the plate.
        const prev = globalThis.IS_REACT_ACT_ENVIRONMENT;
        globalThis.IS_REACT_ACT_ENVIRONMENT = false;
        try {
          observers[0].cb([]);
          expect(svg().getAttribute('viewBox')).toBe('0 0 640 120');
        } finally {
          globalThis.IS_REACT_ACT_ENVIRONMENT = prev;
        }
      });

      it('reads its size only when something resized: never per render or per frame', async () => {
        const { rerender } = render(<StepPlate label="Signal">connected</StepPlate>);
        const after = reads;
        rerender(<StepPlate label="Signal">connected</StepPlate>);
        rerender(<StepPlate label="Signal">connected</StepPlate>);
        await new Promise((r) => setTimeout(r, 80));
        expect(reads).toBe(after);
      });
    });
  });
});
