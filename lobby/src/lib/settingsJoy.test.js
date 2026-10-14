// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { celebrateChange, joyTarget, JOY_MS } from './settingsJoy.js';

const fire = (el) => {
  const e = new Event('change', { bubbles: true });
  Object.defineProperty(e, 'target', { value: el });
  celebrateChange(e);
};

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.classList.remove('zero-animation-mode');
  vi.useRealTimers();
});

describe('settings joy', () => {
  it('celebrates ticking a box with a boing and a burst of sparkles, then tidies up', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<label class="toggle"><input type="checkbox" checked></label>';
    const box = document.querySelector('input');
    fire(box);
    expect(box.classList.contains('joy-pop')).toBe(true);
    const burst = document.querySelector('.joy-burst');
    expect(burst).not.toBeNull();
    expect(burst.getAttribute('aria-hidden')).toBe('true');
    expect(burst.children).toHaveLength(8);
    vi.advanceTimersByTime(JOY_MS);
    expect(box.classList.contains('joy-pop')).toBe(false);
    expect(document.querySelector('.joy-burst')).toBeNull();
  });

  it('only boops a box being unticked, without sparkles', () => {
    document.body.innerHTML = '<input type="checkbox">';
    const box = document.querySelector('input');
    fire(box);
    expect(box.classList.contains('joy-boop')).toBe(true);
    expect(document.querySelector('.joy-burst')).toBeNull();
  });

  it('pops the whole radio pill, and a menu, but never a typed field', () => {
    document.body.innerHTML = '<label class="radio-option"><input type="radio"></label><select><option>a</option></select><input type="number">';
    expect(joyTarget(document.querySelector('input[type=radio]')).el.className).toBe('radio-option');
    expect(joyTarget(document.querySelector('select')).selected).toBe(true);
    expect(joyTarget(document.querySelector('input[type=number]'))).toBeNull();
    expect(joyTarget(null)).toBeNull();
  });

  it('does nothing at all under zero animation', () => {
    document.documentElement.classList.add('zero-animation-mode');
    document.body.innerHTML = '<input type="checkbox" checked>';
    const box = document.querySelector('input');
    fire(box);
    expect(box.className).toBe('');
    expect(document.querySelector('.joy-burst')).toBeNull();
  });

  it('does nothing under the OS’s reduced motion', () => {
    vi.stubGlobal('matchMedia', (q) => ({ matches: q.includes('reduce') }));
    document.body.innerHTML = '<input type="checkbox" checked>';
    fire(document.querySelector('input'));
    expect(document.querySelector('.joy-burst')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('fails open (allows joy) if the media query throws an error', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => {
      throw new Error('Not implemented in this environment');
    });
    document.body.innerHTML = '<input type="checkbox" checked>';
    const box = document.querySelector('input');
    fire(box);
    expect(box.classList.contains('joy-pop')).toBe(true);
    expect(document.querySelector('.joy-burst')).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
