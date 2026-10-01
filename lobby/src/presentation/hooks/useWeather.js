import { useEffect, useState } from 'react';
import { CHURCH } from '../church.config.js';
import { fetchCurrentWeather, getWeatherType } from '../../lib/weather.js';

// One Open-Meteo fetcher for the whole repo: this hook rides the
// signage app's lib/weather.js (on the presentation import allowlist)
// instead of maintaining a second URL builder + code mapping.
const REFRESH_MS = 15 * 60 * 1000;

/**
 * Live weather type for the ambient scene ('clear' | 'cloudy' | 'fog' |
 * 'rain' | 'snow' | 'thunder'). Fails silently to 'clear' — the show
 * must never depend on the network. Refetches on a 15-minute interval
 * and whenever the page becomes visible again (projector machines
 * sleep).
 */
export function useWeather() {
  const [weather, setWeather] = useState('clear');

  useEffect(() => {
    let cancelled = false;

    const update = async () => {
      const cur = await fetchCurrentWeather({ lat: CHURCH.coords.lat, lon: CHURCH.coords.lon });
      if (!cancelled && cur) setWeather(getWeatherType(cur.code));
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

  return weather;
}
