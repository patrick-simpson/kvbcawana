import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import CatalogScene from './CatalogScene.jsx';
import { ZeroAnimationContext } from '../lib/motion.jsx';

const scene = (container) => container.querySelector('.catalog-scene');
const tint = (container) => container.querySelector('.scene-club-tint');

describe('CatalogScene club tint (#349)', () => {
  afterEach(cleanup);

  it('renders no tint by default, so an untouched install looks unchanged', () => {
    const { container } = render(<CatalogScene theme="sky" still />);
    expect(scene(container).classList.contains('catalog-scene--club-tinted')).toBe(false);
    expect(scene(container).style.getPropertyValue('--club-tint')).toBe('');
    // The layer is still MOUNTED — it is what the fade animates, so it cannot
    // appear and disappear with the tint itself.
    expect(tint(container)).not.toBeNull();
  });

  it('sets the club colour as a custom property while the banner is up', () => {
    const { container } = render(<CatalogScene theme="sky" still clubTint="#AEC4F2" />);
    expect(scene(container).classList.contains('catalog-scene--club-tinted')).toBe(true);
    expect(scene(container).style.getPropertyValue('--club-tint')).toBe('#AEC4F2');
  });

  it('clears the tint when the banner leaves but KEEPS the colour to fade out to', () => {
    const { container, rerender } = render(<CatalogScene theme="sky" still clubTint="#AEC4F2" />);
    rerender(<CatalogScene theme="sky" still clubTint={null} />);
    // The class is what carries the opacity, so dropping it is what fades out…
    expect(scene(container).classList.contains('catalog-scene--club-tinted')).toBe(false);
    // …and the colour has to outlive it, or the layer would snap to
    // transparent and there would be nothing to fade.
    expect(scene(container).style.getPropertyValue('--club-tint')).toBe('#AEC4F2');
  });

  it('swaps to the next club\'s colour on a back-to-back arrival', () => {
    const { container, rerender } = render(<CatalogScene theme="sky" still clubTint="#AEC4F2" />);
    rerender(<CatalogScene theme="sky" still clubTint="#FFC9C4" />);
    expect(scene(container).style.getPropertyValue('--club-tint')).toBe('#FFC9C4');
    expect(scene(container).classList.contains('catalog-scene--club-tinted')).toBe(true);
  });

  it('leaves the scene\'s own theme and dimming alone', () => {
    const { container } = render(<CatalogScene theme="night" still cozy dim={0.8} clubTint="#AEC4F2" />);
    const el = scene(container);
    expect(el.classList.contains('catalog-scene--night')).toBe(true);
    expect(el.classList.contains('catalog-scene--cozy')).toBe(true);
    expect(el.style.getPropertyValue('--scene-dim')).toBe('0.8');
  });

  it('paints the wash under the scene\'s children, so slide copy stays crisp', () => {
    const { container } = render(
      <CatalogScene theme="sky" still clubTint="#AEC4F2">
        <p className="manual-slide-text">Welcome!</p>
      </CatalogScene>
    );
    const kids = [...scene(container).children];
    expect(kids.indexOf(tint(container)))
      .toBeLessThan(kids.findIndex((n) => n.querySelector?.('.manual-slide-text') || n.classList.contains('manual-slide-text')));
  });
});

describe('CatalogScene as the lobby (rebrand stage 4b)', () => {
  afterEach(cleanup);

  it('is the approved studio: a field, the corner tab with the Awana Clubs mark, two house waves', () => {
    const { container } = render(<CatalogScene theme="sky" still />);
    expect(container.querySelector('.lobby-field--sky')).not.toBeNull();
    expect(container.querySelectorAll('.lobby-cloud')).toHaveLength(2);
    expect(container.querySelectorAll('.lobby-doodle').length).toBeGreaterThanOrEqual(6);
    expect(container.querySelector('.lobby-tab img').getAttribute('src')).toMatch(/awana-clubs-white/);
    expect(container.querySelector('.lobby-wave--sun')).not.toBeNull();
    expect(container.querySelector('.lobby-wave--house')).not.toBeNull();
  });

  it('paints the copy between the field and the chrome', () => {
    const { container } = render(<CatalogScene theme="sky" still><p className="copy">Hi</p></CatalogScene>);
    const kids = [...scene(container).children].map((n) => n.className);
    expect(kids.indexOf('lobby-content')).toBeGreaterThan(kids.indexOf('lobby-fields'));
    expect(kids.findIndex((c) => c.startsWith('lobby-chrome'))).toBeGreaterThan(kids.indexOf('lobby-content'));
  });

  it('a still scene (thumbnails, weak hardware) carries no ambient loops', () => {
    const { container } = render(<CatalogScene theme="sky" still />);
    expect(scene(container).classList.contains('lobby--still')).toBe(true);
  });

  it('every theme paints its own field, and an unknown one falls back to the sky', () => {
    for (const theme of ['sunset', 'night', 'meadow', 'lavender']) {
      const { container, unmount } = render(<CatalogScene theme={theme} still />);
      expect(container.querySelector(`.lobby-field--${theme}`)).not.toBeNull();
      unmount();
    }
    const { container } = render(<CatalogScene theme="plaid" still />);
    expect(container.querySelector('.lobby-field--sky')).not.toBeNull();
  });

  // Under zero animation M jumps every value to its last keyframe, so the
  // styles show where the chrome ends up; framer-motion applies them on its
  // own frame, which only real timers drive. How and when it moves there is
  // pinned in lobbyWiring.test.jsx.
  describe('the chrome, where it ends up', () => {
    const scene = (away, via) => (
      <ZeroAnimationContext.Provider value>
        <CatalogScene theme="sky" chromeAway={away} chromeVia={via} />
      </ZeroAnimationContext.Provider>
    );
    const settle = () => act(() => new Promise((r) => setTimeout(r, 60)));
    const style = (c, sel) => {
      const el = c.querySelector(sel);
      return { opacity: el.style.opacity || '1', transform: el.style.transform || 'none' };
    };
    const HOME = { opacity: '1', transform: 'none' };

    it('a poster (under the stinger) hides the tab and the waves where they stand, and brings them back', async () => {
      const { container, rerender } = render(scene(false, 'boot'));
      await settle();
      expect(style(container, '.lobby-tab')).toEqual(HOME);
      rerender(scene(true, 'wipe'));
      await settle();
      expect(style(container, '.lobby-tab')).toEqual({ opacity: '0', transform: 'none' });
      expect(style(container, '.lobby-waves')).toEqual({ opacity: '0', transform: 'none' });
      rerender(scene(false, 'wipe'));
      await settle();
      expect(style(container, '.lobby-tab')).toEqual(HOME);
      expect(style(container, '.lobby-waves')).toEqual(HOME);
    });

    it('a video on an ordinary change sends the tab up and out and the waves down and out, and calls them back', async () => {
      const { container, rerender } = render(scene(false, 'boot'));
      rerender(scene(true, 'handoff'));
      await settle();
      expect(style(container, '.lobby-tab')).toEqual({ opacity: '1', transform: 'translateY(-112%)' });
      expect(style(container, '.lobby-waves')).toEqual({ opacity: '1', transform: 'translateY(112%)' });
      rerender(scene(false, 'reveal'));
      await settle();
      expect(style(container, '.lobby-tab')).toEqual(HOME);
      expect(style(container, '.lobby-waves')).toEqual(HOME);
    });
  });
});
