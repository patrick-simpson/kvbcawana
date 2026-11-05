// @ts-check
// The game time scoreboard (owner 2026-11-05; src/routes.md 10.17). A leader's
// phone (awana.kvbchurch.org/lobby/scoreboard.html) picks T&T, Sparks or
// Cubbies, scores four colour teams, ends the game, and runs a stopwatch or a
// countdown timer; the game time projector shows it all big.
//
// Rules (one copy, shared with the screens): ../../shared/scoreboard.js.
//
// Storage:
//   score:board   the board (shared/scoreboard.js header): numbers only, never a name
//
// Every press is ONE synchronous step on the cached copy, then written through
// (no await between the read and the change), so two phones tapping at once
// both count. A new night (the church's local date) starts every club at 0-0-0-0
// with no club up and no clock (owner: "Each club, each night").
//
// A change rings the live channel's doorbell `changed {what: 'scoreboard', rev,
// board, now}` CARRYING the cleaned board (numbers only), so the projector and
// the phones draw it without a second request (the free plan's daily requests;
// "Scores should update real time"). Every answer carries `serverNow`, the
// Worker's clock, which the screens time their stopwatch against.

import { fail, json } from './http.js';
import {
  SCORE_CLUBS,
  SCORE_MAX,
  SCORE_SETUPS,
  SCORE_SETUP_IDS,
  TIMER_MAX_MS,
  anyPoints,
  teamsFor,
  cleanBoard,
  clockReading,
  emptyBoard,
  nightOf,
} from '../../shared/scoreboard.js';

export const SCORE_KEY = 'score:board';

/** @typedef {ReturnType<typeof emptyBoard>} Board */

export class Scoreboard {
  /** @param {{ storage: any, now: () => number, ring?: (payload: Record<string, unknown>) => void }} deps */
  constructor({ storage, now, ring }) {
    this.storage = storage;
    this.now = now;
    this.ring = (/** @type {Record<string, unknown>} */ p) => { try { ring?.(p); } catch { /* the screens' own read catches up */ } };
    /** @type {Board|null} */
    this.cache = null;
  }

  /** Tonight's board (a stored one from another night starts over). */
  async doc() {
    if (!this.cache) this.cache = /** @type {Board|null} */ (cleanBoard(await this.storage.get(SCORE_KEY)));
    const tonight = nightOf(this.now());
    if (!this.cache || this.cache.night !== tonight) {
      const rev = this.cache ? this.cache.rev + 1 : 0;
      this.cache = emptyBoard(tonight);
      this.cache.rev = rev;
    }
    return this.cache;
  }

  /** @param {Board} d */
  answer(d) {
    return json({ ok: true, board: d, serverNow: this.now() });
  }

  /** Stamp, store, ring. @param {Board} d */
  async commit(d) {
    d.rev += 1;
    d.at = this.now();
    await this.storage.put(SCORE_KEY, d);
    this.ring({ what: 'scoreboard', rev: d.rev, board: d, now: d.at });
    return this.answer(d);
  }

  /** The finale for a club's game (only when someone scored). @param {Board} d @param {string|null} club */
  finale(d, club) {
    const teams = teamsFor(d, club);
    if (club && anyPoints(d.scores[club], teams)) {
      d.finale = { id: d.rev + 1, club, teams: teams.slice(), scores: { ...d.scores[club] }, at: this.now() };
    }
  }

  /** The finale for the club leaving the wall. @param {Board} d */
  closeActive(d) {
    this.finale(d, d.active);
    d.active = null;
  }

  /** GET /v1/scoreboard */
  async state() {
    return this.answer(await this.doc());
  }

  /** POST /v1/scoreboard/club {club}: put a club's scores on the wall (switching = the old club's winner first). @param {any} body */
  async club(body) {
    const club = body?.club;
    if (!SCORE_CLUBS.includes(club)) return fail('That is not a club that keeps score.', 400, { reason: 'bad-club' });
    const d = await this.doc();
    if (d.active === club) return this.answer(d);
    this.closeActive(d);
    d.active = club;
    return this.commit(d);
  }

  /** POST /v1/scoreboard/point {club, team, delta}: one tap on the club that is up. @param {any} body */
  async point(body) {
    const { club, team } = body || {};
    const delta = Number(body?.delta);
    if (!SCORE_CLUBS.includes(club) || typeof team !== 'string' || (delta !== 1 && delta !== -1)) {
      return fail('That is not a team or a point.', 400, { reason: 'bad-point' });
    }
    const d = await this.doc();
    // Only a team of the club's setup scores (a phone on an old setup is told so).
    if (!teamsFor(d, club).includes(team)) return fail('That team is not playing now.', 409, { reason: 'not-playing', board: d, serverNow: this.now() });
    // A phone still showing a club another phone has since changed is told so, never scores the wrong game.
    if (d.active !== club) return fail('Another club is on the projector now.', 409, { reason: 'not-active', board: d, serverNow: this.now() });
    const next = Math.min(SCORE_MAX, Math.max(0, d.scores[club][team] + delta));
    if (next === d.scores[club][team]) return this.answer(d);
    d.scores[club][team] = next;
    return this.commit(d);
  }

  /**
   * POST /v1/scoreboard/setup {club, setup, keep}: how the club's teams are split
   * (owner 2026-11-05: the phone's Options; the phone asks each time). `keep`
   * false = a new game: the old setup's winner first (when it is up and anyone
   * scored), then the new teams at 0. `keep` true = the new teams keep tonight's
   * scores (red stays red).
   * @param {any} body
   */
  async setup(body) {
    const { club, setup } = body || {};
    if (!SCORE_CLUBS.includes(club) || !SCORE_SETUP_IDS.includes(setup)) return fail('That is not a team setup.', 400, { reason: 'bad-setup' });
    const d = await this.doc();
    if (d.setups[club] === setup) return this.answer(d);
    if (body?.keep !== true) {
      if (d.active === club) this.finale(d, club);
      for (const t of SCORE_SETUPS[setup].teams) d.scores[club][t] = 0;
    }
    d.setups[club] = setup;
    return this.commit(d);
  }

  /** POST /v1/scoreboard/end: the winner screen, then the projector follows its schedule again. */
  async end() {
    const d = await this.doc();
    if (!d.active) return this.answer(d);
    this.closeActive(d);
    return this.commit(d);
  }

  /**
   * POST /v1/scoreboard/clock {op, kind?, durationMs?}
   *   start  {kind: 'stopwatch'} or {kind: 'timer', durationMs}: a new run from 0 (or the full time)
   *   pause / resume: the run stops / goes on where it was
   *   clear: the clock leaves the wall
   * Anchored to THIS clock (`startedAt` = the Worker's time of the press).
   * @param {any} body
   */
  async clock(body) {
    const op = body?.op;
    const d = await this.doc();
    const now = this.now();
    if (op === 'start') {
      const kind = body?.kind;
      const durationMs = Number(body?.durationMs);
      if (kind !== 'stopwatch' && kind !== 'timer') return fail('Pick the stopwatch or the timer.', 400, { reason: 'bad-clock' });
      if (kind === 'timer' && !(Number.isInteger(durationMs) && durationMs >= 1000 && durationMs <= TIMER_MAX_MS)) {
        return fail('A timer runs from 1 second to 60 minutes.', 400, { reason: 'bad-clock' });
      }
      d.clock = { id: (d.clock?.id || 0) + 1, kind, startedAt: now, elapsedMs: 0, durationMs: kind === 'timer' ? durationMs : null };
      return this.commit(d);
    }
    if (op === 'pause' || op === 'resume') {
      const c = d.clock;
      if (!c) return fail('No stopwatch or timer is running.', 409, { reason: 'no-clock', board: d, serverNow: now });
      const reading = clockReading(c, now);
      if (op === 'pause') {
        if (c.startedAt === null) return this.answer(d);
        c.elapsedMs = c.elapsedMs + Math.max(0, now - c.startedAt);
        if (c.kind === 'timer' && c.durationMs !== null) c.elapsedMs = Math.min(c.elapsedMs, c.durationMs);
        c.startedAt = null;
      } else {
        if (c.startedAt !== null || reading?.done) return this.answer(d);
        c.startedAt = now;
      }
      return this.commit(d);
    }
    if (op === 'clear') {
      if (!d.clock) return this.answer(d);
      d.clock = null;
      return this.commit(d);
    }
    return fail('That is not a clock button.', 400, { reason: 'bad-clock' });
  }
}

/**
 * The routes (src/routes.md 10.17), a session each (the church passphrase).
 * @param {import('./registry.js').Registry} registry
 * @param {any} core
 */
export function mountScoreboard(registry, core) {
  const s = () => /** @type {Scoreboard} */ (core.scoreboard);
  registry.add('GET', '/v1/scoreboard', 'session', async () => s().state());
  registry.add('POST', '/v1/scoreboard/club', 'session', async ({ body }) => s().club(await body()));
  registry.add('POST', '/v1/scoreboard/point', 'session', async ({ body }) => s().point(await body()));
  registry.add('POST', '/v1/scoreboard/end', 'session', async () => s().end());
  registry.add('POST', '/v1/scoreboard/setup', 'session', async ({ body }) => s().setup(await body()));
  registry.add('POST', '/v1/scoreboard/clock', 'session', async ({ body }) => s().clock(await body()));
}
