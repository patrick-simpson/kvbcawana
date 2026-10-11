import { createContext } from 'react';

// What the lobby knows right now, for art that shows it (the snow slide's
// phone: the weather on its lock screen, tonight's check-ins as its battery).
// Provided once in App; anything rendered outside it (the slide editor's
// thumbnails, a test) gets nulls and draws its own fallback.
export const LobbyLiveContext = createContext({
  /** @type {{ temp: number, code: number, isDay: boolean, units: string }|null} */
  weather: null,
  /** @type {number|null} tonight's check-ins */
  checkedIn: null,
});
