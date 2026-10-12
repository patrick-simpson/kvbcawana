import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/weather.js', () => ({ fetchCurrentWeather: vi.fn() }));
import { fetchCurrentWeather } from '../lib/weather.js';
import { useWeather, STALE_MS } from './useWeather.js';

const cfg = { weatherLat: 1, weatherLon: 2, weatherUnits: 'f' };
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('useWeather', () => {
  beforeEach(() => { vi.useFakeTimers(); fetchCurrentWeather.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('keeps the last reading through a short outage, then drops it', async () => {
    fetchCurrentWeather.mockResolvedValueOnce({ temp: 60 });
    const { result } = renderHook(() => useWeather(cfg, true));
    await tick(0);
    expect(result.current).toEqual({ temp: 60 });
    fetchCurrentWeather.mockResolvedValue(null);
    await tick(30 * 60 * 1000);
    expect(result.current).toEqual({ temp: 60 });
    await tick(STALE_MS);
    expect(result.current).toBeNull();
  });
});
