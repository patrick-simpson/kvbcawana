import { describe, expect, it } from 'vitest';
import { BACKWARDS_MODES, backwardsWords } from './BackwardsNightCard.jsx';

describe('Backwards Night words', () => {
  it('says On is for tonight only', () => {
    expect(BACKWARDS_MODES.find((m) => m.mode === 'on').hint).toMatch(/^On for tonight only/);
    expect(backwardsWords({ backwards: true, mode: 'on' })).toMatch(/^Switched on for tonight/);
  });
  it('says it is off or not tonight', () => {
    expect(backwardsWords({ backwards: false, mode: 'off' })).toMatch(/^Off/);
    expect(backwardsWords({ backwards: false, mode: 'auto' })).toBe('Tonight is not Backwards Night.');
  });
});
