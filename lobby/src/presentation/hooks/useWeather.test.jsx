import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWeather } from './useWeather.js';

afterEach(() => vi.unstubAllGlobals());

/** Mount the hook against a stubbed Open-Meteo response, return the type. */
async function weatherFor(payload) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
  const { result, unmount } = renderHook(() => useWeather());
  await act(async () => {});
  const type = result.current;
  unmount();
  return type;
}

// The hook rides the shared fetchCurrentWeather (lib/weather.js), which
// requires a numeric temperature_2m before it trusts the payload.
const forCode = (code) => weatherFor({ current: { weather_code: code, temperature_2m: 50 } });

describe('useWeather WMO code → ambient scene type', () => {
  it('maps each documented code group', async () => {
    const cases = [
      [0, 'clear'], [1, 'clear'],
      [2, 'cloudy'], [3, 'cloudy'],
      [45, 'fog'], [48, 'fog'],
      [51, 'rain'], [61, 'rain'], [67, 'rain'], [80, 'rain'], [82, 'rain'],
      [71, 'snow'], [77, 'snow'], [85, 'snow'], [86, 'snow'],
      [95, 'thunder'], [96, 'thunder'], [99, 'thunder'],
    ];
    for (const [code, type] of cases) {
      expect(await forCode(code), `code ${code}`).toBe(type);
    }
  });

  it('treats weather_code 0 as clear (falsy-code guard)', async () => {
    // A `!data.current.weather_code` check would wrongly skip code 0.
    expect(await forCode(0)).toBe('clear');
  });

  it('falls back to clear for codes outside every group', async () => {
    expect(await forCode(78)).toBe('clear');
    expect(await forCode(90)).toBe('clear');
  });
});

describe('useWeather network resilience', () => {
  it('defaults a reading without a weather_code to the shared fetcher fallback (cloudy)', async () => {
    expect(await weatherFor({ current: { temperature_2m: 50 } })).toBe('cloudy');
  });

  it('stays clear when the payload is not a valid reading', async () => {
    expect(await weatherFor({ current: {} })).toBe('clear');
    expect(await weatherFor({})).toBe('clear');
  });

  it('stays clear when the fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const { result, unmount } = renderHook(() => useWeather());
    await act(async () => {});
    expect(result.current).toBe('clear');
    unmount();
  });
});
