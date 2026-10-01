import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import WeatherGlyph, { WEATHER_BOLT, WEATHER_GLYPHS } from './WeatherGlyph.jsx';
import CornerChip from './CornerChip.jsx';
import { weatherPresentation } from '../lib/weather.js';

afterEach(cleanup);
const zero = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

describe('WeatherGlyph', () => {
  it('draws every icon weatherPresentation can name', () => {
    const icons = new Set();
    for (let code = 0; code <= 99; code++) {
      icons.add(weatherPresentation(code, true).icon);
      icons.add(weatherPresentation(code, false).icon);
    }
    for (const icon of icons) expect(WEATHER_GLYPHS).toContain(icon);
  });

  it('is decorative, and falls back to the plain cloud', () => {
    const { container } = render(<WeatherGlyph kind="rain" />);
    const svg = container.querySelector('svg.weather-glyph');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.dataset.glyph).toBe('rain');
    cleanup();
    const other = render(<WeatherGlyph kind="volcano" />).container;
    expect(other.querySelector('svg').dataset.glyph).toBe('cloud');
  });

  // framer-motion writes an SVG element's opacity as an ATTRIBUTE (and only
  // its transform into style), so both places are read.
  const opacityOf = (el) => {
    const v = el.getAttribute('opacity') ?? el.style.opacity;
    return v === null || v === '' ? 1 : Number(v);
  };
  // The loops' resting transforms: nothing moved, or the sun's rays one ray
  // on (45 degrees of eight rays is the same drawing).
  const atRest = (el) => ['', 'none'].includes(el.style.transform)
    || (el.dataset.loop === 'rays' && /^rotate\(45deg\)$/.test(el.style.transform));

  it.each(WEATHER_GLYPHS)('under zero animation, the %s glyph rests whole, in place', async (kind) => {
    const { container } = zero(<WeatherGlyph kind={kind} />);
    // Let framer-motion write whatever it is going to write.
    await new Promise((r) => setTimeout(r, 200));
    const all = container.querySelectorAll('g, path');
    expect(all.length).toBeGreaterThan(0);
    for (const el of all) {
      expect(opacityOf(el)).toBe(1);
      expect(atRest(el)).toBe(true);
    }
  });

  it('draws each sky from its own pieces, never a stand-in cloud', () => {
    const loops = (kind) => [...render(<WeatherGlyph kind={kind} />).container.querySelectorAll('[data-loop]')].map((g) => g.dataset.loop);
    const has = (kind, d) => { const r = render(<WeatherGlyph kind={kind} />); const ok = [...r.container.querySelectorAll('path')].some((p) => p.getAttribute('d') === d); cleanup(); return ok; };
    expect(has('storm', WEATHER_BOLT)).toBe(true);
    expect(has('rain', WEATHER_BOLT)).toBe(false);
    expect(loops('storm')).toEqual(['drift', 'flicker']);
    cleanup();
    expect(loops('rain').filter((l) => l === 'fall')).toHaveLength(3);
    cleanup();
    expect(loops('snow').filter((l) => l === 'fall')).toHaveLength(3);
    cleanup();
    expect(loops('sun')).toEqual(['rays']);
    cleanup();
    expect(loops('moon')).toEqual(['twinkle']);
    cleanup();
    expect(loops('partly')).toEqual(['rays', 'drift']);
    cleanup();
    expect(loops('fog')).toEqual(['drift', 'drift', 'drift']);
    cleanup();
    expect(loops('cloud')).toEqual(['drift']);
  });

  it.each(['sun', 'moon', 'cloud', 'rain'])('on the live lobby the %s glyph\'s loop really moves it', async (kind) => {
    // framer-motion places a transform on an SVG group only if the group
    // starts with one (its box is measured at mount); a loop with no
    // `initial` animates nothing but opacity.
    const { container } = render(<WeatherGlyph kind={kind} />);
    await new Promise((r) => setTimeout(r, 200));
    const loops = [...container.querySelectorAll('[data-loop]')].filter((g) => g.dataset.loop !== 'flicker');
    expect(loops.length).toBeGreaterThan(0);
    // Every looping group carries a transform framer-motion placed ('none'
    // while a delayed drop waits its turn), and the glyph is on the move.
    for (const g of loops) expect(g.style.transform).not.toBe('');
    expect(loops.some((g) => /rotate|translate|scale/.test(g.style.transform))).toBe(true);
  });

  it('rides the weather chip, and only the weather chip', () => {
    const weather = { id: 'weather', label: 'Rain', value: '50°', spoken: '50 degrees, Rain', corner: 'top', glyph: 'rain' };
    const { container } = zero(<CornerChip item={weather} corner="top" loads={1} />);
    expect(container.querySelector('.step-chip__icon .weather-glyph[data-glyph="rain"]')).not.toBeNull();
    // The chip's name stays the words; the doodle is decoration.
    expect(container.querySelector('.step-chip').getAttribute('aria-label')).toBe('RAIN 50°');
    cleanup();
    const clock = { id: 'clock', label: 'Right now', value: '7:56', spoken: 'The time is 7:56 PM', corner: 'bottom' };
    expect(zero(<CornerChip item={clock} corner="bottom" loads={1} />).container.querySelector('.weather-glyph')).toBeNull();
  });
});
