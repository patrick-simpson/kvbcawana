import { describe, expect, it } from 'vitest';
import { DECKS } from '../config.js';
import { ceremonySlide } from './ceremonySlide.js';

describe('the ceremony slides (owner 2026-10-22: stop copying at the blackout)', () => {
  it('the welcome and both pledges are the ceremony; the blackout and past the end are not', () => {
    const ids = DECKS.opening.map((s) => s.id);
    expect(ids).toEqual(['welcome', 'us-pledge', 'awana-pledge', 'black-slide']);
    expect([0, 1, 2].map(ceremonySlide)).toEqual([true, true, true]);
    expect(ceremonySlide(3)).toBe(false);
    expect(ceremonySlide(4)).toBe(false);
    expect(ceremonySlide(-1)).toBe(false);
  });
});
