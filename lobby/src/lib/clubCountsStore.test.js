import { afterEach, describe, expect, it } from 'vitest';
import { CLUB_COUNTS_KEY, clubCountsEntry, saveClubCounts } from './clubCountsStore.js';

describe('the per-club counts left for the Journey kiosk', () => {
  afterEach(() => localStorage.clear());

  it('keys every club by id, whatever spelling the tally used, numbers only', () => {
    expect(clubCountsEntry({ Trek: 12, 'Truth & Training': 4, 'T&T': 3, Sparks: 9 }, 1000)).toEqual({
      v: 1,
      at: 1000,
      byClub: { trek: 12, tnt: 7, sparks: 9 },
    });
  });

  it('leaves out a club the tally has no entry for, and keeps nothing without a real stamp', () => {
    expect(clubCountsEntry({ Sparks: 2 }, 5).byClub).toEqual({ sparks: 2 });
    expect(clubCountsEntry({ Trek: 2 }, undefined)).toBeNull();
    expect(clubCountsEntry(null, 5)).toBeNull();
  });

  it('writes its own slot, holding nothing but the counts and the stamp', () => {
    saveClubCounts({ Trek: 5, 'Not a club': 3 }, 1234);
    const stored = JSON.parse(localStorage.getItem(CLUB_COUNTS_KEY));
    expect(stored).toEqual({ v: 1, at: 1234, byClub: { trek: 5 } });
    expect(Object.keys(stored).sort()).toEqual(['at', 'byClub', 'v']);
  });
});
