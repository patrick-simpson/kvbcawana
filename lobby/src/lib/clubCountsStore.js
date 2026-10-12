// @ts-check
// The latest tally's per-club counts, left in this origin's localStorage for
// the Journey kiosk (journey/, same origin: awana.kvbchurch.org) whose
// "Trek · Small Group Time" card shows how many Trek kids are here tonight
// (owner 2026-10-12). The kiosk embeds this display in an iframe that already
// holds the one live socket (src/hooks/useSocket.js), so rather than open a
// second socket on a Pi Zero it reads this entry (and its `storage` event).
//
// Privacy: NUMBERS ONLY, exactly what the plaintext `tally` frame carries
// (counts per club, its `at`). No name, no id, nothing else, ever.
//
// Keyed by club id (CORNER_CLUB_IDS: 'trek', 'tnt', ...), matched through
// countForClub, so every spelling the printer sends ("T&T", "Truth &
// Training") lands on one id and the reader needs no alias table. A club the
// tally has no entry for is left out (the reader hides its chip).

import { CORNER_CLUB_IDS, countForClub } from './clubs.js';

export const CLUB_COUNTS_KEY = 'awanaClubCounts.v1';

/**
 * The entry to store for one tally, or null when it carries nothing to keep.
 * @param {Record<string, number> | null | undefined} counts  the tally's per-club counts
 * @param {unknown} at  the tally's own timestamp (epoch ms)
 * @returns {{ v: 1, at: number, byClub: Record<string, number> } | null}
 */
export function clubCountsEntry(counts, at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;
  if (!counts || typeof counts !== 'object') return null;
  /** @type {Record<string, number>} */
  const byClub = {};
  for (const id of CORNER_CLUB_IDS) {
    const n = countForClub(counts, id);
    if (n != null && Number.isInteger(n) && n >= 0) byClub[id] = n;
  }
  return { v: 1, at, byClub };
}

/**
 * Store the latest tally's counts. Best effort: blocked storage only costs
 * the Journey card its chip.
 * @param {Record<string, number> | null | undefined} counts
 * @param {unknown} at
 */
export function saveClubCounts(counts, at) {
  const entry = clubCountsEntry(counts, at);
  if (!entry) return;
  try {
    localStorage.setItem(CLUB_COUNTS_KEY, JSON.stringify(entry));
  } catch {
    /* storage blocked: the kiosk hides its chip */
  }
}
