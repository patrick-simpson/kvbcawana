import React from 'react';
import { useLowPower } from '../hooks/useLowPower.js';
import { autoSkin } from '../../lib/skins.js';

// ── Rain ──
const RAINDROPS = Array.from({ length: 60 }, (_, i) => ({
  id: i,
  left: `${(i * 1.67) % 100}%`,
  duration: `${1.5 + (i % 10) * 0.15}s`,
  delay: `${-((i * 0.33) % 2)}s`,
  size: `${2 + (i % 4) * 0.5}px`,
  opacity: 0.3 + (i % 6) * 0.05,
}));

// ── Snow ──
const SNOWFLAKES = Array.from({ length: 50 }, (_, i) => ({
  id: i,
  left: `${(i * 2.04) % 100}%`,
  duration: `${8 + (i % 5) * 0.8}s`,
  delay: `${-((i * 1.6) % 8)}s`,
  size: `${8 + (i % 6) * 2}px`,
  opacity: 0.6 + (i % 4) * 0.075,
}));

// ── Clouds ──
// `left` spreads each cloud across the sky; `cloudDrift` only swings a
// clou around ITS OWN anchor (±150px), so without a distinct per-cloud
// left every cloud defaults to the same spot (the container's static
// position, near the left edge) and the whole flock piles up and
// oscillates in place instead of dotting the sky.
const CLOUDS = Array.from({ length: 6 }, (_, i) => ({
  id: i,
  top: `${10 + (i * 11) % 60}%`,
  left: `${5 + (i * 16) % 90}%`,
  duration: `${20 + (i * 3) % 10}s`,
  delay: `${-(i * 3.3)}s`,
  size: `${100 + (i * 17) % 80}px`,
  opacity: 0.4 + (i % 3) * 0.07,
}));

// ── Fog ──
// Same reasoning as CLOUDS above — each blob needs its own `left`, or
// cloudDrift's ±150px swing just oscillates the whole bank in place.
const FOG_BLOBS = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  top: `${(i * 12.5) % 100}%`,
  left: `${(i * 12.5 + 6) % 100}%`,
  duration: `${30 + (i * 4) % 15}s`,
  delay: `${-(i * 3.75)}s`,
  size: `${200 + (i * 23) % 150}px`,
  opacity: 0.15 + (i % 4) * 0.025,
}));

// ── Starfield (evening sky) ──
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  left: `${(i * 13.7 + 5) % 100}%`,
  top: `${(i * 17.3 + 3) % 100}%`,
  size: `${1 + (i % 4) * 0.6}px`,
  minOpacity: 0.08 + (i % 5) * 0.04,
  maxOpacity: 0.4 + (i % 4) * 0.15,
  duration: `${2 + (i % 7) * 0.8}s`,
  delay: `${-((i * 0.7) % 6)}s`,
}));

const SHOOTING_STARS = Array.from({ length: 3 }, (_, i) => ({
  id: i,
  startX: `${15 + i * 30}%`,
  startY: `${5 + i * 12}%`,
  dx: 200 + i * 80,
  dy: 120 + i * 40,
  duration: `${1.2 + i * 0.3}s`,
  delay: `${i * 7 + 2}s`,
  cycleDuration: `${18 + i * 5}s`,
}));

// ── Seasonal elements ──
// Derived from the shared skin table (src/lib/skins.js, on the presentation
// import allowlist) rather than a second month table of its own. The two used
// to disagree — November was 'harvest' on the signage side and 'winter' here —
// so the same evening could be autumn on one screen and winter on the other.
//
// The ambient layer only needs a coarse bucket (which particles to drop), so
// the fine-grained skins collapse onto four.
const SKIN_SEASONS = {
  spring: 'spring',
  easter: 'spring',
  summer: 'summer',
  vbs: 'summer',
  autumn: 'autumn',
  harvest: 'autumn',
  thanksgiving: 'autumn',
  backtoschool: 'autumn',
  christmas: 'winter',
  snowday: 'winter',
};

function getSeason() {
  return SKIN_SEASONS[autoSkin(new Date())] ?? 'winter';
}

const AUTUMN_LEAVES = Array.from({ length: 15 }, (_, i) => ({
  id: i,
  left: `${(i * 6.8 + 2) % 100}%`,
  color: ['#D2691E', '#FF8C00', '#B22222', '#DAA520', '#8B4513'][i % 5],
  size: `${6 + (i % 4) * 3}px`,
  duration: `${10 + (i % 6) * 2}s`,
  delay: `${-((i * 1.5) % 12)}s`,
  opacity: 0.3 + (i % 4) * 0.1,
}));

const SPRING_BLOSSOMS = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  left: `${(i * 8.5 + 3) % 100}%`,
  color: ['#FFB7C5', '#FF69B4', '#FFC0CB', '#FFD1DC', '#ffffff'][i % 5],
  size: `${5 + (i % 3) * 2}px`,
  duration: `${12 + (i % 5) * 2}s`,
  delay: `${-((i * 2) % 14)}s`,
  opacity: 0.25 + (i % 4) * 0.08,
}));

const FIREFLIES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  left: `${(i * 10.3 + 5) % 95}%`,
  top: `${(i * 9.7 + 10) % 80}%`,
  glowDuration: `${3 + (i % 4) * 1.5}s`,
  driftDuration: `${8 + (i % 5) * 2}s`,
  delay: `${-((i * 1.3) % 8)}s`,
  x1: 20 + (i % 3) * 15,
  y1: -(10 + (i % 4) * 10),
  x2: -(10 + (i % 5) * 8),
  y2: 10 + (i % 3) * 12,
  x3: 15 + (i % 4) * 10,
  y3: -(15 + (i % 3) * 8),
}));

export const WeatherScene = ({ weather }) => {
  const lowPower = useLowPower();
  // Computed per render (not at module load) so a projector left
  // running for months rolls into the new season's effects.
  const season = getSeason();
  if (lowPower) return null;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">

      {/* ── Starfield (always visible, dimmed during heavy weather) ── */}
      <div className="absolute inset-0" style={{
        opacity: weather === 'rain' || weather === 'thunder' ? 0.15 :
                 weather === 'fog' || weather === 'cloudy' ? 0.3 :
                 weather === 'snow' ? 0.4 : 1,
        transition: 'opacity 2s ease',
      }}>
        {STARS.map(star => (
          <div
            key={star.id}
            className="absolute rounded-full bg-white"
            style={{
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              ['--star-min']: star.minOpacity,
              ['--star-max']: star.maxOpacity,
              animation: `twinkle ${star.duration} ease-in-out ${star.delay} infinite`,
            }}
          />
        ))}

        {/* Shooting stars (clear/cloudy only) */}
        {(weather === 'clear' || weather === 'cloudy') && SHOOTING_STARS.map(star => (
          <div
            key={star.id}
            className="absolute"
            style={{
              left: star.startX,
              top: star.startY,
              width: '3px',
              height: '2px',
              borderRadius: '1px',
              background: 'linear-gradient(90deg, transparent, #ffffff)',
              boxShadow: '0 0 6px 1px rgba(255,255,255,0.5)',
              ['--shoot-x']: `${star.dx}px`,
              ['--shoot-y']: `${star.dy}px`,
              animation: `shootingStar ${star.duration} linear ${star.delay} infinite`,
              animationDuration: star.cycleDuration,
            }}
          />
        ))}
      </div>

      {/* ── Rain ── */}
      {weather === 'rain' && (
        <div className="absolute inset-0">
          {RAINDROPS.map(drop => (
            <div
              key={drop.id}
              className="absolute bg-blue-300"
              style={{
                left: drop.left,
                width: drop.size,
                height: '30px',
                opacity: drop.opacity,
                transform: 'rotate(20deg)',
                animation: `rainFall ${drop.duration} linear infinite`,
                animationDelay: drop.delay,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Snow ── */}
      {weather === 'snow' && (
        <div className="absolute inset-0">
          {SNOWFLAKES.map(flake => (
            <div
              key={flake.id}
              className="absolute rounded-full bg-white"
              style={{
                left: flake.left,
                width: flake.size,
                height: flake.size,
                opacity: flake.opacity,
                animation: `snowFall ${flake.duration} ease-in infinite`,
                animationDelay: flake.delay,
              }}
            />
          ))}
        </div>
      )}

      {/* ── Thunder (rain + flash) ── */}
      {weather === 'thunder' && (
        <>
          <div className="absolute inset-0">
            {RAINDROPS.map(drop => (
              <div
                key={drop.id}
                className="absolute bg-blue-300"
                style={{
                  left: drop.left,
                  width: drop.size,
                  height: '30px',
                  opacity: drop.opacity * 0.8,
                  transform: 'rotate(20deg)',
                  animation: `rainFall ${drop.duration} linear infinite`,
                  animationDelay: drop.delay,
                }}
              />
            ))}
          </div>
          <div
            className="absolute inset-0 bg-white"
            style={{ animation: 'thunderFlash 8s ease-in-out infinite' }}
          />
        </>
      )}

      {/* ── Cloudy ── */}
      {weather === 'cloudy' && (
        <div className="absolute inset-0">
          {CLOUDS.map(cloud => (
            <div
              key={cloud.id}
              className="absolute rounded-full bg-white"
              style={{
                top: cloud.top,
                left: cloud.left,
                width: cloud.size,
                height: `${Math.round(parseInt(cloud.size) * 0.5)}px`,
                opacity: cloud.opacity,
                animation: `cloudDrift ${cloud.duration} ease-in-out infinite`,
                animationDelay: cloud.delay,
                filter: 'blur(30px)',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Fog ── */}
      {weather === 'fog' && (
        <div className="absolute inset-0">
          {FOG_BLOBS.map(blob => (
            <div
              key={blob.id}
              className="absolute rounded-full bg-white"
              style={{
                top: blob.top,
                left: blob.left,
                width: blob.size,
                height: blob.size,
                opacity: blob.opacity,
                animation: `cloudDrift ${blob.duration} ease-in-out infinite`,
                animationDelay: blob.delay,
                filter: 'blur(60px)',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Seasonal overlays ── */}
      {season === 'autumn' && (
        <div className="absolute inset-0">
          {AUTUMN_LEAVES.map(leaf => (
            <div
              key={leaf.id}
              className="absolute rounded-sm"
              style={{
                left: leaf.left,
                width: leaf.size,
                height: leaf.size,
                backgroundColor: leaf.color,
                opacity: leaf.opacity,
                animation: `leafFall ${leaf.duration} linear ${leaf.delay} infinite`,
                transform: 'rotate(45deg)',
              }}
            />
          ))}
        </div>
      )}

      {season === 'spring' && (
        <div className="absolute inset-0">
          {SPRING_BLOSSOMS.map(blossom => (
            <div
              key={blossom.id}
              className="absolute rounded-full"
              style={{
                left: blossom.left,
                width: blossom.size,
                height: blossom.size,
                backgroundColor: blossom.color,
                opacity: blossom.opacity,
                animation: `blossomFall ${blossom.duration} ease-in-out ${blossom.delay} infinite`,
              }}
            />
          ))}
        </div>
      )}

      {season === 'summer' && (
        <div className="absolute inset-0">
          {FIREFLIES.map(fly => (
            <div
              key={fly.id}
              className="absolute"
              style={{
                left: fly.left,
                top: fly.top,
                width: '4px',
                height: '4px',
                borderRadius: '50%',
                backgroundColor: '#BFFF00',
                boxShadow: '0 0 8px 3px rgba(191,255,0,0.6), 0 0 16px 6px rgba(191,255,0,0.2)',
                ['--fly-x1']: `${fly.x1}px`,
                ['--fly-y1']: `${fly.y1}px`,
                ['--fly-x2']: `${fly.x2}px`,
                ['--fly-y2']: `${fly.y2}px`,
                ['--fly-x3']: `${fly.x3}px`,
                ['--fly-y3']: `${fly.y3}px`,
                animation: `fireflyGlow ${fly.glowDuration} ease-in-out ${fly.delay} infinite, fireflyDrift ${fly.driftDuration} ease-in-out ${fly.delay} infinite`,
              }}
            />
          ))}
        </div>
      )}

      {/* Winter gets extra sparkle via enhanced starfield - no additional overlay needed */}
    </div>
  );
};
