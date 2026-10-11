import { describe, expect, it } from 'vitest';
import { inlineRuns, parseReleaseNotes } from './releaseNotes.js';

describe('the release notes', () => {
  it('splits the changelog into versions and paragraphs, newest first', () => {
    const md = '\uFEFF## [8.2.0] - 2026-10-11\nBARF Bags.\n\n**New: labels.** One job,\nfor everyone.\n\n## Website - 2026-10-10\n- a fix\n';
    expect(parseReleaseNotes(md)).toEqual([
      { title: 'Version 8.2.0 - 2026-10-11', paragraphs: [
        [{ text: 'BARF Bags.', bold: false }],
        [{ text: 'New: labels.', bold: true }, { text: ' One job, for everyone.', bold: false }],
      ] },
      { title: 'Website - 2026-10-10', paragraphs: [[{ text: '• a fix', bold: false }]] },
    ]);
  });

  it('keeps unpaired stars and drops code ticks, never markup', () => {
    expect(inlineRuns('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
    expect(inlineRuns('set `barfNights`')).toEqual([{ text: 'set barfNights', bold: false }]);
    expect(parseReleaseNotes('<script>x</script>')).toEqual([]);
  });
});
