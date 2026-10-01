import { describe, it, expect } from 'vitest';
import { MANUAL_SHOW_MS, NO_OVERRIDES, decideVisibility, hide, showNow, tidy } from './visibility.js';

const IN = { inWindow: true, windowKey: '2026-09-30' };
const OUT = { inWindow: false, windowKey: null };
const T = 1_790_000_000_000;

describe('decideVisibility', () => {
  it('follows the schedule with no overrides', () => {
    expect(decideVisibility(IN, NO_OVERRIDES, T)).toEqual({ visible: true, reason: 'schedule' });
    expect(decideVisibility(OUT, NO_OVERRIDES, T)).toEqual({ visible: false, reason: 'off' });
  });

  it('Hide during a window lasts until that window ends, and only that one', () => {
    const o = hide(NO_OVERRIDES, IN);
    expect(decideVisibility(IN, o, T).visible).toBe(false);
    expect(decideVisibility({ inWindow: true, windowKey: '2026-10-07' }, o, T).visible).toBe(true);
  });

  it('Show now lasts three hours, through the 8 pm close, then hides itself', () => {
    const o = showNow(NO_OVERRIDES, T);
    expect(MANUAL_SHOW_MS).toBe(3 * 60 * 60 * 1000);
    expect(decideVisibility(OUT, o, T + MANUAL_SHOW_MS - 1)).toEqual({ visible: true, reason: 'manual' });
    expect(decideVisibility(OUT, o, T + MANUAL_SHOW_MS).visible).toBe(false);
    // Inside a window when it runs out: the schedule still wants it.
    expect(decideVisibility(IN, o, T + MANUAL_SHOW_MS).visible).toBe(true);
  });

  it('Show now undoes a Hide, and Hide ends a Show now', () => {
    const hidden = hide(NO_OVERRIDES, IN);
    expect(decideVisibility(IN, showNow(hidden, T), T).visible).toBe(true);
    expect(decideVisibility(OUT, hide(showNow(NO_OVERRIDES, T), OUT), T + 1).visible).toBe(false);
  });
});

describe('tidy', () => {
  it('drops a hide for a window that has ended and a show that has run out', () => {
    const o = { hiddenForWindow: '2026-09-30', manualUntil: T };
    expect(tidy(o, OUT, T + 1)).toEqual(NO_OVERRIDES);
    expect(tidy(o, IN, T - 1)).toBe(o);
  });
});
