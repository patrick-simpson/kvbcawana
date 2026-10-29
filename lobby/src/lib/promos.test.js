import { describe, it, expect } from 'vitest';
import {
  promoForLap,
  CONTEST_DATE,
  PARENTS_DATE,
  PROMO_DURATION_SEC,
  SEASON_PROMOS,
  buildPromoSlot,
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
    // The finalists' showreel is 21 s: six posters take their bow (each with its zoom) before the call.
    // The Grand Prix is a 30 s video.
    expect(SEASON_PROMOS.map((p) => p.durationSec)).toEqual([15, 15, 15, 15, 21, 30]);
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

  it('shows Parents\' Night (and the finalists to vote on) ON November 4 and nothing at all on the 5th', () => {
    expect(kinds(slot('2026-11-04'))).toEqual(['parents', 'finalists']);
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

  it('every descriptor in the table is one of the six known kinds', () => {
    expect(SEASON_PROMOS.map((p) => p.kind).sort())
      .toEqual(['barfEpic', 'contest', 'finalists', 'friend', 'grandPrix', 'parents']);
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
      id: 'promo_grand_prix', eventDate: '2027-03-20', tonight: true, durationSec: 30, exit: 'seamless', theme: 'sky',
    });
    // Like every promo, it needs the calendar feed.
    expect(buildPromoSlot([], '2027-02-10')).toBeNull();
  });

  it('only a promo that ends on the lobby itself carries an exit and a theme', () => {
    const s = slot('2026-09-23');
    for (const p of s.promos) {
      expect(p).not.toHaveProperty('exit');
      expect(p).not.toHaveProperty('theme');
    }
    expect(SEASON_PROMOS.filter((p) => p.exit).map((p) => [p.kind, p.exit, p.theme])).toEqual([['grandPrix', 'seamless', 'sky']]);
  });

  it('shares the snow season’s laps: the snow slide one lap in six, the Grand Prix the other five', () => {
    const spring = [club('2027-01-06'), club('2027-01-13')];
    const s = buildPromoSlot(spring, '2027-01-04', { snowAlerts: true });
    expect(s.promos.map((p) => (p ? p.kind : null))).toEqual(['snowAlerts', 'grandPrix', 'grandPrix', 'grandPrix', 'grandPrix', 'grandPrix']);
  });

  it('shows the finalists from the day they were picked through the vote at Parents’ Night, inclusive', () => {
    const kinds = (day) => (slot(day)?.promos ?? []).filter(Boolean).map((p) => p.kind);
    expect(kinds('2026-10-27')).not.toContain('finalists');
    expect(kinds('2026-10-28')).toContain('finalists');
    expect(kinds('2026-11-04')).toContain('finalists');
    expect(kinds('2026-11-05')).not.toContain('finalists');
    const f = slot('2026-11-04').promos.find((p) => p && p.kind === 'finalists');
    expect(f).toMatchObject({ tonight: true, countdown: 'Tonight!', durationSec: 21, eventDate: PARENTS_DATE });
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

// The snow-alerts slide rides the promo slot on its own cadence
// (src/lib/snowAlerts.js): one lap in six on a calm week, every other lap
// when snow is forecast near club night. Null entries are laps the slot sits
// out, which ManualSlideshow steps past.
describe('buildPromoSlot with the snow-alerts slide', () => {
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

  it('shares its off laps with a fall poster that is still live', () => {
    // Nov 1 to 4: Parents' Night and the finalists are still up, so they take the other laps in turn.
    expect(kinds(snowSlot('2026-11-02'))).toEqual(['snowAlerts', 'parents', 'finalists', 'parents', 'finalists', 'parents']);
  });

  it('alternates with a live poster in a snow week', () => {
    // Snow forecast for Wed Nov 4, Parents' Night itself: every other lap, the
    // two live posters taking the laps between in turn.
    const nov = { time: ['2026-11-02', '2026-11-03', '2026-11-04'], inches: [0, 0, 2] };
    const s = buildPromoSlot(winter, '2026-11-02', { snowAlerts: true, snowForecast: nov });
    expect(kinds(s)).toEqual(['snowAlerts', 'parents', 'snowAlerts', 'finalists']);
    expect(s.promos[0].snow?.when).toBe('later');
  });

  it('never shows outside November to March', () => {
    expect(kinds(snowSlot('2026-10-31'))).not.toContain('snowAlerts');
    expect(buildPromoSlot(winter, '2027-04-01', { snowAlerts: true })).toBeNull();
  });

  it('is off unless asked for, and goes with the rest when promos are switched off', () => {
    expect(kinds(buildPromoSlot(winter, '2026-11-02'))).toEqual(['parents', 'finalists']);
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
  it('offers every poster and both snow versions', () => {
    expect(PREVIEW_PROMOS.map((p) => p.key)).toEqual(['contest', 'friend', 'barfEpic', 'parents', 'finalists', 'grandPrix', 'snowAlerts', 'snowAlertsStorm']);
    for (const p of PREVIEW_PROMOS) expect(previewPromo(p.key, season, '2026-10-01')).not.toBeNull();
    expect(previewPromo('nope', season, '2026-10-01')).toBeNull();
  });

  it('counts a fall poster down from the real calendar while its night is ahead', () => {
    const d = previewPromo('contest', season, '2026-10-01');
    expect(d).toMatchObject({ id: 'promo_contest', kind: 'contest', eventDate: '2026-10-14', tonight: false, durationSec: 15 });
    expect(d.countdown).toBe(countdownLabel(nightsUntil(season, '2026-10-01', '2026-10-14'), '2026-10-01', '2026-10-14'));
    expect(previewPromo('friend', season, '2026-10-14')).toMatchObject({ tonight: true, countdown: 'Tonight!' });
  });

  it('previews the Grand Prix video long before January, with its seamless ending', () => {
    expect(PREVIEW_PROMOS.find((p) => p.key === 'grandPrix')?.label).toBe('Grand Prix (video)');
    expect(previewPromo('grandPrix', season, '2026-10-29')).toMatchObject({
      id: 'promo_grand_prix', kind: 'grandPrix', eventDate: '2027-03-20', tonight: false, durationSec: 30, exit: 'seamless', theme: 'sky',
    });
  });

  it('plays a poster whose night has passed, naming its date instead of a count', () => {
    const d = previewPromo('barfEpic', season, '2026-12-01');
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
