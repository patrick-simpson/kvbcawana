// The film's motion toolkit. Every value is a pure function of time, so any
// frame can be drawn on its own, in any order, and two renders are identical.
// The curves and the spring are the brand kit's (lobby/shared/brand/tokens.json
// motion table; lobby/src/lib/squish.js for the spring: stiffness 260,
// damping 17, mass 1).

/** A CSS cubic-bezier as a function of progress. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const e = sx(t) - x;
      if (Math.abs(e) < 1e-6) break;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    if (Math.abs(sx(t) - x) > 1e-5) {
      t = x;
      for (let i = 0; i < 30; i++) {
        if (sx(t) < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

export const E = {
  wipe: bezier(0.76, 0, 0.24, 1),
  settle: bezier(0.16, 1, 0.3, 1),
  pop: bezier(0.34, 1.56, 0.64, 1),
  exit: bezier(0.7, 0, 0.84, 0),
  inOut: bezier(0.45, 0, 0.55, 1),
  out: bezier(0.22, 1, 0.36, 1),
  in: bezier(0.55, 0, 1, 0.45),
  linear: (x) => x,
};

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, k) => a + (b - a) * k;
/** Progress through [t0, t0 + d], clamped. */
export const prog = (t, t0, d) => (d <= 0 ? (t >= t0 ? 1 : 0) : clamp((t - t0) / d));

/**
 * Keyframes: [[time, value, easeIntoThisKey?], ...] in time order. Before
 * the first key it holds the first value, after the last the last.
 */
export function kf(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease = E.inOut] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return lerp(v0, v1, ease(prog(t, t0, t1 - t0)));
  }
  return keys[keys.length - 1][1];
}

// Jelly UI's spring (lobby/src/lib/squish.js): zeta ~0.527.
const K = 260, C = 17, M = 1;
const W0 = Math.sqrt(K / M);
const Z = C / (2 * Math.sqrt(K * M));
const WD = W0 * Math.sqrt(1 - Z * Z);

/** The spring's step response: 0 before t0, rings past 1, settles at 1. */
export function spring(t, t0, speed = 1) {
  const x = (t - t0) * speed;
  if (x <= 0) return 0;
  return 1 - Math.exp(-Z * W0 * x) * (Math.cos(WD * x) + (Z / Math.sqrt(1 - Z * Z)) * Math.sin(WD * x));
}

/** The squish after an impact at t0: [scaleX, scaleY], ringing down to [1, 1]. */
export function squish(t, t0, depth = 0.12, speed = 1) {
  const x = (t - t0) * speed;
  if (x < 0) return [1, 1];
  const a = depth * Math.exp(-Z * W0 * x) * Math.cos(WD * x);
  return [1 + a * 0.5, 1 - a];
}

/* ── DOM ───────────────────────────────────────────────────────────── */

export function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Place an element: x/y translate (px), s (uniform scale), sx/sy, r (deg),
 * o (opacity). Only what is given is written.
 */
export function put(e, { x = 0, y = 0, s = 1, sx = 1, sy = 1, r = 0, o } = {}) {
  e.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${r.toFixed(3)}deg) scale(${(s * sx).toFixed(4)}, ${(s * sy).toFixed(4)})`;
  if (o !== undefined) {
    e.style.opacity = String(clamp(o));
    e.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
  }
}
