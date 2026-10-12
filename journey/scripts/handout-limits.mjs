// Text limits for page 1 of the Leader Handout (and the kiosk's Read Prep,
// which shows the same fields). Page 1 is ONE page, laid out by
// scripts/render-leader-handouts.mjs to fit a week that hits every maximum
// below at once (`node scripts/render-leader-handouts.mjs --fit-check`
// renders exactly that week and fails if page 1 overflows). Raise a limit
// only together with that layout, and re-run the fit check.
//
// Lengths are characters (JavaScript string length), counted after trimming.
export const LIMITS = {
  title: { max: 40 }, // "Unit 2, Lesson 3: Pantheism" (from lessons.json)
  shortTitle: { max: 14 }, // the shouted headline ("Resurrection" = 12)
  bigIdea: { min: 80, max: 330 },
  keyPoints: { minItems: 4, maxItems: 6, maxEach: 190, maxTotal: 1050 },
  scriptures: { minItems: 0, maxItems: 4, maxEach: 24 },
  forYou: { minItems: 1, maxItems: 4, maxEach: 125, maxTotal: 420 },
  forGroup: { minItems: 0, maxItems: 5, maxEach: 125, maxTotal: 540 },
  // Both sets share one row when "Ask your group" is there.
  questionsCombined: { maxItems: 8, maxTotal: 840 },
};

/** The worst case the page-1 layout must hold: every field at its maximum.
 *  withGroup false = a week with no "Ask your group" set, so "For you" takes
 *  its own maximum and the whole row. */
export function worstCaseSummary({ week = 99, withGroup = true } = {}) {
  const text = (n, seed) => {
    // Ordinary English word lengths, so line breaks behave like real copy.
    const words = 'the leader video shows why students can trust what scripture says about every question they bring'.split(' ');
    let out = '';
    for (let i = seed; out.length < n; i++) out += (out ? ' ' : '') + words[i % words.length];
    return `${out.slice(0, n - 1).trimEnd()}.`.padEnd(n, 'x');
  };
  const items = (spec, seed) => {
    const each = Math.min(spec.maxEach, Math.floor((spec.maxTotal ?? spec.maxEach * spec.maxItems) / spec.maxItems));
    return Array.from({ length: spec.maxItems }, (_, i) => text(each, seed + i * 3));
  };
  return {
    week,
    title: 'Unit 8, Lesson 4: Resurrections',
    shortTitle: 'Wwwwwwwwwwwwww'.slice(0, LIMITS.shortTitle.max),
    bigIdea: text(LIMITS.bigIdea.max, 1),
    keyPoints: items(LIMITS.keyPoints, 2),
    scriptures: ['1 Thessalonians 4:13-18', '2 Corinthians 5:17-21', 'Lamentations 3:22-23', 'Ecclesiastes 12:13-14'],
    questions: withGroup ? {
      // With both sets on the page the combined limit binds: the most items
      // "Ask your group" may have, the rest in "For you", at the combined total.
      forYou: items({ maxItems: LIMITS.questionsCombined.maxItems - LIMITS.forGroup.maxItems, maxEach: LIMITS.forYou.maxEach, maxTotal: LIMITS.questionsCombined.maxTotal - LIMITS.forGroup.maxTotal }, 5),
      forGroup: items(LIMITS.forGroup, 7),
    } : { forYou: items(LIMITS.forYou, 5), forGroup: [] },
  };
}
