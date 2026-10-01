import { describe, it, expect } from 'vitest';
import { cornerIds, nextCornerId, snapshotCorner, STILL_HERE_NOTE, TALLY_SYNC_NOTE } from './cornerInfo.js';

const src = (extra = {}) => ({ clock: true, tally: 23, weather: { temp: 58.4, code: 3, isDay: true }, ...extra });

describe('cornerIds', () => {
  it('lists what has something to say, in rotation order', () => {
    expect(cornerIds(src())).toEqual(['clock', 'tally', 'weather']);
  });

  it('the tally waits for the first check-in, the weather for a reading', () => {
    expect(cornerIds(src({ tally: 0 }))).toEqual(['clock', 'weather']);
    expect(cornerIds(src({ weather: null }))).toEqual(['clock', 'tally']);
    expect(cornerIds(src({ weather: { temp: NaN, code: 1 } }))).toEqual(['clock', 'tally']);
    expect(cornerIds({ clock: false, tally: 0, weather: null })).toEqual([]);
  });
});

describe('nextCornerId', () => {
  it('moves on one item per slide load and wraps', () => {
    const ids = ['clock', 'tally', 'weather'];
    expect(nextCornerId(ids, null)).toBe('clock');
    expect(nextCornerId(ids, 'clock')).toBe('tally');
    expect(nextCornerId(ids, 'weather')).toBe('clock');
  });

  it('starts over when the item on show has gone, and says nothing when nothing exists', () => {
    expect(nextCornerId(['clock', 'weather'], 'tally')).toBe('clock');
    expect(nextCornerId([], 'clock')).toBeNull();
  });
});

describe('snapshotCorner', () => {
  const at = new Date(2026, 8, 30, 19, 56, 12).getTime();

  it('freezes the time at the slide load, bottom corner', () => {
    expect(snapshotCorner('clock', src(), at)).toEqual({
      id: 'clock', label: 'Right now', value: '7:56', spoken: 'The time is 7:56 PM', corner: 'bottom',
    });
  });

  it('freezes the tally, bottom corner', () => {
    expect(snapshotCorner('tally', src(), at)).toMatchObject({
      label: 'Tonight', value: '23', corner: 'bottom', note: null, correction: null,
    });
  });

  it('carries a correction into the tally it explains (#351), and only the tally', () => {
    const correction = { from: 80, to: 78 };
    const t = snapshotCorner('tally', src({ tally: 78, correction }), at);
    expect(t).toMatchObject({ value: '78', note: TALLY_SYNC_NOTE, correction });
    expect(t.correction).toBe(correction);
    expect(t.spoken).toBe(`78 checked in tonight, ${TALLY_SYNC_NOTE}`);
    expect(snapshotCorner('clock', src({ correction }), at).note).toBeUndefined();
    expect(snapshotCorner('weather', src({ correction }), at).note).toBeUndefined();
  });

  it('names the weather and rounds the temperature, top corner', () => {
    const w = snapshotCorner('weather', src(), at);
    expect(w.value).toBe('58°');
    expect(w.corner).toBe('top');
    expect(typeof w.label).toBe('string');
    expect(w.label.length).toBeGreaterThan(0);
  });

  it('freezes the weather\'s sky doodle with its words', () => {
    expect(snapshotCorner('weather', src(), at).glyph).toBe('cloud');
    expect(snapshotCorner('weather', src({ weather: { temp: 40, code: 0, isDay: false } }), at).glyph).toBe('moon');
    expect(snapshotCorner('clock', src(), at).glyph).toBeUndefined();
  });

  it('has nothing to show for weather with no reading', () => {
    expect(snapshotCorner('weather', src({ weather: null }), at)).toBeNull();
  });
});

describe('the pickup count down (stillHere)', () => {
  const src = (stillHere, tally = 80) => ({ clock: true, tally, weather: null, stillHere });

  it('takes the tally slot while there is a count, even before any check-in tonight', () => {
    expect(cornerIds(src(12))).toEqual(['clock', 'tally']);
    expect(cornerIds(src(12, 0))).toEqual(['clock', 'tally']);
    expect(cornerIds(src(null, 0))).toEqual(['clock']);
  });

  it('reads PICKUP over the number, with what it means underneath — never a headcount', () => {
    const s = snapshotCorner('tally', src(12), Date.now());
    expect(s).toMatchObject({ label: 'Pickup', value: '12', note: STILL_HERE_NOTE, corner: 'bottom', correction: null });
    expect(s.spoken).toBe('12 not checked out yet');
    expect(`${s.label} ${s.note} ${s.spoken}`).not.toMatch(/building|still here/i);
  });

  it('goes back to tonight’s count when there is none', () => {
    expect(snapshotCorner('tally', src(null), Date.now())).toMatchObject({ label: 'Tonight', value: '80' });
  });
});
