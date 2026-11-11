// The game time scoreboard on a screen (owner 2026-11-05; routes.md 10.17):
// the projector's one way to the board. On the presentation isolation
// allowlist (src/presentation/isolation.test.js).
//
// - Signed in (the church passphrase, the screen's own sync session), it reads
//   GET /v1/scoreboard once, then follows the Worker's doorbell
//   `changed {what: 'scoreboard', board}` (useSocket hears it; the board rides
//   the ring, so a point costs no request). A safety-net read every minute on
//   the club evening only (the free plan's daily requests), and on becoming
//   visible again.
// - Every answer is cleaned with shared/scoreboard.js (cleanBoard) and kept
//   only when its rev is newer than the one on screen.
// - The stopwatch is drawn on the WORKER's clock: each read is timed and the
//   offset with the shortest round trip wins (createClockSync), so the wall
//   and every phone agree to the tenth. `serverNow()` is that clock.

import { useCallback, useEffect, useRef, useState } from 'react';
import { onSyncDoorbell, syncAuthed, useSync } from './useSync.js';
import { FINALE_FRESH_MS, FINALE_MS, boardIsTonight, cleanBoard, createClockSync } from '../../../shared/scoreboard.js';
import { clubEveningNow } from '../../../shared/clubNight.js';

/** The safety-net read while the screen is up on the club evening. */
export const SCOREBOARD_BACKUP_MS = 60 * 1000;

const wallNow = () => (typeof performance !== 'undefined' && performance.timeOrigin
  ? performance.timeOrigin + performance.now()
  : Date.now());

/**
 * @param {{ enabled: boolean }} opts
 * @returns {{ board: ReturnType<typeof cleanBoard>, finale: null | {id: number, club: string, scores: any}, serverNow: () => number }}
 */
export function useScoreboard({ enabled }) {
  const { signedIn } = useSync();
  const [board, setBoard] = useState(/** @type {ReturnType<typeof cleanBoard>} */ (null));
  const rev = useRef(-1);
  const [sync] = useState(createClockSync);
  // The winner screen to play: a finale the board newly carries, fresh (a
  // screen that loads long after an End never replays it).
  const [finale, setFinale] = useState(/** @type {null | {id: number, club: string, scores: any}} */ (null));
  const finaleSeen = useRef(0);

  const take = useCallback((raw) => {
    const b = cleanBoard(raw);
    if (!b) return;
    // A new night starts its rev again from the old one + 1, so newer is always larger.
    if (b.rev <= rev.current) return;
    rev.current = b.rev;
    setBoard(b);
    const f = b.finale;
    if (f && f.id > finaleSeen.current) {
      finaleSeen.current = f.id;
      if (wallNow() + sync.offset() - f.at <= FINALE_FRESH_MS) setFinale({ id: f.id, club: f.club, teams: f.teams, scores: f.scores });
    }
  }, [sync]);

  const read = useCallback(async () => {
    const sentAt = wallNow();
    const res = await syncAuthed('/v1/scoreboard');
    const gotAt = wallNow();
    if (!res.ok || !res.body) return;
    if (Number.isFinite(res.body.serverNow)) sync.add(sentAt, gotAt, res.body.serverNow);
    take(res.body.board);
  }, [take, sync]);

  const live = enabled && signedIn;

  useEffect(() => {
    if (!live) return undefined;
    const first = window.setTimeout(read, 0);
    const off = onSyncDoorbell((what, payload) => {
      if (what !== 'scoreboard' || !payload) return;
      // Before any timed read, the ring's own stamp is the best guess at the server's clock.
      if (!sync.known() && Number.isFinite(payload.now)) sync.add(wallNow(), wallNow(), payload.now);
      if (payload.board) take(payload.board);
      else read();
    });
    const tick = window.setInterval(() => {
      if (!document.hidden && clubEveningNow(new Date())) read();
    }, SCOREBOARD_BACKUP_MS);
    const onVisible = () => { if (!document.hidden) read(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      off();
      window.clearTimeout(first);
      window.clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [live, read, take, sync]);

  useEffect(() => {
    if (!finale) return undefined;
    const t = window.setTimeout(() => setFinale(null), FINALE_MS);
    return () => window.clearTimeout(t);
  }, [finale]);

  // A board from another night reads as no board (owner's night = the church's
  // Eastern date, the Worker's own rule). The Worker's clock when a timed read
  // gave it, else this device's. A local minute tick lets a screen left up past
  // midnight notice; it makes no request.
  const [, setMinute] = useState(0);
  useEffect(() => {
    if (!live) return undefined;
    const t = window.setInterval(() => setMinute((m) => m + 1), 60 * 1000);
    return () => window.clearInterval(t);
  }, [live]);
  const serverNow = useCallback(() => wallNow() + sync.offset(), [sync]);
  const tonight = board && boardIsTonight(board, serverNow()) ? board : null;
  return { board: live ? tonight : null, finale: live ? finale : null, serverNow };
}
