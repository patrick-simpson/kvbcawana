import React from 'react';
import { useLowPower } from '../hooks/useLowPower.js';
import { CELEBRATION } from '../lib/kit.js';

// Deterministic particles — no randomization on each render
const PARTICLES = Array.from({ length: 45 }, (_, i) => ({
  id: i,
  left: `${(i * 31 + 13) % 96 + 2}%`,
  bottom: `${(i * 19 + 3) % 18}%`,
  size: `${1.2 + (i % 4) * 0.7}px`,
  duration: `${11 + (i % 9) * 1.8}s`,
  delay: `${-((i * 2.3) % 18)}s`,
  opacity: 0.10 + (i % 6) * 0.055,
  // The kit's club colours, the sun and white (lib/kit.js).
  color: CELEBRATION[i % CELEBRATION.length],
}));

export const ParticleField = () => {
  const lowPower = useLowPower();
  if (lowPower) return null;
  return (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    {PARTICLES.map(p => (
      <div
        key={p.id}
        className="absolute rounded-full animate-particle-float"
        style={{
          left: p.left,
          bottom: p.bottom,
          width: p.size,
          height: p.size,
          backgroundColor: p.color,
          opacity: p.opacity,
          animationDuration: p.duration,
          animationDelay: p.delay,
        }}
      />
    ))}
  </div>
  );
};
