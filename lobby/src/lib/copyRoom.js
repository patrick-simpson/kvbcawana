import { createContext } from 'react';
import { OVERLAY } from './overlayFit.js';

// How far down the 16:9 box (u) the slide copy may reach right now: the line
// the pickup board's strip starts at (overlayFit.js footTop). Provided once in
// App (the strip is 4.4u taller while a long list is up, OVERLAY.footTall, so
// the copy's safe bottom steps up with it); anything outside it (the slide
// editor's thumbnails, Settings' preview, a test) gets the ordinary 45u.
export const CopyRoomContext = createContext({ bottom: OVERLAY.foot.top });
