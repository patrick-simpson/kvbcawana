// ─────────────────────────────────────────────────────────────
// Weather for the "nothing special next week" slide — Open-Meteo,
// which is free, keyless, and CORS-enabled, so it works straight
// from a static GitHub Pages site with zero backend.
//
//   forecast   https://api.open-meteo.com/v1/forecast
//   geocoding  https://geocoding-api.open-meteo.com/v1/search
//
// weatherPresentation maps WMO weather codes to the catalog's visual
// language: which hand-drawn glyph to draw, which CatalogScene theme
// to bathe the slide in, and a friendly label.
// ─────────────────────────────────────────────────────────────

// WMO code groups → { label, icon }. The label names the weather on the
// corner chip; the icon picks the scene theme and the night variant.
const WMO = [
  { codes: [0], label: 'Clear skies', icon: 'sun' },
  { codes: [1], label: 'Mostly sunny', icon: 'sun' },
  { codes: [2], label: 'Partly cloudy', icon: 'partly' },
  { codes: [3], label: 'Overcast', icon: 'cloud' },
  { codes: [45, 48], label: 'Foggy', icon: 'fog' },
  { codes: [51, 53, 55], label: 'Drizzle', icon: 'rain' },
  { codes: [56, 57], label: 'Freezing drizzle', icon: 'rain' },
  { codes: [61, 63, 65], label: 'Rain', icon: 'rain' },
  { codes: [66, 67], label: 'Freezing rain', icon: 'rain' },
  { codes: [71, 73, 75], label: 'Snow', icon: 'snow' },
  { codes: [77], label: 'Snow grains', icon: 'snow' },
  { codes: [80, 81, 82], label: 'Rain showers', icon: 'rain' },
  { codes: [85, 86], label: 'Snow showers', icon: 'snow' },
  { codes: [95], label: 'Thunderstorm', icon: 'storm' },
  { codes: [96, 99], label: 'Thunderstorm with hail', icon: 'storm' },
];

// Which CatalogScene sky the weather deserves. Night always wins for
// clear skies (moon on a starry night beats sun on blue).
const ICON_THEMES = {
  sun: { day: 'sky', night: 'night' },
  partly: { day: 'sky', night: 'night' },
  cloud: { day: 'meadow', night: 'night' },
  fog: { day: 'meadow', night: 'night' },
  rain: { day: 'meadow', night: 'night' },
  snow: { day: 'lavender', night: 'lavender' },
  storm: { day: 'night', night: 'night' },
};

/**
 * WMO code → coarse scene type for the presentation tool's ambient
 * WeatherScene ('clear' | 'cloudy' | 'fog' | 'rain' | 'snow' |
 * 'thunder'). Shared by both apps (this module is on the presentation
 * import allowlist) so the two never disagree about the sky.
 */
export function getWeatherType(code) {
  if (code === 0 || code === 1) return 'clear';
  if (code <= 3) return 'cloudy';
  if (code <= 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95) return 'thunder';
  return 'clear';
}

export function weatherPresentation(code, isDay = true) {
  const group = WMO.find((g) => g.codes.includes(Number(code)));
  const { label, icon } = group || { label: 'Partly cloudy', icon: 'partly' };
  const finalIcon = !isDay && (icon === 'sun' || icon === 'partly') ? 'moon' : icon;
  const themePair = ICON_THEMES[icon] || ICON_THEMES.partly;
  return { label, icon: finalIcon, theme: isDay ? themePair.day : themePair.night };
}

/**
 * How much "cozy" the weather should add on top of the season's scene.
 *
 * Deliberately a MODIFIER, not a theme choice. The `theme` field returned above
 * would replace the scene outright, which would make a chosen VBS or Easter skin
 * silently vanish on a wet night — so the season keeps the palette and weather
 * only changes the mood over it. Same shape as the projector's existing
 * `AmbientOrbs dim` treatment, which has done exactly this for cool weather all
 * along.
 *
 * `cozy` is the flag a component acts on; `dim` scales opacity. Returns a
 * neutral result for null/unknown weather so a failed fetch changes nothing.
 *
 * @param {{ code?: number, isDay?: boolean }|null|undefined} weather
 * @returns {{ cozy: boolean, dim: number, reason: string }}
 */
export function weatherMood(weather) {
  if (!weather || typeof weather.code !== 'number') {
    return { cozy: false, dim: 1, reason: 'none' };
  }
  const type = getWeatherType(weather.code);
  const isNight = weather.isDay === false;

  if (type === 'thunder') return { cozy: true, dim: 0.72, reason: 'thunder' };
  if (type === 'snow') return { cozy: true, dim: 0.86, reason: 'snow' };
  if (type === 'rain') return { cozy: true, dim: isNight ? 0.76 : 0.84, reason: 'rain' };
  if (type === 'fog') return { cozy: true, dim: 0.82, reason: 'fog' };
  // A clear or merely cloudy night is still darker outside, but not "cozy" —
  // dimming the room for ordinary dusk would make most club nights muted.
  return { cozy: false, dim: 1, reason: type };
}

/**
 * Which ambient particle effect the CURRENT weather calls for — the
 * resolver behind particleEffect: 'auto' (the default): snowfall when
 * it's snowing outside, rainfall when it's raining or storming, and
 * nothing otherwise (fog and clear skies add no particles; sparkles
 * remain a deliberate operator choice for awards nights). Null/unknown
 * weather returns null so a failed fetch simply means no particles.
 *
 * @param {{ code?: number }|null|undefined} weather
 * @returns {'rain'|'snow'|null}
 */
export function autoParticleEffect(weather) {
  if (!weather || typeof weather.code !== 'number') return null;
  const type = getWeatherType(weather.code);
  if (type === 'snow') return 'snow';
  if (type === 'rain' || type === 'thunder') return 'rain';
  return null;
}

export function buildForecastUrl({ lat, lon, units = 'fahrenheit' }) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day',
    temperature_unit: units === 'celsius' ? 'celsius' : 'fahrenheit',
    timezone: 'auto',
  });
  return `https://api.open-meteo.com/v1/forecast?${params}`;
}

/**
 * Current conditions, or null on ANY failure — callers simply omit the
 * weather slide, so a dead API can never put an error on the big screen.
 */
export async function fetchCurrentWeather({ lat, lon, units = 'fahrenheit' }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const res = await fetch(buildForecastUrl({ lat, lon, units }));
    if (!res.ok) return null;
    const data = await res.json();
    const cur = data?.current;
    if (!cur || typeof cur.temperature_2m !== 'number') return null;
    return {
      temp: Math.round(cur.temperature_2m),
      apparent: typeof cur.apparent_temperature === 'number' ? Math.round(cur.apparent_temperature) : null,
      code: typeof cur.weather_code === 'number' ? cur.weather_code : 2,
      isDay: cur.is_day !== 0,
      units: units === 'celsius' ? 'celsius' : 'fahrenheit',
    };
  } catch {
    return null;
  }
}

/**
 * Town name → best coordinate match (for the Settings "Look up"
 * button). Null when nothing matches or the network is down.
 */
export async function geocodeLocation(name) {
  const query = String(name ?? '').trim();
  if (!query) return null;
  try {
    const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    if (!res.ok) return null;
    const hit = (await res.json())?.results?.[0];
    if (!hit || typeof hit.latitude !== 'number') return null;
    return {
      name: [hit.name, hit.admin1].filter(Boolean).join(', '),
      lat: hit.latitude,
      lon: hit.longitude,
    };
  } catch {
    return null;
  }
}
