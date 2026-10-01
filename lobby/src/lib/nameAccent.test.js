import { describe, it, expect } from 'vitest';
import { NAME_ENTRANCES, nameAccent } from './nameAccent.js';

// THIS FILE IS A REGRESSION LOCK, NOT A UNIT TEST OF A FORMULA.
//
// Every field of an accent is drawn from ONE mulberry32 stream seeded from the
// first name, in the order the return object lists them. So inserting a new
// field anywhere but the end shifts every field below it, and every child in
// the church silently gets a different tilt, a different twinkle rhythm and a
// different sparkle from the one they have recognised as "theirs" for weeks —
// the exact opposite of what the seeding is for.
//
// The table below is the accent every one of these names had BEFORE `entrance`
// was appended (#336). If a future field is appended correctly, this table
// still passes untouched; if it is inserted above, this test is what says so.
const PINNED = {
  Ava: { tilt: -0.2, doodlePhase: 1.2, sparkle: true },
  Noah: { tilt: 0.2, doodlePhase: 0.3, sparkle: true },
  Mia: { tilt: 0.1, doodlePhase: 0.7, sparkle: true },
  Ezra: { tilt: 0.6, doodlePhase: 0.6, sparkle: true },
  Bea: { tilt: 1.4, doodlePhase: 0.5, sparkle: true },
  Liam: { tilt: -0.5, doodlePhase: 1.9, sparkle: false },
  Sophia: { tilt: -0.5, doodlePhase: 1.4, sparkle: false },
  Jonathan: { tilt: -0.6, doodlePhase: 1.8, sparkle: true },
  // Non-ASCII (hashName walks code points) and the empty name the sanitizer
  // can legitimately produce, both pinned for the same reason.
  'Zoë': { tilt: -1.5, doodlePhase: 1.8, sparkle: false },
  '': { tilt: 0.4, doodlePhase: 1, sparkle: true },
};

describe('nameAccent — the pre-existing draws', () => {
  for (const [name, pinned] of Object.entries(PINNED)) {
    it(`keeps ${JSON.stringify(name)}'s tilt, twinkle phase and sparkle exactly as they were`, () => {
      const accent = nameAccent(name);
      expect(accent.tilt).toBe(pinned.tilt);
      expect(accent.doodlePhase).toBe(pinned.doodlePhase);
      expect(accent.sparkle).toBe(pinned.sparkle);
    });
  }

  it('keeps tilt inside the gentle ±1.6° range it always had', () => {
    for (const name of Object.keys(PINNED)) {
      expect(Math.abs(nameAccent(name).tilt)).toBeLessThanOrEqual(1.6);
    }
  });
});

describe('nameAccent — the appended entrance (#336)', () => {
  it('deals one of the three known ids', () => {
    for (const name of Object.keys(PINNED)) {
      expect(NAME_ENTRANCES).toContain(nameAccent(name).entrance);
    }
  });

  it('deals the same kid the same entrance every week', () => {
    expect(nameAccent('Ava').entrance).toBe(nameAccent('Ava').entrance);
    expect(nameAccent('Jonathan').entrance).toBe(nameAccent('Jonathan').entrance);
  });

  it('actually spreads across all three ids rather than collapsing to one', () => {
    // 200 plausible first names is far more than one club night, so a draw
    // that quietly always returned 'pop' would show up here.
    const seen = new Set();
    for (let i = 0; i < 200; i += 1) seen.add(nameAccent(`Kid${i}`).entrance);
    expect([...seen].sort()).toEqual([...NAME_ENTRANCES].sort());
  });

  it('exposes the id list in a fixed order, because the draw indexes into it', () => {
    expect(NAME_ENTRANCES).toEqual(['pop', 'wave', 'drop']);
  });
});
