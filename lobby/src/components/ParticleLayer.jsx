import { DOODLES } from '../lib/brand.js';

// Ambient particle layer for the signage page (#26): a gentle full-screen
// snowfall, rainfall, or sparkle field the operator picks in Settings.
// In the kit (rebrand stage 4b-2): the sparkle field throws the catalog's
// own doodles (four-point sparkles, x-sparkles, dots and rings) instead of a
// generic text star, flat white with no glow; snow and rain keep their own
// signature shapes (a flake is a dot, rain a streak), flattened the same
// way. On a seasonal night some sparkles take the skin's pair (app.css).
// Design rules:
//   • pure CSS animation on a deterministic particle set — computed once at
//     module load, so there is zero per-frame JS and zero re-render churn
//     (the same trick as the presentation tool's ParticleField);
//   • decoration only: pointer-events none, aria-hidden, and the whole layer
//     is skipped by App under reduceMotion / panic mode;
//   • sits just above the background (z-index 1), far below banners and
//     widgets — atmosphere, never in front of a child's name.
const COUNT = { snow: 44, rain: 60, sparkle: 26 };

// The sparkle field's doodles, in the order particles take them.
const SPARKLE_KINDS = ['sparkle', 'dot', 'sparkleX', 'sparkle', 'ring', 'sparkleX'];

function build(effect) {
  return Array.from({ length: COUNT[effect] }, (_, i) => {
    // Small co-prime multipliers scatter the particles evenly without
    // Math.random(), so tests and re-mounts always agree.
    const left = ((i * 37 + 11) % 97) + 1.5;
    switch (effect) {
      case 'rain':
        return {
          id: i,
          style: {
            left: `${left}%`,
            height: `${34 + (i % 5) * 12}px`,
            animationDuration: `${0.9 + (i % 7) * 0.13}s`,
            animationDelay: `${-((i * 0.41) % 3).toFixed(2)}s`,
            opacity: 0.16 + (i % 4) * 0.06,
          },
        };
      case 'sparkle':
        return {
          id: i,
          kind: SPARKLE_KINDS[i % SPARKLE_KINDS.length],
          style: {
            left: `${left}%`,
            top: `${((i * 53 + 7) % 92) + 3}%`,
            // Sized in the lobby's u, like the doodles on the scene behind.
            fontSize: `calc(${(0.6 + (i % 5) * 0.28).toFixed(2)} * var(--u))`,
            animationDuration: `${2.6 + (i % 6) * 0.7}s`,
            animationDelay: `${-((i * 0.83) % 5).toFixed(2)}s`,
          },
        };
      default: // snow
        return {
          id: i,
          style: {
            left: `${left}%`,
            width: `${4 + (i % 4) * 2.5}px`,
            height: `${4 + (i % 4) * 2.5}px`,
            animationDuration: `${8 + (i % 9) * 1.7}s`,
            animationDelay: `${-((i * 1.9) % 16).toFixed(2)}s`,
            opacity: 0.35 + (i % 5) * 0.11,
          },
        };
    }
  });
}

const PARTICLES = {
  snow: build('snow'),
  rain: build('rain'),
  sparkle: build('sparkle'),
};

function Doodle({ kind }) {
  const shape = DOODLES[kind];
  return (
    <svg viewBox={shape.viewBox} focusable="false">
      <path d={shape.d} fill="currentColor" />
    </svg>
  );
}

export default function ParticleLayer({ effect }) {
  const particles = PARTICLES[effect];
  if (!particles) return null;
  return (
    <div className={`particle-layer particle-${effect}`} aria-hidden>
      {particles.map((p) => (
        <span key={p.id} className={p.kind ? `particle particle--${p.kind}` : 'particle'} style={p.style}>
          {p.kind ? <Doodle kind={p.kind} /> : null}
        </span>
      ))}
    </div>
  );
}
