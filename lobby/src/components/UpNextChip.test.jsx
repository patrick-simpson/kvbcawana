import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import UpNextChip, { WAVE_UP_SEC } from './UpNextChip.jsx';
import { FRONT_WAVE_DELAY } from '../lib/checkInMoment.js';
import { DUR } from '../lib/brand.js';

afterEach(cleanup);
const opacity = (el) => Number(el.style.opacity === '' ? 1 : el.style.opacity);

describe('UpNextChip', () => {
  it('counts the line, and says so to a screen reader', () => {
    const { container } = render(<ZeroAnimationContext.Provider value><UpNextChip pending={3} /></ZeroAnimationContext.Provider>);
    const chip = container.querySelector('.up-next');
    expect(chip.getAttribute('role')).toBe('status');
    expect(chip.getAttribute('aria-label')).toBe('3 more coming');
    expect(chip.querySelector('.step-chip').getAttribute('aria-label')).toBe('UP NEXT +3');
  });

  it('waits for the club wave it rides: the front wave\'s delay plus its rise', () => {
    expect(WAVE_UP_SEC).toBeCloseTo(FRONT_WAVE_DELAY + DUR.wipe, 9);
  });

  it('on a run\'s first child, lands only once the wave is under it', async () => {
    const rising = render(<UpNextChip pending={3} rising />).container.querySelector('.up-next');
    const later = render(<UpNextChip pending={3} />).container.querySelector('.up-next');
    await new Promise((r) => setTimeout(r, 250));
    expect(opacity(rising)).toBeLessThan(0.05);
    expect(opacity(later)).toBeGreaterThan(0.3);
    await waitFor(() => expect(opacity(rising)).toBe(1), { timeout: 2500 });
  });

  it('under zero animation it is simply there', async () => {
    const { container } = render(<ZeroAnimationContext.Provider value><UpNextChip pending={4} rising /></ZeroAnimationContext.Provider>);
    await waitFor(() => expect(opacity(container.querySelector('.up-next'))).toBe(1));
  });
});
