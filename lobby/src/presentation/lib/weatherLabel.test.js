import { describe, expect, it } from 'vitest';
import { WEATHER_WORDS, formatTempF, weatherLabel } from './weatherLabel.js';

// The weather chip's words (components/WeatherScene.jsx): what the wall is
// drawing, in American units, and nothing at all when the weather is unknown.

describe('formatTempF', () => {
  it('rounds to whole degrees Fahrenheit', () => {
    expect(formatTempF(54)).toBe('54°F');
    expect(formatTempF(54.4)).toBe('54°F');
    expect(formatTempF(54.5)).toBe('55°F');
    expect(formatTempF(0)).toBe('0°F');
    expect(formatTempF(104)).toBe('104°F');
  });

  it('writes a true minus sign below zero, and never "−0°F"', () => {
    expect(formatTempF(-3)).toBe('−3°F');
    expect(formatTempF(-12.6)).toBe('−13°F');
    expect(formatTempF(-0.4)).toBe('0°F');
  });

  it('is null for anything that is not a finite number', () => {
    for (const v of [undefined, null, '54', NaN, Infinity, {}]) expect(formatTempF(v)).toBeNull();
  });
});

describe('weatherLabel', () => {
  it('names each of the six weathers the scene draws, with the temperature', () => {
    expect(weatherLabel({ type: 'clear', temp: 61 })).toBe('Clear · 61°F');
    expect(weatherLabel({ type: 'cloudy', temp: 54 })).toBe('Cloudy · 54°F');
    expect(weatherLabel({ type: 'fog', temp: 48 })).toBe('Foggy · 48°F');
    expect(weatherLabel({ type: 'rain', temp: 50.2 })).toBe('Rain · 50°F');
    expect(weatherLabel({ type: 'snow', temp: 28 })).toBe('Snow · 28°F');
    expect(weatherLabel({ type: 'thunder', temp: 72 })).toBe('Thunder · 72°F');
    expect(Object.keys(WEATHER_WORDS).sort()).toEqual(['clear', 'cloudy', 'fog', 'rain', 'snow', 'thunder']);
  });

  it('says the word alone when the temperature is missing', () => {
    expect(weatherLabel({ type: 'cloudy' })).toBe('Cloudy');
    expect(weatherLabel({ type: 'snow', temp: NaN })).toBe('Snow');
  });

  it('is null (no chip) when the weather is unknown', () => {
    expect(weatherLabel(null)).toBeNull();
    expect(weatherLabel(undefined)).toBeNull();
    expect(weatherLabel({})).toBeNull();
    expect(weatherLabel({ temp: 54 })).toBeNull();
    expect(weatherLabel({ type: 'hail', temp: 54 })).toBeNull();
    expect(weatherLabel({ type: 'toString', temp: 54 })).toBeNull();
  });

  it('stays short enough for the chip beside a phone\'s menu button', () => {
    // The longest it can be: the longest word and a three-figure temperature.
    const longest = Math.max(...Object.keys(WEATHER_WORDS).map((type) => weatherLabel({ type, temp: -104 }).length));
    expect(longest).toBeLessThanOrEqual(16);
  });
});
