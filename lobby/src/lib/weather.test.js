import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  autoParticleEffect,
  buildForecastUrl,
  fetchCurrentWeather,
  geocodeLocation,
  weatherMood,
  weatherPresentation,
} from './weather.js';

afterEach(() => vi.unstubAllGlobals());

describe('weatherPresentation', () => {
  it('maps every documented WMO code group', () => {
    const cases = [
      [0, 'sun'], [1, 'sun'], [2, 'partly'], [3, 'cloud'],
      [45, 'fog'], [48, 'fog'],
      [51, 'rain'], [55, 'rain'], [56, 'rain'], [61, 'rain'], [65, 'rain'], [67, 'rain'],
      [71, 'snow'], [75, 'snow'], [77, 'snow'],
      [80, 'rain'], [82, 'rain'], [85, 'snow'], [86, 'snow'],
      [95, 'storm'], [96, 'storm'], [99, 'storm'],
    ];
    for (const [code, icon] of cases) {
      expect(weatherPresentation(code, true).icon, `code ${code}`).toBe(icon);
    }
  });

  it('falls back to partly cloudy on unknown codes', () => {
    expect(weatherPresentation(42, true)).toEqual({ label: 'Partly cloudy', icon: 'partly', theme: 'sky' });
    expect(weatherPresentation(undefined, true).icon).toBe('partly');
  });

  it('clear night becomes a moon on the night theme', () => {
    expect(weatherPresentation(0, false)).toEqual({ label: 'Clear skies', icon: 'moon', theme: 'night' });
    expect(weatherPresentation(0, true)).toEqual({ label: 'Clear skies', icon: 'sun', theme: 'sky' });
  });

  it('themes match the vibe: snow → lavender, rain → meadow, storm → night', () => {
    expect(weatherPresentation(73, true).theme).toBe('lavender');
    expect(weatherPresentation(63, true).theme).toBe('meadow');
    expect(weatherPresentation(95, true).theme).toBe('night');
  });

  it('every result uses a real CatalogScene theme', () => {
    const themes = ['sky', 'sunset', 'night', 'meadow', 'lavender'];
    for (let code = 0; code <= 99; code++) {
      for (const isDay of [true, false]) {
        expect(themes).toContain(weatherPresentation(code, isDay).theme);
      }
    }
  });
});

describe('buildForecastUrl', () => {
  it('includes coordinates, current fields, and units', () => {
    const url = buildForecastUrl({ lat: 44.552, lon: -69.6317, units: 'fahrenheit' });
    expect(url).toContain('api.open-meteo.com/v1/forecast');
    expect(url).toContain('latitude=44.552');
    expect(url).toContain('longitude=-69.6317');
    expect(url).toContain('temperature_unit=fahrenheit');
    expect(url).toContain('weather_code');
  });

  it('supports celsius and defaults anything else to fahrenheit', () => {
    expect(buildForecastUrl({ lat: 1, lon: 2, units: 'celsius' })).toContain('temperature_unit=celsius');
    expect(buildForecastUrl({ lat: 1, lon: 2, units: 'kelvin' })).toContain('temperature_unit=fahrenheit');
  });
});

describe('fetchCurrentWeather', () => {
  const okPayload = {
    current: { temperature_2m: 41.6, apparent_temperature: 35.9, weather_code: 85, is_day: 0 },
  };

  it('rounds temps and normalizes the shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => okPayload }));
    expect(await fetchCurrentWeather({ lat: 44.5, lon: -69.6 })).toEqual({
      temp: 42, apparent: 36, code: 85, isDay: false, units: 'fahrenheit',
    });
  });

  it('returns null on HTTP errors, bad payloads, network failures, and bad coords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await fetchCurrentWeather({ lat: 1, lon: 2 })).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ current: {} }) }));
    expect(await fetchCurrentWeather({ lat: 1, lon: 2 })).toBeNull();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await fetchCurrentWeather({ lat: 1, lon: 2 })).toBeNull();

    expect(await fetchCurrentWeather({ lat: NaN, lon: 2 })).toBeNull();
  });
});

describe('geocodeLocation', () => {
  it('returns the top hit with a friendly name', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ name: 'Waterville', admin1: 'Maine', latitude: 44.552, longitude: -69.6317 }] }),
    }));
    expect(await geocodeLocation('waterville maine')).toEqual({
      name: 'Waterville, Maine', lat: 44.552, lon: -69.6317,
    });
  });

  it('returns null for empty input, no matches, or failures', async () => {
    expect(await geocodeLocation('')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    expect(await geocodeLocation('nowheresville')).toBeNull();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    expect(await geocodeLocation('waterville')).toBeNull();
  });
});

describe('weatherMood', () => {
  // The season owns the palette; weather only adds atmosphere over it. These
  // guard that the modifier is a MODIFIER — it never picks a theme, and a
  // failed weather fetch must change nothing.
  it('is neutral with no reading, so a failed fetch changes nothing', () => {
    expect(weatherMood(null)).toEqual({ cozy: false, dim: 1, reason: 'none' });
    expect(weatherMood(undefined).cozy).toBe(false);
    expect(weatherMood({}).cozy).toBe(false);
    expect(weatherMood({ code: 'x' }).cozy).toBe(false);
  });

  it('goes cozy for rain, snow, fog and thunder', () => {
    expect(weatherMood({ code: 63, isDay: true }).cozy).toBe(true);   // rain
    expect(weatherMood({ code: 73, isDay: true }).cozy).toBe(true);   // snow
    expect(weatherMood({ code: 45, isDay: true }).cozy).toBe(true);   // fog
    expect(weatherMood({ code: 95, isDay: true }).cozy).toBe(true);   // thunder
  });

  it('stays bright for clear and merely cloudy skies', () => {
    // Dimming for ordinary dusk would leave most club nights muted.
    expect(weatherMood({ code: 0, isDay: true }).cozy).toBe(false);
    expect(weatherMood({ code: 2, isDay: false }).cozy).toBe(false);
    expect(weatherMood({ code: 3, isDay: false }).cozy).toBe(false);
  });

  it('dims a rainy night more than a rainy day', () => {
    const night = weatherMood({ code: 63, isDay: false }).dim;
    const day = weatherMood({ code: 63, isDay: true }).dim;
    expect(night).toBeLessThan(day);
  });

  it('never dims below the floor the CSS clamps to', () => {
    for (const code of [0, 2, 3, 45, 51, 63, 71, 73, 80, 95, 99]) {
      for (const isDay of [true, false]) {
        const { dim } = weatherMood({ code, isDay });
        expect(dim, `code ${code} isDay ${isDay}`).toBeGreaterThanOrEqual(0.6);
        expect(dim).toBeLessThanOrEqual(1);
      }
    }
  });

  it('thunder is the strongest mood', () => {
    const thunder = weatherMood({ code: 95, isDay: true }).dim;
    for (const code of [45, 63, 73]) {
      expect(thunder).toBeLessThanOrEqual(weatherMood({ code, isDay: true }).dim);
    }
  });
});

describe('autoParticleEffect', () => {
  it('matches precipitation outside: snow codes → snow, rain/storm codes → rain', () => {
    for (const code of [71, 73, 75, 77, 85, 86]) {
      expect(autoParticleEffect({ code }), `code ${code}`).toBe('snow');
    }
    for (const code of [51, 55, 61, 63, 65, 66, 80, 82, 95, 99]) {
      expect(autoParticleEffect({ code }), `code ${code}`).toBe('rain');
    }
  });

  it('adds nothing for clear, cloudy or foggy skies', () => {
    for (const code of [0, 1, 2, 3, 45, 48]) {
      expect(autoParticleEffect({ code }), `code ${code}`).toBeNull();
    }
  });

  it('returns null for unknown weather, so a dead fetch means no particles', () => {
    expect(autoParticleEffect(null)).toBeNull();
    expect(autoParticleEffect(undefined)).toBeNull();
    expect(autoParticleEffect({})).toBeNull();
  });
});
