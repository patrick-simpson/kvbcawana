// @ts-check
// URL flags for the presentation page, read once at load (the URL can't
// change without a full reload).
//
//   ?now=<ISO>   — time-travel QA (parsed in useClock.js)
//   ?freeze=1    — with ?now=, the simulated clock does NOT tick: every
//                  frame renders the same instant. For screenshots and
//                  visual-regression tests.
//   ?vr=1        — "visual regression" mode: kills all CSS animation,
//                  framer-motion transforms, and the ambient particle /
//                  weather layers so two renders of the same state are
//                  pixel-identical. Doubles as a low-power switch for
//                  weak projector hardware (see useLowPower.js).

function readFlags() {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      freeze: params.get('freeze') === '1',
      vr: params.get('vr') === '1',
    };
  } catch {
    return { freeze: false, vr: false };
  }
}

export const FLAGS = readFlags();
