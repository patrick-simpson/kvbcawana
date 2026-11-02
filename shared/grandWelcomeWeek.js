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
// Pure, no imports: the lobby and the projector import it in place.

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
 * This week's grand welcome.
 * @param {Date} now
 * @returns {'film' | 'classic'}
 */
export function welcomeStyle(now) {
  return clubWeek(now) % 2 === 0 ? 'film' : 'classic';
}
