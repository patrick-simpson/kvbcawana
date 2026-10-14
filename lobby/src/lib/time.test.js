import { describe, expect, it } from 'vitest';
import { pad2, dateKey } from './time.js';

describe('time.js', () => {
  describe('pad2', () => {
    it('pads single digits with zero', () => {
      expect(pad2(0)).toBe('00');
      expect(pad2(7)).toBe('07');
      expect(pad2(9)).toBe('09');
    });

    it('leaves double digits unchanged', () => {
      expect(pad2(10)).toBe('10');
      expect(pad2(12)).toBe('12');
      expect(pad2(99)).toBe('99');
    });

    it('leaves larger numbers unchanged', () => {
      expect(pad2(123)).toBe('123');
    });
  });

  describe('dateKey', () => {
    it('returns YYYY-MM-DD for a specific Date using local time', () => {
      // Constructing Date using year, monthIndex, day uses local time.
      const d1 = new Date(2023, 0, 1); // Jan 1, 2023
      expect(dateKey(d1)).toBe('2023-01-01');

      const d2 = new Date(2023, 11, 31); // Dec 31, 2023
      expect(dateKey(d2)).toBe('2023-12-31');

      const d3 = new Date(2024, 2, 15); // March 15, 2024
      expect(dateKey(d3)).toBe('2024-03-15');
    });

    it('defaults to the current date', () => {
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      expect(dateKey()).toBe(expected);
    });
  });
});
