import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// The doodles keep the words clear: on the wall a centred box, and upright on
// a phone or tablet (where the words run the frame's full width) a full-width
// band, so none lands on a pledge's lines or its title.

const device = vi.hoisted(() => ({ portrait: false }));
vi.mock('../lib/touch.js', () => ({ usePortrait: () => device.portrait }));
vi.mock('../hooks/useLowPower.js', () => ({ useLowPower: () => false }));

const { PORTRAIT_CLEAR, SparkleDoodles } = await import('./SparkleDoodles.jsx');

const places = (container) => [...container.querySelectorAll('.animate-sparkle')].map((el) => ({
  left: parseFloat(el.style.left),
  top: parseFloat(el.style.top),
}));

afterEach(() => {
  cleanup();
  device.portrait = false;
});

describe('SparkleDoodles', () => {
  it('on the wall, keeps the centred box clear, the same way for the same seed', () => {
    const a = places(render(<SparkleDoodles seed={4} count={22} />).container);
    cleanup();
    const b = places(render(<SparkleDoodles seed={4} count={22} />).container);
    expect(a).toEqual(b);
    expect(a).toHaveLength(22);
    for (const p of a) expect(p.left > 22 && p.left < 78 && p.top > 22 && p.top < 78).toBe(false);
  });

  it('upright, keeps the whole band of the words clear, edge to edge', () => {
    device.portrait = true;
    const all = places(render(<SparkleDoodles seed={4} count={22} />).container);
    expect(all).toHaveLength(22);
    for (const p of all) expect(p.top > PORTRAIT_CLEAR.top && p.top < PORTRAIT_CLEAR.bottom).toBe(false);
  });
});
