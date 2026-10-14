import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import ChurchLogo, { lineArrival } from './ChurchLogo.jsx';

// The church's logo on the lobby (owner 2026-10-13): one colour, and an
// arrival that plays once, line by line, and ends exactly at rest.

afterEach(cleanup);

const last = (frames) => (Array.isArray(frames) ? frames[frames.length - 1] : frames);

describe('the church logo', () => {
  it('is drawn in ONE colour, the caller\'s (currentColor), with no outline, shadow or second fill', () => {
    const { container } = render(<ChurchLogo variant="full" />);
    const svg = container.querySelector('svg.church-logo--full');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toMatch(/Kennebec Valley Baptist Church Awana Clubs/);
    expect(svg.querySelector('g').getAttribute('fill')).toBe('currentColor');
    expect(svg.querySelectorAll('[fill]')).toHaveLength(1);
    expect(svg.outerHTML).not.toMatch(/stroke|filter|gradient/i);
  });

  it('lands the church line, then Awana Clubs, then the tagline, each ending exactly at rest', () => {
    const church = lineArrival('church', 0.3);
    const awana = lineArrival('awana', 0.3);
    const tagline = lineArrival('tagline', 0.3);
    const starts = [church, awana, tagline].map((b) => b.transition.duration * b.transition.times[1]);
    expect(starts[0]).toBeLessThan(starts[1]);
    expect(starts[1]).toBeLessThan(starts[2]);
    for (const b of [church, awana, tagline]) {
      expect(last(b.animate.opacity)).toBe(1);
      expect(last(b.animate.y)).toBe('0%');
      expect(last(b.animate.scaleX)).toBe(1);
      expect(last(b.animate.scaleY)).toBe(1);
      // a whisper of a squish at most: the logo is never visibly distorted
      expect(Math.min(...b.animate.scaleY)).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('is simply drawn, with nothing to animate, when it is not asked to arrive', () => {
    const { container } = render(<ChurchLogo variant="two-line" decorative />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.dataset.arrive).toBe('no');
    cleanup();
    expect(render(<ChurchLogo variant="two-line" arrive />).container.querySelector('svg').dataset.arrive).toBe('once');
  });
});
