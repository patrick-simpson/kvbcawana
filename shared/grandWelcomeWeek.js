// Which grand welcome a club night gets (owner 2026-11-01: "I want this to
// alternate with the old style each week"). ONE rule for every screen, so the
// gym projector and the screens copying it always agree:
//   'film'     the 3D film (video/grand-welcome/; the projector's
//              views/GrandWelcome.jsx, 20 s) and, on the other screens, the
//              see-through lead-in (lobby components/CeremonyLeadIn.jsx)
//   'classic'  the animated welcome of 2026-10-19 (the projector's
//              views/GrandWelcomeClassic.jsx, 15 s) and the "Switching to
//              opening ceremony" card (lobby components/MirrorSwitching.jsx)
// Weeks run Wednesday to Tuesday (a club week); the film's first night,
// FILM_FIRST_NIGHT, starts a film week, and they alternate from there both
// ways. Local calendar days, so a clock change never shifts a week.
// Since 2026-11-11 the other screens' half has its own switch (LEAD_IN_ON,
// leadInStyle, at the foot of this file): the lead-in film every week,
// whatever the gym shows; the card only if that switch is turned off.
// Pure, no imports: the lobby and the projector import it in place.
//
// Owner 2026-11-08: "always show the 2d, don't show the 3d anymore". FILM_ON is
// false, so every week is 'classic'; the film and its code stay, and setting
// FILM_ON back to true brings the week-by-week alternation back unchanged.

/** Whether the 3D film is shown at all (owner 2026-11-08: no, the 2D welcome every week). */
export const FILM_ON = false;

/** The film's first club night (a Wednesday), as a local date. */
export const FILM_FIRST_NIGHT = Object.freeze({ year: 2026, month: 11, day: 4 });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole local calendar days from FILM_FIRST_NIGHT to `now` (negative before it). */
function daysSinceFirst(now) {
  const a = Date.UTC(FILM_FIRST_NIGHT.year, FILM_FIRST_NIGHT.month - 1, FILM_FIRST_NIGHT.day);
  const b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / DAY_MS);
}

/**
 * The club week `now` falls in, counted from the film's first night's week
 * (0), Wednesday to Tuesday.
 * @param {Date} now
 */
export function clubWeek(now) {
  return Math.floor(daysSinceFirst(now) / 7);
}

/**
 * The week-by-week alternation (owner 2026-11-01), used while FILM_ON.
 * @param {Date} now
 * @returns {'film' | 'classic'}
 */
export function alternatingStyle(now) {
  return clubWeek(now) % 2 === 0 ? 'film' : 'classic';
}

/**
 * This week's grand welcome: 'classic' every week while the film is off.
 * @param {Date} now
 * @returns {'film' | 'classic'}
 */
export function welcomeStyle(now) {
  return FILM_ON ? alternatingStyle(now) : 'classic';
}

/**
 * Whether the other screens (lobby TV, Journey, the classroom) play the
 * see-through "Opening ceremony" lead-in film before they copy the gym
 * (owner 2026-11-11, after seeing it again: "I actually like this one. Can we
 * put that one back in each week"). Its own switch: the lead-in no longer
 * follows the gym's film weeks.
 */
export const LEAD_IN_ON = true;

/**
 * What the other screens show in the five seconds before they turn over:
 * 'film' = the lead-in film (every week while LEAD_IN_ON), 'classic' = the
 * "Switching to opening ceremony" card.
 * @param {Date} now
 * @returns {'film' | 'classic'}
 */
export function leadInStyle(now) {
  return LEAD_IN_ON ? 'film' : welcomeStyle(now);
}
