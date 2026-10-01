// Panic mode — "something on screen looks wrong and the room is full."
// One toggle (Ctrl+Shift+X or Settings → Screen & corner) strips the display to
// its reliable core: placeholder background, no calendar or weather
// widgets, clock only — while the banner pipeline keeps running
// untouched, because kids still deserve their moment. Pure function so
// it's trivially testable and can never half-apply.

export function applyPanicMode(config) {
  if (!config?.panicMode) return config;
  return {
    ...config,
    // CatalogScene placeholder: no iframe, no local slideshow, no decks.
    backgroundSource: 'powerpoint',
    powerpointEmbedUrl: '',
    useLocalSlideshow: false,
    calendarEnabled: false,
    showWeatherChip: false,
    showClock: true,
    showTally: false,
    countdownTargetTime: '',
  };
}
