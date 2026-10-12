import { describe, it, expect } from 'vitest';
import { parseUrlFlags } from './urlFlags.js';

describe('parseUrlFlags', () => {
  it('defaults to normal signage mode', () => {
    expect(parseUrlFlags('')).toEqual({
      overlay: false, chroma: null, configUrl: null, lowPower: false,
    });
    expect(parseUrlFlags('?foo=bar').overlay).toBe(false);
  });

  it('enables overlay mode via ?overlay=1/true/yes', () => {
    expect(parseUrlFlags('?overlay=1').overlay).toBe(true);
    expect(parseUrlFlags('?overlay=true').overlay).toBe(true);
    expect(parseUrlFlags('?overlay=yes').overlay).toBe(true);
    expect(parseUrlFlags('?overlay=0').overlay).toBe(false);
  });

  it('parses a chroma key color and implies overlay mode', () => {
    const flags = parseUrlFlags('?chroma=00B140');
    expect(flags.chroma).toBe('#00b140');
    expect(flags.overlay).toBe(true);
    expect(parseUrlFlags('?chroma=%2300b140').chroma).toBe('#00b140');
  });

  it('rejects malformed chroma values', () => {
    expect(parseUrlFlags('?chroma=green').chroma).toBeNull();
    expect(parseUrlFlags('?chroma=12345').chroma).toBeNull();
    expect(parseUrlFlags('?chroma=green').overlay).toBe(false);
  });

  it('ignores the retired Pusher ?key= and ?cluster= of an old OBS / ProPresenter link', () => {
    const flags = parseUrlFlags('?overlay=1&key=abc123&cluster=eu');
    expect(flags).toEqual({ overlay: true, chroma: null, configUrl: null, lowPower: false });
  });

  it('enables low-power mode via ?lowPower=1/true/yes, off by default', () => {
    expect(parseUrlFlags('').lowPower).toBe(false);
    expect(parseUrlFlags('?lowPower=1').lowPower).toBe(true);
    expect(parseUrlFlags('?lowPower=true').lowPower).toBe(true);
    expect(parseUrlFlags('?lowPower=yes').lowPower).toBe(true);
    expect(parseUrlFlags('?lowPower=0').lowPower).toBe(false);
  });
});
