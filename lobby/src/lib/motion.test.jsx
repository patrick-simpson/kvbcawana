import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { M, ZeroAnimationContext, stripTransition, stripVariants } from './motion.jsx';

// framer-motion's own animate() is exercised via a real DOM render; what
// we actually need to assert is the `transition` prop resolution, since
// that's the only thing this wrapper touches. Spying on framer-motion's
// motion.div itself would require reaching into its internals, so instead
// this renders through the real `motion.div` and inspects the resulting
// DOM/style behavior indirectly isn't reliable in jsdom (no real
// animation frames run there) — the meaningful, stable assertion is that
// the wrapper's OWN prop-forwarding logic picks the right transition
// object, which we verify by intercepting via a mock Component instead of
// the real motion.div, isolating this test from framer-motion's internals.
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_t, tag) => {
        const Tag = tag === 'div' ? 'div' : tag;
        return function MockMotionTag({ transition, initial, animate, exit, variants, children, ...rest }) {
          // Variants may hold functions (custom variants); resolve them with
          // a fixed `custom` so the rendered attribute shows what they return.
          const resolved = variants && Object.fromEntries(Object.entries(variants)
            .map(([k, v]) => [k, typeof v === 'function' ? v(1) : v]));
          return (
            <Tag
              data-transition={JSON.stringify(transition ?? null)}
              data-initial={JSON.stringify(initial ?? null)}
              data-animate={JSON.stringify(animate ?? null)}
              data-exit={JSON.stringify(exit ?? null)}
              data-variants={JSON.stringify(resolved ?? null)}
              {...rest}
            >
              {children}
            </Tag>
          );
        };
      },
    }
  ),
}));

describe('M (zero-animation-aware motion wrapper)', () => {
  it('passes the caller-provided transition through when zero-animation is off', () => {
    // JSON can't round-trip Infinity (becomes null), so this uses a
    // finite repeat count purely to keep the attribute-based assertion
    // exact — the wrapper's actual logic doesn't care what the value is.
    const { container } = render(
      <ZeroAnimationContext.Provider value={false}>
        <M.div transition={{ duration: 4, repeat: 3 }}>hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-transition]');
    expect(JSON.parse(el.dataset.transition)).toEqual({ duration: 4, repeat: 3 });
  });

  it('overrides ANY transition with { type: false } when zero-animation is on, even a repeating one', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <M.div transition={{ duration: 4, repeat: Infinity }}>hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-transition]');
    expect(JSON.parse(el.dataset.transition)).toEqual({ type: false });
  });

  it('defaults to zero-animation off when no provider is present', () => {
    const { container } = render(<M.span transition={{ duration: 2 }}>hi</M.span>);
    const el = container.querySelector('span[data-transition]');
    expect(JSON.parse(el.dataset.transition)).toEqual({ duration: 2 });
  });

  it('still forces instant even when the caller passed no transition at all', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <M.path>hi</M.path>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('path[data-transition]');
    expect(JSON.parse(el.dataset.transition)).toEqual({ type: false });
  });

  /* The half-second of black between slides on the kiosk (2026-09-06).
     An instant transition alone is not enough: framer-motion still mounts an
     element at its `initial` value and only reaches `animate` a frame later,
     so inside <AnimatePresence> the outgoing element has already exited to
     opacity 0 while the incoming one is still at opacity 0 — one frame with
     nothing painted, which a Pi Zero stretches into a visible black flash. */
  it('drops `initial` when zero-animation is on, so elements mount at their final state', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <M.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-initial]');
    expect(JSON.parse(el.dataset.initial)).toBe(false);
  });

  it('leaves `initial` untouched when zero-animation is off (the church\'s other screens keep their fades)', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value={false}>
        <M.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-initial]');
    expect(JSON.parse(el.dataset.initial)).toEqual({ opacity: 0 });
  });

  it('drops a variant-name `initial` too, not just an object', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <M.div initial="hidden" animate="show">hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-initial]');
    expect(JSON.parse(el.dataset.initial)).toBe(false);
  });

  it('resolves arbitrary tags through the proxy (svg elements, etc.)', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value={false}>
        <M.circle transition={{ duration: 1 }} />
      </ZeroAnimationContext.Provider>
    );
    expect(container.querySelector('circle[data-transition]')).toBeTruthy();
  });

  /* A transition nested inside a target wins over the element's own
     `transition` prop in framer-motion, so under zero animation the nested
     ones must go too or every exit and variant change still animates on the
     Pi (the old banner's 0.45 s exit did exactly that). */
  it('strips transitions nested in animate / exit / variants when zero-animation is on', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value>
        <M.div
          animate={{ x: 10, transition: { duration: 3, repeat: 2 } }}
          exit={{ opacity: 0, transition: { duration: 0.3, delay: 1 } }}
          variants={{
            show: { opacity: 1, transition: { staggerChildren: 0.1 } },
            hidden: (i) => ({ opacity: 0, y: i * 10, transition: { delay: i } }),
          }}
        >hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-animate]');
    expect(JSON.parse(el.dataset.animate)).toEqual({ x: 10 });
    expect(JSON.parse(el.dataset.exit)).toEqual({ opacity: 0 });
    expect(JSON.parse(el.dataset.variants)).toEqual({ show: { opacity: 1 }, hidden: { opacity: 0, y: 10 } });
    expect(JSON.parse(el.dataset.transition)).toEqual({ type: false });
  });

  it('leaves nested transitions alone when zero-animation is off', () => {
    const { container } = render(
      <ZeroAnimationContext.Provider value={false}>
        <M.div exit={{ opacity: 0, transition: { duration: 0.3 } }}>hi</M.div>
      </ZeroAnimationContext.Provider>
    );
    const el = container.querySelector('div[data-exit]');
    expect(JSON.parse(el.dataset.exit)).toEqual({ opacity: 0, transition: { duration: 0.3 } });
  });
});

describe('stripTransition / stripVariants', () => {
  it('passes labels, label lists, keyframe-free targets and nullish values through', () => {
    expect(stripTransition('show')).toBe('show');
    const labels = ['a', 'b'];
    expect(stripTransition(labels)).toBe(labels);
    const plain = { opacity: 1 };
    expect(stripTransition(plain)).toBe(plain);
    expect(stripTransition(undefined)).toBeUndefined();
    expect(stripVariants(undefined)).toBeUndefined();
  });

  it('keeps every animated value, including keyframe lists', () => {
    expect(stripTransition({ y: [0, -4, 0], opacity: 1, transition: { repeat: Infinity } })).toEqual({ y: [0, -4, 0], opacity: 1 });
  });
});
