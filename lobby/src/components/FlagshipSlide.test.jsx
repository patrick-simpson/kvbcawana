import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import { EASE, shoutBaseline } from '../lib/brand.js';
import { IMPACT } from '../lib/squish.js';
import { EASE_SLAM } from './promos/kit.jsx';
import FlagshipSlide, { LETTER_IMPACT } from './FlagshipSlide.jsx';

afterEach(cleanup);

function still(ui) {
  return render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);
}

describe('FlagshipSlide', () => {
  it('reads as one image, "Welcome to Awana!", not as forty loose letters', () => {
    const { container } = still(<FlagshipSlide />);
    const root = container.querySelector('.flagship');
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toMatch(/^welcome to awana!$/i);
    // Every letter is hidden from assistive tech; only the label speaks.
    for (const row of container.querySelectorAll('.flagship-row')) expect(row.getAttribute('aria-hidden')).toBe('true');
  });

  it('sets both rows, letter by letter, in order', () => {
    const { container } = still(<FlagshipSlide />);
    const rows = [...container.querySelectorAll('.flagship-row')].map((r) => [...r.querySelectorAll('.flagship-letter')].map((l) => l.textContent).join(''));
    expect(rows).toEqual(['Welcome', 'toAwana!']);
  });

  it('has no club plates and no TONIGHT kicker', () => {
    const { container } = still(<FlagshipSlide />);
    expect(container.querySelector('.flagship-plate')).toBeNull();
    expect(container.querySelector('.flagship-kicker')).toBeNull();
    expect(container.textContent).not.toMatch(/tonight/i);
  });

  it('uses only M elements for motion: nothing here can animate under ?lowPower=1', async () => {
    // src/lib/motionImports.test.js pins the import; this pins the rendered
    // result: under zero animation every letter is already at rest, its
    // squish included (no scale left over, so no transform at all).
    const { container } = still(<FlagshipSlide />);
    const letters = [...container.querySelectorAll('.flagship-letter')];
    await waitFor(() => {
      for (const l of letters) {
        expect(l.style.opacity === '' || l.style.opacity === '1').toBe(true);
        expect(['', 'none']).toContain(l.style.transform);
      }
    }, { timeout: 150 });
  });

  it('each letter squashes onto its baseline as it drops back onto its line', () => {
    const css = readFileSync(resolve(__dirname, '../styles/flagship.css'), 'utf8');
    const rule = css.match(/\.flagship-letter\s*\{([^}]*)\}/)[1];
    const row = css.match(/\.flagship-row\s*\{([^}]*)\}/)[1];
    const lineHeight = Number(row.match(/line-height:\s*([\d.]+)/)[1]);
    expect(rule).toContain(`transform-origin: 50% ${shoutBaseline(lineHeight)}em`);
    // The drop lands where the slam curve is 88% home on the way back down.
    expect(LETTER_IMPACT).toBe(0.5 + 0.5 * IMPACT.settle);
    expect(EASE_SLAM).toEqual(EASE.settle);
  });
});
