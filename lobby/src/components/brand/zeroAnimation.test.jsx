import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { AnimatePresence } from 'framer-motion';
import { M, ZeroAnimationContext } from '../../lib/motion.jsx';
import Wave from './Wave.jsx';
import CornerTab from './CornerTab.jsx';
import Sticker from './Sticker.jsx';
import DoodleCluster from './DoodleCluster.jsx';
import { holdThenLand } from '../../lib/lobbyMotion.js';
import { squishLand, withSquish } from '../../lib/squish.js';

// Under ?lowPower=1 (the Pi Zero embed) nothing may move, and whatever a
// primitive is animating toward is the frame that screen shows for good.
// This renders each primitive through the REAL framer-motion (no mock)
// inside zero-animation mode and checks that every element lands on its
// resting frame at once: full opacity, no leftover transform, and for the
// doodles' endless twinkle, the loop's last keyframe (full size, upright).
//
// The later stages sample the same thing on the live page once these are
// wired into screens; until then this is the gate the plan promised.

afterEach(cleanup);

const zero = (ui) => render(<ZeroAnimationContext.Provider value>{ui}</ZeroAnimationContext.Provider>);

// Far shorter than any entrance below (the shortest runs 460 ms, most wait
// out a delay first), so only an instant jump can pass inside it.
const INSTANT = { timeout: 150 };

/** An element is at rest when nothing about it is still mid-entrance. */
function atRest(el) {
  const opacity = el.style.opacity === '' ? 1 : Number(el.style.opacity);
  const t = el.style.transform;
  return opacity === 1 && (t === '' || t === 'none');
}

// The entrances the check-in moment will actually use (stage 3's plan):
// a wave that rises, a tab that slides in, a sticker that pops.
const ENTRANCES = {
  wave: { initial: { y: '100%' }, animate: { y: 0 }, transition: { duration: 0.64, ease: [0.76, 0, 0.24, 1] } },
  tab: { initial: { x: '-100%', opacity: 0 }, animate: { x: 0, opacity: 1 }, transition: { duration: 0.52, delay: 0.3 } },
  sticker: { initial: { scale: 0, rotate: -30 }, animate: { scale: 1, rotate: 0 }, transition: { duration: 0.46, delay: 0.9 } },
};

describe('brand primitives under zero-animation mode', () => {
  it('a rising wave is already risen', async () => {
    const { container } = zero(<Wave color="#F04A4B" {...ENTRANCES.wave} />);
    const el = container.querySelector('.brand-wave');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });

  it('a sliding corner tab is already in place', async () => {
    const { container } = zero(<CornerTab color="#58BD79" {...ENTRANCES.tab}>T&amp;T</CornerTab>);
    const el = container.querySelector('.brand-tab');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });

  it('a popping sticker is already stuck on', async () => {
    const { container } = zero(<Sticker {...ENTRANCES.sticker}>NEW!</Sticker>);
    const el = container.querySelector('.brand-sticker');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });

  it('every doodle has landed, and the twinkle rests at full size', async () => {
    const items = [
      { kind: 'sparkle', x: '0', y: '0', size: '1em' },
      { kind: 'dot', x: '0', y: '0', size: '1em' },
      { kind: 'ring', x: '0', y: '0', size: '1em' },
    ];
    const { container } = zero(<DoodleCluster items={items} delay={1.2} twinkle />);
    const doodles = [...container.querySelectorAll('.brand-doodle')];
    const twinkles = [...container.querySelectorAll('.brand-doodle__twinkle')];
    expect(doodles).toHaveLength(3);
    expect(twinkles).toHaveLength(3);
    await waitFor(() => {
      for (const el of [...doodles, ...twinkles]) expect(atRest(el)).toBe(true);
    }, INSTANT);
  });

  it('a rotated doodle rests at its own angle, not mid-spin', async () => {
    const { container } = zero(<DoodleCluster items={[{ kind: 'sparkle', x: '0', y: '0', size: '1em', rotate: 20 }]} />);
    const el = container.querySelector('.brand-doodle');
    await waitFor(() => {
      expect(Number(el.style.opacity || 1)).toBe(1);
      expect(el.style.transform).toBe('rotate(20deg)');
    }, INSTANT);
  });

  // Through the real framer-motion: an exit that carries its own long
  // transition (which beats the element's transition prop) must still leave
  // at once, or a banner would hang on the Pi for as long as its exit says.
  it('an exit with its own nested transition still leaves at once', async () => {
    const tree = (show) => (
      <ZeroAnimationContext.Provider value>
        <AnimatePresence>
          {show && (
            <M.div key="x" className="leaving" exit={{ opacity: 0, y: 40, transition: { duration: 5, delay: 2 } }}>
              bye
            </M.div>
          )}
        </AnimatePresence>
      </ZeroAnimationContext.Provider>
    );
    const { container, rerender } = render(tree(true));
    expect(container.querySelector('.leaving')).not.toBeNull();
    rerender(tree(false));
    await waitFor(() => expect(container.querySelector('.leaving')).toBeNull(), INSTANT);
  });
});

// The soft squish (src/lib/squish.js) rides per-value transitions inside the
// transition prop and inside targets. Under zero animation M replaces the
// prop and strips the nested ones, so a squished piece must land at once on
// its last keyframe, 1 on both axes: no scale left in its transform at all.
describe('the soft squish under zero-animation mode', () => {
  const beat = withSquish(
    holdThenLand(1.4, 0.52, { opacity: 0, y: '0.45em', scale: 0.85 }, { opacity: 1, y: '0em', scale: 1 }, [0.16, 1, 0.3, 1]),
    squishLand(1.4, 'text', 0.52, 'settle'),
  );

  it('a squished landing (the beat shape) has already landed', async () => {
    const { container } = zero(<M.span className="word" initial={beat.initial} animate={beat.animate} transition={beat.transition}>HI</M.span>);
    const el = container.querySelector('.word');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });

  it('a squished target with its own nested transition has already landed', async () => {
    const target = withSquish({ opacity: 1, y: '0%', scale: 1, transition: { duration: 0.46, ease: [0.34, 1.56, 0.64, 1] } }, squishLand(0.28, 'plate', 0.46, 'pop'));
    const { container } = zero(<M.div className="plate" initial={{ opacity: 0, y: '-40%' }} animate={target}>NOTICE</M.div>);
    const el = container.querySelector('.plate');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });

  it('a check-in sticker popping in with its squish is already stuck on', async () => {
    const pop = withSquish(
      holdThenLand(0.9, 0.46, { opacity: 0, scale: 0.2, rotate: -40 }, { opacity: 1, scale: 1, rotate: 0 }, [0.34, 1.56, 0.64, 1]),
      squishLand(0.9, 'sticker', 0.46, 'pop'),
    );
    const { container } = zero(<Sticker initial={pop.initial} animate={pop.animate} transition={pop.transition}>NEW!</Sticker>);
    const el = container.querySelector('.brand-sticker');
    await waitFor(() => expect(atRest(el)).toBe(true), INSTANT);
  });
});
