// Helpers shared by the whole-App tests (App.*.test.jsx). Helpers only: each
// test file keeps its own vi.mock calls, because vi.mock is hoisted above the
// imports of the file it sits in, and its own fake clock, fetch stub and
// mount (those name the file's own App and fakeLive binding).

import { _resetForTest } from '../hooks/useConfig.js';
import { dateKey } from '../lib/time.js';
import { preloadOperatorPanels } from '../components/operatorPanels.jsx';

/**
 * Settings, the slide editor and the debug panel are chunks of their own
 * (src/components/operatorPanels.jsx). Awaited once per file (`beforeAll`), a
 * press of the Ctrl+Shift+S shortcut mounts Settings in the same act() as before the split: a
 * landed panel renders without suspending.
 */
export function loadOperatorPanels() {
  return preloadOperatorPanels();
}

/** Local YYYY-MM-DD key for `now`: the day the screen's storage keys on. */
export function todayKey(now = new Date()) {
  return dateKey(now);
}

/**
 * Writes the lobby's config for a whole-App test: manual slides only, no
 * calendar, no promos, no shared schedule, zero animation. `config` overrides
 * any key.
 */
export function setup(config = {}) {
  localStorage.setItem('awanaConfig.v1', JSON.stringify({
    confettiLevel: 'off',
    firstArrivalMoment: false,
    sharedScheduleUrl: '',
    backgroundSource: 'manual',
    calendarEnabled: false,
    seasonPromos: false,
    manualSlides: [{ id: 's_1', type: 'text', eyebrow: 'This week', text: 'Bring your handbook', theme: 'sky' }],
    // Zero animation: what is on screen is the resting state, at once.
    reduceMotion: true,
    ...config,
  }));
  _resetForTest();
}

/** `n` kids across the three clubs, first names only. */
export const kids = (n) => Array.from({ length: n }, (_, i) => ({ firstName: `Kid${i}`, club: ['Sparks', 'T&T', 'Cubbies'][i % 3] }));

/** A `tonight` frame: the printer's running count, stamped now unless `at` says otherwise. */
export const night = (checkedIn, at = Date.now()) => ({ checkedIn, booksCompleted: 0, awardsEarned: 0, friendsBrought: 0, at });
