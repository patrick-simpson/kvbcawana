import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import PromoSlide, { PROMO_DETAILS, detailsFor } from './PromoSlide.jsx';

// No global test setup file in this repo, so RTL's automatic cleanup
// (which needs a global afterEach) doesn't run — do it explicitly.
afterEach(cleanup);

// M.* from src/lib/motion.jsx reads ZeroAnimationContext through
// useContext, which falls back to the createContext default (false) with
// no provider — so these render exactly as they do on a normal screen,
// no wrapper needed.
const promo = (kind, extra = {}) => ({
  id: `promo_${kind}`,
  kind,
  eventDate: '2026-11-11',
  tonight: false,
  countdown: 'Next club night',
  durationSec: 10,
  ...extra,
});

describe('PromoSlide', () => {
  it('renders nothing at all for a missing or unknown promo', () => {
    const { container } = render(<PromoSlide promo={null} />);
    expect(container.querySelector('.promo-slide')).toBeNull();
    cleanup();
    const { container: c2 } = render(<PromoSlide promo={promo('bake-sale')} />);
    expect(c2.querySelector('.promo-slide')).toBeNull();
  });

  it('draws a known promo on the shared poster root', () => {
    const { container } = render(<PromoSlide promo={promo('veterans')} />);
    expect(container.querySelectorAll('.promo-slide')).toHaveLength(1);
    expect(container.querySelector('.promo-slide--veterans')).not.toBeNull();
  });

  // Which strings a poster carries is a pure decision (detailsFor).
  describe('the detail copy (detailsFor)', () => {
    it('gives a promo that has detail lines its lines, tonight and otherwise', () => {
      for (const kind of ['snowAlerts', 'grandPrix']) {
        expect(detailsFor(promo(kind)).length, kind).toBeGreaterThan(0);
        expect(detailsFor(promo(kind, { tonight: true })).length, kind).toBeGreaterThan(0);
      }
    });

    it('lets a promo with no lines of its own say nothing', () => {
      expect(detailsFor(promo('veterans'))).toEqual([]);
    });

    it('lets tonight win over default when a table has tonight lines', () => {
      const tables = { poster: { default: ['Every other night'], tonight: ['Tonight only'] } };
      expect(detailsFor({ kind: 'poster', tonight: true }, tables)).toBe(tables.poster.tonight);
      expect(detailsFor({ kind: 'poster', tonight: false }, tables)).toBe(tables.poster.default);
      // A table without tonight lines falls back to default on its night.
      expect(detailsFor({ kind: 'poster2', tonight: true }, { poster2: { default: ['Always'] } })).toEqual(['Always']);
    });

    it('has nothing to say about a promo it does not know', () => {
      expect(detailsFor(promo('bake-sale'))).toEqual([]);
      expect(detailsFor(null)).toEqual([]);
    });

    it('never uses an em dash', () => {
      for (const table of Object.values(PROMO_DETAILS)) {
        for (const lines of Object.values(table)) {
          expect(lines.join(' ')).not.toContain('—');
        }
      }
    });
  });

  it('uses no em dashes anywhere in the on-screen copy of the showreels', () => {
    for (const kind of ['veterans', 'snowAlerts']) {
      for (const tonight of [false, true]) {
        const { container } = render(<PromoSlide promo={promo(kind, { tonight, snow: null })} />);
        expect(container.textContent).not.toContain('—');
        cleanup();
      }
    }
  });
});
