import { useEffect, useState } from 'react';
import { CHURCH } from '../church.config.js';
import { fetchCurrentWeather, getWeatherType } from '../../lib/weather.js';

// One Open-Meteo fetcher for the whole repo: this hook rides the
// signage app's lib/weather.js (on the presentation import allowlist)
// instead of maintaining a second URL builder + code mapping.
const REFRESH_MS = 15 * 60 * 1000;

/**
 * How long a reading may stand with no fresh one behind it. Past this (eight
 * missed refreshes: the projector PC lost its network) the wall drops back to
 * the plain starfield and the weather chip goes away, rather than naming last
 * night's temperature as tonight's.
 */
export const WEATHER_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * @typedef {{ type: 'clear'|'cloudy'|'fog'|'rain'|'snow'|'thunder', temp: number, isDay: boolean, at: number }} WeatherReading
 */

/**
 * The live reading behind the ambient weather scene and its label chip:
 * the coarse scene type, the temperature in °F (Open-Meteo's
 * `temperature_unit=fahrenheit`, the shared fetcher's default), day or
 * night, and when it was read (real time, never the `?now=` clock). Null
 * until the first good answer and again once the last one is older than
 * WEATHER_STALE_MS: the show never depends on the network. Refetches every
 * 15 minutes and whenever the page becomes visible again (projector
 * machines sleep).
 *
 * @returns {WeatherReading | null}
 */
export function useWeatherReading() {
  const [reading, setReading] = useState(/** @type {WeatherReading | null} */ (null));

  useEffect(() => {
    let cancelled = false;
    let lastAt = 0;

    const update = async () => {
      const cur = await fetchCurrentWeather({ lat: CHURCH.coords.lat, lon: CHURCH.coords.lon });
      if (cancelled) return;
      if (cur) {
        lastAt = Date.now();
        setReading({ type: /** @type {WeatherReading['type']} */ (getWeatherType(cur.code)), temp: cur.temp, isDay: cur.isDay, at: lastAt });
      } else if (lastAt && Date.now() - lastAt > WEATHER_STALE_MS) {
        lastAt = 0;
        setReading(null);
      }
    };

    update();
    const interval = setInterval(update, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return reading;
}

/**
 * Live weather type alone ('clear' | 'cloudy' | 'fog' | 'rain' | 'snow' |
 * 'thunder'), 'clear' while there is no reading.
 */
export function useWeather() {
  return useWeatherReading()?.type ?? 'clear';
}
