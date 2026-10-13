import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  BLOSSOMS, BOLTS, BOLT_LOOP_SECS, CLOUDS, FIREFLIES, FOG_BANDS, LEAVES, RAINDROPS, SNOWFLAKES, SPLASHES, STORM_CLOUDS,
  WeatherScene, getSeason, scatter,
} from './WeatherScene.jsx';
import { setLowPowerPreference } from '../hooks/useLowPower.js';

// The countdown's weather, redrawn flat (owner 2026-10-12: "What's the weird
// diagonal white blur? Make it more obvious what it is"). Each weather mounts
// the shapes that say it, nothing anywhere is a blur or a soft gradient, the
// low-power switch still hides the whole layer, OS reduced motion shows the
// still frame and the chip (owner 2026-10-13), and the still frame (no
// animation at all) is a finished picture of the same weather.

const css = readFileSync(resolve(__dirname, '../index.css'), 'utf8');
const source = readFileSync(resolve(__dirname, 'WeatherScene.jsx'), 'utf8');
/** index.css's weather section: from its heading to the next section. */
const weatherCss = (() => {
  const at = css.indexOf('/* ── The weather scene');
  if (at < 0) throw new Error('no weather section in index.css');
  return css.slice(at, css.indexOf('/* ── Test / kiosk determinism', at));
})();

const reading = (type, extra = {}) => ({ type, temp: 54, isDay: false, at: Date.now(), ...extra });
const count = (container, kind) => container.querySelectorAll(`[data-wx="${kind}"]`).length;
const layers = (container) => [...container.querySelectorAll('[data-wx-layer]')].map((el) => el.dataset.wxLayer);

afterEach(() => {
  cleanup();
  setLowPowerPreference(false);
  vi.useRealTimers();
});

/** Render on a given day (the season's pieces follow the date). */
function renderOn(date, props) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(date));
  return render(<WeatherScene {...props} />);
}
const WINTER = '2026-01-14T19:00:00';

describe('WeatherScene: each weather draws its own shapes', () => {
  it('clear: the starfield only, and a chip naming it', () => {
    const { container } = renderOn(WINTER, { reading: reading('clear') });
    expect(layers(container)).toEqual(['stars']);
    expect(container.querySelectorAll('.pj-wx-star').length).toBeGreaterThan(40);
    expect(count(container, 'shooting-star')).toBeGreaterThan(0);
    expect(container.querySelector('[data-weather-chip]').textContent).toBe('Clear · 54°F');
  });

  it('cloudy: flat cartoon clouds, each a cloud path over its hard offset shadow', () => {
    const { container } = renderOn(WINTER, { reading: reading('cloudy') });
    expect(layers(container)).toEqual(['stars', 'clouds']);
    const clouds = container.querySelectorAll('[data-wx="cloud"]');
    expect(clouds).toHaveLength(CLOUDS.length);
    for (const cloud of clouds) {
      const paths = cloud.querySelectorAll('path');
      expect(paths).toHaveLength(2);
      expect(paths[0].getAttribute('d')).toBe(paths[1].getAttribute('d'));
      expect(paths[0].getAttribute('transform')).toMatch(/^translate\(/);
    }
    expect(count(container, 'shooting-star')).toBe(0);
    expect(container.querySelector('[data-weather-chip]').textContent).toBe('Cloudy · 54°F');
  });

  it('fog: ground bands and floating wavy stripes', () => {
    const { container } = renderOn(WINTER, { reading: reading('fog') });
    expect(layers(container)).toEqual(['stars', 'fog']);
    expect(count(container, 'fog-band')).toBe(FOG_BANDS.filter((b) => b.kind === 'ground').length);
    expect(count(container, 'fog-stripe')).toBe(FOG_BANDS.filter((b) => b.kind === 'stripe').length);
    expect(count(container, 'fog-band')).toBeGreaterThan(1);
    expect(count(container, 'fog-stripe')).toBeGreaterThan(1);
    expect(container.querySelector('[data-weather-chip]').textContent).toBe('Foggy · 54°F');
  });

  it('rain: slanted streaks falling and splashes at the bottom', () => {
    const { container } = renderOn(WINTER, { reading: reading('rain') });
    expect(layers(container)).toEqual(['stars', 'rain']);
    expect(count(container, 'drop')).toBe(RAINDROPS.length);
    expect(count(container, 'splash')).toBe(SPLASHES.length);
    // Every streak leans the way it falls (the CSS turns .pj-wx-drop; the Faller slides with the same slant).
    for (const el of container.querySelectorAll('[data-wx="drop"]')) expect(el.style.getPropertyValue('--wx-slant')).toBe('0.25');
    expect(weatherCss).toMatch(/\.pj-wx-drop \{[^}]*transform: rotate\(-14deg\)/);
  });

  it('thunder: dark clouds, rain, and the zig-zag bolts riding their clouds', () => {
    const { container } = renderOn(WINTER, { reading: reading('thunder', { temp: 71.6 }) });
    expect(layers(container)).toEqual(['stars', 'rain', 'storm']);
    expect(count(container, 'cloud')).toBe(STORM_CLOUDS.length);
    const bolts = container.querySelectorAll('[data-wx="bolt"]');
    expect(bolts).toHaveLength(BOLTS.length);
    for (const bolt of bolts) expect(bolt.parentElement.dataset.wx).toBe('cloud');
    expect(count(container, 'drop')).toBeGreaterThan(20);
    expect(container.querySelector('[data-weather-chip]').textContent).toBe('Thunder · 72°F');
  });

  it('snow: flat flakes in three sizes, sinking and swaying', () => {
    const { container } = renderOn(WINTER, { reading: reading('snow') });
    expect(layers(container)).toEqual(['stars', 'snow']);
    for (const size of ['small', 'medium', 'large']) expect(count(container, `flake-${size}`)).toBe(SNOWFLAKES.length / 3);
    expect(container.querySelectorAll('[data-wx-layer="snow"] .pj-wx-sway')).toHaveLength(SNOWFLAKES.length);
  });

  it('no reading: the plain starfield and no chip', () => {
    const { container } = renderOn(WINTER, { reading: null });
    expect(container.querySelector('.pj-wx').dataset.weather).toBe('clear');
    expect(layers(container)).toEqual(['stars']);
    expect(container.querySelector('[data-weather-chip]')).toBeNull();
  });

  it('the chip is readable, the art is not read out', () => {
    const { container } = renderOn(WINTER, { reading: reading('rain') });
    const chip = container.querySelector('[data-weather-chip]');
    expect(chip.getAttribute('aria-label')).toBe('Weather outside: Rain · 54°F');
    expect(chip.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('[data-wx-layer="rain"]').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('WeatherScene: the season, in the same flat language', () => {
  it('autumn drops flat leaves, spring blossoms, summer sparkle fireflies, winter nothing extra', () => {
    const cases = [
      ['2026-10-14T19:00:00', 'autumn', 'leaf', LEAVES.length],
      ['2026-04-22T19:00:00', 'spring', 'blossom', BLOSSOMS.length],
      ['2026-07-15T19:00:00', 'summer', 'firefly', FIREFLIES.length],
    ];
    for (const [date, season, kind, n] of cases) {
      const { container } = renderOn(date, { reading: reading('cloudy') });
      expect(container.querySelector('.pj-wx').dataset.season).toBe(season);
      expect(count(container, kind)).toBe(n);
      cleanup();
    }
    const { container } = renderOn(WINTER, { reading: reading('cloudy') });
    expect(getSeason(new Date(WINTER))).toBe('winter');
    expect(layers(container)).toEqual(['stars', 'clouds']);
  });
});

describe('WeatherScene: flat, never a blur', () => {
  const TYPES = ['clear', 'cloudy', 'fog', 'rain', 'snow', 'thunder'];
  const DATES = [WINTER, '2026-10-14T19:00:00', '2026-04-22T19:00:00', '2026-07-15T19:00:00'];

  it('no rendered piece of any weather in any season carries a blur, a glow or a gradient', () => {
    for (const date of DATES) {
      for (const type of TYPES) {
        const { container } = renderOn(date, { reading: reading(type) });
        const html = container.innerHTML;
        expect(html, `${type} on ${date}`).not.toMatch(/blur|gradient|box-shadow|drop-shadow|feGaussian|filter/i);
        for (const el of container.querySelectorAll('*')) expect(el.style.filter, `${type} on ${date}`).toBe('');
        cleanup();
      }
    }
  });

  it('nor does the source or the scene\'s stylesheet', () => {
    expect(source).not.toMatch(/blur\(|gradient\(|boxShadow|drop-shadow|feGaussianBlur/);
    expect(weatherCss).not.toMatch(/blur\(|gradient\(|drop-shadow|filter:/);
  });

  it('every weather keyframe moves only transform and opacity, and is plain CSS (outside @theme)', () => {
    const names = [...weatherCss.matchAll(/@keyframes (pjWx\w+) \{([\s\S]*?)\n\}/g)];
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const [, name, body] of names) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      for (const prop of props) expect(['transform', 'opacity'], `${name}: ${prop}`).toContain(prop);
    }
    // Every animation the scene names is defined here, where the build keeps it.
    const used = new Set([...weatherCss.matchAll(/animation:\s*([\s\S]*?);/g)].flatMap((m) => [...m[1].matchAll(/(pjWx\w+)/g)].map((x) => x[1])));
    for (const name of used) expect(names.map((n) => n[1])).toContain(name);
    const theme = css.slice(css.indexOf('@theme {'), css.indexOf('\n}\n', css.indexOf('@theme {')));
    expect(theme).not.toMatch(/pjWx/);
  });
});

describe('WeatherScene: photosensitivity', () => {
  it('the bolts flash at most twice in any second and never cover the wall', () => {
    const frames = [...weatherCss.match(/@keyframes pjWxBolt \{([\s\S]*?)\n\}/)[1].matchAll(/([\d.%, ]+)\{\s*opacity: ([\d.]+);/g)]
      .flatMap(([, stops, o]) => stops.split(',').map((s) => ({ at: parseFloat(s) / 100, on: Number(o) > 0 })))
      .sort((a, b) => a.at - b.at);
    // Each "on" run is one flash; collect their start times over a few loops, both bolts.
    const starts = [];
    for (const bolt of BOLTS) {
      for (let k = 0; k < 4; k += 1) {
        frames.forEach((f, i) => {
          if (f.on && !(frames[i - 1]?.on)) starts.push((k + f.at) * BOLT_LOOP_SECS - bolt.delay);
        });
      }
    }
    starts.sort((a, b) => a - b);
    expect(starts.length).toBe(BOLTS.length * 4 * 2);
    for (const t of starts) expect(starts.filter((s) => s >= t && s < t + 1).length).toBeLessThanOrEqual(2);
    // A bolt is a small piece of its cloud, never a full-wall flash.
    expect(weatherCss).toMatch(/\.pj-wx-bolt \{[^}]*width: 17%/);
    expect(source).not.toMatch(/bg-white|inset-0/);
  });
});

describe('WeatherScene: low power and the still frame', () => {
  it('the low-power switch still hides the whole layer, chip included', () => {
    setLowPowerPreference(true);
    const { container } = renderOn(WINTER, { reading: reading('cloudy') });
    expect(container.innerHTML).toBe('');
  });

  /** A fresh WeatherScene module whose OS answers `reduce` (and, with `vr`, a ?vr=1 address). */
  async function freshScene({ reduce = false, vr = false } = {}) {
    vi.resetModules();
    const realMatch = window.matchMedia;
    const realUrl = window.location.href;
    window.matchMedia = (q) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} });
    if (vr) window.history.replaceState(null, '', '?vr=1');
    const mod = await import('./WeatherScene.jsx');
    const lowPower = await import('../hooks/useLowPower.js');
    const restore = () => {
      lowPower.setLowPowerPreference(false);
      window.matchMedia = realMatch;
      window.history.replaceState(null, '', realUrl);
      vi.resetModules();
    };
    return { WeatherScene: mod.WeatherScene, setLowPowerPreference: lowPower.setLowPowerPreference, restore };
  }

  it('OS reduced motion shows the still frame and the chip (an accessibility setting: no motion, not no weather)', async () => {
    const { WeatherScene: Scene, restore } = await freshScene({ reduce: true });
    try {
      for (const type of ['clear', 'cloudy', 'fog', 'rain', 'snow', 'thunder']) {
        const { container } = render(<Scene reading={reading(type)} />);
        const scene = container.querySelector('.pj-wx');
        expect(scene, type).not.toBeNull();
        expect(scene.classList.contains('pj-wx--still'), type).toBe(true);
        expect(scene.dataset.weather).toBe(type);
        expect(container.querySelector('[data-weather-chip]'), type).not.toBeNull();
        cleanup();
      }
      // Thunder's still frame: ONE bolt lit and steady (the kill rule stops pjWxBolt, so it never flashes).
      const storm = render(<Scene reading={reading('thunder')} />).container;
      const lit = [...storm.querySelectorAll('[data-wx="bolt"]')].filter((b) => b.style.getPropertyValue('--wx-o0') === '1');
      expect(lit).toHaveLength(1);
      expect(weatherCss).toMatch(/\.pj-wx-bolt \{[^}]*opacity: var\(--wx-o0\);/);
      cleanup();
      // The rain's splashes stand, the drops are on the wall.
      const rain = render(<Scene reading={reading('rain')} />).container;
      expect([...rain.querySelectorAll('[data-wx="splash"]')].filter((el) => Number(el.style.opacity) > 0).length).toBeGreaterThanOrEqual(3);
      expect(rain.querySelector('[data-wx-layer="rain"]')).not.toBeNull();
    } finally {
      restore();
    }
  });

  it('the low-power switch beats reduced motion: switch on, nothing at all', async () => {
    const { WeatherScene: Scene, setLowPowerPreference: setSwitch, restore } = await freshScene({ reduce: true });
    try {
      setSwitch(true);
      expect(render(<Scene reading={reading('thunder')} />).container.innerHTML).toBe('');
    } finally {
      restore();
    }
  });

  it('?vr=1 (screenshots, and the switch\'s address form) still hides the layer', async () => {
    const { WeatherScene: Scene, restore } = await freshScene({ vr: true });
    try {
      expect(render(<Scene reading={reading('rain')} />).container.innerHTML).toBe('');
    } finally {
      restore();
    }
  });

  it('with neither, the scene moves: no still class', () => {
    const { container } = renderOn(WINTER, { reading: reading('rain') });
    expect(container.querySelector('.pj-wx').classList.contains('pj-wx--still')).toBe(false);
  });

  it('`still` (and the reduced-motion rule) stops every animation in the scene', () => {
    const { container } = renderOn(WINTER, { reading: reading('snow'), still: true });
    expect(container.querySelector('.pj-wx').classList.contains('pj-wx--still')).toBe(true);
    expect(weatherCss).toMatch(/\.pj-wx--still \*,[\s\S]*?animation: none !important;/);
    expect(weatherCss).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.pj-wx \*,[\s\S]*?animation: none !important;/);
  });

  it('the still frame is a picture of the same weather: everything on the wall, one bolt lit, splashes standing', () => {
    const onWall = (p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100;
    for (const p of [...CLOUDS, ...STORM_CLOUDS, ...RAINDROPS, ...SNOWFLAKES, ...LEAVES, ...BLOSSOMS]) expect(onWall(p)).toBe(true);
    const { container } = renderOn(WINTER, { reading: reading('thunder') });
    const lit = [...container.querySelectorAll('[data-wx="bolt"]')].filter((b) => b.style.getPropertyValue('--wx-o0') === '1');
    expect(lit).toHaveLength(1);
    cleanup();
    const rain = renderOn(WINTER, { reading: reading('rain') }).container;
    const standing = [...rain.querySelectorAll('[data-wx="splash"]')].filter((s) => Number(s.style.opacity) > 0);
    expect(standing.length).toBeGreaterThanOrEqual(3);
  });

  it('every loop starts from the still frame (no jump when the motion begins)', () => {
    for (const p of [...RAINDROPS, ...SNOWFLAKES, ...LEAVES, ...BLOSSOMS]) {
      // pjWxFall runs from 8vh above the top to 4vh below the bottom (112vh).
      expect((-p.delay / p.secs) * 112 - 8).toBeCloseTo(p.y, 6);
    }
    for (const c of [...CLOUDS, ...STORM_CLOUDS]) {
      // pjWxDrift runs from just off the left edge to just off the right.
      expect((-c.delay / c.secs) * (104 + c.w) - c.w - 2).toBeCloseTo(c.x, 6);
    }
  });

  it('scatters pieces evenly with no rows or diagonals, the same every time', () => {
    const a = scatter(20, 7);
    expect(scatter(20, 7)).toEqual(a);
    for (const axis of ['x', 'y']) {
      const bands = a.map((p) => Math.floor(p[axis] * 20)).sort((m, n) => m - n);
      expect(bands).toEqual(Array.from({ length: 20 }, (_, i) => i));
    }
    // Not a straight line: x does not simply follow y.
    const ordered = [...a].sort((m, n) => m.y - n.y).map((p) => p.x);
    const rising = ordered.every((x, i) => i === 0 || x > ordered[i - 1]);
    const falling = ordered.every((x, i) => i === 0 || x < ordered[i - 1]);
    expect(rising || falling).toBe(false);
  });
});
