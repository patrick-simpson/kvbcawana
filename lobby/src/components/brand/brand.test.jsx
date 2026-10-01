import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import StepChip from './StepChip.jsx';
import Wave from './Wave.jsx';
import CornerTab from './CornerTab.jsx';
import Sticker from './Sticker.jsx';
import DoodleCluster from './DoodleCluster.jsx';
import { SHAPES, DOODLES, measureEm } from '../../lib/brand.js';
import { useFontsReady } from '../../hooks/useFontsReady.js';

afterEach(cleanup);

describe('StepChip', () => {
  it('reads as one label to assistive tech and hides its drawing', () => {
    render(<StepChip label="TONIGHT" value={23} />);
    const chip = screen.getByRole('img', { name: 'TONIGHT 23' });
    expect(chip.querySelector('svg').getAttribute('aria-hidden')).toBe('true');
  });

  it('pins each text to its measured width so a late font can never spill', () => {
    const { container } = render(<StepChip label="RIGHT NOW" value="7:56" />);
    const [label, value] = container.querySelectorAll('text');
    expect(label.textContent).toBe('RIGHT NOW');
    expect(value.textContent).toBe('7:56');
    for (const t of [label, value]) {
      expect(Number(t.getAttribute('textLength'))).toBeGreaterThan(0);
      expect(t.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
    }
  });

  it('seats a value with a mark by its ink, off the keyline, and pins it at the size it is drawn', () => {
    const value = (c) => c.querySelectorAll('text')[1];
    const plain = value(render(<StepChip label="WELCOME" value="JOSE" />).container);
    const accent = value(render(<StepChip label="WELCOME" value="JOSÉ" />).container);
    const comma = value(render(<StepChip label="WELCOME" value="ȘTEFAN" />).container);
    // The accent moves the value down, away from the block's top edge; the
    // comma moves it up, away from its bottom edge.
    expect(Number(accent.getAttribute('y'))).toBeGreaterThan(Number(plain.getAttribute('y')));
    expect(Number(comma.getAttribute('y'))).toBeLessThan(Number(plain.getAttribute('y')));
    for (const [t, text] of [[plain, 'JOSE'], [accent, 'JOSÉ'], [comma, 'ȘTEFAN']]) {
      expect(t.getAttribute('textLength')).toBe((measureEm(text) * Number(t.getAttribute('font-size'))).toFixed(3));
    }
  });

  it('widens for a longer value', () => {
    const { container: a } = render(<StepChip label="WED" value="7" />);
    const { container: b } = render(<StepChip label="WED" value="SEP 30" />);
    const w = (c) => parseFloat(c.querySelector('.step-chip').style.width);
    expect(w(b)).toBeGreaterThan(w(a));
  });

  it('prints the catalog charcoal plate by default, or the one it is given', () => {
    const { container, rerender } = render(<StepChip label="A" value="B" />);
    const plate = () => container.querySelector('.step-chip__plate');
    expect(plate().getAttribute('fill')).toBe('#030404');
    expect(plate().getAttribute('fill-opacity')).toBe('0.5');
    rerender(<StepChip label="A" value="B" plate="#123456" />);
    expect(plate().getAttribute('fill')).toBe('#123456');
    expect(plate().getAttribute('fill-opacity')).toBeNull();
  });

  it('sizes from the value font size and passes through class and style', () => {
    const { container } = render(<StepChip label="A" value="B" size="3rem" className="x" style={{ opacity: 0.5 }} />);
    const chip = container.querySelector('.step-chip');
    expect(chip.classList.contains('x')).toBe(true);
    expect(chip.style.fontSize).toBe('3rem');
    expect(chip.style.opacity).toBe('0.5');
  });
});

describe('Wave', () => {
  it('draws the kit wave in the given color, stretched to its box', () => {
    const { container } = render(<Wave color="#58BD79" className="banner-wave" />);
    const svg = container.querySelector('.brand-wave.banner-wave svg');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('viewBox')).toBe(SHAPES.wave.viewBox);
    expect(svg.querySelector('path').getAttribute('fill')).toBe('#58BD79');
    expect(svg.style.transform).toBe('');
  });

  it('mirrors when flipped', () => {
    const { container } = render(<Wave color="#fff" flip />);
    expect(container.querySelector('svg').style.transform).toBe('scaleX(-1)');
  });
});

describe('CornerTab', () => {
  it('fills the kit tab with its section color and holds its content', () => {
    const { container } = render(<CornerTab color="#F04A4B"><span>SPARKS</span></CornerTab>);
    const tab = container.querySelector('.brand-tab');
    expect(tab.style.getPropertyValue('--tab-color')).toBe('#F04A4B');
    expect(tab.querySelector('path').getAttribute('d')).toBe(SHAPES.tab.d);
    expect(tab.querySelector('.brand-tab__content').textContent).toBe('SPARKS');
  });
});

describe('Sticker', () => {
  it('is a hot starburst by default, tilted', () => {
    const { container } = render(<Sticker>NEW!</Sticker>);
    const s = container.querySelector('.brand-sticker--starburst');
    expect(s.querySelector('path').getAttribute('fill')).toBe('var(--brand-hot)');
    expect(s.querySelector('.brand-sticker__text').style.transform).toBe('rotate(-8deg)');
    expect(s.textContent).toBe('NEW!');
  });

  it('can be a plain disc', () => {
    const { container } = render(<Sticker kind="disc" color="#FCB614" tilt={4}>1st</Sticker>);
    const s = container.querySelector('.brand-sticker--disc');
    expect(s.querySelector('circle').getAttribute('fill')).toBe('#FCB614');
    expect(s.querySelector('.brand-sticker__text').style.transform).toBe('rotate(4deg)');
  });
});

describe('DoodleCluster', () => {
  const items = [
    { kind: 'sparkle', x: '10%', y: '10%', size: '2em' },
    { kind: 'dot', x: '30%', y: '20%', size: '0.5em' },
    { kind: 'squiggle', x: '50%', y: '40%', size: '3em', rotate: 12 },
  ];

  it('draws each doodle, filled or stroked as the kit file is, in one color', () => {
    const { container } = render(<DoodleCluster items={items} color="#FCB614" />);
    const doodles = container.querySelectorAll('.brand-doodle');
    expect(doodles).toHaveLength(3);
    expect(doodles[0].style.color).toBe('rgb(252, 182, 20)');
    expect(doodles[0].querySelector('path').getAttribute('fill')).toBe('currentColor');
    const squiggle = doodles[2].querySelector('path');
    expect(squiggle.getAttribute('fill')).toBe('none');
    expect(squiggle.getAttribute('stroke')).toBe('currentColor');
    const [, , w, h] = DOODLES.sparkle.viewBox.split(/\s+/);
    expect(doodles[0].style.aspectRatio).toBe(`${w} / ${h}`);
  });

  it('skips a doodle the kit does not have instead of drawing garbage', () => {
    const { container } = render(<DoodleCluster items={[{ kind: 'nope', x: '0', y: '0', size: '1em' }, items[0]]} />);
    expect(container.querySelectorAll('.brand-doodle')).toHaveLength(1);
  });

  it('adds the breathing loop on its own element only when asked', () => {
    const { container, rerender } = render(<DoodleCluster items={items} />);
    expect(container.querySelector('.brand-doodle__twinkle')).toBeNull();
    rerender(<DoodleCluster items={items} twinkle />);
    expect(container.querySelectorAll('.brand-doodle__twinkle')).toHaveLength(3);
  });

  it('is decoration only', () => {
    const { container } = render(<DoodleCluster items={items} />);
    expect(container.querySelector('.brand-doodles').getAttribute('aria-hidden')).toBe('true');
  });
});

describe('useFontsReady', () => {
  function Probe() {
    return <span data-testid="loads">{useFontsReady()}</span>;
  }

  afterEach(() => {
    delete document.fonts;
  });

  it('does nothing without document.fonts', () => {
    render(<Probe />);
    expect(screen.getByTestId('loads').textContent).toBe('0');
  });

  it('re-renders when the pending load settles and on every later load', async () => {
    const listeners = new Set();
    let resolveReady;
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: {
        status: 'loading',
        ready: new Promise((r) => { resolveReady = r; }),
        addEventListener: vi.fn((type, fn) => listeners.add(fn)),
        removeEventListener: vi.fn((type, fn) => listeners.delete(fn)),
      },
    });
    const { unmount } = render(<Probe />);
    expect(screen.getByTestId('loads').textContent).toBe('0');
    await act(async () => { resolveReady(); });
    expect(screen.getByTestId('loads').textContent).toBe('1');
    act(() => { for (const fn of listeners) fn(); });
    expect(screen.getByTestId('loads').textContent).toBe('2');
    unmount();
    expect(listeners.size).toBe(0);
  });
});
