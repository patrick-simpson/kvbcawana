import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HEADLINE_LINE_HEIGHT, Headline, fittedSize, headlineBox } from './Headline.jsx';
import { measureEm } from '../lib/chip.js';

describe('the one headline', () => {
  afterEach(cleanup);

  it('sets each word as its own unbreakable unit, in the shout voice', () => {
    const { container } = render(<Headline text="Welcome to Awana" />);
    const h = container.querySelector('h1.pj-headline');
    expect(h.textContent).toBe('Welcome to Awana');
    expect([...h.querySelectorAll('.w')].map((w) => w.textContent)).toEqual(['Welcome', 'to', 'Awana']);
  });

  it('fits a title to one line, within its bounds', () => {
    const short = fittedSize('HI', { maxU: 7.6, widthU: 82 });
    expect(short).toBe('calc(7.600 * var(--u))');
    const em = measureEm('HAVE A GREAT NIGHT!');
    expect(fittedSize('Have a great night!', { maxU: 20, widthU: 82, minU: 1 })).toBe(`calc(${(82 / em).toFixed(3)} * var(--u))`);
    // Too long for one line: it stops shrinking and wraps between words.
    expect(fittedSize('x '.repeat(80), { maxU: 7.6, widthU: 82, minU: 5 })).toBe('calc(5.000 * var(--u))');
  });

  it('a plain title keeps the plain line box; one with a tall mark gets room for it', () => {
    expect(headlineBox('Welcome to Awana')).toEqual({ lineHeight: HEADLINE_LINE_HEIGHT, padTop: 0, padBottom: 0 });
    const { container } = render(<Headline text="Game time!" />);
    expect(container.querySelector('h1').style.lineHeight).toBe('');

    const one = headlineBox('José');
    expect(one.lineHeight).toBe(HEADLINE_LINE_HEIGHT); // one word never wraps
    expect(one.padTop).toBeGreaterThan(0.2);
    expect(one.padBottom).toBe(0);
    const two = headlineBox('¡Bienvenidos, Ștefan! Inscripción abierta');
    // Rows far enough apart that a comma below one row clears an accent on the next.
    expect(two.lineHeight).toBeGreaterThanOrEqual(0.36 + 0.06 + 1.05 - 1e-9);
    // ...and every mark stays inside the headline's box, top and bottom.
    const above = (0.96 - 0.436 + two.lineHeight) / 2;
    expect(above + two.padTop).toBeGreaterThanOrEqual(1.05 - 1e-9);
    expect(two.lineHeight - above + two.padBottom).toBeGreaterThanOrEqual(0.36 - 1e-9);
    const { container: c2 } = render(<Headline text="Inscripción abierta" />);
    const h = c2.querySelector('h1');
    expect(parseFloat(h.style.lineHeight)).toBeGreaterThan(HEADLINE_LINE_HEIGHT);
    expect(h.style.paddingTop).not.toBe('0em');
  });
});
