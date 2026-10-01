import { describe, it, expect } from 'vitest';
import {
  CONTEST_DATE,
  PROMO_DURATION_SEC,
  SEASON_PROMOS,
  buildPromoSlot,
  countdownLabel,
  isPromoSlide,
  nightsUntil,
} from './promos.js';

// The real fall-2026 Wednesdays, same shape the calendar feed delivers.
const club = (date, title = 'Awana meeting', extra = {}) => ({
  date, kind: 'club', title, isCancelled: false, isSpecial: title !== 'Awana meeting', ...extra,
});
const note = (date, title) => ({ date, kind: 'note', title, isCancelled: false, isSpecial: false });

const season = [
  club('2026-09-09', 'Poster Contest kicks off'),
  club('2026-09-16'),
  club('2026-09-23'),
  club('2026-09-30'),
  club('2026-10-07'),
  club('2026-10-14', 'Bring a Friend Night - Posters due'),
  club('2026-10-21'),
  club('2026-10-28'),
  club('2026-11-04', "Parent's Night - Poster Voting"),
  club('2026-11-11'),
];

describe('isPromoSlide', () => {
  it('recognises only the promo slot', () => {
    expect(isPromoSlide({ type: 'promo' })).toBe(true);
    expect(isPromoSlide({ type: 'video' })).toBe(false);
    expect(isPromoSlide({ id: 's_1', text: 'hi' })).toBe(false);
    expect(isPromoSlide(null)).toBe(false);
    expect(isPromoSlide(undefined)).toBe(false);
  });
});

describe('nightsUntil', () => {
  it('counts the nights after today up to and including the event', () => {
    // Sep 23 → Sep 30, Oct 7, Oct 14 itself.
    expect(nightsUntil(season, '2026-09-23', '2026-10-14')).toBe(3);
  });

  it('returns 1 on the last club night before the event', () => {
    expect(nightsUntil(season, '2026-10-07', '2026-10-14')).toBe(1);
  });

  it('returns 0 on the event date itself', () => {
    expect(nightsUntil(season, '2026-10-14', '2026-10-14')).toBe(0);
  });

  it('skips a week the calendar itself cancelled', () => {
    const withBreak = season.map((e) => (e.date === '2026-09-30' ? { ...e, isCancelled: true } : e));
    expect(nightsUntil(withBreak, '2026-09-23', '2026-10-14')).toBe(2);
  });

  it('skips a week the shared schedule marks noClub', () => {
    const specialDates = { '2026-10-07': { noClub: true, label: 'Fall Break' } };
    expect(nightsUntil(season, '2026-09-23', '2026-10-14', specialDates)).toBe(2);
    // An entry that is not a cancellation changes nothing.
    expect(nightsUntil(season, '2026-09-23', '2026-10-14', { '2026-10-07': { label: 'Chili Night' } })).toBe(3);
  });

  it('ignores day-notes that are not club nights', () => {
    expect(nightsUntil([...season, note('2026-10-10', 'Build Day')], '2026-09-23', '2026-10-14')).toBe(3);
  });

  it('has no answer at all without a feed', () => {
    expect(nightsUntil([], '2026-09-23', '2026-10-14')).toBeNull();
    expect(nightsUntil(null, '2026-09-23', '2026-10-14')).toBeNull();
    expect(nightsUntil(undefined, '2026-09-23', '2026-10-14')).toBeNull();
  });
});

describe('countdownLabel', () => {
  it('says Tonight! on the event date, whatever the count', () => {
    expect(countdownLabel(0, '2026-10-14', '2026-10-14')).toBe('Tonight!');
    expect(countdownLabel(null, '2026-10-14', '2026-10-14')).toBe('Tonight!');
  });

  it('falls back to the long date when there is no feed', () => {
    expect(countdownLabel(null, '2026-09-23', '2026-10-14')).toBe('Wednesday, October 14');
    expect(countdownLabel(null, '2026-09-23', '2026-11-04')).toBe('Wednesday, November 4');
  });

  it('names the last night rather than counting to one', () => {
    expect(countdownLabel(1, '2026-10-07', '2026-10-14')).toBe('Next club night');
  });

  it('counts plural nights', () => {
    expect(countdownLabel(3, '2026-09-23', '2026-10-14')).toBe('3 club nights left');
    expect(countdownLabel(9, '2026-09-02', '2026-11-04')).toBe('9 club nights left');
  });

  it('says nothing once the event is behind us', () => {
    expect(countdownLabel(0, '2026-10-21', '2026-10-14')).toBeNull();
  });
});

describe('the promo holds', () => {
  // Every poster is a 15 second showreel whose beat sheet is written against
  // this clock (src/components/promos/kit.jsx). Changing it means re-timing
  // all four, so pin the number here.
  it('holds a promo for 15 seconds', () => {
    expect(PROMO_DURATION_SEC).toBe(15);
  });

  // A promo still carries its OWN hold, which is what the slideshow reads.
  it('gives every descriptor in the table its own duration', () => {
    expect(SEASON_PROMOS.map((p) => p.durationSec)).toEqual([15, 15, 15, 15]);
  });
});

describe('buildPromoSlot', () => {
  const slot = (todayStr, opts) => buildPromoSlot(season, todayStr, opts);
  const kinds = (s) => (s ? s.promos.map((p) => p.kind) : null);

  it('returns one slot carrying every live promo, in table order', () => {
    const s = slot('2026-09-23');
    expect(s.id).toBe('season_promo');
    expect(s.type).toBe('promo');
    expect(s.durationSec).toBe(PROMO_DURATION_SEC);
    expect(kinds(s)).toEqual(['contest', 'friend', 'parents', 'barfEpic']);
    // Stable across calls — the slideshow picks by index each lap.
    expect(kinds(slot('2026-09-24'))).toEqual(['contest', 'friend', 'parents', 'barfEpic']);
  });

  it('honours each promo\'s showFrom', () => {
    // All three open together on Sep 1; the day before, nothing shows.
    expect(slot('2026-08-31')).toBeNull();
    expect(kinds(slot('2026-09-01'))).toEqual(['contest', 'friend', 'parents', 'barfEpic']);
    expect(kinds(slot('2026-09-13'))).toEqual(['contest', 'friend', 'parents', 'barfEpic']);
  });

  it('shows the October three ON October 14 and retires them on the 15th', () => {
    expect(kinds(slot('2026-10-14'))).toEqual(['contest', 'friend', 'parents', 'barfEpic']);
    expect(kinds(slot('2026-10-15'))).toEqual(['parents']);
  });

  it('shows Parents\' Night ON November 4 and nothing at all on the 5th', () => {
    expect(kinds(slot('2026-11-04'))).toEqual(['parents']);
    expect(slot('2026-11-05')).toBeNull();
    expect(slot('2027-01-06')).toBeNull();
  });

  it('nothing shows before the season opens', () => {
    expect(slot('2026-08-31')).toBeNull();
  });

  it('flags tonight on the event date only', () => {
    const eve = slot('2026-10-07').promos;
    expect(eve.every((p) => p.tonight === false)).toBe(true);
    const night = slot('2026-10-14').promos;
    expect(night.filter((p) => p.tonight).map((p) => p.kind)).toEqual(['contest', 'friend', 'barfEpic']);
    // Parents' Night is still weeks away on the same evening.
    expect(night.find((p) => p.kind === 'parents').tonight).toBe(false);
  });

  it('carries each promo\'s own countdown line', () => {
    const s = slot('2026-09-23');
    expect(s.promos.find((p) => p.kind === 'contest').countdown).toBe('3 club nights left');
    expect(s.promos.find((p) => p.kind === 'parents').countdown).toBe('6 club nights left');
    expect(slot('2026-10-14').promos.find((p) => p.kind === 'friend').countdown).toBe('Tonight!');
  });

  it('counts around a shared-schedule break week', () => {
    const s = slot('2026-09-23', { specialDates: { '2026-09-30': { noClub: true, label: 'Fall Break' } } });
    expect(s.promos.find((p) => p.kind === 'contest').countdown).toBe('2 club nights left');
  });

  it('flips afterContest the day after the posters are due', () => {
    expect(slot('2026-10-14').promos.every((p) => p.afterContest === false)).toBe(true);
    expect(slot('2026-10-15').promos.every((p) => p.afterContest === true)).toBe(true);
    expect(CONTEST_DATE).toBe('2026-10-14');
  });

  it('needs a feed: no events means no slot, never a blank counter', () => {
    expect(buildPromoSlot([], '2026-09-23')).toBeNull();
    expect(buildPromoSlot(null, '2026-09-23')).toBeNull();
    expect(buildPromoSlot(undefined, '2026-09-23')).toBeNull();
  });

  it('is off when the operator turns it off', () => {
    expect(slot('2026-09-23', { enabled: false })).toBeNull();
    expect(kinds(slot('2026-09-23', { enabled: true })))
      .toEqual(['contest', 'friend', 'parents', 'barfEpic']);
  });

  it('refuses an unusable date key rather than guessing', () => {
    expect(buildPromoSlot(season, '')).toBeNull();
    expect(buildPromoSlot(season, 'tomorrow')).toBeNull();
  });

  it('every descriptor in the table is one of the four known kinds', () => {
    expect(SEASON_PROMOS.map((p) => p.kind).sort())
      .toEqual(['barfEpic', 'contest', 'friend', 'parents']);
  });

  it('carries each promo\'s own hold onto the slot entry', () => {
    const s = slot('2026-09-23');
    expect(s.promos.map((p) => [p.kind, p.durationSec])).toEqual([
      ['contest', 15], ['friend', 15], ['parents', 15], ['barfEpic', 15],
    ]);
    // The slot keeps one too, as the fallback.
    expect(s.durationSec).toBe(PROMO_DURATION_SEC);
  });

  it('shows the slime cut through October 14 and never on the 15th', () => {
    const live = (d) => (kinds(slot(d)) || []).includes('barfEpic');
    expect(live('2026-09-01')).toBe(true);
    expect(live('2026-10-13')).toBe(true);
    expect(live('2026-10-14')).toBe(true);
    expect(live('2026-10-15')).toBe(false);
    expect(live('2026-11-04')).toBe(false);
  });
});
