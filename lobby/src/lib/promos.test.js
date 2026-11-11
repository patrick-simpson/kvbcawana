import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  promoForLap,
  PROMO_DURATION_SEC,
  SEASON_PROMOS,
  buildPromoSlot,
  buildEncoreSlot,
  VETERANS_SEC,
  countdownLabel,
  isPromoSlide,
  nightsUntil,
  PREVIEW_PROMOS,
  previewPromo,
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

// The fall 2026 promos are gone from the real table (removed 2026-11-10), but
// the mechanism that showed them (windows, countdowns, laps, holds) is still
// the one running Veterans Day, the Grand Prix and the snow slide. So these
// tests put five TEST-LOCAL descriptors into SEASON_PROMOS, with the same dates
// and holds the old posters had, around each test and take them out after.
// Kinds are testA..testE (A and B and D end October 14, C and E end November 4;
// E opens October 28 and holds 21 s), listed in the table order the posters had.
const TEST_PROMOS = [
  { id: 'promo_test_a', kind: 'testA', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_test_b', kind: 'testB', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_test_c', kind: 'testC', eventDate: '2026-11-04', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_test_d', kind: 'testD', eventDate: '2026-10-14', showFrom: '2026-09-01', durationSec: 15 },
  { id: 'promo_test_e', kind: 'testE', eventDate: '2026-11-04', showFrom: '2026-10-28', durationSec: 21 },
];

/** Puts TEST_PROMOS ahead of the real table for the tests in the enclosing describe. */
function withTestPromos() {
  let real = [];
  beforeEach(() => {
    real = SEASON_PROMOS.slice();
    SEASON_PROMOS.splice(0, SEASON_PROMOS.length, ...TEST_PROMOS, ...real);
  });
  afterEach(() => {
    SEASON_PROMOS.splice(0, SEASON_PROMOS.length, ...real);
  });
}

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
  // The slot's fallback hold (each descriptor carries its own).
  it('holds a promo for 15 seconds', () => {
    expect(PROMO_DURATION_SEC).toBe(15);
  });

  // A promo still carries its OWN hold, which is what the slideshow reads.
  it('gives every descriptor in the table its own duration', () => {
    // The Grand Prix is a 33.68 s video (the torn cut, 2021 frames at 60 fps).
    expect(SEASON_PROMOS.map((p) => p.durationSec)).toEqual([2021 / 60, VETERANS_SEC]);
  });
});

describe('buildPromoSlot', () => {
  withTestPromos();
  const slot = (todayStr, opts) => buildPromoSlot(season, todayStr, opts);
  const kinds = (s) => (s ? s.promos.map((p) => p.kind) : null);

  it('returns one slot carrying every live promo, in table order', () => {
    const s = slot('2026-09-23');
    expect(s.id).toBe('season_promo');
    expect(s.type).toBe('promo');
    expect(s.durationSec).toBe(PROMO_DURATION_SEC);
    expect(kinds(s)).toEqual(['testA', 'testB', 'testC', 'testD']);
    // Stable across calls — the slideshow picks by index each lap.
    expect(kinds(slot('2026-09-24'))).toEqual(['testA', 'testB', 'testC', 'testD']);
  });

  it('honours each promo\'s showFrom', () => {
    // These four open together on Sep 1; the day before, nothing shows.
    expect(slot('2026-08-31')).toBeNull();
    expect(kinds(slot('2026-09-01'))).toEqual(['testA', 'testB', 'testC', 'testD']);
    expect(kinds(slot('2026-09-13'))).toEqual(['testA', 'testB', 'testC', 'testD']);
  });

  it('shows the October event dates ON October 14 and retires them on the 15th', () => {
    expect(kinds(slot('2026-10-14'))).toEqual(['testA', 'testB', 'testC', 'testD']);
    expect(kinds(slot('2026-10-15'))).toEqual(['testC']);
  });

  it('shows a later event (and one opened late) ON its date and nothing at all on the day after', () => {
    expect(kinds(slot('2026-11-04'))).toEqual(['testC', 'testE']);
    expect(slot('2026-11-05')).toBeNull();
    // ...and nothing again until the Grand Prix opens on New Year's Day.
    expect(slot('2026-12-31')).toBeNull();
  });

  it('nothing shows before the season opens', () => {
    expect(slot('2026-08-31')).toBeNull();
  });

  it('flags tonight on the event date only', () => {
    const eve = slot('2026-10-07').promos;
    expect(eve.every((p) => p.tonight === false)).toBe(true);
    const night = slot('2026-10-14').promos;
    expect(night.filter((p) => p.tonight).map((p) => p.kind)).toEqual(['testA', 'testB', 'testD']);
    // The November event is still weeks away on the same evening.
    expect(night.find((p) => p.kind === 'testC').tonight).toBe(false);
  });

  it('carries each promo\'s own countdown line', () => {
    const s = slot('2026-09-23');
    expect(s.promos.find((p) => p.kind === 'testA').countdown).toBe('3 club nights left');
    expect(s.promos.find((p) => p.kind === 'testC').countdown).toBe('6 club nights left');
    expect(slot('2026-10-14').promos.find((p) => p.kind === 'testB').countdown).toBe('Tonight!');
  });

  it('counts around a shared-schedule break week', () => {
    const s = slot('2026-09-23', { specialDates: { '2026-09-30': { noClub: true, label: 'Fall Break' } } });
    expect(s.promos.find((p) => p.kind === 'testA').countdown).toBe('2 club nights left');
  });

  it('needs a feed: no events means no slot, never a blank counter', () => {
    expect(buildPromoSlot([], '2026-09-23')).toBeNull();
    expect(buildPromoSlot(null, '2026-09-23')).toBeNull();
    expect(buildPromoSlot(undefined, '2026-09-23')).toBeNull();
  });

  it('is off when the operator turns it off', () => {
    expect(slot('2026-09-23', { enabled: false })).toBeNull();
    expect(kinds(slot('2026-09-23', { enabled: true })))
      .toEqual(['testA', 'testB', 'testC', 'testD']);
  });

  it('refuses an unusable date key rather than guessing', () => {
    expect(buildPromoSlot(season, '')).toBeNull();
    expect(buildPromoSlot(season, 'tomorrow')).toBeNull();
  });

  it('every descriptor in the real table is one of the two known kinds', () => {
    expect(TEST_PROMOS.every((t) => SEASON_PROMOS.includes(t))).toBe(true);
    expect(SEASON_PROMOS.filter((p) => !TEST_PROMOS.includes(p)).map((p) => p.kind).sort())
      .toEqual(['grandPrix', 'veterans']);
  });

  // The Grand Prix video (owner 2026-10-29: "Get that one set to show up on
  // the displays starting in January."), through race day inclusive.
  it('shows the Grand Prix from New Year’s Day through race day, inclusive, and never after', () => {
    const spring = [club('2027-01-06'), club('2027-02-24'), club('2027-03-17'), club('2027-03-24')];
    const kinds = (day) => (buildPromoSlot(spring, day)?.promos ?? []).filter(Boolean).map((p) => p.kind);
    expect(kinds('2026-12-31')).toEqual([]);
    expect(kinds('2027-01-01')).toEqual(['grandPrix']);
    expect(kinds('2027-02-10')).toEqual(['grandPrix']);
    expect(kinds('2027-03-20')).toEqual(['grandPrix']);
    expect(kinds('2027-03-21')).toEqual([]);
    const gp = buildPromoSlot(spring, '2027-03-20').promos[0];
    expect(gp).toMatchObject({
      id: 'promo_grand_prix', eventDate: '2027-03-20', tonight: true, durationSec: 2021 / 60, exit: 'seamless', enter: 'seamless', theme: 'sky',
    });
    // Like every promo, it needs the calendar feed.
    expect(buildPromoSlot([], '2027-02-10')).toBeNull();
  });

  it('only a promo that ends on the lobby itself carries an exit and a theme', () => {
    const s = slot('2026-09-23');
    for (const p of s.promos) {
      expect(p).not.toHaveProperty('exit');
      expect(p).not.toHaveProperty('theme');
      expect(p).not.toHaveProperty('enter');
    }
    expect(SEASON_PROMOS.filter((p) => p.exit).map((p) => [p.kind, p.exit, p.theme])).toEqual([['grandPrix', 'seamless', 'sky']]);
    // ...and only such a promo can START on it too (an enter needs the exit's theme).
    expect(SEASON_PROMOS.filter((p) => p.enter).map((p) => [p.kind, p.enter, p.exit])).toEqual([['grandPrix', 'seamless', 'seamless']]);
  });

  it('shares the snow season’s laps: the snow slide one lap in six, the Grand Prix the other five', () => {
    const spring = [club('2027-01-06'), club('2027-01-13')];
    const s = buildPromoSlot(spring, '2027-01-04', { snowAlerts: true });
    expect(s.promos.map((p) => (p ? p.kind : null))).toEqual(['snowAlerts', 'grandPrix', 'grandPrix', 'grandPrix', 'grandPrix', 'grandPrix']);
  });

  it('shows a promo that opens late from its showFrom day through its event date, inclusive, with its own hold', () => {
    const kinds = (day) => (slot(day)?.promos ?? []).filter(Boolean).map((p) => p.kind);
    expect(kinds('2026-10-27')).not.toContain('testE');
    expect(kinds('2026-10-28')).toContain('testE');
    expect(kinds('2026-11-04')).toContain('testE');
    expect(kinds('2026-11-05')).not.toContain('testE');
    const f = slot('2026-11-04').promos.find((p) => p && p.kind === 'testE');
    expect(f).toMatchObject({ tonight: true, countdown: 'Tonight!', durationSec: 21, eventDate: '2026-11-04' });
  });

  it('carries each promo\'s own hold onto the slot entry', () => {
    const s = slot('2026-09-23');
    expect(s.promos.map((p) => [p.kind, p.durationSec])).toEqual([
      ['testA', 15], ['testB', 15], ['testC', 15], ['testD', 15],
    ]);
    // The slot keeps one too, as the fallback.
    expect(s.durationSec).toBe(PROMO_DURATION_SEC);
  });

  it('shows a promo through its event date (October 14) and never on the day after', () => {
    const live = (d) => (kinds(slot(d)) || []).includes('testD');
    expect(live('2026-09-01')).toBe(true);
    expect(live('2026-10-13')).toBe(true);
    expect(live('2026-10-14')).toBe(true);
    expect(live('2026-10-15')).toBe(false);
    expect(live('2026-11-04')).toBe(false);
  });
});

// The snow-alerts slide rides the promo slot on its own cadence
// (src/lib/snowAlerts.js): one lap in six on a calm week, every other lap
// when snow is forecast near club night. Null entries are laps the slot sits
// out, which ManualSlideshow steps past.
describe('buildPromoSlot with the snow-alerts slide', () => {
  withTestPromos();
  const winter = [...season, club('2026-11-18'), club('2026-11-25'), club('2026-12-02'), club('2026-12-09')];
  const kinds = (s) => (s ? s.promos.map((p) => (p ? p.kind : null)) : null);
  const dry = { time: ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'], inches: [0, 0, 0, 0] };
  const stormy = { time: dry.time, inches: [0, 0, 0, 3.5] };
  const snowSlot = (today, forecast = null, extra = {}) => buildPromoSlot(winter, today, { snowAlerts: true, snowForecast: forecast, ...extra });

  it('takes one lap in six on a calm week, and sits the other five out when nothing else is live', () => {
    expect(kinds(snowSlot('2026-11-29', dry))).toEqual(['snowAlerts', null, null, null, null, null]);
    expect(kinds(snowSlot('2026-12-10'))).toEqual(['snowAlerts', null, null, null, null, null]);
  });

  it('takes every other lap when snow is forecast for club night', () => {
    const s = snowSlot('2026-11-29', stormy);
    expect(kinds(s)).toEqual(['snowAlerts', null]);
    expect(s.promos[0].snow).toEqual({ date: '2026-12-02', when: 'later', weekday: 'Wednesday', inches: 3.5 });
    expect(s.promos[0].durationSec).toBe(20);
  });

  it('shares its off laps with other promos that are still live', () => {
    // Nov 2 to 4: testC and testE are still up, so they take the other laps in turn.
    expect(kinds(snowSlot('2026-11-02'))).toEqual(['snowAlerts', 'testC', 'testE', 'testC', 'testE', 'testC']);
  });

  it('alternates with live promos in a snow week', () => {
    // Snow forecast for Wed Nov 4, the event night itself: every other lap, the
    // two live promos taking the laps between in turn.
    const nov = { time: ['2026-11-02', '2026-11-03', '2026-11-04'], inches: [0, 0, 2] };
    const s = buildPromoSlot(winter, '2026-11-02', { snowAlerts: true, snowForecast: nov });
    expect(kinds(s)).toEqual(['snowAlerts', 'testC', 'snowAlerts', 'testE']);
    expect(s.promos[0].snow?.when).toBe('later');
  });

  it('never shows outside November to March', () => {
    expect(kinds(snowSlot('2026-10-31'))).not.toContain('snowAlerts');
    expect(buildPromoSlot(winter, '2027-04-01', { snowAlerts: true })).toBeNull();
  });

  it('is off unless asked for, and goes with the rest when promos are switched off', () => {
    expect(kinds(buildPromoSlot(winter, '2026-11-02'))).toEqual(['testC', 'testE']);
    expect(snowSlot('2026-12-10', null, { enabled: false })).toBeNull();
  });

  it('still needs the calendar feed, like every promo', () => {
    expect(buildPromoSlot([], '2026-12-10', { snowAlerts: true })).toBeNull();
  });

  it('promoForLap: picks the lap’s entry, and never leaves a lone slot blank', () => {
    const slot = snowSlot('2026-12-10');
    expect(promoForLap(slot, 0, 3)?.kind).toBe('snowAlerts');
    expect(promoForLap(slot, 1, 3)).toBeNull();
    expect(promoForLap(slot, 6, 3)?.kind).toBe('snowAlerts');
    expect(promoForLap(slot, 1, 1)?.kind).toBe('snowAlerts');
    expect(promoForLap(null, 0, 3)).toBeNull();
  });
});

describe('previewPromo: Settings → Slides → Preview the promos', () => {
  withTestPromos();
  it('offers every promo and both snow versions', () => {
    expect(PREVIEW_PROMOS.map((p) => p.key)).toEqual(['grandPrix', 'snowAlerts', 'snowAlertsStorm']);
    for (const p of PREVIEW_PROMOS) expect(previewPromo(p.key, season, '2026-10-01')).not.toBeNull();
    expect(previewPromo('nope', season, '2026-10-01')).toBeNull();
  });

  it('counts a dated promo down from the real calendar while its night is ahead', () => {
    const d = previewPromo('testA', season, '2026-10-01');
    expect(d).toMatchObject({ id: 'promo_test_a', kind: 'testA', eventDate: '2026-10-14', tonight: false, durationSec: 15 });
    expect(d.countdown).toBe(countdownLabel(nightsUntil(season, '2026-10-01', '2026-10-14'), '2026-10-01', '2026-10-14'));
    expect(previewPromo('testB', season, '2026-10-14')).toMatchObject({ tonight: true, countdown: 'Tonight!' });
  });

  it('previews the Grand Prix video long before January, with its seamless ending', () => {
    expect(PREVIEW_PROMOS.find((p) => p.key === 'grandPrix')?.label).toBe('Grand Prix (video)');
    expect(previewPromo('grandPrix', season, '2026-10-29')).toMatchObject({
      id: 'promo_grand_prix', kind: 'grandPrix', eventDate: '2027-03-20', tonight: false, durationSec: 2021 / 60, exit: 'seamless', enter: 'seamless', theme: 'sky',
    });
  });

  it('plays a promo whose night has passed, naming its date instead of a count', () => {
    const d = previewPromo('testD', season, '2026-12-01');
    expect(d.tonight).toBe(false);
    expect(d.countdown).toMatch(/October/);
    expect(d.countdown).not.toMatch(/left|Next|Tonight/);
  });

  it('the ordinary snow slide has no storm; the snow week names the next club night', () => {
    expect(previewPromo('snowAlerts', season, '2026-10-01')).toMatchObject({ kind: 'snowAlerts', snow: null, durationSec: 20 });
    expect(previewPromo('snowAlertsStorm', season, '2026-10-01').snow)
      .toEqual({ date: '2026-10-07', when: 'later', weekday: 'Wednesday', inches: 3 });
    expect(previewPromo('snowAlertsStorm', season, '2026-10-07').snow.when).toBe('tonight');
  });

  it('without a feed the snow week names the coming Wednesday', () => {
    expect(previewPromo('snowAlertsStorm', null, '2026-12-04').snow).toMatchObject({ date: '2026-12-09', weekday: 'Wednesday' });
    expect(previewPromo('snowAlertsStorm', [], '2026-12-09').snow).toMatchObject({ date: '2026-12-09', when: 'tonight' });
  });
});

// "Thank you, veterans" (owner 2026-11-10: "It's only to show up on 11/11"):
// Wednesday the 11th only, and twice per pass that day.
describe('the Veterans Day poster', () => {
  const kinds = (day, extra = {}) => (buildPromoSlot(season, day, extra)?.promos ?? []).filter(Boolean).map((p) => p.kind);

  it('is a quiet 10 seconds that airs twice on its day (encore)', () => {
    const v = SEASON_PROMOS.find((p) => p.kind === 'veterans');
    expect(v).toMatchObject({ id: 'promo_veterans', eventDate: '2026-11-11', showFrom: '2026-11-11', durationSec: 10, encore: true });
    expect(VETERANS_SEC).toBe(10);
    expect(SEASON_PROMOS.filter((p) => p.encore)).toHaveLength(1);
  });

  it('shows on November 11 only: not before, never after', () => {
    expect(kinds('2026-11-08')).toEqual([]);
    expect(kinds('2026-11-09')).toEqual([]);
    expect(kinds('2026-11-10')).toEqual([]);
    expect(kinds('2026-11-11')).toEqual(['veterans']);
    expect(kinds('2026-11-12')).toEqual([]);
    expect(buildPromoSlot(season, '2026-11-12')).toBeNull();
  });

  it('says Tonight! on its one day', () => {
    expect(buildPromoSlot(season, '2026-11-11').promos[0]).toMatchObject({ tonight: true, countdown: 'Tonight!' });
  });

  it('takes the off laps after the snow slide in November, and is gone on the 12th', () => {
    const lap = (day) => buildPromoSlot(season, day, { snowAlerts: true })?.promos.map((p) => (p ? p.kind : null));
    expect(lap('2026-11-11')).toEqual(['snowAlerts', 'veterans', 'veterans', 'veterans', 'veterans', 'veterans']);
    expect(lap('2026-11-10')).not.toContain('veterans');
    expect(lap('2026-11-12')).not.toContain('veterans');
  });

  it('is NOT in the Preview list (it also feeds the home page poster loop, and must not outlive Wednesday)', () => {
    expect(PREVIEW_PROMOS.map((p) => p.key)).not.toContain('veterans');
    expect(previewPromo('veterans', season, '2026-11-11')).not.toBeNull();
  });
});

describe('buildEncoreSlot', () => {
  it('is the same poster as a second slot, on 2026-11-11 only', () => {
    const slot = buildEncoreSlot(season, '2026-11-11');
    expect(slot).toMatchObject({ id: 'season_promo_encore', type: 'promo', durationSec: PROMO_DURATION_SEC });
    expect(slot.promos).toHaveLength(1);
    expect(slot.promos[0]).toMatchObject({ id: 'promo_veterans', kind: 'veterans', durationSec: 10, tonight: true, countdown: 'Tonight!' });
    expect(slot.promos[0]).toEqual(buildPromoSlot(season, '2026-11-11').promos[0]);
    expect(isPromoSlide(slot)).toBe(true);
  });

  it('is null every other day, with no feed, or switched off', () => {
    for (const day of ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13', '2026-10-14', '2027-01-06', '']) {
      expect(buildEncoreSlot(season, day)).toBeNull();
    }
    expect(buildEncoreSlot([], '2026-11-11')).toBeNull();
    expect(buildEncoreSlot(null, '2026-11-11')).toBeNull();
    expect(buildEncoreSlot(season, '2026-11-11', { enabled: false })).toBeNull();
  });
});
