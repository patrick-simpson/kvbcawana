/* ── Motion: the full profile's motion graphics (owner 2026-10-12) ─────
   On a Mac, a PC or a phone (effectiveProfile() 'full') Journey moves like a
   sports broadcast: the splash, every menu, Read Prep, the handout. The Pi
   ('low') stays exactly as it was: no class, and every rule in style.css's
   motion block is scoped to html.motion-full (see that block for its
   rules).

   html.motion-full is set when ALL hold: full profile, not configure mode,
   and the OS does not ask for reduced motion (the stylesheet checks that
   too). It follows the quality buttons and the OS setting live. The motion
   itself is plain CSS that runs when an element is shown. */
const MOTION_CLASS = 'motion-full';
const reducedMotionQuery =
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function motionWanted() {
  if (CONFIGURE_MODE || effectiveProfile() !== 'full') return false;
  return !(reducedMotionQuery && reducedMotionQuery.matches);
}

function applyMotionProfile() {
  const root = document.documentElement;
  if (motionWanted()) {
    root.classList.add(MOTION_CLASS);
    return;
  }
  if (!root.classList.contains(MOTION_CLASS)) return; // never touch the low page
  root.classList.remove(MOTION_CLASS);
}

if (reducedMotionQuery) {
  if (typeof reducedMotionQuery.addEventListener === 'function') {
    reducedMotionQuery.addEventListener('change', applyMotionProfile);
  } else if (typeof reducedMotionQuery.addListener === 'function') {
    reducedMotionQuery.addListener(applyMotionProfile);
  }
}
applyMotionProfile();
