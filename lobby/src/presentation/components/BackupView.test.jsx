import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { BackupView, VERSE_TEXT, flagStars } from './BackupView.jsx';
import { AWANA_PLEDGE_TEXT, US_PLEDGE_TEXT } from '../config.js';

// The opening-ceremony remote's backups (owner 2026-10-19): a flag beside its
// pledge, or 2 Timothy 2:15 in the King James Version.

afterEach(cleanup);

describe('the ceremony backups', () => {
  it('draws the American flag to its official proportions: 13 stripes, 50 stars in 9 rows of 6 and 5', () => {
    const { container } = render(<BackupView what="us-flag" />);
    const svg = container.querySelector('svg.pj-backup__flag');
    expect(svg.getAttribute('viewBox')).toBe('0 0 1.9 1');
    expect(svg.querySelectorAll('rect')).toHaveLength(14); // 13 stripes + the canton
    expect(svg.querySelector('rect').getAttribute('fill')).toBe('#B22234'); // red on top
    const stars = flagStars();
    expect(stars).toHaveLength(50);
    const rows = Object.values(Object.groupBy(stars, ([, y]) => y.toFixed(3))).map((r) => r.length);
    expect(rows).toEqual([6, 5, 6, 5, 6, 5, 6, 5, 6]);
    // Every star sits inside the canton (0.76 x 7/13).
    for (const [x, y] of stars) { expect(x).toBeLessThan(0.76); expect(y).toBeLessThan(7 / 13); }
    expect(container.textContent).toContain(US_PLEDGE_TEXT.split(' ').slice(0, 3).join(' '));
  });

  it('stands the Awana flag, drawn from the church\'s own, beside the Awana pledge', () => {
    const { container } = render(<BackupView what="awana-flag" />);
    // Drawn from the photo of the church's flag: red field, the globe, both
    // banners' words and the three-tongued flame.
    const flag = container.querySelector('svg.pj-backup__flag--awana');
    expect(flag.getAttribute('viewBox')).toBe('0 0 300 200');
    expect([...flag.querySelectorAll('text')].map((t) => t.textContent)).toEqual(['AWANA', 'CLUBS']);
    expect(flag.querySelectorAll('g path')).toHaveLength(4); // grid + three flame tongues
    expect(container.querySelector('.pj-backup__text').textContent.replace(/\s+/g, ' ')).toBe(AWANA_PLEDGE_TEXT);
  });

  it('shows 2 Timothy 2:15 KJV word for word, with no flag', () => {
    const { container } = render(<BackupView what="verse" />);
    expect(VERSE_TEXT).toBe('Study to shew thyself approved unto God, a workman that needeth not to be ashamed, rightly dividing the word of truth.');
    expect(container.querySelector('.pj-backup__flag')).toBeNull();
    expect(container.textContent).toMatch(/2 Timothy 2:15 KJV/);
    expect(container.querySelector('.pj-backup__text').textContent.replace(/\s+/g, ' ')).toBe(VERSE_TEXT);
  });

  it('draws nothing for a screen it does not know', () => {
    const { container } = render(<BackupView what="pirate-flag" />);
    expect(container.innerHTML).toBe('');
  });
});
