import React, { useEffect } from 'react';
import { useLowPower } from '../hooks/useLowPower.js';
import { CELEBRATION } from '../lib/kit.js';

// Every club colour, the sun and white, from the family kit.
const CONFETTI_COLORS = CELEBRATION;

const CONFETTI_PIECES = Array.from({ length: 100 }, (_, i) => {
  const angle = (i / 100) * Math.PI * 2 + (i * 0.37);
  const speed = 25 + (i * 7.3) % 45;
  return {
    id: i,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    cx: Math.cos(angle) * speed,
    cy: Math.sin(angle) * speed * -0.7,
    rotation: ((i * 137) % 720) - 360,
    width: i % 3 === 0 ? 5 : i % 3 === 1 ? 10 : 7,
    height: i % 3 === 0 ? 5 : i % 3 === 1 ? 4 : 7,
    borderRadius: i % 3 === 0 ? '50%' : '2px',
    duration: 2 + (i % 8) * 0.2,
    delay: (i % 12) * 0.03,
  };
});

export const ConfettiBurst = ({ onComplete }) => {
  const lowPower = useLowPower();
  useEffect(() => {
    const timer = setTimeout(() => onComplete?.(), 3500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // Low power: the celebration still "happens" (onComplete timing is
  // unchanged) — only the falling pieces are skipped.
  if (lowPower) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {CONFETTI_PIECES.map(piece => (
        <div
          key={piece.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '45%',
            width: piece.width,
            height: piece.height,
            borderRadius: piece.borderRadius,
            backgroundColor: piece.color,
            ['--cx']: `${piece.cx}vw`,
            ['--cy']: `${piece.cy}vh`,
            ['--cr']: `${piece.rotation}deg`,
            animation: `confettiExplode ${piece.duration}s cubic-bezier(0.25, 0.46, 0.45, 0.94) ${piece.delay}s forwards`,
          }}
        />
      ))}
    </div>
  );
};
