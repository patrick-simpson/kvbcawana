// @ts-check
// The words on the projector's weather chip (components/WeatherScene.jsx):
// what the ambient scene is drawing, in the label voice, so a flat cloud on
// the wall is never a mystery (owner 2026-10-12: "What's the weird diagonal
// white blur?"). Pure: no imports, no clock.

/** One short word per scene type, the same six the scene draws. */
export const WEATHER_WORDS = Object.freeze({
  clear: 'Clear',
  cloudy: 'Cloudy',
  fog: 'Foggy',
  rain: 'Rain',
  snow: 'Snow',
  thunder: 'Thunder',
});

/**
 * Whole degrees Fahrenheit, a true minus sign below zero: "54°F", "−3°F".
 * Null for anything that is not a finite number.
 * @param {unknown} temp
 */
export function formatTempF(temp) {
  if (typeof temp !== 'number' || !Number.isFinite(temp)) return null;
  const whole = Math.round(temp);
  // Math.round(-0.4) is -0: never print "−0°F".
  return `${whole < 0 ? '−' : ''}${Math.abs(whole)}°F`;
}

/**
 * "Cloudy · 54°F" for a reading, the word alone when the temperature is
 * missing, null when the weather is unknown (no reading, or a type the scene
 * does not draw): then there is no chip at all.
 * @param {{ type?: unknown, temp?: unknown } | null | undefined} reading
 * @returns {string | null}
 */
export function weatherLabel(reading) {
  if (!reading || typeof reading.type !== 'string' || !Object.hasOwn(WEATHER_WORDS, reading.type)) return null;
  const word = WEATHER_WORDS[/** @type {keyof typeof WEATHER_WORDS} */ (reading.type)];
  const temp = formatTempF(reading.temp);
  return temp ? `${word} · ${temp}` : word;
}
