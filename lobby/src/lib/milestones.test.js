import { describe, expect, it } from 'vitest';
import {
  crossedMilestones, isBigMilestone, nightMilestoneCopy, NIGHT_MILESTONES,
} from './milestones.js';

describe('crossedMilestones', () => {
  it('reports a threshold crossed by a single increment', () => {
    expect(crossedMilestones(99, 100)).toEqual([100]);
  });

  it('reports nothing when the threshold is not reached', () => {
    expect(crossedMilestones(97, 99)).toEqual([]);
  });

  it('reports nothing when the count is unchanged', () => {
    // A reconnect re-delivers the current total; that must not re-celebrate.
    expect(crossedMilestones(100, 100)).toEqual([]);
  });

  it('reports nothing when the count goes DOWN', () => {
    // An older snapshot arriving late (or a corrected count) is not a crossing.
    expect(crossedMilestones(120, 100)).toEqual([]);
  });

  it('catches a threshold jumped clean over', () => {
    // The real reason this is transition-based: a batch reconcile can take the
    // count 98 → 103, and `next % 50 === 0` would miss 100 entirely.
    expect(crossedMilestones(98, 103)).toEqual([100]);
  });

  it('reports every threshold in a big jump, ascending', () => {
    expect(crossedMilestones(40, 160)).toEqual([50, 100, 150]);
  });

  it('does not re-report a threshold already below prev', () => {
    expect(crossedMilestones(100, 120)).toEqual([]);
    expect(crossedMilestones(100, 150)).toEqual([150]);
  });

  it('tolerates junk input', () => {
    expect(crossedMilestones(NaN, 100)).toEqual([]);
    expect(crossedMilestones(0, NaN)).toEqual([]);
    expect(crossedMilestones(undefined, 100)).toEqual([]);
    expect(crossedMilestones(null, null)).toEqual([]);
  });

  it('accepts custom thresholds', () => {
    expect(crossedMilestones(9, 11, [10, 20])).toEqual([10]);
  });

  it('has ascending built-in thresholds', () => {
    const sorted = [...NIGHT_MILESTONES].sort((a, b) => a - b);
    expect([...NIGHT_MILESTONES]).toEqual(sorted);
  });
});

describe('nightMilestoneCopy', () => {
  it('names the triple-digit moment distinctly', () => {
    const copy = nightMilestoneCopy(100);
    expect(copy.label).toMatch(/triple/i);
    expect(copy.headline).toContain('100');
  });

  it('escalates copy for very large nights', () => {
    expect(nightMilestoneCopy(200).label).toMatch(/huge/i);
  });

  it('always includes the number in the headline', () => {
    for (const n of NIGHT_MILESTONES) {
      expect(nightMilestoneCopy(n).headline).toContain(String(n));
    }
  });

  it('differs from the generic every-Nth wording', () => {
    // The point of a named threshold is that it does not read as another
    // routine toast.
    expect(nightMilestoneCopy(100).label).not.toBe('Checked in tonight');
  });
});

describe('isBigMilestone', () => {
  it('treats 100 and above as big', () => {
    expect(isBigMilestone(100)).toBe(true);
    expect(isBigMilestone(250)).toBe(true);
  });
  it('treats 50 as ordinary', () => {
    expect(isBigMilestone(50)).toBe(false);
  });
});

import { ordinalNight } from './milestones.js';

describe('ordinalNight (#10)', () => {
  it('renders the milestone set', () => {
    expect(ordinalNight(5)).toBe('5th');
    expect(ordinalNight(10)).toBe('10th');
    expect(ordinalNight(25)).toBe('25th');
    expect(ordinalNight(50)).toBe('50th');
  });
  it('handles general ordinals and the 11-13 exceptions', () => {
    expect(ordinalNight(1)).toBe('1st');
    expect(ordinalNight(2)).toBe('2nd');
    expect(ordinalNight(3)).toBe('3rd');
    expect(ordinalNight(11)).toBe('11th');
    expect(ordinalNight(12)).toBe('12th');
    expect(ordinalNight(13)).toBe('13th');
    expect(ordinalNight(21)).toBe('21st');
  });
});

// ── Handbook milestones (#358) ───────────────────────────────────────────────
import {
  AWARD_MILESTONES, BOOK_MILESTONES, awardMilestoneCopy, bookMilestoneCopy,
  parseMilestoneList, sanitizeMilestoneList,
} from './milestones.js';

describe('handbook milestone copy (#358)', () => {
  it('names the handbook, and says TONIGHT', () => {
    // "10 books!" on a lobby wall reads as a club-year total; this counter is
    // the evening's own, so the copy has to say so.
    expect(bookMilestoneCopy(10)).toEqual({
      label: 'Handbooks', headline: '10 books finished tonight!',
    });
    expect(awardMilestoneCopy(25)).toEqual({
      label: 'Awards earned', headline: '25 awards earned tonight!',
    });
  });

  it('reads correctly for a threshold of one', () => {
    // An operator may well set 1 for a small club, and "1 books" would be the
    // first thing anyone noticed on the wall.
    expect(bookMilestoneCopy(1).headline).toBe('1 book finished tonight!');
    expect(awardMilestoneCopy(1).headline).toBe('1 award earned tonight!');
  });

  it('gives every helper the same shape the toast reads', () => {
    for (const copy of [bookMilestoneCopy(5), awardMilestoneCopy(50), nightMilestoneCopy(100)]) {
      expect(typeof copy.label).toBe('string');
      expect(typeof copy.headline).toBe('string');
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.headline.length).toBeGreaterThan(0);
    }
  });

  it('ships defaults smaller than the attendance thresholds', () => {
    // Ten books finished in one night is a bigger deal than the hundredth kid
    // arriving; defaults that mirrored NIGHT_MILESTONES would never fire.
    expect(BOOK_MILESTONES).toEqual([5, 10, 25]);
    expect(AWARD_MILESTONES).toEqual([10, 25, 50]);
    expect(Math.max(...BOOK_MILESTONES)).toBeLessThan(Math.min(...NIGHT_MILESTONES));
  });
});

describe('crossedMilestones against the handbook thresholds', () => {
  it('crosses a book threshold from the tonight broadcast', () => {
    expect(crossedMilestones(4, 6, BOOK_MILESTONES)).toEqual([5]);
    expect(crossedMilestones(4, 11, BOOK_MILESTONES)).toEqual([5, 10]);
  });

  it('never fires on a bounce back down or a re-delivered snapshot', () => {
    expect(crossedMilestones(12, 8, BOOK_MILESTONES)).toEqual([]);
    expect(crossedMilestones(10, 10, BOOK_MILESTONES)).toEqual([]);
  });

  it('an empty threshold list is simply off', () => {
    expect(crossedMilestones(0, 500, [])).toEqual([]);
  });
});

describe('sanitizeMilestoneList', () => {
  it('keeps whole numbers, sorted and de-duplicated', () => {
    expect(sanitizeMilestoneList([25, 5, 10, 5])).toEqual([5, 10, 25]);
  });

  it('drops anything that could reach crossedMilestones as a NaN', () => {
    expect(sanitizeMilestoneList([5, 1.5, NaN, Infinity, -3, 0, null, undefined, {}, 'x']))
      .toEqual([5]);
  });

  it('coerces numeric strings, since Settings and JSON both produce them', () => {
    expect(sanitizeMilestoneList(['5', '10'])).toEqual([5, 10]);
  });

  it('caps the list so a hostile ?config= file cannot queue a hundred toasts', () => {
    const many = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(sanitizeMilestoneList(many)).toHaveLength(12);
    expect(sanitizeMilestoneList(many)[0]).toBe(1);
  });

  it('rejects non-arrays and empty input as "off"', () => {
    expect(sanitizeMilestoneList(null)).toEqual([]);
    expect(sanitizeMilestoneList('5,10')).toEqual([]);
    expect(sanitizeMilestoneList({ 0: 5 })).toEqual([]);
    expect(sanitizeMilestoneList([])).toEqual([]);
  });

  it('refuses absurd thresholds rather than storing them', () => {
    expect(sanitizeMilestoneList([10001, 99999])).toEqual([]);
    expect(sanitizeMilestoneList([10000])).toEqual([10000]);
  });
});

describe('parseMilestoneList', () => {
  it('reads the Settings text field the operator actually types', () => {
    expect(parseMilestoneList('5, 10, 25')).toEqual([5, 10, 25]);
    expect(parseMilestoneList('25 10 5')).toEqual([5, 10, 25]);
    // Mid-typing states must not throw or reorder into nonsense.
    expect(parseMilestoneList('5, ')).toEqual([5]);
    expect(parseMilestoneList('')).toEqual([]);
    expect(parseMilestoneList(null)).toEqual([]);
  });

  it('ignores stray words and punctuation instead of failing the field', () => {
    expect(parseMilestoneList('5 books, 10 books')).toEqual([5, 10]);
  });
});
