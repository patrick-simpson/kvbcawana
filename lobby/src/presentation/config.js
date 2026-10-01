/**
 * Club, schedule, and slide configuration.
 * All times are local wall-clock; the meeting runs Wednesday evenings.
 *
 * The clubs and schedule windows are DERIVED from the shared data files
 * this repo hosts for the whole Awana app family (shared/schedule.json,
 * shared/theme.json — validated in src/presentation/lib/shared-config.js).
 * Slide decks and pledge text remain here as defaults.
 */
import { SCHEDULE_CONFIG, SLIDES_CONFIG, THEME } from './lib/shared-config.js';
import { KIT_CLUBS } from './lib/kit.js';

/* ── Clubs (colors follow the 2026–27 Awana catalog via theme.json) ── */

const CLUB_IDS = ['puggles', 'cubbies', 'sparks', 'tnt', 'trek', 'journey'];

// theme.json is what the screens render; its optional catalog shades win,
// and the kit's own values stand in where a church's theme leaves them out.
export const CLUBS = Object.fromEntries(
  CLUB_IDS.map((id) => {
    const t = THEME.clubs[id];
    const kit = KIT_CLUBS[id];
    return [id, { id, name: t.name, color: t.color, deep: t.deep ?? kit.deep, tint: t.tint ?? kit.tint }];
  }),
);

/* ── Slides ───────────────────────────────────────────────────────── */

export const US_PLEDGE_TEXT = `I pledge allegiance to the Flag of the United States of America, and to the Republic for which it stands, one Nation under God, indivisible, with liberty and justice for all.`;
export const AWANA_PLEDGE_TEXT = `I pledge allegiance to the Awana flag, which stands for the Awana clubs, whose goal is to reach boys and girls with the gospel of Christ, and train them to serve Him.`;

// shared/slides.json can reword the goodnight slide without touching
// code (validated in shared-config.js — a malformed file fails the
// build, never the projector).

export const DECKS = {
  opening: [
    {
      id: 'welcome',
      layout: 'celebration',
      title: 'WELCOME TO AWANA',
      duration: 10,
    },
    {
      id: 'us-pledge',
      layout: 'pledge',
      title: 'Pledge of Allegiance',
      body: US_PLEDGE_TEXT,
      accentColor: CLUBS.sparks.color,
      showClock: true,
    },
    {
      id: 'awana-pledge',
      layout: 'pledge',
      title: 'Awana Pledge',
      body: AWANA_PLEDGE_TEXT,
      accentColor: CLUBS.cubbies.color,
      showClock: true,
    },
    // The ceremony ends on a deliberate blackout, not a slide — it just
    // holds (no `duration`, and the opening deck never loops) until the
    // schedule flips to T&T game time at 18:05.
    { id: 'black-slide', layout: 'black', title: '' },
  ],
  closing: [
    {
      id: 'goodnight',
      layout: 'closing',
      title: SLIDES_CONFIG.closing?.title ?? 'Have a great night!',
      body: SLIDES_CONFIG.closing?.body ?? 'See you next week!',
    },
  ],
};

/* ── Wednesday schedule (from shared/schedule.json) ───────────────── */

export const MEETING_DAY = SCHEDULE_CONFIG.meetingDay;
export const MEETING_START = SCHEDULE_CONFIG.meetingStart;

/**
 * The full meeting evening, gap-free from 18:00 to midnight.
 * The 18:00–18:05 opening window is what lets a real countdown
 * completion hold the welcome/pledge ceremony instead of being
 * yanked back to a 7-day countdown.
 */
export const WEDNESDAY_SCHEDULE = SCHEDULE_CONFIG.windows;
