import { describe, it, expect, vi, afterEach } from 'vitest';
import { pick, SAMPLE_NAMES, SAMPLE_BOARD_NAMES } from './demoNames.js';

describe('demoNames', () => {
  describe('SAMPLE_NAMES', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(SAMPLE_NAMES)).toBe(true);
      expect(SAMPLE_NAMES.length).toBeGreaterThan(0);
      expect(typeof SAMPLE_NAMES[0]).toBe('string');
    });
  });

  describe('SAMPLE_BOARD_NAMES', () => {
    it('is a non-empty array of strings', () => {
      expect(Array.isArray(SAMPLE_BOARD_NAMES)).toBe(true);
      expect(SAMPLE_BOARD_NAMES.length).toBeGreaterThan(0);
      expect(typeof SAMPLE_BOARD_NAMES[0]).toBe('string');
    });
  });

  describe('pick', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns undefined for an empty list', () => {
      expect(pick([])).toBeUndefined();
    });

    it('returns the only element for a list of length 1', () => {
      expect(pick(['A'])).toBe('A');
    });

    it('returns an element from the given list', () => {
      const list = ['A', 'B', 'C'];
      const result = pick(list);
      expect(list).toContain(result);
    });

    it('returns an element from SAMPLE_NAMES', () => {
      const result = pick(SAMPLE_NAMES);
      expect(SAMPLE_NAMES).toContain(result);
    });

    it('returns an element from SAMPLE_BOARD_NAMES', () => {
      const result = pick(SAMPLE_BOARD_NAMES);
      expect(SAMPLE_BOARD_NAMES).toContain(result);
    });

    describe('deterministic picking based on Math.random', () => {
      it('picks the first element when Math.random() is 0', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        expect(pick(['A', 'B', 'C'])).toBe('A');
      });

      it('picks the middle element when Math.random() is 0.5', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        // length 4 * 0.5 = 2. Index 2 is 'C'
        expect(pick(['A', 'B', 'C', 'D'])).toBe('C');
      });

      it('picks the last element when Math.random() is very close to 1', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.9999999999);
        expect(pick(['A', 'B', 'C'])).toBe('C');
      });
    });
  });
});
