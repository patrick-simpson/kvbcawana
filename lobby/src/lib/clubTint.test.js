import { describe, it, expect } from 'vitest';
import { UNTINTABLE_SOURCES, clubTintFor } from './clubTint.js';
import { getClubPalette } from './clubs.js';

// Each "don't" below is a real place this effect would be wrong rather than
// delightful: an OBS feed whose whole job is to be transparent, a screen
// stripped back because something looks broken with a full room, and somebody
// else's video filling the display with nothing of ours underneath.

const ON = {
  enabled: true,
  active: true,
  overlay: false,
  panicMode: false,
  backgroundSource: 'manual',
  club: 'Sparks',
};

describe('clubTintFor', () => {
  it('hands back the arriving club\'s own accent', () => {
    expect(clubTintFor(ON)).toBe(getClubPalette('Sparks').accent);
    expect(clubTintFor({ ...ON, club: 'Cubbies' })).toBe(getClubPalette('Cubbies').accent);
    // Different clubs really do paint different walls — the whole point.
    expect(clubTintFor(ON)).not.toBe(clubTintFor({ ...ON, club: 'Cubbies' }));
  });

  it('is off unless the operator turned it on', () => {
    expect(clubTintFor({ ...ON, enabled: false })).toBe(null);
    expect(clubTintFor({ ...ON, enabled: undefined })).toBe(null);
    // Not merely truthy — an accidental string from a stale config is not consent.
    expect(clubTintFor({ ...ON, enabled: 'yes' })).toBe(null);
    expect(clubTintFor()).toBe(null);
  });

  it('only tints while a banner is actually holding the stage', () => {
    expect(clubTintFor({ ...ON, active: false })).toBe(null);
    expect(clubTintFor({ ...ON, active: undefined })).toBe(null);
  });

  it('never tints an overlay feed', () => {
    expect(clubTintFor({ ...ON, overlay: true })).toBe(null);
  });

  it('never tints in panic mode', () => {
    expect(clubTintFor({ ...ON, panicMode: true })).toBe(null);
  });

  it('never tints a video or uploaded-PowerPoint background', () => {
    for (const backgroundSource of UNTINTABLE_SOURCES) {
      expect(clubTintFor({ ...ON, backgroundSource })).toBe(null);
    }
    expect(UNTINTABLE_SOURCES).toEqual(['video', 'pptx']);
  });

  it('does tint the backgrounds that ARE ours', () => {
    for (const backgroundSource of ['manual', 'powerpoint', undefined]) {
      expect(clubTintFor({ ...ON, backgroundSource })).toBeTruthy();
    }
  });

  it('gives an unknown or misspelled club the warm house accent, never nothing', () => {
    const fallback = getClubPalette('').accent;
    expect(clubTintFor({ ...ON, club: 'Sprks' })).toBe(fallback);
    expect(clubTintFor({ ...ON, club: '' })).toBe(fallback);
    expect(clubTintFor({ ...ON, club: undefined })).toBe(fallback);
    expect(fallback).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
