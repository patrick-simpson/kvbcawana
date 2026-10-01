import { describe, it, expect } from 'vitest';
import {
  FLAGSHIP_DURATION_SEC, flagshipOnAir, FLAGSHIP_ID, FLAGSHIP_SLIDE, isFlagshipSlide, withFlagship,
} from './flagship.js';
import { holdsCheckIns, slideDurationMs } from './slides.js';
import { sanitizeSlides } from './slides.js';

describe('the flagship slide', () => {
  it('is one frozen, built-in descriptor', () => {
    expect(FLAGSHIP_SLIDE).toEqual({ id: FLAGSHIP_ID, type: 'flagship', durationSec: FLAGSHIP_DURATION_SEC });
    expect(Object.isFrozen(FLAGSHIP_SLIDE)).toBe(true);
    expect(isFlagshipSlide(FLAGSHIP_SLIDE)).toBe(true);
    expect(isFlagshipSlide({ type: 'promo' })).toBe(false);
    expect(isFlagshipSlide(null)).toBe(false);
  });

  it('leads every deck, and only once', () => {
    const deck = [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }];
    expect(withFlagship(deck).map((s) => s.id)).toEqual([FLAGSHIP_ID, 'a', 'b']);
    expect(withFlagship([]).map((s) => s.id)).toEqual([FLAGSHIP_ID]);
    expect(withFlagship(null).map((s) => s.id)).toEqual([FLAGSHIP_ID]);
    // Nothing else can make one, but if one ever arrived it would not double up.
    expect(withFlagship([FLAGSHIP_SLIDE, ...deck]).filter(isFlagshipSlide)).toHaveLength(1);
    expect(withFlagship([{ ...FLAGSHIP_SLIDE }, ...deck])[0]).toBe(FLAGSHIP_SLIDE);
  });

  it('never holds check-ins: names play over it', () => {
    expect(holdsCheckIns(FLAGSHIP_SLIDE)).toBe(false);
  });

  it('holds for its own beat sheet, whatever the global slide delay is', () => {
    expect(slideDurationMs(FLAGSHIP_SLIDE, 5)).toBe(FLAGSHIP_DURATION_SEC * 1000);
    expect(slideDurationMs(FLAGSHIP_SLIDE, 0)).toBe(FLAGSHIP_DURATION_SEC * 1000);
  });

  it('cannot be typed, published or saved: the slide allowlist drops the type', () => {
    expect(sanitizeSlides([FLAGSHIP_SLIDE, { id: 's_1', text: 'Real slide', durationSec: 5 }]).map((s) => s.id)).toEqual(['s_1']);
  });

  it('is off the air Wednesdays from 6:30 pm to 8:30 pm, local, and only then', () => {
    const at = (d, h, m) => new Date(2026, 8, d, h, m); // Sep 30 2026 is a Wednesday
    expect(flagshipOnAir(at(30, 18, 29))).toBe(true);
    expect(flagshipOnAir(at(30, 18, 30))).toBe(false);
    expect(flagshipOnAir(at(30, 19, 45))).toBe(false);
    expect(flagshipOnAir(at(30, 20, 29))).toBe(false);
    expect(flagshipOnAir(at(30, 20, 30))).toBe(true);
    expect(flagshipOnAir(at(29, 19, 0))).toBe(true); // Tuesday
    expect(flagshipOnAir(new Date(2026, 9, 1, 19, 0))).toBe(true); // Thursday
    expect(withFlagship([{ id: 'a' }], false).map((s) => s.id)).toEqual(['a']);
  });

});
