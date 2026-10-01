import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { StepChip } from './StepChip.jsx';
import { chipGeometry, inkEm, measureEm } from '../lib/chip.js';

afterEach(cleanup);

/** The label and value <text> elements of the one chip in `container`. */
const texts = (container) => {
  const [label, value] = container.querySelectorAll('.pj-chip svg text');
  return { label, value };
};

describe('the projector\'s StepChip', () => {
  // textLength pins a text to a width with lengthAdjust="spacingAndGlyphs",
  // so a width measured at one size and drawn at another squeezes every
  // glyph: the value is drawn at 1.06x, so its width must be taken there.
  it('pins each text to its natural width at the size it is drawn, so no glyph is squeezed', () => {
    for (const [label, value] of [['Game ends', '6:30 PM'], ['Heads up', 'TWO MINUTES'], ['Happy birthday', 'Maya & Ben']]) {
      const { container, unmount } = render(<StepChip label={label} value={value} />);
      const t = texts(container);
      const l = label.toUpperCase();
      const g = chipGeometry(measureEm(l), measureEm(value), inkEm(value));
      expect(Number(t.value.getAttribute('font-size'))).toBe(g.value.size);
      expect(t.value.getAttribute('textLength')).toBe((measureEm(value) * g.value.size).toFixed(3));
      expect(t.label.getAttribute('textLength')).toBe((measureEm(l) * g.label.size).toFixed(3));
      unmount();
    }
  });

  it('a counting chip sizes its block for the stand-in but draws the real value at its own width', () => {
    const { container } = render(<StepChip label="Back to schedule in" value="7s" fitValue="00s" />);
    const t = texts(container);
    const size = Number(t.value.getAttribute('font-size'));
    expect(t.value.getAttribute('textLength')).toBe((measureEm('7s') * size).toFixed(3));
    const chip = container.querySelector('.pj-chip');
    const wide = chipGeometry(measureEm('BACK TO SCHEDULE IN'), measureEm('00s'), inkEm('7s'));
    expect(chip.style.width).toBe(`${wide.width.toFixed(3)}em`);
  });

  it('seats a value with marks by its ink, so they keep off the keyline', () => {
    const { container } = render(<StepChip label="Happy birthday" value="Ștefan & Élodie" />);
    const plain = render(<StepChip label="Happy birthday" value="Stefan & Elodie" />).container;
    const marked = texts(container).value;
    const unmarked = texts(plain).value;
    // The plain value keeps the catalog's seat; the marked one does not.
    expect(Number(unmarked.getAttribute('font-size'))).toBe(1.06);
    expect(Number(marked.getAttribute('font-size'))).toBeLessThan(1.06);
    expect(marked.getAttribute('y')).not.toBe(unmarked.getAttribute('y'));
  });
});
