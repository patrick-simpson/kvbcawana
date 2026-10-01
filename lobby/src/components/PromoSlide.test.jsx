import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ZeroAnimationContext } from '../lib/motion.jsx';
import PromoSlide, { PROMO_DETAILS, RotatingDetail, detailsFor, splatPath } from './PromoSlide.jsx';

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
  eventDate: kind === 'parents' ? '2026-11-04' : '2026-10-14',
  tonight: false,
  countdown: '3 club nights left',
  afterContest: false,
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

  // The one rotating line is where every small line from the first pass
  // went. Which strings it carries is a pure decision (detailsFor), and
  // the cadence is RotatingDetail's own job, so they are pinned apart:
  // fake timers cannot drive framer-motion's crossfade, because its
  // frame loop captured the real requestAnimationFrame at import.
  describe('the detail copy (detailsFor)', () => {
    it('gives every known poster lines to say, tonight and otherwise', () => {
      for (const kind of ['contest', 'friend', 'barfEpic', 'parents']) {
        expect(detailsFor(promo(kind)).length, kind).toBeGreaterThan(0);
        expect(detailsFor(promo(kind, { tonight: true })).length, kind).toBeGreaterThan(0);
      }
    });

    it('lets tonight win over afterContest', () => {
      const table = PROMO_DETAILS.parents;
      expect(detailsFor(promo('parents', { tonight: true, afterContest: true }))).toBe(table.tonight);
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

  describe('the rotating detail line (RotatingDetail)', () => {
    const LINES = Object.freeze(['First line', 'Second line', 'Third line']);
    const detail = (c) => c.querySelector('.promo-detail')?.textContent;

    // Steps well clear of the 0.35 s crossfade, so each line is actually
    // on screen long enough to be caught; the real slide gives them 2.2 s.
    it('shows each line in turn and then stops on the last', async () => {
      const { container } = render(<RotatingDetail lines={LINES} startMs={300} stepMs={1000} />);
      expect(detail(container)).toBe('First line');
      await waitFor(() => expect(detail(container)).toBe('Second line'), { timeout: 3000 });
      await waitFor(() => expect(detail(container)).toBe('Third line'), { timeout: 3000 });
      // No wrap back round: the slide is remounted on its next visit.
      await new Promise((r) => setTimeout(r, 300));
      expect(detail(container)).toBe('Third line');
    });

    it('sits on its LAST line at once under zero animation, and never rotates', async () => {
      const { container } = render(
        <ZeroAnimationContext.Provider value>
          <RotatingDetail lines={LINES} startMs={30} stepMs={30} />
        </ZeroAnimationContext.Provider>
      );
      expect(detail(container)).toBe('Third line');
      await new Promise((r) => setTimeout(r, 200));
      expect(detail(container)).toBe('Third line');
    });

    it('holds still for a single line rather than blinking it', async () => {
      const { container } = render(<RotatingDetail lines={['Only line']} startMs={30} stepMs={30} />);
      await new Promise((r) => setTimeout(r, 200));
      expect(detail(container)).toBe('Only line');
    });

    it('renders nothing at all when there is nothing to say', () => {
      const { container } = render(<RotatingDetail lines={[]} />);
      expect(container.querySelector('.promo-detail-slot')).toBeNull();
    });

    it('clears its timer chain on unmount', async () => {
      const { unmount } = render(<RotatingDetail lines={LINES} startMs={30} stepMs={30} />);
      unmount();
      // A surviving timer would setState on an unmounted component here.
      await new Promise((r) => setTimeout(r, 200));
    });
  });

  describe('the shared poster frame', () => {
    it('gives every poster exactly one detail slot and one countdown chip', () => {
      for (const kind of ['contest', 'friend', 'barfEpic', 'parents']) {
        const { container } = render(<PromoSlide promo={promo(kind)} />);
        expect(container.querySelectorAll('.promo-detail-slot')).toHaveLength(1);
        expect(container.querySelectorAll('.promo-chip')).toHaveLength(1);
        cleanup();
      }
    });

    it('sets every poster on the same depth layers', () => {
      for (const kind of ['contest', 'friend', 'barfEpic', 'parents']) {
        const { container } = render(<PromoSlide promo={promo(kind)} />);
        expect(container.querySelector('.promo-texture')).not.toBeNull();
        expect(container.querySelector('.promo-vignette')).not.toBeNull();
        cleanup();
      }
    });
  });

  // The splats are drawn, not drawn ONCE: an unstable path would reshuffle
  // every stain on the poster on every re-render, and App re-renders on the
  // clock tick.
  describe('the slime splat path (splatPath)', () => {
    it('is the same shape every time for a seed', () => {
      expect(splatPath(17, 8)).toBe(splatPath(17, 8));
      expect(splatPath(17, 8)).not.toBe(splatPath(18, 8));
    });

    it('is a closed path with two points per arm', () => {
      const d = splatPath(41, 7);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('z')).toBe(true);
      expect(d.match(/Q/g)).toHaveLength(14);
      expect(d).not.toContain('NaN');
    });
  });

  describe('the countdown chip', () => {
    it('shows the line it was given', () => {
      render(<PromoSlide promo={promo('friend', { countdown: 'Next club night' })} />);
      expect(screen.getByText('Next club night')).toBeTruthy();
    });

    it('says Tonight! on the night', () => {
      render(<PromoSlide promo={promo('parents', { tonight: true, countdown: 'Tonight!' })} />);
      expect(screen.getByText('Tonight!')).toBeTruthy();
    });

    it('is absent entirely when there is nothing to count', () => {
      const { container } = render(<PromoSlide promo={promo('contest', { countdown: null })} />);
      expect(container.querySelector('.promo-chip')).toBeNull();
    });
  });

  describe('the Awana Clubs wordmark', () => {
    it('is on every promo', () => {
      for (const kind of ['contest', 'friend', 'barfEpic', 'parents']) {
        const { container } = render(<PromoSlide promo={promo(kind)} />);
        expect(container.querySelector('.promo-wordmark')).not.toBeNull();
        cleanup();
      }
    });

    it('takes itself off the screen if the art cannot load', () => {
      const { container } = render(<PromoSlide promo={promo('contest')} />);
      const img = container.querySelector('.promo-wordmark');
      fireEvent.error(img);
      expect(container.querySelector('.promo-wordmark')).toBeNull();
      // The rest of the poster is untouched.
      expect(container.querySelector('.promo-slide--contest')).not.toBeNull();
    });
  });

  it('uses no em dashes anywhere in its on-screen copy', () => {
    for (const kind of ['contest', 'friend', 'barfEpic', 'parents']) {
      for (const tonight of [false, true]) {
        const { container } = render(<PromoSlide promo={promo(kind, { tonight, afterContest: tonight })} />);
        expect(container.textContent).not.toContain('—');
        cleanup();
      }
    }
  });
});
