import { createContext, useContext } from 'react';
import { motion } from 'framer-motion';

// Whether every animation should render instantly — no fades, no
// transforms, no repeating/looping motion — regardless of what any
// individual component asks for. Provided once near the app root in
// App.jsx, driven by config.reduceMotion (which the Journey Display
// kiosk embed forces on via ?lowPower=1; see CLAUDE.md).
//
// This is the enforcement mechanism for "zero animations in the Journey
// embed, guaranteed for future components too": `M.div`/`M.span`/etc.
// below read this context directly and override `transition` (the prop
// and any nested inside a target or variant) and `initial` unconditionally,
// so a component built with `M.*` instead of importing
// `motion` from 'framer-motion' directly is automatically covered — no
// per-component opt-in, and no way to forget it when adding a new
// animation later. `MotionConfig`'s own `reducedMotion="always"` prop
// (still set in App.jsx) only ever gates transform/positional values
// (x, y, scale, rotate, width, height, top/left/right/bottom — see
// framer-motion's own `positionalKeys` set), never opacity or anything
// else, which is why it alone can't reach true zero animation.
export const ZeroAnimationContext = createContext(false);

// framer-motion's own "jump straight to the target, no animation, no
// repeat" transition mode — the same mechanism its built-in reducedMotion
// support uses internally for the values it does gate. Using it here
// (rather than merely `{ duration: 0 }`) is what actually stops a
// `repeat: Infinity` loop from spinning forever at zero duration.
const INSTANT_TRANSITION = { type: false };

// A transition can also ride INSIDE a target: `exit={{ opacity: 0,
// transition: { duration: 0.3 } }}`, `animate={{ x: 10, transition }}`, or
// a variant's own `transition` (with its stagger orchestration). framer-motion
// lets that nested transition win over the element's `transition` prop, so
// overriding the prop alone left every such exit, and any variant-driven
// change after mount, still animating under ?lowPower=1. Under zero animation
// the nested ones are stripped too, which hands every change back to the
// instant prop above. Anything that is not a plain target object (a variant
// label, a list of labels, a keyframe list) passes through untouched.
const TARGET_PROPS = ['animate', 'exit', 'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView'];

export function stripTransition(target) {
  if (!target || typeof target !== 'object' || Array.isArray(target) || !('transition' in target)) return target;
  const { transition: _nested, ...rest } = target;
  return rest;
}

export function stripVariants(variants) {
  if (!variants || typeof variants !== 'object') return variants;
  return Object.fromEntries(Object.entries(variants).map(([name, v]) => [
    name,
    typeof v === 'function' ? (...args) => stripTransition(v(...args)) : stripTransition(v),
  ]));
}

function makeZeroAnimationAware(Component, displayName) {
  // React 19 passes `ref` as an ordinary prop, so the wrapper is a plain
  // function component (it needed forwardRef under React 18).
  function Wrapped({ transition, initial, ref, ...props }) {
    const zeroAnimation = useContext(ZeroAnimationContext);
    if (zeroAnimation) {
      for (const key of TARGET_PROPS) {
        if (key in props) props[key] = stripTransition(props[key]);
      }
      if (props.variants) props.variants = stripVariants(props.variants);
    }
    // `initial` has to go too, not just the transition. An instant transition
    // still MOUNTS the element at its `initial` value and only reaches
    // `animate` on a later frame — so a crossfade inside <AnimatePresence>
    // (typed slides, pptx slides, the data cycle) leaves one frame where the
    // outgoing element has already exited to opacity 0 and the incoming one
    // is still at opacity 0: nothing painted. On a desktop that frame is
    // ~16ms and invisible; on the Journey kiosk's Pi Zero it was reported as
    // "a black screen for about a half second" between slides (2026-09-06).
    // `initial={false}` is framer-motion's own "render at the animate value
    // straight away", which is what zero animation should have meant all along.
    return (
      <Component
        ref={ref}
        {...props}
        initial={zeroAnimation ? false : initial}
        transition={zeroAnimation ? INSTANT_TRANSITION : transition}
      />
    );
  }
  Wrapped.displayName = displayName;
  return Wrapped;
}

const cache = new Map();

// `M.div`, `M.span`, `M.path`, etc. — a drop-in replacement for
// `motion.*` that additionally honors ZeroAnimationContext. Proxied so
// any tag framer-motion itself supports works here too without this
// file needing to enumerate every one by hand.
export const M = new Proxy(
  {},
  {
    get(_target, tag) {
      if (typeof tag !== 'string') return undefined;
      if (!cache.has(tag)) {
        cache.set(tag, makeZeroAnimationAware(motion[tag], `M.${tag}`));
      }
      return cache.get(tag);
    },
  }
);
