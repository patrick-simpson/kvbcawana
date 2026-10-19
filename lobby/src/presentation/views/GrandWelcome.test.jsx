import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BEATS, GRAND_WELCOME_SEC, GrandWelcome, LEAD } from './GrandWelcome.jsx';
import { DECKS } from '../config.js';
import { CLUB_ORDER, KIT_CLUBS } from '../lib/kit.js';
import { setLowPowerPreference } from '../hooks/useLowPower.js';

// The grand welcome (owner 2026-10-19): the opening's first slide, 15 s, silent.

afterEach(() => { cleanup(); setLowPowerPreference(false); });

describe('the grand welcome', () => {
  it('is the opening deck\'s first slide, 15 seconds long', () => {
    expect(DECKS.opening[0]).toMatchObject({ id: 'welcome', layout: 'grand-welcome', duration: GRAND_WELCOME_SEC });
    expect(GRAND_WELCOME_SEC).toBe(15);
  });

  it('comes to rest well inside its 15 seconds', () => {
    // Confetti is the last beat: it bursts as the last mark lands.
    expect(LEAD + BEATS.marks + 5 * BEATS.markGap + 0.5).toBeLessThanOrEqual(LEAD + BEATS.confetti + 1e-9);
    expect(LEAD + BEATS.confetti + 3.5).toBeLessThan(GRAND_WELCOME_SEC);
  });

  it('spells WELCOME with a club colour under each letter, then the church logo and all six club marks', () => {
    const { container } = render(<GrandWelcome now={new Date('2026-09-16T18:00:00')} />);
    const letters = [...container.querySelectorAll('.pj-grand__letter')];
    expect(letters.map((l) => l.textContent).join('')).toBe('WELCOME');
    letters.forEach((l, i) => {
      const hex = KIT_CLUBS[CLUB_ORDER[i % 6]].primary;
      expect(hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(l.firstElementChild.getAttribute('style')).toContain('text-shadow');
    });
    expect(container.querySelectorAll('.pj-grand__band')).toHaveLength(6);
    expect(container.querySelectorAll('.pj-grand__logo path')).toHaveLength(3); // church line, Awana Clubs, tagline
    expect(container.querySelectorAll('.pj-grand__mark')).toHaveLength(6);
    expect(container.textContent).toMatch(/Wednesday night/);
  });

  it('on the low-power switch shows the finished frame: no bands, no motion', () => {
    setLowPowerPreference(true);
    const { container } = render(<GrandWelcome />);
    expect(container.querySelector('[data-grand-welcome]').dataset.grandWelcome).toBe('still');
    expect(container.querySelector('.pj-grand__band')).toBeNull();
    expect(container.querySelectorAll('.pj-grand__logo path')).toHaveLength(3);
  });
});
