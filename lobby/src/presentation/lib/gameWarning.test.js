import { describe, expect, it } from 'vitest';
import {
  FINAL_THIRTY_SECONDS,
  TWO_MINUTE_SECONDS,
  WARNING_LABELS,
  WARNING_STINGER_INTENSITY,
  warningFor,
} from './gameWarning.js';

describe('warningFor', () => {
  it('stays quiet with more than two minutes left', () => {
    expect(warningFor(1500)).toBe('none');
    expect(warningFor(121)).toBe('none');
  });

  it('flips to the two-minute heads-up exactly at 120s', () => {
    expect(warningFor(TWO_MINUTE_SECONDS)).toBe('two-minute');
    expect(warningFor(120)).toBe('two-minute');
  });

  it('holds the heads-up down to 31s', () => {
    expect(warningFor(60)).toBe('two-minute');
    expect(warningFor(31)).toBe('two-minute');
  });

  it('flips to the final call exactly at 30s', () => {
    expect(warningFor(FINAL_THIRTY_SECONDS)).toBe('final-thirty');
    expect(warningFor(30)).toBe('final-thirty');
    expect(warningFor(1)).toBe('final-thirty');
  });

  it('goes quiet again once the clock hits zero — the window is over', () => {
    expect(warningFor(0)).toBe('none');
    expect(warningFor(-5)).toBe('none');
  });

  it('never throws on a non-finite clock', () => {
    expect(warningFor(NaN)).toBe('none');
    expect(warningFor(Infinity)).toBe('none');
  });
});

describe('warning presentation tables', () => {
  it('labels and chime intensities cover exactly the two warning states', () => {
    expect(Object.keys(WARNING_LABELS).sort()).toEqual(['final-thirty', 'two-minute']);
    expect(Object.keys(WARNING_STINGER_INTENSITY).sort()).toEqual(['final-thirty', 'two-minute']);
    expect(WARNING_LABELS['two-minute']).toMatch(/two minutes/i);
    expect(WARNING_LABELS['final-thirty']).toMatch(/30 seconds/i);
  });

  it('reserves the big three-note chime for the final call', () => {
    expect(WARNING_STINGER_INTENSITY['two-minute']).toBe(0.5);
    expect(WARNING_STINGER_INTENSITY['final-thirty']).toBe(1);
  });
});
