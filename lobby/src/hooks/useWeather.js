import { useEffect, useRef, useState } from 'react';
import { fetchCurrentWeather } from '../lib/weather.js';

// Open-Meteo refreshes current conditions about every 15 minutes, so
// polling any faster buys nothing.
const REFRESH_MS = 15 * 60 * 1000;

/**
 * Current conditions for the corner weather chip. Keeps the last good
 * reading through outages (a slightly old temperature beats a missing
 * chip), and fetches nothing at all while `enabled` is false so
 * installs with the chip off never touch the weather API.
 */
export function useWeather({ weatherLat, weatherLon, weatherUnits }, enabled) {
  const [weather, setWeather] = useState(null);
  const lastGood = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    const update = async () => {
      const next = await fetchCurrentWeather({ lat: weatherLat, lon: weatherLon, units: weatherUnits });
      if (cancelled) return;
      if (next) {
        lastGood.current = next;
        setWeather(next);
      } else if (lastGood.current) {
        setWeather(lastGood.current);
      }
    };

    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, weatherLat, weatherLon, weatherUnits]);

  return weather;
}
