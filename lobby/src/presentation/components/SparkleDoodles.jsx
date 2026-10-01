import React, { useMemo } from 'react';
import { mulberry32 } from '../lib/color.js';
import { useLowPower } from '../hooks/useLowPower.js';
import { usePortrait } from '../lib/touch.js';
import { CELEBRATION, HOUSE } from '../lib/kit.js';

const KINDS = ['sparkle', 'sparkle', 'star', 'dot', 'ring', 'squiggle', 'zigzag'];

/** Upright, the band of the screen (in % of its height) the doodles keep clear: every view's words. */
export const PORTRAIT_CLEAR = { top: 10, bottom: 76 };

// The family kit's colours: every club, the sun, white and Awana orange.
const BRAND = [...CELEBRATION, HOUSE.orange];

/**
 * Hand-drawn catalog doodads — 4-point sparkles, stars, dots, rings,
 * squiggles, zigzag stairs — deterministically scattered around the
 * screen edges (the center is kept clear for content) with a gentle
 * twinkle. Same seed → same layout, render after render. Upright on a phone
 * or tablet (lib/touch.js) the words run the frame's full width, so there the
 * clear zone is a full-width band instead of a centred box, and the doodles
 * keep to the top and the bottom of the screen.
 */
export const SparkleDoodles = ({
  seed = 1,
  colors = BRAND,
  count = 14,
  className = '',
}) => {
  const lowPower = useLowPower();
  const portrait = usePortrait();
  const doodles = useMemo(() => {
    const rand = mulberry32(seed * 7919 + 17);
    const items = [];
    let guard = 0;
    while (items.length < count && guard++ < count * 20) {
      const left = 2 + rand() * 94;
      const top = 3 + rand() * 90;
      // keep the middle clear for the main content
      if (portrait ? top > PORTRAIT_CLEAR.top && top < PORTRAIT_CLEAR.bottom : left > 22 && left < 78 && top > 22 && top < 78) continue;
      items.push({
        id: items.length,
        kind: KINDS[Math.floor(rand() * KINDS.length)],
        left,
        top,
        size: 14 + rand() * 30,
        color: colors[Math.floor(rand() * colors.length)],
        rotate: Math.floor(rand() * 50 - 25),
        duration: 2.5 + rand() * 4,
        delay: -rand() * 6,
        min: 0.25 + rand() * 0.2,
        max: 0.7 + rand() * 0.3,
      });
    }
    return items;
  }, [seed, colors, count, portrait]);

  if (lowPower) return null;
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      {doodles.map((d) => (
        <div
          key={d.id}
          className="absolute animate-sparkle"
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: d.size,
            height: d.size,
            transform: `rotate(${d.rotate}deg)`,
            animationDuration: `${d.duration}s`,
            animationDelay: `${d.delay}s`,
            ['--star-min']: d.min,
            ['--star-max']: d.max,
          }}
        >
          <DoodleShape kind={d.kind} color={d.color} />
        </div>
      ))}
    </div>
  );
};

const DoodleShape = ({ kind, color }) => {
  switch (kind) {
    case 'sparkle':
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <path
            d="M12 0C13.1 6.9 17.1 10.9 24 12C17.1 13.1 13.1 17.1 12 24C10.9 17.1 6.9 13.1 0 12C6.9 10.9 10.9 6.9 12 0Z"
            fill={color}
          />
        </svg>
      );
    case 'star':
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <path
            d="M12 1L14.8 8.6L22.8 9L16.5 14L18.5 21.8L12 17.3L5.5 21.8L7.5 14L1.2 9L9.2 8.6Z"
            fill={color}
          />
        </svg>
      );
    case 'dot':
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <circle cx="7" cy="14" r="3" fill={color} />
          <circle cx="17" cy="8" r="2" fill={color} opacity="0.7" />
        </svg>
      );
    case 'ring':
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <circle cx="12" cy="12" r="8" fill="none" stroke={color} strokeWidth="2.5" />
        </svg>
      );
    case 'squiggle':
      return (
        <svg viewBox="0 0 32 16" className="w-full h-full">
          <path
            d="M2 8 Q6 1 10 8 T18 8 T26 8 T30 8"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'zigzag':
      return (
        <svg viewBox="0 0 24 24" className="w-full h-full">
          <path
            d="M3 21H9V15H15V9H21"
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};
