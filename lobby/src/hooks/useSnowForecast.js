import { useEffect, useRef, useState } from 'react';
import { fetchSnowForecast } from '../lib/weather.js';

// A snowfall forecast moves slowly; every three hours keeps the snow-alerts
// slide's "snow is coming" mode current through a club day without leaning
// on the free API.
const REFRESH_MS = 3 * 60 * 60 * 1000;

/**
 * The daily snowfall forecast for the snow-alerts slide (src/lib/snowAlerts.js
 * decides what it means). Fetches nothing while `enabled` is false, which App
 * keeps false outside the snow season, so a September screen never asks.
 * Keeps the last good forecast through an outage: a few hours old still
 * names the right night.
 */
export function useSnowForecast({ weatherLat, weatherLon }, enabled) {
  const [forecast, setForecast] = useState(null);
  const lastGood = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const update = async () => {
      const next = await fetchSnowForecast({ lat: weatherLat, lon: weatherLon });
      if (cancelled) return;
      if (next) {
        lastGood.current = next;
        setForecast(next);
      } else if (lastGood.current) {
        setForecast(lastGood.current);
      }
    };
    update();
    const timer = setInterval(update, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled, weatherLat, weatherLon]);

  return enabled ? forecast : null;
}
