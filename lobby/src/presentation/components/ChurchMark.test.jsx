import { describe, expect, it, afterEach, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChurchMark, MARK_PLACEMENT, lineLanding } from './ChurchMark.jsx';
import { setLowPowerPreference } from '../hooks/useLowPower.js';

// The projector's logo (owner 2026-10-13): the church's own, white, top left
// over every view, never under its smallest legible width, arriving once.

afterEach(() => { cleanup(); vi.unstubAllGlobals(); setLowPowerPreference(false); });

const media = (matches) => vi.stubGlobal('matchMedia', (query) => ({
  matches: matches(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}));

describe('the projector logo', () => {
  it('is the two-line logo, top left, never narrower than 260px', () => {
    media(() => false);
    const { container } = render(<ChurchMark />);
    const mark = container.querySelector('[data-awana-mark]');
    expect(mark.dataset.logo).toBe('two-line');
    expect(mark.style.width).toContain('260px');
    expect(mark.style.width).toContain(String(MARK_PLACEMENT.width));
    expect(mark.querySelector('svg').getAttribute('aria-label')).toBe('Kennebec Valley Baptist Church Awana Clubs');
    expect([...mark.querySelectorAll('path')].map((p) => p.getAttribute('class'))).toEqual(['kvbc-church', 'kvbc-awana']);
  });

  it('signs the night off with the full logo only where the wall has room for its 520px', () => {
    media((q) => q.includes('min-width: 1600px'));
    const { container } = render(<ChurchMark full />);
    const mark = container.querySelector('[data-awana-mark]');
    expect(mark.dataset.logo).toBe('full');
    expect(mark.style.width).toContain('520px');
    expect(mark.querySelectorAll('path')).toHaveLength(3);
    cleanup();
    media(() => false);
    const small = render(<ChurchMark full />).container.querySelector('[data-awana-mark]');
    expect(small.dataset.logo).toBe('two-line');
  });

  it('lands each line once, church line first, and ends exactly at rest', () => {
    const church = lineLanding('church', 0.35);
    const awana = lineLanding('awana', 0.35);
    expect(church.transition.duration * church.transition.times[1]).toBeLessThan(awana.transition.duration * awana.transition.times[1]);
    for (const b of [church, awana, lineLanding('tagline')]) {
      expect(b.animate.opacity.at(-1)).toBe(1);
      expect(b.animate.y.at(-1)).toBe('0%');
      expect(b.animate.scaleX.at(-1)).toBe(1);
      expect(b.animate.scaleY.at(-1)).toBe(1);
    }
  });

  it('arrives on an ordinary wall, and under the low-power switch (or ?vr=1, or reduced motion) is simply there', () => {
    media(() => false);
    expect(render(<ChurchMark />).container.querySelector('svg').dataset.arrive).toBe('once');
    cleanup();
    setLowPowerPreference(true);
    expect(render(<ChurchMark />).container.querySelector('svg').dataset.arrive).toBe('no');
  });
});
