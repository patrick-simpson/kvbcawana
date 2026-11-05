// The lobby's score bar (owner 2026-11-05: "something on the lobby screen.
// Like a lower third"; option A, the ticker bar, picked from three mockups):
// what it shows, pure (tested in scoreTicker.test.js). The bar itself is
// src/components/ScoreTicker.jsx; the rules of the game are
// shared/scoreboard.js, one copy with the Worker, the projector and the phone.

import { SCORE_TEAMS, teamsFor, winnerOf } from '../../../shared/scoreboard.js';

/**
 * What the bar shows: the club that is up and its teams' scores (`final`
 * false), or, for the finale's few seconds after an End (or a switch away
 * from a club with points), that game's final scores with its winner(s)
 * marked (`final` true). Null = no bar (no club up, no finale playing).
 * A club up wins over a finale (a switch: the new club's game is what is on).
 *
 * @param {any} board  cleanBoard's answer, or null
 * @param {null | {id: number, club: string, teams?: string[], scores: Record<string, number>}} finale
 * @returns {null | {club: string, teams: readonly string[], scores: Record<string, number>, final: boolean, won: string[]}}
 */
export function scoreTickerView(board, finale) {
  if (board && board.active && board.scores && board.scores[board.active]) {
    const club = board.active;
    return { club, teams: teamsFor(board, club), scores: board.scores[club], final: false, won: [] };
  }
  if (finale && finale.scores) {
    const teams = Array.isArray(finale.teams) && finale.teams.length ? finale.teams : SCORE_TEAMS;
    return { club: finale.club, teams, scores: finale.scores, final: true, won: winnerOf(finale.scores, teams).teams };
  }
  return null;
}

/**
 * Whether this lobby page shows the bar at all: a real lobby TV only. Never
 * an OBS/ProPresenter feed (overlay), the settings page or configure mode
 * (CONFIGURE), or a framed copy (Journey's Check-in Display, the classroom,
 * the home page's twin): their bottom-right corner is a host's, and the
 * game is the gym's and the lobby's.
 * @param {{ overlay: boolean, configure: boolean, embedded: boolean }} q
 */
export function scoreTickerWanted({ overlay, configure, embedded }) {
  return !overlay && !configure && !embedded;
}
